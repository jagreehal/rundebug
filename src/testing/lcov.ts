/**
 * Minimal lcov `.info` parser, pure and unit-tested. Frameworks emit lcov from
 * their coverage reporters; the Test Explorer controller turns the result of this
 * into VS Code `FileCoverage`/`StatementCoverage` so coverage renders in the
 * gutter without building any instrumentation of our own.
 *
 * Records handled (one section per source file, terminated by `end_of_record`):
 *   SF:<path>                       source file
 *   DA:<line>,<hits>                line execution count
 *   FN:<line>,<name> / FNDA:<hits>,<name>   function definition + hit count
 *   BRDA:<line>,<block>,<branch>,<taken>    branch outcome (`-` means not taken)
 */

export interface LcovLineHit {
  line: number;
  hit: number;
}

export interface LcovFunctionHit {
  line: number;
  name: string;
  hit: number;
}

export interface LcovBranchHit {
  line: number;
  taken: boolean;
}

export interface LcovFileCoverage {
  /** Path exactly as recorded in `SF:` (may be absolute or workspace-relative). */
  file: string;
  lines: LcovLineHit[];
  functions: LcovFunctionHit[];
  branches: LcovBranchHit[];
}

function emptyFile(file: string): LcovFileCoverage {
  return { file, lines: [], functions: [], branches: [] };
}

/** Parse lcov text into one record per source file. */
export function parseLcov(text: string): LcovFileCoverage[] {
  const files: LcovFileCoverage[] = [];
  let current: LcovFileCoverage | undefined;
  // FNDA arrives separately from FN; index function hit counts by name to merge.
  let functionHits: Map<string, number> = new Map();

  const flush = (): void => {
    if (current) {
      for (const fn of current.functions) {
        fn.hit = functionHits.get(fn.name) ?? fn.hit;
      }
      files.push(current);
    }
    current = undefined;
    functionHits = new Map();
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      flush();
      current = emptyFile(line.slice(3));
    } else if (!current) {
      continue;
    } else if (line === 'end_of_record') {
      flush();
    } else if (line.startsWith('DA:')) {
      const [lineNo, hits] = line.slice(3).split(',');
      current.lines.push({ line: Number(lineNo), hit: Number(hits) });
    } else if (line.startsWith('FNDA:')) {
      const [hits, ...rest] = line.slice(5).split(',');
      functionHits.set(rest.join(','), Number(hits));
    } else if (line.startsWith('FN:')) {
      const [lineNo, ...rest] = line.slice(3).split(',');
      current.functions.push({
        line: Number(lineNo),
        name: rest.join(','),
        hit: 0,
      });
    } else if (line.startsWith('BRDA:')) {
      const [lineNo, , , taken] = line.slice(5).split(',');
      current.branches.push({
        line: Number(lineNo),
        taken: taken !== '-' && Number(taken) > 0,
      });
    }
  }
  flush();
  return files;
}
