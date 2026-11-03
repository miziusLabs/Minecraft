package com.mizius.control.mixin

import net.minecraft.client.KeyboardHandler
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.gen.Invoker

@Mixin(KeyboardHandler::class)
interface KeyboardAccess {
    @Invoker("keyPress")
    fun `control$keyPress`(window: Long, key: Int, scanCode: Int, action: Int, modifiers: Int)

    @Invoker("charTyped")
    fun `control$charTyped`(window: Long, codePoint: Int, modifiers: Int)
}
