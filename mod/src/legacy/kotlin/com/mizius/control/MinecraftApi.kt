package com.mizius.control

import com.mojang.blaze3d.platform.Window
import net.minecraft.SharedConstants
import net.minecraft.client.Minecraft

internal object MinecraftApi {
    fun disconnect(mc: Minecraft) = mc.disconnect()
    fun currentVersionName(): String = SharedConstants.getCurrentVersion().id
    fun windowHandle(window: Window): Long = window.getWindow()
}
