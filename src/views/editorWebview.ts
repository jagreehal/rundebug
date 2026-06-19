import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { ConfigStore } from '../config/store';
import type { RunConfig } from '../config/types';

const nonce = (): string => randomBytes(16).toString('base64');

/** Open the GUI editor for a new or existing run configuration. */
export function openConfigEditor(
  store: ConfigStore,
  existing?: RunConfig,
): void {
  const panel = vscode.window.createWebviewPanel(
    'rundebugConfigEditor',
    existing ? `Edit: ${existing.name}` : 'New Run Configuration',
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true },
  );

  panel.webview.html = render(panel.webview, existing);

  panel.webview.onDidReceiveMessage(async (msg: InboundMessage) => {
    switch (msg.type) {
      case 'save': {
        const cfg = msg.config;
        if (!cfg.name?.trim() || !cfg.file?.trim()) {
          void vscode.window.showWarningMessage(
            'Run/Debug: name and file are required.',
          );
          return;
        }
        await store.upsert({ ...cfg, ...(existing ? { id: existing.id } : {}) });
        panel.dispose();
        break;
      }
      case 'pickFile': {
        const picked = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: 'Select target file',
        });
        if (picked?.[0]) {
          const folder = vscode.workspace.getWorkspaceFolder(picked[0]);
          const rel = folder
            ? vscode.workspace.asRelativePath(picked[0], false)
            : picked[0].fsPath;
          void panel.webview.postMessage({ type: 'filePicked', file: rel });
        }
        break;
      }
    }
  });
}

type InboundMessage =
  | { type: 'save'; config: Omit<RunConfig, 'id'> }
  | { type: 'pickFile' };

function render(webview: vscode.Webview, cfg?: RunConfig): string {
  const n = nonce();
  const data = JSON.stringify(cfg ?? null);
  const csp =
    `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; ` +
    `script-src 'nonce-${n}';`;

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
  h2 { margin-top: 0; }
  label { display: block; margin: 14px 0 4px; font-weight: 600; }
  input, select { width: 100%; box-sizing: border-box; padding: 6px 8px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; }
  .row { display: flex; gap: 8px; }
  .row > * { flex: 1; }
  .file-row { display: flex; gap: 8px; }
  .file-row input { flex: 1; }
  button { padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer;
    background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  td { padding: 2px 4px 2px 0; }
  .actions { margin-top: 22px; display: flex; gap: 8px; }
  .hint { opacity: 0.7; font-size: 0.85em; font-weight: 400; }
</style>
</head>
<body>
  <h2>Run Configuration</h2>

  <label>Name</label>
  <input id="name" placeholder="e.g. Run server" />

  <label>Target file <span class="hint">workspace-relative</span></label>
  <div class="file-row">
    <input id="file" placeholder="src/index.ts" />
    <button class="secondary" id="browse">Browse…</button>
  </div>

  <div class="row">
    <div>
      <label>Mode</label>
      <select id="mode">
        <option value="run">Run</option>
        <option value="debug">Debug</option>
      </select>
    </div>
    <div>
      <label>Runtime <span class="hint">optional</span></label>
      <input id="runtime" placeholder="tsx · bun · deno · uv · node" />
    </div>
  </div>

  <label>Language id <span class="hint">optional — usually auto-detected</span></label>
  <input id="languageId" placeholder="auto-detect" />

  <label>Arguments <span class="hint">space-separated</span></label>
  <input id="args" placeholder="--port 3000" />

  <label>Custom command <span class="hint">optional — overrides runtime; placeholders like {file}</span></label>
  <input id="command" placeholder="e.g. bun --hot {file}" />

  <label>Working directory <span class="hint">optional</span></label>
  <input id="cwd" placeholder="defaults to the file's folder" />

  <label>Environment variables</label>
  <table id="env"><tbody></tbody></table>
  <button class="secondary" id="addEnv" style="margin-top:8px;">+ Add variable</button>

  <div class="actions">
    <button id="save">Save</button>
  </div>

<script nonce="${n}">
  const vscode = acquireVsCodeApi();
  const existing = ${data};

  const $ = (id) => document.getElementById(id);
  const envBody = document.querySelector('#env tbody');

  function addEnvRow(key = '', value = '') {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input class="env-key" placeholder="KEY" /></td>' +
      '<td><input class="env-val" placeholder="value" /></td>' +
      '<td><button class="secondary remove">✕</button></td>';
    tr.querySelector('.env-key').value = key;
    tr.querySelector('.env-val').value = value;
    tr.querySelector('.remove').addEventListener('click', () => tr.remove());
    envBody.appendChild(tr);
  }

  if (existing) {
    $('name').value = existing.name || '';
    $('file').value = existing.file || '';
    $('mode').value = existing.mode || 'run';
    $('runtime').value = existing.runtime || '';
    $('languageId').value = existing.languageId || '';
    $('args').value = (existing.args || []).join(' ');
    $('command').value = existing.command || '';
    $('cwd').value = existing.cwd || '';
    for (const [k, v] of Object.entries(existing.env || {})) addEnvRow(k, v);
  }

  $('addEnv').addEventListener('click', () => addEnvRow());
  $('browse').addEventListener('click', () => vscode.postMessage({ type: 'pickFile' }));

  window.addEventListener('message', (e) => {
    if (e.data?.type === 'filePicked') $('file').value = e.data.file;
  });

  $('save').addEventListener('click', () => {
    const env = {};
    for (const row of envBody.querySelectorAll('tr')) {
      const k = row.querySelector('.env-key').value.trim();
      const v = row.querySelector('.env-val').value;
      if (k) env[k] = v;
    }
    const argsStr = $('args').value.trim();
    const config = {
      name: $('name').value.trim(),
      file: $('file').value.trim(),
      mode: $('mode').value,
      runtime: $('runtime').value.trim() || undefined,
      languageId: $('languageId').value.trim() || undefined,
      args: argsStr ? argsStr.split(/\\s+/) : undefined,
      command: $('command').value.trim() || undefined,
      cwd: $('cwd').value.trim() || undefined,
      env: Object.keys(env).length ? env : undefined,
    };
    vscode.postMessage({ type: 'save', config });
  });
</script>
</body>
</html>`;
}
