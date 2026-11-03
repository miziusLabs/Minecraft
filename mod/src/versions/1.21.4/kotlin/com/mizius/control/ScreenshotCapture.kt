package com.mizius.control

import com.mojang.blaze3d.pipeline.RenderTarget
import com.mojang.blaze3d.platform.NativeImage
import net.minecraft.client.Screenshot

internal object ScreenshotCapture {
    fun capture(target: RenderTarget, consumer: (NativeImage) -> Unit) {
        consumer(Screenshot.takeScreenshot(target))
    }
}
