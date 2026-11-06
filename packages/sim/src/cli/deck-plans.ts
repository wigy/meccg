/**
 * @module cli/deck-plans
 *
 * Mine what winning humans do with each challenge deck, for `services/deck-plan`.
 *
 * In the October games the modular AI took 84% of the resource plays it was
 * offered, against the humans' 90%, yet threw 10 point cards a game to their 3.
 * Whole families of cards are simply never played: Safe from the Shadow 0 of
 * 429 offers, Forewarned Is Forearmed 0 of 220, where the winners on the same
 * deck play one of each most games. Those are cards `event-value` cannot read,
 * and reading them one at a time has been the last hundred PRs.
 *
 * So this counts, per deck and card, what winners did: in how many of the turn
 * windows offering the card (a phase, on one side of the turn) they took it, and how often they
 * threw it at a discard. Only the seats of humans who won count — CLAUDE.md's
 * training policy, and a losing seat's habits are not worth copying. One
 * prolific player must not become the plan, so a player's games per deck are
 * capped, newest first.
 *
 * Usage:
 *   npm run deck-plans -w @meccg/sim -- --dir ~/backup/ai-meccg.com [--before 2026-10-15] [--out file]
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GameAction, GameState } from '@meccg/shared';
import { cliPreamble, numberFlag, stringFlag } from './common.js';
import { readGameLog } from '../ai/h2/game-log.js';
import { ALL_DECKS, DECK_PLANS_SOURCE_PATH, windowOf } from '../ai/h2/services/deck-plan.js';
import type { CardPlan, DeckPlan, DeckPlans } from '../ai/h2/services/deck-plan.js';

const USAGE = `Usage: deck-plans --dir <corpus> [--before <ISO date>] [--per-player <n>] [--out <file>]

Mine per-deck card statistics from the winning human seats of a recorded corpus.
  --dir         corpus directory holding games/ and logs/games/
  --before      only games started before this date (leave newer ones out to test on)
  --per-player  most games one player contributes per deck, newest first (default 12)
  --out         where to write the plans (default: the file the AI loads)`;

/** A legal action as the log records it: a non-viable preview carries a reason. */
interface LoggedAction {
  readonly action: GameAction;
  readonly reason?: string;
}

/** The fields this reads of a completed-game summary. */
interface Summary {
  readonly gameId: string;
  readonly startedAt: string;
  readonly winner: string | null;
  readonly winReason: string;
  readonly players: readonly {
    readonly playerId: string;
    readonly name: string;
    readonly human: boolean;
    readonly deck?: { readonly id?: string } | null;
  }[];
}

/** One seat worth learning from. */
interface Seat {
  readonly gameId: string;
  readonly startedAt: string;
  readonly playerId: string;
  readonly name: string;
  readonly deck: string | null;
}

/** Action types that put a card from hand to use, and the field naming the card. */
const PLAY_FIELDS: Readonly<Record<string, string>> = {
  'play-hero-resource': 'cardInstanceId',
  'play-short-event': 'cardInstanceId',
  'play-long-event': 'cardInstanceId',
  'play-permanent-event': 'cardInstanceId',
  'play-hazard': 'cardInstanceId',
  'play-character': 'characterInstanceId',
  'influence-attempt': 'factionInstanceId',
};

/** The challenge deck a player's copy derives from, as its letter. */
function challengeLetter(deckId: string | undefined): string | null {
  return /challenge-deck-([a-z])$/.exec(deckId ?? '')?.[1] ?? null;
}

/**
 * The seats worth learning from: humans who won a game that was really played.
 *
 * A forfeited game has no value, however long it ran.
 */
function winningSeats(dir: string, before: string | undefined, perPlayer: number): Seat[] {
  const summaries = path.join(dir, 'games');
  const seats: Seat[] = [];
  for (const file of fs.readdirSync(summaries)) {
    if (!file.endsWith('.json')) continue;
    const game = JSON.parse(fs.readFileSync(path.join(summaries, file), 'utf-8')) as Summary;
    if (before !== undefined && game.startedAt >= before) continue;
    if (game.winReason === 'concession') continue;
    const seat = game.players.find(p => p.human && p.name === game.winner);
    if (!seat) continue;
    seats.push({
      gameId: game.gameId,
      startedAt: game.startedAt,
      playerId: seat.playerId,
      name: seat.name,
      deck: challengeLetter(seat.deck?.id),
    });
  }
  seats.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const taken = new Map<string, number>();
  return seats.filter(seat => {
    const key = `${seat.name}/${seat.deck ?? ''}`;
    const count = taken.get(key) ?? 0;
    taken.set(key, count + 1);
    return count < perPlayer;
  });
}

/** Mutable counts for one card. */
type Counts = { plays: number; throws: number; windows: Record<string, [number, number]> };

