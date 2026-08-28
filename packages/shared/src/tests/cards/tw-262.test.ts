/**
 * @module tw-262.test
 *
 * Card test: Kindling of the Spirit (tw-262)
 * Type: hero-resource-event (short, spell)
 *
 * Card text: "Spell. Wizard only. +2 prowess against one attack for all
 * characters in the same company as the Wizard. Wizard makes a corruption
 * check modified by -2."
 *
 * Effects:
 *   1. company-combat-boost — stat "prowess", value 2, requiredRace
 *      "wizard", boostScope "company", cost = corruption check -2.
 *      Cost-bearing mode with `boostScope: "company"`: one action per
 *      Wizard-race character in the defending company, carrying
 *      `targetCharacterId` (the payer); the corruption check is charged only
 *      to that character, but every character in the company receives the
 *      +2 prowess boost — unlike Wizard's Fire (tw-360)'s default
 *      `boostScope: "payer"`, where only the paying character is boosted.
 *
 * Fixtures: Gandalf (tw-156, wizard) and Aragorn (dunadan, no wizard race —
 * confirms the action is gated on a Wizard being present, and that Aragorn
 * still receives the boost despite not paying the cost).
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

const KINDLING_OF_THE_SPIRIT = 'tw-262' as CardDefinitionId;

function opponent() {
  return { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] };
}

describe('Kindling of the Spirit (tw-262)', () => {
  beforeEach(() => resetMint());

  // ── Availability ────────────────────────────────────────────────────

  test('offered as a play-short-event targeting the Wizard character (the cost-payer)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [KINDLING_OF_THE_SPIRIT], siteDeck: [MINAS_TIRITH] },
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
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [KINDLING_OF_THE_SPIRIT], siteDeck: [MINAS_TIRITH] },
        opponent(),
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  // ── Applying the boost ──────────────────────────────────────────────

  test('+2 prowess applied to every company character, card discarded, -2 corruption check enqueued for the Wizard only', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [KINDLING_OF_THE_SPIRIT], siteDeck: [MINAS_TIRITH] },
        opponent(),
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const declared = dispatch(state, action);

    // Card discarded from hand.
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, KINDLING_OF_THE_SPIRIT);

    // Exactly one -2 corruption check enqueued — for the Wizard, not Aragorn.
    expect(declared.pendingResolutions).toHaveLength(1);
    expect(declared.pendingResolutions[0].kind.type).toBe('corruption-check');
    expect((declared.pendingResolutions[0].kind as { modifier: number }).modifier).toBe(-2);

    const gandalfId = findCharInstanceId(declared, RESOURCE_PLAYER, GANDALF);
    const aragornId = findCharInstanceId(declared, RESOURCE_PLAYER, ARAGORN);
    expect((declared.pendingResolutions[0].kind as { characterId?: unknown }).characterId).toBe(gandalfId);

    // Both Gandalf and Aragorn get +2 prowess (6 -> 8 each), attack-scoped.
    expect(declared.players[RESOURCE_PLAYER].characters[gandalfId].effectiveStats.prowess).toBe(8);
    expect(declared.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess).toBe(8);

    const attackConstraints = declared.activeConstraints.filter(c => c.scope.kind === 'attack');
    expect(attackConstraints).toHaveLength(2);
    const boostedIds = attackConstraints.map(c => c.kind.type === 'character-stat-modifier' ? c.kind.characterId : undefined);
    expect(boostedIds).toContain(gandalfId);
    expect(boostedIds).toContain(aragornId);
    for (const c of attackConstraints) {
      expect(c.kind.type).toBe('character-stat-modifier');
      if (c.kind.type === 'character-stat-modifier') {
        expect(c.kind.stat).toBe('prowess');
        expect(c.kind.value).toBe(2);
      }
    }

    // Combat still active — this card only boosts prowess, it does not cancel.
    expect(declared.combat).not.toBeNull();
  });
});
