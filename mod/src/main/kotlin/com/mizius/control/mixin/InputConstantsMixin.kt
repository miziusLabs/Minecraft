// Emit a class annotation on the file facade so the static mixin has no singleton fields.
@file:Suppress("INAPPLICABLE_TARGET")
@file:JvmName("InputConstantsMixin")
@file:Mixin(InputConstants::class)

package com.mizius.control.mixin

import com.mizius.control.ControlMod
import com.mojang.blaze3d.platform.InputConstants
import com.mojang.blaze3d.platform.Window
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.injection.At
import org.spongepowered.asm.mixin.injection.Inject
import org.spongepowered.asm.mixin.injection.Group
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable

@Group(name = "controlKeyDown", min = 1, max = 1)
@Inject(method = ["isKeyDown(Lcom/mojang/blaze3d/platform/Window;I)Z"], at = [At("HEAD")], cancellable = true, require = 0)
private fun `control$keyDownGlfw`(window: Window, key: Int, ci: CallbackInfoReturnable<Boolean>) {
    if (ControlMod.isHeld(key)) ci.returnValue = true
}

@Group(name = "controlKeyDown", min = 1, max = 1)
@Inject(method = ["isKeyDown(I)Z"], at = [At("HEAD")], cancellable = true, require = 0)
private fun `control$keyDownSdl`(key: Int, ci: CallbackInfoReturnable<Boolean>) {
    if (ControlMod.isHeld(key)) ci.returnValue = true
}
