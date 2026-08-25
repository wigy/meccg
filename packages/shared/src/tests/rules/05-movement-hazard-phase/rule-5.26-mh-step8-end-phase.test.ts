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
  LORIEN, HENNETH_ANNUN, MINAS_TIRITH, RIVENDELL,
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

  test('Step 8 draw that empties the play deck exhausts it mid-draw and resumes from the reshuffled deck (CoE 2.4)', () => {
    // P1 has 0 cards in hand, 2 in the play deck and 3 in the discard pile.
    // Drawing up to hand size (8) runs the deck dry after 2 cards: rule 2.4
    // says the deck is exhausted immediately, the discard pile is reshuffled
    // into a new play deck, and the draw resumes — so P1 ends up with all 5
    // cards in hand and one exhaustion recorded.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          playDeck: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
          discardPile: [DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE, DAGGER_OF_WESTERNESSE],
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

    const p1 = afterBothPass.players[RESOURCE_PLAYER];
    expect(p1.deckExhaustionCount).toBe(1);
    expect(p1.hand).toHaveLength(5);
    expect(p1.playDeck).toHaveLength(0);
    expect(p1.discardPile).toHaveLength(0);
    expect(p1.deckExhaustPending).toBe(false);
    // P2's deck did not run dry — no exhaustion for them.
    expect(afterBothPass.players[HAZARD_PLAYER].deckExhaustionCount).toBe(0);
    expect(afterBothPass.players[HAZARD_PLAYER].hand).toHaveLength(2);
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

  test('site of origin ownership passes to a sibling company left behind', () => {
    // Two companies share Minas Tirith: company 0 owns the physical card and
    // moves away to Henneth Annun; company 1 stays behind. Since company 1 is
    // still occupying the site of origin, the card must remain in play — and
    // ownership of it must pass to company 1 (it can no longer be "borrowing"
    // a card that its sibling no longer holds).
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MINAS_TIRITH, characters: [ARAGORN] },
            { site: MINAS_TIRITH, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [HENNETH_ANNUN],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });

    const [company0, company1] = built.players[0].companies;
    const sharedSite = company0.currentSite!;
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
          companies: [
            {
              ...company0,
              siteCardOwned: true,
              destinationSite: { instanceId: hennethSite.instanceId, definitionId: hennethSite.definitionId, status: CardStatus.Untapped },
              siteOfOrigin: sharedSite.instanceId,
            },
            { ...company1, currentSite: sharedSite, siteCardOwned: false },
          ],
        },
        built.players[1],
      ],
    };

    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const p1 = afterBothPass.players[0];
    const stayedCompany = p1.companies.find(c => c.id === company1.id)!;
    expect(stayedCompany.currentSite?.instanceId).toBe(sharedSite.instanceId);
    expect(stayedCompany.siteCardOwned).toBe(true);
    // The card is still in play at the sibling — it must not have been
    // discarded or returned to the location deck.
    expect(p1.siteDeck.some(c => c.instanceId === sharedSite.instanceId)).toBe(false);
    expect(p1.siteDiscardPile.some(c => c.instanceId === sharedSite.instanceId)).toBe(false);
  });

  test('company arriving at a site already tapped by a sibling company inherits the tapped status (rule 2.II.7.2)', () => {
    // Regression test: Isengard became untapped the round after a Precious
    // Gold Ring was played there. Root cause — when a company moves to a
    // site already held by a sibling company, the arriving company computed
    // its own currentSite status independently instead of copying the
    // sibling's, so an already-tapped shared site looked untapped from the
    // arriving company's side until the two companies merged.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MINAS_TIRITH, characters: [ARAGORN], destinationSite: HENNETH_ANNUN },
            { site: HENNETH_ANNUN, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });

    const [company0, company1] = built.players[0].companies;
    const sharedHenneth = { ...company1.currentSite!, status: CardStatus.Tapped };

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
          companies: [
            {
              ...company0,
              destinationSite: { ...company0.destinationSite!, instanceId: sharedHenneth.instanceId },
              siteOfOrigin: company0.currentSite!.instanceId,
            },
            { ...company1, currentSite: sharedHenneth },
          ],
        },
        built.players[1],
      ],
    };

    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const arrivedCompany = afterBothPass.players[0].companies.find(c => c.id === company0.id)!;
    expect(arrivedCompany.currentSite?.instanceId).toBe(sharedHenneth.instanceId);
    expect(arrivedCompany.currentSite?.status).toBe(CardStatus.Tapped);
  });

  test('site of origin remains in play and syncs its tapped status when a sibling company is already traveling there (rule 2.IV.vii / 2.II.7.2)', () => {
    // Regression test: Moria showed as untapped for a company arriving there
    // even though a sibling company had tapped it earlier the same turn
    // (playing an item) and then moved away. Root cause — Step 8's site-of-
    // origin handling only checked for a sibling still AT the site
    // (currentSite) before discarding a tapped origin; it missed a sibling
    // already traveling THERE (destinationSite). The tapped card got
    // discarded out from under the inbound sibling, which then arrived at a
    // phantom fresh untapped copy of the same instance id — duplicating the
    // site (one copy tapped in the discard pile, one untapped in play) and
    // letting a second item be played at a site that should still be tapped.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MINAS_TIRITH, characters: [ARAGORN], destinationSite: HENNETH_ANNUN },
            { site: RIVENDELL, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });

    const [company0, company1] = built.players[0].companies;
    const sharedMinasTirith = { ...company0.currentSite!, status: CardStatus.Tapped };

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
          companies: [
            {
              ...company0,
              currentSite: sharedMinasTirith,
              siteCardOwned: true,
              siteOfOrigin: sharedMinasTirith.instanceId,
            },
            {
              ...company1,
              destinationSite: { instanceId: sharedMinasTirith.instanceId, definitionId: sharedMinasTirith.definitionId, status: CardStatus.Untapped },
            },
          ],
        },
        built.players[1],
      ],
    };

    const afterResourcePass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const afterBothPass = dispatch(afterResourcePass, { type: 'pass', player: PLAYER_2 });

    const p1 = afterBothPass.players[0];
    // Not discarded, not returned to the location deck — it's still "in
    // play" via the inbound sibling company.
    expect(p1.siteDeck.some(c => c.instanceId === sharedMinasTirith.instanceId)).toBe(false);
    expect(p1.siteDiscardPile.some(c => c.instanceId === sharedMinasTirith.instanceId)).toBe(false);

    const inbound = p1.companies.find(c => c.id === company1.id)!;
    expect(inbound.destinationSite?.status).toBe(CardStatus.Tapped);

    // Resolve the inbound sibling's own Step 8 arrival — it must inherit the
    // tapped status instead of defaulting to a fresh untapped copy.
    const arrivalState: GameState = {
      ...afterBothPass,
      phaseState: makeMHState({
        activeCompanyIndex: p1.companies.findIndex(c => c.id === company1.id),
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      }),
    };
    const arrivalAfterResourcePass = dispatch(arrivalState, { type: 'pass', player: PLAYER_1 });
    const arrivalAfterBothPass = dispatch(arrivalAfterResourcePass, { type: 'pass', player: PLAYER_2 });

    const arrivedCompany1 = arrivalAfterBothPass.players[0].companies.find(c => c.id === company1.id)!;
    expect(arrivedCompany1.currentSite?.instanceId).toBe(sharedMinasTirith.instanceId);
    expect(arrivedCompany1.currentSite?.status).toBe(CardStatus.Tapped);
  });
});
