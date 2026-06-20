import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { minimatch } from 'minimatch';
import * as vscode from 'vscode';
import {
  mappedCommand,
  selectCommand,
  type ResolvedCommand,
} from '../runners/commandSelection';
import { applyTemplate } from '../runners/registry';
import {
  prepareRunCommand,
  resolveDefaultLanguageSelection,
  resolveRuntimeSelection,
  type RuntimeSelection,
} from '../runners/runtimeSupport';
import type { RunContext } from '../runners/types';
import { contextForUri } from '../util/context';
import {
  blockedByUntrustedPath,
  isWorkspaceTrusted,
  trustedConfig,
} from '../util/trust';

const TERMINAL_NAME = 'Run/Debug';

let terminal: vscode.Terminal | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let activeChild: ChildProcess | undefined;
// Collapses a duplicate run of the same command fired within a tick of another
// — e.g. manually running a watched file, whose save also triggers the watcher.
let lastRun: { key: string; at: number } | undefined;
const DUPLICATE_RUN_WINDOW_MS = 250;

export interface RunOptions {
  languageId?: string;
  selection?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Explicit runtime variant (e.g. `bun`, `uv`); overrides the configured default. */
  runtime?: string;
  /** Fully custom command template; bypasses runtime resolution entirely. */
  command?: string;
}

function config() {
  return vscode.workspace.getConfiguration('rundebug');
}

/** A `rundebug` object setting, with untrusted workspace values filtered out. */
function trustedMap(key: string): Record<string, string> {
  return trustedConfig<Record<string, string>>('rundebug', key) ?? {};
}

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Run/Debug');
  }
  return outputChannel;
}

/** A freshly spawned shell can swallow the first characters sent to it (#1251). */
const NEW_TERMINAL_DELAY_MS = 200;

function getTerminal(clear: boolean): { terminal: vscode.Terminal; created: boolean } {
  if (clear && terminal) {
    terminal.dispose();
    terminal = undefined;
  }
  if (!terminal || terminal.exitStatus !== undefined) {
    terminal = vscode.window.createTerminal(TERMINAL_NAME);
    return { terminal, created: true };
  }
  return { terminal, created: false };
}

/** Read a `#!` interpreter from the first line, if present. */
function parseShebang(filePath: string): string | undefined {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    fs.closeSync(fd);
    const firstLine = buf.toString('utf8', 0, n).split(/\r?\n/, 1)[0];
    if (/^#!(?!\[)/.test(firstLine)) {
      return firstLine.slice(2).trim();
    }
  } catch {
    // ignore – fall back to the registry default
  }
  return undefined;
}

const quote = (s: string): string => `"${s}"`;

function fileExtensionForContext(ctx: RunContext, languageId?: string): string {
  const ext = path.extname(ctx.filePath);
  if (ext) {
    return ext.toLowerCase();
  }
  if (!languageId) {
    return '';
  }
  const map = config().get<Record<string, string>>(
    'languageIdToFileExtensionMap',
    {},
  );
  return (map[languageId] ?? `.${languageId}`).toLowerCase();
}

function commandFromGlob(ctx: RunContext): string | undefined {
  const byGlob = trustedMap('executorMapByGlob');
  // Match either the bare name or the workspace-relative path, so globs can
  // target a directory (e.g. `tests/**/*.py`) and not just a file name (#1255).
  const targets = [path.basename(ctx.filePath), ctx.relativeFile];
  for (const [glob, command] of Object.entries(byGlob)) {
    if (targets.some((t) => minimatch(t, glob))) {
      return applyTemplate(command, ctx);
    }
  }
  return undefined;
}

function shebangCommand(ctx: RunContext): string | undefined {
  // Shebangs are file content, so an untrusted workspace must not run them.
  if (!isWorkspaceTrusted() || !config().get<boolean>('respectShebang', true)) {
    return undefined;
  }
  const shebang = parseShebang(ctx.filePath);
  return shebang ? `${shebang} ${quote(ctx.filePath)}` : undefined;
}

/** Resolve via the configured fallback language when nothing else matched. */
function defaultLanguageResolution(ctx: RunContext): ResolvedCommand | undefined {
  const fallback = resolveDefaultLanguageSelection(ctx.filePath);
  if (!fallback) {
    return undefined;
  }
  // An executorMap override for the fallback language wins verbatim; only the
  // runtime's own command should carry a selection for prep.
  const override = mappedCommand(trustedMap('executorMap'), fallback.language, ctx);
  if (override !== undefined) {
    return { command: override };
  }
  const command = fallback.selection.variant?.run(ctx);
  return command === undefined
    ? undefined
    : { command, selection: fallback.selection };
}

/**
 * Resolve the shell command for a context, reading the relevant settings and
 * delegating precedence to {@link selectCommand}.
 */
