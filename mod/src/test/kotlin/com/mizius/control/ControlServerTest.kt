package com.mizius.control

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList

class ControlServerTest {
    private lateinit var server: ControlServer
    private val calls = CopyOnWriteArrayList<String>()
    private val client = HttpClient.newHttpClient()

    @BeforeEach
    fun start() {
        server = ControlServer({ name, _ ->
            calls.add(name)
            CompletableFuture.completedFuture(JsonObject().apply { addProperty("command", name) })
        }, 0, "")
        server.start()
    }

    @AfterEach
    fun stop() = server.close()

    private fun post(body: String, vararg headers: String): HttpResponse<String> {
        val request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:${server.port()}/control"))
            .header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(body))
        headers.toList().chunked(2).forEach { (name, value) -> request.header(name, value) }
        return client.send(request.build(), HttpResponse.BodyHandlers.ofString())
    }

    @Test
    fun dispatchesCliCommandsAndReturnsJson() {
        val response = post("""{"command":"state","arguments":{}}""")
        assertEquals(200, response.statusCode())
        assertEquals("state", JsonParser.parseString(response.body()).asJsonObject.get("command").asString)
        assertEquals(listOf("state"), calls)
    }

    @Test
    fun rejectsBrowserOriginMalformedOversizedAndInvalidCommandRequests() {
        assertEquals(403, post("{}", "Origin", "https://example.com").statusCode())
        assertEquals(400, post("{").statusCode())
        assertEquals(400, post("[]").statusCode())
        assertEquals(413, post(" ".repeat(1_048_577)).statusCode())
        assertEquals(400, post("""{"arguments":{}}""").statusCode())
        assertTrue(calls.isEmpty())
    }

    @Test
    fun enforcesOptionalBearerToken() {
        server.close()
        server = ControlServer({ _, _ -> CompletableFuture.completedFuture(JsonObject()) }, 0, "test-secret")
        server.start()
        assertEquals(403, post("""{"command":"state"}""").statusCode())
        assertEquals(200, post("""{"command":"state"}""", "Authorization", "Bearer test-secret").statusCode())
    }
}
