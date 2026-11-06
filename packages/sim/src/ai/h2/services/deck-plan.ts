/**
 * @module ai/h2/services/deck-plan
 *
 * What winning humans do with the deck this seat is playing.
 *
 * A deck is built around a plan, and its owner knows the plan before the first
 * card is drawn: which events are worth a card, which cards to hold on to. Most
 * of that is out of reach of `event-value`, which prices a card by reading its
 * effects and has no opinion on any family it cannot read — and a card nobody
 * has an opinion on is never played and is the first to be thrown. In the
 * October games the modular AI threw 10 point cards a game to the humans' 3, and
 * played Safe from the Shadow 0 times in 429 offers.
 *
 * So this answers two questions from `cli/deck-plans`' counts over winning human
 * seats, the only imitation source CLAUDE.md allows:
 *
 * - **How often do they play it, here?** The share of the turn windows offering
 *   the card (a phase, on one side of the turn) in which they took it. That becomes
 *   a *floor* under a play's value rather than a bonus on it, so a card the
 *   modules already price well is not counted twice.
 * - **How often do they keep it?** Plays against throws. That is charged only by
 *   the discard, deliberately: raising held prices everywhere lifted protection
 *   cards over point cards in every decision those prices feed, and cost Elo
 *   (see `services/cycling`).
 *
 * A deck is recognised by its contents, not its name, so a player's edited copy
 * still finds its plan. Too little data on the deck falls back to the same card
 * across all decks, and too little there means no opinion.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Tunables } from '../core/tunables.js';
import type { OwnDeckList } from '../../../types.js';

/** What winners did with one card: `windows[window]` is `[offered, taken]`. */
export interface CardPlan {
  readonly plays: number;
  readonly throws: number;
  readonly windows: Readonly<Record<string, readonly [number, number]>>;
}

/** One deck's card table. */
export interface DeckPlan {
  readonly games: number;
  readonly cards: Readonly<Record<string, CardPlan>>;
}

/** The shipped file. */
export interface DeckPlans {
  readonly decks: Readonly<Record<string, DeckPlan>>;
}

/** The pseudo-deck holding every winning seat, whatever it played. */
export const ALL_DECKS = '*';

/** A deck's own count for a card must reach this, or the all-decks one is used. */
const MIN_SAMPLES = 8;

/** Pseudo-counts of "offered, not taken", so a card taken 2 of 2 is not a certainty. */
const RATE_PRIOR = 4;

/** Pseudo-counts on each side of plays against throws. */
const KEEP_PRIOR = 2;

/** How much of a deck's cards must be in the plan's table for it to be that deck. */
const MIN_OVERLAP = 0.7;

/** The shipped plans, beside this module. */
const DECK_PLANS_PATH = path.join(__dirname, 'deck-plans.json');

/** The same file under `src/`, since `tsc` does not copy JSON into `dist/`. */
export const DECK_PLANS_SOURCE_PATH = DECK_PLANS_PATH.includes(`${path.sep}dist${path.sep}`)
  ? DECK_PLANS_PATH.replace(`${path.sep}dist${path.sep}`, `${path.sep}src${path.sep}`)
  : DECK_PLANS_PATH;

/**
 * The name a decision's window goes by: its phase, whose turn it is, and what
 * is in front of the player.
 *
 * A card played in answer to a chain or in a combat says nothing about playing
 * it into an empty phase, and mixing them is how the floor came to fire in 95
 * chain-priority decisions where the winners passed.
 */
export function windowOf(position: {
  readonly phaseState: { readonly phase: string };
  readonly activePlayer: unknown;
  readonly chain?: unknown;
  readonly combat?: unknown;
}, self: unknown): string {
  const facing = position.combat ? 'combat' : position.chain ? 'chain' : 'open';
  return `${position.phaseState.phase}/${position.activePlayer === self ? 'own' : 'opp'}/${facing}`;
}

let loaded: DeckPlans | null = null;

