# Minecraft

Launch an isolated Minecraft client and control it through MCP.

## Components

| Directory | Purpose |
| --- | --- |
| [cli](cli/README.md) | The `@mizius/minecraft` npm package manages offline instances, Java, Fabric, and mod installation. |
| [mod](mod/README.md) | The Fabric client mod runs the gameplay MCP server inside Minecraft. |
| [skills](skills/minecraft/SKILL.md) | The agent skill explains launching, connecting, and controlling the client. The npm package bundles a copy. |

## Start a client

Install Node.js 22 or newer on Windows x64. Download the `.tgz` asset from the [latest GitHub release](https://github.com/miziusLabs/Minecraft/releases/latest), then run these commands from the download directory. Replace the filename with the version you downloaded.

```powershell
npm install --global ./mizius-minecraft-1.0.0.tgz
minecraft launch --json
```

The CLI downloads the required files on first launch. It supports Minecraft 26.2 and 26.3 and uses an offline profile. Authenticated multiplayer servers and Realms require a signed-in account.

Minecraft opens without taking foreground focus by default. Use `--foreground` to request normal focus. Connect your MCP host to the `url` returned by launch. If another client uses the default port 8765, use `--port 18766` or another free port.

## Development

Build or test the mod from its directory. The shell wrapper and build helpers are also inside `mod`.

```powershell
cd mod
.\gradlew.bat build
```

Build and test the CLI from its directory.

```powershell
cd cli
npm ci
npm test
npm pack
```

`npm pack` builds the mod and bundles its JAR, the compiled CLI, compatibility metadata, and the skill. Installing the npm package does not require a repository checkout or Gradle.

## Releases

Pushes to every branch run the Windows CLI tests, mod compatibility builds, and package installation checks through `ci.yml`. When a push to `main` increases the stable version in `cli/package.json`, the same workflow creates a GitHub release tagged `v<version>` and attaches the tested `.tgz` package after all checks pass.

See [the CLI release instructions](cli/README.md#publishing) for version updates and release permissions. Publishing and installing public releases do not require an npm account.
