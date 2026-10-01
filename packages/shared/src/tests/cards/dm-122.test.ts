/**
 * @module dm-122.test
 *
 * Card test: Cup of Farewell (dm-122)
 * Type: hero-resource-event (permanent)
 * Text: "Playable on a company at a Haven [{H}] during the organization
 *   phase. Once during each of your turns, you can tap a character in this
 *   company, if the company is at a Haven [{H}], to take a minor item from
 *   your sideboard into your hand (show opponent). Cannot be duplicated on a
 *   given company."
 *
 * Effects:
 * | # | Effect                                              | Status      | Notes |
 * |---|-----------------------------------------------------|-------------|-------|
 * | 1 | play-condition: phase organization                  | IMPLEMENTED | org-phase only |
 * | 2 | play-target: company, target.siteType haven         | IMPLEMENTED | binds `companyId` |
 * | 3 | duplication-limit: scope company, max 1             | IMPLEMENTED | |
 * | 4 | grant-action cup-of-farewell-fetch                  | IMPLEMENTED | `cost.tap: "character"` on a company-bound event — `companyBoundCharacterTapGrantActions`; `oncePerTurn`, own turn only, `when: site.type haven`; `enqueue-pending-fetch` sideboard → hand, `revealToOpponent` |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  DAGGER_OF_WESTERNESSE, GLAMDRING,
  Phase, CardStatus,
  RESOURCE_PLAYER,
  buildTestState, resetMint,
  viableActions, viableFor, dispatch, handCardId, companyIdAt, findCharInstanceId,
  playPermanentEventAndResolve, addCardInPlay, setCharStatus, isGrantedAction,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId, GameState } from '../../index.js';
import type { PlayerSetup } from '../test-helpers.js';

const CUP_OF_FAREWELL = 'dm-122' as CardDefinitionId;
const CUP_FETCH = isGrantedAction('cup-of-farewell-fetch');

const P1_AT_RIVENDELL: PlayerSetup = {
  id: PLAYER_1,
  companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
  hand: [],
  siteDeck: [MINAS_TIRITH],
  sideboard: [DAGGER_OF_WESTERNESSE, GLAMDRING],
};
const P1_AT_MORIA: PlayerSetup = { ...P1_AT_RIVENDELL, companies: [{ site: MORIA, characters: [ARAGORN, LEGOLAS] }] };
const P1_TWO_HAVEN_COMPANIES: PlayerSetup = {
  ...P1_AT_RIVENDELL,
  companies: [
    { site: RIVENDELL, characters: [ARAGORN, LEGOLAS] },
    { site: LORIEN, characters: [GIMLI] },
  ],
};
const P2: PlayerSetup = { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [FARAMIR] }], hand: [], siteDeck: [MORIA] };

describe('Cup of Farewell (dm-122)', () => {
  beforeEach(() => resetMint());

  // ── Play restriction: company at a Haven during organization ─────────────

  test('playable on a company at a Haven during the organization phase, binding to it', () => {
    const state = buildTestState({
      phase: Phase.Organization, activePlayer: PLAYER_1,
      players: [{ ...P1_AT_RIVENDELL, hand: [CUP_OF_FAREWELL] }, P2],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions).toHaveLength(1);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    expect((actions[0].action as { targetCompanyId?: unknown }).targetCompanyId).toBe(companyId);

    const cupId = handCardId(state, RESOURCE_PLAYER);
    const after = playPermanentEventAndResolve(state, PLAYER_1, cupId, undefined, { targetCompanyId: companyId });
    const inPlay = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.instanceId === cupId);
    expect(inPlay?.companyId).toBe(companyId);
  });

  test('not playable on a company at a non-Haven site', () => {
    const state = buildTestState({
      phase: Phase.Organization, activePlayer: PLAYER_1,
      players: [{ ...P1_AT_MORIA, hand: [CUP_OF_FAREWELL] }, P2],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  test('not playable outside the organization phase', () => {
    const state = buildTestState({
      phase: Phase.Site, activePlayer: PLAYER_1,
      players: [{ ...P1_AT_RIVENDELL, hand: [CUP_OF_FAREWELL] }, P2],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event')).toHaveLength(0);
  });

  // ── Cannot be duplicated on a given company ──────────────────────────────

  test('a second copy cannot be played on the same company, only on another Haven company', () => {
    const base = buildTestState({
      phase: Phase.Organization, activePlayer: PLAYER_1,
      players: [{ ...P1_TWO_HAVEN_COMPANIES, hand: [CUP_OF_FAREWELL] }, P2],
    });
    const state = addCardInPlay(base, RESOURCE_PLAYER, CUP_OF_FAREWELL, companyIdAt(base, RESOURCE_PLAYER, 0));
    const targets = viableActions(state, PLAYER_1, 'play-permanent-event')
      .map(ea => (ea.action as { targetCompanyId?: unknown }).targetCompanyId);
    expect(targets).not.toContain(companyIdAt(state, RESOURCE_PLAYER, 0));
    expect(targets).toContain(companyIdAt(state, RESOURCE_PLAYER, 1));
  });

  // ── Tap a character in this company to fetch a minor item ────────────────

  test('each untapped character in the bound company may tap to activate it', () => {
    const base = buildTestState({ phase: Phase.Organization, activePlayer: PLAYER_1, players: [P1_TWO_HAVEN_COMPANIES, P2] });
    const state = addCardInPlay(base, RESOURCE_PLAYER, CUP_OF_FAREWELL, companyIdAt(base, RESOURCE_PLAYER, 0));
    const actors = viableFor(state, PLAYER_1).map(ea => ea.action).filter(CUP_FETCH)
      .map(a => (a as ActivateGrantedAction).characterId);
    expect(actors).toHaveLength(2);
    expect(actors).toContain(findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN));
    expect(actors).toContain(findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS));
    // Gimli is in a different company — he cannot pay.
    expect(actors).not.toContain(findCharInstanceId(state, RESOURCE_PLAYER, GIMLI));
  });

  test('a tapped character cannot pay the cost', () => {
    const base = buildTestState({ phase: Phase.Organization, activePlayer: PLAYER_1, players: [P1_AT_RIVENDELL, P2] });
    const state = setCharStatus(
      addCardInPlay(base, RESOURCE_PLAYER, CUP_OF_FAREWELL, companyIdAt(base, RESOURCE_PLAYER)),
      RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped,
    );
    const actors = viableFor(state, PLAYER_1).map(ea => ea.action).filter(CUP_FETCH)
      .map(a => (a as ActivateGrantedAction).characterId);
    expect(actors).toEqual([findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS)]);
  });

  test('activation taps the character and takes a minor item (only) from the sideboard to hand, shown to the opponent', () => {
    const base = buildTestState({ phase: Phase.Organization, activePlayer: PLAYER_1, players: [P1_AT_RIVENDELL, P2] });
    const state = addCardInPlay(base, RESOURCE_PLAYER, CUP_OF_FAREWELL, companyIdAt(base, RESOURCE_PLAYER));
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const activate = viableFor(state, PLAYER_1).map(ea => ea.action).filter(CUP_FETCH)
      .find(a => (a as ActivateGrantedAction).characterId === aragornId)!;
    const afterActivation = dispatch(state, activate);

    expect(afterActivation.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Tapped);
    // The Cup itself stays in play, untapped.
    const cup = afterActivation.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === CUP_OF_FAREWELL);
    expect(cup?.status).toBe(CardStatus.Untapped);

    const fetchActions = viableActions(afterActivation, PLAYER_1, 'fetch-from-pile');
    const dagger = afterActivation.players[RESOURCE_PLAYER].sideboard.find(c => c.definitionId === DAGGER_OF_WESTERNESSE)!;
    // Glamdring is a major item — not offered.
    expect(fetchActions.map(ea => (ea.action as { cardInstanceId: unknown }).cardInstanceId)).toEqual([dagger.instanceId]);

    const afterFetch = dispatch(afterActivation, fetchActions[0].action);
    const p1 = afterFetch.players[RESOURCE_PLAYER];
    expect(p1.hand.some(c => c.instanceId === dagger.instanceId)).toBe(true);
    expect(p1.sideboard.some(c => c.instanceId === dagger.instanceId)).toBe(false);
    expect(p1.sideboard.some(c => c.definitionId === GLAMDRING)).toBe(true);
    expect(afterFetch.revealedInstances[dagger.instanceId]).toBe(DAGGER_OF_WESTERNESSE);
    expect(afterFetch.pendingEffects).toHaveLength(0);
  });

  test('only once per turn — no further activation after use, even with untapped characters left', () => {
    const base = buildTestState({ phase: Phase.Organization, activePlayer: PLAYER_1, players: [P1_AT_RIVENDELL, P2] });
    const state = addCardInPlay(base, RESOURCE_PLAYER, CUP_OF_FAREWELL, companyIdAt(base, RESOURCE_PLAYER));
    const first = viableFor(state, PLAYER_1).map(ea => ea.action).find(CUP_FETCH)!;
    const afterActivation = dispatch(state, first);
    const fetch = viableActions(afterActivation, PLAYER_1, 'fetch-from-pile')[0];
    const afterFetch = dispatch(afterActivation, fetch.action);
    expect(viableFor(afterFetch, PLAYER_1).map(ea => ea.action).filter(CUP_FETCH)).toHaveLength(0);
  });

  test('not offered when the company is not at a Haven', () => {
    const base = buildTestState({ phase: Phase.Organization, activePlayer: PLAYER_1, players: [P1_AT_MORIA, P2] });
    const state = addCardInPlay(base, RESOURCE_PLAYER, CUP_OF_FAREWELL, companyIdAt(base, RESOURCE_PLAYER));
    expect(viableFor(state, PLAYER_1).map(ea => ea.action).filter(CUP_FETCH)).toHaveLength(0);
  });

  test('not offered when the sideboard holds no minor item', () => {
    const base = buildTestState({
      phase: Phase.Organization, activePlayer: PLAYER_1,
      players: [{ ...P1_AT_RIVENDELL, sideboard: [GLAMDRING] }, P2],
    });
    const state: GameState = addCardInPlay(base, RESOURCE_PLAYER, CUP_OF_FAREWELL, companyIdAt(base, RESOURCE_PLAYER));
    expect(viableFor(state, PLAYER_1).map(ea => ea.action).filter(CUP_FETCH)).toHaveLength(0);
  });

  test('usable later in your turn (end-of-turn phase) while at a Haven', () => {
    const base = buildTestState({ phase: Phase.EndOfTurn, activePlayer: PLAYER_1, players: [P1_AT_RIVENDELL, P2] });
    const state = addCardInPlay(base, RESOURCE_PLAYER, CUP_OF_FAREWELL, companyIdAt(base, RESOURCE_PLAYER));
    expect(viableFor(state, PLAYER_1).map(ea => ea.action).filter(CUP_FETCH)).toHaveLength(2);
  });

  test('not usable during the opponent\'s turn', () => {
    const base = buildTestState({ phase: Phase.EndOfTurn, activePlayer: PLAYER_2, players: [P1_AT_RIVENDELL, P2] });
    const state = addCardInPlay(base, RESOURCE_PLAYER, CUP_OF_FAREWELL, companyIdAt(base, RESOURCE_PLAYER));
    expect(viableFor(state, PLAYER_1).map(ea => ea.action).filter(CUP_FETCH)).toHaveLength(0);
  });
});
