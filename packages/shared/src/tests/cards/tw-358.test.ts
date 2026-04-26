/**
 * @module tw-358.test
 *
 * Card test: Vilya (tw-358)
 * Type: hero-resource-event (short)
 * Effects: play-target, duplication-limit, on-event×3 (character-stat-modifier), move (conditional fetch), on-event (enqueue-corruption-check)
 *
 * "Playable on Elrond. +4 prowess, +2 body, +6 direct influence until the
 * end of the turn. If Elrond is at Rivendell and your play deck has at least
 * 5 cards in it, you may take 3 resource cards of your choice from your
 * discard pile and shuffle them into your play deck. Elrond makes a
 * corruption check modified by -3. Cannot be duplicated on a given turn."
 *
 * | # | Rule fragment                              | Status      |
 * |---|--------------------------------------------|-------------|
 * | 1 | Playable on Elrond                         | IMPLEMENTED |
 * | 2 | +4 prowess until EOT                       | IMPLEMENTED |
 * | 3 | +2 body until EOT                          | IMPLEMENTED |
 * | 4 | +6 direct-influence until EOT              | IMPLEMENTED |
 * | 5 | Fetch 3 resources when at Rivendell, ≥5 deck| IMPLEMENTED |
 * | 6 | Elrond corruption check −3                 | IMPLEMENTED |
 * | 7 | Cannot be duplicated on a given turn       | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ELROND, ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  buildTestState, resetMint,
  viableActions, findCharInstanceId, findHandCardId,
  dispatch,
  RESOURCE_PLAYER,
  getCharacter,
} from '../test-helpers.js';
import type {
  CardDefinitionId,
  CardInstanceId,
  PlayShortEventAction,
  FetchFromPileAction,
} from '../../index.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { SitePhaseState } from '../../index.js';

const VILYA = 'tw-358' as CardDefinitionId;

/** Build a minimal site-phase state with Elrond at Rivendell, Vilya in hand. */
function buildVilya(opts: {
  site?: CardDefinitionId;
  discardPile?: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  extraConstraints?: boolean;
} = {}) {
  const site = opts.site ?? RIVENDELL;
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site, characters: [ELROND] }],
        hand: [VILYA],
        siteDeck: [MORIA],
        discardPile: opts.discardPile ?? [],
        playDeck: opts.playDeck,
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
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };
  return { ...base, phaseState: sitePhaseState };
}

