import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  runnerForExtension,
  runnerForLanguageId,
  runtimeFor,
} from '../runners/registry';
import { nodeTypeStrippingFlag } from '../run/runner';
import type { DebugTemplate } from '../runners/types';
import { contextForUri, workspaceFolderForUri } from '../util/context';

let buildChannel: vscode.OutputChannel | undefined;

/** Run a compile command, streaming output; resolves true on exit code 0. */
function runCompile(command: string, cwd: string): Promise<boolean> {
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

/** Ensure the extension that provides a debug adapter is installed. */
async function ensureExtension(id: string): Promise<boolean> {
  if (vscode.extensions.getExtension(id)) {
    return true;
  }
  const choice = await vscode.window.showInformationMessage(
    `Run/Debug: debugging needs the "${id}" extension.`,
    'Install',
    'Cancel',
  );
  if (choice !== 'Install') {
    return false;
  }
  await vscode.commands.executeCommand(
    'workbench.extensions.installExtension',
    id,
  );
  return vscode.extensions.getExtension(id) !== undefined;
}

interface DebugOpts {
  languageId?: string;
  name?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Explicit runtime variant (e.g. `bun`); overrides the configured default. */
  runtime?: string;
}

/** Start a debug session for the file at `uri`, delegating to VS Code's debug engine. */
export async function debugUri(
  uri: vscode.Uri,
  opts: DebugOpts = {},
): Promise<void> {
  await vscode.window.activeTextEditor?.document.save();

  const ext = path.extname(uri.fsPath);
  const runner =
    (opts.languageId ? runnerForLanguageId(opts.languageId) : undefined) ??
    runnerForExtension(ext);

  const runtimeName = runner
    ? (opts.runtime ??
      vscode.workspace
        .getConfiguration('rundebug')
        .get<string>(`runtime.${runner.id}`))
    : undefined;
  const variant = runner ? runtimeFor(runner, runtimeName) : undefined;

  const template: DebugTemplate | undefined = variant?.debug;
  if (!template) {
    const label = variant?.label ?? runner?.label ?? path.basename(uri.fsPath);
    void vscode.window.showWarningMessage(
      `Run/Debug: debugging isn't available for the ${label} runtime — switch runtime or use Run.`,
    );
    return;
  }

  if (template.requiresExtension) {
    const ok = await ensureExtension(template.requiresExtension);
    if (!ok) {
      return;
    }
  }

  const ctx = contextForUri(uri);

  // Compiled languages build a debug binary first; abort if the build fails.
  if (template.compile) {
    const ok = await runCompile(template.compile(ctx), ctx.fileDirname);
    if (!ok) {
      void vscode.window.showErrorMessage(
        'Run/Debug: build failed — see the "Run/Debug Build" output.',
      );
      return;
    }
  }

  const folder = workspaceFolderForUri(uri);

  const debugConfig: vscode.DebugConfiguration = {
    type: template.type,
    request: 'launch',
    name: opts.name ?? `Run/Debug: ${path.basename(uri.fsPath)}`,
    ...template.build(ctx),
    ...(opts.args ? { args: opts.args } : {}),
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.env ? { env: opts.env } : {}),
  };

  // Native Node TS execution needs the type-stripping flag passed to the runtime.
  if (runner?.id === 'typescript' && (runtimeName ?? runner.defaultRuntime) === 'node') {
    const flag = nodeTypeStrippingFlag();
    if (flag) {
      debugConfig.runtimeArgs = [flag, ...(debugConfig.runtimeArgs ?? [])];
    }
  }

  const started = await vscode.debug.startDebugging(folder, debugConfig);
  if (!started) {
    void vscode.window.showErrorMessage(
      `Run/Debug: failed to start a ${template.type} debug session.`,
    );
  }
}
