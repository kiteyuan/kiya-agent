# Kiya Agent

Kiya Agent is a desktop-first resource workflow application built for magnet search, save, download, and playback scenarios.
It combines a Tauri desktop shell, a React frontend, bundled local runtime services, and Pi Agent orchestration so the app can coordinate MCP tools, file downloads, and media playback inside one workspace.

<img width="2880" height="1658" alt="image" src="https://github.com/user-attachments/assets/6472d75a-8562-43ba-8751-306ed2b7a3c8" />

## Highlights

- Desktop application built with `Tauri 2 + React + TypeScript`
- Magnet-oriented workflow for search, save, download, and playback
- Local tool integration for file download, video playback, image preview, and folder access
- Embedded remote MCP presets for Magnet and MagnetFlow services
- Pi Agent runtime orchestration with configurable LLM providers
- Windows packaging flow with bundled runtime resources

## Tech Stack

- Frontend: `React 18`, `TypeScript`, `Vite`, `Tailwind CSS`, `Zustand`
- Desktop shell: `Tauri 2`
- Native backend: `Rust`
- Media: `Artplayer`
- Runtime integration: `@earendil-works/pi-coding-agent`

## Repository Layout

```text
src/                React application UI, stores, pages, and components
src-tauri/          Tauri and Rust desktop backend
scripts/            Build and runtime preparation scripts
vendor/runtime/     Bundled runtime binaries used for desktop packaging
local-mcp/          Local MCP implementation used during development
public/             Static frontend assets
```

## Prerequisites

For local development:

- `Node.js >= 22.19.0`
- `npm`
- Rust toolchain

For Windows desktop development and packaging:

- Microsoft Visual Studio C++ Build Tools
- WebView2 Runtime

Notes:

- The default desktop window size is `1400 x 920`
- Minimum window size is `1200 x 760`
- Development and packaged builds use isolated local data files

## Quick Start

Install dependencies:

```bash
npm install
```

Run the web frontend only:

```bash
npm run dev
```

Run the desktop application in Tauri development mode:

```bash
npm run tauri dev
```

## Development Workflow

### Frontend development

```bash
npm run dev
```

Starts the Vite development server.

### Desktop development

```bash
npm run tauri dev
```

Starts the desktop shell, launches the frontend dev server, and boots the local desktop runtime flow used by the application.

### Type checking

```bash
npm run check
```

### Test suite

```bash
npm run test
```

### Linting

```bash
npm run lint
```

## Build Commands

Build the frontend bundle:

```bash
npm run build:web
```

Build the desktop app assets and prepare Tauri resources:

```bash
npm run build:desktop
```

Prepare bundled runtime resources manually:

```bash
npm run prepare:tauri-resources
```

This step copies platform-specific runtime files from `vendor/runtime/<target>` into `src-tauri/resources/` and installs the production runtime dependencies required by the packaged app.

## Windows Packaging

The repository is currently configured for Windows desktop packaging.

Build the default Windows installer:

```bash
npm run package:windows
```

This produces an `NSIS` installer.

Build an MSI variant:

```bash
npm run package:windows-msi
```

Typical output location:

```text
%LOCALAPPDATA%\kiya-agent\cargo-target\release\bundle\
```

(On Linux/macOS builds: `~/.cache/kiya-agent/cargo-target/release/bundle/`.)

## Runtime Notes

- Desktop packaging uses the app identifier: `info.kiteyuan.kiyaagent`
- Bundled Windows runtime binaries are stored in `vendor/runtime/windows-x64`
- Resource preparation is handled by `scripts/prepare-tauri-resources.mjs`
- Packaged builds write mutable runtime state into the application data directory instead of the installation directory

## LLM and MCP Configuration

The app supports configurable model providers and MCP connections from the Settings UI, including:

- `DeepSeek`
- `OpenAI`
- `Anthropic`
- `OpenRouter`
- Custom OpenAI-compatible endpoints

Embedded MCP presets are included for:

- `Magnet`
- `MagnetFlow`

## Recommended First Run

After launching the desktop app:

1. Open `Settings`
2. Configure your model provider and API key
3. Fill in MCP tokens if required
4. Test the connections
5. Start a new conversation and use the desktop tools

## Troubleshooting

If desktop packaging fails, check the following first:

- Node.js version is new enough
- Rust toolchain is installed correctly
- WebView2 Runtime is available
- No stale `node`, `aria2`, or previous `kiya-agent` processes are locking files
- `vendor/runtime/windows-x64` contains the required runtime binaries

If `npm run tauri dev` fails with missing `app_hide.toml` / permission file paths, clear caches and retry:

```bash
npm run clean:tauri
npm run tauri dev
```

`npm run tauri` now uses a stable `CARGO_TARGET_DIR` under your user cache/AppData (no spaces). This avoids Windows + Tauri path corruption when the repo lives under paths like `Base Projects`. Long-term, prefer cloning the repo to a path without spaces.

Crash / panic logs (desktop) are appended to the OS app log directory as `crash.log` (Windows: `%APPDATA%\info.kiteyuan.kiyaagent\logs\crash.log` or the Tauri app log dir).

If the desktop app starts but Pi Agent cannot run, verify:

- model provider configuration
- API key and optional base URL
- MCP token setup
- runtime resources prepared under `src-tauri/resources`

## License

MIT. See [`LICENSE`](./LICENSE).
