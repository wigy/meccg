/**
 * @module tutorial/ids
 *
 * Card definition IDs used only by the guided tutorial
 * (specs/2026-07-30-tutorial-plan.md). IDs already promoted to
 * `card-ids.ts` (used elsewhere in the codebase) are re-exported from there;
 * tutorial-only IDs are declared here rather than widening the shared
 * constants file (see the card-ids.ts constants policy).
 *
 * Every card referenced by the tutorial must be certified — the deck lint
 * test in `tests/tutorial/` enforces this against the card data.
 */

import type { CardDefinitionId } from '../types/common.js';

const did = (id: string): CardDefinitionId => id as CardDefinitionId;

// ---- The player's elves (see spec: draft pool) ----

/** Arwen — mind 3, sage, home site Rivendell; played in the organization phase. */
export const ARWEN = did('tw-122');
/** Annalena — Elf, mind 3, scout/sage; Glorfindel II's follower (his +1 DI vs Elves), takes the scripted Barrow-downs wound. */
export const ANNALENA = did('tw-119');
/** Elrohir — mind 4, warrior; bears Sword of Gondolin. */
export const ELROHIR = did('tw-144');
/** Gildor Inglorion — mind 4; deliberately left undrafted → character-deck-draft. */
export const GILDOR_INGLORION = did('tw-158');

// ---- The player's resources ----

/** Star of High Hope — long-event environment: +1 prowess to Elves (+2 with Gates of Morning). */
export const STAR_OF_HIGH_HOPE = did('td-154');
/** Sword of Gondolin — major item, warrior only +2 prowess, 2 MP; played at Barrow-downs. */
export const SWORD_OF_GONDOLIN = did('tw-336');
/** Goldberry — ally, playable at Old Forest. */
export const GOLDBERRY = did('tw-245');
/** Shield of Iron-bound Ash — starting minor item, +1 body. */
export const SHIELD_OF_IRON_BOUND_ASH = did('tw-327');
/** Horn of Anor — item, +2 DI against factions; play-deck filler, one discarded at the turn-5 hand reset. */
export const HORN_OF_ANOR = did('tw-259');

// ---- The player's hazards (played on the Mentor's turns) ----

/** Orc-lieutenant — 1 strike / 7 prowess, keys to wilderness & shadow: the first creature lesson. */
export const ORC_LIEUTENANT = did('tw-073');
/** Minions Stir — hazard long-event (non-environment: unaffected by Gates of Morning). */
export const MINIONS_STIR = did('tw-61');

// ---- The Mentor's dwarves (no rangers — River must stick) ----

/** Dimrill Dale — the Mentor's turn-3 destination, blanked by River. */
export const DIMRILL_DALE = did('tw-385');

// ---- Regions (movement paths are declared as region definition-id lists) ----

/** Rhudaur — Rivendell's region. */
export const RHUDAUR = did('tw-482');
/** Cardolan — Barrow-downs and Old Forest. */
export const CARDOLAN = did('tw-450');
/** Enedhwaith — on the road south. */
export const ENEDHWAITH = did('tw-455');
/** Gap of Isen — the door to Rohan. */
export const GAP_OF_ISEN = did('tw-459');
/** Rohan — Edoras' region. */
export const ROHAN = did('tw-483');

/** Thorin II — mind 8, warrior/scout/diplomat. */
export const THORIN_II = did('tw-183');
/** Glóin — mind 5, warrior/diplomat. */
export const GLOIN = did('tw-160');
// Gimli (tw-159) is re-used from card-ids.ts.
