/**
 * @module ba-14.test
 *
 * Card test: Black Vapour (ba-14)
 * Type: hazard-event (short), non-unique
 *
 * Text: "Target any effect (declared earlier in the same chain of effects) that
 *   would cancel a Spider attack. Make a roll and add the attack's prowess. If
 *   the result is greater than 14, the effect is canceled and the attack
 *   receives +1 prowess. Alternatively, +1 prowess to a Spider attack. This
 *   card may be revealed as an on-guard card for either effect."
 *
 * Effects:
 * | # | Effect Type                | Status | Notes                                             |
 * |---|----------------------------|--------|---------------------------------------------------|
 * | 1 | counter-cancel-attack-roll | OK     | Mode A: counter a Spider-attack cancel; roll +    |
 * |   |                            |        | attack prowess > 14 → negate cancel, +1 prowess   |
 * | 2 | modify-attack (fromHand,   | OK     | Mode B: +1 prowess to a Spider attack; attacker-  |
 * |   |  attacker, enemy.race)     |        | side, also revealable from on-guard               |
 *
 * "May be revealed as an on-guard card for either effect": the attacker's
 * unrevealed on-guard cards are candidate sources for both the modify-attack
 * (Mode B) and the counter-cancel-roll (Mode A) plays.
 *
 * Player-index convention: PLAYER_1 (RESOURCE) is the moving/defending player,
 * PLAYER_2 (HAZARD) is the attacking player who plays Black Vapour.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  MINAS_TIRITH, LORIEN, RIVENDELL,
  buildTestState, resetMint,
  makeCancelWindowCombat,
  dispatch, resolveChain, placeOnGuard,
  handCardId, charIdAt, viableActions,
} from '../test-helpers.js';
import { Phase, reduce } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const BLACK_VAPOUR = 'ba-14' as CardDefinitionId;
const GIANT_SPIDERS = 'tw-40' as CardDefinitionId; // Spider creature (prowess 10)
const ESCAPE = 'tw-229' as CardDefinitionId; // hero cancel-attack (unconditional)

/** Base two-player state; PLAYER_2 holds Black Vapour unless overridden. */
function baseState(opts?: { defenderHand?: CardDefinitionId[]; attackerHand?: CardDefinitionId[] }) {
  return buildTestState({
    phase: Phase.MovementHazard,
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: opts?.defenderHand ?? [], siteDeck: [RIVENDELL] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: opts?.attackerHand ?? [BLACK_VAPOUR], siteDeck: [RIVENDELL] },
    ],
  });
}

