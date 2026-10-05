/**
 * @module as-81.test
 *
 * Card test: Driven as by a Madness (as-81)
 * Type: minion-resource-event (short, spirit-magic)
 *
 * Card text: "Magic. Spirit-magic. Playable on a spirit-magic-using character
 * facing an attack. All characters in his company receive +2 prowess and -1
 * body against the attack. Unless he is a Ringwraith, character makes a
 * corruption check modified by -3. Cannot be duplicated against a given
 * attack."
 *
 * Effects:
 *   1. company-combat-boost — stat "prowess", value 2, requiredSkill
 *      "spirit-magic", cost = corruption check -3, costExemptRace
 *      "ringwraith", boostScope "company". One action per spirit-magic-using
 *      character (carrying `targetCharacterId`); that caster alone pays the
 *      cost, every company member gets +2 prowess against the attack.
 *   2. company-combat-boost — stat "body", value -1 (no cost/filter): every
 *      company member gets -1 body against the attack. Because effect 1
 *      carries a `cost`, the card is only offered via a qualifying caster.
 *   3. duplication-limit — scope "attack", max 1.
 *
 * Fixtures: Belegorn (le-2, dunadan, spirit-magic, prowess 3 / body 7 —
 * makes the -3 check), Ûvatha the Ringwraith (le-57, ringwraith,
 * spirit-magic, prowess 9 / body 9 — exempt from the check) and Hador
 * (le-14, dunadan, no spirit-magic, prowess 5 / body 9 — a company member
 * who cannot play the card but still receives the modifiers).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  Phase, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
  viableActions,
  makeCancelWindowCombat,
  dispatch, expectInDiscardPile,
  findCharInstanceId,
} from '../test-helpers.js';
import { Alignment, Race } from '../../index.js';
import type { PlayShortEventAction, CardDefinitionId } from '../../index.js';

const DRIVEN_AS_BY_A_MADNESS = 'as-81' as CardDefinitionId;
const BELEGORN = 'le-2' as CardDefinitionId;  // dunadan, spirit-magic
const UVATHA = 'le-57' as CardDefinitionId;   // ringwraith, spirit-magic
const HADOR = 'le-14' as CardDefinitionId;    // dunadan, no spirit-magic

/** Minion (Ringwraith) defending company. */
function minionDefender(chars: CardDefinitionId[], hand: CardDefinitionId[]) {
  return {
    id: PLAYER_1,
    alignment: Alignment.Ringwraith,
    companies: [{ site: MORIA, characters: chars }],
    hand,
    siteDeck: [MINAS_TIRITH],
  };
}

function opponent() {
  return { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] };
}

function combatState(chars: CardDefinitionId[], hand: CardDefinitionId[]) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [minionDefender(chars, hand), opponent()],
  });
  return makeCancelWindowCombat(base, { creatureRace: Race.Orc });
}

describe('Driven as by a Madness (as-81)', () => {
  beforeEach(() => resetMint());

  // ── Availability ────────────────────────────────────────────────────

  test('offered only via the spirit-magic-using character', () => {
    const state = combatState([BELEGORN, HADOR], [DRIVEN_AS_BY_A_MADNESS]);

    const actions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetCharacterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, BELEGORN));
  });

  test('NOT offered when no spirit-magic-using character is in the company', () => {
    const state = combatState([HADOR], [DRIVEN_AS_BY_A_MADNESS]);

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  // ── Applying the boost ──────────────────────────────────────────────

  test('non-Ringwraith caster: whole company +2 prowess / -1 body, caster makes a -3 corruption check', () => {
    const state = combatState([BELEGORN, HADOR], [DRIVEN_AS_BY_A_MADNESS]);

    const action = viableActions(state, PLAYER_1, 'play-short-event')[0].action;
    const after = dispatch(state, action);

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, DRIVEN_AS_BY_A_MADNESS);

    // Exactly one -3 corruption check, for the caster only.
    const belegornId = findCharInstanceId(after, RESOURCE_PLAYER, BELEGORN);
    const checks = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(checks).toHaveLength(1);
    expect((checks[0].kind as { modifier: number }).modifier).toBe(-3);
    expect((checks[0].kind as { characterId: string }).characterId).toBe(belegornId);

    // Caster and companion both receive +2 prowess and -1 body.
    const hadorId = findCharInstanceId(after, RESOURCE_PLAYER, HADOR);
    const chars = after.players[RESOURCE_PLAYER].characters;
    expect(chars[belegornId].effectiveStats.prowess).toBe(5); // 3 + 2
    expect(chars[belegornId].effectiveStats.body).toBe(6);    // 7 - 1
    expect(chars[hadorId].effectiveStats.prowess).toBe(7);    // 5 + 2
    expect(chars[hadorId].effectiveStats.body).toBe(8);       // 9 - 1

    // Modifiers last only for the attack.
    const attackConstraints = after.activeConstraints.filter(c => c.scope.kind === 'attack');
    expect(attackConstraints).toHaveLength(4);

    // The card does not cancel the attack.
    expect(after.combat).not.toBeNull();
  });

  test('Ringwraith caster is exempt from the corruption check; company still boosted', () => {
    const state = combatState([UVATHA, HADOR], [DRIVEN_AS_BY_A_MADNESS]);

    const actions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(actions).toHaveLength(1);
    const after = dispatch(state, actions[0].action);

    expectInDiscardPile(after, RESOURCE_PLAYER, DRIVEN_AS_BY_A_MADNESS);
    expect(after.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);

    const uvathaId = findCharInstanceId(after, RESOURCE_PLAYER, UVATHA);
    const hadorId = findCharInstanceId(after, RESOURCE_PLAYER, HADOR);
    const chars = after.players[RESOURCE_PLAYER].characters;
    expect(chars[uvathaId].effectiveStats.prowess).toBe(state.players[RESOURCE_PLAYER].characters[uvathaId].effectiveStats.prowess + 2);
    expect(chars[uvathaId].effectiveStats.body).toBe(state.players[RESOURCE_PLAYER].characters[uvathaId].effectiveStats.body - 1);
    expect(chars[hadorId].effectiveStats.prowess).toBe(7);
    expect(chars[hadorId].effectiveStats.body).toBe(8);
  });

  // ── Duplication against a given attack ─────────────────────────────

  test('cannot be duplicated against the same attack', () => {
    // Ringwraith caster so the first play enqueues no corruption check.
    const state = combatState([UVATHA], [DRIVEN_AS_BY_A_MADNESS, DRIVEN_AS_BY_A_MADNESS]);

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(2);

    const after = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);

    expect(after.combat).not.toBeNull();
    expect(viableActions(after, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });
});