/** Read the shipped plans once. */
function shippedPlans(): DeckPlans {
  if (loaded) return loaded;
  // An override, so a plan mined from older games can be tested on newer ones.
  const file = process.env['MECCG_DECK_PLANS']
    ?? (fs.existsSync(DECK_PLANS_PATH) ? DECK_PLANS_PATH : DECK_PLANS_SOURCE_PATH);
  loaded = JSON.parse(fs.readFileSync(file, 'utf-8')) as DeckPlans;
  return loaded;
}

/** Which plan a deck list belongs to, or null when no deck's table covers it. */
export function recognizeDeck(ownDeck: OwnDeckList | undefined, plans: DeckPlans): DeckPlan | null {
  if (!ownDeck || ownDeck.playDeck.length === 0) return null;
  let best: DeckPlan | null = null;
  let bestOverlap = MIN_OVERLAP;
  for (const [name, plan] of Object.entries(plans.decks)) {
    if (name === ALL_DECKS) continue;
    const overlap = ownDeck.playDeck.filter(id => plan.cards[id]).length / ownDeck.playDeck.length;
    if (overlap > bestOverlap) {
      best = plan;
      bestOverlap = overlap;
    }
  }
  return best;
}

/** The two answers a seat can ask of its plan. */
export interface DeckPlanAdvice {
  /** The share of offers in this window winners took, or null for no opinion. */
  playRate(definitionId: string, window: string): number | null;
  /** The share of plays among plays and throws, or null for no opinion. */
  keepRate(definitionId: string): number | null;
}

/** Build the advice for a deck from a set of plans. */
export function adviceFrom(ownDeck: OwnDeckList | undefined, plans: DeckPlans): DeckPlanAdvice {
  const own = recognizeDeck(ownDeck, plans);
  const all = plans.decks[ALL_DECKS] ?? null;
  return {
    playRate(definitionId, window) {
      for (const plan of [own, all]) {
        const counts = plan?.cards[definitionId]?.windows[window];
        if (counts && counts[0] >= MIN_SAMPLES) return counts[1] / (counts[0] + RATE_PRIOR);
      }
      return null;
    },
    keepRate(definitionId) {
      for (const plan of [own, all]) {
        const card = plan?.cards[definitionId];
        if (card && card.plays + card.throws >= MIN_SAMPLES) {
          return (card.plays + KEEP_PRIOR) / (card.plays + card.throws + 2 * KEEP_PRIOR);
        }
      }
      return null;
    },
  };
}

/** Advice per deck list; a seat's list is one object for the whole game. */
const adviceCache = new WeakMap<OwnDeckList, DeckPlanAdvice>();
let adviceWithoutDeck: DeckPlanAdvice | null = null;

/** The advice for this seat, from the shipped plans. */
export function deckPlanAdvice(ownDeck: OwnDeckList | undefined): DeckPlanAdvice {
  if (!ownDeck) return (adviceWithoutDeck ??= adviceFrom(undefined, shippedPlans()));
  let advice = adviceCache.get(ownDeck);
  if (!advice) {
    advice = adviceFrom(ownDeck, shippedPlans());
    adviceCache.set(ownDeck, advice);
  }
  return advice;
}

/**
 * The least playing this card is worth here, net of the card, or null when
 * winners do not play it enough in this window to say.
 */
export function playFloorTsd(
  definitionId: string,
  window: string,
  ownDeck: OwnDeckList | undefined,
  tunables: Tunables,
): { tsd: number; rate: number } | null {
  if (tunables.deckPlanPlayTsd <= 0) return null;
  const rate = deckPlanAdvice(ownDeck).playRate(definitionId, window);
  if (rate === null || rate < tunables.deckPlanMinRate) return null;
  return { tsd: tunables.deckPlanPlayTsd * rate, rate };
}

/** What throwing this card costs beyond its held worth. */
export function keepCostTsd(
  definitionId: string,
  ownDeck: OwnDeckList | undefined,
  tunables: Tunables,
): number {
  if (tunables.deckPlanKeepTsd <= 0) return 0;
  return tunables.deckPlanKeepTsd * (deckPlanAdvice(ownDeck).keepRate(definitionId) ?? 0);
}
