import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ConfigStore } from './config/store';
import type { RunConfig, RunMode } from './config/types';
import { debugUri } from './debug/debugger';
import { disposeRunner, runUri, stopRunning } from './run/runner';
import { WatchManager } from './run/watch';
import { ConfigTreeProvider } from './views/configTree';
import { openConfigEditor } from './views/editorWebview';

interface Target {
  uri: vscode.Uri;
  languageId?: string;
}

/** Resolve the command target from a passed resource uri or the active editor. */
function resolveTarget(uri?: vscode.Uri): Target | undefined {
  if (uri) {
    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === uri.toString(),
    );
    return { uri, ...(editor ? { languageId: editor.document.languageId } : {}) };
  }
  const editor = vscode.window.activeTextEditor;
  return editor
    ? { uri: editor.document.uri, languageId: editor.document.languageId }
    : undefined;
}

function configUri(cfg: RunConfig): vscode.Uri | undefined {
  if (path.isAbsolute(cfg.file)) {
    return vscode.Uri.file(cfg.file);
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? vscode.Uri.joinPath(folder.uri, cfg.file) : undefined;
}

async function executeConfig(cfg: RunConfig, mode: RunMode): Promise<void> {
  const uri = configUri(cfg);
  if (!uri) {
    void vscode.window.showWarningMessage(
      `Run/Debug: could not resolve "${cfg.file}".`,
    );
    return;
  }
  const opts = {
    ...(cfg.languageId ? { languageId: cfg.languageId } : {}),
    ...(cfg.runtime ? { runtime: cfg.runtime } : {}),
    ...(cfg.args ? { args: cfg.args } : {}),
    ...(cfg.cwd ? { cwd: cfg.cwd } : {}),
    ...(cfg.env ? { env: cfg.env } : {}),
  };
  if (mode === 'debug') {
    // A custom command can't drive the debug adapter; runtime still applies.
    await debugUri(uri, opts);
  } else {
    await runUri(uri, { ...opts, ...(cfg.command ? { command: cfg.command } : {}) });
  }
}

export async function activate(
  context: vscode.ExtensionContext,
): Promise<void> {
  const store = new ConfigStore();
  await store.load();

  const tree = new ConfigTreeProvider(store);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('rundebugConfigs', tree),
    store,
  );

  const reg = (id: string, fn: (...args: never[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  };

  reg('rundebug.runFile', async (uri?: vscode.Uri) => {
    const t = resolveTarget(uri);
    if (t) {
      await runUri(t.uri, t.languageId ? { languageId: t.languageId } : {});
    }
  });

  reg('rundebug.debugFile', async (uri?: vscode.Uri) => {
    const t = resolveTarget(uri);
    if (t) {
      await debugUri(t.uri, t.languageId ? { languageId: t.languageId } : {});
    }
  });

  reg('rundebug.runSelection', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showInformationMessage('Run/Debug: nothing selected.');
      return;
    }
    const text = editor.document.getText(editor.selection);
    const ext = path.extname(editor.document.fileName) || '.txt';
    const tmp = path.join(os.tmpdir(), `rundebug-snippet-${Date.now()}${ext}`);
    await fs.promises.writeFile(tmp, text, 'utf8');
    await runUri(vscode.Uri.file(tmp), {
      languageId: editor.document.languageId,
    });
  });

  reg('rundebug.stop', () => stopRunning());

  const watcher = new WatchManager();
  context.subscriptions.push(watcher);

  reg('rundebug.watchFile', (uri?: vscode.Uri) => {
    const t = resolveTarget(uri);
    if (t) {
      watcher.toggle(t.uri, t.languageId ? { languageId: t.languageId } : {});
    }
  });
  reg('rundebug.stopAllWatches', () => watcher.stopAll());

  reg('rundebug.newConfig', () => openConfigEditor(store));
  reg('rundebug.editConfig', (cfg: RunConfig) => openConfigEditor(store, cfg));
  reg('rundebug.runConfig', (cfg: RunConfig) => executeConfig(cfg, 'run'));
  reg('rundebug.debugConfig', (cfg: RunConfig) => executeConfig(cfg, 'debug'));

  reg('rundebug.deleteConfig', async (cfg: RunConfig) => {
    const ok = await vscode.window.showWarningMessage(
      `Delete "${cfg.name}"?`,
      { modal: true },
      'Delete',
    );
    if (ok === 'Delete') {
      await store.remove(cfg.id);
    }
  });

  reg('rundebug.saveFromCurrentFile', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage('Run/Debug: no active file.');
      return;
    }
    const rel = vscode.workspace.asRelativePath(editor.document.uri, false);

    const name = await vscode.window.showInputBox({
      prompt: 'Run configuration name',
      value: path.basename(rel),
    });
    if (!name) {
      return;
    }

    const modePick = await vscode.window.showQuickPick<
      vscode.QuickPickItem & { mode: RunMode }
    >(
      [
        { label: '$(play) Run', mode: 'run' },
        { label: '$(debug-alt) Debug', mode: 'debug' },
      ],
      { placeHolder: 'How should this configuration run?' },
    );
    if (!modePick) {
      return;
    }

    const cfg = await store.upsert({
      name,
      file: rel,
      mode: modePick.mode,
      languageId: editor.document.languageId,
    });

    const action = await vscode.window.showInformationMessage(
      `Run/Debug: saved "${cfg.name}".`,
      'Edit',
    );
    if (action === 'Edit') {
      openConfigEditor(store, cfg);
    }
  });

  context.subscriptions.push({ dispose: disposeRunner });
}

export function deactivate(): void {
  disposeRunner();
}
