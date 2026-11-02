package com.mizius.control

import com.google.gson.*
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.charset.StandardCharsets.UTF_8
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.*

/** Local command endpoint used only by the minecraft CLI. */
class ControlServer @Throws(IOException::class) constructor(
    private val tools: Tools,
    port: Int,
    private val token: String,
    private val logs: ClientLogs = ClientLogs()
) : AutoCloseable {
    fun interface Tools {
        fun call(name: String, arguments: JsonObject): CompletableFuture<JsonObject>
    }

    private val http = HttpServer.create(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port), 16)
    private val workers: ExecutorService = ThreadPoolExecutor(
        2, 4, 30, TimeUnit.SECONDS, ArrayBlockingQueue(16),
        ThreadFactory { runnable -> Thread(runnable, "minecraft-control-http").apply { isDaemon = true } },
        ThreadPoolExecutor.AbortPolicy()
    )
    private val actions = Semaphore(1, true)

    init {
        http.executor = workers
        http.createContext("/control", ::handle)
        http.createContext("/health", ::health)
    }

    @Throws(IOException::class)
    constructor(tools: Tools) : this(tools, configuredPort(), configuredToken())

    fun port(): Int = http.address.port
    fun start() = http.start()
    override fun close() {
        http.stop(0)
        workers.shutdownNow()
        logs.close()
    }

    private fun health(exchange: HttpExchange) {
        exchange.use {
            val allowed = authorized(exchange)
            if (!allowed || exchange.requestURI.path != "/health" || exchange.requestMethod != "GET") {
                val status = if (!allowed) 403 else if (exchange.requestURI.path != "/health") 404 else 405
                send(exchange, status, JsonObject().apply { addProperty("error", "Request rejected") })
                return
            }
            send(exchange, 200, JsonObject().apply { addProperty("ready", true) })
        }
    }

    private fun handle(exchange: HttpExchange) {
        exchange.use {
            if (!authorized(exchange)) { send(exchange, 403, error("Request rejected")); return }
            if (exchange.requestURI.path != "/control") { send(exchange, 404, error("Unknown path")); return }
            if (exchange.requestMethod != "POST") {
                exchange.responseHeaders.set("Allow", "POST")
                send(exchange, 405, error("POST is required")); return
            }
            val type = exchange.requestHeaders.getFirst("Content-Type")
            if (type == null || !type.lowercase(Locale.ROOT).startsWith("application/json")) {
                send(exchange, 415, error("Content-Type must be application/json")); return
            }
            val bytes = exchange.requestBody.readNBytes(MAX_BODY + 1)
            if (bytes.size > MAX_BODY) { send(exchange, 413, error("Request is too large")); return }
            val request = try { JsonParser.parseString(String(bytes, UTF_8)).asJsonObject }
            catch (_: Exception) { send(exchange, 400, error("Invalid JSON request")); return }
            if (!request.has("command") || !request.get("command").isJsonPrimitive || !request.getAsJsonPrimitive("command").isString
                || request.has("arguments") && !request.get("arguments").isJsonObject) {
                send(exchange, 400, error("Expected a command and an optional arguments object")); return
            }
            val command = request.get("command").asString
            val arguments = if (request.has("arguments")) request.getAsJsonObject("arguments") else JsonObject()
            try {
                val result = if (command == "logs") logs.read(arguments) else {
                    if (!actions.tryAcquire(1, TimeUnit.SECONDS)) {
                        send(exchange, 409, error("Another command is running. Retry after it completes.")); return
                    }
                    try { if (command == "batch") batch(arguments) else invoke(command, arguments) }
                    finally { actions.release() }
                }
                send(exchange, 200, result)
            } catch (e: IllegalArgumentException) { send(exchange, 400, error(e.message ?: "Invalid command arguments")) }
            catch (e: IllegalStateException) { send(exchange, 409, error(e.message ?: "Command is not available in the current state")) }
            catch (e: TimeoutException) { send(exchange, 504, error("Command timed out. The game window may be minimized or busy.")) }
            catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                send(exchange, 503, error("Command server is stopping"))
            }
            catch (e: Exception) {
                val cause = if (e is ExecutionException) e.cause else e
                val status = when (cause) {
                    is IllegalArgumentException -> 400
                    is IllegalStateException -> 409
                    else -> 500
                }
                send(exchange, status, error(cause?.message ?: "Command failed"))
            }
        }
    }

    private fun authorized(exchange: HttpExchange): Boolean {
        val host = exchange.requestHeaders.getFirst("Host")
        if (host != "127.0.0.1:${port()}" && host != "localhost:${port()}") return false
        if (exchange.requestHeaders.containsKey("Origin")) return false
        return token.isEmpty() || MessageDigest.isEqual(
            "Bearer $token".toByteArray(UTF_8),
            (exchange.requestHeaders.getFirst("Authorization") ?: "").toByteArray(UTF_8)
        )
    }

    private fun batch(arguments: JsonObject): JsonObject {
        val input = arguments.get("actions")
        require(input != null && input.isJsonArray) { "actions must be an array" }
        val sequence = input.asJsonArray
        require(sequence.size() in 1..128) { "batch must contain 1 to 128 actions" }
        val prepared = sequence.map { item ->
            require(item.isJsonObject) { "Each action must be an object" }
            val action = item.asJsonObject
            require(action.keySet().all { it in setOf("command", "arguments", "delay_ms") }) { "Unknown batch action property" }
            val name = ClientControl.string(action, "command", 64)
            require(name in ClientControl.BATCH_COMMANDS || name == "logs") { "Invalid batch command: $name" }
            require(!action.has("arguments") || action.get("arguments").isJsonObject) { "Action arguments must be an object" }
            val args = if (action.has("arguments")) action.getAsJsonObject("arguments") else JsonObject()
            val delay = if (action.has("delay_ms")) ClientControl.integer(action, "delay_ms", 0, 10000) else 0
            Triple(name, args, delay)
        }
        var duration = 0L
        var screenshots = 0
        for ((name, args, delay) in prepared) {
            duration += delay
            when (name) {
                "drag" -> duration += if (args.has("duration_ms")) ClientControl.integer(args, "duration_ms", 50, 10000) else 250
                "click", "key" -> duration += 100
                "screenshot" -> screenshots++
            }
        }
        require(duration <= 20000) { "Batch delays and drag durations must total at most 20000 ms" }
        require(screenshots <= 8) { "Batch may contain at most 8 screenshots" }

        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30)
        val results = JsonArray()
        for ((name, args, delay) in prepared) {
            if (delay > 0) Thread.sleep(delay.toLong())
            val result = if (name == "logs") logs.read(args) else invoke(name, args, deadline)
            results.add(JsonObject().apply { addProperty("command", name); add("result", result) })
        }
        return JsonObject().apply { add("results", results) }
    }

    private fun invoke(command: String, arguments: JsonObject, deadline: Long? = null): JsonObject {
        val timeoutSeconds = if (command == "record") RECORDING_COMMAND_TIMEOUT_SECONDS else COMMAND_TIMEOUT_SECONDS
        val commandDeadline = deadline ?: System.nanoTime() + TimeUnit.SECONDS.toNanos(timeoutSeconds)
        val remaining = minOf(TimeUnit.SECONDS.toNanos(timeoutSeconds), commandDeadline - System.nanoTime())
        if (remaining <= 0) throw TimeoutException("Command timed out")
        val future = tools.call(command, arguments)
        return try { future.get(remaining, TimeUnit.NANOSECONDS) }
        catch (e: TimeoutException) { future.cancel(false); throw e }
        catch (e: ExecutionException) { throw (e.cause ?: e) }
    }

    companion object {
        private const val MAX_BODY = 1_048_576
        private const val COMMAND_TIMEOUT_SECONDS = 30L
        private const val RECORDING_COMMAND_TIMEOUT_SECONDS = 120L
        private fun configuredPort(): Int = Integer.getInteger("minecraft.control.port", 8765)
        private fun configuredToken(): String = System.getProperty("minecraft.control.token", System.getenv("MINECRAFT_CONTROL_TOKEN") ?: "")
        private fun error(message: String) = JsonObject().apply { addProperty("error", message) }
        private fun send(exchange: HttpExchange, status: Int, body: JsonObject) {
            exchange.responseHeaders.set("Cache-Control", "no-store")
            exchange.responseHeaders.set("Content-Type", "application/json")
            val bytes = Gson().toJson(body).toByteArray(UTF_8)
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.write(bytes)
        }
    }
}
