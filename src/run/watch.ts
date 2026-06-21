import * as vscode from 'vscode';
import { runFileTests } from '../testing/run';
import { runUri, type RunOptions } from './runner';

interface Watch {
  uri: vscode.Uri;
  /** What to re-run when the file is saved (run the file, or its tests). */
  action: () => void | Promise<void>;
  disposable: vscode.Disposable;
}

/**
 * Re-runs a file (or its tests) whenever it is saved. One watch per file; a
 * status-bar item reflects the most recently started watch and offers a
 * one-click stop.
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

  /** Toggle watching a uri, re-running the whole file on save. */
  toggle(uri: vscode.Uri, opts: RunOptions = {}): boolean {
    return this.start(uri, () => runUri(uri, opts));
  }

  /** Toggle watching a uri, re-running its tests on save. */
  toggleTests(uri: vscode.Uri, languageId?: string): boolean {
    return this.start(uri, () => runFileTests(uri, languageId));
  }

  /** Start (or stop, if already watching) a watch with the given action. */
  private start(uri: vscode.Uri, action: () => void | Promise<void>): boolean {
    const key = uri.toString();
    if (this.watches.has(key)) {
      this.stop(uri);
      return false;
    }

    const disposable = vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.uri.toString() === key) {
        void action();
      }
    });
    this.watches.set(key, { uri, action, disposable });
    this.render();
    void action(); // run immediately on start
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

  /** URIs currently being watched, in start order. */
  list(): vscode.Uri[] {
    return [...this.watches.values()].map((w) => w.uri);
  }

  private render(): void {
    const n = this.watches.size;
    if (n === 0) {
      this.status.hide();
      return;
    }
    const last = [...this.watches.values()].at(-1)!;
    const name = last.uri.path.split('/').pop() ?? '';
    // One watch: click stops it. Several: click opens a per-file picker.
    this.status.text =
      n === 1
        ? `$(eye) Run/Debug: watching ${name}`
        : `$(eye) Run/Debug: watching ${n} files`;
    this.status.command =
      n === 1 ? 'rundebug.stopAllWatches' : 'rundebug.stopWatch';
    this.status.tooltip =
      n === 1 ? 'Click to stop watching' : 'Click to choose watches to stop';
    this.status.show();
  }

  dispose(): void {
    this.stopAll();
    this.status.dispose();
  }
}
