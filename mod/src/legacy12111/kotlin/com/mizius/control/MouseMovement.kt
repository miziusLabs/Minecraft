package com.mizius.control

import com.mizius.control.mixin.MouseAccess
import net.minecraft.client.MouseHandler

internal object MouseMovement {
    fun move(mouse: MouseHandler, window: Long, x: Double, y: Double) {
        (mouse as MouseAccess).`control$onMove`(window, x, y)
    }
}
