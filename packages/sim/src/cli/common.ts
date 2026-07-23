/**
 * @module cli/common
 *
 * Shared plumbing for the sim CLIs: flag parsing, agent registry lookup,
 * and deck-pair resolution.
 */

import type { Agent } from '../types.js';
import { createRandomAgent } from '../agents/random-agent.js';
import { createHeuristicAgent } from '../agents/heuristic-agent.js';
import { createNoisyHeuristicAgent } from '../agents/noisy-heuristic-agent.js';
import { loadDeck } from '../decks.js';
import type { LoadedDeck } from '../decks.js';

/** Parsed CLI arguments: positional list plus `--flag value` / `--flag` pairs. */
export interface CliArgs {
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
}

/** Parse `process.argv`-style arguments into positionals and flags. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next;
        i++;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

/** Read a numeric flag with a default. */
export function numberFlag(args: CliArgs, name: string, defaultValue: number): number {
  const raw = args.flags[name];
  if (raw === undefined || raw === true) return defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} expects a number, got "${raw}"`);
  return value;
}

/** Read a string flag; returns undefined when absent or valueless. */
export function stringFlag(args: CliArgs, name: string): string | undefined {
  const raw = args.flags[name];
  return raw === undefined || raw === true ? undefined : raw;
}

/** Available agent names for the CLIs. */
export const AGENT_NAMES = ['random', 'heuristic', 'noisy-heuristic'] as const;

/**
 * Instantiate an agent by registry spec. A spec is a name with an optional
 * `:parameter` suffix — `noisy-heuristic:0.75` blunders 75% of the time.
 */
export function resolveAgent(spec: string): Agent {
  const colon = spec.indexOf(':');
  const name = colon === -1 ? spec : spec.slice(0, colon);
  const param = colon === -1 ? undefined : spec.slice(colon + 1);
  switch (name) {
    case 'random': return createRandomAgent();
    case 'heuristic': return createHeuristicAgent();
    case 'noisy-heuristic': {
      const epsilon = param === undefined ? 0.5 : Number(param);
      if (!Number.isFinite(epsilon)) throw new Error(`noisy-heuristic expects a numeric ε, got "${param}"`);
      return createNoisyHeuristicAgent(epsilon);
    }
    default: throw new Error(`Unknown agent "${spec}" — available: ${AGENT_NAMES.join(', ')}`);
  }
}

/** Resolve a comma-separated list flag (any length), with a default. */
export function resolveList(args: CliArgs, name: string, defaults: readonly string[]): string[] {
  const raw = args.flags[name];
  if (raw === undefined || raw === true) return [...defaults];
  const parts = String(raw).split(',').map(p => p.trim()).filter(p => p.length > 0);
  return parts.length === 0 ? [...defaults] : parts;
}

/** Resolve a comma-separated pair flag (e.g. "--agents random,heuristic"). */
export function resolvePair(args: CliArgs, name: string, defaults: readonly [string, string]): [string, string] {
  const raw = args.flags[name];
  if (raw === undefined || raw === true) return [defaults[0], defaults[1]];
  const parts = String(raw).split(',').map(p => p.trim()).filter(p => p.length > 0);
  if (parts.length === 1) return [parts[0], parts[0]];
  if (parts.length !== 2) throw new Error(`--${name} expects one or two comma-separated values`);
  return [parts[0], parts[1]];
}

/** Load the two decks named by `--decks` (default challenge decks a/b). */
export function resolveDecks(args: CliArgs): [LoadedDeck, LoadedDeck] {
  const [d0, d1] = resolvePair(args, 'decks', ['challenge-deck-a', 'challenge-deck-b']);
  return [loadDeck(d0), loadDeck(d1)];
}
