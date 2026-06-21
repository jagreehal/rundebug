/**
 * User-facing test actions: run a file's tests, run/debug a single test, and the
 * shared debug-session starter. These power the commands, CodeLenses and test
 * watch. Running reuses the extension's terminal/output plumbing via `runUri`;
 * the Test Explorer controller captures results itself and so runs directly.
 */
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ensureExtension } from '../debug/debugger';
import { runUri } from '../run/runner';
import { workspaceFolderForUri } from '../util/context';
import { blockedByUntrustedPath } from '../util/trust';
import { resolveTest } from './detect';
import type { TestDebugSpec, TestSelector } from './frameworks';

function warnNoFramework(uri: vscode.Uri): void {
  void vscode.window.showWarningMessage(
    `Run/Debug: no test framework detected for ${path.basename(uri.fsPath)}. Set "rundebug.testFramework" to choose one.`,
  );
}

/** Run every test in the file at `uri`. */
export async function runFileTests(
  uri: vscode.Uri,
  languageId?: string,
): Promise<void> {
  const resolved = await resolveTest(uri, languageId);
  if (!resolved) {
    warnNoFramework(uri);
    return;
  }
  await runUri(uri, { command: resolved.framework.runFile(resolved.ctx) });
}

/** Run a single test in the file at `uri`, selected by its fully-qualified path. */
export async function runTest(
  uri: vscode.Uri,
  sel: TestSelector,
  languageId?: string,
): Promise<void> {
  const resolved = await resolveTest(uri, languageId);
  if (!resolved) {
    warnNoFramework(uri);
    return;
  }
  await runUri(uri, { command: resolved.framework.runTest(resolved.ctx, sel) });
}

/**
 * Debug a single test (or the whole file when `sel` is omitted). Falls back to a
 * plain run when the framework can't be debugged here.
 */
export async function debugTest(
  uri: vscode.Uri,
  sel?: TestSelector,
  languageId?: string,
): Promise<void> {
  const resolved = await resolveTest(uri, languageId);
  if (!resolved) {
    warnNoFramework(uri);
    return;
  }
  const spec = resolved.framework.debugSpec?.(resolved.ctx, sel);
  if (!spec) {
    void vscode.window.showInformationMessage(
      `Run/Debug: debugging isn't supported for ${resolved.framework.label} tests — running instead.`,
    );
    const command = sel
      ? resolved.framework.runTest(resolved.ctx, sel)
      : resolved.framework.runFile(resolved.ctx);
    await runUri(uri, { command });
    return;
  }
  await startTestDebug(uri, spec, sel?.name);
}

/** Realise a {@link TestDebugSpec} into a VS Code debug session. */
export async function startTestDebug(
  uri: vscode.Uri,
  spec: TestDebugSpec,
  testName?: string,
): Promise<boolean> {
  if (blockedByUntrustedPath(uri)) {
    return false;
  }
  if (spec.requiresExtension && !(await ensureExtension(spec.requiresExtension))) {
    return false;
  }
  const label = testName ?? path.basename(uri.fsPath);
  const config: vscode.DebugConfiguration = {
    type: spec.type,
    request: 'launch',
    name: `Run/Debug: ${label}`,
    ...spec.config,
  };
  const started = await vscode.debug.startDebugging(
    workspaceFolderForUri(uri),
    config,
  );
  if (!started) {
    void vscode.window.showErrorMessage(
      `Run/Debug: failed to start a ${spec.type} debug session.`,
    );
  }
  return started;
}
