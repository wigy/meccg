/**
 * @module td-153.test
 *
 * Card test: Staff Asunder (td-153)
 * Type: hero-resource-event (short)
 *
 * Card text: "Playable on a Wizard bearing Wizard's Staff whose company is
 * facing an attack. Wizard makes a corruption check. Place Wizard's Staff
 * in your marshalling point pile. Wizard gains +5 prowess against the
 * attack. Modify the attack's body by -2."
 *
 * Effects:
 *   1. company-combat-boost — stat "prowess", value 5, requiredRace
 *      "wizard", requiredItemFilter matching Wizard's Staff by name,
 *      consumeMatchedItem true, bodyModifier -2, cost = plain corruption
 *      check (no modifier). Cost-bearing mode: one action per Wizard-race
 *      character bearing Wizard's Staff in the defending company, carrying
 *      `targetCharacterId`; only that one character is boosted, and only
 *      the matched Wizard's Staff instance is removed and stored.
 *
 * Fixtures: Gandalf (tw-156, wizard) bearing Wizard's Staff (td-170), and
 * Aragorn (dunadan, no wizard race, no item) — confirms the play is gated to
 * a Wizard actually bearing the Staff, not merely any Wizard or any bearer.
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

const STAFF_ASUNDER = 'td-153' as CardDefinitionId;
const WIZARDS_STAFF = 'td-170' as CardDefinitionId;

function opponent() {
  return { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] };
}

describe('Staff Asunder (td-153)', () => {
  beforeEach(() => resetMint());

  // ── Availability ────────────────────────────────────────────────────

  test('offered as a single-target play-short-event on the Wizard bearing Wizard’s Staff', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: GANDALF, items: [WIZARDS_STAFF] }, ARAGORN] }], hand: [STAFF_ASUNDER], siteDeck: [MINAS_TIRITH] },
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

  test('NOT offered when the Wizard does not bear Wizard’s Staff', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [STAFF_ASUNDER], siteDeck: [MINAS_TIRITH] },
        opponent(),
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT offered for a non-Wizard bearing Wizard’s Staff', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [WIZARDS_STAFF] }] }], hand: [STAFF_ASUNDER], siteDeck: [MINAS_TIRITH] },
        opponent(),
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  // ── Applying the effect ─────────────────────────────────────────────

  test('+5 prowess to the Wizard, Staff placed in marshalling point pile, attack body -2, corruption check enqueued', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: GANDALF, items: [WIZARDS_STAFF] }, ARAGORN] }], hand: [STAFF_ASUNDER], siteDeck: [MINAS_TIRITH] },
        opponent(),
      ],
    });
    let state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });
    state = { ...state, combat: { ...state.combat!, creatureBody: 5 } };

    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const declared = dispatch(state, action);

    // Card discarded from hand.
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, STAFF_ASUNDER);

    // Plain (unmodified) corruption check enqueued for the Wizard.
    expect(declared.pendingResolutions).toHaveLength(1);
    expect(declared.pendingResolutions[0].kind.type).toBe('corruption-check');
    expect((declared.pendingResolutions[0].kind as { modifier: number }).modifier).toBe(0);

    // Gandalf's prowess is boosted by +5, attack-scoped.
    const gandalfId = findCharInstanceId(declared, RESOURCE_PLAYER, GANDALF);
    const attackConstraints = declared.activeConstraints.filter(c => c.scope.kind === 'attack');
    expect(attackConstraints).toHaveLength(1);
    expect(attackConstraints[0].kind.type).toBe('character-stat-modifier');
    if (attackConstraints[0].kind.type === 'character-stat-modifier') {
      expect(attackConstraints[0].kind.characterId).toBe(gandalfId);
      expect(attackConstraints[0].kind.stat).toBe('prowess');
      expect(attackConstraints[0].kind.value).toBe(5);
    }

    // Wizard's Staff removed from Gandalf and placed in the marshalling
    // point pile (killPile).
    expect(declared.players[RESOURCE_PLAYER].characters[gandalfId].items).toHaveLength(0);
    expect(declared.players[RESOURCE_PLAYER].killPile.some(c => c.definitionId === WIZARDS_STAFF)).toBe(true);

    // Attack's body modified by -2.
    expect(declared.combat!.creatureBody).toBe(3);

    // Combat still active — this card only boosts prowess/body, it does not cancel.
    expect(declared.combat).not.toBeNull();
  });
});
