# Minecraft Control

Minecraft Control is a Fabric client mod for every stable Minecraft Java release from 1.21.4 through 26.3. It receives local commands from the `@mizius/minecraft` CLI and applies them on the Minecraft client thread. Minecraft 1.21.4 through 1.21.11 use Java 21 artifacts. Minecraft 26.1 through 26.3, including 26.1.1 and 26.1.2, use Java 25 artifacts.

The command endpoint binds to `127.0.0.1` on port 8765 by default. The CLI sets `minecraft.control.port` when it launches the game. Set `MINECRAFT_CONTROL_TOKEN` to require bearer-token authorization. Requests with browser origins and unexpected Host headers are rejected.

The CLI supports state inspection, screenshots, video recording, server joining, keyboard and mouse input, text entry, permitted server commands, and client log searches. Recordings use the game's rendered view and are saved as silent MP4 files under the Minecraft instance's `recordings` directory. See the [CLI guide](../cli/README.md) for command syntax.

## Build

Build the Fabric mod from this directory.

```powershell
.\gradlew.bat assemble
```

The default Minecraft version is 26.3. Set `-Pminecraft_version` to any supported release to build its version-specific JAR. For example, build against 26.1.2 with `-Pminecraft_version=26.1.2` or build against 1.21.11 with `-Pminecraft_version=1.21.11`.

The mod version comes from the repository root's `project.properties` file, shared with the CLI package version.

The CLI package workflow builds one JAR for each of the 13 supported releases, copies them into `cli/artifacts`, and updates their checksums in `cli/compatibility.json`.

Shared Kotlin sources are in `src/main/kotlin`. Version-specific replacements are in `src/versions/<version-range>/kotlin`, with folder names showing the Minecraft versions they cover. Gradle combines the applicable folders for each target. A 1.21.7 build uses the 1.21.4 through 1.21.8 base sources, the 1.21.5 through 1.21.8 screenshot adapter, the 1.21.6 through 1.21.8 API adapter, and the 1.21.4 through 1.21.11 game renderer mixin. Tests are in `src/test/kotlin`; the legacy input-code test is under `src/versions/1.21.4-1.21.8/test/kotlin`. Live gameplay checks require a working graphics driver and Minecraft instance. Multiplayer checks also need an authenticated account and a reachable server.

The 26.x builds use Loom without remapping because Minecraft removed obfuscation in 26.1. The 1.21.x builds use Loom's remapping plugin and official Mojang mappings.
