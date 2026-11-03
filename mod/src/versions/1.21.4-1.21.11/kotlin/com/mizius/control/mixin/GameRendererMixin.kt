package com.mizius.control.mixin

import com.mizius.control.ControlMod
import net.minecraft.client.DeltaTracker
import net.minecraft.client.renderer.GameRenderer
import org.spongepowered.asm.mixin.Mixin
import org.spongepowered.asm.mixin.injection.At
import org.spongepowered.asm.mixin.injection.Inject
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo

@Mixin(GameRenderer::class)
abstract class GameRendererMixin {
    @Inject(method = ["render"], at = [At("TAIL")])
    private fun `control$frame`(deltaTracker: DeltaTracker, renderLevel: Boolean, ci: CallbackInfo) {
        ControlMod.frame()
    }
}
