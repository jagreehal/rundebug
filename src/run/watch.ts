import * as vscode from 'vscode';
import { runUri, type RunOptions } from './runner';

interface Watch {
  uri: vscode.Uri;
  opts: RunOptions;
  disposable: vscode.Disposable;
}

/**
 * Re-runs a file whenever it is saved. One watch per file; a status-bar item
 * reflects the most recently started watch and offers a one-click stop.
 */
export class WatchManager {
  private readonly watches = new Map<string, Watch>();
  private readonly status: vscode.StatusBarItem;

  constructor() {
    this.status = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      0,
    );
    this.status.command = 'rundebug.stopAllWatches';
  }

  /** Toggle watching for a uri; returns true if now watching. */
  toggle(uri: vscode.Uri, opts: RunOptions = {}): boolean {
    const key = uri.toString();
    if (this.watches.has(key)) {
      this.stop(uri);
      return false;
    }

    const disposable = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.toString() === key) {
        void runUri(uri, opts);
      }
    });
    this.watches.set(key, { uri, opts, disposable });
    this.render();
    void runUri(uri, opts); // run immediately on start
    return true;
  }

  stop(uri: vscode.Uri): void {
    const key = uri.toString();
    const w = this.watches.get(key);
    if (w) {
      w.disposable.dispose();
      this.watches.delete(key);
      this.render();
    }
  }

  stopAll(): void {
    for (const w of this.watches.values()) {
      w.disposable.dispose();
    }
    this.watches.clear();
    this.render();
  }

  private render(): void {
    const n = this.watches.size;
    if (n === 0) {
      this.status.hide();
      return;
    }
    const last = [...this.watches.values()].at(-1)!;
    const name = last.uri.path.split('/').pop() ?? '';
    this.status.text =
      n === 1
        ? `$(eye) Run/Debug: watching ${name}`
        : `$(eye) Run/Debug: watching ${n} files`;
    this.status.tooltip = 'Click to stop watching';
    this.status.show();
  }

  dispose(): void {
    this.stopAll();
    this.status.dispose();
  }
}
