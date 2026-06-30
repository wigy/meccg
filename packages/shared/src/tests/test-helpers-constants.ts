/**
 * @module test-helpers-constants
 *
 * Foundational test constants shared across the test harness: player ids and
 * indices (PLAYER_1/PLAYER_2/RESOURCE_PLAYER/HAZARD_PLAYER), the loaded card
 * pool, the standard deck fixtures (HERO_RESOURCES_30, MINION_RESOURCES_30,
 * HAZARD_CREATURES_12, HAZARD_DECK_30) and P1_COMPANY. Split out of
 * test-helpers.ts (re-exported from there) so the most-referenced, rarely-changed
 * base values live in their own module — reducing merge-conflict churn on the
 * monolithic helper file. Imports only engine modules, so nothing imports it
 * back (no cycle).
 */

import { loadCardPool } from '../index.js';
import type { PlayerId, CardDefinitionId, CompanyId } from '../index.js';

/** The player-state pile collections a test may inspect or push cards into. */
export type PileKey =
  | 'hand'
  | 'playDeck'
  | 'discardPile'
  | 'siteDeck'
  | 'siteDiscardPile'
  | 'sideboard'
  | 'killPile'
  | 'outOfPlayPile';

export const PLAYER_1 = 'p1' as PlayerId;
export const PLAYER_2 = 'p2' as PlayerId;

/**
 * Player index convention for tests: unless a test deliberately flips
 * roles, player 0 is the resource (active) player and player 1 is the
 * hazard (opponent) player. Prefer these constants over bare `0` / `1`
 * when calling helpers like `charIdAt`, `getCharacter`, `handCardId`,
 * `attachHazardToChar`, etc., so test intent reads at the call site.
 *
 * For tests whose `activePlayer` is `PLAYER_2`, the convention does not
 * apply — use bare indices (with a short comment) or add a local
 * `const HERO_IDX = 1;` to clarify.
 */
export const RESOURCE_PLAYER = 0;
export const HAZARD_PLAYER = 1;

export const pool = loadCardPool();

/**
 * 30 hero resources (3 copies × 10 different non-unique cards) for deck fixtures
 * that satisfy the rule-1.30 minimum without violating the rule-1.04 copy limit.
 */
export const HERO_RESOURCES_30 = [
  { name: 'Gates of Morning', card: 'tw-243' as CardDefinitionId, qty: 3 },
  { name: 'Sun', card: 'tw-335' as CardDefinitionId, qty: 3 },
  { name: 'Concealment', card: 'tw-204' as CardDefinitionId, qty: 3 },
  { name: 'Dark Quarrels', card: 'tw-207' as CardDefinitionId, qty: 3 },
  { name: 'Dodge', card: 'tw-209' as CardDefinitionId, qty: 3 },
  { name: 'Great Ship', card: 'tw-248' as CardDefinitionId, qty: 3 },
  { name: 'Halfling Strength', card: 'tw-253' as CardDefinitionId, qty: 3 },
  { name: 'Align Palantír', card: 'tw-190' as CardDefinitionId, qty: 3 },
  { name: 'Vanishment', card: 'tw-356' as CardDefinitionId, qty: 3 },
  { name: "Wizard's Laughter", card: 'tw-362' as CardDefinitionId, qty: 3 },
] as const;

/**
 * 30 minion resources (3 copies × 10 different non-unique cards) for deck fixtures
 * that satisfy the rule-1.30 minimum without violating the rule-1.04 copy limit.
 */
export const MINION_RESOURCES_30 = [
  { name: 'Black Mace', card: 'le-299' as CardDefinitionId, qty: 3 },
  { name: 'Saw-toothed Blade', card: 'le-342' as CardDefinitionId, qty: 3 },
  { name: 'Orc-draughts', card: 'le-328' as CardDefinitionId, qty: 3 },
  { name: 'Foul-smelling Paste', card: 'le-310' as CardDefinitionId, qty: 3 },
  { name: 'Blazon of the Eye', card: 'le-302' as CardDefinitionId, qty: 3 },
  { name: 'Orc Quarrels', card: 'le-216' as CardDefinitionId, qty: 3 },
  { name: 'Weigh All Things to a Nicety', card: 'le-253' as CardDefinitionId, qty: 3 },
  { name: 'A Nice Place to Hide', card: 'le-160' as CardDefinitionId, qty: 3 },
  { name: 'Ruse', card: 'le-225' as CardDefinitionId, qty: 3 },
  { name: 'Sudden Call', card: 'le-235' as CardDefinitionId, qty: 3 },
] as const;

/**
 * 12 hazard creatures (3 copies × 4 different non-unique cards) for deck fixtures
 * that satisfy the rule-1.30 creature minimum without violating rule-1.04.
 */
export const HAZARD_CREATURES_12 = [
  { name: 'Cave-drake', card: 'tw-020' as CardDefinitionId, qty: 3 },
  { name: 'Orc-patrol', card: 'tw-074' as CardDefinitionId, qty: 3 },
  { name: 'Barrow-wight', card: 'tw-015' as CardDefinitionId, qty: 3 },
  { name: 'Orc-guard', card: 'tw-072' as CardDefinitionId, qty: 3 },
] as const;

/**
 * 30 hazards (21 creatures + 9 hazard events) for deck fixtures that must
 * satisfy rule 1.30's requirement that the hazard count equal the resource
 * count (30 resources ⇒ 30 hazards), while also meeting the 12-creature
 * minimum and respecting the rule-1.04 copy limit.
 */
export const HAZARD_DECK_30 = [
  ...HAZARD_CREATURES_12,
  { name: 'Orc-lieutenant', card: 'tw-073' as CardDefinitionId, qty: 3 },
  { name: 'Orc-warband', card: 'tw-076' as CardDefinitionId, qty: 3 },
  { name: 'Orc-watch', card: 'tw-078' as CardDefinitionId, qty: 3 },
  { name: 'Doors of Night', card: 'tw-28' as CardDefinitionId, qty: 3 },
  { name: 'Twilight', card: 'tw-106' as CardDefinitionId, qty: 3 },
  { name: 'Choking Shadows', card: 'tw-21' as CardDefinitionId, qty: 3 },
] as const;

/** The company ID for PLAYER_1's first company (target of hazards). */
export const P1_COMPANY = `company-${PLAYER_1 as string}-0` as CompanyId;
