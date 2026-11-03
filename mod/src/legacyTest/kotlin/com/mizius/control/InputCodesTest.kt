package com.mizius.control

import com.google.gson.JsonPrimitive
import com.mojang.blaze3d.platform.InputConstants
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test
import org.lwjgl.glfw.GLFW

class InputCodesTest {
    @Test
    fun `GLFW codes map directly to Minecraft key inputs`() {
        assertEquals(GLFW.GLFW_KEY_W, InputCodes.keyCode(JsonPrimitive("w")))
        assertEquals(GLFW.GLFW_KEY_W, InputCodes.keyCode(JsonPrimitive(GLFW.GLFW_KEY_W)))
        assertEquals(GLFW.GLFW_KEY_W, InputCodes.nativeKey(GLFW.GLFW_KEY_W))
        assertEquals(InputConstants.Type.KEYSYM.getOrCreate(GLFW.GLFW_KEY_W), InputCodes.key(GLFW.GLFW_KEY_W))
        assertThrows(IllegalArgumentException::class.java) { InputCodes.keyCode(JsonPrimitive(0)) }
    }

    @Test
    fun `held modifier keys become GLFW modifier flags`() {
        assertEquals(
            GLFW.GLFW_MOD_SHIFT or GLFW.GLFW_MOD_CONTROL,
            InputCodes.modifiers { it == GLFW.GLFW_KEY_LEFT_SHIFT || it == GLFW.GLFW_KEY_RIGHT_CONTROL },
        )
        assertEquals(0, InputCodes.modifiers { false })
    }
}
