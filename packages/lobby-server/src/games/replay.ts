/**
 * @module replay
 *
 * Serves finished games back to the browser as a step-by-step replay.
 *
 * The game server already records every game as a JSONL state log at
 * `~/.meccg/logs/games/<gameId>.jsonl` — one line per engine transition,
 * each carrying the action that produced it plus the *complete* game state
 * that resulted (minus the card pool, which is static and re-attached here).
 * Because every line is a full snapshot, playback needs no reducer run: a
 * frame is rendered by projecting its recorded state through the same
 * {@link projectReplayView} redaction a live seat would have seen.
 *
 * Logs run to tens of megabytes for a long game, so nothing is held in
 * memory as parsed state. {@link loadReplayIndex} builds a byte-offset table
 * once per game (cached, invalidated by file mtime/size) and
 * {@link loadReplayFrame} reads exactly one line off disk per request.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CardDefinition, GameAction, GameState, PlayerId, PlayerView } from '@meccg/shared';
import { loadCardPool } from '@meccg/shared';
import { projectReplayView } from '@meccg/game-server';

/**
 * Directory holding the per-game JSONL state logs written by the game server.
 * Read per call rather than captured at load time so tests can point it at a
 * fixture directory without racing the module graph.
 */
export function gameLogDir(): string {
  return process.env.GAME_LOG_DIR ?? path.join(os.homedir(), '.meccg', 'logs', 'games');
}

/** Game IDs are opaque slugs; anything else is a path-traversal attempt. */
const GAME_ID_RE = /^[a-z0-9-]+$/;

/** How many games' offset tables to keep resident. Each is a few hundred KB. */
const INDEX_CACHE_LIMIT = 4;

/** One recorded transition, without its (large) state snapshot. */
export interface ReplayFrameMeta {
  /** Position in the replay, 0-based. The scrubber addresses frames by this. */
  readonly index: number;
  /** The engine's own state sequence number for this snapshot. */
  readonly seq: number;
  /** ISO timestamp the game server wrote the line at. */
  readonly ts: string | null;
  readonly turn: number | null;
  readonly phase: string | null;
  readonly step: string | null;
  readonly activePlayer: string | null;
  /** Why the state changed — `new-game`, `action`, `restore`, … */
  readonly reason: string | null;
  /**
   * The action that produced this state, verbatim. Null for the opening
   * frame and for any pre-action-logging game. Sent with the index rather
   * than per frame so the client can label the whole timeline up front.
   */
  readonly action: GameAction | null;
}

/** A seat in the recorded game. */
export interface ReplaySeat {
  readonly id: string;
  readonly name: string;
}

/** Everything the client needs to drive a replay except the frames themselves. */
export interface ReplayIndex {
  readonly gameId: string;
  readonly seats: readonly ReplaySeat[];
  readonly frames: readonly ReplayFrameMeta[];
}

/** A cached offset table. Byte ranges point into the log file on disk. */
interface CachedIndex {
  readonly mtimeMs: number;
  readonly size: number;
  readonly index: ReplayIndex;
  /** Byte offset of each frame's line, parallel to `index.frames`. */
  readonly offsets: readonly number[];
  /** Byte length of each frame's line, parallel to `index.frames`. */
  readonly lengths: readonly number[];
}

const indexCache = new Map<string, CachedIndex>();

let memoisedCardPool: Readonly<Record<string, CardDefinition>> | null = null;

/** The card pool, loaded once and shared by every projected frame. */
function cardPool(): Readonly<Record<string, CardDefinition>> {
  memoisedCardPool ??= loadCardPool();
  return memoisedCardPool;
}

/** Absolute path of a game's log, or null when the ID is not a valid slug. */
function logPath(gameId: string): string | null {
  if (!GAME_ID_RE.test(gameId)) return null;
  const dir = gameLogDir();
  const file = path.join(dir, `${gameId}.jsonl`);
  // Defence in depth: the regex already forbids `.` and separators.
  return file.startsWith(dir + path.sep) ? file : null;
}

