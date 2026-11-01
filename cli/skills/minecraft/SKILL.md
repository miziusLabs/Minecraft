---
name: minecraft
description: Launch and control a managed Minecraft Java client through the local Minecraft MCP server.
---

# Minecraft MCP

Use this skill when the user wants to launch the managed Minecraft client or interact with its running game through MCP.

## Launch and connect

1. Run `minecraft versions` to see supported versions and the current default. Use the reported default unless the user requests another compatible version.
2. Launch the requested version with `minecraft launch [version] --username Agent --json`. Use a valid Minecraft offline username. By default, the command keeps the game window visible without taking focus or minimizing it. Add `--foreground` only when the user wants the window to take focus. The command waits for the MCP endpoint to become ready. Read the returned `url` field.
3. If launch reports that another managed client is already running, inspect it with `minecraft status --json`. Reuse the returned URL when it is the client the user wants. Run `minecraft stop --json` before switching managed versions.
4. If launch reports that the default port is occupied by another client, leave that client running and retry with `--port 18766` or another free port. Do not use port 18765, which the CLI reserves while it installs, starts, or stops a client.
5. Connect the MCP host to the exact URL returned by launch or status. The default is `http://127.0.0.1:8765/mcp`. The CLI owns process setup; MCP clients connect to the already running game.
6. Confirm the game state with `get_state` or `screenshot` before acting. After joining a server, opening a menu, or changing screens, check state again because Minecraft may consume input or change focus.

The host configuration may look like this.

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

## Control the client

- Use `get_state` and `screenshot` to inspect the current screen, connection, and player position before choosing inputs.
- Use `join` to connect to a server, then wait and inspect state or screenshots for connection progress, prompts, or errors.
- Use `key`, `click`, `move`, `drag`, `scroll`, and `type` for normal Minecraft controls. Coordinates use screenshot pixels with the origin at the top left.
- Use `execute_command` only when the current server grants the required permission.
- Release every held key and mouse button after a movement or interaction. The mod expires held inputs after 30 seconds without game tool calls, but do not rely on that timeout during normal play.
- Treat the endpoint as a single shared client. Do not let separate agents send overlapping controls.
- If the client is unresponsive, inspect state and the screenshot. A minimized window, paused screen, or stalled render loop can block input or screenshots. Keep the game window visible and restore it if it is minimized. Close a blocking screen before retrying.

## Limits

The CLI runs an offline profile and does not sign in to a Microsoft account. It can run local single player, but servers and Realms that require authenticated online accounts reject this profile. Authentication and Realms errors in client logs are expected when connecting to those services. The first launch needs an internet connection to download Minecraft, Fabric Loader, a managed Java runtime, libraries, and assets. Later launches can use the local cache.

The managed client is available on Windows x64 and uses `mizius_minecraft_home` when set, otherwise `%LOCALAPPDATA%\mizius\Minecraft`. Its MCP URL uses the selected port, which defaults to `127.0.0.1:8765`.

New instances use a 1280 by 720 window, GUI scale 2, FOV 90, and R for sprint. They mute master volume and do not pause on focus loss. Existing instance settings remain in place.

The options file selects the Custom graphics preset and turns clouds, ambient occlusion, and entity shadows off. Render distance is 8 chunks, simulation distance is 5 chunks, the frame rate is capped at 60 FPS, and Java has a 4 GB maximum heap.

The CLI also reserves `127.0.0.1:18765` while it installs, starts, or stops a client. If launch reports that the selected MCP port or 18765 is occupied, choose a free MCP port or retry after the lifecycle operation finishes. Do not stop an unrelated client to free port 8765.

To copy this skill into a skill folder, run `minecraft skill install --dir <directory>`. Run `minecraft skill path` to locate the folder containing the bundled file.
