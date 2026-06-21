/**
 * Pure, line-based discovery of tests in a source file. Used by both the CodeLens
 * provider (to place Run/Debug lenses) and the Test Explorer controller (to build
 * the test tree), and unit-tested headlessly. Deliberately lightweight: a regex
 * scan, not a parser — it errs toward finding the common `describe/it`, `def
 * test_`, `func Test`, and `#[test]` shapes rather than being exhaustive.
 */

export type TestKind = 'suite' | 'test';

export interface DiscoveredTest {
  /** The test or suite title. */
  name: string;
  /** 0-based line where the declaration starts. */
  line: number;
  kind: TestKind;
  /**
   * Enclosing suite/class titles, outermost first, inferred from indentation.
   * Used to build a fully-qualified selector (e.g. pytest `path::Class::test`,
   * or a Jest/Mocha full title) so targeted runs hit the right test.
   */
  ancestors: string[];
}

// describe(/suite(/context( with an optional .only/.skip/.each modifier.
const JS_SUITE =
  /^\s*(?:describe|suite|context)(?:\.\w+)*\s*(?:\.each\([^)]*\))?\s*\(\s*(['"`])(.+?)\1/;
// it(/test( with an optional modifier.
const JS_TEST =
  /^\s*(?:it|test)(?:\.\w+)*\s*(?:\.each\([^)]*\))?\s*\(\s*(['"`])(.+?)\1/;
const PY_CLASS = /^\s*class\s+(Test\w*)\s*[(:]/;
const PY_TEST = /^\s*(?:async\s+)?def\s+(test\w*)\s*\(/;
const GO_TEST = /^\s*func\s+((?:Test|Benchmark|Example|Fuzz)\w+)\s*\(/;
const RUST_ATTR = /^\s*#\[(?:\w+::)*(?:test|tokio::test)\]/;
const RUST_FN = /^\s*(?:async\s+)?fn\s+(\w+)\s*\(/;

const JS_LANGS = new Set([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
]);

/** Find the test and suite declarations in `text` for a given language. */
export function findTests(text: string, languageId: string): DiscoveredTest[] {
  const lines = text.split(/\r?\n/);
  if (JS_LANGS.has(languageId)) {
    return scan(lines, [
      [JS_SUITE, 'suite', 2],
      [JS_TEST, 'test', 2],
    ]);
  }
  if (languageId === 'python') {
    return scan(lines, [
      [PY_CLASS, 'suite', 1],
      [PY_TEST, 'test', 1],
    ]);
  }
  if (languageId === 'go') {
    return scan(lines, [[GO_TEST, 'test', 1]]);
  }
  if (languageId === 'rust') {
    return scanRust(lines);
  }
  return [];
}

type Matcher = [pattern: RegExp, kind: TestKind, group: number];

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * Match tests line by line, tracking enclosing suites by indentation: a suite
 * encloses everything indented more deeply than it, until a sibling/outer line
 * pops it. This approximates nesting well for conventionally-formatted code
 * (and exactly for Python, whose blocks are indentation).
 */
function scan(lines: string[], matchers: Matcher[]): DiscoveredTest[] {
  const found: DiscoveredTest[] = [];
  const stack: Array<{ indent: number; name: string }> = [];
  lines.forEach((line, index) => {
    for (const [pattern, kind, group] of matchers) {
      const m = pattern.exec(line);
      if (!m) {
        continue;
      }
      const indent = indentOf(line);
      while (stack.length && stack[stack.length - 1].indent >= indent) {
        stack.pop();
      }
      const name = m[group];
      found.push({ name, line: index, kind, ancestors: stack.map((s) => s.name) });
      if (kind === 'suite') {
        stack.push({ indent, name });
      }
      break;
    }
  });
  return found;
}

/** Rust marks tests with a `#[test]` attribute on the line(s) above `fn name`. */
function scanRust(lines: string[]): DiscoveredTest[] {
  const found: DiscoveredTest[] = [];
  let attributed = false;
  for (let i = 0; i < lines.length; i++) {
    if (RUST_ATTR.test(lines[i])) {
      attributed = true;
      continue;
    }
    const fn = RUST_FN.exec(lines[i]);
    if (fn && attributed) {
      found.push({ name: fn[1], line: i, kind: 'test', ancestors: [] });
    }
    // Any non-attribute, non-blank line clears a pending attribute.
    if (lines[i].trim() !== '' && !RUST_ATTR.test(lines[i])) {
      attributed = false;
    }
  }
  return found;
}

/**
 * The innermost test covering `line`: the declaration at or above the cursor with
 * the greatest line number. Suites only win when no test sits between them and
 * the cursor, so "run test at cursor" targets the test the caret is inside.
 */
export function testAtLine(
  tests: readonly DiscoveredTest[],
  line: number,
): DiscoveredTest | undefined {
  let best: DiscoveredTest | undefined;
  for (const t of tests) {
    if (t.line <= line && (!best || t.line > best.line)) {
      best = t;
    }
  }
  return best;
}

// `.test.`/`.spec.` (JS), `_test.`/`test_` (go/py), and common test directories.
const TEST_FILE = /(?:[._]test\.|[._]spec\.|(?:^|[\\/])test_)|(?:^|[\\/])(?:tests?|__tests__)[\\/]/i;

/** Whether a workspace-relative path looks like a test file by convention. */
export function isTestFile(relativePath: string): boolean {
  return TEST_FILE.test(relativePath);
}
