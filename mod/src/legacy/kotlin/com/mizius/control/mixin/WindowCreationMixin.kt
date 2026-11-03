@file:Suppress("INAPPLICABLE_TARGET")
@file:JvmName("WindowCreationMixin")
@file:Mixin(Window::class)

package com.mizius.control.mixin

import com.mizius.control.BackgroundLaunch
import com.mojang.blaze3d.platform.Window
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.injection.At
import org.spongepowered.asm.mixin.injection.Inject
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo

@Inject(
    method = ["<init>"],
    at = [At(
        value = "INVOKE",
        target = "Lorg/lwjgl/glfw/GLFW;glfwCreateWindow(IILjava/lang/CharSequence;JJ)J",
        remap = false
    )]
)
private fun `control$backgroundGlfw`(ci: CallbackInfo) {
    BackgroundLaunch.configureGlfw()
}
