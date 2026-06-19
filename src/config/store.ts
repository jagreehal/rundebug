import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import type { RunConfig } from './types';

const REL_PATH = '.vscode/rundebug.json';

/** Persists run configurations to `.vscode/rundebug.json` so they can be committed. */
export class ConfigStore {
  private configs: RunConfig[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChange = this._onDidChange.event;

  private fileUri(): vscode.Uri | undefined {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? vscode.Uri.joinPath(folder.uri, REL_PATH) : undefined;
  }

  async load(): Promise<void> {
    const uri = this.fileUri();
    if (!uri) {
      this.configs = [];
      this._onDidChange.fire();
      return;
    }
    try {
      const buf = await vscode.workspace.fs.readFile(uri);
      const parsed = JSON.parse(Buffer.from(buf).toString('utf8'));
      this.configs = Array.isArray(parsed?.configurations)
        ? (parsed.configurations as RunConfig[])
        : [];
    } catch {
      this.configs = [];
    }
    this._onDidChange.fire();
  }

  private async persist(): Promise<void> {
    const uri = this.fileUri();
    if (!uri) {
      void vscode.window.showWarningMessage(
        'Run/Debug: open a folder to save run configurations.',
      );
      return;
    }
    const body = JSON.stringify(
      { version: 1, configurations: this.configs },
      null,
      2,
    );
    await vscode.workspace.fs.writeFile(uri, Buffer.from(body, 'utf8'));
    this._onDidChange.fire();
  }

  list(): readonly RunConfig[] {
    return this.configs;
  }

  get(id: string): RunConfig | undefined {
    return this.configs.find((c) => c.id === id);
  }

  async upsert(cfg: Omit<RunConfig, 'id'> & { id?: string }): Promise<RunConfig> {
    const full: RunConfig = { ...cfg, id: cfg.id ?? randomUUID() };
    const idx = this.configs.findIndex((c) => c.id === full.id);
    if (idx >= 0) {
      this.configs[idx] = full;
    } else {
      this.configs.push(full);
    }
    await this.persist();
    return full;
  }

  async remove(id: string): Promise<void> {
    this.configs = this.configs.filter((c) => c.id !== id);
    await this.persist();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
