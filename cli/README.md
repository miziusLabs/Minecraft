# @mizius/minecraft

`@mizius/minecraft` is a command line tool for launching and controlling an isolated Minecraft Java client. It installs Minecraft, Fabric Loader, Java, and the bundled control mod into a managed directory. The CLI sends commands to the running game over loopback.

## Requirements

- Windows x64 for local client launches. Linux and macOS can control a remote host; servers can also run on Linux.
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

The bundled mod supports every stable Minecraft Java release from 1.21.4 through 26.3. This includes 1.21.4 through 1.21.11 and 26.1, 26.1.1, 26.1.2, 26.2, and 26.3. The CLI accepts only versions listed by `minecraft versions`.

Launch Minecraft 1.21.4 explicitly.

```powershell
minecraft launch 1.21.4 --username Agent
```

## Control the game

Run a CLI command after launch. Every command returns JSON, and `--json` prints compact JSON for agent use.

```powershell
minecraft control state --json
minecraft control screenshot --output .\screen.png
minecraft control record start --json
minecraft control record stop --json
minecraft control join localhost:25565
minecraft control click 640 360 --button left
minecraft control key W --action hold
minecraft control key W --action release
minecraft control type "hello"
minecraft control logs warn --limit 20
minecraft control batch '[{"command":"key","arguments":{"key":"W","action":"hold"},"delay_ms":1000},{"command":"key","arguments":{"key":"W","action":"release"}]'
```

`minecraft control state` reports the current screen, connection, window dimensions, held inputs, player position, and recording state. `minecraft control screenshot` saves a PNG in the current directory. By default it uses a timestamped filename. Use `--output` to select a path.

`minecraft control record start` begins a silent MP4 recording of the game view. It records at 10 FPS by default, accepts `--fps` from 1 to 20, and scales output to fit within 1280 by 720 pixels. `minecraft control record stop` finalizes the recording. Both commands return the file path as JSON. Recordings are saved in the current Minecraft instance's `recordings` directory and stop automatically after ten minutes. If encoding falls behind, the recorder drops frames and the video plays shorter than the elapsed recording time. The stop response reports `dropped_frames`, the video's `duration_ms`, and wall-clock `elapsed_ms`.

`minecraft stop` finalizes an active recording before closing the client.

Coordinates use screenshot pixels with the origin at the top left. `minecraft control click` accepts `left`, `right`, or `middle`. Keys accept GLFW names such as `W`, `LEFT_SHIFT`, `ENTER`, and `ESCAPE`, or a numeric GLFW code. A key press releases after a short tap. Use `--action hold` and `--action release` for sustained movement. Held keys and buttons expire after 30 seconds without a game command.

Use `minecraft control execute <command>` only when the connected server grants the required permission. Use `minecraft control logs [query]` to read recent client log lines. A query matches a case-insensitive literal substring. `minecraft control batch` accepts a JSON array of commands and runs them in order without interleaving other controls. Recording commands cannot be included in a batch.

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

`npm pack` builds the CLI and the Gradle project in `../mod`. It creates one mod JAR for each supported Minecraft version, then updates their SHA-256 values in `compatibility.json`. Minecraft 1.21.x uses Java 21. Minecraft 26.x uses Java 25. The package includes the compiled CLI, all 13 mod JARs, the compatibility manifest, README, and skill. It has no `preinstall`, `install`, or `prepare` hook. Installing the package does not download Minecraft or start the game. The CLI checks for updates only when `minecraft update` or `minecraft launch` runs.

Run the CLI test suite with `npm test`.

## Publishing

The `release.yml` workflow runs on pushes to `main` and supports manual runs on `main` through GitHub Actions. It compares the version in the repository's `project.properties` file with the latest published GitHub release. A newer stable version triggers a build. If there is no release yet, it publishes the first stable version. Equal versions, older versions, and prerelease versions skip the build. Release lookup errors fail the workflow.

Update the `version` property in `../project.properties`. Sync the CLI package metadata before installing dependencies. The build command also syncs it automatically.

