/**
 * Test-framework definitions and detection. Pure and free of `vscode`/`fs` so the
 * command precedence and per-framework command shapes can be unit-tested
 * headlessly, mirroring the approach in `runners/commandSelection.ts`.
 *
 * A framework turns a {@link TestCommandContext} into the shell command that runs
 * a whole file's tests, a single test by name, or the same under coverage, plus
 * an adapter-neutral {@link TestDebugSpec} the VS Code layer realises into a real
 * debug session.
 */

/** Quote a value for safe use as a double-quoted shell argument. */
const shellArg = (s: string): string => `"${s.replace(/(["$`\\])/g, '\\$1')}"`;

/** Escape regex metacharacters so a literal test name is matched verbatim. */
const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A test name turned into a shell-quoted, regex-escaped filter argument. */
const nameFilter = (name: string): string => shellArg(reEscape(name));

/**
 * A single test to target: its leaf title plus the enclosing suite/class titles
 * (outermost first). Frameworks fold this into a fully-qualified filter so a run
 * hits the intended test even when leaf names repeat across suites.
 */
export interface TestSelector {
  name: string;
  ancestors: string[];
}

/** The space-joined full title JS runners (`-t`/`--grep`) match against. */
const jsFullName = (sel: TestSelector): string =>
  [...sel.ancestors, sel.name].join(' ');

/** Everything a framework needs to build a command, already resolved. */
export interface TestCommandContext {
  /** Absolute path to the test file. */
  filePath: string;
  /** Workspace-relative path — preferred by JS runners for stable output. */
  relativeFile: string;
  /** Directory containing the file (package-scoped runners like `go test`). */
  fileDirname: string;
  /** Absolute workspace folder path. */
  workspaceFolder: string;
  /** Package-manager exec prefix for JS tools, e.g. `npx --yes`, `pnpm exec`. */
  execPrefix: string;
  /** Interpreter for Python tools, e.g. `python3` or an absolute venv path. */
  pythonCommand: string;
  /**
   * Loader the `node:test` fallback imports (`--import <x>`) to run TypeScript —
   * set to `tsx` when the project depends on it. Omitted otherwise, in which case
   * `node --test` relies on Node's built-in type stripping (`.ts` only, no JSX).
   */
  nodeTestImport?: string;
}

/**
 * An adapter-neutral debug request. The VS Code layer ensures `requiresExtension`
 * is installed, then starts a session of `type` with `config` merged in.
 */
export interface TestDebugSpec {
  /** Debug adapter type, e.g. `node-terminal`, `debugpy`, `go`. */
  type: string;
  /** Extension id that provides the adapter, when one is required. */
  requiresExtension?: string;
  /** Adapter-specific configuration fields. */
  config: Record<string, unknown>;
}

export interface TestFramework {
  /** Stable id, also the value stored in `rundebug.testFramework`. */
  id: string;
  /** Human label, shown in settings. */
  label: string;
  /** Command running every test in the file. */
  runFile(ctx: TestCommandContext): string;
  /** Command running a single test, selected by its fully-qualified path. */
  runTest(ctx: TestCommandContext, sel: TestSelector): string;
  /** Command running the file's tests with lcov coverage; omitted if unsupported. */
  runFileCoverage?(ctx: TestCommandContext): string;
  /** Debug request for a single test (or the whole file when `sel` is omitted). */
  debugSpec?(ctx: TestCommandContext, sel?: TestSelector): TestDebugSpec | undefined;
}

/** A node test command run in a js-debug terminal, which auto-attaches the debugger. */
function nodeTerminalDebug(command: string, cwd: string): TestDebugSpec {
  return { type: 'node-terminal', config: { command, cwd } };
}

