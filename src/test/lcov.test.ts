import * as assert from 'node:assert';
import { parseLcov } from '../testing/lcov';

describe('parseLcov', () => {
  it('parses lines, functions and branches per source file', () => {
    const text = [
      'TN:',
      'SF:/proj/src/app.ts',
      'FN:3,add',
      'FNDA:5,add',
      'DA:1,1',
      'DA:2,0',
      'DA:3,5',
      'BRDA:2,0,0,3',
      'BRDA:2,0,1,-',
      'end_of_record',
      'SF:/proj/src/util.ts',
      'DA:1,0',
      'end_of_record',
    ].join('\n');

    const files = parseLcov(text);
    assert.strictEqual(files.length, 2);

    const app = files[0];
    assert.strictEqual(app.file, '/proj/src/app.ts');
    assert.deepStrictEqual(app.lines, [
      { line: 1, hit: 1 },
      { line: 2, hit: 0 },
      { line: 3, hit: 5 },
    ]);
    // FNDA hit count is merged onto the FN entry by name.
    assert.deepStrictEqual(app.functions, [{ line: 3, name: 'add', hit: 5 }]);
    assert.deepStrictEqual(app.branches, [
      { line: 2, taken: true },
      { line: 2, taken: false },
    ]);

    assert.deepStrictEqual(files[1].lines, [{ line: 1, hit: 0 }]);
  });

  it('ignores records before any SF and tolerates a missing end_of_record', () => {
    const files = parseLcov('DA:1,1\nSF:/a.ts\nDA:1,2');
    assert.deepStrictEqual(files, [
      { file: '/a.ts', lines: [{ line: 1, hit: 2 }], functions: [], branches: [] },
    ]);
  });

  it('returns nothing for empty input', () => {
    assert.deepStrictEqual(parseLcov(''), []);
  });
});
