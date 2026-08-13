/**
 * @module cli/export-human
 *
 * Behavioral-cloning training-data exporter for **recorded human games**.
 *
 * `cli/export` featurizes games it plays itself, which makes the teacher an
 * agent this repository wrote. Every model trained that way inherits the
 * teacher's ceiling, and the current one inherited a low ceiling: the shipped
 * `approved-base` weights cloned 2.2M decisions of AI-Heuristic self-play, a
 * policy the recorded corpus beats **137–0**.
 *
 * This exporter takes the other side of that scoreboard. It reads the game
 * server's JSONL logs, recovers the move the human made at each position, and
 * writes the identical record format `train_bc.py` already consumes — so the
 * learning side needs no change, and human data can be mixed with self-play
 * data (or used to fine-tune from it via `--init`) by listing both files.
 *
 * ## Which seat is the teacher
 *
 * Every seat that is not a bot. The lobby names its bot seats `AI-Heuristic`,
 * `AI-MC`, `AI-Modular`, `AI-Real` and `Mentor` (see `lobby/lobby.ts`), and
 * the completed-game summaries carry a per-player `human` flag that agrees
 * with those names on all 125 games that have one. Names are matched rather
 * than read from the summaries because only 125 of 631 logs *have* a summary
 * — reading the seat from the log itself is what makes the other 506 usable.
 *
 * ## Recovering the move
 *
 * The log records the action that produced each state, so the choice made at
 * record N is `records[N + 1].action` and no reconstruction is needed. That
 * field is matched structurally against the projected view's candidate list,
 * because the index written to the training record must be an index into
 * `view.legalActions` — that is the order `featurizeActions` emits.
 *
 * When the match fails the decision is not guessed at. It falls back to the
 * replay attribution `human-compare` uses — apply each same-type candidate and
 * compare state hashes, exact because the engine's RNG travels in the state —
 * and is dropped if that is also inconclusive. Both paths are counted and
 * reported, so an attribution rate that quietly falls is visible rather than
 * silently reducing the corpus.
 *
 * ## Games that never finished
 *
 * 494 of 631 logs stop mid-game: players abandon a game they have already won,
 * and servers restart. Their decisions are still human decisions, but they
 * carry no win/loss label.
 *
 * `train_bc.py` drops any decision whose game result is not `completed`, and
 * derives the value target from `winnerIndex`, where **null means no signal**
 * and yields z = 0. Unfinished games are therefore exported (by default) as
 * `completed` with a null winner and an explicit `unfinished: true` marker:
 * the policy head learns from every decision, and the value head is told the
 * truth, which is that the outcome is unknown. Pass `--unfinished skip` to
 * export only the 137 decided games.
 *
 * Usage:
 *   npm run export-human -w @meccg/sim -- --dir ~/backup/ai-meccg.com \
 *     --out human.jsonl [--jobs 8]
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadCardPool, reduce, setEngineConsoleLog, Phase } from '@meccg/shared';
import type { GameAction, GameState, PlayerId } from '@meccg/shared';
import { projectPlayerView } from '@meccg/game-server';
import {
  FEATURE_SPEC_VERSION,
  ACTION_TYPES,
  buildCardVocab,
  featurizeState,
  featurizeActions,
  GLOBAL_FEATURE_WIDTH,
  ENTITY_FEATURE_WIDTH,
  ACTION_FEATURE_WIDTH,
} from '../features/index.js';
import { readGameLog, resolveGameLogPath } from '../ai/h2/game-log.js';
import type { GameLogRecord } from '../ai/h2/game-log.js';
import { hashState } from '../ai/h2/scenario-store.js';
import { isRegressive } from '../ai/regress.js';
import { parseCliArgs, numberFlag, stringFlag } from './common.js';
import { runChildren } from './jobs.js';

/** Flag reference, printed by `--help`. */
const USAGE = `export-human — behavioral-cloning data from recorded human games

Reads the game server's JSONL logs, recovers each human decision, and writes
the training format cli/export writes, for train_bc.py to consume unchanged.

Usage:
  npm run export-human -w @meccg/sim -- --dir <corpus> [options]
  npm run export-human -w @meccg/sim -- --game <id|path> [options]

Options:
  --dir <path>         corpus root holding logs/games/
  --game <id|path>     a single game log
  --out <file>         output JSONL (default human-training.jsonl)
  --games <n>          cap how many logs are read (default all)
  --max-decisions <n>  cap decisions taken from any one game
  --players <a,b>      export only these human seats (case-insensitive)
  --bots <a,b>         extra seat names to treat as non-human; any name
                       starting "AI-" is always a bot
                       (default AI-Heuristic,AI-MC,AI-Modular,AI-Real,Mentor)
  --exclude-bots <a,b> skip games played against these opponents
  --unfinished <mode>  neutral (default) exports undecided games with a null
                       winner (z = 0); skip drops them
  --contested-only     omit decisions with fewer than two viable candidates
  --jobs <n>           fan out over n child processes, sharded by file
  --help               this message
`;