```powershell
node scripts/sync-version.mjs
npm ci
```

Commit `project.properties`, `package.json`, and `package-lock.json`, then merge into `main`.

When a release is needed, the workflow runs the Windows CLI tests, packages the CLI, and checks installation. Packaging builds the mod JAR that the CLI bundles. After checks pass, it creates the tag `v<version>` at the tested commit and attaches the tested `minecraft.tgz` archive without rebuilding it. Release notes list merged pull request titles under `## Changes`. When GitHub has no merged pull request notes, they list commit subjects since the previous release tag. They omit contributor names and URLs. Existing release tags must not be reused.

Publishing uses the workflow's built-in `GITHUB_TOKEN` with `contents: write`. The repository must allow that permission and tag creation. The public repository lets users download release assets without authentication.

## Remote hosts and Linux controllers

Install the CLI on both devices. Only the host that launches Minecraft clients needs Windows x64. Controllers can run Linux, Windows, or macOS with Node.js 22 or newer. Linux controllers do not need Java, a display, or Minecraft. Without `TUNNEL`, existing client commands still run locally.

On the host, install [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) and add it to `PATH`, then run the host in a terminal that stays open.

```powershell
minecraft host launch
```

The command prints `TUNNEL=https://<random-name>.trycloudflare.com/#<token>`. Copy the entire URL, including the fragment, to the controller. Treat it as a password. It grants control of clients and servers and access to the SSH transport. Commands authenticate with a bearer header, not a token in the request URL. The host's command listener binds only to loopback.

On a Linux controller, use the URL printed by the host.

```sh
export TUNNEL='https://<random-name>.trycloudflare.com/#<token>'
minecraft launch 1.21.4 --username Agent --json
minecraft status --json
minecraft control state --json
minecraft control screenshot --output ./screen.png
minecraft control join localhost:25565
minecraft stop --json
```

In PowerShell, set `$env:TUNNEL = 'https://<random-name>.trycloudflare.com/#<token>'`. Client and server processes run on the host, even when a controller launches them. Server addresses such as `localhost` refer to the host. Screenshots save on the controller; recordings and game files stay on the host and can be retrieved with SCP or SFTP. `--foreground` is local-only. `skill`, `update`, and `host` manage the device where the CLI runs rather than going through `TUNNEL`.

Keep `minecraft host launch` running for remote access. Ctrl+C closes the tunnel and active SSH transports but does not stop detached Minecraft clients or servers. Starting another host session creates a new URL and token. Cloudflare Quick Tunnels are temporary and have no availability guarantee. Both devices need access to Cloudflare. For a loopback-only host without cloudflared, use `minecraft host launch --local`. This is useful for local integration tests or an independently secured HTTPS reverse proxy that supports WebSockets. Non-loopback `TUNNEL` URLs must use HTTPS.

## Servers

Servers can run on Windows or Linux. Install the Java version required by the Minecraft version. The CLI checks it before launch. Set `JAVA_21_HOME`, `JAVA_25_HOME`, `JAVA_HOME`, or `MINECRAFT_JAVA` to select Java. Version-specific `JDK_<major>_HOME`, `JAVA<major>_HOME`, and `JDK<major>_HOME` names also work. The server uses a 1 GB maximum heap. In remote mode these variables belong on the host. The server runs Paper by default, separate from the managed client.

