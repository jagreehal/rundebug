import * as assert from 'node:assert';
import {
  selectCommand,
  type CommandSources,
  type ResolvedCommand,
} from '../runners/commandSelection';
import type { RuntimeSelection } from '../runners/runtimeSupport';
import type { LanguageRunner, RunContext } from '../runners/types';

const ctx: RunContext = {
  filePath: '/p/a.py',
  fileBasename: 'a.py',
  fileBasenameNoExt: 'a',
  fileDirname: '/p',
  workspaceFolder: '/p',
  relativeFile: 'a.py',
};

/** A selection whose runner has `id` and whose variant runs `command`. */
function selectionFor(
  id: string | undefined,
  command: string | undefined,
): RuntimeSelection {
  const runner: LanguageRunner | undefined = id
    ? { id, label: id, extensions: [], runtimes: {}, defaultRuntime: 'default' }
    : undefined;
  return {
    ...(runner ? { runner } : {}),
    ...(command !== undefined
      ? { variant: { label: id ?? 'x', run: () => command } }
      : {}),
  };
}

function sources(overrides: Partial<CommandSources>): CommandSources {
  return {
    fileExtension: '.py',
    executorMap: {},
    executorMapByFileExtension: {},
    selection: selectionFor('python', 'python3 -u /p/a.py'),
    ...overrides,
  };
}

const cmd = (r: ResolvedCommand | undefined): string | undefined => r?.command;

describe('selectCommand precedence', () => {
  it('runtime override wins over every configuration override', () => {
    const r = selectCommand(
      ctx,
      sources({
        runtimeOverride: 'bun',
        executorMap: { python: 'should-not-win' },
        selection: selectionFor('python', 'bun /p/a.py'),
      }),
    );
    assert.strictEqual(cmd(r), 'bun /p/a.py');
  });

  it('executorMap by languageId beats shebang and glob', () => {
    const r = selectCommand(
      ctx,
      sources({
        languageId: 'python',
        executorMap: { python: 'by-language {file}' },
        shebangCommand: '/bin/sh "/p/a.py"',
        globCommand: 'glob-cmd',
      }),
    );
    assert.strictEqual(cmd(r), 'by-language /p/a.py');
  });

  it('shebang beats glob and the runner', () => {
    const r = selectCommand(
      ctx,
      sources({ shebangCommand: '/bin/sh "/p/a.py"', globCommand: 'glob-cmd' }),
    );
    assert.strictEqual(cmd(r), '/bin/sh "/p/a.py"');
  });

  it('glob beats executorMap by runner id and byFileExtension', () => {
    const r = selectCommand(
      ctx,
      sources({
        globCommand: 'glob-cmd',
        executorMap: { python: 'by-id' },
        executorMapByFileExtension: { '.py': 'by-ext' },
      }),
    );
    assert.strictEqual(cmd(r), 'glob-cmd');
  });

  it('executorMap by runner id beats byFileExtension and the variant', () => {
    const r = selectCommand(
      ctx,
      sources({
        executorMap: { python: 'by-id {file}' },
        executorMapByFileExtension: { '.py': 'by-ext' },
      }),
    );
    assert.strictEqual(cmd(r), 'by-id /p/a.py');
  });

  it('byFileExtension beats the variant', () => {
    const r = selectCommand(
      ctx,
      sources({ executorMapByFileExtension: { '.py': 'by-ext {file}' } }),
    );
    assert.strictEqual(cmd(r), 'by-ext /p/a.py');
  });

  it('falls through to the runner variant', () => {
    assert.strictEqual(cmd(selectCommand(ctx, sources({}))), 'python3 -u /p/a.py');
  });

  it('uses the fallback last, carrying the fallback selection for prep', () => {
    const fallbackSelection = selectionFor('typescript', 'node {file}');
    const fallback: ResolvedCommand = {
      command: 'node /p/a.py',
      selection: fallbackSelection,
    };
    const r = selectCommand(
      ctx,
      sources({
        selection: selectionFor(undefined, undefined), // unmatched file
        fallback,
      }),
    );
    assert.strictEqual(cmd(r), 'node /p/a.py');
    // The fix for the prep-hook bug: prep must run against the fallback runner.
    assert.strictEqual(r?.selection, fallbackSelection);
  });

  it('marks config overrides verbatim (no prep), variants prepared', () => {
    // executorMap by runner id is an override → no selection → prep skipped.
    const override = selectCommand(
      ctx,
      sources({ executorMap: { python: 'node {file}' } }),
    );
    assert.strictEqual(override?.command, 'node /p/a.py');
    assert.strictEqual(override?.selection, undefined);

    // byFileExtension is likewise an override → no selection.
    const byExt = selectCommand(
      ctx,
      sources({ executorMapByFileExtension: { '.py': 'node {file}' } }),
    );
    assert.strictEqual(byExt?.selection, undefined);

    // The runner variant is prepared → selection present for prep hooks.
    const variant = selectCommand(ctx, sources({}));
    assert.ok(variant?.selection, 'variant command carries its selection');
  });

  it('returns undefined when nothing matches', () => {
    const r = selectCommand(
      ctx,
      sources({ selection: selectionFor(undefined, undefined) }),
    );
    assert.strictEqual(r, undefined);
  });
});
