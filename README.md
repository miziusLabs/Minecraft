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

Run `minecraft update` to install the latest stable CLI release. The CLI also checks for updates before starting each new client and resumes the launch after an update.

Use the CLI commands to inspect and control the game.

```powershell
minecraft control screenshot --output .\screen.png
minecraft control record start --json
minecraft control record stop --json
minecraft control key W --action hold
minecraft control key W --action release
minecraft control click 640 360 --button left
```

The default window stays visible without taking foreground focus. Use `--foreground` to give it focus when it starts. The client listens for commands only on loopback.

The mod and CLI package use the shared version in [`project.properties`](project.properties). Update its `version` property to change both versions.

## Remote devices and servers

Run `minecraft host launch` on the Minecraft device with cloudflared installed. Set `TUNNEL` on a controller to the complete URL it prints. Client launches, controls, and server commands then run on the host. Linux controllers need only Node.js and this CLI. Client launching remains Windows x64 only.

`minecraft server launch --version 1.21.4 --no-reset --accept-eula` starts a versioned Paper server after you accept the Minecraft EULA. `--version Paper/26.2`, `Folia/1.21.11`, and `Vanilla/1.21.4` select the software explicitly. `server status`, `server command`, `server restart`, and `server stop` all accept `--version`. Servers preserve their files by default and can run locally on Windows or Linux.

With OpenSSH running on the host, `ssh -o 'ProxyCommand=minecraft host proxy' user@minecraft-host` connects through the same tunnel. SCP, SFTP, remote commands, and SSH forwarding work with the same proxy option and normal SSH authentication.

See the [remote host, server, and SSH setup](cli/README.md#remote-hosts-and-linux-controllers) for prerequisites, secure connection instructions, and file transfer examples.

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

The `release.yml` workflow runs on pushes to `main` and can also run manually on `main`. It compares the stable version in `project.properties` with the latest GitHub release. If the version is newer, or no release exists, it builds and publishes a release tagged `v<version>` with the packaged `minecraft.tgz` attached. Otherwise it skips the build.

See the [CLI release instructions](cli/README.md#publishing) for version updates and release permissions. Publishing and installing public releases do not require an npm account.
