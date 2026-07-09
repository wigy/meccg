/**
 * @module wh-70.test
 *
 * Card test: Gatherer of Loyalties (wh-70)
 * Type: minion-resource-event (Fallen-wizard stage resource permanent-event)
 *
 * Printed text:
 *   "Playable if you have more than 3 stage points. Your unique factions are
 *    each worth 2 marshalling points. If you are Alatar, your unique Dragon
 *    factions are each worth 4 marshalling points. If you are Pallando, your
 *    unique factions normally worth 3 or more marshalling points are each worth
 *    3 marshalling points. Cannot be duplicated by a given player."
 *
 * Card shape (data):
 *   - Stage resource permanent-event (`alignment: 'stage'`, `eventType:
 *     'permanent'`); contributes 3 stage points (`stage-points`).
 *   - effects:
 *     1. stage-points (3) — its own stage-point contribution.
 *     2. play-condition player-state — "Playable if you have more than 3 stage
 *        points" (`player.stagePoints > 3`), gating the play-permanent-event
 *        legal action in the organization phase.
 *     3. duplication-limit (scope player, max 1) — "Cannot be duplicated by a
 *        given player".
 *     4. faction-mp-override — re-values the player's factions while in play:
 *        base unique → 2; Alatar's unique Dragon → 4; Pallando's unique
 *        normally-3+ → 3 (last matching rule wins).
 *
 * These tests drive the recompute / legal-action pipeline; the card shape is
 * documented above rather than asserted against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions,
  RESOURCE_PLAYER,
  addCardInPlay, recomputeDerived,
  ISENGARD, RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

// ─── Local card-ID constants ───────────────────────────────────────────────
const GATHERER       = 'wh-70' as CardDefinitionId; // the card under test
const ALATAR_FW      = 'wh-1'  as CardDefinitionId; // Fallen-wizard avatar Alatar
const PALLANDO_FW    = 'wh-7'  as CardDefinitionId; // Fallen-wizard avatar Pallando
const SARUMAN_FW     = 'wh-9'  as CardDefinitionId; // Fallen-wizard avatar Saruman
const ORCS_OF_MORIA  = 'le-278' as CardDefinitionId; // unique Orc faction, printed 3 MP
const GOBLINS_GG     = 'le-265' as CardDefinitionId; // unique Orc faction, printed 2 MP
const SMAUG_ROUSED   = 'le-285' as CardDefinitionId; // unique Dragon faction, printed 5 MP
const SNAGA_HAI      = 'le-286' as CardDefinitionId; // NON-unique Orc faction, printed 1 MP
const GREAT_EAGLES   = 'tw-344' as CardDefinitionId; // unique Eagle faction, printed 3 MP (race outside Pallando wh-7's list)

/** A Fallen-wizard (player 0) at Isengard with `avatar`, plus an idle opponent. */
function fwState(avatar: CardDefinitionId) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ISENGARD, characters: [avatar] }],
        hand: [],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
    ],
  });
}

describe('Gatherer of Loyalties (wh-70)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: unique factions worth 2 MP each ───────────────────────────────

  test('unique faction re-valued to 2 MP while Gatherer is in play', () => {
    // Saruman FW controls Orcs of Moria (unique, printed 3). MEWH §4 would clamp
    // it to 1, but Gatherer's base rule makes every unique faction worth 2.
    let state = fwState(SARUMAN_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, GATHERER);
    state = addCardInPlay(state, RESOURCE_PLAYER, ORCS_OF_MORIA);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
  });

  test('control: without Gatherer the same unique faction is FW-clamped to 1', () => {
    let state = fwState(SARUMAN_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, ORCS_OF_MORIA);
    state = recomputeDerived(state);

    // MEWH §4: a Fallen-wizard's non-stage card is worth a flat 1 MP.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  test('non-unique faction is NOT overridden (stays at FW-clamp 1)', () => {
    // Snaga-hai is non-unique → the base rule (faction.unique) does not match,
    // so it scores normally (FW clamp 1), not the override value 2.
    let state = fwState(SARUMAN_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, GATHERER);
    state = addCardInPlay(state, RESOURCE_PLAYER, SNAGA_HAI);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(1);
  });

  // ─── Rule: Alatar — unique Dragon factions worth 4 ───────────────────────

  test('Alatar: unique Dragon faction worth 4, non-Dragon unique worth 2', () => {
    // Smaug Roused (unique Dragon, printed 5) → 4; Orcs of Moria (unique, 3) → 2.
    let state = fwState(ALATAR_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, GATHERER);
    state = addCardInPlay(state, RESOURCE_PLAYER, SMAUG_ROUSED);
    state = addCardInPlay(state, RESOURCE_PLAYER, ORCS_OF_MORIA);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(6);
  });

  test('the Dragon clause requires Alatar: a non-Alatar FW Dragon faction stays at base 2', () => {
    // Saruman (not Alatar) controls Smaug Roused (unique Dragon): only the base
    // rule applies → 2, not 4.
    let state = fwState(SARUMAN_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, GATHERER);
    state = addCardInPlay(state, RESOURCE_PLAYER, SMAUG_ROUSED);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(2);
  });

  // ─── Rule: Pallando — unique factions normally worth 3+ worth 3 ──────────

  test('Pallando: unique faction normally worth 3+ → 3; one worth <3 → base 2', () => {
    // Great Eagles (printed 3) → 3; Goblins of Goblin-gate (printed 2) → 2.
    // The 3+ faction is an Eagle rather than an Orc so this exercises Gatherer's
    // "if you are Pallando" clause in isolation: Pallando (wh-7) itself re-values
    // its Man/Dwarf/Elf/Dúnadan/Hobbit/Orc/Troll factions to 2, which would
    // otherwise collide with Gatherer's 3-MP clause on an Orc faction.
    let state = fwState(PALLANDO_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, GATHERER);
    state = addCardInPlay(state, RESOURCE_PLAYER, GREAT_EAGLES);
    state = addCardInPlay(state, RESOURCE_PLAYER, GOBLINS_GG);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(5);
  });

  test('Pallando does NOT get the Alatar Dragon bonus: a Dragon faction worth 5 scores 3, not 4', () => {
    // Smaug Roused (unique Dragon, printed 5): under Pallando the "normally 3+"
    // clause applies (→ 3); the Alatar Dragon clause (→ 4) does not.
    let state = fwState(PALLANDO_FW);
    state = addCardInPlay(state, RESOURCE_PLAYER, GATHERER);
    state = addCardInPlay(state, RESOURCE_PLAYER, SMAUG_ROUSED);
    state = recomputeDerived(state);

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.faction).toBe(3);
  });

  // ─── Rule: playable only with more than 3 stage points ───────────────────

  test('play-permanent-event offered when the FW has more than 3 stage points', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 4,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW] }],
          hand: [GATHERER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(1);
  });

  test('play-permanent-event NOT offered at exactly 3 stage points (needs MORE than 3)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 3,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW] }],
          hand: [GATHERER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(0);
  });

  // ─── Rule: cannot be duplicated by a given player ────────────────────────

  test('a second copy is not playable while one is already in play (player duplication limit)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 4,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW] }],
          hand: [GATHERER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    // One copy already in play for this player.
    state = addCardInPlay(state, RESOURCE_PLAYER, GATHERER);

    const plays = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(plays).toHaveLength(0);
  });
});