/**
 * Seats the lobby drives itself.
 *
 * `Mentor` is the server-driven teaching seat rather than an agent process,
 * but it is equally not a human, and its opponent's decisions are equally
 * human ones — the games it plays are kept unless `--exclude-bots Mentor`
 * says the guided setting makes them poor demonstrations.
 */
const DEFAULT_BOT_SEATS = ['AI-Heuristic', 'AI-MC', 'AI-Modular', 'AI-Real', 'Mentor'];

/**
 * Seats named `AI-…` are bots whether or not the list above knows them.
 *
 * The corpus contains 16 games against an `AI-Pseudo` that no name list in
 * this repository mentions, and a bot mistaken for a human is the one error
 * this exporter must not make: it would feed the model exactly the policy the
 * human data is meant to replace. The list stays for `Mentor`, which the
 * prefix does not catch.
 */
const BOT_NAME_PREFIX = /^ai-/i;

/** What the exporter did with every candidate decision, for the run summary. */
interface Tally {
  /** Decisions written. */
  exported: number;
  /** Matched by structural equality against the view's candidates. */
  direct: number;
  /** Matched by replaying candidates and comparing state hashes. */
  replayed: number;
  /** Written despite several candidates encoding identically. */
  duplicate: number;
  /** The acting seat was a bot. */
  bot: number;
  /** The human's move was the engine's undo marker. */
  undo: number;
  /** Dropped: no candidate reproduced the recorded move. */
  unmatched: number;
  /** Dropped: the move matched a candidate this engine no longer allows. */
  nonViable: number;
  /** Dropped: `--contested-only` and only one candidate was viable. */
  forced: number;
  /** Dropped: projection or featurization threw. */
  failed: number;
}

const args = parseCliArgs(process.argv.slice(2));
if (args.flags['help'] === true || args.flags['h'] === true) {
  console.log(USAGE);
  process.exit(0);
}
setEngineConsoleLog(false);

const corpusDir = stringFlag(args, 'dir');
const singleGame = stringFlag(args, 'game');
const outFile = stringFlag(args, 'out') ?? 'human-training.jsonl';
const gameLimit = numberFlag(args, 'games', Number.POSITIVE_INFINITY);
const maxDecisions = numberFlag(args, 'max-decisions', Number.POSITIVE_INFINITY);
const contestedOnly = args.flags['contested-only'] === true;
const noHeader = args.flags['no-header'] === true;
const jobs = numberFlag(args, 'jobs', Number(process.env.SIM_JOBS ?? 1) || 1);
const shardSpec = stringFlag(args, 'shard');
const unfinishedMode = stringFlag(args, 'unfinished') ?? 'neutral';

if (!corpusDir && !singleGame) {
  console.error('export-human: pass --dir <corpus> or --game <id|path>');
  process.exit(2);
}
if (unfinishedMode !== 'neutral' && unfinishedMode !== 'skip') {
  console.error(`export-human: --unfinished expects neutral or skip, got "${unfinishedMode}"`);
  process.exit(2);
}

