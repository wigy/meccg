/**
 * @module td-54.test
 *
 * Card test: Peril Returned (td-54)
 * Type: hazard-event (Long-event, Environment)
 * Unique: no
 *
 * Card text:
 *   "If Gates of Morning is not in play, Doors of Night is considered to be in
 *    play. If Gates of Morning is in play, it is considered to be out of play
 *    while Peril Returned is in play. Gates of Morning may still be removed
 *    normally (e.g., through the use of Twilight, Doors of Night, etc.)."
 *
 * Both branches net to the same unconditional interpretation while Peril
 * Returned is in play: Doors of Night is considered in play and Gates of Morning
 * is considered out of play. The Gates of Morning *card* is not removed — only
 * its environment interpretation is suppressed, so it remains targetable for
 * normal removal.
 *
 * Effects (data):
 *   - environment-override: considerInPlay ["Doors of Night"],
 *     considerNotInPlay ["Gates of Morning"]
 *
 * Engine Support:
 * | # | Rule                                                | Status      | Notes                                                                 |
 * |---|-----------------------------------------------------|-------------|-----------------------------------------------------------------------|
 * | 1 | Doors of Night considered in play                   | IMPLEMENTED | environment-override → buildInPlayNames + name-in-play predicates add it |
 * | 2 | Gates of Morning considered out of play             | IMPLEMENTED | same override removes it from every "is X in play?" query             |
 * | 3 | Gates of Morning card still removable normally      | IMPLEMENTED | card stays in cardsInPlay; only its interpretation is suppressed      |
 *
 * Playable: FULLY — CERTIFIED (2026-07-17).
 *
 * The override is exercised through downstream play-condition gates:
 *   - Snowstorm (tw-91), playable only "if Doors of Night is in play", becomes
 *     playable with Peril Returned alone (no physical Doors of Night).
 *   - Eyes of the Shadow (dm-56), playable only "if Gates of Morning is not in
 *     play", becomes playable even while a physical Gates of Morning sits in
 *     play, once Peril Returned suppresses it.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState,
  resetMint,
  Phase,
  makeMHState,
  addCardInPlay,
  PLAYER_1,
  PLAYER_2,
  RESOURCE_PLAYER,
  HAZARD_PLAYER,
  ARAGORN,
  LEGOLAS,
  GANDALF,
  RIVENDELL,
  LORIEN,
  MORIA,
  MINAS_TIRITH,
  GATES_OF_MORNING,
} from '../test-helpers.js';
import { RegionType, computeLegalActions } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import type { CardDefinitionId, GameState } from '../../index.js';
import { buildInPlayNames } from '../../engine/recompute-derived.js';

const PERIL_RETURNED = 'td-54' as CardDefinitionId;
const SNOWSTORM = 'tw-91' as CardDefinitionId;
const EYES_OF_THE_SHADOW = 'dm-56' as CardDefinitionId;

describe('Peril Returned (td-54)', () => {
  beforeEach(() => {
    resetMint();
  });

  // ─── Rule 1: Doors of Night considered in play ────────────────────────────

  const snowstormMHState = (): GameState => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [SNOWSTORM], siteDeck: [MINAS_TIRITH] },
      ],
    });
    return { ...built, phaseState: makeMHState({ resolvedSitePath: [RegionType.Wilderness] }) };
  };

  const snowstormViable = (state: GameState): boolean | undefined =>
    computeLegalActions(state, PLAYER_2).find(
      ea => ea.action.type === 'play-hazard'
        && resolveInstanceId(state, ea.action.cardInstanceId) === SNOWSTORM,
    )?.viable;

  test('with neither environment in play, Snowstorm (needs Doors of Night) is not viable', () => {
    expect(snowstormViable(snowstormMHState())).toBe(false);
  });

  test('Peril Returned makes Doors of Night considered in play, so Snowstorm becomes playable', () => {
    const withPeril = addCardInPlay(snowstormMHState(), HAZARD_PLAYER, PERIL_RETURNED);
    // No physical Doors of Night anywhere — only Peril Returned's override.
    expect(withPeril.players.some(p => p.cardsInPlay.some(c => c.definitionId === 'tw-28'))).toBe(false);
    expect(buildInPlayNames(withPeril)).toContain('Doors of Night');
    expect(snowstormViable(withPeril)).toBe(true);
  });

  // ─── Rule 2 & 3: Gates of Morning considered out (but still in cardsInPlay) ─

  const eyesMHState = (extraInPlay: Array<{ owner: 0 | 1; def: CardDefinitionId }>): GameState => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [EYES_OF_THE_SHADOW], siteDeck: [MINAS_TIRITH] },
      ],
    });
    let state = built;
    for (const { owner, def } of extraInPlay) state = addCardInPlay(state, owner, def);
    return { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
  };

  const eyesViable = (state: GameState): boolean =>
    computeLegalActions(state, PLAYER_2).some(
      ea => ea.viable
        && ea.action.type === 'play-hazard'
        && resolveInstanceId(state, ea.action.cardInstanceId) === EYES_OF_THE_SHADOW,
    );

  test('with a physical Gates of Morning in play, Eyes of the Shadow (needs it absent) is not playable', () => {
    const state = eyesMHState([{ owner: RESOURCE_PLAYER, def: GATES_OF_MORNING }]);
    expect(buildInPlayNames(state)).toContain('Gates of Morning');
    expect(eyesViable(state)).toBe(false);
  });

  test('Peril Returned makes Gates of Morning considered out of play, so Eyes of the Shadow becomes playable', () => {
    const state = eyesMHState([
      { owner: RESOURCE_PLAYER, def: GATES_OF_MORNING },
      { owner: HAZARD_PLAYER, def: PERIL_RETURNED },
    ]);
    // Interpretation suppressed …
    expect(buildInPlayNames(state)).not.toContain('Gates of Morning');
    expect(buildInPlayNames(state)).toContain('Doors of Night');
    expect(eyesViable(state)).toBe(true);
  });

  test('the Gates of Morning card itself stays in play (still removable normally)', () => {
    const state = eyesMHState([
      { owner: RESOURCE_PLAYER, def: GATES_OF_MORNING },
      { owner: HAZARD_PLAYER, def: PERIL_RETURNED },
    ]);
    // The card instance is untouched in cardsInPlay even though its
    // environment interpretation is suppressed.
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GATES_OF_MORNING)).toBe(true);
  });
});
