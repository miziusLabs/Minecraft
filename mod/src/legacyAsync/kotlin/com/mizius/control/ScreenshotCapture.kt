package com.mizius.control

import com.mojang.blaze3d.pipeline.RenderTarget
import com.mojang.blaze3d.platform.NativeImage
import net.minecraft.client.Screenshot
import java.util.function.Consumer

internal object ScreenshotCapture {
    fun capture(target: RenderTarget, consumer: (NativeImage) -> Unit) {
        Screenshot.takeScreenshot(target, Consumer { image -> consumer(image) })
    }
}