/** Lower-cased name list from a comma-separated flag. */
function nameSet(flag: string, fallback: readonly string[]): Set<string> {
  const raw = stringFlag(args, flag);
  const names = raw === undefined ? fallback : raw.split(',').map(n => n.trim()).filter(n => n.length > 0);
  return new Set(names.map(n => n.toLowerCase()));
}

const botSeats = nameSet('bots', DEFAULT_BOT_SEATS);
const excludedBots = nameSet('exclude-bots', []);

/** Whether a seat is driven by the server rather than by a person. */
function isBot(name: string): boolean {
  return botSeats.has(name.toLowerCase()) || BOT_NAME_PREFIX.test(name);
}
const playerFilter = stringFlag(args, 'players') === undefined ? undefined : nameSet('players', []);

const cardPool = loadCardPool();
const vocab = buildCardVocab(cardPool);

/**
 * Re-attach the card pool to a logged state.
 *
 * `withStandardCardPool` does the same thing, but calls `loadCardPool` per
 * state; at ~139k decisions that rebuilds a 1683-entry object 139k times, so
 * the pool is hoisted out of the loop here.
 */
function rehydrate(state: GameState): GameState {
  if ((state as unknown as Record<string, unknown>)['cardPool']) return state;
  return { ...state, cardPool } as unknown as GameState;
}

/**
 * A stable string form of a value, with object keys sorted.
 *
 * The logged action and the projected candidate are built by different code
 * paths, so they agree on content but not necessarily on key order.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter(key => record[key] !== undefined && key !== 'actionId').sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

/** The log files to read, in a stable order so shard ids are reproducible. */
function logFiles(): { gameId: string; file: string }[] {
  if (singleGame) {
    const file = resolveGameLogPath(singleGame);
    return [{ gameId: path.basename(file, '.jsonl'), file }];
  }
  const dir = path.join(corpusDir!, 'logs', 'games');
  if (!fs.existsSync(dir)) throw new Error(`no logs/games/ directory under ${corpusDir}`);
  return fs.readdirSync(dir)
    .filter(name => name.endsWith('.jsonl'))
    .sort()
    .map(name => ({ gameId: path.basename(name, '.jsonl'), file: path.join(dir, name) }));
}

/** The seats of a game, as the log's own state records them. */
function seatsOf(state: GameState): { id: PlayerId; name: string; index: number; human: boolean }[] {
  return state.players.map((player, index) => ({
    id: player.id,
    name: player.name,
    index,
    human: !isBot(player.name ?? ''),
  }));
}

/**
 * The outcome of a game, read from the terminal state rather than a summary.
 *
 * Only 125 of 631 logs have a `games/<id>.json` summary, but every log that
 * reached the end carries `phaseState.phase === 'game-over'` with the winner
 * on it — so the label comes from the same file as the decisions.
 */
function outcomeOf(records: readonly GameLogRecord[]): { winner: PlayerId | null; finished: boolean } {
  const last = records[records.length - 1];
  const phaseState = last?.state?.phaseState;
  if (!phaseState || phaseState.phase !== Phase.GameOver) return { winner: null, finished: false };
  return { winner: phaseState.winner, finished: true };
}

/** A candidate the human's move was matched to, or why it was refused. */
type Attribution =
  | { index: number; how: 'direct' | 'replayed'; duplicate: boolean }
  | 'non-viable'
  | undefined;

/**
 * The matches this engine still considers legal.
 *
 * A move can match a candidate the *current* engine marks non-viable: the
 * position was legal when it was played, and a rule has moved since. Training
 * on it would put the one-hot target on an index `masked_log_softmax` has
 * already sent to -1e9, so the position is refused rather than exported with
 * an unreachable target. It is 5 decisions in 138k, and they are the 5 that
 * would have produced the loss spike.
 */
function viableOnly(candidates: readonly { viable: boolean }[], matches: readonly number[]): number[] {
  return matches.filter(index => candidates[index].viable);
}

/**
 * Recover the index of the human's move within the view's candidate list.
 *
 * The fast path is structural equality with the logged action. The fallback
 * replays each same-type candidate through the reducer and compares state
 * hashes, which is exact rather than approximate because the engine's RNG
 * lives in the state that is being replayed.
 */
