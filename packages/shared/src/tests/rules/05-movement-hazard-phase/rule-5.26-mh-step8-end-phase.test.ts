/**
 * @module rule-5.26-mh-step8-end-phase
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.26: Step 8: End the Company M/H Phase
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Movement/Hazard Phase, Step 8 (End the Company's Movement/Hazard Phase) - A company's movement-hazard phase ends when both players declare that they are done taking actions. Any passive conditions initiated by the end of the phase are declared and resolved in an order chosen by the resource player. Then if no other companies have declared unresolved movement to this company's site of origin, the site of origin is immediately discarded if it was tapped and not a haven site for its player, or returned to the resource player's location deck if it was untapped or a haven site for its player. Both players then immediately reset their hands by drawing or discarding to their base hand size. No other action can be taken during this step unless it is specifically allowed at the end of the movement/hazard phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  LORIEN, HENNETH_ANNUN, MINAS_TIRITH,
  DAGGER_OF_WESTERNESSE, ORC_PATROL, CAVE_DRAKE,
} from '../../test-helpers.js';
import { CardStatus } from '../../../index.js';
import type { GameState } from '../../../index.js';

describe('Rule 5.26 — Step 8: End the Company M/H Phase', () => {
  beforeEach(() => resetMint());

  test('Phase ends when both players done; both players draw to base hand size', () => {
    // P1 has 0 cards in hand with 3 in deck, P2 has 0 in hand with 2 in deck.
    // After both pass in play-hazards, step 8 auto-draws for each player.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          playDeck: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          playDeck: [ORC_PATROL, CAVE_DRAKE],
          siteDeck: [],
        },
      ],
    });

    const state: GameState = {
      ...built,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
    };

    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    // Both players should have drawn all available cards (hand size 8, but deck < 8).
    expect(afterBothPass.players[RESOURCE_PLAYER].hand).toHaveLength(3);
    expect(afterBothPass.players[HAZARD_PLAYER].hand).toHaveLength(2);
    // Decks now empty since fewer cards than hand size.
    expect(afterBothPass.players[RESOURCE_PLAYER].playDeck).toHaveLength(0);
    expect(afterBothPass.players[HAZARD_PLAYER].playDeck).toHaveLength(0);
  });

  test('tapped non-haven site of origin goes to site discard pile, not back to site deck', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MINAS_TIRITH, characters: [ARAGORN] },
          ],
          hand: [],
          siteDeck: [HENNETH_ANNUN],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = built.players[0].companies[0];
    const hennethSite = built.players[0].siteDeck.find(
      c => c.definitionId === HENNETH_ANNUN,
    )!;

    const state: GameState = {
      ...built,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
      players: [
        {
          ...built.players[0],
          companies: [{
            ...company,
            currentSite: { ...company.currentSite!, status: CardStatus.Tapped },
            siteCardOwned: true,
            destinationSite: { instanceId: hennethSite.instanceId, definitionId: hennethSite.definitionId, status: CardStatus.Untapped },
            siteOfOrigin: company.currentSite!.instanceId,
          }],
          siteDeck: built.players[0].siteDeck,
        },
        built.players[1],
      ],
    };

    const originInstanceId = company.currentSite!.instanceId;
    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const p1 = afterBothPass.players[0];
    expect(p1.siteDeck.some(c => c.instanceId === originInstanceId)).toBe(false);
    expect(p1.siteDiscardPile.some(c => c.instanceId === originInstanceId)).toBe(true);
  });

  test('untapped non-haven site of origin returns to site deck', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MINAS_TIRITH, characters: [ARAGORN] },
          ],
          hand: [],
          siteDeck: [HENNETH_ANNUN],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = built.players[0].companies[0];
    const hennethSite = built.players[0].siteDeck.find(
      c => c.definitionId === HENNETH_ANNUN,
    )!;

    const state: GameState = {
      ...built,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
      players: [
        {
          ...built.players[0],
          companies: [{
            ...company,
            siteCardOwned: true,
            destinationSite: { instanceId: hennethSite.instanceId, definitionId: hennethSite.definitionId, status: CardStatus.Untapped },
            siteOfOrigin: company.currentSite!.instanceId,
          }],
          siteDeck: built.players[0].siteDeck,
        },
        built.players[1],
      ],
    };

    const originInstanceId = company.currentSite!.instanceId;
    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const p1 = afterBothPass.players[0];
    expect(p1.siteDeck.some(c => c.instanceId === originInstanceId)).toBe(true);
    expect(p1.siteDiscardPile.some(c => c.instanceId === originInstanceId)).toBe(false);
  });

  test('company arriving at a new site owns the site card even if it previously did not', () => {
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MINAS_TIRITH, characters: [ARAGORN] },
          ],
          hand: [],
          siteDeck: [HENNETH_ANNUN],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = built.players[0].companies[0];
    const hennethSite = built.players[0].siteDeck.find(
      c => c.definitionId === HENNETH_ANNUN,
    )!;

    const state: GameState = {
      ...built,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
      players: [
        {
          ...built.players[0],
          companies: [{
            ...company,
            siteCardOwned: false,
            destinationSite: { instanceId: hennethSite.instanceId, definitionId: hennethSite.definitionId, status: CardStatus.Untapped },
            siteOfOrigin: company.currentSite!.instanceId,
          }],
          siteDeck: built.players[0].siteDeck,
        },
        built.players[1],
      ],
    };

    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const arrivedCompany = afterBothPass.players[0].companies[0];
    expect(arrivedCompany.currentSite?.definitionId).toBe(HENNETH_ANNUN);
    expect(arrivedCompany.siteCardOwned).toBe(true);
  });
});