const vitest: TestFramework = {
  id: 'vitest',
  label: 'Vitest',
  runFile: (c) => `${c.execPrefix} vitest run ${shellArg(c.relativeFile)}`,
  runTest: (c, sel) =>
    `${c.execPrefix} vitest run ${shellArg(c.relativeFile)} -t ${nameFilter(jsFullName(sel))}`,
  runFileCoverage: (c) =>
    `${c.execPrefix} vitest run ${shellArg(c.relativeFile)} --coverage --coverage.reporter=lcov --coverage.reportsDirectory=coverage`,
  debugSpec: (c, sel) =>
    nodeTerminalDebug(sel ? vitest.runTest(c, sel) : vitest.runFile(c), c.workspaceFolder),
};

const jest: TestFramework = {
  id: 'jest',
  label: 'Jest',
  runFile: (c) => `${c.execPrefix} jest ${shellArg(c.relativeFile)}`,
  runTest: (c, sel) =>
    `${c.execPrefix} jest ${shellArg(c.relativeFile)} -t ${nameFilter(jsFullName(sel))}`,
  runFileCoverage: (c) =>
    `${c.execPrefix} jest ${shellArg(c.relativeFile)} --coverage --coverageReporters=lcov --coverageDirectory=coverage`,
  debugSpec: (c, sel) =>
    nodeTerminalDebug(sel ? jest.runTest(c, sel) : jest.runFile(c), c.workspaceFolder),
};

const mocha: TestFramework = {
  id: 'mocha',
  label: 'Mocha',
  runFile: (c) => `${c.execPrefix} mocha ${shellArg(c.filePath)}`,
  runTest: (c, sel) =>
    `${c.execPrefix} mocha ${shellArg(c.filePath)} --grep ${nameFilter(jsFullName(sel))}`,
  runFileCoverage: (c) =>
    `${c.execPrefix} nyc --reporter=lcovonly --report-dir=coverage mocha ${shellArg(c.filePath)}`,
  debugSpec: (c, sel) =>
    nodeTerminalDebug(sel ? mocha.runTest(c, sel) : mocha.runFile(c), c.workspaceFolder),
};

// `node --test`, importing a loader (e.g. tsx) when one is configured. Without
// a loader, current Node strips types from `.ts` natively (but not JSX).
function nodeInvocation(c: TestCommandContext): string {
  return c.nodeTestImport
    ? `node --import ${c.nodeTestImport} --test`
    : 'node --test';
}

const nodeTest: TestFramework = {
  id: 'node:test',
  label: 'node:test',
  runFile: (c) => `${nodeInvocation(c)} ${shellArg(c.filePath)}`,
  // node:test matches the pattern against each test name, so the leaf suffices.
  runTest: (c, sel) =>
    `${nodeInvocation(c)} --test-name-pattern=${nameFilter(sel.name)} ${shellArg(c.filePath)}`,
  debugSpec: (c, sel) =>
    nodeTerminalDebug(sel ? nodeTest.runTest(c, sel) : nodeTest.runFile(c), c.workspaceFolder),
};

// pytest node id: `path::Class::test`, classes drawn from the ancestor chain.
const pytestNodeId = (c: TestCommandContext, sel?: TestSelector): string =>
  sel ? [c.relativeFile, ...sel.ancestors, sel.name].join('::') : c.relativeFile;

const pytest: TestFramework = {
  id: 'pytest',
  label: 'pytest',
  runFile: (c) => `${c.pythonCommand} -m pytest ${shellArg(c.relativeFile)}`,
  runTest: (c, sel) =>
    `${c.pythonCommand} -m pytest ${shellArg(pytestNodeId(c, sel))}`,
  runFileCoverage: (c) =>
    `${c.pythonCommand} -m pytest ${shellArg(c.relativeFile)} --cov --cov-report=lcov:coverage/lcov.info`,
  debugSpec: (c, sel) => ({
    type: 'debugpy',
    requiresExtension: 'ms-python.debugpy',
    config: {
      module: 'pytest',
      args: [pytestNodeId(c, sel)],
      console: 'integratedTerminal',
      cwd: c.workspaceFolder,
    },
  }),
};

