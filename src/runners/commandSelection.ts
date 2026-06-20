import { applyTemplate } from './registry';
import type { RuntimeSelection } from './runtimeSupport';
import type { RunContext } from './types';

/** A resolved command, optionally paired with a selection to prepare it. */
export interface ResolvedCommand {
  command: string;
  /**
   * The runtime selection whose behavior hooks should prepare this command —
   * set only when the command came from a runtime's own `run()`. Verbatim
   * configuration overrides (executorMap, shebang, glob, by-extension) leave it
   * undefined so "override wins" and the user's command is never rewritten.
   */
  selection?: RuntimeSelection | undefined;
}

/** Look up a `{placeholder}` command template in a settings map. */
export function mappedCommand(
  map: Record<string, string>,
  key: string,
  ctx: RunContext,
): string | undefined {
  const template = key ? map[key] : undefined;
  return template ? applyTemplate(template, ctx) : undefined;
}

/**
 * Everything {@link selectCommand} needs, already read from settings/disk. Kept
 * free of `vscode`/`fs` so command precedence can be unit-tested headlessly.
 */
export interface CommandSources {
  languageId?: string | undefined;
  runtimeOverride?: string | undefined;
  fileExtension: string;
  executorMap: Record<string, string>;
  executorMapByFileExtension: Record<string, string>;
  /** Pre-built shebang command (`/bin/sh "file"`), or undefined. */
  shebangCommand?: string | undefined;
  /** Pre-matched glob command, already templated, or undefined. */
  globCommand?: string | undefined;
  /** Selection for the file itself. */
  selection: RuntimeSelection;
  /** Pre-resolved `defaultLanguage` fallback, used only as a last resort. */
  fallback?: ResolvedCommand | undefined;
}

/**
 * Pure command-precedence resolver. An explicit runtime pick bypasses every
 * configuration override; otherwise the configured maps, shebang, glob,
 * per-extension map, the file's own runner, and finally the defaultLanguage
 * fallback are tried in priority order.
 */
export function selectCommand(
  ctx: RunContext,
  sources: CommandSources,
): ResolvedCommand | undefined {
  const { selection } = sources;
  // A verbatim override: the user's command, never touched by runtime prep.
  const verbatim = (command: string | undefined): ResolvedCommand | undefined =>
    command === undefined ? undefined : { command };
  // A runtime command: paired with its selection so prep hooks can run.
  const prepared = (command: string | undefined): ResolvedCommand | undefined =>
    command === undefined ? undefined : { command, selection };

  if (sources.runtimeOverride) {
    return prepared(selection.variant?.run(ctx));
  }

  const candidates: Array<() => ResolvedCommand | undefined> = [
    () =>
      verbatim(
        sources.languageId
          ? mappedCommand(sources.executorMap, sources.languageId, ctx)
          : undefined,
      ),
    () => verbatim(sources.shebangCommand),
    () => verbatim(sources.globCommand),
    () =>
      verbatim(
        selection.runner
          ? mappedCommand(sources.executorMap, selection.runner.id, ctx)
          : undefined,
      ),
    () =>
      verbatim(
        mappedCommand(
          sources.executorMapByFileExtension,
          sources.fileExtension,
          ctx,
        ),
      ),
    () => prepared(selection.variant?.run(ctx)),
    () => sources.fallback,
  ];
  for (const candidate of candidates) {
    const resolved = candidate();
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}
