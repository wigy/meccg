/**
 * @module tw-360.test
 *
 * Card test: Wizard's Fire (tw-360)
 * Type: hero-resource-event (short, spell)
 *
 * Card text: "Spell. Wizard only. +5 prowess for the Wizard against one
 * attack. Wizard makes a corruption check modified by -4."
 *
 * Effects:
 *   1. company-combat-boost — stat "prowess", value 5, requiredRace
 *      "wizard", cost = corruption check -4. Cost-bearing mode: one action
 *      per Wizard-race character in the defending company, carrying
 *      `targetCharacterId`; only that one character is boosted (not every
 *      character in the company).
 *
 * Fixtures: Gandalf (tw-156, wizard) and Aragorn (dunadan, no wizard race —
 * confirms the boost/action is gated to the Wizard specifically).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  Phase, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, GANDALF,
  MORIA, LORIEN, MINAS_TIRITH,
  viableActions,
  makeCancelWindowCombat,
  dispatch, expectInDiscardPile,
  findCharInstanceId,
} from '../test-helpers.js';
import { Race } from '../../index.js';
import type { PlayShortEventAction, CardDefinitionId } from '../../index.js';

const WIZARDS_FIRE = 'tw-360' as CardDefinitionId;

function opponent() {
  return { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] };
}

describe('Wizard’s Fire (tw-360)', () => {
  beforeEach(() => resetMint());

  // ── Availability ────────────────────────────────────────────────────

  test('offered as a single-target play-short-event on the Wizard character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [WIZARDS_FIRE], siteDeck: [MINAS_TIRITH] },
        opponent(),
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions).toHaveLength(1);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    expect(actions[0].targetCharacterId).toBe(gandalfId);
  });

  test('NOT offered when no Wizard is in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [WIZARDS_FIRE], siteDeck: [MINAS_TIRITH] },
        opponent(),
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  // ── Applying the boost ──────────────────────────────────────────────

  test('+5 prowess applied to the Wizard, card discarded, -4 corruption check enqueued', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [WIZARDS_FIRE], siteDeck: [MINAS_TIRITH] },
        opponent(),
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const declared = dispatch(state, action);

    // Card discarded from hand.
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, WIZARDS_FIRE);

    // -4 corruption check enqueued for the Wizard.
    expect(declared.pendingResolutions).toHaveLength(1);
    expect(declared.pendingResolutions[0].kind.type).toBe('corruption-check');
    expect((declared.pendingResolutions[0].kind as { modifier: number }).modifier).toBe(-4);

    // Gandalf's prowess is boosted by +5 (6 base -> 11), attack-scoped.
    const gandalfId = findCharInstanceId(declared, RESOURCE_PLAYER, GANDALF);
    expect(declared.players[RESOURCE_PLAYER].characters[gandalfId].effectiveStats.prowess).toBe(11);

    const attackConstraints = declared.activeConstraints.filter(c => c.scope.kind === 'attack');
    expect(attackConstraints).toHaveLength(1);
    expect(attackConstraints[0].kind.type).toBe('character-stat-modifier');
    if (attackConstraints[0].kind.type === 'character-stat-modifier') {
      expect(attackConstraints[0].kind.characterId).toBe(gandalfId);
      expect(attackConstraints[0].kind.stat).toBe('prowess');
      expect(attackConstraints[0].kind.value).toBe(5);
    }

    // Combat still active — this card only boosts prowess, it does not cancel.
    expect(declared.combat).not.toBeNull();
  });
});
