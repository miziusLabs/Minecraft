package com.mizius.control

import com.google.gson.JsonObject
import com.mojang.blaze3d.platform.NativeImage
import net.minecraft.client.Minecraft
import net.minecraft.client.Screenshot
import org.jcodec.api.awt.AWTSequenceEncoder
import org.jcodec.common.io.FileChannelWrapper
import org.jcodec.common.io.NIOUtils
import org.jcodec.common.model.Rational
import java.awt.image.BufferedImage
import java.nio.file.Files
import java.nio.file.Path
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.min

private data class CapturedFrame(val pixels: IntArray)

/** Captures rendered frames and encodes them away from the client thread. */
class RecordingManager(private val mc: Minecraft) : AutoCloseable {
    private val timeoutExecutor = Executors.newSingleThreadScheduledExecutor { runnable ->
        Thread(runnable, "minecraft-control-recording-timeout").apply { isDaemon = true }
    }
    private var current: Session? = null

    fun isRecording(): Boolean = current?.isAcceptingFrames() == true

    @Synchronized
    fun start(fps: Int): JsonObject {
        require(fps in MIN_FPS..MAX_FPS) { "fps must be between $MIN_FPS and $MAX_FPS" }
        val previous = current
        check(previous == null || previous.completion.isDone) {
            if (previous?.isAcceptingFrames() == true) "A recording is already active" else "The previous recording is still finishing"
        }

        val target = mc.getMainRenderTarget()
        require(target.width > 0 && target.height > 0) { "The game window has no renderable pixels" }
        val scale = min(1.0, min(MAX_WIDTH.toDouble() / target.width, MAX_HEIGHT.toDouble() / target.height))
        val width = even((target.width * scale).toInt())
        val height = even((target.height * scale).toInt())
        val directory = mc.gameDirectory.toPath().resolve("recordings")
        Files.createDirectories(directory)
        val timestamp = FILE_TIME.format(Instant.now())
        val file = directory.resolve("minecraft-recording-$timestamp-${UUID.randomUUID().toString().take(8)}.mp4")
        val session = Session(file, fps, width, height)
        current = session
        session.start()
        return JsonObject().apply {
            addProperty("recording", true)
            addProperty("file", file.toAbsolutePath().toString())
            addProperty("fps", fps)
            addProperty("width", width)
            addProperty("height", height)
            addProperty("max_duration_ms", MAX_DURATION_MS)
        }
    }

    fun captureFrame() {
        val session = current ?: return
        if (!session.requestCapture()) return
        try {
            val image = Screenshot.takeScreenshot(mc.getMainRenderTarget())
            try {
                image.use { session.submit(readPixels(image, session.width, session.height)) }
            } catch (exception: Exception) {
                session.fail(exception)
            } finally {
                session.captureFinished()
            }
        } catch (exception: Exception) {
            session.captureFinished()
            session.fail(exception)
        }
    }

    fun stop(): CompletableFuture<JsonObject> {
        val session = current ?: return CompletableFuture.completedFuture(JsonObject().apply {
            addProperty("recording", false)
            addProperty("stopped", false)
        })
        session.requestStop()
        return session.completion
    }

    override fun close() {
        try {
            stop().get(CLOSE_TIMEOUT_SECONDS, TimeUnit.SECONDS)
        } catch (_: Exception) {
            // Minecraft must still be able to exit if the encoder has failed or stalled.
        } finally {
            timeoutExecutor.shutdownNow()
        }
    }

    private fun readPixels(image: NativeImage, width: Int, height: Int): IntArray {
        val sourceWidth = image.getWidth()
        val sourceHeight = image.getHeight()
        val sourcePixels = try { image.getPixels() } catch (_: IllegalArgumentException) { null }
        val pixels = IntArray(width * height)
        for (y in 0 until height) {
            val sourceY = y * sourceHeight / height
            for (x in 0 until width) {
                val sourceX = x * sourceWidth / width
                pixels[y * width + x] = sourcePixels?.get(sourceY * sourceWidth + sourceX) ?: image.getPixel(sourceX, sourceY)
            }
        }
        return pixels
    }

