import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  prepareDebugConfiguration,
  resolveDefaultLanguageSelection,
  resolveRuntimeSelection,
  runBuildCommand,
} from '../runners/runtimeSupport';
import type { DebugTemplate } from '../runners/types';
import { contextForUri, workspaceFolderForUri } from '../util/context';
import { blockedByUntrustedPath } from '../util/trust';

/** Ensure the extension that provides a debug adapter is installed. */
export async function ensureExtension(id: string): Promise<boolean> {
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

/**
 * A `launch.json` configuration whose `program` resolves to `uri`, when the
 * user prefers their own debug configs over the generated one (#1195).
 */
function matchingLaunchConfig(
  uri: vscode.Uri,
  folder: vscode.WorkspaceFolder | undefined,
): vscode.DebugConfiguration | undefined {
  const prefer = vscode.workspace
    .getConfiguration('rundebug')
    .get<boolean>('preferLaunchConfig', false);
  if (!prefer) {
    return undefined;
  }
  const configs =
    vscode.workspace
      .getConfiguration('launch', folder?.uri)
      .get<vscode.DebugConfiguration[]>('configurations') ?? [];
  const target = path.normalize(uri.fsPath);
  const root = folder?.uri.fsPath ?? path.dirname(uri.fsPath);
  const substitute = (value: string): string =>
    value
      .replace(/\$\{file\}/g, uri.fsPath)
      .replace(/\$\{relativeFile\}/g, path.relative(root, uri.fsPath))
      .replace(/\$\{fileBasename\}/g, path.basename(uri.fsPath))
      .replace(
        /\$\{fileBasenameNoExtension\}/g,
        path.basename(uri.fsPath, path.extname(uri.fsPath)),
      )
      .replace(/\$\{fileDirname\}/g, path.dirname(uri.fsPath))
      .replace(/\$\{workspaceFolder\}/g, root);
  return configs.find(
    (c) =>
      typeof c.program === 'string' &&
      path.normalize(substitute(c.program)) === target,
  );
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
  if (blockedByUntrustedPath(uri)) {
    return;
  }
  await vscode.window.activeTextEditor?.document.save();

  // Prefer the user's own launch.json config for this file, when opted in.
  const launchFolder = workspaceFolderForUri(uri);
  const launchConfig = matchingLaunchConfig(uri, launchFolder);
  if (launchConfig) {
    await vscode.debug.startDebugging(launchFolder, launchConfig);
    return;
  }

  let selection = resolveRuntimeSelection(
    uri.fsPath,
    opts.languageId,
    opts.runtime,
  );
  let template: DebugTemplate | undefined = selection.variant?.debug;
  // An unmatched file falls back to the configured defaultLanguage, mirroring
  // the run resolver so a default applies to both Run and Debug.
  if (!template && !selection.runner && !opts.runtime) {
    const fallback = resolveDefaultLanguageSelection(uri.fsPath);
    if (fallback?.selection.variant?.debug) {
      selection = fallback.selection;
      template = fallback.selection.variant.debug;
    }
  }
  if (!template) {
    const label =
      selection.variant?.label ??
      selection.runner?.label ??
      path.basename(uri.fsPath);
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
    const ok = await runBuildCommand(template.compile(ctx), ctx.fileDirname);
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

  if (!(await prepareDebugConfiguration(selection, ctx, debugConfig))) {
    return;
  }

  const started = await vscode.debug.startDebugging(folder, debugConfig);
  if (!started) {
    void vscode.window.showErrorMessage(
      `Run/Debug: failed to start a ${template.type} debug session.`,
    );
  }
}
