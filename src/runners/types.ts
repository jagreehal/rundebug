/**
 * A resolved execution context for a single run/debug invocation.
 * Placeholders in run-command templates and debug templates are filled from this.
 */
export interface RunContext {
  /** Absolute path to the target file. */
  filePath: string;
  /** File name with extension, e.g. `app.ts`. */
  fileBasename: string;
  /** File name without extension, e.g. `app`. */
  fileBasenameNoExt: string;
  /** Directory containing the file. */
  fileDirname: string;
  /** Absolute path of the containing workspace folder (falls back to fileDirname). */
  workspaceFolder: string;
  /** Path of the file relative to the workspace folder. */
  relativeFile: string;
  /** Directory for compiled output binaries; defaults to `fileDirname`. */
  outputDir?: string;
  /** Selected text, when running a selection. */
  selection?: string;
}

export interface DebugTemplate {
  /** Debug adapter type, e.g. `node`, `debugpy`, `go`, `lldb`. */
  type: string;
  /** Extension id that provides this debug adapter, suggested for install when missing. */
  requiresExtension?: string;
  /**
   * Optional shell command run (and awaited) before the debug session starts —
   * used by compiled languages to build a binary with debug symbols.
   */
  compile?: (ctx: RunContext) => string;
  /** Build the adapter-specific portion of the debug configuration. */
  build: (ctx: RunContext) => Record<string, unknown>;
}

/** One way of running a language, e.g. Node vs Bun vs Deno for JavaScript. */
export interface RuntimeVariant {
  /** Human label, shown in settings. */
  label: string;
  /** Build the shell command used to run the file. */
  run: (ctx: RunContext) => string;
  /** Optional debug template; absent means this runtime is run-only. */
  debug?: DebugTemplate;
}

export interface LanguageRunner {
  /** Stable id, aligned with VS Code language ids where possible. */
  id: string;
  /** Human label. */
  label: string;
  /** File extensions handled, including the dot. */
  extensions: string[];
  /** Named runtimes; the key is the value stored in settings. */
  runtimes: Record<string, RuntimeVariant>;
  /** Key into `runtimes` used when no setting is chosen. */
  defaultRuntime: string;
}
