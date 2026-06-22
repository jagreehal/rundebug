/**
 * CodeLens provider placing "Run Test | Debug Test" above each test, and "Run
 * File Tests | Watch Tests" at the top of a test file. Backed by the pure
 * {@link findTests} scan and gated by `rundebug.testCodeLens`.
 */
import * as vscode from 'vscode';
import { findTests, isTestFile } from './discovery';

export const TEST_LENS_LANGUAGES = [
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'python',
  'go',
  'rust',
];

export class TestCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  constructor() {
    // Re-evaluate when the toggle setting changes.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('rundebug.testCodeLens')) {
        this._onDidChange.fire();
      }
    });
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (
      !vscode.workspace
        .getConfiguration('rundebug')
        .get<boolean>('testCodeLens', true)
    ) {
      return [];
    }
    const rel = vscode.workspace.asRelativePath(document.uri);
    const tests = findTests(document.getText(), document.languageId);
    // Only offer file-level lenses for files that look like tests, to avoid
    // noise on sources that merely contain a stray `test(` call.
    if (tests.length === 0 || !isTestFile(rel)) {
      return [];
    }

    const lenses: vscode.CodeLens[] = [];
    const top = new vscode.Range(0, 0, 0, 0);
    lenses.push(
      new vscode.CodeLens(top, {
        title: '$(play) Run File Tests',
        command: 'rundebug.runFileTests',
        arguments: [document.uri],
      }),
      new vscode.CodeLens(top, {
        title: '$(eye) Watch Tests',
        command: 'rundebug.watchTests',
        arguments: [document.uri],
      }),
    );

    for (const t of tests) {
      const range = new vscode.Range(t.line, 0, t.line, 0);
      const selector = { name: t.name, ancestors: t.ancestors };
      lenses.push(
        new vscode.CodeLens(range, {
          title: '$(play) Run Test',
          command: 'rundebug.runTest',
          arguments: [document.uri, selector],
        }),
        new vscode.CodeLens(range, {
          title: '$(debug-alt) Debug Test',
          command: 'rundebug.debugTest',
          arguments: [document.uri, selector],
        }),
      );
    }
    return lenses;
  }
}
