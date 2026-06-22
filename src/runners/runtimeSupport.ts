import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  runnerForExtension,
  runnerForLanguageId,
  runtimeFor,
} from './registry';
import type { LanguageRunner, RunContext, RuntimeVariant } from './types';
import { trustedConfig } from '../util/trust';

let buildChannel: vscode.OutputChannel | undefined;

export interface RuntimeSelection {
  runner?: LanguageRunner;
  runtimeName?: string | undefined;
  effectiveRuntime?: string | undefined;
  variant?: RuntimeVariant;
}

interface RunPreparation {
  command: string;
  cwd: string;
}

interface DebugPreparation {
  config: Record<string, unknown>;
}

interface RuntimeBehavior {
  prepareRun?: (
    ctx: RunContext,
    prep: RunPreparation,
  ) => boolean | void | Promise<boolean | void>;
  prepareDebug?: (
    ctx: RunContext,
    prep: DebugPreparation,
  ) => boolean | void | Promise<boolean | void>;
}

function config() {
  return vscode.workspace.getConfiguration('rundebug');
}

/** Run a shell command, streaming output; resolves true on exit code 0. */
export function runBuildCommand(command: string, cwd: string): Promise<boolean> {
  if (!buildChannel) {
    buildChannel = vscode.window.createOutputChannel('Run/Debug Build');
  }
  const channel = buildChannel;
  channel.clear();
  channel.show(true);
  channel.appendLine(`> ${command}`);
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true });
    child.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
    child.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      if (code) {
        channel.appendLine(`\n[Build failed] exit code ${code}`);
      }
      resolve(code === 0);
    });
  });
}

function nodeTypeStrippingFlag(): string | undefined {
  switch (config().get<string>('node.typeStripping', 'transform')) {
    case 'transform':
      return '--experimental-transform-types';
    case 'strip':
      return '--experimental-strip-types';
    default:
      return undefined;
  }
}

function runtimeKey(runner: LanguageRunner, effectiveRuntime: string): string {
  return `${runner.id}:${effectiveRuntime}`;
}

/** Whether `pkg` resolves from the file's location (walking up node_modules). */
function packageIsInstalled(ctx: RunContext, pkg: string): boolean {
  try {
    createRequire(path.join(ctx.fileDirname, '_.js')).resolve(pkg);
    return true;
  } catch {
    return false;
  }
}

/** Nearest ancestor directory holding a package.json, bounded by `stopDir`. */
function nearestPackageDir(startDir: string, stopDir: string): string {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (dir === stopDir || parent === dir) {
      return stopDir;
    }
    dir = parent;
  }
}

/** Pick the install command for whichever package manager the project uses. */
function packageInstallCommand(dir: string, pkg: string): string {
  if (fs.existsSync(path.join(dir, 'pnpm-lock.yaml'))) {
    return `pnpm add -D ${pkg}`;
  }
  if (fs.existsSync(path.join(dir, 'yarn.lock'))) {
    return `yarn add -D ${pkg}`;
  }
  if (fs.existsSync(path.join(dir, 'bun.lockb'))) {
    return `bun add -d ${pkg}`;
  }
  return `npm install -D ${pkg}`;
}

/**
 * Ensure a runtime package is resolvable for debug adapters that can't
 * auto-install transient executors the way `npx --yes` can for Run.
 */
async function ensureDebugPackage(
  ctx: RunContext,
  pkg: string,
): Promise<boolean> {
  if (packageIsInstalled(ctx, pkg)) {
    return true;
  }
  const installDir = nearestPackageDir(ctx.fileDirname, ctx.workspaceFolder);
  const command = packageInstallCommand(installDir, pkg);
  const choice = await vscode.window.showWarningMessage(
    `Run/Debug: debugging needs the "${pkg}" package installed. Install it now (${command})?`,
    'Install',
    'Cancel',
  );
  if (choice !== 'Install') {
    return false;
  }
  const ok = await runBuildCommand(command, installDir);
  if (!ok) {
    void vscode.window.showErrorMessage(
      `Run/Debug: failed to install ${pkg} — see the "Run/Debug Build" output.`,
    );
    return false;
  }
  return true;
}

/**
 * The interpreter the Python extension has selected for this file (its venv,
 * conda env, etc.), so Run uses the same environment as IntelliSense and Debug
 * instead of a bare `python3`. Returns undefined when unavailable or disabled.
 */
