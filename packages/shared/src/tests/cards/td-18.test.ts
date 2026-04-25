/**
 * @module td-18.test
 *
 * Card test: Dragon-sickness (td-18)
 * Type: hazard-event (short, character-targeting)
 * Effects: 1 (play-target character filter:bearing-major-or-greater cost:corruption-check -1)
 *
 * "Playable on a character bearing a major or greater item. Character makes
 *  a corruption check modified by -1."
 *
 * Engine support:
 * | # | Feature                                | Status      | Notes                                     |
 * |---|----------------------------------------|-------------|-------------------------------------------|
 * | 1 | Target filter: major or greater item   | IMPLEMENTED | itemSubtypes context in movement-hazard   |
 * | 2 | Corruption check modifier -1 on resolve| IMPLEMENTED | play-target cost:check enqueue in chain   |
 *
 * Playable: YES
 * Certified: 2026-04-25
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  makeMHState,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GLAMDRING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE,
  viableActions, charIdAt, resolveChain,
  RESOURCE_PLAYER,
  companyIdAt,
} from '../test-helpers.js';
import type { PlayHazardAction, CorruptionCheckAction, CardDefinitionId } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const DRAGON_SICKNESS = 'td-18' as CardDefinitionId;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Dragon-sickness (td-18)', () => {
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
          hand: [DRAGON_SICKNESS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...state, phaseState: makeMHState() };
    const playActions = computeLegalActions(mhGameState, PLAYER_2)
      .filter(ea => ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === mhGameState.players[1].hand[0].instanceId);

    // All actions targeting Aragorn (no items) should be non-viable
    for (const a of playActions) {
      expect(a.viable).toBe(false);
    }
  });

  test('not playable on a character bearing only minor items', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [DRAGON_SICKNESS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...base, phaseState: makeMHState() };
    const dsCard = mhGameState.players[1].hand[0];
    const playActions = computeLegalActions(mhGameState, PLAYER_2)
      .filter(ea => ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === dsCard.instanceId);

    for (const a of playActions) {
      expect(a.viable).toBe(false);
    }
  });

  test('playable on a character bearing a major item', () => {
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
          hand: [DRAGON_SICKNESS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...base, phaseState: makeMHState() };
    const dsCard = mhGameState.players[1].hand[0];
    const viablePlays = computeLegalActions(mhGameState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === dsCard.instanceId);

    expect(viablePlays.length).toBe(1);
    const target = (viablePlays[0].action as PlayHazardAction).targetCharacterId;
    const aragornId = charIdAt(mhGameState, RESOURCE_PLAYER);
    expect(target).toBe(aragornId);
  });

  test('playable on a character bearing a greater item', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [THE_MITHRIL_COAT] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [DRAGON_SICKNESS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...base, phaseState: makeMHState() };
    const dsCard = mhGameState.players[1].hand[0];
    const viablePlays = computeLegalActions(mhGameState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === dsCard.instanceId);

    expect(viablePlays.length).toBe(1);
  });

  test('resolving Dragon-sickness enqueues corruption check with -1 modifier on targeted character', () => {
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
          hand: [DRAGON_SICKNESS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...base, phaseState: makeMHState() };
    const dsCard = mhGameState.players[1].hand[0];
    const companyId = companyIdAt(mhGameState, RESOURCE_PLAYER);
    const aragornId = charIdAt(mhGameState, RESOURCE_PLAYER);

    const viablePlays = computeLegalActions(mhGameState, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard'
        && (ea.action).cardInstanceId === dsCard.instanceId);
    expect(viablePlays.length).toBe(1);

    const playResult = reduce(mhGameState, viablePlays[0].action);
    expect(playResult.error).toBeUndefined();

    // Resolve chain — both players pass priority until chain auto-resolves
    const afterChain = resolveChain(playResult.state);
    expect(afterChain.chain).toBeNull();

    // Dragon-sickness should be in hazard player's discard pile (short event)
    expect(afterChain.players[1].discardPile.some(c => c.definitionId === DRAGON_SICKNESS)).toBe(true);

    // A corruption-check pending resolution should be enqueued for the resource player
    const pending = afterChain.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type !== 'corruption-check') return;

    expect(pending[0].kind.characterId).toBe(aragornId);
    expect(pending[0].kind.reason).toBe('Dragon-sickness');

    // Legal actions should collapse to the corruption-check resolution
    const viable = computeLegalActions(afterChain, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(viable).toHaveLength(1);

    const cc = viable[0].action as CorruptionCheckAction;
    // The -1 modifier from the card should be in corruptionModifier
    expect(cc.corruptionModifier).toBe(-1);
    expect(cc.characterId).toBe(aragornId);
    void companyId;
  });

  test('companyId used in play-hazard matches targeted company', () => {
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
          hand: [DRAGON_SICKNESS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });

    const mhGameState = { ...base, phaseState: makeMHState() };
    const dsCard = mhGameState.players[1].hand[0];
    const companyId = companyIdAt(mhGameState, RESOURCE_PLAYER);

    const playActions = viableActions(mhGameState, PLAYER_2, 'play-hazard')
      .filter(ea => (ea.action as PlayHazardAction).cardInstanceId === dsCard.instanceId);

    expect(playActions.length).toBe(1);
    expect((playActions[0].action as PlayHazardAction).targetCompanyId).toBe(companyId);
  });
});