function chosenIndex(
  candidates: readonly { action: GameAction; viable: boolean }[],
  logged: GameAction | undefined,
  state: GameState,
  nextState: GameState | undefined,
): Attribution {
  if (logged !== undefined) {
    const key = canonical(logged);
    const matches: number[] = [];
    for (let i = 0; i < candidates.length; i++) {
      if (canonical(candidates[i].action) === key) matches.push(i);
    }
    if (matches.length > 0) {
      const viable = viableOnly(candidates, matches);
      if (viable.length === 0) return 'non-viable';
      // Several structural matches encode to the same candidate vector, so the
      // choice between them is not information the record could carry anyway.
      return { index: viable[0], how: 'direct', duplicate: viable.length > 1 };
    }
  }

  if (nextState === undefined) return undefined;
  const wanted = hashState(nextState);
  const ofType = logged === undefined
    ? candidates.map((c, i) => [c, i] as const)
    : candidates.map((c, i) => [c, i] as const).filter(([c]) => c.action.type === logged.type);
  const matches: number[] = [];
  for (const [candidate, index] of ofType) {
    let result;
    try {
      result = reduce(state, candidate.action);
    } catch {
      continue;
    }
    if (result.error !== undefined) continue;
    if (hashState(result.state) === wanted) matches.push(index);
  }
  if (matches.length === 1) {
    return viableOnly(candidates, matches).length === 0
      ? 'non-viable'
      : { index: matches[0], how: 'replayed', duplicate: false };
  }
  // A lone candidate of the acted type that does not reproduce the state is
  // still the move that was made — the mismatch is an intervening automatic
  // step. Anything less certain is refused.
  if (matches.length === 0 && ofType.length === 1) {
    return candidates[ofType[0][1]].viable
      ? { index: ofType[0][1], how: 'replayed', duplicate: false }
      : 'non-viable';
  }
  return undefined;
}

/**
 * Export one game's human decisions, appending to the open descriptor `out`.
 *
 * Writes are synchronous rather than streamed. The export loop never yields,
 * so a `WriteStream` cannot flush until the whole run is over — every record
 * stays queued in memory, which reached 800MB per shard on this corpus before
 * a single byte was on disk. `writeSync` costs nothing here and bounds memory
 * to one game's worth of lines.
 */