export async function selectedPythonInterpreter(
  ctx: RunContext,
): Promise<string | undefined> {
  if (!config().get<boolean>('python.useSelectedInterpreter', true)) {
    return undefined;
  }
  const ext = vscode.extensions.getExtension('ms-python.python');
  if (!ext) {
    return undefined;
  }
  try {
    if (!ext.isActive) {
      await ext.activate();
    }
    const api = ext.exports as {
      environments?: {
        getActiveEnvironmentPath?: (resource?: vscode.Uri) => { path: string } | undefined;
      };
    };
    const resolved = api.environments?.getActiveEnvironmentPath?.(
      vscode.Uri.file(ctx.filePath),
    );
    return resolved?.path;
  } catch {
    return undefined;
  }
}

/** Run Python through the extension-selected interpreter so venvs are honoured. */
function pythonRunBehavior(interpreter: 'python3' | 'python'): RuntimeBehavior {
  return {
    prepareRun: async (ctx, prep) => {
      const selected = await selectedPythonInterpreter(ctx);
      if (selected) {
        prep.command = prep.command.replace(
          new RegExp(`^${interpreter} `),
          `"${selected}" `,
        );
      }
    },
  };
}

const RUNTIME_BEHAVIORS: Record<string, RuntimeBehavior> = {
  'python:python3': pythonRunBehavior('python3'),
  'python:python': pythonRunBehavior('python'),
  'typescript:node': {
    prepareRun: (_ctx, prep) => {
      const flag = nodeTypeStrippingFlag();
      if (flag) {
        prep.command = prep.command.replace(/^node /, `node ${flag} `);
      }
    },
    prepareDebug: (_ctx, prep) => {
      const flag = nodeTypeStrippingFlag();
      if (flag) {
        prep.config.runtimeArgs = [
          flag,
          ...((prep.config.runtimeArgs as string[] | undefined) ?? []),
        ];
      }
    },
  },
  'typescript:tsx': {
    prepareDebug: async (ctx, prep) => {
      if (!(await ensureDebugPackage(ctx, 'tsx'))) {
        return false;
      }
      prep.config.cwd ??= ctx.fileDirname;
      return true;
    },
  },
};

function behaviorFor(selection: RuntimeSelection): RuntimeBehavior | undefined {
  if (!selection.runner || !selection.effectiveRuntime) {
    return undefined;
  }
  return RUNTIME_BEHAVIORS[runtimeKey(selection.runner, selection.effectiveRuntime)];
}

/** Resolve the runner/runtime pair for a file, honouring explicit overrides. */
export function resolveRuntimeSelection(
  filePath: string,
  languageId?: string,
  runtimeOverride?: string,
): RuntimeSelection {
  const ext = path.extname(filePath);
  const runner =
    (languageId ? runnerForLanguageId(languageId) : undefined) ??
    runnerForExtension(ext);
  if (!runner) {
    return {};
  }
  const runtimeName = runtimeOverride ?? config().get<string>(`runtime.${runner.id}`);
  return {
    runner,
    runtimeName,
    effectiveRuntime: runtimeName ?? runner.defaultRuntime,
    variant: runtimeFor(runner, runtimeName),
  };
}

/**
 * Resolve the selection for the configured `defaultLanguage`, used as a shared
 * fallback by both the run resolver and the debugger when a file matches no
 * runner of its own.
 */
export function resolveDefaultLanguageSelection(
  filePath: string,
): { language: string; selection: RuntimeSelection } | undefined {
  const language = trustedConfig<string>('rundebug', 'defaultLanguage');
  if (!language) {
    return undefined;
  }
  return { language, selection: resolveRuntimeSelection(filePath, language) };
}

/** Apply any shared runtime-specific run behavior before executing the command. */
export async function prepareRunCommand(
  selection: RuntimeSelection,
  ctx: RunContext,
  prep: RunPreparation,
): Promise<boolean> {
  const behavior = behaviorFor(selection);
  if (!behavior?.prepareRun) {
    return true;
  }
  return (await behavior.prepareRun(ctx, prep)) !== false;
}

/** Apply any shared runtime-specific debug behavior before starting the session. */
export async function prepareDebugConfiguration(
  selection: RuntimeSelection,
  ctx: RunContext,
  config: Record<string, unknown>,
): Promise<boolean> {
  const behavior = behaviorFor(selection);
  if (!behavior?.prepareDebug) {
    return true;
  }
  return (await behavior.prepareDebug(ctx, { config })) !== false;
}