/** The shape of a log line, as far as this module cares. */
interface LogLine {
  ts?: string;
  event?: string;
  stateSeq?: number;
  reason?: string;
  action?: GameAction;
  turn?: number;
  phase?: string;
  step?: string;
  activePlayer?: string;
  state?: GameState;
}

/**
 * Parse just the metadata prefix of a log line.
 *
 * The game server writes the small scalar fields before `legalActions` and
 * `state`, so truncating there and closing the object yields valid JSON that
 * is orders of magnitude cheaper to parse than the whole snapshot — the
 * difference between an instant index and a multi-second one on a long game.
 * Any surprise in the layout falls back to a full parse.
 */
function parseMeta(line: string): LogLine | null {
  const cut = line.indexOf(',"legalActions"');
  if (cut > 0) {
    try {
      return JSON.parse(line.slice(0, cut) + '}') as LogLine;
    } catch {
      // Fall through to the full parse below.
    }
  }
  try {
    return JSON.parse(line) as LogLine;
  } catch {
    return null;
  }
}

/** Build the offset table and frame metadata for one log file. */
function buildIndex(gameId: string, file: string, stat: fs.Stats): CachedIndex {
  const buffer = fs.readFileSync(file);
  const frames: ReplayFrameMeta[] = [];
  const offsets: number[] = [];
  const lengths: number[] = [];

  let start = 0;
  while (start < buffer.length) {
    let end = buffer.indexOf(0x0a, start);
    if (end === -1) end = buffer.length;
    const length = end - start;
    if (length > 0) {
      const meta = parseMeta(buffer.toString('utf-8', start, end));
      // Only state snapshots are replayable; `restore` and other bookkeeping
      // lines carry no board to render.
      if (meta && meta.event === 'state' && typeof meta.stateSeq === 'number') {
        offsets.push(start);
        lengths.push(length);
        frames.push({
          index: frames.length,
          seq: meta.stateSeq,
          ts: meta.ts ?? null,
          turn: meta.turn ?? null,
          phase: meta.phase ?? null,
          step: meta.step ?? null,
          activePlayer: meta.activePlayer ?? null,
          reason: meta.reason ?? null,
          action: meta.action ?? null,
        });
      }
    }
    start = end + 1;
  }

  const seats: ReplaySeat[] = [];
  if (offsets.length > 0) {
    const first = readState(file, offsets[0], lengths[0]);
    for (const player of first?.players ?? []) {
      seats.push({ id: player.id as string, name: player.name });
    }
  }

  return {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    offsets,
    lengths,
    index: { gameId, seats, frames },
  };
}

/**
 * Fields the engine's state has grown since the oldest recordings were made,
 * with the value those recordings implicitly had: a game played before stage
 * points existed scored no stage points, one played before hazard hosts were
 * tracked had none. Only absent keys are filled — a recorded value always
 * wins — so this ages out on its own as old logs are pruned.
 *
 * Collections use fresh instances per frame rather than a shared empty
 * literal, so nothing downstream can alias one snapshot's default into
 * another's.
 */
const STATE_DEFAULTS: Readonly<Record<string, () => unknown>> = {
  handRevealedInstances: () => ({}),
  revealedInstances: () => ({}),
  singletonTapLocks: () => [],
  hazardHosts: () => [],
  pendingResolutions: () => [],
  activeConstraints: () => [],
  cheated: () => false,
};

const PLAYER_DEFAULTS: Readonly<Record<string, () => unknown>> = {
  agents: () => [],
  callableMarshallingPoints: () => ({}),
  generalInfluenceBonus: () => 0,
  generalInfluenceControlPenalty: () => 0,
  outOfPlayPile: () => [],
  reservedCreatures: () => [],
  stagePoints: () => 0,
};