function exportGame(
  gameId: string,
  file: string,
  gameIndex: number,
  out: number,
  tally: Tally,
): number {
  const records = readGameLog(file).filter(r => r.event === 'state');
  if (records.length < 2) return 0;

  const seats = seatsOf(records[0].state);
  const opponentExcluded = seats.some(seat => excludedBots.has(seat.name.toLowerCase()));
  if (opponentExcluded) return 0;

  const teachers = new Map(seats
    .filter(seat => seat.human)
    .filter(seat => playerFilter === undefined || playerFilter.has(seat.name.toLowerCase()))
    .map(seat => [seat.id, seat]));
  if (teachers.size === 0) return 0;

  const { winner, finished } = outcomeOf(records);
  if (!finished && unfinishedMode === 'skip') return 0;

  const lines: string[] = [];
  let seq = 0;
  for (let i = 0; i < records.length - 1 && seq < maxDecisions; i++) {
    const moved = records[i + 1].action;
    if (moved === undefined) continue;
    const seat = teachers.get(moved.player);
    if (seat === undefined) {
      if (!teachers.has(moved.player)) tally.bot++;
      continue;
    }
    // The engine offers undos as candidates and every agent drops them; a
    // human who backed out of a move is not demonstrating how to play.
    if (isRegressive(moved)) { tally.undo++; continue; }

    const state = rehydrate(records[i].state);
    let view;
    try {
      view = projectPlayerView(state, seat.id);
    } catch {
      tally.failed++;
      continue;
    }
    if (view.legalActions.length === 0) continue;

    const found = chosenIndex(view.legalActions, moved, state, rehydrate(records[i + 1].state));
    if (found === undefined) { tally.unmatched++; continue; }
    if (found === 'non-viable') { tally.nonViable++; continue; }

    let features;
    let actions;
    try {
      features = featurizeState(view, cardPool, vocab);
      actions = featurizeActions(view, cardPool, vocab);
    } catch {
      tally.failed++;
      continue;
    }
    const viable = actions.mask.reduce((sum: number, m) => sum + m, 0);
    if (contestedOnly && viable < 2) { tally.forced++; continue; }

    lines.push(JSON.stringify({
      k: 'd',
      game: gameIndex,
      seq: seq++,
      player: seat.index,
      phase: view.phaseState.phase,
      global: features.global,
      entities: features.entities,
      candidates: actions.candidates,
      mask: actions.mask,
      chosen: found.index,
      // No soft targets: a human leaves no distribution over the moves not
      // taken, and train_bc.py falls back to a one-hot on `chosen` when this
      // is empty. That is the honest target for a demonstration.
      weights: [],
    }));
    if (found.how === 'direct') tally.direct++; else tally.replayed++;
    if (found.duplicate) tally.duplicate++;
    tally.exported++;
  }

  if (lines.length === 0) return 0;

  const winnerIndex = winner === null ? null : (seats.find(s => s.id === winner)?.index ?? null);
  lines.push(JSON.stringify({
    k: 'r',
    game: gameIndex,
    gameId,
    // `completed` is train_bc.py's marker for "usable", not for "the game
    // ended" — an unfinished game with a null winner trains the policy head
    // and contributes z = 0 to the value head, which is what an unknown
    // outcome is worth. `unfinished` keeps the distinction in the file.
    outcome: 'completed',
    unfinished: !finished,
    winnerIndex,
    seats: seats.map(s => ({ index: s.index, name: s.name, human: s.human })),
    decisions: seq,
  }));
  fs.writeSync(out, lines.join('\n') + '\n');
  return lines.length - 1;
}

/** The export header line, identical in serial and sharded runs. */
function headerRecord(files: readonly { gameId: string }[]): Record<string, unknown> {
  return {
    k: 'h',
    formatVersion: 1,
    featureSpecVersion: FEATURE_SPEC_VERSION,
    vocabSize: vocab.size,
    vocabHash: vocab.hash,
    actionTypeCount: ACTION_TYPES.length,
    // The names behind the type indices in candidate column 0. Carried so the
    // learning side can address a type by name — `--action-weight pass=0.4`
    // rather than a bare index whose meaning depends on the feature spec.
    actionTypes: ACTION_TYPES,
    globalWidth: GLOBAL_FEATURE_WIDTH,
    entityWidth: ENTITY_FEATURE_WIDTH,
    actionWidth: ACTION_FEATURE_WIDTH,
    source: 'human-games',
    corpus: corpusDir ?? singleGame,
    logs: files.length,
    bots: [...botSeats],
    unfinished: unfinishedMode,
    contestedOnly,
    createdAt: new Date().toISOString(),
  };
}

