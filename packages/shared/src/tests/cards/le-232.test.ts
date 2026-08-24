/**
 * @module le-232.test
 *
 * Card test: Some Secret Art of Flame (le-232)
 * Type: minion-resource-event (short, sorcery)
 *
 * Card text: "Magic. Sorcery. Playable on a sorcery-using character facing an
 * attack. +4 prowess for the character against the attack. Unless he is a
 * Ringwraith, character makes a corruption check modified by -4. Cannot be
 * duplicated against a given attack."
 *
 * Effects:
 *   1. company-combat-boost — stat "prowess", value 4, requiredSkill
 *      "sorcery", cost = corruption check -4, costExemptRace "ringwraith".
 *      Cost-bearing mode: one action per qualifying sorcery-using character
 *      in the defending company, carrying `targetCharacterId`; only that one
 *      character is boosted (not every sorcery-user in the company).
 *   2. duplication-limit — scope "attack", max 1.
 *
 * Fixtures: Hador (le-14, dunadan, sorcery skill — makes the -4 check) and
 * Dwar the Ringwraith (le-52, ringwraith, sorcery skill — exempt from the
 * check).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  Phase, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS,
  ARAGORN,
  MORIA, LORIEN, MINAS_TIRITH,
  viableActions,
  makeCancelWindowCombat,
  dispatch, expectInDiscardPile,
  findCharInstanceId,
} from '../test-helpers.js';
import { Alignment, Race } from '../../index.js';
import type { PlayShortEventAction, CardDefinitionId } from '../../index.js';

const SOME_SECRET_ART_OF_FLAME = 'le-232' as CardDefinitionId;
const HADOR = 'le-14' as CardDefinitionId;   // dunadan, sorcery skill (non-Ringwraith)
const DWAR = 'le-52' as CardDefinitionId;    // ringwraith, sorcery skill

/** Minion (Ringwraith) defending company holding a sorcery-using character. */
function minionDefender(char: CardDefinitionId, hand: CardDefinitionId[]) {
  return {
    id: PLAYER_1,
    alignment: Alignment.Ringwraith,
    companies: [{ site: MORIA, characters: [char] }],
    hand,
    siteDeck: [MINAS_TIRITH],
  };
}

function opponent() {
  return { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] };
}

describe('Some Secret Art of Flame (le-232)', () => {
  beforeEach(() => resetMint());

  // ── Availability ────────────────────────────────────────────────────

  test('offered as a single-target play-short-event on the sorcery-using character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [minionDefender(HADOR, [SOME_SECRET_ART_OF_FLAME]), opponent()],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions).toHaveLength(1);
    const hadorId = findCharInstanceId(state, RESOURCE_PLAYER, HADOR);
    expect(actions[0].targetCharacterId).toBe(hadorId);
  });

  test('NOT offered when no sorcery-using character is in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        // Aragorn (hero dunadan) has no sorcery skill.
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [SOME_SECRET_ART_OF_FLAME], siteDeck: [MINAS_TIRITH] },
        opponent(),
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  // ── Applying the boost ──────────────────────────────────────────────

  test('non-Ringwraith: +4 prowess applied, card discarded, -4 corruption check enqueued', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [minionDefender(HADOR, [SOME_SECRET_ART_OF_FLAME]), opponent()],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const declared = dispatch(state, action);

    // Card discarded from hand.
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, SOME_SECRET_ART_OF_FLAME);

    // -4 corruption check enqueued for the non-Ringwraith sorcery-user.
    expect(declared.pendingResolutions).toHaveLength(1);
    expect(declared.pendingResolutions[0].kind.type).toBe('corruption-check');
    expect((declared.pendingResolutions[0].kind as { modifier: number }).modifier).toBe(-4);

    // Hador's prowess is boosted by +4 (5 base -> 9), attack-scoped.
    const hadorId = findCharInstanceId(declared, RESOURCE_PLAYER, HADOR);
    expect(declared.players[RESOURCE_PLAYER].characters[hadorId].effectiveStats.prowess).toBe(9);

    const attackConstraints = declared.activeConstraints.filter(c => c.scope.kind === 'attack');
    expect(attackConstraints).toHaveLength(1);
    expect(attackConstraints[0].kind.type).toBe('character-stat-modifier');
    if (attackConstraints[0].kind.type === 'character-stat-modifier') {
      expect(attackConstraints[0].kind.characterId).toBe(hadorId);
      expect(attackConstraints[0].kind.stat).toBe('prowess');
      expect(attackConstraints[0].kind.value).toBe(4);
    }

    // Combat still active — this card only boosts prowess, it does not cancel.
    expect(declared.combat).not.toBeNull();
  });

  test('Ringwraith sorcery-user is exempt: +4 prowess applied, no corruption check', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [minionDefender(DWAR, [SOME_SECRET_ART_OF_FLAME]), opponent()],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const declared = dispatch(state, action);

    expectInDiscardPile(declared, RESOURCE_PLAYER, SOME_SECRET_ART_OF_FLAME);
    // Ringwraith pays no cost — no corruption check enqueued.
    expect(declared.pendingResolutions).toHaveLength(0);

    // Dwar's prowess is still boosted by +4 (9 base -> 13).
    const dwarId = findCharInstanceId(declared, RESOURCE_PLAYER, DWAR);
    expect(declared.players[RESOURCE_PLAYER].characters[dwarId].effectiveStats.prowess).toBe(13);
  });

  // ── Duplication against a given attack ─────────────────────────────

  test('cannot be duplicated against the same attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      // Two copies; use the Ringwraith so playing one enqueues no corruption
      // check that would collapse the action menu.
      players: [minionDefender(DWAR, [SOME_SECRET_ART_OF_FLAME, SOME_SECRET_ART_OF_FLAME]), opponent()],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(2);

    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const after = dispatch(state, action);

    // The remaining copy is blocked against this same attack.
    expect(after.combat).not.toBeNull();
    expect(viableActions(after, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });
});
