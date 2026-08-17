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
import { createBcAgent } from '../agents/bc-agent.js';
import { createRouteAgent } from '../agents/route-agent.js';
import { createSearchAgent } from '../agents/search-agent.js';
import { createHeuristic2Agent } from '../ai/h2/agent.js';
import { DEFAULT_TUNABLES, withTunable } from '../ai/h2/core/tunables.js';
import type { Tunables } from '../ai/h2/core/tunables.js';
import { createMcAgent } from '../agents/mc-agent.js';
import type { McAgentOptions } from '../agents/mc-agent.js';
import { loadDeck, listDecks } from '../decks.js';
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
export const AGENT_NAMES = [
  'random', 'heuristic', 'noisy-heuristic', 'h2', 'bc', 'search', 'search-h2', 'mc', 'route',
] as const;

/**
 * `h2` spec grammar, for the CLIs that print it.
 *
 * `h2[:<modules>][@<temperature>][/<tunable>=<value>…]`
 */
export const H2_SPEC_GRAMMAR = 'h2[:<modules>][@<temperature>][/<tunable>=<value>...]';

/**
 * Parses an `mc` spec's `key=value/key=value` parameter list. The
 * separator is `/` rather than `,` because `--agents` splits agent specs on
 * commas, so a comma here would tear the spec in half. Unknown keys are an
 * error rather than a silent no-op, so a typo in a sweep does not quietly
 * benchmark the default configuration.
 */
function parseMcOptions(param: string | undefined): McAgentOptions {
  if (param === undefined || param.length === 0) return {};
  const options: {
    rollouts?: number; horizonTurns?: number; maxDecisions?: number;
    maxCandidates?: number; timeMs?: number; jobs?: number;
    unknownSites?: 'sample' | 'inert'; fallback?: Agent;
  } = {};
  // SIM_MC_JOBS parallelizes per-decision search without touching spec
  // strings (consistent with SIM_JOBS); an explicit jobs= key wins.
  const envJobs = Number(process.env.SIM_MC_JOBS ?? 1) || 1;
  if (envJobs > 1) options.jobs = envJobs;
  for (const part of param.split('/')) {
    const eq = part.indexOf('=');
    if (eq < 0) throw new Error(`mc expects key=value parameters separated by "/", got "${part}"`);
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    const asNumber = (): number => {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`mc ${key} expects a number, got "${value}"`);
      return n;
    };
    switch (key) {
      case 'rollouts': options.rollouts = asNumber(); break;
      case 'turns': options.horizonTurns = asNumber(); break;
      case 'decisions': options.maxDecisions = asNumber(); break;
      case 'candidates': options.maxCandidates = asNumber(); break;
      case 'ms': options.timeMs = asNumber(); break;
      case 'jobs': options.jobs = asNumber(); break;
      case 'sites':
        if (value !== 'sample' && value !== 'inert') {
          throw new Error(`mc sites expects "sample" or "inert", got "${value}"`);
        }
        options.unknownSites = value;
        break;
      // Nested specs are not supported: the fallback is itself an agent
      // spec, and allowing commas inside it would break this parser.
      case 'fallback': options.fallback = resolveAgent(value); break;
      default: throw new Error(`mc: unknown parameter "${key}" — expected rollouts, turns, decisions, candidates, ms, jobs, sites, fallback`);
    }
  }
  return options;
}

/**
 * Parses an `h2` spec's `/name=value` tunable overrides.
 *
 * The separator is `/` for the same reason `mc` uses it — `--agents` splits
 * specs on commas, and the module selector spends commas already. Unknown
 * names throw via `withTunable`, so a typo in a gate fails at launch rather
 * than quietly rating the shipped defaults against themselves.
 */
