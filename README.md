# Minecraft

Launch and control an isolated Minecraft Java client from the command line.

## Components

| Directory | Purpose |
| --- | --- |
| [cli](cli/README.md) | The `@mizius/minecraft` package installs and controls managed game instances. |
| [mod](mod/README.md) | The Fabric client mod receives local commands and performs game actions. |
| [skills](skills/minecraft/SKILL.md) | The agent skill explains the CLI workflow. The package bundles a copy. |

## Start and control a client

Install Node.js 22 or newer on Windows x64. Download `minecraft.tgz` from the [latest GitHub release](https://github.com/miziusLabs/Minecraft/releases/latest), then install it from the download directory.

```powershell
npm install --global ./minecraft.tgz
minecraft launch --json
minecraft control state --json
```

The first launch downloads the required game files. The client uses an offline profile. Authenticated multiplayer servers and Realms require a signed-in account.

Use the CLI commands to inspect and control the game.

```powershell
minecraft control screenshot --output .\screen.png
minecraft control key W --action hold
minecraft control key W --action release
minecraft control click 640 360 --button left
```

The default window stays visible without taking foreground focus. Use `--foreground` to give it focus when it starts. The client listens for commands only on loopback.

## Development

Build the mod from its directory.

```powershell
cd mod
.\gradlew.bat assemble
```

Build the CLI from its directory.

```powershell
cd cli
npm ci
npm run build
```

`npm pack` builds the CLI and mod, bundles the compiled mod, compatibility metadata, and skill, then creates the package archive.

## Releases

The `release.yml` workflow runs on pushes to `main` and can also run manually on `main`. It compares the stable version in `cli/package.json` with the latest GitHub release. If the version is newer, or no release exists, it builds and publishes a release tagged `v<version>` with the packaged `minecraft.tgz` attached. Otherwise it skips the build.

See the [CLI release instructions](cli/README.md#publishing) for version updates and release permissions. Publishing and installing public releases do not require an npm account.