Read the [Minecraft EULA](https://aka.ms/MinecraftEULA) before accepting it. Pass `--accept-eula` once, or put `eula=true` in the version's `eula.txt` yourself.

```sh
minecraft server launch --version 1.21.4 --no-reset --accept-eula
minecraft server status --version 1.21.4 --json
minecraft server command 'say Hello from the CLI' --version 1.21.4
minecraft server restart --version 1.21.4 --no-reset
minecraft server stop --version 1.21.4
```

Each software and version pair has its own `servers/<Paper|Folia|Vanilla>/<version>` folder under the managed directory. `--no-reset` preserves worlds, configuration, plugins, and other existing files. Preservation is also the default. `--reset` explicitly deletes that version's folder before preparing a fresh server. It cannot be combined with `--no-reset`. A launch refuses to replace a running server; use `restart` to stop it first. Downloads use the publisher's checksums. Servers keep running after the launching CLI exits. `status` distinguishes a live process from a server that has logged its readiness message. Console commands require readiness and acknowledge delivery; inspect `console.log` or the server's `logs/latest.log` for their output. Stop waits for startup to finish before sending a console stop command. If shutdown does not complete within two minutes, the manager force-stops Java and reports `forced: true`.

Use the same software/version syntax as the standalone server script. Plain versions select Paper. Software names are case-insensitive, and `-v` is an alias for `--version`.

```sh
minecraft server launch --version Paper/26.2 --no-reset --accept-eula --port 25568
minecraft server launch --version Folia/1.21.11 --no-reset --accept-eula --port 25569
minecraft server restart --version Folia/1.21.11 --no-reset
minecraft server launch --version Vanilla/1.21.4 --no-reset --accept-eula
```

You can also use `--version 1.21.4 --software paper`, `--software folia`, or `--software vanilla`. Use the same selection for status, console commands, stop, and restart. Paper and Folia support their respective plugin APIs. The CLI creates a `plugins` folder for either. It does not build or copy a particular project's plugin automatically. Upload the built plugin over SSH, then restart the server. Folia requires plugins that explicitly support its threaded server model.

The CLI pins the downloaded Paper or Folia build for each software/version pair. Ordinary restarts do not upgrade the jar. Only use versions available from the selected publisher. Minecraft and server software still apply their own world and configuration migrations.

Servers default to port 25565. Use `--port` or edit each version's `server.properties` to run different versions at the same time. Ports 18765 and 18766 are reserved for CLI operation locks. Server gameplay ports are not exposed by the command tunnel. A client running on the same host can join `localhost:<port>`. For a client on another device, use the host's network address or SSH port forwarding.

The managed directory defaults to `%LOCALAPPDATA%\mizius\Minecraft` on Windows and `~/.mizius/minecraft` on Linux. Set `mizius_minecraft_home` on the host to change it. The launch and status output report the actual server directory and log path.

## SSH, SCP, and SFTP through the tunnel

Run an OpenSSH server on the host with normal user authentication. The CLI forwards SSH bytes to `127.0.0.1:22` through an authenticated WebSocket on the same tunnel. It does not create accounts, manage keys, disable host-key checking, or bypass SSH authentication. Use `minecraft host launch --ssh-port 2222` if the host's SSH service uses another port. No public SSH port or router port forwarding is required.

For a Windows host, install and start the optional OpenSSH Server component from an administrator PowerShell session, then configure your account's authorized keys according to the [Windows OpenSSH instructions](https://learn.microsoft.com/windows-server/administration/openssh/openssh_install_firstuse). Prefer key authentication. Use a normal host account with access to the managed directory. On Linux, install and start the distribution's OpenSSH server.

With `TUNNEL` set on the controller and `minecraft` on its `PATH`, use normal SSH tools.

```sh
ssh -o 'ProxyCommand=minecraft host proxy' user@minecraft-host
scp -o 'ProxyCommand=minecraft host proxy' ./plugin.jar user@minecraft-host:/path/to/servers/Paper/1.21.4/plugins/
scp -o 'ProxyCommand=minecraft host proxy' user@minecraft-host:/path/to/servers/Paper/1.21.4/logs/latest.log ./latest.log
sftp -o 'ProxyCommand=minecraft host proxy' user@minecraft-host
ssh -o 'ProxyCommand=minecraft host proxy' -L 25565:localhost:25565 user@minecraft-host
```

Replace `user` and the file paths with the host's real values. `minecraft-host` is a stable SSH host-key alias; choose a different alias for each host. SSH authenticates the host and user as usual. Keep host-key checking enabled. Remote paths use the SSH server's path syntax, which may differ on Windows. SSH shells, remote commands, uploads, downloads, and standard TCP forwarding all use the same transport. Restart a plugin server after uploading a plugin.
