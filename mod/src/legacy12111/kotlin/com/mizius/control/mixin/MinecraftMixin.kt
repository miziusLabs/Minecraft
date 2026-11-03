package com.mizius.control.mixin

import com.mizius.control.ControlMod
import net.minecraft.client.Minecraft
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.injection.At
import org.spongepowered.asm.mixin.injection.Inject
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable

@Mixin(Minecraft::class)
abstract class MinecraftMixin {
    @Inject(method = ["tick"], at = [At("HEAD")])
    private fun `control$tick`(ci: CallbackInfo) { ControlMod.tick() }

    @Inject(method = ["isWindowActive"], at = [At("HEAD")], cancellable = true)
    private fun `control$active`(ci: CallbackInfoReturnable<Boolean>) {
        if (ControlMod.isControlling()) ci.returnValue = true
    }

    @Inject(method = ["close"], at = [At("HEAD")])
    private fun `control$close`(ci: CallbackInfo) { ControlMod.close() }
}
