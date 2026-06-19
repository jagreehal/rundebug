import type { LanguageRunner, RunContext, RuntimeVariant } from './types';

/** Quote a path for safe shell use. */
const q = (s: string): string => `"${s}"`;

/** Single-runtime helper for languages with no meaningful alternatives. */
function single(
  id: string,
  label: string,
  extensions: string[],
  run: (c: RunContext) => string,
  debug?: RuntimeVariant['debug'],
): LanguageRunner {
  return {
    id,
    label,
    extensions,
    defaultRuntime: 'default',
    runtimes: { default: { label, run, ...(debug ? { debug } : {}) } },
  };
}

/**
 * Helper for compiled languages: build with debug symbols, then debug the
 * produced binary under CodeLLDB. `file`/`out` are pre-quoted shell paths.
 */
function compiled(
  id: string,
  label: string,
  extensions: string[],
  cmds: (file: string, out: string) => { run: string; compile: string },
): LanguageRunner {
  const out = (c: RunContext): string => `${c.fileDirname}/${c.fileBasenameNoExt}`;
  return {
    id,
    label,
    extensions,
    defaultRuntime: 'default',
    runtimes: {
      default: {
        label,
        run: (c) => cmds(q(c.filePath), q(out(c))).run,
        debug: {
          type: 'lldb',
          requiresExtension: 'vadimcn.vscode-lldb',
          compile: (c) => cmds(q(c.filePath), q(out(c))).compile,
          build: (c) => ({ program: out(c) }),
        },
      },
    },
  };
}

/**
 * Built-in language runners. Languages with several popular runtimes expose them
 * as named variants the user can pick in settings (`rundebug.runtime.<language>`).
 */