/** Apply a default table to one object, leaving every recorded key alone. */
function withDefaults(
  value: Record<string, unknown>,
  defaults: Readonly<Record<string, () => unknown>>,
): Record<string, unknown> {
  let filled = value;
  for (const [key, make] of Object.entries(defaults)) {
    if (!(key in filled)) {
      if (filled === value) filled = { ...value };
      filled[key] = make();
    }
  }
  return filled;
}

/**
 * Bring a recorded snapshot up to the state shape the projection expects.
 * Without this, every game older than the newest engine field crashes the
 * projection on an undefined pile rather than replaying.
 */
function normaliseRecordedState(state: Record<string, unknown>): Record<string, unknown> {
  const normalised = { ...withDefaults(state, STATE_DEFAULTS) };
  const players = normalised.players;
  if (Array.isArray(players)) {
    normalised.players = players.map(p =>
      withDefaults(p as Record<string, unknown>, PLAYER_DEFAULTS));
  }
  return normalised;
}

/** Read one line by byte range and return its state snapshot. */
function readState(file: string, offset: number, length: number): GameState | null {
  const buffer = Buffer.allocUnsafe(length);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buffer, 0, length, offset);
  } finally {
    fs.closeSync(fd);
  }
  try {
    const state = (JSON.parse(buffer.toString('utf-8')) as LogLine).state;
    if (!state) return null;
    return normaliseRecordedState(state as unknown as Record<string, unknown>) as unknown as GameState;
  } catch {
    return null;
  }
}

/** The cached offset table for a game, rebuilt when the log changed on disk. */
function cachedIndex(gameId: string): CachedIndex | null {
  const file = logPath(gameId);
  if (!file) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }

  const cached = indexCache.get(gameId);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    // Refresh recency so the eviction below drops the least recently used.
    indexCache.delete(gameId);
    indexCache.set(gameId, cached);
    return cached;
  }

  const built = buildIndex(gameId, file, stat);
  indexCache.delete(gameId);
  indexCache.set(gameId, built);
  while (indexCache.size > INDEX_CACHE_LIMIT) {
    const oldest = indexCache.keys().next();
    if (oldest.done) break;
    indexCache.delete(oldest.value);
  }
  return built;
}

/**
 * The replay timeline for a finished game, or null when there is nothing
 * replayable: no log on disk (games played before state logging, or logs
 * pruned since), an empty or truncated log, or a recording whose state shape
 * predates what {@link loadReplayFrame} can still project. The opening frame
 * is projected here as a probe so the caller learns that up front rather than
 * after the viewer has already taken over the screen.
 */
export function loadReplayIndex(gameId: string): ReplayIndex | null {
  const cached = cachedIndex(gameId);
  if (!cached || cached.index.frames.length === 0 || cached.index.seats.length === 0) return null;
  if (!loadReplayFrame(gameId, 0, cached.index.seats[0].id)) return null;
  return cached.index;
}

/**
 * One replay frame projected for `playerId`'s seat, ready to render with the
 * ordinary game board. Returns null when the game, the frame, or the seat is
 * unknown, and when the recorded state is too old to project — the state shape
 * has moved on far enough that some pre-{@link STATE_DEFAULTS} recordings can
 * no longer be rendered, and a failed frame must not take the server with it.
 */
export function loadReplayFrame(
  gameId: string,
  frameIndex: number,
  playerId: string,
): PlayerView | null {
  const cached = cachedIndex(gameId);
  if (!cached) return null;
  if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= cached.offsets.length) {
    return null;
  }
  const file = logPath(gameId);
  if (!file) return null;

  const state = readState(file, cached.offsets[frameIndex], cached.lengths[frameIndex]);
  if (!state) return null;
  if (!state.players.some(p => (p.id as string) === playerId)) return null;

  // The log strips the card pool from every snapshot (it is static and
  // enormous); the projection needs it back to resolve card definitions.
  const withPool = { ...state, cardPool: cardPool() } as unknown as GameState;
  try {
    return projectReplayView(withPool, playerId as PlayerId);
  } catch {
    return null;
  }
}
