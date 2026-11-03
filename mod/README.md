# Minecraft Control

Minecraft Control is a Fabric client mod for Minecraft Java 1.21.4, 26.2, and 26.3. It receives local commands from the `@mizius/minecraft` CLI and applies them on the Minecraft client thread. Minecraft 1.21.4 uses a Java 21 artifact. Minecraft 26.2 and 26.3 use a Java 25 artifact.

The command endpoint binds to `127.0.0.1` on port 8765 by default. The CLI sets `minecraft.control.port` when it launches the game. Set `MINECRAFT_CONTROL_TOKEN` to require bearer-token authorization. Requests with browser origins and unexpected Host headers are rejected.

The CLI supports state inspection, screenshots, video recording, server joining, keyboard and mouse input, text entry, permitted server commands, and client log searches. Recordings use the game's rendered view and are saved as silent MP4 files under the Minecraft instance's `recordings` directory. See the [CLI guide](../cli/README.md) for command syntax.

## Build

Build the Fabric mod from this directory.

```powershell
.\gradlew.bat assemble
```

The default Minecraft version is 26.3. Build against 26.2 with `-Pminecraft_version=26.2`. Build the 1.21.4 variant with `-Pminecraft_version=1.21.4`.

The CLI package workflow builds separate JARs for 1.21.4 and 26.3. It uses the 26.3 JAR for both 26.2 and 26.3, copies the artifacts into `cli/artifacts`, and updates their checksums in `cli/compatibility.json`.

Production Kotlin sources are in `src/main/kotlin`. Tests are in `src/test/kotlin`. Live gameplay checks require a working graphics driver and Minecraft instance. Multiplayer checks also need an authenticated account and a reachable server.

The 26.x build follows [Fabric's Minecraft 26.3 toolchain guidance](https://www.fabricmc.net/2026/09/15/263.html). The 1.21.4 build uses Loom's remapping plugin and official Mojang mappings.
