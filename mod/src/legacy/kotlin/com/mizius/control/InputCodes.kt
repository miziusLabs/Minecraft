package com.mizius.control

import com.google.gson.JsonElement
import com.mojang.blaze3d.platform.InputConstants
import org.lwjgl.glfw.GLFW
import java.util.Locale

/** Minecraft 1.21.4 uses GLFW key and mouse codes directly. */
object InputCodes {
    private val keyCodesByName: Map<String, Int> = buildMap {
        put("SPACE", GLFW.GLFW_KEY_SPACE)
        put("APOSTROPHE", GLFW.GLFW_KEY_APOSTROPHE)
        put("COMMA", GLFW.GLFW_KEY_COMMA)
        put("MINUS", GLFW.GLFW_KEY_MINUS)
        put("PERIOD", GLFW.GLFW_KEY_PERIOD)
        put("SLASH", GLFW.GLFW_KEY_SLASH)
        for (digit in 0..9) put(digit.toString(), GLFW.GLFW_KEY_0 + digit)
        put("SEMICOLON", GLFW.GLFW_KEY_SEMICOLON)
        put("EQUAL", GLFW.GLFW_KEY_EQUAL)
        for (letter in 'A'..'Z') put(letter.toString(), letter.code)
        put("LEFT_BRACKET", GLFW.GLFW_KEY_LEFT_BRACKET)
        put("BACKSLASH", GLFW.GLFW_KEY_BACKSLASH)
        put("RIGHT_BRACKET", GLFW.GLFW_KEY_RIGHT_BRACKET)
        put("GRAVE_ACCENT", GLFW.GLFW_KEY_GRAVE_ACCENT)
        put("WORLD_1", GLFW.GLFW_KEY_WORLD_1)
        put("WORLD_2", GLFW.GLFW_KEY_WORLD_2)
        put("ESCAPE", GLFW.GLFW_KEY_ESCAPE)
        put("ENTER", GLFW.GLFW_KEY_ENTER)
        put("TAB", GLFW.GLFW_KEY_TAB)
        put("BACKSPACE", GLFW.GLFW_KEY_BACKSPACE)
        put("INSERT", GLFW.GLFW_KEY_INSERT)
        put("DELETE", GLFW.GLFW_KEY_DELETE)
        put("RIGHT", GLFW.GLFW_KEY_RIGHT)
        put("LEFT", GLFW.GLFW_KEY_LEFT)
        put("DOWN", GLFW.GLFW_KEY_DOWN)
        put("UP", GLFW.GLFW_KEY_UP)
        put("PAGE_UP", GLFW.GLFW_KEY_PAGE_UP)
        put("PAGE_DOWN", GLFW.GLFW_KEY_PAGE_DOWN)
        put("HOME", GLFW.GLFW_KEY_HOME)
        put("END", GLFW.GLFW_KEY_END)
        put("CAPS_LOCK", GLFW.GLFW_KEY_CAPS_LOCK)
        put("SCROLL_LOCK", GLFW.GLFW_KEY_SCROLL_LOCK)
        put("NUM_LOCK", GLFW.GLFW_KEY_NUM_LOCK)
        put("PRINT_SCREEN", GLFW.GLFW_KEY_PRINT_SCREEN)
        put("PAUSE", GLFW.GLFW_KEY_PAUSE)
        for (function in 1..25) put("F$function", GLFW.GLFW_KEY_F1 + function - 1)
        for (digit in 0..9) put("KP_$digit", GLFW.GLFW_KEY_KP_0 + digit)
        put("KP_DECIMAL", GLFW.GLFW_KEY_KP_DECIMAL)
        put("KP_DIVIDE", GLFW.GLFW_KEY_KP_DIVIDE)
        put("KP_MULTIPLY", GLFW.GLFW_KEY_KP_MULTIPLY)
        put("KP_SUBTRACT", GLFW.GLFW_KEY_KP_SUBTRACT)
        put("KP_ADD", GLFW.GLFW_KEY_KP_ADD)
        put("KP_ENTER", GLFW.GLFW_KEY_KP_ENTER)
        put("KP_EQUAL", GLFW.GLFW_KEY_KP_EQUAL)
        put("LEFT_SHIFT", GLFW.GLFW_KEY_LEFT_SHIFT)
        put("LEFT_CONTROL", GLFW.GLFW_KEY_LEFT_CONTROL)
        put("LEFT_ALT", GLFW.GLFW_KEY_LEFT_ALT)
        put("LEFT_SUPER", GLFW.GLFW_KEY_LEFT_SUPER)
        put("RIGHT_SHIFT", GLFW.GLFW_KEY_RIGHT_SHIFT)
        put("RIGHT_CONTROL", GLFW.GLFW_KEY_RIGHT_CONTROL)
        put("RIGHT_ALT", GLFW.GLFW_KEY_RIGHT_ALT)
        put("RIGHT_SUPER", GLFW.GLFW_KEY_RIGHT_SUPER)
        put("MENU", GLFW.GLFW_KEY_MENU)
    }