const RUNNERS: LanguageRunner[] = [
  {
    id: 'javascript',
    label: 'JavaScript',
    extensions: ['.js', '.cjs', '.mjs'],
    defaultRuntime: 'node',
    runtimes: {
      node: {
        label: 'Node.js',
        run: (c) => `node ${q(c.filePath)}`,
        debug: {
          type: 'node',
          build: (c) => ({
            program: c.filePath,
            skipFiles: ['<node_internals>/**'],
          }),
        },
      },
      bun: {
        label: 'Bun',
        run: (c) => `bun ${q(c.filePath)}`,
        debug: {
          type: 'bun',
          requiresExtension: 'oven.bun-vscode',
          build: (c) => ({ program: c.filePath }),
        },
      },
      deno: {
        label: 'Deno',
        run: (c) => `deno run -A ${q(c.filePath)}`,
      },
    },
  },
  {
    id: 'typescript',
    label: 'TypeScript',
    // .tsx files report languageId `typescriptreact`; they resolve here by extension.
    extensions: ['.ts', '.cts', '.mts', '.tsx'],
    defaultRuntime: 'tsx',
    runtimes: {
      tsx: {
        label: 'tsx',
        run: (c) => `npx --yes tsx ${q(c.filePath)}`,
        debug: {
          type: 'node',
          build: (c) => ({
            program: c.filePath,
            runtimeArgs: ['--import', 'tsx'],
            skipFiles: ['<node_internals>/**'],
          }),
        },
      },
      bun: {
        label: 'Bun',
        run: (c) => `bun ${q(c.filePath)}`,
        debug: {
          type: 'bun',
          requiresExtension: 'oven.bun-vscode',
          build: (c) => ({ program: c.filePath }),
        },
      },
      'ts-node': {
        label: 'ts-node',
        run: (c) => `npx --yes ts-node ${q(c.filePath)}`,
        debug: {
          type: 'node',
          build: (c) => ({
            program: c.filePath,
            runtimeArgs: ['-r', 'ts-node/register'],
            skipFiles: ['<node_internals>/**'],
          }),
        },
      },
      deno: {
        label: 'Deno',
        run: (c) => `deno run -A ${q(c.filePath)}`,
      },
      node: {
        label: 'Node.js (type stripping)',
        run: (c) => `node ${q(c.filePath)}`,
        debug: {
          type: 'node',
          build: (c) => ({
            program: c.filePath,
            skipFiles: ['<node_internals>/**'],
          }),
        },
      },
    },
  },
  {
    id: 'python',
    label: 'Python',
    extensions: ['.py'],
    defaultRuntime: 'python3',
    runtimes: {
      python3: {
        label: 'python3',
        run: (c) => `python3 -u ${q(c.filePath)}`,
        debug: {
          type: 'debugpy',
          requiresExtension: 'ms-python.debugpy',
          build: (c) => ({ program: c.filePath, console: 'integratedTerminal' }),
        },
      },
      python: {
        label: 'python',
        run: (c) => `python -u ${q(c.filePath)}`,
        debug: {
          type: 'debugpy',
          requiresExtension: 'ms-python.debugpy',
          build: (c) => ({ program: c.filePath, console: 'integratedTerminal' }),
        },
      },
      uv: {
        label: 'uv run',
        run: (c) => `uv run ${q(c.filePath)}`,
        debug: {
          type: 'debugpy',
          requiresExtension: 'ms-python.debugpy',
          build: (c) => ({ program: c.filePath, console: 'integratedTerminal' }),
        },
      },
    },
  },
  {
    id: 'go',
    label: 'Go',
    extensions: ['.go'],
    defaultRuntime: 'default',
    runtimes: {
      default: {
        label: 'go run',
        run: (c) => `go run ${q(c.filePath)}`,
        debug: {
          type: 'go',
          requiresExtension: 'golang.go',
          build: (c) => ({ program: c.filePath, mode: 'auto' }),
        },
      },
    },
  },
  compiled('rust', 'Rust', ['.rs'], (file, out) => ({
    run: `rustc ${file} -o ${out} && ${out}`,
    compile: `rustc -g ${file} -o ${out}`,
  })),
  compiled('c', 'C', ['.c'], (file, out) => ({
    run: `gcc ${file} -o ${out} && ${out}`,
    compile: `gcc -g ${file} -o ${out}`,
  })),
  compiled('cpp', 'C++', ['.cpp', '.cc', '.cxx'], (file, out) => ({
    run: `g++ ${file} -o ${out} && ${out}`,
    compile: `g++ -g ${file} -o ${out}`,
  })),
  single('java', 'Java', ['.java'], (c) => `java ${q(c.filePath)}`),
  single('php', 'PHP', ['.php'], (c) => `php ${q(c.filePath)}`),
  single('ruby', 'Ruby', ['.rb'], (c) => `ruby ${q(c.filePath)}`),
  single('shellscript', 'Shell', ['.sh', '.bash'], (c) => `bash ${q(c.filePath)}`),
  single('powershell', 'PowerShell', ['.ps1'], (c) => `pwsh -File ${q(c.filePath)}`),
  single('lua', 'Lua', ['.lua'], (c) => `lua ${q(c.filePath)}`),
  single('perl', 'Perl', ['.pl'], (c) => `perl ${q(c.filePath)}`),
  single('r', 'R', ['.r', '.R'], (c) => `Rscript ${q(c.filePath)}`),
  single('dart', 'Dart', ['.dart'], (c) => `dart run ${q(c.filePath)}`),
  single('swift', 'Swift', ['.swift'], (c) => `swift ${q(c.filePath)}`),
  single('kotlin', 'Kotlin (script)', ['.kts'], (c) => `kotlinc -script ${q(c.filePath)}`),
  single('julia', 'Julia', ['.jl'], (c) => `julia ${q(c.filePath)}`),
  single('elixir', 'Elixir', ['.exs', '.ex'], (c) => `elixir ${q(c.filePath)}`),
  single('zig', 'Zig', ['.zig'], (c) => `zig run ${q(c.filePath)}`),
];

const byExtension = new Map<string, LanguageRunner>();
const byId = new Map<string, LanguageRunner>();
for (const r of RUNNERS) {
  byId.set(r.id, r);
  for (const ext of r.extensions) {
    byExtension.set(ext.toLowerCase(), r);
  }
}

export function runnerForExtension(ext: string): LanguageRunner | undefined {
  return byExtension.get(ext.toLowerCase());
}

export function runnerForLanguageId(languageId: string): LanguageRunner | undefined {
  return byId.get(languageId);
}

export function allRunners(): readonly LanguageRunner[] {
  return RUNNERS;
}

/** Resolve a runtime variant for a runner, honouring the chosen name. */
export function runtimeFor(
  runner: LanguageRunner,
  name?: string,
): RuntimeVariant {
  if (name && runner.runtimes[name]) {
    return runner.runtimes[name];
  }
  return runner.runtimes[runner.defaultRuntime];
}

/** Substitute `{placeholder}` tokens in a user-supplied command template. */
export function applyTemplate(template: string, ctx: RunContext): string {
  const map: Record<string, string> = {
    file: ctx.filePath,
    fileBasename: ctx.fileBasename,
    fileBasenameNoExt: ctx.fileBasenameNoExt,
    fileDirname: ctx.fileDirname,
    workspaceFolder: ctx.workspaceFolder,
    relativeFile: ctx.relativeFile,
  };
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in map ? map[key] : whole,
  );
}
