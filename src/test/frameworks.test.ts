import * as assert from 'node:assert';
import {
  allFrameworks,
  detectFramework,
  frameworkById,
  type TestCommandContext,
  type TestSelector,
} from '../testing/frameworks';

const ctx: TestCommandContext = {
  filePath: '/proj/src/app.test.ts',
  relativeFile: 'src/app.test.ts',
  fileDirname: '/proj/src',
  workspaceFolder: '/proj',
  execPrefix: 'npx --yes',
  pythonCommand: 'python3',
};

const deps = (...names: string[]): Set<string> => new Set(names);
const sel = (name: string, ...ancestors: string[]): TestSelector => ({ name, ancestors });

describe('detectFramework', () => {
  it('honours an explicit override', () => {
    assert.strictEqual(
      detectFramework({
        languageId: 'typescript',
        extension: '.ts',
        packageDeps: deps('vitest'),
        override: 'jest',
      })?.id,
      'jest',
    );
  });

  it('ignores the "auto" override and detects from dependencies', () => {
    assert.strictEqual(
      detectFramework({
        languageId: 'typescript',
        extension: '.ts',
        packageDeps: deps('vitest'),
        override: 'auto',
      })?.id,
      'vitest',
    );
  });

  it('prefers vitest, then jest, then mocha for JS/TS', () => {
    const base = { languageId: 'typescript', extension: '.ts' as const };
    assert.strictEqual(detectFramework({ ...base, packageDeps: deps('vitest', 'jest') })?.id, 'vitest');
    assert.strictEqual(detectFramework({ ...base, packageDeps: deps('jest') })?.id, 'jest');
    assert.strictEqual(detectFramework({ ...base, packageDeps: deps('@jest/globals') })?.id, 'jest');
    assert.strictEqual(detectFramework({ ...base, packageDeps: deps('mocha') })?.id, 'mocha');
  });

  it('falls back to node:test for plain JS/TS with no test dependency', () => {
    assert.strictEqual(
      detectFramework({ languageId: 'javascript', extension: '.js', packageDeps: deps() })?.id,
      'node:test',
    );
    assert.strictEqual(
      detectFramework({ languageId: 'typescript', extension: '.ts', packageDeps: deps() })?.id,
      'node:test',
    );
  });

  it('does not offer the node:test fallback for JSX unless tsx is present', () => {
    // Native type stripping can't run JSX, so .tsx/.jsx get no zero-config runner.
    assert.strictEqual(
      detectFramework({ languageId: 'typescriptreact', extension: '.tsx', packageDeps: deps() }),
      undefined,
    );
    assert.strictEqual(
      detectFramework({ languageId: 'javascriptreact', extension: '.jsx', packageDeps: deps() }),
      undefined,
    );
    // With tsx available, the fallback can transform JSX.
    assert.strictEqual(
      detectFramework({ languageId: 'typescriptreact', extension: '.tsx', packageDeps: deps('tsx') })?.id,
      'node:test',
    );
  });

  it('maps languages to their ecosystem runners', () => {
    assert.strictEqual(detectFramework({ languageId: 'python', extension: '.py', packageDeps: deps() })?.id, 'pytest');
    assert.strictEqual(detectFramework({ languageId: 'go', extension: '.go', packageDeps: deps() })?.id, 'go');
    assert.strictEqual(detectFramework({ languageId: 'rust', extension: '.rs', packageDeps: deps() })?.id, 'cargo');
  });

  it('returns undefined for languages with no known framework', () => {
    assert.strictEqual(
      detectFramework({ languageId: 'plaintext', extension: '.txt', packageDeps: deps() }),
      undefined,
    );
  });
});

