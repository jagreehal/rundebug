import * as assert from 'node:assert';
import {
  allRunners,
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

function ctxFor(filePath: string): RunContext {
  const fileBasename = filePath.split('/').pop()!;
  return {
    filePath,
    fileBasename,
    fileBasenameNoExt: fileBasename.replace(/\.[^.]+$/, ''),
    fileDirname: filePath.slice(0, filePath.length - fileBasename.length - 1),
    workspaceFolder: '/proj',
    relativeFile: filePath.replace('/proj/', ''),
  };
}

describe('registry', () => {
  it('resolves a runner by extension', () => {
    assert.strictEqual(runnerForExtension('.ts')?.id, 'typescript');
    assert.strictEqual(runnerForExtension('.tsx')?.id, 'typescript');
    assert.strictEqual(runnerForExtension('.py')?.id, 'python');
    assert.strictEqual(runnerForExtension('.zig')?.id, 'zig');
    assert.strictEqual(runnerForExtension('.kt')?.id, 'kotlin');
    assert.strictEqual(runnerForExtension('.nim')?.id, 'nim');
    assert.strictEqual(runnerForExtension('.erl')?.id, 'erlang');
    assert.strictEqual(runnerForExtension('.nope'), undefined);
  });

  it('resolves a runner by language id', () => {
    assert.strictEqual(runnerForLanguageId('python')?.id, 'python');
    assert.strictEqual(runnerForLanguageId('go')?.id, 'go');
    assert.strictEqual(runnerForLanguageId('rust')?.id, 'rust');
    assert.strictEqual(runnerForLanguageId('gleam')?.id, 'gleam');
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

  it('registers one kotlin runner that picks the command by extension', () => {
    assert.strictEqual(runnerForExtension('.kt')?.id, 'kotlin');
    assert.strictEqual(runnerForExtension('.kts')?.id, 'kotlin');
    // VS Code reports languageId `kotlin` for both — must be a single runner.
    assert.strictEqual(
      allRunners().filter((r) => r.id === 'kotlin').length,
      1,
    );
    const kotlin = runnerForExtension('.kt')!;
    assert.ok(
      runtimeFor(kotlin).run(ctxFor('/proj/Main.kt')).includes('-include-runtime'),
      '.kt compiles to a jar',
    );
    assert.ok(
      runtimeFor(kotlin).run(ctxFor('/proj/Main.kts')).includes('kotlinc -script'),
      '.kts runs as a script',
    );
  });

  it('covers the Code Runner parity languages added to the registry', () => {
    assert.strictEqual(runnerForExtension('.fsx')?.id, 'fsharp');
    assert.strictEqual(runnerForExtension('.csproj')?.id, 'dotnet');
    assert.strictEqual(runnerForExtension('.v')?.id, 'vlang');
    assert.strictEqual(runnerForExtension('.raku')?.id, 'raku');
    assert.strictEqual(runnerForExtension('.ring')?.id, 'ring');
    assert.strictEqual(runnerForExtension('.cu')?.id, 'cuda');
    // CUDA is compiled, so it inherits an lldb debug template.
    assert.ok(runtimeFor(runnerForExtension('.cu')!).debug, 'cuda debug (lldb)');
  });

  it('routes compiled binaries to ctx.outputDir when set (#1258)', () => {
    const c = runnerForExtension('.c')!;
    assert.ok(
      runtimeFor(c).run(ctxFor('/proj/src/app.c')).includes('/proj/src/app'),
      'defaults next to the source',
    );
    const withOut = { ...ctxFor('/proj/src/app.c'), outputDir: '/proj/build' };
    const cmd = runtimeFor(c).run(withOut);
    assert.ok(cmd.includes('/proj/build/app'), `expected /proj/build/app in: ${cmd}`);
    assert.ok(!cmd.includes('/proj/src/app '), 'no longer next to source');
  });

  it('has no duplicate runner ids', () => {
    const ids = allRunners().map((r) => r.id);
    assert.strictEqual(new Set(ids).size, ids.length, `duplicate id in ${ids}`);
  });

  it('substitutes command placeholders', () => {
    assert.strictEqual(applyTemplate('{fileBasename}', ctx), 'app.ts');
    assert.strictEqual(applyTemplate('{workspaceFolder}/x', ctx), '/proj/x');
    assert.strictEqual(applyTemplate('run {file} now', ctx), 'run /proj/src/app.ts now');
    assert.strictEqual(applyTemplate('$fileNameWithoutExt', ctx), 'app');
    assert.strictEqual(applyTemplate('$workspaceRoot/x', ctx), '/proj/x');
  });
});
