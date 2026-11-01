package com.mizius.mcp

/** Keep the game visible and focusable without activating it during launch. */
object BackgroundLaunch {
    private var focusQuery: ((Long) -> Boolean)? = null

    fun enabled() = java.lang.Boolean.getBoolean("minecraft.mcp.background")

    fun focused(handle: Long): Boolean = focusQuery?.invoke(handle) ?: false

    fun configureGlfw() {
        if (!enabled()) return
        // Reflection keeps the SDL build loadable when GLFW is absent, and vice versa.
        val glfw = Class.forName("org.lwjgl.glfw.GLFW")
        val hint = glfw.getMethod("glfwWindowHint", Int::class.javaPrimitiveType, Int::class.javaPrimitiveType)
        hint.invoke(null, glfw.getField("GLFW_FOCUSED").getInt(null), 0)
        hint.invoke(null, glfw.getField("GLFW_FOCUS_ON_SHOW").getInt(null), 0)
        val focused = glfw.getField("GLFW_FOCUSED").getInt(null)
        val getAttribute = glfw.getMethod("glfwGetWindowAttrib", Long::class.javaPrimitiveType, Int::class.javaPrimitiveType)
        focusQuery = { handle -> getAttribute.invoke(null, handle, focused) == 1 }
    }

    fun configureSdl() {
        if (!enabled()) return
        val hints = Class.forName("org.lwjgl.sdl.SDLHints")
        val setHint = hints.getMethod("SDL_SetHintWithPriority", CharSequence::class.java, CharSequence::class.java, Int::class.javaPrimitiveType)
        val override = hints.getField("SDL_HINT_OVERRIDE").getInt(null)
        check(setHint.invoke(null, "SDL_WINDOW_ACTIVATE_WHEN_SHOWN", "0", override) == true) {
            "SDL rejected background window activation policy"
        }
        check(setHint.invoke(null, "SDL_WINDOW_ACTIVATE_WHEN_RAISED", "0", override) == true) {
            "SDL rejected background window raise policy"
        }
        val video = Class.forName("org.lwjgl.sdl.SDLVideo")
        val getFlags = video.getMethod("SDL_GetWindowFlags", Long::class.javaPrimitiveType)
        val inputFocus = video.getField("SDL_WINDOW_INPUT_FOCUS").getLong(null)
        focusQuery = { handle -> ((getFlags.invoke(null, handle) as Long) and inputFocus) != 0L }
    }
}
