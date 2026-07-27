/**
 * @module as-102.test
 *
 * Card test: The Tormented Earth (as-102)
 * Type: minion-resource-event (short, sorcery)
 *
 * Card text: "Magic. Sorcery. Playable on a sorcery-using character facing a
 * non-automatic-attack. Cancels the attack or gives the attack -3 prowess,
 * your choice. Unless he is a Ringwraith, character makes a corruption check
 * modified by -4. Cannot be duplicated against a given attack."
 *
 * Effects:
 *   1. cancel-attack — requiredSkill "sorcery"; cost = corruption check -4;
 *      costExemptRace "ringwraith" (Ringwraith pays nothing); prowessPenalty 3
 *      (offers the "-3 prowess" alternative mode); when = attack source is not
 *      an automatic-attack.
 *   2. duplication-limit — scope "attack", max 1.
 *
 * The dual-mode cancel/reduce-prowess emitter offers two actions per eligible
 * sorcery-using character: an outright cancellation (routes through the chain)
 * and a reduce-prowess variant (`mode: "reduce-prowess"`, applied immediately
 * like halve-strikes / modify-attack). Both pay the same cost and record the
 * attack-scoped duplication marker.
 *
 * Fixtures: Hador (le-14, dunadan, sorcery skill — makes the -4 check) and
 * Dwar the Ringwraith (le-52, ringwraith, sorcery skill — exempt from the
 * check).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  LEGOLAS, ARAGORN,
  MORIA, MINAS_TIRITH, LORIEN,
  viableActions,
  makeCancelWindowCombat,
  dispatch, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Alignment, Race } from '../../index.js';
import type { CancelAttackAction, CardDefinitionId } from '../../index.js';

const TORMENTED_EARTH = 'as-102' as CardDefinitionId;
const HADOR = 'le-14' as CardDefinitionId;        // dunadan, has sorcery skill (non-Ringwraith)
const DWAR = 'le-52' as CardDefinitionId;          // ringwraith, has sorcery skill

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

describe('The Tormented Earth (as-102)', () => {
  beforeEach(() => resetMint());

  // ── Availability ────────────────────────────────────────────────────

  test('offers both cancel and reduce-prowess modes for a sorcery-using character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        minionDefender(HADOR, [TORMENTED_EARTH]),
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    // One sorcery character → exactly two modes.
    expect(actions).toHaveLength(2);
    const modes = actions.map(ea => (ea.action as CancelAttackAction).mode ?? 'cancel').sort();
    expect(modes).toEqual(['cancel', 'reduce-prowess']);
    // Both carry the cost-paying character.
    for (const ea of actions) {
      expect((ea.action as CancelAttackAction).scoutInstanceId).toBeDefined();
    }
  });

  test('NOT available when no sorcery-using character is in the company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        // Aragorn (hero dunadan) has no sorcery skill.
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [TORMENTED_EARTH], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('NOT available against an automatic-attack (non-automatic-attack gate)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        minionDefender(HADOR, [TORMENTED_EARTH]),
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, attackSourceType: 'automatic-attack' });

    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  test('available against an on-guard creature (still a non-automatic-attack)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        minionDefender(HADOR, [TORMENTED_EARTH]),
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, attackSourceType: 'on-guard-creature' });

    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(2);
  });

  // ── Cancel mode ─────────────────────────────────────────────────────

  test('cancel mode discards the card, enqueues a -4 corruption check, and cancels combat', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        minionDefender(HADOR, [TORMENTED_EARTH]),
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const cancelAction = viableActions(state, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction)
      .find(a => (a.mode ?? 'cancel') === 'cancel');
    expect(cancelAction).toBeDefined();

    const declared = dispatch(state, cancelAction!);
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, TORMENTED_EARTH);
    // Non-Ringwraith sorcery-user makes the -4 corruption check.
    expect(declared.pendingResolutions).toHaveLength(1);
    expect(declared.pendingResolutions[0].kind.type).toBe('corruption-check');
    expect((declared.pendingResolutions[0].kind as { modifier: number }).modifier).toBe(-4);
    // Combat still active until the chain resolves.
    expect(declared.combat).not.toBeNull();

    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
  });

  // ── Reduce-prowess mode ─────────────────────────────────────────────

  test('reduce-prowess mode lowers attack prowess by 3 immediately and keeps combat active', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        minionDefender(HADOR, [TORMENTED_EARTH]),
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, strikeProwess: 9 });

    const reduceAction = viableActions(state, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction)
      .find(a => a.mode === 'reduce-prowess');
    expect(reduceAction).toBeDefined();

    const declared = dispatch(state, reduceAction!);
    // Card discarded; -4 corruption check enqueued (non-Ringwraith).
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, TORMENTED_EARTH);
    expect(declared.pendingResolutions).toHaveLength(1);
    expect((declared.pendingResolutions[0].kind as { modifier: number }).modifier).toBe(-4);
    // Attack prowess reduced by 3; combat NOT cancelled; no chain.
    expect(declared.combat).not.toBeNull();
    expect(declared.combat!.strikeProwess).toBe(6);
    expect(declared.chain).toBeNull();
  });

  // ── Ringwraith cost exemption ───────────────────────────────────────

  test('Ringwraith sorcery-user is exempt: no corruption check on cancel', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        minionDefender(DWAR, [TORMENTED_EARTH]),
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    const cancelAction = viableActions(state, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction)
      .find(a => (a.mode ?? 'cancel') === 'cancel');
    expect(cancelAction).toBeDefined();

    const declared = dispatch(state, cancelAction!);
    expectInDiscardPile(declared, RESOURCE_PLAYER, TORMENTED_EARTH);
    // Ringwraith pays no cost — no corruption check enqueued.
    expect(declared.pendingResolutions).toHaveLength(0);

    const after = resolveChain(declared);
    expect(after.combat).toBeNull();
  });

  test('Ringwraith sorcery-user is exempt: no corruption check on reduce-prowess', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        minionDefender(DWAR, [TORMENTED_EARTH]),
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc, strikeProwess: 8 });

    const reduceAction = viableActions(state, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction)
      .find(a => a.mode === 'reduce-prowess');
    const declared = dispatch(state, reduceAction!);

    expect(declared.pendingResolutions).toHaveLength(0);
    expect(declared.combat!.strikeProwess).toBe(5);
  });

  // ── Duplication against a given attack ──────────────────────────────

  test('cannot be duplicated against the same attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        // Two copies in hand (non-unique). Use the Ringwraith so playing one
        // enqueues no corruption check that would collapse the action menu.
        minionDefender(DWAR, [TORMENTED_EARTH, TORMENTED_EARTH]),
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = makeCancelWindowCombat(base, { creatureRace: Race.Orc });

    // Two copies × two modes = four actions before any is played.
    expect(viableActions(state, PLAYER_1, 'cancel-attack')).toHaveLength(4);

    // Play one copy in reduce-prowess mode (immediate, combat stays active).
    const reduceAction = viableActions(state, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction)
      .find(a => a.mode === 'reduce-prowess');
    const after = dispatch(state, reduceAction!);

    // The remaining copy is blocked against this same attack.
    expect(after.combat).not.toBeNull();
    expect(viableActions(after, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });
});
