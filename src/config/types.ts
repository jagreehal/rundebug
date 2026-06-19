export type RunMode = 'run' | 'debug';

/** A saved, GUI-editable run configuration. */
export interface RunConfig {
  id: string;
  name: string;
  /** Workspace-relative path to the target file. */
  file: string;
  /** Optional VS Code language id override (else inferred from the extension). */
  languageId?: string;
  /** Runtime variant to use, e.g. `tsx`, `bun`, `deno`, `uv` (else the language default). */
  runtime?: string;
  /** Fully custom run command (placeholders supported); overrides runtime when running. */
  command?: string;
  mode: RunMode;
  /** Program arguments. */
  args?: string[];
  /** Working directory (absolute or workspace-relative). Defaults to the file's folder. */
  cwd?: string;
  /** Environment variables. */
  env?: Record<string, string>;
}