/** Parent mode: shard the file list over children, then concatenate. */
async function runParent(files: readonly { gameId: string; file: string }[]): Promise<void> {
  const startedAt = Date.now();
  const shards = Math.max(1, Math.min(jobs, files.length));
  console.log(`Export: ${files.length} logs over ${shards} jobs -> ${outFile}`);
  const shardPaths = Array.from({ length: shards }, (_, i) => `${outFile}.shard${i}`);
  const outputs = await runChildren(process.argv[1], shardPaths.map((shardPath, i) => [
    ...(corpusDir ? ['--dir', corpusDir] : []),
    ...(singleGame ? ['--game', singleGame] : []),
    '--shard', `${i},${shards}`,
    '--out', shardPath,
    '--no-header',
    '--jobs', '1', // explicit: children inherit SIM_JOBS and must not fan out again
    ...(Number.isFinite(gameLimit) ? ['--games', String(gameLimit)] : []),
    ...(Number.isFinite(maxDecisions) ? ['--max-decisions', String(maxDecisions)] : []),
    ...(contestedOnly ? ['--contested-only'] : []),
    '--unfinished', unfinishedMode,
    '--bots', [...botSeats].join(','),
    ...(excludedBots.size > 0 ? ['--exclude-bots', [...excludedBots].join(',')] : []),
    ...(playerFilter !== undefined ? ['--players', [...playerFilter].join(',')] : []),
  ]));

  const out = fs.createWriteStream(outFile, { encoding: 'utf-8' });
  out.write(JSON.stringify(headerRecord(files)) + '\n');
  for (const shardPath of shardPaths) {
    await new Promise<void>((resolve, reject) => {
      const source = fs.createReadStream(shardPath);
      source.on('error', reject);
      source.on('end', resolve);
      source.pipe(out, { end: false });
    });
    fs.unlinkSync(shardPath);
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));

  const total = outputs.reduce((sum, output) => {
    const match = /Wrote (\d+) decisions/.exec(output);
    return sum + (match ? Number(match[1]) : 0);
  }, 0);
  for (const output of outputs) {
    for (const line of output.split('\n')) if (line.startsWith('  ')) console.log(line);
  }
  console.log(`\nWrote ${total} decisions from ${files.length} logs to ${outFile} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

/** Serial mode: read this process's share of the file list. */
function runSerial(files: readonly { gameId: string; file: string }[]): void {
  let shardIndex = 0;
  let shardCount = 1;
  if (shardSpec !== undefined) {
    const [i, n] = shardSpec.split(',').map(Number);
    if (!Number.isInteger(i) || !Number.isInteger(n) || n < 1 || i < 0 || i >= n) {
      throw new Error(`--shard expects "index,count", got "${shardSpec}"`);
    }
    shardIndex = i;
    shardCount = n;
  }

  const out = fs.openSync(outFile, 'w');
  if (!noHeader) fs.writeSync(out, JSON.stringify(headerRecord(files)) + '\n');

  const tally: Tally = {
    exported: 0, direct: 0, replayed: 0, duplicate: 0,
    bot: 0, undo: 0, unmatched: 0, nonViable: 0, forced: 0, failed: 0,
  };
  let games = 0;
  const startedAt = Date.now();
  let lastReport = startedAt;

  // The shard is taken by index over the *global* file list, so a game's
  // integer id is its position there and stays unique across shards.
  for (let i = 0; i < files.length; i++) {
    if (i % shardCount !== shardIndex) continue;
    const { gameId, file } = files[i];
    let written: number;
    try {
      written = exportGame(gameId, file, i, out, tally);
    } catch (error) {
      console.error(`  ${gameId}: ${(error as Error).message}`);
      continue;
    }
    if (written > 0) games++;
    const now = Date.now();
    if (shardSpec === undefined && now - lastReport > 5000) {
      const rate = tally.exported / ((now - startedAt) / 1000);
      console.log(`  ${games} games, ${tally.exported} decisions (${rate.toFixed(0)}/s)`);
      lastReport = now;
    }
  }

  fs.closeSync(out);
  const wall = (Date.now() - startedAt) / 1000;
  console.log(`Wrote ${tally.exported} decisions from ${games} games in ${wall.toFixed(1)}s`);
  console.log(`  attribution: ${tally.direct} direct, ${tally.replayed} replayed, ${tally.unmatched} unmatched`
    + (tally.duplicate > 0 ? `, ${tally.duplicate} ambiguous-but-identical` : ''));
  const dropped = tally.undo + tally.nonViable + tally.forced + tally.failed;
  if (dropped > 0) {
    console.log(`  dropped: ${tally.undo} undo, ${tally.nonViable} no longer legal, `
      + `${tally.forced} forced, ${tally.failed} projection errors`);
  }
}

async function main(): Promise<void> {
  const files = logFiles().slice(0, Number.isFinite(gameLimit) ? gameLimit : undefined);
  if (files.length === 0) {
    console.error('export-human: no game logs found');
    process.exit(1);
  }
  if (jobs > 1 && shardSpec === undefined) await runParent(files);
  else runSerial(files);
}

void main();
