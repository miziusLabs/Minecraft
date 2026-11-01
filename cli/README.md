# @mizius/minecraft

`@mizius/minecraft` is a Windows x64 command line tool for launching and controlling an isolated Minecraft Java client. It installs Minecraft, Fabric Loader, Java, and the bundled control mod into a managed directory. The CLI sends commands to the running game over loopback.

## Requirements

- Windows x64.
- Node.js 22 or newer.
- A network connection on first launch to download Minecraft, Fabric Loader, Java, libraries, and assets.

The CLI starts an offline profile. It does not sign in to a Microsoft account. Multiplayer servers and Realms that require an authenticated account will reject this profile. Local single player works without account authentication. The cached client can start without a network connection after its required files have downloaded. Each new `minecraft launch` checks GitHub for a CLI update for up to five seconds. If GitHub is unavailable, launch continues with the installed version.

## Install

Download `minecraft.tgz` from the [latest GitHub release](https://github.com/miziusLabs/Minecraft/releases/latest). Open a terminal in the download directory and install the package globally with npm.

```powershell
npm install --global ./minecraft.tgz
```

Run `minecraft update` to install the latest stable CLI release now. The CLI also installs new releases automatically before starting a new Minecraft client, then resumes the launch command. Automatic update failures leave the installed CLI in place and do not block a launch. No npm account or GitHub token is required for a public GitHub release.

```powershell
minecraft update
minecraft update --json
```

The update command reports the previous and installed package versions and whether it installed an update. Self-updates require the global npm installation shown above.

List supported versions and the current default.

```powershell
minecraft versions --json
```

Launch the default version, 26.3.

```powershell
minecraft launch --username Agent --json
```

Select 26.2 explicitly.

```powershell
minecraft launch 26.2 --username Agent
```

The launch command waits for the local command endpoint and returns the client process, instance directory, log path, and port. Use `minecraft status --json` to inspect the running client. Use `minecraft stop` to stop it before switching versions.

## Control the game

Run a CLI command after launch. Every command returns JSON, and `--json` prints compact JSON for agent use.

```powershell
minecraft control state --json
minecraft control screenshot --output .\screen.png
minecraft control join localhost:25565
minecraft control click 640 360 --button left
minecraft control key W --action hold
minecraft control key W --action release
minecraft control type "hello"
minecraft control logs warn --limit 20
minecraft control batch '[{"command":"key","arguments":{"key":"W","action":"hold"},"delay_ms":1000},{"command":"key","arguments":{"key":"W","action":"release"}]'
```

`minecraft control state` reports the current screen, connection, window dimensions, held inputs, and player position. `minecraft control screenshot` saves a PNG in the current directory. By default it uses a timestamped filename. Use `--output` to select a path.

Coordinates use screenshot pixels with the origin at the top left. `minecraft control click` accepts `left`, `right`, or `middle`. Keys accept GLFW names such as `W`, `LEFT_SHIFT`, `ENTER`, and `ESCAPE`, or a numeric GLFW code. A key press releases after a short tap. Use `--action hold` and `--action release` for sustained movement. Held keys and buttons expire after 30 seconds without a game command.

Use `minecraft control execute <command>` only when the connected server grants the required permission. Use `minecraft control logs [query]` to read recent client log lines. A query matches a case-insensitive literal substring. `minecraft control batch` accepts a JSON array of commands and runs them in order without interleaving other controls.

Run `minecraft --help` for all commands and options. Agents call these commands through their shell without a separate host configuration.

## Managed files and settings

By default, the CLI stores downloaded files, per-version instances, logs, and process state under `%LOCALAPPDATA%\mizius\Minecraft`. Set `mizius_minecraft_home` to use a different root. Each Minecraft version gets a separate instance directory.

The CLI creates settings only when an instance has no `options.txt`. It opens a 1280 by 720 window with GUI scale 2 and FOV 90. Sprint uses R. Master volume is muted, and pause on focus loss is disabled. The CLI leaves existing `options.txt` files in place.

Graphics use the Custom preset, with clouds, ambient occlusion, and entity shadows off. Render distance is 8 chunks, simulation distance is 5 chunks, and the frame rate is capped at 60 FPS. Java uses a 4 GB maximum heap.

The default command port is 8765. If another program uses it, leave that program running and choose a free port with `--port`.

```powershell
minecraft launch --username Agent --port 18766
```

The CLI reserves loopback TCP port 18765 while it installs, starts, or stops a client to serialize lifecycle operations across managed directories. Keep that port free. Do not use it as the command port.

Set `MINECRAFT_CONTROL_TOKEN` in the environment to require bearer-token authorization on the local command endpoint. The CLI sends the token automatically.

## Development

From the `cli` directory, install dependencies and compile the TypeScript.

```powershell
npm install
npm run build
```

The CLI sources and tests live here. The Fabric mod and its Gradle wrapper live in `../mod`. The agent skill source lives in `../skills/minecraft/SKILL.md`. `npm run build` compiles the CLI and copies the skill into the package staging directory `skills/minecraft`.

`npm pack` builds the CLI and the Gradle project in `../mod`, copies the production mod JAR into `artifacts/minecraft-control.jar`, and updates its SHA-256 field in `compatibility.json`. The package includes the compiled CLI, bundled mod, compatibility manifest, README, and skill. It has no `preinstall`, `install`, or `prepare` hook. Installing the package does not download Minecraft or start the game. The CLI checks for updates only when `minecraft update` or `minecraft launch` runs.

Run the CLI test suite with `npm test`.

## Publishing

The `release.yml` workflow runs on pushes to `main` and supports manual runs on `main` through GitHub Actions. It compares `cli/package.json` with the latest published GitHub release. A newer stable version triggers a build. If there is no release yet, it publishes the first stable version. Equal versions, older versions, and prerelease versions skip the build. Release lookup errors fail the workflow.

From the `cli` directory, update both version files without creating a local Git tag.

```powershell
npm version patch --no-git-tag-version
```

Use `minor` or `major` instead of `patch` when appropriate. Commit `package.json` and `package-lock.json`, then merge into `main`.

When a release is needed, the workflow runs the Windows CLI tests, packages the CLI, and checks installation. Packaging builds the mod JAR that the CLI bundles. After checks pass, it creates the tag `v<version>` at the tested commit and attaches the tested `minecraft.tgz` archive without rebuilding it. Release notes list merged pull request titles under `## Changes`. When GitHub has no merged pull request notes, they list commit subjects since the previous release tag. They omit contributor names and URLs. Existing release tags must not be reused.

Publishing uses the workflow's built-in `GITHUB_TOKEN` with `contents: write`. The repository must allow that permission and tag creation. The public repository lets users download release assets without authentication.
