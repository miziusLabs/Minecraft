package com.mizius.control

import net.minecraft.client.Minecraft

internal object WindowFocusAccess {
    fun isFocused(mc: Minecraft): Boolean = mc.getWindow().isFocused()
}
