import * as vscode from 'vscode';
import type { ConfigStore } from '../config/store';
import type { RunConfig } from '../config/types';

/** Sidebar tree of saved run configurations. */
export class ConfigTreeProvider implements vscode.TreeDataProvider<RunConfig> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly store: ConfigStore) {
    this.store.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(cfg: RunConfig): vscode.TreeItem {
    const item = new vscode.TreeItem(
      cfg.name,
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = cfg.id;
    item.description = `${cfg.mode} · ${cfg.file}`;
    item.tooltip = `${cfg.name}\n${cfg.mode} ${cfg.file}`;
    item.contextValue = 'rundebugConfig';
    item.iconPath = new vscode.ThemeIcon(
      cfg.mode === 'debug' ? 'debug-alt' : 'play',
    );
    item.command = {
      command: 'rundebug.editConfig',
      title: 'Edit Configuration',
      arguments: [cfg],
    };
    return item;
  }

  getChildren(): RunConfig[] {
    return [...this.store.list()];
  }
}
