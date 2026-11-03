package com.mizius.control

import com.mojang.blaze3d.pipeline.RenderTarget
import net.minecraft.client.Minecraft

internal object RenderTargetAccess {
    fun current(mc: Minecraft): RenderTarget = mc.getMainRenderTarget()
}
