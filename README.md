# Run/Debug Configurations

One-click **Run** *and* **Debug** for any file, plus **JetBrains-style run configurations** with a GUI. No `launch.json` to hand-write. Works in VS Code, Cursor, Windsurf, and VSCodium.

> Status: early release (0.1.0). Run, Debug, and the GUI configs work today, across ~50 languages.

## Why

[Code Runner](https://marketplace.visualstudio.com/items?itemName=formulahendry.code-runner) (40M+ installs) runs a file but can't debug it, and it ships an unpatched remote-code-execution bug ([CVE-2025-65715](https://nvd.nist.gov/vuln/detail/CVE-2025-65715)) among its 700+ open issues. VS Code's `launch.json` debugs well but means writing JSON by hand. Run/Debug Configurations gives you both: one-click runs and real breakpoints, set up from a GUI.

## Features

- **Run File**: `ctrl+alt+n`, the editor title ▶ button, or the context menu. ~50 built-in languages across scripting, compiled, and CLI-first runtimes (JS/TS, Python, Go, Rust, C/C++, Java, Ruby, PHP, Swift, Kotlin, Zig, Gleam, F#, .NET projects, V, Raku, CUDA, and more).
- **Debug File**: `ctrl+alt+d`. Hands off to VS Code's debug engine with the right adapter (Node/JS/TS, Bun, Python via debugpy, Go, and **Rust/C/C++/Objective-C/D/Pascal/Fortran/CUDA** via CodeLLDB, compiled with debug symbols first), and offers to install the debugger extension if you don't have it. Already keep a `launch.json`? Set `rundebug.preferLaunchConfig` to reuse a matching config.
- **Watch & Re-run**: `ctrl+alt+w` (eye icon in the title bar) re-runs the file on every save and shows a status-bar indicator. Stop one watch by pressing `ctrl+alt+w` again, pick which to stop when several run, or *Stop All Watches*.
- **Test Explorer, CodeLenses & coverage**: tests show up in VS Code's native Testing panel with **Run**, **Debug**, and **Run with Coverage** profiles. **Run Test | Debug Test** CodeLenses sit above each test, with **Run File Tests | Watch Tests** at the top of the file. Run a single test at the caret with `ctrl+alt+t`. The framework is detected per project — **Vitest, Jest, Mocha, `node:test`** (from your dependencies, defaulting to the zero-config `node:test`), plus **pytest, go test, cargo test** — or pin one with `rundebug.testFramework`. Coverage runs load the framework's `lcov` output straight into the editor's gutter, so no instrumentation of ours is involved.
- **Watch tests**: the *Watch Tests* CodeLens (or `rundebug.watchTests`) re-runs a file's tests on every save, with the same status-bar indicator as file watch.
- **Run Selection**: run just the highlighted snippet.
- **Run Configurations**: a sidebar list with a GUI editor for the name, target file, run/debug mode, args, working directory, and environment variables. It saves to `.vscode/rundebug.json`, so you can commit and share it. No JSON to write.
- **Promote file → config**: right-click *Save Current File as Run Configuration*, name it, pick run or debug. An *Edit* shortcut fine-tunes the rest.
- **Python that respects your venv**: Run uses the interpreter the Python extension selected (virtualenv/conda), the same one Debug and IntelliSense use, so you skip the activate step. Toggle with `rundebug.python.useSelectedInterpreter`.
- **Native Node TypeScript**: pick `node` as the TS runtime to run and debug `.ts` with no extra tooling (Node 22.6+). `rundebug.node.typeStripping` sets the flag (`transform` handles enums and namespaces).
- **Tidy compiled output**: point `rundebug.compiledOutputDirectory` at a build folder to keep binaries out of your source tree.
- **Safe by default**: it honours [Workspace Trust](#workspace-trust), so a repo you just cloned can't run code through its own settings, saved configs, or shebang lines.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `rundebug.runInTerminal` | `true` | Run in the integrated terminal (off = output channel). |
| `rundebug.saveAllOnRun` | `true` | Save the active file before running. |
| `rundebug.clearPreviousOutput` | `false` | Clear before each run. |
| `rundebug.respectShebang` | `true` | Honour a `#!` line over the language default (trusted workspaces only). |
| `rundebug.executorMapByGlob` | `{ "pom.xml": "cd {fileDirname} && mvn clean package" }` | Override run commands by glob, matched against the file name **or** workspace-relative path (e.g. `tests/**/*.py`). |
| `rundebug.runtime.javascript` | `node` | Runtime for JS: `node` · `bun` · `deno`. |
| `rundebug.runtime.typescript` | `tsx` | Runtime for TS/TSX: `tsx` · `bun` · `ts-node` · `deno` · `node`. |
| `rundebug.runtime.python` | `python3` | Runtime for Python: `python3` · `python` · `uv`. |
| `rundebug.node.typeStripping` | `transform` | Flag for the TS `node` runtime: `transform` · `strip` · `none` (Node 22.6+). |
| `rundebug.executorMap` | `{}` | Full per-language command override (wins over runtime), e.g. `{ "javascript": "bun {file}" }`. Placeholders: `{file} {fileBasename} {fileBasenameNoExt} {fileDirname} {workspaceFolder} {relativeFile}`. |
| `rundebug.executorMapByFileExtension` | `{}` | Override run commands by exact file extension, e.g. `.csproj` or `.kt`. |
| `rundebug.languageIdToFileExtensionMap` | `{ "typescriptreact": ".tsx", ... }` | Map VS Code language ids to extensions when the file extension is missing or ambiguous. |
| `rundebug.defaultLanguage` | `""` | Fallback language id when no runner or override matches a file. |
| `rundebug.cwd` | `""` | Global default working directory for run commands. |
| `rundebug.fileDirectoryAsCwd` | `true` | Use the file’s directory as cwd when no explicit cwd is set. |
| `rundebug.python.useSelectedInterpreter` | `true` | Run Python with the interpreter the Python extension selected (venv/conda). |
| `rundebug.compiledOutputDirectory` | `""` | Directory for built binaries (C/C++/Rust/Go/…); empty = next to the source. |
| `rundebug.preferLaunchConfig` | `false` | When debugging, reuse a `launch.json` config whose `program` matches the file. |
| `rundebug.showRunActionsForUnsupportedFiles` | `true` | Show the Run/Debug actions on every file; off = only files with a known runner. |
| `rundebug.testFramework` | `auto` | Test framework for the Test Explorer/CodeLenses: `auto` · `vitest` · `jest` · `mocha` · `node:test` · `pytest` · `go` · `cargo`. |
| `rundebug.testCodeLens` | `true` | Show Run/Debug CodeLenses above tests and test files. |
| `rundebug.testFileGlobs` | `["**/*.{test,spec}.{js,jsx,ts,tsx,cjs,mjs,cts,mts}", "**/*_test.go", "**/test_*.py", "**/*_test.py"]` | Globs the Test Explorer uses to discover test files (`node_modules` always excluded). |
| `rundebug.coverageFile` | `coverage/lcov.info` | Workspace-relative lcov file loaded into the editor's coverage view after a coverage run. |

Pick `bun`, `deno`, or `uv` from a dropdown and Debug follows the same choice. For anything the dropdowns miss, `executorMap` and the glob and extension overrides take a raw command.

### Use any runtime you want

Three layers, most specific wins:

1. **Per run-configuration**: each saved config has a **Runtime** field (`tsx`, `bun`, `deno`, `uv`, `node`, …) and a **Custom command** field (e.g. `bun --hot {file}`) in the GUI editor. Two configs for the same file can use different runtimes.
2. **Per language (workspace/user)**: the `rundebug.runtime.*` dropdowns set the default for every file of that language.
3. **`rundebug.executorMap`**: a raw command per language for anything the layers above miss.

Run resolution order: custom command → per-config runtime → `executorMap` → shebang → `executorMapByGlob` → built-in runner / `executorMapByFileExtension` → `defaultLanguage`.

## Workspace Trust

Run/Debug runs shell commands, so it follows VS Code's [Workspace Trust](https://code.visualstudio.com/docs/editor/workspace-trust). Open an **untrusted** workspace and it runs your code with the built-in runners and your **user**-level settings only. It ignores everything a hostile repo controls:

- workspace run commands: `executorMap`, the glob and extension maps, `defaultLanguage`, `cwd`, `compiledOutputDirectory`;
- a committed `.vscode/rundebug.json`'s custom `command`, `args`, `cwd`, and `env`;
- shebang lines;
- file paths with characters that could break out of shell quoting.

Trust the workspace to turn all of that back on. This closes the class of bug behind [CVE-2025-65715](https://nvd.nist.gov/vuln/detail/CVE-2025-65715).

## Develop

```bash
pnpm install
pnpm watch         # esbuild in watch mode
# press F5 in VS Code to launch the Extension Development Host
```

```bash
pnpm typecheck     # tsc --noEmit
pnpm test:unit     # fast, headless registry/runtime tests (mocha)
pnpm test          # full integration suite in a real VS Code host (@vscode/test-cli)
pnpm vsix          # build a .vsix
```

## Publish

The same VSIX publishes to both registries. Build it once:

```bash
pnpm vsix              # produces rundebug-<version>.vsix
```

### VS Code Marketplace (publisher: `jagreehal`)

Either upload the `.vsix` by hand at the [Marketplace management page](https://marketplace.visualstudio.com/manage)
(**+ New extension → Visual Studio Code**), or publish from the CLI with a
[Personal Access Token](https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate):

```bash
export VSCE_PAT=<azure-devops-token>
pnpm publish:vsce      # vsce publish --no-dependencies
```

`package.json` `publisher` **must** equal `jagreehal`, or the upload is rejected.

### Open VSX (Cursor, Windsurf, VSCodium, Gitpod, …)

`ovsx` reads the token from `OVSX_PAT`, so it never appears on a command line:

```bash
export OVSX_PAT=<open-vsx-token>

npx ovsx create-namespace jagreehal   # one-time; skip if it already exists
npx ovsx publish rundebug-0.1.0.vsix  # or: pnpm publish:ovsx
```

Lands at `https://open-vsx.org/extension/jagreehal/rundebug`.

### Cutting a release

Bump, tag, and push. The `release.yml` workflow packages the VSIX, publishes to
**Open VSX** (needs the `OVSX_PAT` repo secret), and attaches the `.vsix` to the
GitHub release:

```bash
pnpm version patch     # e.g. 0.1.0 -> 0.1.1, creates a v* tag
git push --follow-tags
```

The **VS Code Marketplace** upload stays manual: download the `.vsix` from the
GitHub release and upload it at the [Marketplace management page](https://marketplace.visualstudio.com/manage).

## License

MIT © Jag Reehal
