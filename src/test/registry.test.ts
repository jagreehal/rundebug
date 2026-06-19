import * as assert from 'node:assert';
import {
  applyTemplate,
  runnerForExtension,
  runnerForLanguageId,
  runtimeFor,
} from '../runners/registry';
import type { RunContext } from '../runners/types';

const ctx: RunContext = {
  filePath: '/proj/src/app.ts',
  fileBasename: 'app.ts',
  fileBasenameNoExt: 'app',
  fileDirname: '/proj/src',
  workspaceFolder: '/proj',
  relativeFile: 'src/app.ts',
};

describe('registry', () => {
  it('resolves a runner by extension', () => {
    assert.strictEqual(runnerForExtension('.ts')?.id, 'typescript');
    assert.strictEqual(runnerForExtension('.tsx')?.id, 'typescript');
    assert.strictEqual(runnerForExtension('.py')?.id, 'python');
    assert.strictEqual(runnerForExtension('.zig')?.id, 'zig');
    assert.strictEqual(runnerForExtension('.nope'), undefined);
  });

  it('resolves a runner by language id', () => {
    assert.strictEqual(runnerForLanguageId('python')?.id, 'python');
    assert.strictEqual(runnerForLanguageId('go')?.id, 'go');
  });

  it('honours explicit runtimes the user can pick', () => {
    const ts = runnerForExtension('.ts')!;
    assert.ok(runtimeFor(ts).run(ctx).includes('tsx'), 'default is tsx');
    assert.ok(runtimeFor(ts, 'bun').run(ctx).includes('bun'));
    assert.ok(runtimeFor(ts, 'deno').run(ctx).includes('deno'));
    assert.ok(runtimeFor(ts, 'ts-node').run(ctx).includes('ts-node'));

    const py = runnerForExtension('.py')!;
    assert.ok(runtimeFor(py, 'uv').run(ctx).includes('uv run'));

    const js = runnerForExtension('.js')!;
    assert.ok(runtimeFor(js, 'bun').run(ctx).includes('bun'));
  });

  it('falls back to the default for an unknown runtime', () => {
    const js = runnerForExtension('.js')!;
    assert.strictEqual(
      runtimeFor(js, 'does-not-exist').run(ctx),
      runtimeFor(js).run(ctx),
    );
  });

  it('exposes a debug template for debuggable runtimes', () => {
    assert.ok(runtimeFor(runnerForExtension('.ts')!, 'tsx').debug);
    assert.ok(runtimeFor(runnerForExtension('.rs')!).debug, 'rust debug (lldb)');
    assert.strictEqual(runtimeFor(runnerForExtension('.lua')!).debug, undefined);
  });

  it('substitutes command placeholders', () => {
    assert.strictEqual(applyTemplate('{fileBasename}', ctx), 'app.ts');
    assert.strictEqual(applyTemplate('{workspaceFolder}/x', ctx), '/proj/x');
    assert.strictEqual(applyTemplate('run {file} now', ctx), 'run /proj/src/app.ts now');
  });
});
