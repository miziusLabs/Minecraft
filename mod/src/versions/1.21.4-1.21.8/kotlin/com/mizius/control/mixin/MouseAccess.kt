package com.mizius.control.mixin

import net.minecraft.client.MouseHandler
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.gen.Accessor
import org.spongepowered.asm.mixin.gen.Invoker

@Mixin(MouseHandler::class)
interface MouseAccess {
    @Invoker("onMove")
    fun `control$onMove`(window: Long, x: Double, y: Double)

    @Invoker("onPress")
    fun `control$onButton`(window: Long, button: Int, action: Int, modifiers: Int)

    @Invoker("onScroll")
    fun `control$onScroll`(window: Long, horizontal: Double, vertical: Double)

    @Accessor("ignoreFirstMove")
    fun `control$ignoreFirstMove`(ignore: Boolean)
}
