import * as path from 'node:path';
import * as vscode from 'vscode';
import type { RunContext } from '../runners/types';

/** Build a RunContext for a file uri, resolving the workspace folder. */
export function contextForUri(uri: vscode.Uri, selection?: string): RunContext {
  const filePath = uri.fsPath;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  const workspaceFolder = folder?.uri.fsPath ?? path.dirname(filePath);
  const ext = path.extname(filePath);
  return {
    filePath,
    fileBasename: path.basename(filePath),
    fileBasenameNoExt: path.basename(filePath, ext),
    fileDirname: path.dirname(filePath),
    workspaceFolder,
    relativeFile: path.relative(workspaceFolder, filePath),
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