describe('Vilya (tw-358)', () => {
  beforeEach(() => resetMint());

  // ─── Test 1: Vilya is playable on Elrond ─────────────────────────────────

  test('Vilya is playable in Elrond\'s company (site phase)', () => {
    const state = buildVilya();
    const plays = viableActions(state, PLAYER_1, 'play-short-event') as Array<{ action: PlayShortEventAction }>;
    expect(plays).toHaveLength(1);
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    expect(plays[0].action.targetCharacterId).toBe(elrondId);
  });

  // ─── Test 2: Vilya NOT playable when Elrond is absent ────────────────────

  test('Vilya NOT playable when Elrond is not in any company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [VILYA],
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
          === findHandCardId(stateAtSite, RESOURCE_PLAYER, VILYA));
    expect(notPlayable).toHaveLength(1);
  });

  // ─── Test 3: Cannot be duplicated on a given turn ────────────────────────

  test('Vilya NOT playable when a turn-scoped constraint from tw-358 already exists', () => {
    const base = buildVilya();
    // Inject a fake active constraint sourced from tw-358 to simulate having
    // played one copy this turn already.
    const elrondId = findCharInstanceId(base, RESOURCE_PLAYER, ELROND);
    const stateWithConstraint = {
      ...base,
      activeConstraints: [
        ...base.activeConstraints,
        {
          id: 'fake-constraint-id' as import('../../types/pending.js').ConstraintId,
          source: 'fake-instance' as CardInstanceId,
          sourceDefinitionId: VILYA,
          scope: { kind: 'turn' as const },
          target: { kind: 'character' as const, characterId: elrondId },
          kind: { type: 'character-stat-modifier' as const, stat: 'prowess' as const, value: 4, characterId: elrondId },
        },
      ],
    };
    const plays = viableActions(stateWithConstraint, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(0);
    const notPlayable = computeLegalActions(stateWithConstraint, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable');
    expect(notPlayable).toHaveLength(1);
  });

  // ─── Tests 4 & 5: Stat boosts applied to Elrond ──────────────────────────

  test('playing Vilya adds +4 prowess, +2 body, +6 direct-influence on Elrond (character-stat-modifier constraints)', () => {
    const state = buildVilya({ playDeck: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, GLAMDRING] });
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const vilyaId = findHandCardId(state, RESOURCE_PLAYER, VILYA);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: vilyaId,
      targetCharacterId: elrondId,
    });

    // Three character-stat-modifier constraints should have been added
    const charConstraints = s.activeConstraints.filter(
      c => c.kind.type === 'character-stat-modifier'
        && (c.kind as { characterId: CardInstanceId }).characterId === elrondId,
    );
    expect(charConstraints).toHaveLength(3);

    // Elrond base: prowess 7, body 9, directInfluence 4
    const elrond = getCharacter(s, RESOURCE_PLAYER, ELROND);
    expect(elrond.effectiveStats.prowess).toBe(7 + 4);
    expect(elrond.effectiveStats.body).toBe(9 + 2);
    expect(elrond.effectiveStats.directInfluence).toBe(4 + 6);
  });

  // ─── Test 6: Corruption check enqueued ───────────────────────────────────

  test('playing Vilya enqueues a corruption check on Elrond (modifier −3)', () => {
    // Use a small deck so no fetch is triggered (< 5 cards)
    const state = buildVilya({ playDeck: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE] });
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const vilyaId = findHandCardId(state, RESOURCE_PLAYER, VILYA);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: vilyaId,
      targetCharacterId: elrondId,
    });

    const corruptionChecks = s.pendingResolutions.filter(
      r => r.kind.type === 'corruption-check'
        && (r.kind as { characterId: CardInstanceId }).characterId === elrondId,
    );
    expect(corruptionChecks).toHaveLength(1);
    expect((corruptionChecks[0].kind as { modifier: number }).modifier).toBe(-3);
  });

  // ─── Test 7: Fetch offered when at Rivendell and deck ≥ 5 ────────────────

  test('fetch-to-deck pending effect with count 3 offered when Elrond is at Rivendell and deck ≥ 5', () => {
    const state = buildVilya({
      site: RIVENDELL,
      discardPile: [GLAMDRING, DAGGER_OF_WESTERNESSE],
      playDeck: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
    });
    // 5 cards in deck satisfies ≥5 condition
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const vilyaId = findHandCardId(state, RESOURCE_PLAYER, VILYA);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: vilyaId,
      targetCharacterId: elrondId,
    });

    expect(s.pendingEffects).toHaveLength(1);
    expect(s.pendingEffects[0].type).toBe('card-effect');
    expect(s.pendingEffects[0].effect.type).toBe('fetch-to-deck');
    expect((s.pendingEffects[0].effect as { count: number }).count).toBe(3);

    // Legal actions include fetch-from-pile for each eligible discard card
    const fetchActions = computeLegalActions(s, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Test 8: Fetch NOT offered at non-Rivendell site ─────────────────────

  test('fetch NOT offered when Elrond is not at Rivendell', () => {
    const state = buildVilya({
      site: MORIA,
      discardPile: [GLAMDRING, DAGGER_OF_WESTERNESSE],
    });
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const vilyaId = findHandCardId(state, RESOURCE_PLAYER, VILYA);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: vilyaId,
      targetCharacterId: elrondId,
    });

    const fetchEffects = s.pendingEffects.filter(
      pe => pe.type === 'card-effect' && pe.effect.type === 'fetch-to-deck',
    );
    expect(fetchEffects).toHaveLength(0);
  });

  // ─── Test 9: Fetch NOT offered when play deck has < 5 cards ──────────────

  test('fetch NOT offered when play deck has fewer than 5 cards', () => {
    const state = buildVilya({
      site: RIVENDELL,
      discardPile: [GLAMDRING, DAGGER_OF_WESTERNESSE],
      playDeck: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, GLAMDRING],
    });
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const vilyaId = findHandCardId(state, RESOURCE_PLAYER, VILYA);

    const s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: vilyaId,
      targetCharacterId: elrondId,
    });

    const fetchEffects = s.pendingEffects.filter(
      pe => pe.type === 'card-effect' && pe.effect.type === 'fetch-to-deck',
    );
    expect(fetchEffects).toHaveLength(0);
  });

  // ─── Test 10: Multi-pick — second pick offered after first fetch ──────────

  test('second fetch pick offered after first: count decrements from 3 to 2', () => {
    const state = buildVilya({
      site: RIVENDELL,
      discardPile: [GLAMDRING, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
      playDeck: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
    });
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const vilyaId = findHandCardId(state, RESOURCE_PLAYER, VILYA);

    let s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: vilyaId,
      targetCharacterId: elrondId,
    });

    // Fetch first card (Glamdring)
    const glamdringId = s.players[RESOURCE_PLAYER].discardPile.find(
      c => c.definitionId === GLAMDRING,
    )!.instanceId;
    s = dispatch(s, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      source: 'discard-pile',
    } as FetchFromPileAction);

    // Still one pending effect remaining, count now 2
    expect(s.pendingEffects).toHaveLength(1);
    expect((s.pendingEffects[0].effect as { count: number }).count).toBe(2);
  });

  // ─── Test 11: Pass cancels remaining picks ────────────────────────────────

  test('passing after first fetch cancels remaining picks', () => {
    const state = buildVilya({
      site: RIVENDELL,
      discardPile: [GLAMDRING, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
      playDeck: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
    });
    const elrondId = findCharInstanceId(state, RESOURCE_PLAYER, ELROND);
    const vilyaId = findHandCardId(state, RESOURCE_PLAYER, VILYA);

    let s = dispatch(state, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: vilyaId,
      targetCharacterId: elrondId,
    });

    // Fetch first card, then pass on the next pick
    const glamdringId = s.players[RESOURCE_PLAYER].discardPile.find(
      c => c.definitionId === GLAMDRING,
    )!.instanceId;
    s = dispatch(s, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: glamdringId,
      source: 'discard-pile',
    } as FetchFromPileAction);

    // Player passes the second pick — skips rest of the fetch
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    // All pending effects should be cleared after pass
    const fetchEffects = s.pendingEffects.filter(
      pe => pe.type === 'card-effect' && pe.effect.type === 'fetch-to-deck',
    );
    expect(fetchEffects).toHaveLength(0);
  });
});