describe('framework commands', () => {
  it('vitest targets the relative file and a regex-escaped, shell-quoted name', () => {
    const v = frameworkById('vitest')!;
    assert.strictEqual(v.runFile(ctx), 'npx --yes vitest run "src/app.test.ts"');
    // `+` is regex-escaped to `\+`, then the backslash is shell-escaped to `\\`,
    // so the shell delivers `\+` and vitest matches a literal `+`.
    assert.strictEqual(
      v.runTest(ctx, sel('adds 1 + 1')),
      'npx --yes vitest run "src/app.test.ts" -t "adds 1 \\\\+ 1"',
    );
    assert.ok(v.runFileCoverage!(ctx).includes('--coverage.reporter=lcov'));
  });

  it('JS runners use the full suite path to disambiguate duplicate names', () => {
    // Two suites can each have a "works" test; the ancestors qualify it.
    assert.strictEqual(
      frameworkById('vitest')!.runTest(ctx, sel('works', 'math', 'add')),
      'npx --yes vitest run "src/app.test.ts" -t "math add works"',
    );
    assert.ok(
      frameworkById('mocha')!.runTest(ctx, sel('works', 'math')).includes('--grep "math works"'),
    );
  });

  it('jest filters by name with -t', () => {
    const j = frameworkById('jest')!;
    assert.strictEqual(j.runTest(ctx, sel('works')), 'npx --yes jest "src/app.test.ts" -t "works"');
  });

  it('node:test runs plain node, relying on native .ts type stripping', () => {
    const n = frameworkById('node:test')!;
    const js = { ...ctx, filePath: '/proj/src/app.test.js' };
    assert.strictEqual(n.runFile(js), 'node --test "/proj/src/app.test.js"');
    assert.ok(n.runTest(js, sel('works')).startsWith('node --test --test-name-pattern="works"'));
    // No removed/experimental flags: .ts relies on Node's built-in stripping.
    assert.strictEqual(n.runFile(ctx), 'node --test "/proj/src/app.test.ts"');
    assert.strictEqual(n.runFileCoverage, undefined);
  });

  it('node:test imports the tsx loader when configured (handles TS and JSX)', () => {
    const n = frameworkById('node:test')!;
    const tsx = { ...ctx, filePath: '/proj/src/app.test.tsx', nodeTestImport: 'tsx' };
    assert.strictEqual(
      n.runFile(tsx),
      'node --import tsx --test "/proj/src/app.test.tsx"',
    );
    assert.ok(
      n.runTest(tsx, sel('works')).startsWith('node --import tsx --test --test-name-pattern="works"'),
    );
  });

  it('pytest builds a path::Class::name node id from the ancestor chain', () => {
    const p = frameworkById('pytest')!;
    const c = { ...ctx, relativeFile: 'tests/test_app.py', pythonCommand: '/venv/bin/python' };
    assert.strictEqual(
      p.runTest(c, sel('test_adds')),
      '/venv/bin/python -m pytest "tests/test_app.py::test_adds"',
    );
    assert.strictEqual(
      p.runTest(c, sel('test_adds', 'TestApp')),
      '/venv/bin/python -m pytest "tests/test_app.py::TestApp::test_adds"',
    );
  });

  it('go test runs in the file directory, anchoring the name', () => {
    const g = frameworkById('go')!;
    assert.ok(g.runFile(ctx).startsWith('cd "/proj/src" && go test'));
    // The `$` anchor is shell-escaped (`\$`) so go receives the regex `^TestAdd$`.
    assert.ok(g.runTest(ctx, sel('TestAdd')).includes('go test -run "^TestAdd\\$"'));
  });

  it('exposes a node-terminal debug spec for JS frameworks', () => {
    const spec = frameworkById('vitest')!.debugSpec!(ctx, sel('works'));
    assert.strictEqual(spec?.type, 'node-terminal');
    assert.ok(String(spec?.config.command).includes('vitest run'));
  });

  it('exposes a debugpy spec for pytest, carrying the class path', () => {
    const spec = frameworkById('pytest')!.debugSpec!(ctx, sel('test_x', 'TestApp'));
    assert.strictEqual(spec?.type, 'debugpy');
    assert.strictEqual(spec?.requiresExtension, 'ms-python.debugpy');
    assert.deepStrictEqual(spec?.config.args, ['src/app.test.ts::TestApp::test_x']);
  });

  it('cargo has no debug support, so its debugSpec is absent', () => {
    // The Test Explorer relies on this being undefined to report Debug as
    // skipped (not passed) for cargo — see the controller debug handler.
    assert.strictEqual(frameworkById('cargo')!.debugSpec, undefined);
  });

  it('has no duplicate framework ids', () => {
    const ids = allFrameworks().map((f) => f.id);
    assert.strictEqual(new Set(ids).size, ids.length, `duplicate id in ${ids}`);
  });
});
