import * as assert from 'node:assert';
import { findTests, isTestFile, testAtLine } from '../testing/discovery';

describe('findTests', () => {
  it('finds describe/it across JS test styles', () => {
    const text = [
      "describe('math', () => {",
      "  it('adds', () => {});",
      "  test.only('subtracts', () => {});",
      '});',
    ].join('\n');
    const tests = findTests(text, 'typescript');
    assert.deepStrictEqual(
      tests.map((t) => `${t.kind}:${t.name}:${t.line}`),
      ['suite:math:0', 'test:adds:1', 'test:subtracts:2'],
    );
  });

  it('finds python test functions and Test classes', () => {
    const text = ['class TestApp:', '    def test_adds(self):', '        pass'].join('\n');
    const tests = findTests(text, 'python');
    assert.deepStrictEqual(
      tests.map((t) => `${t.kind}:${t.name}`),
      ['suite:TestApp', 'test:test_adds'],
    );
  });

  it('finds go test functions', () => {
    const tests = findTests('func TestAdd(t *testing.T) {', 'go');
    assert.deepStrictEqual(tests, [{ name: 'TestAdd', line: 0, kind: 'test', ancestors: [] }]);
  });

  it('finds rust tests only when attributed with #[test]', () => {
    const text = ['#[test]', 'fn it_adds() {}', '', 'fn helper() {}'].join('\n');
    const tests = findTests(text, 'rust');
    assert.deepStrictEqual(tests, [{ name: 'it_adds', line: 1, kind: 'test', ancestors: [] }]);
  });

  it('records the enclosing suite chain from indentation for JS', () => {
    const text = [
      "describe('outer', () => {",
      "  describe('inner', () => {",
      "    it('works', () => {});",
      '  });',
      "  it('sibling', () => {});",
      '});',
    ].join('\n');
    const tests = findTests(text, 'typescript');
    const byName = (n: string) => tests.find((t) => t.name === n)!;
    assert.deepStrictEqual(byName('works').ancestors, ['outer', 'inner']);
    // The inner suite closed by dedent, so the sibling only nests under outer.
    assert.deepStrictEqual(byName('sibling').ancestors, ['outer']);
  });

  it('records the enclosing class for python methods', () => {
    const text = ['class TestApp:', '    def test_adds(self):', '        pass'].join('\n');
    const tests = findTests(text, 'python');
    assert.deepStrictEqual(tests.find((t) => t.name === 'test_adds')!.ancestors, ['TestApp']);
  });

  it('returns nothing for unsupported languages', () => {
    assert.deepStrictEqual(findTests('it("x", () => {})', 'plaintext'), []);
  });
});

describe('testAtLine', () => {
  const tests = findTests(
    ["describe('s', () => {", "  it('a', () => {", '    expect(1).toBe(1);', "  });", "  it('b', () => {});", '});'].join('\n'),
    'typescript',
  );

  it('targets the test the cursor sits inside', () => {
    assert.strictEqual(testAtLine(tests, 2)?.name, 'a');
    assert.strictEqual(testAtLine(tests, 4)?.name, 'b');
  });

  it('falls back to the suite above the first test', () => {
    assert.strictEqual(testAtLine(tests, 0)?.name, 's');
  });
});

describe('isTestFile', () => {
  it('recognises common test-file conventions', () => {
    assert.ok(isTestFile('src/app.test.ts'));
    assert.ok(isTestFile('src/app.spec.js'));
    assert.ok(isTestFile('pkg/app_test.go'));
    assert.ok(isTestFile('tests/test_app.py'));
    assert.ok(isTestFile('src/__tests__/app.ts'));
  });

  it('rejects non-test files', () => {
    assert.ok(!isTestFile('src/app.ts'));
    assert.ok(!isTestFile('src/contest.ts'));
  });
});
