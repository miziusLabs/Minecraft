# @mizius/minecraft

`@mizius/minecraft` is a Windows x64 command line launcher for an isolated Minecraft Java client with the Minecraft MCP Fabric mod installed. It installs game files into a managed directory, uses the bundled mod for Minecraft 26.2 and 26.3, and exposes the running client on loopback. The default MCP URL is `http://127.0.0.1:8765/mcp`.

## Requirements

- Windows x64.
- Node.js 22 or newer.
- A network connection for the first launch, so the CLI can download Minecraft, Fabric Loader, Java, libraries, and assets.

The CLI starts an offline profile with the requested username. It does not sign in to a Microsoft account. Multiplayer servers and Realms that require authenticated online accounts will reject this profile. Authentication and Realms errors in client logs are expected when connecting to those services. Local single player works without account authentication. The cached client can start without a network connection after its required files have downloaded.

## Install

Download the `.tgz` asset from the [latest GitHub release](https://github.com/miziusLabs/Minecraft/releases/latest). Open a terminal in the download directory and install it globally with npm. Replace the example filename with the version you downloaded. No npm account or GitHub token is required for a public release.

```powershell
npm install --global ./mizius-minecraft-1.0.0.tgz
```

To update, download the new release and repeat the install command with its filename. Previous versions remain on the [releases page](https://github.com/miziusLabs/Minecraft/releases). npm still downloads dependencies from the public npm registry.

List the supported versions.

```powershell
minecraft versions
```

Launch the default version, 26.3.

```powershell
minecraft launch --username Agent
```

Select 26.2 explicitly.

```powershell
minecraft launch 26.2 --username Agent
```

By default, launch keeps the Minecraft window visible without taking focus. It does not minimize the window. Add `--foreground` when you want Minecraft to take focus at startup.

`launch`, `status`, and `stop` print JSON results. Add `--json` for compact output. The CLI waits for the MCP server at the selected port before reporting the client as ready. The result includes a `url` field. Configure the MCP host with that URL. `status --json` reports the same URL while the client runs.

The default port is 8765. If another client already uses it, leave that client running and choose another free port with `--port`.

```powershell
minecraft launch --username Agent --port 18766
```

The CLI reserves loopback TCP port 18765 while it installs, starts, or stops a client to serialize lifecycle operations across managed directories. Keep that port free. Do not use it as the MCP port. If launch reports a conflict on the selected MCP port, choose another free port and retry.

## Managed files

By default, the CLI keeps downloaded files, per-version instances, logs, and process state under `%LOCALAPPDATA%\mizius\Minecraft`. Set `mizius_minecraft_home` to use a different root. Each Minecraft version gets a separate instance directory.

The CLI creates settings only when an instance has no `options.txt`. It opens a 1280 by 720 window with GUI scale 2 and FOV 90. Sprint uses R. Master volume is muted, and pause on focus loss is disabled. The CLI leaves existing `options.txt` files in place.

Graphics use the Custom preset, with clouds, ambient occlusion, and entity shadows off. Render distance is 8 chunks, simulation distance is 5 chunks, and the frame rate is capped at 60 FPS. Java uses a 4 GB maximum heap.

## MCP connection

After the CLI reports that the client is ready, configure your MCP host with the `url` returned by `minecraft launch` or `minecraft status`.

```json
{
  "mcpServers": {
    "minecraft": {
      "type": "http",
      "url": "http://127.0.0.1:8765/mcp"
    }
  }
}
```

The example uses the default port. Replace it with the returned URL when you pass `--port`. The host connects to the existing Minecraft process. It does not launch or own the game process. Use `minecraft status` to inspect it and `minecraft stop` to stop the managed process. Stop the managed client before switching versions.

The MCP endpoint controls one client and one shared set of held inputs. Connect one agent at a time. Release held keys and mouse buttons when an action ends. The mod also releases stale inputs after 30 seconds without game tool calls. Check `get_state` or take a screenshot after connecting, joining a server, or changing screens before sending more input.

The bundled skill describes this launch and control workflow. `minecraft skill path` prints the directory containing `SKILL.md`. Copy it into another skill directory with `minecraft skill install --dir <directory>`.

## Development

From the `cli` directory, install dependencies and compile the TypeScript.

```powershell
npm install
npm run build
```

The CLI sources and tests live in this directory. The Fabric mod and its Gradle wrapper live in `../mod`. The skill source lives in `../skills/minecraft/SKILL.md`. `npm run build` compiles the CLI and copies that skill into the package staging directory `skills/minecraft`.

`npm pack` builds the CLI and the Gradle project in `../mod`, copies the production mod JAR into `artifacts/minecraft-mcp.jar`, and updates its SHA-256 field in `compatibility.json`. The package includes the compiled CLI, bundled mod, compatibility manifest, README, and skill. It has no `preinstall`, `install`, or `prepare` hook. Installing the package does not download Minecraft or start the game.

Run the CLI tests with `npm test`.

## Publishing

The `release.yml` workflow runs on pushes to `main` and supports manual runs on `main` through GitHub Actions. It compares `cli/package.json` with the latest published GitHub release. A newer stable version triggers a build. If there is no release yet, it publishes the first stable version. Equal versions, older versions, and prerelease versions skip the build. Release lookup errors fail the workflow.

From the `cli` directory, update both version files without creating a local Git tag.

```powershell
npm version patch --no-git-tag-version
```

Use `minor` or `major` instead of `patch` when appropriate. Commit `package.json` and `package-lock.json`, then merge into `main`.

When a release is needed, the workflow runs the Windows CLI tests, packages the CLI, and checks installation. There are no separate mod compatibility jobs. Packaging still builds the mod JAR that the CLI bundles. After they pass, it creates the tag `v<version>` at the tested commit and attaches the tested `mizius-minecraft-<version>.tgz` archive without rebuilding it. GitHub generates the release notes. Existing release tags must not be reused.

Publishing uses the workflow's built-in `GITHUB_TOKEN` with `contents: write`. The repository must allow that permission and tag creation. No `NPM_TOKEN`, npm trusted publisher, or additional secret is needed. The old npm publishing workflow has been removed. Use a public repository so users can download release assets without authentication.
