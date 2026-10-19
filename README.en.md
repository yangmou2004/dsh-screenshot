# DSH Screenshot

**English** | [简体中文](README.md)

A screenshot plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):

- **Agent-driven capture** — the model calls `screenshot` once and the PNG is attached to the conversation automatically.
- **One-click composer button** — a camera button next to the message box captures the screen and either sends it or attaches it, with no file picker.
- **Full screen, region, or window** — via the button menu or the agent tool.
- **Mask the DSH window** — hide the harness window while capturing, then restore its position and focus.

> Windows 10/11 · DSH Desktop · third-party plugin, not affiliated with DeepSeek.

![Screenshot button in the composer](docs/assets/composer-button.png)

## Features

| Capability | Detail |
|---|---|
| Agent tool `screenshot` | One call captures and uploads; supports screen, region, and window |
| Composer camera button | Main click: full-screen capture. `⌄` menu: Full screen / Region / Window |
| Full screen | Entire virtual desktop by default, or `primary` / monitor index |
| Region | Capture a full-screen preview, then drag a crop rectangle on it |
| Window | Lists open windows (title + process); captures the selected window, restoring minimized ones |
| Mask DSH | `mask_self=true` hides this window during capture and restores it afterwards |
| Text-aware send | With text in the composer, the screenshot is only attached; with an empty composer it is sent immediately |
| Multi-monitor / HiDPI | Physical-pixel coordinates, 150%/200% scaling, multiple displays |
| Local only | Screenshots never leave your machine except into your own DSH conversation |

## Install

Requirements: Windows 10/11, DSH Desktop with the Web GUI, PowerShell 5.1 (built in).

```powershell
git clone https://github.com/yangmou2004/dsh-screenshot.git
```

Then install the local bundle from DSH. Ask the agent:

> Install the local plugin at `C:\path\to\dsh-screenshot`

or call:

```text
plugin_manager install_bundle target = "C:\path\to\dsh-screenshot"
```

The plugin package name is `dsh-screenshot-plugin` (the repository directory is `dsh-screenshot`). Refresh the page once if the camera button does not appear. No `npm install` or build step is required.

## Usage

### Ask the agent

```text
Take a screenshot
Capture the full screen
Screenshot the browser window
Capture the top-left 800×600 region
Hide this window and take a screenshot
```

### Composer button

- **Empty composer:** click the camera → screenshot is taken and sent immediately.
- **Composer has text:** click the camera → screenshot is attached only; press Send to send text + image together.

Click the `⌄` next to the camera for:

| Menu item | Behavior |
|---|---|
| Full screen | Captures the desktop with the DSH window masked |
| Region… | Captures a full-screen preview, then drag a crop rectangle |
| Window… | Lists current windows and captures the selected one |

The region preview intentionally hides the DSH window, so use “Window…” → DSH to capture the harness itself.

## Agent tool parameters

Tool name: `screenshot`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `mode` | `screen` \| `region` \| `window` | `screen` | Capture scope |
| `region` | `{x,y,width,height,unit?}` | — | Region for `mode=region`; `unit` is `px` or `percent` |
| `window` | string | `active` | Title fragment, `process:<name>`, `pid:<n>`, `hwnd:<n>`, `active`, or `self` |
| `monitor` | string | `all` | `all`, `primary`, or a 1-based monitor index |
| `mask_self` | boolean | `false` | Hide the DSH window during capture |
| `delay_ms` | number | `120` | Extra settle delay (0–10000 ms) |
| `save_to_workspace` | boolean | `true` | Also save to `<workspace>/screenshots`; the image is attached either way |

The screenshot is already attached to the conversation when the tool returns. If the model cannot view images directly, the result text includes a path for `modlens_read_image`.

## How it works

- **Host** (`index.js`): registers the `screenshot` tool and local capture/window routes, runs the helper, and stores the PNG through `ctx.attachments`.
- **Capture** (`capture.ps1`): Windows GDI `CopyFromScreen` + DWM `PrintWindow`; handles DPI, multi-monitor, window frames, minimized windows, and window masking.
- **Client** (`client.js`): registers the camera button in `conversation.input.left`, calls the same-origin capture route, turns the PNG into a browser `File`, adds it to the composer draft, and submits automatically when the composer is empty.

### Security

- Capture routes are served by the local DSH Web server and require the `X-DSH-Screenshot: 1` header.
- Screenshots go only to DSH attachment storage and the optional workspace `screenshots/` folder.
- The window list returns local titles/process names only; no window content is read.
- No telemetry, external scripts, or remote code.

## Project layout

```text
dsh-screenshot/
├── index.js
├── client.js
├── capture.ps1
├── cordis.patch.yml
├── package.json
├── locale/{en,zh}.json
├── icon.svg
└── docs/assets/composer-button.png
```

## Development

- Plain ESM host plugin plus a lazy CJS client bundle; no build step.
- `capture.ps1` changes apply on the next capture.
- Refresh the page after `client.js` changes if hot reload does not pick them up.
- Reload the host plugin (disable/enable or restart DSH) after `index.js` changes.
- Routes:
  - `POST /plugins/dsh-screenshot/capture?mode=screen|region|window&mask_self=1`
  - `POST /plugins/dsh-screenshot/windows`
- Verified on DSH `0.2.1-rc.2`.

### Known limitations

- Windows only.
- Region selection happens on a pre-captured full-screen preview, so the content is frozen at the moment “Region” is clicked.
- Adding `dsh.client` to an already-installed package may need a DSH restart (or a new package specifier); fresh installs are unaffected.
- Window capture tries `PrintWindow` first and briefly brings the window to the foreground when it fails.

## License

[MIT](LICENSE) © 2026 yangmou2004
