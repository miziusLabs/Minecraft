package com.mizius.control

import net.minecraft.client.Minecraft
import net.minecraft.client.gui.screens.Screen

internal object ClientScreenAccess {
    fun current(mc: Minecraft): Screen? = mc.gui.screen()
}