describe('Black Vapour (ba-14)', () => {
  beforeEach(() => resetMint());

  // ── Mode B: +1 prowess to a Spider attack (from hand) ─────────────────────

  test('Mode B: attacker offered modify-attack vs a Spider attack', () => {
    const state = makeCancelWindowCombat(baseState(), { creatureDefId: GIANT_SPIDERS, creatureRace: 'spider', strikeProwess: 8 });
    const bv = handCardId(state, HAZARD_PLAYER);
    const actions = viableActions(state, PLAYER_2, 'modify-attack').filter(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === bv,
    );
    expect(actions).toHaveLength(1);
  });

  test('Mode B: NOT offered vs a non-Spider (Orc) attack', () => {
    const state = makeCancelWindowCombat(baseState(), { creatureRace: 'orc', strikeProwess: 8 });
    const bv = handCardId(state, HAZARD_PLAYER);
    const actions = viableActions(state, PLAYER_2, 'modify-attack').filter(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === bv,
    );
    expect(actions).toHaveLength(0);
  });

  test('Mode B: playing it adds +1 strike prowess and discards the card', () => {
    const state = makeCancelWindowCombat(baseState(), { creatureDefId: GIANT_SPIDERS, creatureRace: 'spider', strikeProwess: 8 });
    const action = viableActions(state, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(state, action);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(9);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === BLACK_VAPOUR)).toBe(true);
  });

  // ── Mode B on-guard reveal ────────────────────────────────────────────────

  test('Mode B: revealable from on-guard to boost a Spider attack', () => {
    const withOG = placeOnGuard(baseState({ attackerHand: [] }), RESOURCE_PLAYER, 0, BLACK_VAPOUR);
    const state = makeCancelWindowCombat(withOG.state, { creatureDefId: GIANT_SPIDERS, creatureRace: 'spider', strikeProwess: 8 });
    const ogId = withOG.ogCard.instanceId;

    const actions = viableActions(state, PLAYER_2, 'modify-attack').filter(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === ogId,
    );
    expect(actions).toHaveLength(1);

    const after = dispatch(state, actions[0].action);
    expect(after.combat!.strikeProwess).toBe(9);
    // On-guard slot cleared; card lands in the attacker's discard pile.
    expect(after.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === BLACK_VAPOUR)).toBe(true);
  });

  // ── Mode A: counter-cancel with roll ──────────────────────────────────────

  /** Defender plays Escape to cancel the Spider attack, opening the chain. */
  function defenderCancelsSpider(strikeProwess = 8) {
    const state = makeCancelWindowCombat(
      baseState({ defenderHand: [ESCAPE] }),
      { creatureDefId: GIANT_SPIDERS, creatureRace: 'spider', strikeProwess },
    );
    const escapeCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterCancel = dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: escapeCard, targetCharacterId: aragornId,
    });
    return { state: afterCancel, escapeCard };
  }

  test('Mode A: attacker offered counter-cancel-roll targeting the cancel entry', () => {
    const { state, escapeCard } = defenderCancelsSpider();
    // The chain is active; PLAYER_2 (attacker) now has priority.
    expect(state.chain).not.toBeNull();
    const bv = handCardId(state, HAZARD_PLAYER);
    const actions = viableActions(state, PLAYER_2, 'counter-cancel-roll');
    expect(actions).toHaveLength(1);
    const act = actions[0].action as { cardInstanceId: unknown; targetInstanceId: unknown };
    expect(act.cardInstanceId).toBe(bv);
    expect(act.targetInstanceId).toBe(escapeCard);
  });

  test('Mode A: NOT offered when the attack is not a Spider (Orc)', () => {
    const state = makeCancelWindowCombat(
      baseState({ defenderHand: [ESCAPE] }),
      { creatureRace: 'orc', strikeProwess: 8 },
    );
    const escapeCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterCancel = dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: escapeCard, targetCharacterId: aragornId,
    });
    expect(viableActions(afterCancel, PLAYER_2, 'counter-cancel-roll')).toHaveLength(0);
  });

  test('Mode A: playing it enqueues a dice-check for the attacker', () => {
    const { state } = defenderCancelsSpider();
    const action = viableActions(state, PLAYER_2, 'counter-cancel-roll')[0].action;
    const afterPlay = dispatch(state, action);
    // Black Vapour discarded; roll not yet made.
    expect(afterPlay.players[HAZARD_PLAYER].hand).toHaveLength(0);
    const resolved = resolveChain(afterPlay);
    const pending = resolved.pendingResolutions.find(r => r.kind.type === 'dice-check');
    expect(pending).toBeDefined();
    // The attacker (PLAYER_2) is the roller.
    expect(viableActions(resolved, PLAYER_2, 'resolve-dice-check')).toHaveLength(1);
  });

  test('Mode A success: roll + prowess > 14 negates the cancel and +1 prowess', () => {
    // Attack prowess 8; roll 7 → 7 + 8 = 15 > 14 → success.
    const { state } = defenderCancelsSpider(8);
    const action = viableActions(state, PLAYER_2, 'counter-cancel-roll')[0].action;
    const resolved = resolveChain(dispatch(state, action));
    const rollAction = viableActions(resolved, PLAYER_2, 'resolve-dice-check')[0].action;

    const result = reduce({ ...resolved, cheatRollTotal: 7 }, rollAction);
    expect(result.error).toBeUndefined();
    // Attack survives (cancel negated) with +1 prowess; chain complete.
    expect(result.state.combat).not.toBeNull();
    expect(result.state.combat!.strikeProwess).toBe(9);
    expect(result.state.chain).toBeNull();
    // The defending character was NOT wounded (Escape never resolved).
    const aragornId = charIdAt(result.state, RESOURCE_PLAYER);
    expect(result.state.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe('inverted');
  });

  test('Mode A failure: roll + prowess = 14 (not greater) lets the cancel resolve', () => {
    // Attack prowess 8; roll 6 → 6 + 8 = 14, NOT > 14 → failure.
    const { state } = defenderCancelsSpider(8);
    const action = viableActions(state, PLAYER_2, 'counter-cancel-roll')[0].action;
    const resolved = resolveChain(dispatch(state, action));
    const rollAction = viableActions(resolved, PLAYER_2, 'resolve-dice-check')[0].action;

    const result = reduce({ ...resolved, cheatRollTotal: 6 }, rollAction);
    expect(result.error).toBeUndefined();
    // Cancel resolved → attack cancelled (combat cleared).
    expect(result.state.combat).toBeNull();
  });

  test('Mode A: revealable from on-guard to counter a Spider-attack cancel', () => {
    // Defender holds Escape (the cancel); Black Vapour sits on-guard on the
    // defending company (owned by the hazard/attacking player).
    const withOG = placeOnGuard(baseState({ defenderHand: [ESCAPE], attackerHand: [] }), RESOURCE_PLAYER, 0, BLACK_VAPOUR);
    const state = makeCancelWindowCombat(withOG.state, { creatureDefId: GIANT_SPIDERS, creatureRace: 'spider', strikeProwess: 8 });

    const escapeCard = handCardId(state, RESOURCE_PLAYER);
    const aragornId = charIdAt(state, RESOURCE_PLAYER);
    const afterCancel = dispatch(state, {
      type: 'cancel-attack', player: PLAYER_1, cardInstanceId: escapeCard, targetCharacterId: aragornId,
    });

    const ogId = withOG.ogCard.instanceId;
    const actions = viableActions(afterCancel, PLAYER_2, 'counter-cancel-roll').filter(
      ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId === ogId,
    );
    expect(actions).toHaveLength(1);

    // Play from on-guard, roll to success.
    const resolved = resolveChain(dispatch(afterCancel, actions[0].action));
    const rollAction = viableActions(resolved, PLAYER_2, 'resolve-dice-check')[0].action;
    const result = reduce({ ...resolved, cheatRollTotal: 7 }, rollAction);
    expect(result.error).toBeUndefined();
    expect(result.state.combat).not.toBeNull();
    expect(result.state.combat!.strikeProwess).toBe(9);
    // On-guard slot cleared.
    expect(result.state.players[RESOURCE_PLAYER].companies[0].onGuardCards).toHaveLength(0);
  });
});