    private inner class Session(
        val file: Path,
        private val fps: Int,
        val width: Int,
        val height: Int
    ) {
        private val startedAt = System.nanoTime()
        private val accepting = AtomicBoolean(true)
        private val capturePending = AtomicBoolean(false)
        private val stopRequestedAt = AtomicLong()
        private val frames = ArrayBlockingQueue<CapturedFrame>(QUEUE_CAPACITY)
        private val dropped = AtomicLong()
        private val failure = java.util.concurrent.atomic.AtomicReference<Throwable?>()
        val completion = CompletableFuture<JsonObject>()
        private var timeout: ScheduledFuture<*>? = null

        fun isAcceptingFrames(): Boolean = accepting.get()

        fun start() {
            timeout = timeoutExecutor.schedule({ requestStop() }, MAX_DURATION_MS, TimeUnit.MILLISECONDS)
            Thread(::encode, "minecraft-control-recording").apply {
                isDaemon = true
                start()
            }
        }

        fun requestCapture(): Boolean {
            if (!accepting.get()) return false
            val interval = TimeUnit.SECONDS.toNanos(1) / fps
            val now = System.nanoTime()
            if (now - lastCaptureAt < interval || !capturePending.compareAndSet(false, true)) return false
            lastCaptureAt = now
            return true
        }

        @Volatile private var lastCaptureAt = 0L

        fun submit(pixels: IntArray) {
            if (!accepting.get()) return
            if (!frames.offer(CapturedFrame(pixels))) dropped.incrementAndGet()
        }

        fun captureFinished() { capturePending.set(false) }

        fun fail(exception: Throwable) {
            failure.compareAndSet(null, exception)
            requestStop()
        }

        fun requestStop() {
            if (accepting.compareAndSet(true, false)) {
                stopRequestedAt.set(System.nanoTime())
                timeout?.cancel(false)
            }
        }

        private fun encode() {
            var channel: FileChannelWrapper? = null
            var frameCount = 0
            var output: JsonObject? = null
            var error: Exception? = null
            try {
                channel = NIOUtils.writableFileChannel(file.toString())
                val activeEncoder = AWTSequenceEncoder(channel, Rational.R(fps, 1))
                while (true) {
                    val frame = frames.poll(100, TimeUnit.MILLISECONDS)
                    if (frame != null) {
                        if (failure.get() != null) throw failure.get()!!
                        val image = BufferedImage(width, height, BufferedImage.TYPE_INT_RGB)
                        image.setRGB(0, 0, width, height, frame.pixels, 0, width)
                        activeEncoder.encodeImage(image)
                        frameCount++
                    } else if (!accepting.get()) {
                        break
                    }
                }
                failure.get()?.let { throw it }
                check(frameCount > 0) { "The recording ended before Minecraft rendered a frame" }
                activeEncoder.finish()
                val stoppedAt = stopRequestedAt.get().takeIf { it > 0 } ?: System.nanoTime()
                val elapsedMs = TimeUnit.NANOSECONDS.toMillis(stoppedAt - startedAt)
                output = JsonObject().apply {
                    addProperty("recording", false)
                    addProperty("stopped", true)
                    addProperty("file", file.toAbsolutePath().toString())
                    addProperty("fps", fps)
                    addProperty("width", width)
                    addProperty("height", height)
                    addProperty("frames", frameCount)
                    addProperty("dropped_frames", dropped.get())
                    addProperty("duration_ms", frameCount * 1000L / fps)
                    addProperty("elapsed_ms", elapsedMs)
                }
            } catch (exception: Exception) {
                requestStop()
                error = exception
            } finally {
                runCatching { channel?.close() }
            }
            if (error != null) {
                runCatching { Files.deleteIfExists(file) }
                completion.completeExceptionally(IllegalStateException("Could not finish recording: ${error.message ?: error.javaClass.simpleName}", error))
            } else {
                completion.complete(output!!)
            }
        }
    }

    companion object {
        const val DEFAULT_FPS = 10
        const val MIN_FPS = 1
        const val MAX_FPS = 20
        private const val MAX_WIDTH = 1280
        private const val MAX_HEIGHT = 720
        private const val QUEUE_CAPACITY = 2
        private const val MAX_DURATION_MS = 10 * 60 * 1000L
        private const val CLOSE_TIMEOUT_SECONDS = 8L
        private val FILE_TIME = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss-SSS").withZone(ZoneOffset.UTC)

        private fun even(value: Int): Int = maxOf(2, value - value % 2)
    }
}