const goTest: TestFramework = {
  id: 'go',
  label: 'go test',
  runFile: (c) => `cd ${shellArg(c.fileDirname)} && go test`,
  runTest: (c, sel) =>
    `cd ${shellArg(c.fileDirname)} && go test -run ${shellArg(`^${reEscape(sel.name)}$`)} -v`,
  debugSpec: (c, sel) => ({
    type: 'go',
    requiresExtension: 'golang.go',
    config: {
      mode: 'test',
      program: c.fileDirname,
      ...(sel ? { args: ['-test.run', `^${sel.name}$`] } : {}),
    },
  }),
};

const cargoTest: TestFramework = {
  id: 'cargo',
  label: 'cargo test',
  // Cargo runs the crate's test target; it can't target a single source file.
  runFile: (c) => `cd ${shellArg(c.workspaceFolder)} && cargo test`,
  runTest: (c, sel) =>
    `cd ${shellArg(c.workspaceFolder)} && cargo test ${shellArg(sel.name)}`,
};

const FRAMEWORKS: TestFramework[] = [
  vitest,
  jest,
  mocha,
  nodeTest,
  pytest,
  goTest,
  cargoTest,
];

const byId = new Map(FRAMEWORKS.map((f) => [f.id, f]));

export function frameworkById(id: string): TestFramework | undefined {
  return byId.get(id);
}

export function allFrameworks(): readonly TestFramework[] {
  return FRAMEWORKS;
}

/** Inputs for {@link detectFramework}, gathered by the VS Code layer. */
export interface FrameworkDetectionInput {
  /** VS Code language id of the file. */
  languageId: string;
  /** Lower-case file extension, including the dot. */
  extension: string;
  /** dependency + devDependency names from the nearest package.json (JS only). */
  packageDeps: ReadonlySet<string>;
  /** Explicit `rundebug.testFramework` id, or `auto`/undefined to detect. */
  override?: string | undefined;
}

const JS_LANGS = new Set([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
]);

/**
 * Resolve the framework for a file. An explicit override wins; otherwise the
 * language picks the ecosystem and, for JS, the project's dependencies pick the
 * runner (falling back to the always-available `node:test`).
 */
export function detectFramework(
  input: FrameworkDetectionInput,
): TestFramework | undefined {
  if (input.override && input.override !== 'auto') {
    return frameworkById(input.override);
  }
  if (input.languageId === 'python' || input.extension === '.py') {
    return pytest;
  }
  if (input.languageId === 'go' || input.extension === '.go') {
    return goTest;
  }
  if (input.languageId === 'rust' || input.extension === '.rs') {
    return cargoTest;
  }
  if (JS_LANGS.has(input.languageId) || isJsExtension(input.extension)) {
    if (input.packageDeps.has('vitest')) {
      return vitest;
    }
    if (input.packageDeps.has('jest') || input.packageDeps.has('@jest/globals')) {
      return jest;
    }
    if (input.packageDeps.has('mocha')) {
      return mocha;
    }
    // Zero-config fallback: Node's built-in runner, no install needed. Native
    // type stripping runs plain `.ts`/`.js`, but not JSX — only offer the
    // fallback for `.tsx`/`.jsx` when the project has tsx to transform them.
    if (isJsxFile(input) && !input.packageDeps.has('tsx')) {
      return undefined;
    }
    return nodeTest;
  }
  return undefined;
}

const JS_EXTENSIONS = new Set([
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.cts',
  '.mts',
  '.tsx',
]);

function isJsExtension(ext: string): boolean {
  return JS_EXTENSIONS.has(ext);
}

/** Whether the file carries JSX, which Node's native type stripping can't run. */
function isJsxFile(input: FrameworkDetectionInput): boolean {
  return (
    input.extension === '.tsx' ||
    input.extension === '.jsx' ||
    input.languageId === 'typescriptreact' ||
    input.languageId === 'javascriptreact'
  );
}
