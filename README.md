# Run/Debug Configurations

One-click **Run** *and* **Debug** for any file, plus **JetBrains-style run configurations** with a GUI — no `launch.json` wrangling. A modern take on the run-a-file workflow, with the debug power you expect from WebStorm/IntelliJ, for VS Code, Cursor, Windsurf and VSCodium.

> Status: early scaffold (0.1.0). Run + Debug + GUI configs are wired; languages and debuggers are being expanded.

## Why

[Code Runner](https://marketplace.visualstudio.com/items?itemName=formulahendry.code-runner) (40M+ installs) only *runs* a file — no breakpoints, no per-project configs, no GUI — and is effectively unmaintained (700+ open issues). VS Code's built-in `launch.json` debugs well but is JSON-heavy. Run/Debug Configurations closes the gap: the simplicity of Code Runner, the run/debug ergonomics of JetBrains.

## Features

- **Run File** — `ctrl+alt+n`, the editor title ▶ button, or the context menu. 20+ languages out of the box.
- **Debug File** — `ctrl+alt+d`. Delegates to VS Code's debug engine with the right adapter (Node/JS/TS, Bun, Python, Go, and **Rust/C/C++** via CodeLLDB — compiled with debug symbols first), auto-prompting to install the debugger extension if missing.
- **Watch & Re-run** — `ctrl+alt+w` (eye icon in the title bar) re-runs the file on every save, with a status-bar indicator and one-click stop.
- **Run Selection** — execute just the highlighted snippet.
- **Run Configurations** — a sidebar list with a GUI editor: name, target file, run/debug mode, args, working directory, and an environment-variable table. Saved to `.vscode/rundebug.json` so they're shareable and committable. No manual JSON.
- **Promote file → config** — right-click → *Save Current File as Run Configuration*: name it, pick run/debug, done (with an *Edit* shortcut to fine-tune).
- **Native Node TypeScript** — pick `node` as the TS runtime to run/debug `.ts` with no extra tooling (Node 22.6+). `rundebug.node.typeStripping` controls the flag (`transform` handles enums/namespaces).

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `rundebug.runInTerminal` | `true` | Run in the integrated terminal (off = output channel). |
| `rundebug.saveAllOnRun` | `true` | Save the active file before running. |
| `rundebug.clearPreviousOutput` | `false` | Clear before each run. |
| `rundebug.respectShebang` | `true` | Honour a `#!` line over the language default. |
| `rundebug.runtime.javascript` | `node` | Runtime for JS: `node` · `bun` · `deno`. |
| `rundebug.runtime.typescript` | `tsx` | Runtime for TS/TSX: `tsx` · `bun` · `ts-node` · `deno` · `node`. |
| `rundebug.runtime.python` | `python3` | Runtime for Python: `python3` · `python` · `uv`. |
| `rundebug.node.typeStripping` | `transform` | Flag for the TS `node` runtime: `transform` · `strip` · `none` (Node 22.6+). |
| `rundebug.executorMap` | `{}` | Full per-language command override (wins over runtime), e.g. `{ "javascript": "bun {file}" }`. Placeholders: `{file} {fileBasename} {fileBasenameNoExt} {fileDirname} {workspaceFolder} {relativeFile}`. |

Runtime dropdowns cover the common case (pick `bun`/`deno`/`uv` from a menu, and **debug** follows the choice too). `executorMap` is the escape hatch for anything custom.

### Use any runtime you want

Three layers, most specific wins:

1. **Per run-configuration** — each saved config has a **Runtime** field (`tsx`, `bun`, `deno`, `uv`, `node`, …) and a **Custom command** field (e.g. `bun --hot {file}`) right in the GUI editor. Different configs for the same file can use different runtimes.
2. **Per language (workspace/user)** — the `rundebug.runtime.*` dropdowns set the default for every file of that language.
3. **`rundebug.executorMap`** — a raw command per language for anything not covered above.

Run resolution order: custom command → per-config runtime → `executorMap` → shebang → language-default runtime.

## Develop

```bash
npm install
npm run watch      # esbuild in watch mode
# press F5 in VS Code to launch the Extension Development Host
```

```bash
npm run typecheck  # tsc --noEmit
npm run test:unit  # fast, headless registry/runtime tests (mocha)
npm test           # full integration suite in a real VS Code host (@vscode/test-cli)
npm run vsix       # build a .vsix
```

## Publish

```bash
npm run publish:vsce   # VS Code Marketplace
npm run publish:ovsx   # Open VSX (Cursor, Windsurf, VSCodium, Gitpod, …)
```

## License

MIT © Jag Reehal
