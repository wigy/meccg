/**
 * @module tutorial/decks
 *
 * The two pre-arranged decks for the guided tutorial
 * (specs/2026-07-30-tutorial-plan.md). These are deliberately NOT in the
 * `data/decks/` catalog: they must never appear in deck listings. The
 * tutorial game is created with {@link GameConfig.orderedDecks}, so each
 * `playDeck` array below is the literal draw order — index 0 is the first
 * card of the opening hand, index 8 the first card drawn after setup.
 *
 * Every card here must be certified; `tests/tutorial/` lints this against
 * the card data.
 */

import type { CardDefinitionId } from '../types/common.js';
import { Alignment } from '../types/common.js';
import {
  GLORFINDEL_II, ELROND, GIMLI,
  DAGGER_OF_WESTERNESSE, GLAMDRING, SUN, CAVE_DRAKE,
  GATES_OF_MORNING, MARVELS_TOLD, RIDERS_OF_ROHAN,
  FOOLISH_WORDS, LURE_OF_THE_SENSES, RIVER,
  RIVENDELL, BARROW_DOWNS, OLD_FOREST, EDORAS, MORIA, LORIEN,
} from '../card-ids.js';
import {
  ARWEN, ANNALENA, ELROHIR, GILDOR_INGLORION,
  STAR_OF_HIGH_HOPE, SWORD_OF_GONDOLIN, GOLDBERRY, SHIELD_OF_IRON_BOUND_ASH,
  HORN_OF_ANOR, ORC_LIEUTENANT, MINIONS_STIR,
  THORIN_II, GLOIN, DIMRILL_DALE,
} from './ids.js';

/**
 * A player's deck for the tutorial: the {@link PlayerConfig} fields that
 * come from a deck (everything except `id`/`name`, which the session
 * supplies at join time).
 */
export interface TutorialDeck {
  readonly alignment: Alignment;
  readonly draftPool: readonly CardDefinitionId[];
  readonly playDeck: readonly CardDefinitionId[];
  readonly siteDeck: readonly CardDefinitionId[];
  readonly sideboard: readonly CardDefinitionId[];
}

/**
 * The human player's deck: an all-Elf Rivendell company.
 *
 * Draft: Glorfindel II + Annalena + Elrohir (15 mind — Annalena later moves
 * under Glorfindel's direct influence, his +1 DI vs Elves covering her mind 3),
 * Elrond as the blocked mind-limit pick, Gildor left for the
 * character-deck-draft, and two starting minor items.
 */
export const TUTORIAL_HERO_DECK: TutorialDeck = {
  alignment: Alignment.Wizard,
  draftPool: [
    GLORFINDEL_II,
    ANNALENA,
    ELROHIR,
    ELROND,
    GILDOR_INGLORION,
    DAGGER_OF_WESTERNESSE,
    SHIELD_OF_IRON_BOUND_ASH,
  ],
  // Draw order. Cards 0-7 are the opening hand; the rest arrive via the
  // movement/hazard draw steps and hand refills, in this exact order.
  playDeck: [
    // ---- opening hand ----
    ARWEN,                 // turn 1 organization: play at Rivendell
    STAR_OF_HIGH_HOPE,     // turn 1 long-event phase
    SWORD_OF_GONDOLIN,     // turn 1 site phase at Barrow-downs
    ORC_LIEUTENANT,        // Mentor's turn 1: your first creature
    LURE_OF_THE_SENSES,    // Mentor's turn 2: corruption
    GOLDBERRY,             // turn 2 site phase at Old Forest
    SWORD_OF_GONDOLIN,     // the "dead card": a spare sword, discarded at end of turn 1
    MINIONS_STIR,          // Mentor's turn 2: hazard long-event
    // ---- draws ----
    GATES_OF_MORNING,      // turn 1 M/H draw: played immediately
    RIVER,                 // Mentor's turn 3: blanks its site phase
    MARVELS_TOLD,          // turn 3 site phase: answers Foolish Words
    RIDERS_OF_ROHAN,       // turn 3 site phase: the faction
    // ---- filler (mostly padding against refills) ----
    DAGGER_OF_WESTERNESSE,  // discarded at the turn 2 hand-limit (mh-2)
    CAVE_DRAKE,
    DAGGER_OF_WESTERNESSE,  // turn 2 site phase: the additional-minor-item bonus
    CAVE_DRAKE,
    HORN_OF_ANOR,
    CAVE_DRAKE,
    DAGGER_OF_WESTERNESSE,
    ORC_LIEUTENANT,
    HORN_OF_ANOR,
    ORC_LIEUTENANT,
    MINIONS_STIR,
    LURE_OF_THE_SENSES,
    MINIONS_STIR,
    LURE_OF_THE_SENSES,
    RIVER,
    RIVER,
  ],
  siteDeck: [RIVENDELL, BARROW_DOWNS, OLD_FOREST, EDORAS],
  sideboard: [],
};

/**
 * The Mentor's deck: a dwarf company (Thorin II, Gimli, Glóin — 19 mind,
 * warriors and diplomats, deliberately **no rangers** so River cannot be
 * cancelled). Route: Rivendell → Moria (Glamdring) → Lórien → Dimrill Dale
 * (blanked by River).
 */
export const TUTORIAL_MENTOR_DECK: TutorialDeck = {
  alignment: Alignment.Wizard,
  draftPool: [THORIN_II, GIMLI, GLOIN],
  playDeck: [
    // ---- opening hand ----
    GLAMDRING,             // turn 1 site phase at Moria
    FOOLISH_WORDS,         // human's turn 3: placed on-guard at Edoras
    DAGGER_OF_WESTERNESSE,
    DAGGER_OF_WESTERNESSE,
    DAGGER_OF_WESTERNESSE,
    SUN,
    SUN,
    CAVE_DRAKE,
    // ---- draws / filler ----
    CAVE_DRAKE,
    CAVE_DRAKE,
    ORC_LIEUTENANT,
    ORC_LIEUTENANT,
    LURE_OF_THE_SENSES,
    RIVER,
    MARVELS_TOLD,
    GATES_OF_MORNING,
    STAR_OF_HIGH_HOPE,
    GOLDBERRY,
    SUN,
    CAVE_DRAKE,
    DAGGER_OF_WESTERNESSE,
    RIVER,
    LURE_OF_THE_SENSES,
    CAVE_DRAKE,
  ],
  siteDeck: [RIVENDELL, MORIA, LORIEN, DIMRILL_DALE],
  sideboard: [],
};
