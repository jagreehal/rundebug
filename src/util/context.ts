import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RunContext } from '../runners/types';
import { trustedConfig } from './trust';

/**
 * Configured directory for compiled binaries, or undefined to use the file's
 * own directory. A workspace value applies only when the workspace is trusted.
 */
function compiledOutputDir(workspaceFolder: string): string | undefined {
  const dir = trustedConfig<string>('rundebug', 'compiledOutputDirectory');
  if (!dir) {
    return undefined;
  }
  return path.isAbsolute(dir) ? dir : path.join(workspaceFolder, dir);
}

/** Build a RunContext for a file uri, resolving the workspace folder. */
export function contextForUri(uri: vscode.Uri, selection?: string): RunContext {
  const filePath = uri.fsPath;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const workspaceFolder = folder?.uri.fsPath ?? path.dirname(filePath);
  const ext = path.extname(filePath);
  const fileDirname = path.dirname(filePath);
  const outputDir = compiledOutputDir(workspaceFolder);
  return {
    filePath,
    fileBasename: path.basename(filePath),
    fileBasenameNoExt: path.basename(filePath, ext),
    fileDirname,
    workspaceFolder,
    relativeFile: path.relative(workspaceFolder, filePath),
    ...(outputDir ? { outputDir } : {}),
    ...(selection ? { selection } : {}),
  };
}

/** The workspace folder for a uri, or the first workspace folder, or undefined. */
export function workspaceFolderForUri(
  uri: vscode.Uri,
): vscode.WorkspaceFolder | undefined {
  return (
    vscode.workspace.getWorkspaceFolder(uri) ??
    vscode.workspace.workspaceFolders?.[0]
  );
}
