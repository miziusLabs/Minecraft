package com.mizius.control

import net.minecraft.client.input.CharacterEvent

internal object ClientInputEventAccess {
    fun character(codepoint: Int, modifiers: Int): CharacterEvent = CharacterEvent(codepoint, modifiers)
}
