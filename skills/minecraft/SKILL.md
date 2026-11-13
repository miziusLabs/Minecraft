---
name: minecraft
description: Launch and control a managed Minecraft Java client with the Minecraft command line tool.
---

# Minecraft command line

Use the `minecraft` command line tool to start and control the managed Minecraft client.

## Start and inspect

1. Run `minecraft versions --json` to see supported versions and the default.
2. Start the requested version with `minecraft launch [version] --username Agent --json`. Use a valid offline profile name. The command waits until the game accepts commands.
3. If another managed client is already running, inspect it with `minecraft status --json`. Reuse it if it is the requested client. Run `minecraft stop --json` before switching versions.
4. Inspect the screen with `minecraft control state --json` or save a screenshot with `minecraft control screenshot --output <file>` before acting.

## Control the client

- Use `minecraft control join <server-address>` to connect to a server. Check state and screenshots while the client connects.
- Use `minecraft control click <x> <y>` to click at screenshot coordinates. The origin is at the top left.
- Use `minecraft control move <x> <y>`, `minecraft control drag <x1> <y1> <x2> <y2>`, and `minecraft control scroll <amount>` for mouse input.
- Use `minecraft control key <name> --action press`, `hold`, or `release` for keyboard input. Key names follow GLFW, such as `W`, `LEFT_SHIFT`, `ENTER`, and `ESCAPE`.
- Use `minecraft control type <text>` to enter text in an open interface. Open chat with `minecraft control key T` before typing chat text, then use `minecraft control key ENTER` to send it.
- Use `minecraft control execute <command>` only when the current server grants the required permission.
- Use `minecraft control logs [query]` to inspect recent client log lines.
- Use `minecraft control record start` before an interaction and `minecraft control record stop` afterward to save a silent MP4 of the game view. The command output contains the recording path. Recordings stop automatically after ten minutes.
- Use `minecraft control batch <json-array>` to run a short sequence of commands without interleaving another control action.
- Release held keys and mouse buttons after each movement or interaction. Held inputs expire after 30 seconds without game commands.
- Treat the client as one shared instance. Do not send overlapping controls from separate agents.
- After joining a server, opening a menu, or changing screens, inspect state with `minecraft control state` before sending more input.
- If the client stops responding, inspect its state and screenshot. Restore a minimized window and close blocking screens before retrying.

## Limits

The CLI runs an offline profile and does not sign in to a Microsoft account. Servers and Realms that require authenticated online accounts reject this profile. Authentication errors in client logs are expected for those services.

The managed client runs on Windows or Linux x64. On Windows, it stores data under `%LOCALAPPDATA%\mizius\Minecraft` by default. Set `mizius_minecraft_home` to use another managed directory.

The default window is 1280 by 720 with GUI scale 2 and FOV 90. Sprint uses R. The client mutes master volume and does not pause on focus loss. New instances use the Custom graphics preset, 8 chunk render distance, 5 chunk simulation distance, and a 60 FPS cap. Existing instance settings remain unchanged.

Run `minecraft --help` for all commands. The command port defaults to 8765. Use `--port` to select another free port. The CLI reserves port 18765 while it installs, starts, or stops a client.

## Linux setup

On Linux, managed data defaults to `$XDG_DATA_HOME/mizius/Minecraft`, or
`~/.local/share/mizius/Minecraft` when `XDG_DATA_HOME` is unset. The
`mizius_minecraft_home` override works on both platforms. Linux requires glibc,
an X11 or Wayland display, OpenGL drivers, and the usual LWJGL desktop libraries.
On Ubuntu 24.04, install the desktop dependencies with
`apt-get install libgl1-mesa-dri libglx-mesa0 libxrandr2 libxcursor1 libxi6 libxinerama1 libasound2t64`.
Java downloads automatically. For a headless session, install `xvfb` and keep
its display server running for the lifetime of the client.

```sh
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp > /tmp/minecraft-xvfb.log 2>&1 &
export DISPLAY=:99
export LIBGL_ALWAYS_SOFTWARE=1
minecraft launch --json
minecraft control state --json
```

This uses Mesa software rendering rather than a physical GPU.
