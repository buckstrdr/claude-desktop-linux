# Claude Desktop for Linux (with Computer Use)

Unofficial Linux build of Claude Desktop with full Computer Use support. Extracts the macOS app, replaces native modules with Linux implementations (xdotool + scrot), and packages as a .deb.

Based on [stslex/claude-desktop-linux](https://github.com/stslex/claude-desktop-linux) with the addition of **working Computer Use** — screenshots, mouse control, keyboard input, and window management via standard Linux tools.

## Features

- Full Claude Desktop app (chat, projects, artifacts)
- **Computer Use** — screenshots, mouse, keyboard, window management
- Cowork mode (Claude Code integration)
- MCP server support
- Dispatch (task delivery when app is open)
- System tray integration
- OAuth login via browser

## Computer Use Implementation

The macOS app uses CoreGraphics and Accessibility APIs for computer control. This build replaces those with Linux equivalents:

| Function | macOS | Linux (this build) |
|----------|-------|-------------------|
| Screenshots | CoreGraphics | `scrot` |
| Mouse control | Accessibility API | `xdotool` |
| Keyboard input | Accessibility API | `xdotool` |
| Window management | AXUIElement | `wmctrl` + `xdotool` |
| Monitor info | CoreGraphics | `xrandr` |

## Quick Install (pre-built .deb)

Download the latest `.deb` from [Releases](https://github.com/buckstrdr/claude-desktop-linux/releases), then:

```bash
sudo apt install -y xdotool scrot wmctrl
sudo dpkg -i claude-desktop-*.deb
```

## Build from Source

### Prerequisites

```bash
# Build dependencies
sudo apt install -y nodejs npm unzip dpkg-dev

# Computer Use dependencies
sudo apt install -y xdotool scrot wmctrl icnsutils

# Optional (icon extraction)
sudo apt install -y imagemagick librsvg2-bin
```

Requires Node.js >= 20. If your system package is older, use [nvm](https://github.com/nvm-sh/nvm).

### Build

```bash
git clone https://github.com/buckstrdr/claude-desktop-linux.git
cd claude-desktop-linux

# Step 1: Fetch and extract the macOS app
bash scripts/fetch-and-extract.sh

# Step 2: Inject Linux native module stubs (with computer use)
bash scripts/inject-stubs.sh

# Step 3: Patch platform gates for Cowork/Dispatch
bash scripts/patch-cowork.sh

# Step 4: Build .deb package
bash scripts/build-deb.sh
```

The .deb will be in `output/claude-desktop-<version>-x86_64.deb`.

### Install

```bash
sudo dpkg -i --force-depends output/claude-desktop-*.deb
```

The `--force-depends` is needed if your system Node.js package is < 20 (the app bundles its own Electron runtime and doesn't actually need system Node at runtime).

## Usage

```bash
# Launch from terminal
claude-desktop

# Or find "Claude Desktop" in your application menu
```

On first launch, you'll need to log in with your Anthropic account via the browser OAuth flow.

### Computer Use

Computer Use is available when Claude offers to control your computer. The implementation uses:

- **xdotool** for mouse movement, clicking, scrolling, and keyboard input
- **scrot** for taking screenshots (full screen, window, or region)
- **wmctrl** for window listing and focus management
- **xrandr** for monitor/display detection

All tools run as your user — no elevated privileges required.

### Cowork Mode

Cowork (Claude Code) works out of the box. It spawns `claude` directly on the host (no VM needed, unlike macOS which uses Apple's VZVirtualMachine). Optionally install `bubblewrap` for sandboxed execution:

```bash
sudo apt install bubblewrap
```

## Architecture

```
macOS:
  Claude Desktop (Electron)
    -> @ant/claude-native (CoreGraphics, Accessibility)
    -> @ant/claude-swift (VZVirtualMachine)
      -> Linux VM -> claude-code

This build:
  Claude Desktop (Electron)
    -> @ant/claude-native (xdotool, scrot, wmctrl)
    -> @ant/claude-swift (child_process.spawn)
      -> claude-code (directly on host)
```

See [ARCHITECTURE.MD](ARCHITECTURE.MD) for detailed design decisions.

## Known Limitations

- **X11 only** — xdotool requires X11. Wayland support would need different tools (ydotool, grim).
- **No push notifications** — Dispatch tasks only arrive when the app is open (no APNs/FCM on Linux).
- **No ARM64** — x86_64 only for now.
- **Electron version lock** — if Anthropic's app requires a newer Electron, rebuild is needed.

## Troubleshooting

**App won't launch:**
```bash
# Check if Electron works
/usr/lib/electron/electron --version

# Launch with debug output
claude-desktop 2>&1 | tee /tmp/claude-debug.log
```

**Computer Use not working:**
```bash
# Test xdotool
xdotool getmouselocation

# Test scrot
scrot /tmp/test-screenshot.png && ls -la /tmp/test-screenshot.png

# Test wmctrl
wmctrl -l
```

**OAuth login fails:**
Make sure `xdg-open` works and the `claude://` URI scheme is registered:
```bash
xdg-mime query default x-scheme-handler/claude
# Should show: claude-desktop.desktop
```

## Credits

- [stslex/claude-desktop-linux](https://github.com/stslex/claude-desktop-linux) — base project (DMG extraction, Cowork stubs, platform patching)
- [k3d3/claude-desktop-linux-flake](https://github.com/k3d3/claude-desktop-linux-flake) — reference for native bindings API shape
- [Anthropic](https://anthropic.com) — Claude Desktop app

## License

MIT — see [LICENSE](LICENSE).

This project repackages Anthropic's proprietary application. Use is subject to [Anthropic's Terms of Service](https://www.anthropic.com/terms).
