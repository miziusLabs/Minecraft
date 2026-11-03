import java.util.Properties

plugins {
    id("net.fabricmc.fabric-loom") version "1.17.12" apply false
    id("net.fabricmc.fabric-loom-remap") version "1.17.12" apply false
    kotlin("jvm") version "2.4.20"
}

val minecraftVersion = providers.gradleProperty("minecraft_version").get()
val legacyMinecraft = minecraftVersion.startsWith("1.21.")
val legacyScreenshotCallback = legacyMinecraft && minecraftVersion != "1.21.4"
val legacyMinecraftApi = minecraftVersion in setOf("1.21.6", "1.21.7", "1.21.8")
val recordInputMinecraft = minecraftVersion in setOf("1.21.9", "1.21.10", "1.21.11", "26.1", "26.1.1", "26.1.2")
val legacyGameRendererMixin = if (legacyMinecraft) {
    fileTree("src/versions/1.21.4-1.21.11/kotlin") {
        include("com/mizius/control/mixin/GameRendererMixin.kt")
    }
} else {
    files()
}
apply(plugin = if (legacyMinecraft) "net.fabricmc.fabric-loom-remap" else "net.fabricmc.fabric-loom")

val javaVersion = providers.gradleProperty("java_version").orElse(if (legacyMinecraft) "21" else "25").get().toInt()
val loaderVersion = providers.gradleProperty("fabric_loader_version").orElse("0.20.1").get()
val loaderMinimum = providers.gradleProperty("fabric_loader_minimum").orElse("0.20.1").get()
val compatibleMinecraftVersions = providers.gradleProperty("fabric_minecraft_versions")
    .orElse(minecraftVersion).get()
val mixinClasses = when {
    recordInputMinecraft && minecraftVersion.startsWith("1.21.") -> listOf("KeyboardAccess", "MouseAccess", "MinecraftMixin", "GameRendererMixin", "InputConstantsMixin", "WindowMixin", "WindowCreationMixin")
    recordInputMinecraft -> listOf("KeyboardAccess", "MouseAccess", "MinecraftMixin", "InputConstantsMixin", "WindowMixin", "WindowCreationMixin")
    legacyMinecraft -> listOf("KeyboardAccess", "MouseAccess", "MinecraftMixin", "GameRendererMixin", "InputConstantsMixin", "WindowMixin", "WindowCreationMixin")
    else -> listOf("KeyboardAccess", "MouseAccess", "MinecraftMixin", "InputConstantsMixin", "WindowMixin", "WindowCreationMixin")
}

val projectProperties = Properties().apply {
    rootProject.file("../project.properties").inputStream().use { load(it) }
}
version = requireNotNull(projectProperties.getProperty("version")) {
    "Missing version in ../project.properties"
}
group = "com.mizius"

base {
    archivesName.set("minecraft-control")
}

