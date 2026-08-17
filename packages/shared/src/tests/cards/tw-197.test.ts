/**
 * @module tw-197.test
 *
 * Card test: Beornings (tw-197)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Beorn's House if the influence check is greater than 7.
 *  Standard Modifications: Men (+1)."
 *
 * influenceNumber = 8, race = man, playableAt = Beorn's House.
 *
 * Effects tested:
 * 1. check-modifier: +1 to influence check when the influencing character is a Man
 *
 * Also covers CoE 8.3 re-influence discoverability (bug report: a player
 * whose own Beornings was stuck in hand behind the opponent's unique copy
 * got only pass/continue, with no indication that Beorn's House was the
 * place to attempt re-influencing the opponent's copy):
 * 2. from-hand not-playable reason names Beorn's House when the opponent's
 *    copy is already in play
 * 3. opponent-influence-attempt against the opponent's in-play copy is
 *    offered once the resource player's company reaches Beorn's House
 * 4. the once-per-turn opponentInteractionThisTurn slot and the turn <= 2
 *    guard still suppress the re-influence attempt (regression coverage for
 *    the gating itself, not just the new text)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  THEODEN, LEGOLAS, LORIEN,
  buildSitePhaseState, buildTestState, resetMint, makeSitePhase,
  findCharInstanceId, RESOURCE_PLAYER,
  nonViableOfType, firstOpponentInfluenceAttempt,
  Phase, CardStatus,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { InfluenceAttemptAction, NotPlayableAction, CardDefinitionId, CardInPlay, CardInstanceId } from '../../index.js';

const BEORNINGS = 'tw-197' as CardDefinitionId;
const BEORNS_HOUSE = 'tw-376' as CardDefinitionId;

describe('Beornings (tw-197)', () => {
  beforeEach(() => resetMint());

  test('Man character gets +1 check modifier when influencing Beornings', () => {
    // Théoden (man, base DI 3) attempts to influence Beornings at Beorn's House.
    // Influence number = 8. Men (+1) check modifier applies.
    //   need = influenceNumber(8) − DI(3) − manCheckMod(+1) = 4
    const state = buildSitePhaseState({
      characters: [THEODEN],
      site: BEORNS_HOUSE,
      hand: [BEORNINGS],
    });

    const thedenId = findCharInstanceId(state, RESOURCE_PLAYER, THEODEN);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const thedenAttempt = influenceActions.find(
      a => a.influencingCharacterId === thedenId,
    );
    expect(thedenAttempt).toBeDefined();

    // need = 8 − 3 (DI) − 1 (man check modifier) = 4
    expect(thedenAttempt!.need).toBe(4);
  });

  test('non-Man character gets no check modifier when influencing Beornings', () => {
    // Legolas (elf, base DI 2) attempts to influence Beornings at Beorn's House.
    // Influence number = 8. Men (+1) check modifier does NOT apply to elves.
    //   need = influenceNumber(8) − DI(2) = 6
    const state = buildSitePhaseState({
      characters: [LEGOLAS],
      site: BEORNS_HOUSE,
      hand: [BEORNINGS],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const actions = computeLegalActions(state, PLAYER_1);

    const influenceActions = actions
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);

    const legolasAttempt = influenceActions.find(
      a => a.influencingCharacterId === legolasId,
    );
    expect(legolasAttempt).toBeDefined();

    // need = 8 − 2 (DI) = 6 (no check modifier for elves)
    expect(legolasAttempt!.need).toBe(6);
  });

  test('Man has lower need than non-Man for Beornings', () => {
    const manState = buildSitePhaseState({
      characters: [THEODEN],
      site: BEORNS_HOUSE,
      hand: [BEORNINGS],
    });
    const thedenId = findCharInstanceId(manState, RESOURCE_PLAYER, THEODEN);
    const manNeed = (
      computeLegalActions(manState, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'influence-attempt')
        .map(a => a.action as InfluenceAttemptAction)
        .find(a => a.influencingCharacterId === thedenId)
    )!.need;

    const elfState = buildSitePhaseState({
      characters: [LEGOLAS],
      site: BEORNS_HOUSE,
      hand: [BEORNINGS],
    });
    const legolasId = findCharInstanceId(elfState, RESOURCE_PLAYER, LEGOLAS);
    const elfNeed = (
      computeLegalActions(elfState, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'influence-attempt')
        .map(a => a.action as InfluenceAttemptAction)
        .find(a => a.influencingCharacterId === legolasId)
    )!.need;

    // Man has +1 advantage: elfNeed > manNeed
    expect(manNeed).toBeLessThan(elfNeed);
  });

  test('own Beornings in hand names Beorn’s House when the opponent’s copy is already in play', () => {
    // Uniqueness is checked across both players — the opponent already
    // controls the only copy of Beornings, so the resource player's copy is
    // stuck in hand. The only remaining path is a CoE 8.3 re-influence
    // attempt at Beorn's House; the tooltip should name that site.
    const opponentBeornings: CardInPlay = {
      instanceId: 'beornings-1' as CardInstanceId,
      definitionId: BEORNINGS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BEORNS_HOUSE, characters: [THEODEN] }], hand: [BEORNINGS], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [BEORNS_HOUSE], cardsInPlay: [opponentBeornings] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const handInstanceId = state.players[0].hand[0].instanceId;
    const actions = computeLegalActions(state, PLAYER_1);
    const blocked = nonViableOfType(actions, 'not-playable')
      .find(ea => (ea.action as NotPlayableAction).cardInstanceId === handInstanceId);

    expect(blocked).toBeDefined();
    expect(blocked!.reason).toContain('unique and already in play');
    expect(blocked!.reason).toContain('Beorn’s House');
  });

  test('opponent-influence-attempt targets the in-play Beornings once the company reaches Beorn’s House', () => {
    const opponentBeornings: CardInPlay = {
      instanceId: 'beornings-1' as CardInstanceId,
      definitionId: BEORNINGS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BEORNS_HOUSE, characters: [THEODEN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [BEORNS_HOUSE], cardsInPlay: [opponentBeornings] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, opponentBeornings.instanceId, PLAYER_1);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');
    expect(attempt!.targetPlayer).toBe(PLAYER_2);
  });

  test('opponent-influence-attempt is absent once opponentInteractionThisTurn is already spent', () => {
    const opponentBeornings: CardInPlay = {
      instanceId: 'beornings-1' as CardInstanceId,
      definitionId: BEORNINGS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BEORNS_HOUSE, characters: [THEODEN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [BEORNS_HOUSE], cardsInPlay: [opponentBeornings] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase({ opponentInteractionThisTurn: 'influence' }), turnNumber: 3 };

    const attempt = firstOpponentInfluenceAttempt(state, opponentBeornings.instanceId, PLAYER_1);
    expect(attempt).toBeUndefined();
  });

  test('opponent-influence-attempt is absent on turn <= 2', () => {
    const opponentBeornings: CardInPlay = {
      instanceId: 'beornings-1' as CardInstanceId,
      definitionId: BEORNINGS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BEORNS_HOUSE, characters: [THEODEN] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [BEORNS_HOUSE], cardsInPlay: [opponentBeornings] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase(), turnNumber: 2 };

    const attempt = firstOpponentInfluenceAttempt(state, opponentBeornings.instanceId, PLAYER_1);
    expect(attempt).toBeUndefined();
  });
});
