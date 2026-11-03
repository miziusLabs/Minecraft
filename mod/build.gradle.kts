plugins {
    id("net.fabricmc.fabric-loom") version "1.17.12" apply false
    id("net.fabricmc.fabric-loom-remap") version "1.17.12" apply false
    kotlin("jvm") version "2.4.20"
}

val minecraftVersion = providers.gradleProperty("minecraft_version").get()
val legacyMinecraft = minecraftVersion == "1.21.4"
apply(plugin = if (legacyMinecraft) "net.fabricmc.fabric-loom-remap" else "net.fabricmc.fabric-loom")

val javaVersion = providers.gradleProperty("java_version").orElse(if (legacyMinecraft) "21" else "25").get().toInt()
val loaderVersion = providers.gradleProperty("fabric_loader_version").orElse(if (legacyMinecraft) "0.16.10" else "0.19.5").get()
val loaderMinimum = providers.gradleProperty("fabric_loader_minimum").orElse(if (legacyMinecraft) "0.16.10" else "0.19.3").get()
val compatibleMinecraftVersions = providers.gradleProperty("fabric_minecraft_versions")
    .orElse(if (legacyMinecraft) minecraftVersion else "26.2,26.3").get()
val mixinClasses = if (legacyMinecraft) {
    listOf("KeyboardAccess", "MouseAccess", "MinecraftMixin", "GameRendererMixin", "InputConstantsMixin", "WindowMixin", "WindowCreationMixin")
} else {
    listOf("KeyboardAccess", "MouseAccess", "MinecraftMixin", "InputConstantsMixin", "WindowMixin", "WindowCreationMixin")
}

version = "1.1.0"
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

if (legacyMinecraft) {
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
    )
    tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileKotlin") {
        setSource(files(
            fileTree("src/main/kotlin") { exclude(replacementSources) },
            fileTree("src/legacy/kotlin"),
        ))
    }
    tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileTestKotlin") {
        setSource(files(
            fileTree("src/test/kotlin") { exclude("com/mizius/control/InputCodesTest.kt") },
            fileTree("src/legacyTest/kotlin"),
        ))
    }
}

tasks.test {
    useJUnitPlatform()
}