dependencies {
    add("minecraft", "com.mojang:minecraft:$minecraftVersion")
    if (legacyMinecraft) {
        val loomExtension = project.extensions.getByName("loom")
        val officialMappings = loomExtension.javaClass.methods
            .single { it.name == "officialMojangMappings" && it.parameterCount == 0 }
            .invoke(loomExtension)
        add("mappings", officialMappings)
        add("modImplementation", "net.fabricmc:fabric-loader:$loaderVersion")
    } else {
        implementation("net.fabricmc:fabric-loader:$loaderVersion")
    }
    implementation(kotlin("stdlib"))
    add("include", kotlin("stdlib", "2.4.20"))
    implementation("org.jcodec:jcodec:0.2.5")
    add("include", "org.jcodec:jcodec:0.2.5")
    implementation("org.jcodec:jcodec-javase:0.2.5")
    add("include", "org.jcodec:jcodec-javase:0.2.5")
    testImplementation("org.junit.jupiter:junit-jupiter:5.13.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

val modVersion = version.toString()

tasks.processResources {
    inputs.property("version", modVersion)
    inputs.property("minecraft_versions", compatibleMinecraftVersions)
    inputs.property("loader_minimum", loaderMinimum)
    inputs.property("java_version", javaVersion)
    inputs.property("mixin_classes", mixinClasses)
    filesMatching("fabric.mod.json") {
        expand(
            "version" to modVersion,
            "minecraft_versions" to compatibleMinecraftVersions.split(',').joinToString("\", \"") { it.trim() },
            "loader_minimum" to loaderMinimum,
            "java_version" to javaVersion,
            "mixin_classes" to mixinClasses.joinToString("\", \""),
        )
    }
    inputs.property("mixin_java_version", javaVersion)
    filesMatching("minecraft-control.mixins.json") {
        expand("java_version" to javaVersion, "mixin_classes" to mixinClasses.joinToString("\", \""))
    }
}

java {
    sourceCompatibility = JavaVersion.toVersion(javaVersion)
    targetCompatibility = JavaVersion.toVersion(javaVersion)
    withSourcesJar()
}

kotlin {
    jvmToolchain(25)
}

tasks.withType<JavaCompile>().configureEach {
    options.release.set(javaVersion)
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    compilerOptions.jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.fromTarget(javaVersion.toString()))
}

if (recordInputMinecraft) {
    val recordInputReplacements = mutableListOf(
        "com/mizius/control/ClientScreenAccess.kt",
        "com/mizius/control/RenderTargetAccess.kt",
    )
    if (minecraftVersion.startsWith("1.21.")) {
        recordInputReplacements += listOf(
            "com/mizius/control/mixin/WindowMixin.kt",
            "com/mizius/control/mixin/MouseAccess.kt",
            "com/mizius/control/mixin/MinecraftMixin.kt",
            "com/mizius/control/mixin/InputConstantsMixin.kt",
            "com/mizius/control/mixin/WindowCreationMixin.kt",
            "com/mizius/control/InputCodes.kt",
            "com/mizius/control/MouseMovement.kt",
            "com/mizius/control/ClientInputEventAccess.kt",
            "com/mizius/control/WindowFocusAccess.kt",
        )
    }
    val recordInputApiSources = fileTree(
        if (minecraftVersion.startsWith("26.1")) {
            "src/versions/26.1-26.1.2/kotlin"
        } else {
            "src/versions/1.21.9-1.21.11/kotlin"
        }
    )
    tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileKotlin") {
        setSource(files(
            fileTree("src/main/kotlin") { exclude(recordInputReplacements) },
            legacyGameRendererMixin,
            recordInputApiSources,
        ))
    }
} else if (legacyMinecraft) {
    val replacementSources = listOf(
        "com/mizius/control/ClientControl.kt",
        "com/mizius/control/InputCodes.kt",
        "com/mizius/control/RecordingManager.kt",
        "com/mizius/control/mixin/KeyboardAccess.kt",
        "com/mizius/control/mixin/MouseAccess.kt",
        "com/mizius/control/mixin/MinecraftMixin.kt",
        "com/mizius/control/mixin/InputConstantsMixin.kt",
        "com/mizius/control/mixin/WindowMixin.kt",
        "com/mizius/control/mixin/WindowCreationMixin.kt",
        "com/mizius/control/MouseMovement.kt",
        "com/mizius/control/ClientInputEventAccess.kt",
        "com/mizius/control/ClientScreenAccess.kt",
        "com/mizius/control/RenderTargetAccess.kt",
        "com/mizius/control/WindowFocusAccess.kt",
    )
    val legacySources = fileTree("src/versions/1.21.4-1.21.8/kotlin")
    val legacyScreenshotSources = fileTree(
        if (legacyScreenshotCallback) {
            "src/versions/1.21.5-1.21.8/kotlin"
        } else {
            "src/versions/1.21.4/kotlin"
        }
    )
    val legacyApiSources = fileTree(
        if (legacyMinecraftApi) {
            "src/versions/1.21.6-1.21.8/kotlin"
        } else {
            "src/versions/1.21.4-1.21.5/kotlin"
        }
    )
    tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileKotlin") {
        setSource(files(
            fileTree("src/main/kotlin") { exclude(replacementSources) },
            legacySources,
            legacyGameRendererMixin,
            legacyScreenshotSources,
            legacyApiSources,
        ))
    }
    tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
        setSource(files(
            fileTree("src/test/kotlin") { exclude("com/mizius/control/InputCodesTest.kt") },
            fileTree("src/versions/1.21.4-1.21.8/test/kotlin"),
        ))
    }
}

tasks.test {
    useJUnitPlatform()
}
