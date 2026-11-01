package com.mizius.control.mixin

import com.mizius.control.ControlMod
import com.mizius.control.BackgroundLaunch
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
    private fun `control$initialFocus`(ci: CallbackInfo) {
        if (BackgroundLaunch.enabled()) focused = BackgroundLaunch.focused(handle())
    }

    // This signature exists only on SDL versions. Set both activation hints before creation.
    @Inject(
        method = ["createWindow(Lcom/mojang/renderpearl/api/device/GpuBackend;IILjava/lang/String;)J"],
        at = [At("HEAD")],
        require = 0
    )
    private fun `control$backgroundSdl`(ci: CallbackInfoReturnable<Long>) {
        BackgroundLaunch.configureSdl()
    }

    // Keep GUI coordinate conversion usable when GLFW reports zero logical dimensions.
    @Inject(method = ["getScreenWidth"], at = [At("RETURN")], cancellable = true)
    private fun `control$width`(ci: CallbackInfoReturnable<Int>) {
        if (ci.returnValue <= 0 && ControlMod.isControlling()) ci.returnValue = maxOf(1, getWidth())
    }

    @Inject(method = ["getScreenHeight"], at = [At("RETURN")], cancellable = true)
    private fun `control$height`(ci: CallbackInfoReturnable<Int>) {
        if (ci.returnValue <= 0 && ControlMod.isControlling()) ci.returnValue = maxOf(1, getHeight())
    }
}
