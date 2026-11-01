package com.mizius.mcp.mixin

import com.mizius.mcp.McpMod
import com.mizius.mcp.BackgroundLaunch
import com.mojang.blaze3d.platform.Window
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.Shadow
import org.spongepowered.asm.mixin.injection.At
import org.spongepowered.asm.mixin.injection.Inject
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo

@Mixin(Window::class)
abstract class WindowMixin {
    @Shadow abstract fun getWidth(): Int
    @Shadow abstract fun getHeight(): Int
    @Shadow abstract fun handle(): Long
    @Shadow private var focused = false

    @Inject(method = ["<init>"], at = [At("RETURN")])
    private fun `mcp$initialFocus`(ci: CallbackInfo) {
        if (BackgroundLaunch.enabled()) focused = BackgroundLaunch.focused(handle())
    }

    // This signature exists only on SDL versions. Set both activation hints before creation.
    @Inject(
        method = ["createWindow(Lcom/mojang/renderpearl/api/device/GpuBackend;IILjava/lang/String;)J"],
        at = [At("HEAD")],
        require = 0
    )
    private fun `mcp$backgroundSdl`(ci: CallbackInfoReturnable<Long>) {
        BackgroundLaunch.configureSdl()
    }

    // Keep GUI coordinate conversion usable when GLFW reports zero logical dimensions.
    @Inject(method = ["getScreenWidth"], at = [At("RETURN")], cancellable = true)
    private fun `mcp$width`(ci: CallbackInfoReturnable<Int>) {
        if (ci.returnValue <= 0 && McpMod.isControlling()) ci.returnValue = maxOf(1, getWidth())
    }

    @Inject(method = ["getScreenHeight"], at = [At("RETURN")], cancellable = true)
    private fun `mcp$height`(ci: CallbackInfoReturnable<Int>) {
        if (ci.returnValue <= 0 && McpMod.isControlling()) ci.returnValue = maxOf(1, getHeight())
    }
}
