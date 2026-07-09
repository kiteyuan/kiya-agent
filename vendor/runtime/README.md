Kiya Agent runtime vendor inputs

Place optional packaged runtimes here before running `npm run prepare:tauri-resources`.

Recommended layout:

- `vendor/runtime/windows-x64/aria2c.exe`
- `vendor/runtime/windows-x64/node.exe`
- `vendor/runtime/windows-x64/npm.cmd`
- `vendor/runtime/windows-x64/npx.cmd`
- `vendor/runtime/windows-x64/node_modules/`
- `vendor/runtime/darwin-arm64/aria2c`
- `vendor/runtime/darwin-arm64/node`
- `vendor/runtime/darwin-arm64/npm`
- `vendor/runtime/darwin-arm64/npx`
- `vendor/runtime/darwin-arm64/node_modules/`
- `vendor/runtime/darwin-x64/...`
- `vendor/runtime/linux-x64/...`

Notes:

- `prepare-tauri-resources.mjs` resolves the current target from `KIYA_RUNTIME_TARGET` or the host platform, then copies matching files from `vendor/runtime/<target>/`.
- Each target directory is flat: put `aria2c(.exe)`, `node(.exe)`, `npm(.cmd)`, `npx(.cmd)`, and `node_modules/` directly under `vendor/runtime/<target>/`.
- Bundled `node` is recommended for packaged builds, because `Pi Agent` and `local-mcp` should not depend on a user-installed runtime.
- If packaged `aria2` is missing, development mode falls back to the mock RPC server. Installers should ship a real `aria2` binary for their target platform.
- `prepare-tauri-resources.mjs` always copies the current project `node_modules` into `src-tauri/resources/pi-runtime` so the official `Pi Agent` CLI remains available in the installer.
