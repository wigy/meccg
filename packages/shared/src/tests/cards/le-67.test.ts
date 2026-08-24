/**
 * @module le-67.test
 *
 * Card test: Corpse-candle (le-67)
 * Type: hazard-creature
 * Race: undead
 * Prowess: 7 | Strikes: 1 | Kill MPs: 1
 * KeyedTo: wilderness, shadow, or dark region; or shadow-hold / dark-hold site
 *          (playable string `{w}{s}{d}{S}{D}`)
 * Effects: 1 (on-event: creature-attack-begins → force-check-all-company)
 *
 * "Undead. One strike. If this attack is not canceled, every character in
 *  the company makes a corruption check before defending characters are selected."
 *
 * This is the Lidless Eye printing of Corpse-candle; mechanically identical to
 * the base-set tw-23. The corruption-before-defense rule is implemented in the
 * reducer (chain-reducer.ts: on-event creature-attack-begins →
 * force-check-all-company enqueues a corruption check per company character).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint, makeWildernessMHState, makeShadowMHState,
  findCharInstanceId,
  playCreatureHazardAndResolve, runCreatureCombat,
  handCardId, companyIdAt, executeAction, dispatch,
  viableActions, viableFor, RESOURCE_PLAYER, HAZARD_PLAYER,
  expectCharNotInPlay,
} from '../test-helpers.js';
import { Phase } from '../../index.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CORPSE_CANDLE = 'le-67' as CardDefinitionId;
const STAR_GLASS = 'tw-330' as CardDefinitionId;

const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };
const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Corpse-candle (le-67)', () => {
  beforeEach(() => resetMint());

  test('combat initiates with 1 strike and 7 prowess', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, WILDERNESS_KEYING);

    expect(afterChain.combat).not.toBeNull();
    expect(afterChain.combat!.strikesTotal).toBe(1);
    expect(afterChain.combat!.strikeProwess).toBe(7);
    expect(afterChain.combat!.attackSource.type).toBe('creature');
  });

  test('attack begins in the cancel-window with no corruption check queued yet', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, WILDERNESS_KEYING);

    // CoE 3.i: cancel/modify-attack actions must be exhausted before anything
    // conditioned on "if this attack is not canceled" resolves — so the attack
    // opens in the cancel-window and no corruption check is queued yet.
    expect(afterChain.combat!.assignmentPhase).toBe('cancel-window');
    expect(afterChain.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  test('single character gets corruption check queued before defender selection once the cancel-window closes', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, WILDERNESS_KEYING);
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // One corruption check queued (for Aragorn) before defender selection
    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(1);

    const aragornId = findCharInstanceId(afterPass, RESOURCE_PLAYER, ARAGORN);
    expect(pending[0].kind.type).toBe('corruption-check');
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.characterId).toBe(aragornId);

    // Resource player only has the corruption-check action (no defender selection yet)
    const viable = viableFor(afterPass, PLAYER_1);
    expect(viable.length).toBeGreaterThan(0);
    expect(viable.every(a => a.action.type === 'corruption-check')).toBe(true);
  });

  test('canceling the attack during the cancel-window never enqueues the corruption check (CoE 3.i)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [STAR_GLASS] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, WILDERNESS_KEYING);

    // Star-glass (tw-330): "Tap bearer of Star-glass to cancel an Undead attack..."
    const cancelActions = viableActions(afterChain, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
    const afterCancel = dispatch(afterChain, cancelActions[0].action);

    expect(afterCancel.combat).toBeNull();
    // The attack was canceled before "if this attack is not canceled" could
    // apply — Corpse-candle's own corruption check must never have fired.
    // (Star-glass still queues its own "bearer makes a corruption check" —
    // that one is unrelated and expected.)
    const corpseCandleChecks = afterCancel.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check' && r.kind.reason === 'Corpse-candle',
    );
    expect(corpseCandleChecks).toHaveLength(0);
  });

  test('all characters in a multi-character company get corruption checks', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, WILDERNESS_KEYING);
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Two corruption checks queued — one per character
    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(2);

    const aragornId = findCharInstanceId(afterPass, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(afterPass, RESOURCE_PLAYER, BILBO);
    const charIds = pending.map(p => (p.kind.type === 'corruption-check' ? p.kind.characterId : null));
    expect(charIds).toContain(aragornId);
    expect(charIds).toContain(bilboId);
  });

  test('corruption checks have no modifier (base check)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, WILDERNESS_KEYING);
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type !== 'corruption-check') return;
    expect(pending[0].kind.modifier).toBe(0);
  });

  test('after corruption check resolves, combat proceeds normally', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, WILDERNESS_KEYING);
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Resolve the corruption check (high roll → pass)
    const afterCheck = executeAction(afterPass, PLAYER_1, 'corruption-check', 12);
    expect(afterCheck.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);

    // Now combat can proceed: assign-strike should be available
    const assignActions = viableActions(afterCheck, PLAYER_1, 'assign-strike');
    expect(assignActions.length).toBeGreaterThan(0);
  });

  test('character failing corruption check before combat is removed from play', () => {
    // Give Aragorn items so he has corruption points (Glamdring 2CP + Dagger 1CP = 3CP)
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, WILDERNESS_KEYING);
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Roll 2 + modifier 0 = 2, not > 3 CP → corruption check fails → character discarded
    const aragornId = findCharInstanceId(afterPass, RESOURCE_PLAYER, ARAGORN);
    const afterCheck = executeAction(afterPass, PLAYER_1, 'corruption-check', 2);

    expect(afterCheck.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
    expectCharNotInPlay(afterCheck, RESOURCE_PLAYER, aragornId);
  });

  test('creature is playable keyed to shadow region', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeShadowMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, SHADOW_KEYING);

    // Attack resolved and combat state set up — keying worked
    expect(afterChain.combat).not.toBeNull();
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });
    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check');
    expect(pending).toHaveLength(1);
  });

  test('hazard player has no actions during pre-combat corruption checks', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, WILDERNESS_KEYING);

    expect(viableFor(afterChain, PLAYER_2)).toHaveLength(0);
  });

  test('multi-character company: all checks resolve then combat proceeds', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, WILDERNESS_KEYING);
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Resolve both corruption checks (both pass with roll 12)
    const afterCheck1 = executeAction(afterPass, PLAYER_1, 'corruption-check', 12);
    expect(afterCheck1.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(1);

    const afterCheck2 = executeAction(afterCheck1, PLAYER_1, 'corruption-check', 12);
    expect(afterCheck2.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);

    // After all checks, combat is still active and defenders can be selected
    expect(afterCheck2.combat).not.toBeNull();
    const assignActions = viableActions(afterCheck2, PLAYER_1, 'assign-strike');
    expect(assignActions.length).toBeGreaterThan(0);
  });

  test('combat finalizes normally after corruption checks — defender wins strike', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CORPSE_CANDLE], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeWildernessMHState() };

    const ccId = handCardId(ready, HAZARD_PLAYER);
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);
    const afterChain = playCreatureHazardAndResolve(ready, PLAYER_2, ccId, companyId, WILDERNESS_KEYING);
    const afterPass = dispatch(afterChain, { type: 'pass', player: PLAYER_1 });

    // Resolve corruption check (pass)
    const afterCheck = executeAction(afterPass, PLAYER_1, 'corruption-check', 12);

    // Aragorn prowess 6 + roll 10 = 16 > 7 → wins; Corpse-candle has no body
    const afterCombat = runCreatureCombat(afterCheck, ARAGORN, 10, null);
    expect(afterCombat.combat).toBeNull();
    // No further corruption checks from combat (only from the creature-attack-begins effect)
    expect(afterCombat.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });
});
