# Changelog

## 0.1.0 (unreleased)

Initial scaffold.

- One-click **Run** for the current file or selection across 20+ languages.
- **Runtime selection** via dropdowns: JS (`node`/`bun`/`deno`), TS (`tsx`/`bun`/`ts-node`/`deno`/`node`), Python (`python3`/`python`/`uv`). Debug follows the chosen runtime.
- One-click **Debug** for the current file (Node/JS/TS, Bun, Python, Go, and Rust/C/C++ via CodeLLDB with an automatic debug-symbol build step), delegating to VS Code's debug engine.
- **Watch & Re-run** (`ctrl+alt+w`): re-runs a file on save, with a status-bar indicator and one-click stop.
- **Promote file → config**: *Save Current File as Run Configuration* quick-action (name + run/debug pick + Edit shortcut).
- **Native Node TypeScript**: choose `node` as the TS runtime; `rundebug.node.typeStripping` (`transform`/`strip`/`none`) sets the flag for run and debug.
- JetBrains-style **run configurations**: sidebar tree + GUI editor (env vars, args, cwd) with no manual JSON.
- **Per-config runtime & custom command**: every saved config can pick its own runtime (`tsx`/`bun`/`uv`/…) or a fully custom command, edited in the GUI.
- **Test suite**: headless unit tests (`npm run test:unit`) plus a full VS Code integration suite (`npm test`, `@vscode/test-cli`).
- Designed app icon (run + breakpoint mark).
- Cross-target packaging for VS Code Marketplace and OpenVSX (Cursor, Windsurf, VSCodium).