    @JvmStatic
    fun keyCode(key: JsonElement?): Int = parseKeyCode(key)

    @JvmStatic
    fun parseKeyCode(key: JsonElement?): Int {
        require(key != null && key.isJsonPrimitive) { "Missing key" }
        val primitive = key.asJsonPrimitive
        if (primitive.isNumber) {
            val number = primitive.asDouble
            require(number.isFinite() && number in GLFW.GLFW_KEY_SPACE.toDouble()..GLFW.GLFW_KEY_MENU.toDouble()
                && number == Math.rint(number)) { "Invalid GLFW key code" }
            return number.toInt()
        }
        require(primitive.isString) { "Key must be a GLFW name or number" }
        val name = when (val input = primitive.asString.uppercase(Locale.ROOT).replace(' ', '_')) {
            "CTRL", "CONTROL" -> "LEFT_CONTROL"
            "SHIFT" -> "LEFT_SHIFT"
            "ALT" -> "LEFT_ALT"
            "ESC" -> "ESCAPE"
            "RETURN" -> "ENTER"
            else -> input
        }
        return keyCodesByName[name] ?: throw IllegalArgumentException("Unknown key: $name")
    }

    @JvmStatic
    fun key(code: Int): InputConstants.Key = InputConstants.Type.KEYSYM.getOrCreate(nativeKey(code))

    @JvmStatic
    fun nativeKey(code: Int): Int = code.also {
        require(it in GLFW.GLFW_KEY_SPACE..GLFW.GLFW_KEY_MENU) { "Invalid GLFW key code" }
    }

    @JvmStatic
    fun mouseButton(button: Int): Int = button.also {
        require(it in 0..7) { "Invalid mouse button: $it" }
    }

    @JvmStatic
    fun modifiers(held: (Int) -> Boolean): Int {
        var result = 0
        if (held(GLFW.GLFW_KEY_LEFT_SHIFT) || held(GLFW.GLFW_KEY_RIGHT_SHIFT)) result = result or GLFW.GLFW_MOD_SHIFT
        if (held(GLFW.GLFW_KEY_LEFT_CONTROL) || held(GLFW.GLFW_KEY_RIGHT_CONTROL)) result = result or GLFW.GLFW_MOD_CONTROL
        if (held(GLFW.GLFW_KEY_LEFT_ALT) || held(GLFW.GLFW_KEY_RIGHT_ALT)) result = result or GLFW.GLFW_MOD_ALT
        if (held(GLFW.GLFW_KEY_LEFT_SUPER) || held(GLFW.GLFW_KEY_RIGHT_SUPER)) result = result or GLFW.GLFW_MOD_SUPER
        return result
    }

    val press: Int get() = InputConstants.PRESS
    val release: Int get() = InputConstants.RELEASE
}
