/**
 * @module tw-99.test
 *
 * Card test: The Ring's Betrayal (tw-99)
 * Type: hazard-event (short, character-targeting)
 * Effects: 1
 *
 * Card shape:
 *   play-target: character bearing a Ring (filter: target.itemKeywords includes "ring")
 *   cost: corruption check modified by -2
 *   failureMode: discard-ring-only — on failure, the Ring is discarded, character stays
 *
 * Rules verified:
 * 1. Not playable on a character bearing no items
 * 2. Not playable on a character bearing non-ring items only
 * 3. Playable on a character bearing a gold ring
 * 4. After resolution, enqueues corruption check with -2 modifier
 * 5. On passed check: character and ring both remain in play
 * 6. On failed check: Ring is discarded, character stays in play
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  makeMHState,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GLAMDRING, PRECIOUS_GOLD_RING,
  resolveChain, charIdAt,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { PlayHazardAction, CorruptionCheckAction, CardDefinitionId } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const THE_RINGS_BETRAYAL = 'tw-99' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("The Ring's Betrayal (tw-99)", () => {
  beforeEach(() => resetMint());

  test('not playable on a character bearing no items', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THE_RINGS_BETRAYAL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const trbCard = mhState.players[1].hand[0];
    const playActions = computeLegalActions(mhState, PLAYER_2)
      .filter(ea => ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === trbCard.instanceId);

    for (const a of playActions) {
      expect(a.viable).toBe(false);
    }
  });

  test('not playable on a character bearing only non-ring items', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GLAMDRING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THE_RINGS_BETRAYAL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const trbCard = mhState.players[1].hand[0];
    const playActions = computeLegalActions(mhState, PLAYER_2)
      .filter(ea => ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === trbCard.instanceId);

    for (const a of playActions) {
      expect(a.viable).toBe(false);
    }
  });

  test('playable on a character bearing a gold ring', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THE_RINGS_BETRAYAL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const trbCard = mhState.players[1].hand[0];
    const viablePlays = computeLegalActions(mhState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === trbCard.instanceId);

    expect(viablePlays.length).toBe(1);
    const target = (viablePlays[0].action as PlayHazardAction).targetCharacterId;
    expect(target).toBe(charIdAt(mhState, RESOURCE_PLAYER));
  });

  test('resolving enqueues corruption check with -2 modifier on ring bearer', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THE_RINGS_BETRAYAL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const trbCard = mhState.players[1].hand[0];
    const aragornId = charIdAt(mhState, RESOURCE_PLAYER);

    const viablePlays = computeLegalActions(mhState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === trbCard.instanceId);
    expect(viablePlays.length).toBe(1);

    const playResult = reduce(mhState, viablePlays[0].action);
    expect(playResult.error).toBeUndefined();

    const afterChain = resolveChain(playResult.state);
    expect(afterChain.chain).toBeNull();

    // Card should be in hazard player's discard pile
    expect(afterChain.players[1].discardPile.some(c => c.definitionId === THE_RINGS_BETRAYAL)).toBe(true);

    // A corruption-check pending resolution should be queued for the resource player
    const pending = afterChain.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type !== 'corruption-check') return;

    expect(pending[0].kind.characterId).toBe(aragornId);
    expect(pending[0].kind.modifier).toBe(-2);

    // Legal actions collapse to the corruption-check resolution
    const ccActions = computeLegalActions(afterChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction);
    expect(ccActions).toHaveLength(1);
    expect(ccActions[0].corruptionModifier).toBe(-2);
    expect(ccActions[0].characterId).toBe(aragornId);
  });

  test('on passed check: ring and character both stay in play', () => {
    // Aragorn CP=0, Precious Gold Ring CP=1, modifier=-2
    // need = 1 + 1 - (-2) = 4. Roll >=4 passes.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THE_RINGS_BETRAYAL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const trbCard = mhState.players[1].hand[0];
    const aragornId = charIdAt(mhState, RESOURCE_PLAYER);

    const viablePlays = computeLegalActions(mhState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === trbCard.instanceId);
    const afterPlay = resolveChain(reduce(mhState, viablePlays[0].action).state);

    const ccActions = computeLegalActions(afterPlay, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction);
    expect(ccActions).toHaveLength(1);

    // Roll 4: total = 4 + (-2) = 2 > CP=1 → pass
    const cheated = { ...afterPlay, cheatRollTotal: 4 };
    const afterCheck = reduce(cheated, ccActions[0]).state;

    // Aragorn still in play with the ring
    const aragornChar = afterCheck.players[RESOURCE_PLAYER].characters[aragornId as string];
    expect(aragornChar).toBeDefined();
    expect(aragornChar.items.some(i => {
      const def = afterCheck.cardPool[i.definitionId as string];
      return def?.name === 'Precious Gold Ring';
    })).toBe(true);
  });

  test('on failed check: Ring is discarded but character remains in play', () => {
    // Aragorn CP=0, Precious Gold Ring CP=1, modifier=-2
    // Roll 3: total = 3 + (-2) = 1 = CP → fail (not > CP)
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THE_RINGS_BETRAYAL],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhState = { ...state, phaseState: makeMHState() };
    const trbCard = mhState.players[1].hand[0];
    const aragornId = charIdAt(mhState, RESOURCE_PLAYER);

    const viablePlays = computeLegalActions(mhState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === trbCard.instanceId);
    const afterPlay = resolveChain(reduce(mhState, viablePlays[0].action).state);

    const ccActions = computeLegalActions(afterPlay, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction);
    expect(ccActions).toHaveLength(1);

    // Roll 3: total = 3 + (-2) = 1 = CP=1 → fail
    const cheated = { ...afterPlay, cheatRollTotal: 3 };
    const afterCheck = reduce(cheated, ccActions[0]).state;

    // Aragorn still in play (character NOT discarded)
    const aragornChar = afterCheck.players[RESOURCE_PLAYER].characters[aragornId as string];
    expect(aragornChar).toBeDefined();

    // Ring should be in the resource player's discard pile
    expect(afterCheck.players[RESOURCE_PLAYER].discardPile.some(c => {
      const def = afterCheck.cardPool[c.definitionId as string];
      return def?.name === 'Precious Gold Ring';
    })).toBe(true);

    // Ring should no longer be attached to Aragorn
    expect(aragornChar.items.some(i => {
      const def = afterCheck.cardPool[i.definitionId as string];
      return def?.name === 'Precious Gold Ring';
    })).toBe(false);
  });
});
