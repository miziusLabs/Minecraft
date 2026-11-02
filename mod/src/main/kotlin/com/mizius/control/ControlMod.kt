package com.mizius.control

import net.fabricmc.api.ClientModInitializer
import net.minecraft.client.Minecraft
import org.slf4j.LoggerFactory

class ControlMod : ClientModInitializer {
    override fun onInitializeClient() {
        val minecraft = Minecraft.getInstance()
        val clientControl = ClientControl(minecraft)
        control = clientControl
        try {
            val controlServer = ControlServer(clientControl)
            server = controlServer
            controlServer.start()
            logger.info("Minecraft command endpoint listening on 127.0.0.1:{}", controlServer.port())
        } catch (exception: Exception) {
            logger.error("Could not start Minecraft control server", exception)
        }
    }

    companion object {
        private val logger = LoggerFactory.getLogger("minecraft-control")
        private var control: ClientControl? = null
        private var server: ControlServer? = null

        @JvmStatic fun isControlling(): Boolean = control?.active() == true
        @JvmStatic fun isHeld(key: Int): Boolean = control?.held(key) == true
        @JvmStatic fun tick() { control?.tick() }
        @JvmStatic fun frame() { control?.frame() }
        @JvmStatic fun close() {
            control?.close()
            server?.close()
        }
    }
}
