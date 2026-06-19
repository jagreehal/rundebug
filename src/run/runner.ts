import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  applyTemplate,
  runnerForExtension,
  runnerForLanguageId,
  runtimeFor,
} from '../runners/registry';
import type { RunContext } from '../runners/types';
import { contextForUri } from '../util/context';

const TERMINAL_NAME = 'Run/Debug';

let terminal: vscode.Terminal | undefined;
let outputChannel: vscode.OutputChannel | undefined;
let activeChild: ChildProcess | undefined;

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

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Run/Debug');
  }
  return outputChannel;
}

function getTerminal(clear: boolean): vscode.Terminal {
  if (clear && terminal) {
    terminal.dispose();
    terminal = undefined;
  }
  if (!terminal || terminal.exitStatus !== undefined) {
    terminal = vscode.window.createTerminal(TERMINAL_NAME);
  }
  return terminal;
}

/** Read a `#!` interpreter from the first line, if present. */
function parseShebang(filePath: string): string | undefined {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(256);
    const n = fs.readSync(fd, buf, 0, 256, 0);
    fs.closeSync(fd);
    const firstLine = buf.toString('utf8', 0, n).split(/\r?\n/, 1)[0];
    if (firstLine.startsWith('#!')) {
      return firstLine.slice(2).trim();
    }
  } catch {
    // ignore – fall back to the registry default
  }
  return undefined;
}

const quote = (s: string): string => `"${s}"`;

/** Resolve the base shell command to run a given context, or undefined if unknown. */
export function resolveCommand(
  ctx: RunContext,
  languageId?: string,
  runtimeOverride?: string,
): string | undefined {
  const cfg = config();
  const overrides = cfg.get<Record<string, string>>('executorMap', {});

  // A full command override always wins — unless the caller picked an explicit
  // runtime (e.g. a saved config asking for bun), which should be honoured.
  if (!runtimeOverride && languageId && overrides[languageId]) {
    return applyTemplate(overrides[languageId], ctx);
  }

  if (!runtimeOverride && cfg.get<boolean>('respectShebang', true)) {
    const shebang = parseShebang(ctx.filePath);
    if (shebang) {
      return `${shebang} ${quote(ctx.filePath)}`;
    }
  }

  const ext = path.extname(ctx.filePath);
  const runner =
    (languageId ? runnerForLanguageId(languageId) : undefined) ??
    runnerForExtension(ext);

  if (!runner) {
    return undefined;
  }
  if (!runtimeOverride && overrides[runner.id]) {
    return applyTemplate(overrides[runner.id], ctx);
  }

  // Honour the explicit/chosen runtime (e.g. bun / deno / uv), else the default.
  const runtimeName = runtimeOverride ?? cfg.get<string>(`runtime.${runner.id}`);
  const effective = runtimeName ?? runner.defaultRuntime;
  let command = runtimeFor(runner, runtimeName).run(ctx);

  // Native Node TS execution: inject the configured type-stripping flag.
  if (runner.id === 'typescript' && effective === 'node') {
    const flag = nodeTypeStrippingFlag();
    if (flag) {
      command = command.replace(/^node /, `node ${flag} `);
    }
  }
  return command;
}

/**
 * Flag for Node's native TypeScript execution, per `rundebug.node.typeStripping`.
 * `transform` also handles enums/namespaces; `strip` is erasable-syntax only.
 * Returns undefined when disabled. Requires Node 22.6+.
 */
export function nodeTypeStrippingFlag(): string | undefined {
  switch (config().get<string>('node.typeStripping', 'transform')) {
    case 'transform':
      return '--experimental-transform-types';
    case 'strip':
      return '--experimental-strip-types';
    default:
      return undefined;
  }
}

async function saveIfNeeded(): Promise<void> {
  if (config().get<boolean>('saveAllOnRun', true)) {
    await vscode.window.activeTextEditor?.document.save();
  }
}

function resolveCwd(cwd: string, ctx: RunContext): string {
  return path.isAbsolute(cwd) ? cwd : path.join(ctx.workspaceFolder, cwd);
}

/** Run the file at the given uri. */
export async function runUri(
  uri: vscode.Uri,
  opts: RunOptions = {},
): Promise<void> {
  await saveIfNeeded();

  const ctx = contextForUri(uri, opts.selection);
  // A fully custom command bypasses runtime resolution; otherwise resolve normally.
  let command = opts.command
    ? applyTemplate(opts.command, ctx)
    : resolveCommand(ctx, opts.languageId, opts.runtime);
  if (!command) {
    void vscode.window.showWarningMessage(
      `Run/Debug: no runner for ${path.basename(uri.fsPath)}. Add one via "rundebug.executorMap".`,
    );
    return;
  }
  if (opts.args?.length) {
    command += ` ${opts.args.map(quote).join(' ')}`;
  }

  const cwd = opts.cwd ? resolveCwd(opts.cwd, ctx) : ctx.fileDirname;
  const clear = config().get<boolean>('clearPreviousOutput', false);

  if (config().get<boolean>('runInTerminal', true)) {
    runInTerminal(command, cwd, clear, opts.env);
  } else {
    runInOutputChannel(command, cwd, clear, opts.env);
  }
}

function runInTerminal(
  command: string,
  cwd: string,
  clear: boolean,
  env?: Record<string, string>,
): void {
  // A custom env needs its own terminal; otherwise reuse the shared one.
  const term = env
    ? vscode.window.createTerminal({ name: TERMINAL_NAME, env })
    : getTerminal(clear);
  term.show(true);
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
