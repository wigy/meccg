/**
 * @module tw-290.test
 *
 * Card test: Narya (tw-290)
 * Type: hero-resource-event (short)
 * Effects: play-target, on-event×3 (character-stat-modifier), on-event (set-character-status target company), on-event (enqueue-corruption-check)
 *
 * "Playable on Gandalf. +4 prowess, +1 body, +2 direct influence for the rest
 * of the turn. Immediately untap all unwounded characters in Gandalf's
 * company. Gandalf makes a corruption check modified by -5."
 *
 * | # | Rule fragment                                    | Status      |
 * |---|---------------------------------------------------|-------------|
 * | 1 | Playable on Gandalf                                | IMPLEMENTED |
 * | 2 | +4 prowess for the rest of the turn                | IMPLEMENTED |
 * | 3 | +1 body for the rest of the turn                   | IMPLEMENTED |
 * | 4 | +2 direct-influence for the rest of the turn       | IMPLEMENTED |
 * | 5 | Untap all unwounded characters in Gandalf's company| IMPLEMENTED |
 * | 6 | Gandalf corruption check -5                        | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, resetMint,
  viableActions, findCharInstanceId, findHandCardId,
  dispatch,
  RESOURCE_PLAYER,
  getCharacter,
  CardStatus,
  expectCharStatus, expectInDiscardPile,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  CardInstanceId,
  PlayShortEventAction,
} from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { SitePhaseState } from '../../index.js';

const NARYA = 'tw-290' as CardDefinitionId;

/** Build a minimal site-phase state with Gandalf in a company, Narya in hand. */
function buildNarya(opts: {
  companyCharacters?: Array<CardDefinitionId | { defId: CardDefinitionId; status?: CardStatus }>;
} = {}) {
  const characters = opts.companyCharacters ?? [GANDALF];
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters }],
        hand: [NARYA],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: true,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };
  return { ...base, phaseState: sitePhaseState };
}

describe('Narya (tw-290)', () => {
  beforeEach(() => resetMint());

  // ─── Test 1: Narya is playable on Gandalf ────────────────────────────────

  test('Narya is playable in Gandalf\'s company (site phase)', () => {
    const state = buildNarya();
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as Array<{ action: PlayShortEventAction }>;
    expect(plays).toHaveLength(1);
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    expect(plays[0].action.targetCharacterId).toBe(gandalfId);
  });

  // ─── Test 2: Narya NOT playable when Gandalf is absent ───────────────────

  test('Narya NOT playable when Gandalf is not in any company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [NARYA],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    const stateAtSite = { ...state, phaseState: sitePhaseState };

    const plays = viableActions(stateAtSite, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(0);
    const notPlayable = computeLegalActions(stateAtSite, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId
          === findHandCardId(stateAtSite, RESOURCE_PLAYER, NARYA));
    expect(notPlayable).toHaveLength(1);
  });

  // ─── Test 3: Stat boosts applied to Gandalf ──────────────────────────────

  test('playing Narya adds +4 prowess, +1 body, +2 direct-influence on Gandalf (character-stat-modifier constraints)', () => {
    const state = buildNarya();
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const naryaId = findHandCardId(state, RESOURCE_PLAYER, NARYA);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: naryaId,
      targetCharacterId: gandalfId,
    });

    const charConstraints = s.activeConstraints.filter(
      c => c.kind.type === 'character-stat-modifier'
        && (c.kind as { characterId: CardInstanceId }).characterId === gandalfId,
    );
    expect(charConstraints).toHaveLength(3);

    // Gandalf base: prowess 6, body 9, directInfluence 10
    const gandalf = getCharacter(s, RESOURCE_PLAYER, GANDALF);
    expect(gandalf.effectiveStats.prowess).toBe(6 + 4);
    expect(gandalf.effectiveStats.body).toBe(9 + 1);
    expect(gandalf.effectiveStats.directInfluence).toBe(10 + 2);
  });

  // ─── Test 4: Corruption check enqueued ───────────────────────────────────

  test('playing Narya enqueues a corruption check on Gandalf (modifier -5)', () => {
    const state = buildNarya();
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const naryaId = findHandCardId(state, RESOURCE_PLAYER, NARYA);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: naryaId,
      targetCharacterId: gandalfId,
    });

    const corruptionChecks = s.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check'
        && (r.kind as { characterId: CardInstanceId }).characterId === gandalfId,
    );
    expect(corruptionChecks).toHaveLength(1);
    expect((corruptionChecks[0].kind as { modifier: number }).modifier).toBe(-5);
  });

  // ─── Test 5: Untap all unwounded company members ─────────────────────────

  test('playing Narya untaps a tapped company member but leaves a wounded one wounded', () => {
    const state = buildNarya({
      companyCharacters: [
        GANDALF,
        { defId: ARAGORN, status: CardStatus.Tapped },
        { defId: LEGOLAS, status: CardStatus.Inverted },
      ],
    });
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expectCharStatus(state, RESOURCE_PLAYER, LEGOLAS, CardStatus.Inverted);

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const naryaId = findHandCardId(state, RESOURCE_PLAYER, NARYA);

    const after = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: naryaId,
      targetCharacterId: gandalfId,
    });

    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expectCharStatus(after, RESOURCE_PLAYER, LEGOLAS, CardStatus.Inverted);
  });

  test('playing Narya on an already-untapped company leaves members untapped', () => {
    const state = buildNarya({ companyCharacters: [GANDALF, ARAGORN] });
    expectCharStatus(state, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);

    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const naryaId = findHandCardId(state, RESOURCE_PLAYER, NARYA);

    const after = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: naryaId,
      targetCharacterId: gandalfId,
    });

    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
  });

  // ─── Test 6: Card disposal ────────────────────────────────────────────────

  test('card is removed from hand and placed in discard pile after play', () => {
    const state = buildNarya();
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);
    const naryaId = findHandCardId(state, RESOURCE_PLAYER, NARYA);

    const after = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: naryaId,
      targetCharacterId: gandalfId,
    });

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, NARYA);
  });
});
