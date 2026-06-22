# Changelog

## 0.2.0

- **Test Explorer**: tests appear in VS Code's native Testing panel with **Run**, **Debug**, and **Run with Coverage** profiles. Results are reported by process exit code; the tree nests by suite/class. Debug reports success only when a session actually launches (frameworks without debug support — e.g. cargo — and declined installs show *skipped*, not green).
- **Framework detection**: Vitest / Jest / Mocha / `node:test` from your dependencies (defaulting to the zero-config `node:test`), plus pytest, go test, and cargo test by language. Pin one with `rundebug.testFramework`.
- **CodeLenses**: **Run Test | Debug Test** above each test and **Run File Tests | Watch Tests** at the top of a test file. Run the test under the caret with `ctrl+alt+t`. Targeted runs use the full suite path (`path::Class::name` for pytest, the full title for JS runners) so duplicate leaf names are unambiguous.
- **Coverage**: a coverage run loads the framework's `lcov` output straight into the editor's gutter via the native coverage API — no instrumentation of ours.
- **Watch tests**: re-run a file's tests on every save, reusing the watch status bar.
- `node:test` runs TypeScript via Node's built-in type stripping, or the project's `tsx` loader when present (which also handles JSX). New settings: `rundebug.testFramework`, `rundebug.testCodeLens`, `rundebug.testFileGlobs`, `rundebug.coverageFile`.

## 0.1.1

- **~50 languages**, closing Code Runner parity gaps (F#, .NET projects, V, Raku, Ring, CUDA). Fixed the duplicate `kotlin` runner that ran `.kts` scripts as a jar build.
- **Workspace Trust**: an untrusted workspace can no longer execute code through its own `executorMap`/`defaultLanguage`/`cwd` settings, a committed `.vscode/rundebug.json`, or shebang lines, and refuses paths that could break out of shell quoting. Closes the class of bug behind CVE-2025-65715.
- **Python Run** uses the interpreter the Python extension selected (venv/conda), matching Debug. Toggle with `rundebug.python.useSelectedInterpreter`.
- New settings: `rundebug.compiledOutputDirectory` (build binaries elsewhere), `rundebug.preferLaunchConfig` (reuse a matching `launch.json` config), `rundebug.showRunActionsForUnsupportedFiles` (hide the actions on files with no runner).
- `executorMapByGlob` matches the workspace-relative path, not just the file name.
- Per-file watch picker; terminal first-character race fix; collapse a duplicate run within 250ms.
- Tooling moved to pnpm + Node 24, with CI running the headless and VS Code integration suites.

## 0.1.0

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