export function resolveCommand(
  ctx: RunContext,
  selection: RuntimeSelection,
  languageId?: string,
  runtimeOverride?: string,
): ResolvedCommand | undefined {
  return selectCommand(ctx, {
    languageId,
    runtimeOverride,
    fileExtension: fileExtensionForContext(ctx, languageId),
    executorMap: trustedMap('executorMap'),
    executorMapByFileExtension: trustedMap('executorMapByFileExtension'),
    shebangCommand: runtimeOverride ? undefined : shebangCommand(ctx),
    globCommand: runtimeOverride ? undefined : commandFromGlob(ctx),
    selection,
    fallback: runtimeOverride ? undefined : defaultLanguageResolution(ctx),
  });
}

/** Whether the file at `uri` would resolve to a runnable command. */
export function canRun(uri: vscode.Uri, languageId?: string): boolean {
  const ctx = contextForUri(uri);
  const selection = resolveRuntimeSelection(ctx.filePath, languageId);
  return resolveCommand(ctx, selection, languageId) !== undefined;
}

async function saveIfNeeded(): Promise<void> {
  if (config().get<boolean>('saveAllOnRun', true)) {
    await vscode.window.activeTextEditor?.document.save();
  }
}

function resolveCwd(cwd: string, ctx: RunContext): string {
  return path.isAbsolute(cwd) ? cwd : path.join(ctx.workspaceFolder, cwd);
}

function configuredCwd(ctx: RunContext): string {
  const cwd = trustedConfig<string>('rundebug', 'cwd');
  if (cwd) {
    return resolveCwd(cwd, ctx);
  }
  if (config().get<boolean>('fileDirectoryAsCwd', true)) {
    return ctx.fileDirname;
  }
  return ctx.workspaceFolder;
}

/** Run the file at the given uri. */
export async function runUri(
  uri: vscode.Uri,
  opts: RunOptions = {},
): Promise<void> {
  if (blockedByUntrustedPath(uri)) {
    return;
  }
  await saveIfNeeded();

  const ctx = contextForUri(uri, opts.selection);
  // A fully custom command bypasses runtime resolution; otherwise resolve the
  // command together with the selection that should prepare it (which may be
  // the defaultLanguage fallback, not the file's own runner).
  let command: string;
  let preppedSelection: RuntimeSelection | undefined;
  if (opts.command) {
    command = applyTemplate(opts.command, ctx);
  } else {
    const base = resolveRuntimeSelection(ctx.filePath, opts.languageId, opts.runtime);
    const resolved = resolveCommand(ctx, base, opts.languageId, opts.runtime);
    if (!resolved) {
      void vscode.window.showWarningMessage(
        `Run/Debug: no runner for ${path.basename(uri.fsPath)}. Add one via "rundebug.executorMap".`,
      );
      return;
    }
    command = resolved.command;
    preppedSelection = resolved.selection;
  }
  if (opts.args?.length) {
    command += ` ${opts.args.map(quote).join(' ')}`;
  }

  const prep = {
    command,
    cwd: opts.cwd ? resolveCwd(opts.cwd, ctx) : configuredCwd(ctx),
  };
  if (preppedSelection && !(await prepareRunCommand(preppedSelection, ctx, prep))) {
    return;
  }

  const key = `${uri.toString()}::${prep.command}`;
  const now = Date.now();
  if (lastRun && lastRun.key === key && now - lastRun.at < DUPLICATE_RUN_WINDOW_MS) {
    return;
  }
  lastRun = { key, at: now };

  const clear = config().get<boolean>('clearPreviousOutput', false);

  if (config().get<boolean>('runInTerminal', true)) {
    await runInTerminal(prep.command, prep.cwd, clear, opts.env);
  } else {
    runInOutputChannel(prep.command, prep.cwd, clear, opts.env);
  }
}

async function runInTerminal(
  command: string,
  cwd: string,
  clear: boolean,
  env?: Record<string, string>,
): Promise<void> {
  // A custom env needs its own terminal; otherwise reuse the shared one.
  const { terminal: term, created } = env
    ? { terminal: vscode.window.createTerminal({ name: TERMINAL_NAME, env }), created: true }
    : getTerminal(clear);
  term.show(true);
  // Let a just-spawned shell finish initializing before sending the command,
  // otherwise its first characters can be dropped (#1251).
  if (created) {
    await new Promise((resolve) => setTimeout(resolve, NEW_TERMINAL_DELAY_MS));
  }
  term.sendText(`cd ${quote(cwd)} && ${command}`);
}

function runInOutputChannel(
  command: string,
  cwd: string,
  clear: boolean,
  env?: Record<string, string>,
): void {
  const channel = getOutputChannel();
  if (clear) {
    channel.clear();
  }
  channel.show(true);
  channel.appendLine(`> ${command}`);

  stopRunning();
  activeChild = spawn(command, {
    cwd,
    shell: true,
    env: env ? { ...process.env, ...env } : process.env,
  });
  activeChild.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
  activeChild.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
  activeChild.on('close', (code) => {
    channel.appendLine(`\n[Done] exit code ${code ?? 0}`);
    activeChild = undefined;
  });
}

/** Stop any in-flight output-channel run. */
export function stopRunning(): void {
  if (activeChild) {
    activeChild.kill();
    activeChild = undefined;
  }
}

export function disposeRunner(): void {
  stopRunning();
  terminal?.dispose();
  outputChannel?.dispose();
}
