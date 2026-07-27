/**
 * @module ai/h2/scenario-store
 *
 * The fixed sample set: named, checked-in game positions that H2 modules are
 * explained, tested and calibrated against.
 *
 * A scenario stores the full `GameState` plus the reference it came from — a
 * live game's `gameId#stateSeq` with a content hash, or a self-play
 * `seed/decks/decision` triple. The hash is what makes a reference verifiable:
 * re-capturing a position whose source has changed fails loudly instead of
 * silently explaining a different position, which is the failure mode that
 * makes hand-collected AI test corpora rot.
 *
 * Scenarios are the unit of per-module regression testing, so they live in the
 * repository rather than in a user's home directory.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { GameState, PlayerId, PlayerView } from '@meccg/shared';
import { loadCardPool } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';

/** Where a captured position came from. */
export type ScenarioSource =
  | {
    /** Captured from a recorded game log. */
    readonly kind: 'game';
    /** Game ID, matching `~/.meccg/logs/games/<gameId>.jsonl`. */
    readonly gameId: string;
    /** Engine state sequence number within that game. */
    readonly stateSeq: number;
  }
  | {
    /** Captured by replaying a self-play game. */
    readonly kind: 'selfplay';
    /** RNG seed of the self-play game. */
    readonly seed: number;
    /** Deck IDs by player index. */
    readonly decks: readonly [string, string];
    /** Agent specs by player index. */
    readonly agents: readonly [string, string];
    /** Decision index the snapshot was taken before. */
    readonly decisionSeq: number;
  };

/** A named position, with everything needed to explain and re-verify it. */
export interface Scenario {
  /** Path-like identifier, e.g. `combat/orc-ambush-3v1`. */
  readonly id: string;
  /** What the position is and why it is interesting. */
  readonly description: string;
  /** Module the scenario primarily exercises, when it targets one. */
  readonly module?: string;
  /** Which player's decision the scenario is about. */
  readonly actingPlayer: PlayerId;
  /** Optional human-authored expectation, e.g. `"Gimli should tap to fight"`. */
  readonly expectation?: string;
  /** Where the position came from. */
  readonly source: ScenarioSource;
  /** Content hash of `state`, so a stale reference is detectable. */
  readonly hash: string;
  /** The captured game state. */
  readonly state: GameState;
}

/** Directory holding the checked-in scenario corpus. */
export const SCENARIO_ROOT = path.join(__dirname, 'scenarios');

/** Canonical JSON: object keys sorted, so the hash is order-independent. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, canonicalize(v)]));
  }
  return value;
}

/**
 * The state without its embedded card pool.
 *
 * A `GameState` carries the whole card pool — 1.3 MB against roughly 15 KB of
 * actual position — and that pool is static data already in the repository.
 * Stripping it keeps a scenario diffable and the corpus affordable to grow,
 * and it is also what makes the content hash mean *the position*: two
 * captures of the same moment agree even if one came from a game log written
 * by an engine version that stored the pool differently.
 */
function positionOf(state: GameState): unknown {
  const record = { ...(state as unknown as Record<string, unknown>) };
  delete record['cardPool'];
  return canonicalize(record);
}

/** Content hash of a position — the identity a scenario reference asserts. */
export function hashState(state: GameState): string {
  return crypto.createHash('sha256').update(JSON.stringify(positionOf(state))).digest('hex').slice(0, 16);
}

/**
 * Re-attach the standard card pool to a state that was stored without one.
 *
 * Every scenario and every game-log record is a position in a game played
 * with the repository's card pool, so rehydration is exact rather than an
 * approximation — but it is done explicitly here so that a state which
 * carries its own pool (a game played with a modified one) keeps it.
 */
export function withStandardCardPool(state: GameState): GameState {
  if ((state as unknown as Record<string, unknown>)['cardPool']) return state;
  return { ...state, cardPool: loadCardPool() } as unknown as GameState;
}

/** Absolute path of a scenario file. */
function scenarioPath(id: string): string {
  return path.join(SCENARIO_ROOT, `${id}.json`);
}

/** IDs of every checked-in scenario, sorted. */
export function listScenarioIds(): string[] {
  if (!fs.existsSync(SCENARIO_ROOT)) return [];
  const ids: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.json')) ids.push(`${prefix}${entry.name.slice(0, -'.json'.length)}`);
    }
  };
  walk(SCENARIO_ROOT, '');
  return ids.sort();
}

/**
 * Load a scenario by ID, verifying its content hash. A mismatch means the
 * stored state was edited by hand or written by an older format; either way
 * the reference no longer describes what it claims to.
 */
export function loadScenario(id: string): Scenario {
  const file = scenarioPath(id);
  if (!fs.existsSync(file)) {
    throw new Error(`Scenario "${id}" not found at ${file} — see \`npm run scenarios -w @meccg/sim -- list\``);
  }
  const stored = JSON.parse(fs.readFileSync(file, 'utf-8')) as Scenario;
  const actual = hashState(stored.state);
  if (actual !== stored.hash) {
    throw new Error(`Scenario "${id}" hash mismatch: stored ${stored.hash}, computed ${actual}`);
  }
  return { ...stored, state: withStandardCardPool(stored.state) };
}

/**
 * Write a scenario to the corpus, creating its directory. The card pool is
 * dropped on the way out and restored on the way in.
 */
export function saveScenario(scenario: Scenario): string {
  const file = scenarioPath(scenario.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const state = { ...(scenario.state as unknown as Record<string, unknown>) };
  delete state['cardPool'];
  const stored = { ...scenario, hash: hashState(scenario.state), state };
  fs.writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`, 'utf-8');
  return file;
}

/**
 * Project the acting player's view of a scenario — the exact input an agent
 * would receive at that decision, hidden information already redacted.
 */
export function scenarioView(scenario: Scenario): PlayerView {
  return projectPlayerView(scenario.state, scenario.actingPlayer);
}