/** Add one seat's decisions to a deck's card table. */
function mine(dir: string, seat: Seat, tables: readonly Map<string, Counts>[]): void {
  const logs = path.join(dir, 'logs', 'games');
  const sidecar = path.join(logs, `${seat.gameId}-cards.json`);
  const logRef = path.join(logs, `${seat.gameId}.jsonl`);
  if (!fs.existsSync(sidecar) || !fs.existsSync(logRef)) return;
  const instances = (JSON.parse(fs.readFileSync(sidecar, 'utf-8')) as { instances?: Record<string, string> }).instances ?? {};
  const countsOf = (definitionId: string): Counts[] => tables.map(table => {
    let counts = table.get(definitionId);
    if (!counts) {
      counts = { plays: 0, throws: 0, windows: {} };
      table.set(definitionId, counts);
    }
    return counts;
  });

  // An organization phase is many decisions and one chance to play a card, so
  // an offer counts once per turn window: Fell Rider is played in 21 of the 272
  // decisions offering it, but that is most of the windows it was on offer.
  const counted = new Set<string>();
  let previous: { state: GameState; legal: readonly LoggedAction[]; turn: number } | null = null;
  let previousSeq = -1;
  for (const record of readGameLog(logRef)) {
    if (record.stateSeq === previousSeq) continue;
    previousSeq = record.stateSeq;
    const action = record.action as (GameAction & Record<string, string>) | undefined;
    if (previous && action && action.player === seat.playerId) {
      const window = windowOf(previous.state, seat.playerId);
      const offered = new Set<string>();
      for (const { action: candidate, reason } of previous.legal) {
        const field = PLAY_FIELDS[candidate.type];
        const instance = field ? (candidate as unknown as Record<string, string>)[field] : undefined;
        if (reason === undefined && instance && instances[instance]) offered.add(instances[instance]);
      }
      for (const definitionId of offered) {
        const key = `${previous.turn}/${window}/${definitionId}`;
        if (counted.has(key)) continue;
        counted.add(key);
        for (const counts of countsOf(definitionId)) (counts.windows[window] ??= [0, 0])[0]++;
      }
      const field = PLAY_FIELDS[action.type];
      const played = field ? instances[action[field]] : undefined;
      if (played) {
        for (const counts of countsOf(played)) {
          counts.plays++;
          (counts.windows[window] ??= [0, 0])[1]++;
        }
      }
      const thrown = action.type === 'discard-card' ? instances[action['cardInstanceId']] : undefined;
      if (thrown) for (const counts of countsOf(thrown)) counts.throws++;
    }
    const legalBySeat = (record as unknown as { legalActions?: Record<string, readonly LoggedAction[]> }).legalActions;
    previous = { state: record.state, legal: legalBySeat?.[seat.playerId] ?? [], turn: record.turn };
  }
}

/** Freeze a table into the shipped form, dropping cards too rare to say anything. */
function planOf(games: number, table: ReadonlyMap<string, Counts>): DeckPlan {
  const cards: Record<string, CardPlan> = {};
  for (const [definitionId, counts] of [...table].sort(([a], [b]) => a.localeCompare(b))) {
    if (counts.plays + counts.throws < 2) continue;
    cards[definitionId] = counts;
  }
  return { games, cards };
}

const args = cliPreamble(USAGE);
const dir = stringFlag(args, 'dir');
if (!dir) {
  console.error('deck-plans: pass --dir <corpus>');
  process.exit(2);
}
const before = stringFlag(args, 'before');
const seats = winningSeats(dir, before, numberFlag(args, 'per-player', 12));

const tables = new Map<string, Map<string, Counts>>();
const games = new Map<string, number>();
const tableOf = (deck: string): Map<string, Counts> => {
  let table = tables.get(deck);
  if (!table) {
    table = new Map();
    tables.set(deck, table);
  }
  return table;
};
for (const seat of seats) {
  const decks = seat.deck ? [seat.deck, ALL_DECKS] : [ALL_DECKS];
  for (const deck of decks) games.set(deck, (games.get(deck) ?? 0) + 1);
  mine(dir, seat, decks.map(tableOf));
}

const plans: DeckPlans = {
  decks: Object.fromEntries([...tables].sort(([a], [b]) => a.localeCompare(b))
    .map(([deck, table]) => [deck, planOf(games.get(deck) ?? 0, table)])),
};
const out = stringFlag(args, 'out') ?? DECK_PLANS_SOURCE_PATH;
fs.writeFileSync(out, `${JSON.stringify(plans)}\n`);
console.log(`deck-plans: ${seats.length} winning seats → ${out}`);
for (const [deck, plan] of Object.entries(plans.decks)) {
  console.log(`  ${deck}: ${plan.games} seats, ${Object.keys(plan.cards).length} cards`);
}
