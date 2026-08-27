/**
 * @module tw-101.test
 *
 * Card test: The Will of the Ring (tw-101)
 * Type: hazard-event (short, character-targeting)
 * Effects: 1 (play-target character filter:bearer-of-the-one-ring cost:corruption-check -4)
 *
 * "The bearer of The One Ring makes a corruption check modified by -4."
 *
 * Engine support:
 * | # | Feature                                  | Status      | Notes                                      |
 * |---|-------------------------------------------|-------------|---------------------------------------------|
 * | 1 | Target filter: bearer of The One Ring      | IMPLEMENTED | target.itemKeywords includes the-one-ring   |
 * | 2 | Corruption check modifier -4 on resolve    | IMPLEMENTED | play-target cost:check enqueue in chain     |
 * | 3 | NOT a corruption card (CoE 7.2)            | IMPLEMENTED | no `corruption` keyword → 7.2.1 not applied |
 *
 * Note on rule 7.2: The Will of the Ring carries no printed Corruption keyword — it only
 * *forces* a corruption check, which CoE 7.2 explicitly excludes from the definition of
 * a corruption card. It therefore does not consume, and is not blocked by, the
 * one-corruption-card-per-character-per-turn limit of CoE 7.2.1.
 *
 * Playable: YES
 * Certified: 2026-08-27
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  makeMHState,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GLAMDRING,
  viableActions, charIdAt, resolveChain,
  RESOURCE_PLAYER,
  companyIdAt,
} from '../test-helpers.js';
import type { PlayHazardAction, CorruptionCheckAction, CardDefinitionId } from '../../index.js';
import { THE_ONE_RING } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const THE_WILL_OF_THE_RING = 'tw-101' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('The Will of the Ring (tw-101)', () => {
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
          hand: [THE_WILL_OF_THE_RING],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...state, phaseState: makeMHState() };
    const playActions = computeLegalActions(mhGameState, PLAYER_2)
      .filter(ea => ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === mhGameState.players[1].hand[0].instanceId);

    for (const a of playActions) {
      expect(a.viable).toBe(false);
    }
  });

  test('not playable on a character bearing an unrelated item', () => {
    const base = buildTestState({
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
          hand: [THE_WILL_OF_THE_RING],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...base, phaseState: makeMHState() };
    const wCard = mhGameState.players[1].hand[0];
    const playActions = computeLegalActions(mhGameState, PLAYER_2)
      .filter(ea => ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === wCard.instanceId);

    for (const a of playActions) {
      expect(a.viable).toBe(false);
    }
  });

  test('playable only targeting the bearer of The One Ring', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              { defId: ARAGORN, items: [THE_ONE_RING] },
              { defId: LEGOLAS, items: [GLAMDRING] },
            ],
          }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THE_WILL_OF_THE_RING],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...base, phaseState: makeMHState() };
    const wCard = mhGameState.players[1].hand[0];
    const viablePlays = computeLegalActions(mhGameState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === wCard.instanceId);

    expect(viablePlays.length).toBe(1);
    const target = (viablePlays[0].action as PlayHazardAction).targetCharacterId;
    const aragornId = charIdAt(mhGameState, RESOURCE_PLAYER, 0);
    expect(target).toBe(aragornId);
  });

  test('resolving The Will of the Ring enqueues corruption check with -4 modifier on the Ring bearer', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [THE_ONE_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THE_WILL_OF_THE_RING],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...base, phaseState: makeMHState() };
    const wCard = mhGameState.players[1].hand[0];
    const companyId = companyIdAt(mhGameState, RESOURCE_PLAYER);
    const aragornId = charIdAt(mhGameState, RESOURCE_PLAYER);

    const viablePlays = computeLegalActions(mhGameState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === wCard.instanceId);
    expect(viablePlays.length).toBe(1);

    const playResult = reduce(mhGameState, viablePlays[0].action);
    expect(playResult.error).toBeUndefined();

    const afterChain = resolveChain(playResult.state);
    expect(afterChain.chain).toBeNull();

    expect(afterChain.players[1].discardPile.some(c => c.definitionId === THE_WILL_OF_THE_RING)).toBe(true);

    const pending = afterChain.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type !== 'corruption-check') return;

    expect(pending[0].kind.characterId).toBe(aragornId);
    expect(pending[0].kind.reason).toBe('The Will of the Ring');

    const viable = computeLegalActions(afterChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(viable).toHaveLength(1);

    const cc = viable[0].action as CorruptionCheckAction;
    expect(cc.corruptionModifier).toBe(-4);
    expect(cc.characterId).toBe(aragornId);
    void companyId;
  });

  test('still playable on a Ring-bearer that already received a corruption card this turn', () => {
    // CoE 7.2: a "corruption card" is a card carrying the *corruption keyword*.
    // The Will of the Ring has no printed Corruption keyword; it merely forces a
    // check, so CoE 7.2.1's one-corruption-card-per-character-per-turn limit
    // must not gate it.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [THE_ONE_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THE_WILL_OF_THE_RING],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const aragornId = charIdAt(base, RESOURCE_PLAYER);
    const mhGameState = {
      ...base,
      phaseState: makeMHState({
        corruptionCardsPlayedPerChar: { [aragornId as string]: true as const },
      }),
    };
    const wCard = mhGameState.players[1].hand[0];

    const viablePlays = computeLegalActions(mhGameState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === wCard.instanceId);

    expect(viablePlays.length).toBe(1);
    expect((viablePlays[0].action as PlayHazardAction).targetCharacterId).toBe(aragornId);
  });

  test('companyId used in play-hazard matches the Ring bearer\'s company', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [THE_ONE_RING] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [THE_WILL_OF_THE_RING],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...base, phaseState: makeMHState() };
    const wCard = mhGameState.players[1].hand[0];
    const companyId = companyIdAt(mhGameState, RESOURCE_PLAYER);

    const playActions = viableActions(mhGameState, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as PlayHazardAction).cardInstanceId === wCard.instanceId);

    expect(playActions.length).toBe(1);
    expect((playActions[0].action as PlayHazardAction).targetCompanyId).toBe(companyId);
  });
});
