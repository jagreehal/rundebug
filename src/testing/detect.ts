/**
 * VS Code/`fs` side of test-framework resolution: gather the inputs the pure
 * {@link detectFramework} needs (project dependencies, package-manager exec
 * prefix, Python interpreter) and produce a ready-to-use framework plus its
 * {@link TestCommandContext}.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { selectedPythonInterpreter } from '../runners/runtimeSupport';
import { contextForUri } from '../util/context';
import { trustedConfig } from '../util/trust';
import {
  detectFramework,
  type TestCommandContext,
  type TestFramework,
} from './frameworks';

/** A resolved framework together with the context to build its commands. */
export interface ResolvedTest {
  framework: TestFramework;
  ctx: TestCommandContext;
}

/** Nearest ancestor file `name`, bounded by `stopDir` (inclusive). */
function nearestUp(startDir: string, stopDir: string, name: string): string | undefined {
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, name))) {
      return path.join(dir, name);
    }
    const parent = path.dirname(dir);
    if (dir === stopDir || parent === dir) {
      return undefined;
    }
    dir = parent;
  }
}

/** Dependency + devDependency names from the nearest package.json. */
function packageDeps(fileDir: string, workspaceFolder: string): Set<string> {
  const pkgPath = nearestUp(fileDir, workspaceFolder, 'package.json');
  if (!pkgPath) {
    return new Set();
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
  } catch {
    return new Set();
  }
}

/** Exec prefix for the project's package manager, chosen by its lockfile. */
function execPrefixFor(fileDir: string, workspaceFolder: string): string {
  if (nearestUp(fileDir, workspaceFolder, 'pnpm-lock.yaml')) {
    return 'pnpm exec';
  }
  if (nearestUp(fileDir, workspaceFolder, 'yarn.lock')) {
    return 'yarn';
  }
  if (nearestUp(fileDir, workspaceFolder, 'bun.lockb')) {
    return 'bunx';
  }
  return 'npx --yes';
}

/**
 * Resolve the test framework for a file and the context to build its commands,
 * or undefined when no framework applies. `languageId` is used when known (from
 * an open editor); otherwise the file extension drives detection.
 */
export async function resolveTest(
  uri: vscode.Uri,
  languageId?: string,
): Promise<ResolvedTest | undefined> {
  const runCtx = contextForUri(uri);
  const extension = path.extname(uri.fsPath).toLowerCase();
  // The override only selects among built-in, fixed command templates, so it is
  // harmless from a workspace — but read it through the trust chokepoint anyway.
  const override = trustedConfig<string>('rundebug', 'testFramework');

  const deps = packageDeps(runCtx.fileDirname, runCtx.workspaceFolder);
  const framework = detectFramework({
    languageId: languageId ?? '',
    extension,
    packageDeps: deps,
    override,
  });
  if (!framework) {
    return undefined;
  }

  const pythonCommand =
    (await selectedPythonInterpreter(runCtx)) ?? 'python3';

  const ctx: TestCommandContext = {
    filePath: runCtx.filePath,
    relativeFile: runCtx.relativeFile,
    fileDirname: runCtx.fileDirname,
    workspaceFolder: runCtx.workspaceFolder,
    execPrefix: execPrefixFor(runCtx.fileDirname, runCtx.workspaceFolder),
    pythonCommand,
    // tsx runs TypeScript (incl. JSX) for the node:test fallback across Node
    // versions; without it, node:test relies on native `.ts` stripping.
    ...(deps.has('tsx') ? { nodeTestImport: 'tsx' } : {}),
  };
  return { framework, ctx };
}
