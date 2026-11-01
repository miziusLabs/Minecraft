@file:Suppress("INAPPLICABLE_TARGET")
@file:JvmName("WindowCreationMixin")
@file:Mixin(Window::class)

package com.mizius.control.mixin

import com.mizius.control.BackgroundLaunch
import com.mojang.blaze3d.platform.Window
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.injection.At
import org.spongepowered.asm.mixin.injection.Inject
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable

// The GLFW constructor exists in 26.2. The SDL constructor in 26.3 uses WindowMixin.
@Inject(
    method = ["createGlfwWindow"],
    at = [At(value = "INVOKE", target = "Lorg/lwjgl/glfw/GLFW;glfwCreateWindow(IILjava/lang/CharSequence;JJ)J", remap = false)],
    require = 0
)
private fun `control$backgroundGlfw`(ci: CallbackInfoReturnable<Long>) {
    BackgroundLaunch.configureGlfw()
}
