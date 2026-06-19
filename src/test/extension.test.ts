import * as assert from 'node:assert';
import * as vscode from 'vscode';

describe('extension', () => {
  it('is installed in the test host', () => {
    assert.ok(
      vscode.extensions.getExtension('jagreehal.rundebug'),
      'jagreehal.rundebug should be present',
    );
  });

  it('activates and registers its core commands', async () => {
    const ext = vscode.extensions.getExtension('jagreehal.rundebug');
    await ext?.activate();

    const cmds = await vscode.commands.getCommands(true);
    const expected = [
      'rundebug.runFile',
      'rundebug.debugFile',
      'rundebug.runSelection',
      'rundebug.watchFile',
      'rundebug.newConfig',
      'rundebug.saveFromCurrentFile',
    ];
    for (const id of expected) {
      assert.ok(cmds.includes(id), `missing command: ${id}`);
    }
  });

  it('contributes runtime settings', () => {
    const cfg = vscode.workspace.getConfiguration('rundebug');
    assert.strictEqual(cfg.get('runtime.typescript'), 'tsx');
    assert.strictEqual(cfg.get('runtime.python'), 'python3');
  });
});