function parseH2Tunables(param: string): Tunables {
  let tunables = DEFAULT_TUNABLES;
  for (const part of param.split('/')) {
    const eq = part.indexOf('=');
    if (eq < 0) throw new Error(`h2 expects name=value tunables separated by "/", got "${part}"`);
    const name = part.slice(0, eq).trim();
    const value = Number(part.slice(eq + 1).trim());
    if (!Number.isFinite(value)) {
      throw new Error(`h2 tunable ${name} expects a number, got "${part.slice(eq + 1).trim()}"`);
    }
    tunables = withTunable(tunables, name, value);
  }
  return tunables;
}

/**
 * Instantiate an agent by registry spec. A spec is a name with an optional
 * `:parameter` suffix — `noisy-heuristic:0.75` blunders 75% of the time,
 * `bc:path/to/weights.json` loads a trained behavioral-cloning policy.
 */
export function resolveAgent(spec: string): Agent {
  const colon = spec.indexOf(':');
  const name = colon === -1 ? spec : spec.slice(0, colon);
  const param = colon === -1 ? undefined : spec.slice(colon + 1);
  // `h2+mc` is `h2:all+mc` — the composition operator without a module
  // selector in front of it. Normalising here keeps the h2 parser to one
  // grammar instead of two.
  if (name.includes('+') || name.includes('>')) {
    const op = Math.min(...[name.indexOf('+'), name.indexOf('>')].filter(i => i >= 0));
    return resolveAgent(`${name.slice(0, op)}:all${name.slice(op)}${param === undefined ? '' : `:${param}`}`);
  }
  switch (name) {
    case 'random': return createRandomAgent();
    case 'heuristic': {
      // `heuristic` plays the argmax of its weights. `heuristic:sample` reads
      // the same weights as a distribution, which is what it used to do and is
      // worth ~47 Elo less; it stays reachable because off-policy coverage is
      // the point when the games become training data. `:greedy` is accepted
      // as a no-op alias so the gate logs that named it still run.
      if (param !== undefined && param !== 'sample' && param !== 'greedy') {
        throw new Error(`heuristic takes no parameter except "sample" (or the no-op "greedy"), got "${param}"`);
      }
      return createHeuristicAgent({ sample: param === 'sample' });
    }
    case 'noisy-heuristic': {
      const epsilon = param === undefined ? 0.5 : Number(param);
      if (!Number.isFinite(epsilon)) throw new Error(`noisy-heuristic expects a numeric ε, got "${param}"`);
      return createNoisyHeuristicAgent(epsilon);
    }
    case 'h2': {
      // Heuristics 2 with a module selector for ablation gates:
      // `h2` (everything shipped), `h2:combat`, `h2:combat,kill`. Decisions no
      // enabled module claims fall through to the fallback agent, so
      // `h2:<module>` isolates exactly that module's contribution.
      //
      // `@T` asks for *sampled* play at softmax temperature T. Without it the
      // agent plays its argmax and still reports the distribution, which is
      // what a gate wants; `@T` is for generating exploratory self-play data,
      // where position coverage matters more than winning.
      //
      // `+<spec>` and `>` used to compose a fallback agent — `h2+mc`, `h2>mc`.
      // Both are rejected now: H2 has no fallback. It answers every decision
      // itself, including the ones it cannot rank, because a ceiling made of
      // another agent cannot be raised by working on this one. Rejected rather
      // than ignored so a script asking for `h2>mc` is told it no longer
      // exists instead of quietly getting plain `h2`.
      //
      // `/name=value` overrides a tunable: `h2:all/tapTempoCost=0.6`. Without
      // it a constant can only be swept on a single scenario, and every
      // question of the form "is this number right" needs a strength gate —
      // which spawns children that receive an agent *spec* and nothing else.
      const opIndexes = param === undefined
        ? []
        : [param.indexOf('+'), param.indexOf('>')].filter(i => i >= 0);
      const plus = opIndexes.length === 0 ? -1 : Math.min(...opIndexes);
      if (plus >= 0) {
        throw new Error(
          `h2 no longer composes a fallback, so "${param!.slice(plus, plus + 1)}" is not accepted: `
          + 'it answers every decision with its own modules. Use plain `h2`.',
        );
      }
      const beforeFallback = param;
      const slash = beforeFallback === undefined ? -1 : beforeFallback.indexOf('/');
      const head = slash >= 0 ? beforeFallback!.slice(0, slash) : beforeFallback;
      const tunables = slash >= 0 ? parseH2Tunables(beforeFallback!.slice(slash + 1)) : undefined;
      const at = head === undefined ? -1 : head.lastIndexOf('@');
      const modules = head === undefined || head.length === 0 ? undefined : at > 0 ? head.slice(0, at) : head;
      const temperature = at > 0 ? Number(head!.slice(at + 1)) : undefined;
      if (temperature !== undefined && !Number.isFinite(temperature)) {
        throw new Error(`h2 expects a numeric temperature after "@", got "${head!.slice(at + 1)}"`);
      }
      return createHeuristic2Agent({
        modules,
        temperature,
        tunables,
        sample: temperature !== undefined,
      });
    }
    case 'search-h2': {
      // Search with the fitted win-probability model as the leaf evaluator
      // instead of the net's value head — the experiment §11 of the training
      // doc names as the immediate one. Priors still come from the net.
      if (param === undefined) throw new Error('search-h2 expects a weights path: search-h2:weights.json[@sims]');
      const h2At = param.lastIndexOf('@');
      const h2Path = h2At > 0 ? param.slice(0, h2At) : param;
      const h2Sims = h2At > 0 ? Number(param.slice(h2At + 1)) : undefined;
      if (h2Sims !== undefined && !Number.isFinite(h2Sims)) {
        throw new Error(`search-h2 expects a numeric sims after "@", got "${param.slice(h2At + 1)}"`);
      }
      const [h2DeckA, h2DeckB] = (process.env.SIM_SEARCH_DECKS ?? 'challenge-deck-a,challenge-deck-b').split(',');
      return createSearchAgent(h2Path, {
        decks: [loadDeck(h2DeckA.trim()), loadDeck(h2DeckB.trim())],
        sims: h2Sims,
        winProbWeight: 1,
      });
    }
    case 'search': {
      // Determinizing-PUCT search: `search:weights.json[@sims]`. The
      // determinizer needs both deck lists (public for challenge decks);
      // they come from SIM_SEARCH_DECKS ("deckA,deckB", matching the run's
      // --decks) or default to challenge decks a/b.
      if (param === undefined) throw new Error('search expects a weights path: search:weights.json[@sims]');
      const searchAt = param.lastIndexOf('@');
      const weightsPath = searchAt > 0 ? param.slice(0, searchAt) : param;
      const sims = searchAt > 0 ? Number(param.slice(searchAt + 1)) : undefined;
      if (sims !== undefined && !Number.isFinite(sims)) {
        throw new Error(`search expects a numeric sims after "@", got "${param.slice(searchAt + 1)}"`);
      }
      const [deckA, deckB] = (process.env.SIM_SEARCH_DECKS ?? 'challenge-deck-a,challenge-deck-b').split(',');
      return createSearchAgent(weightsPath, { decks: [loadDeck(deckA.trim()), loadDeck(deckB.trim())], sims });
    }
    case 'mc': {
      // Flat Monte-Carlo rollouts over the real engine, no deck lists and
      // no weights: `mc` or `mc:rollouts=16/turns=2/ms=2000/sites=sample`.
      return createMcAgent({ ...parseMcOptions(param), name: spec });
    }
    case 'bc': {
      if (param === undefined) throw new Error('bc expects a weights path: bc:path/to/weights.json[@temperature|@class]');
      // Optional `@` suffix selects how the decision is read out of the
      // policy: a number samples at that temperature (rollout/exploration
      // mode for self-play RL), `class` sums probability by action type
      // before choosing (the read human-cloned weights need — see
      // `classMassIndex`). Bare, it is the argmax.
      const at = param.lastIndexOf('@');
      if (at > 0) {
        const suffix = param.slice(at + 1);
        if (suffix === 'class') return createBcAgent(param.slice(0, at), { decode: 'class-mass' });
        const temperature = Number(suffix);
        if (!Number.isFinite(temperature)) throw new Error(`bc expects a numeric temperature or "class" after "@", got "${suffix}"`);
        return createBcAgent(param.slice(0, at), { temperature });
      }
      return createBcAgent(param);
    }
    case 'route': {
      // `route:<types>|<primary>|<secondary>` — types joined by `+`. The
      // separator is `|` because both other candidates are spoken for: `,`
      // splits agent lists and `/` appears in every weights path.
      if (param === undefined) {
        throw new Error('route expects route:<type+type>|<primary spec>|<secondary spec>');
      }
      const parts = param.split('|');
      if (parts.length !== 3 || parts.some(part => part.length === 0)) {
        throw new Error(`route expects three "|"-separated parts, got "${param}"`);
      }
      const types = new Set(parts[0].split('+').map(type => type.trim()).filter(type => type.length > 0));
      if (types.size === 0) throw new Error('route expects at least one action type before the first "|"');
      return createRouteAgent(types, resolveAgent(parts[1]), resolveAgent(parts[2]), spec);
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

/**
 * Resolve a pair flag (e.g. `--agents random,heuristic`).
 *
 * A comma separates the pair, except that an agent spec may contain commas of
 * its own: `h2:combat,kill` names a module *set*. That is the ablation the
 * whole module registry exists for — "everything, against everything but this
 * one" — and it was unusable from any CLI that takes a pair, because the
 * fifteen-name selector parsed as fifteen agents. So a semicolon separates the
 * pair when one is present, and the comma keeps working for every spec that
 * does not contain one:
 *
 * ```sh
 * --agents 'h2;h2:combat,kill,travel'
 * ```
 */
export function resolvePair(args: CliArgs, name: string, defaults: readonly [string, string]): [string, string] {
  const raw = args.flags[name];
  if (raw === undefined || raw === true) return [defaults[0], defaults[1]];
  const text = String(raw);
  const separator = text.includes(';') ? ';' : ',';
  const parts = text.split(separator).map(p => p.trim()).filter(p => p.length > 0);
  if (parts.length === 1) return [parts[0], parts[0]];
  if (parts.length !== 2) {
    throw new Error(`--${name} expects one or two values separated by "${separator}"`
      + (separator === ',' ? ' — use ";" when a spec contains a comma, as `h2:combat,kill` does' : ''));
  }
  return [parts[0], parts[1]];
}

/**
 * Load the two decks named by `--decks` (default challenge decks a/b).
 *
 * Warns when either deck is not human-approved: most catalog decks have
 * matchups the engine cannot finish, so training on them yields data from
 * broken games and rating on them yields meaningless numbers. The warning
 * does not block — deliberately playing an unapproved deck is how it gets
 * qualified — but it must be impossible to do by accident.
 */
export function resolveDecks(args: CliArgs): [LoadedDeck, LoadedDeck] {
  const [d0, d1] = resolvePair(args, 'decks', ['challenge-deck-a', 'challenge-deck-b']);
  const decks: [LoadedDeck, LoadedDeck] = [loadDeck(d0), loadDeck(d1)];
  const unapproved = decks.filter(d => !d.approved).map(d => d.id);
  if (unapproved.length > 0) {
    console.warn(`WARNING: ${unapproved.join(' and ')} ${unapproved.length > 1 ? 'are' : 'is'} not approved — `
      + 'results may come from games the engine cannot finish. '
      + `Approved decks: ${listDecks().filter(d => d.approved).map(d => d.id).join(', ') || '(none)'}`);
  }
  return decks;
}
