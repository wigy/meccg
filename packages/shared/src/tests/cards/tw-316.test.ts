/**
 * @module tw-316.test
 *
 * Card test: Return of the King (tw-316)
 * Type: hero-resource-event (permanent)
 * Effects: play-target (character: Aragorn II only),
 *          play-target (site: Minas Tirith only),
 *          play-condition (card-not-in-play: Denethor II),
 *          stat-modifier (+3 direct-influence)
 *
 * "Unique. Aragorn II only. Only playable in Minas Tirith and only if Denethor II
 *  is not in play. Aragorn II's direct influence is modified by +3. Keep this card
 *  with Aragorn II; discard if he leaves play."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  CardStatus,
  ARAGORN, FARAMIR, LEGOLAS,
  MINAS_TIRITH, MORIA, LORIEN,
  buildSitePhaseState, buildDualHandSitePhaseState, buildTestState, makePlayDeck,
  resetMint, viableActions, attachItemToChar, makeMHState,
  findCharInstanceId, dispatch, mint,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, PlayPermanentEventAction } from '../../index.js';
import { Phase } from '../../index.js';
import { enqueueResolution } from '../../engine/pending.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const RETURN_OF_THE_KING = 'tw-316' as CardDefinitionId;

describe('Return of the King (tw-316)', () => {
  beforeEach(() => resetMint());

  // ── Effect 2: play-target (site: Minas Tirith only) ──

  test('NOT playable at wrong site (Moria) even with Aragorn', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [RETURN_OF_THE_KING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 1: play-target (character: Aragorn II only) ──

  test('NOT playable at Minas Tirith without Aragorn II in the company', () => {
    const state = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [FARAMIR],
      hand: [RETURN_OF_THE_KING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effects 1+2 combined: positive case ──

  test('IS playable at Minas Tirith with Aragorn II when Denethor II is not in play', () => {
    const state = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [ARAGORN],
      hand: [RETURN_OF_THE_KING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const act = actions[0].action as PlayPermanentEventAction;
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(act.targetCharacterId).toBe(aragornId);
  });

  // ── Rule 2.1.1: playable at any phase, not gated behind `enter-site` ──
  // Bug report: RotK's text carries no "playable during the site phase"
  // wording (unlike its site-targeting siblings), so per rule 2.1.1 it must
  // remain playable during any phase of the resource player's turn — not
  // just the site phase.

  test('IS playable during the end-of-turn phase when Aragorn II is at Minas Tirith', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [RETURN_OF_THE_KING],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const act = actions[0].action as PlayPermanentEventAction;
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(act.targetCharacterId).toBe(aragornId);
  });

  test('IS playable during the site phase before enter-site, once the company is already at Minas Tirith', () => {
    // Reproduces a reported bug: the company had already arrived at Minas
    // Tirith (currentSite set), but the card was only offered after
    // `enter-site` resolved — even though its text declares no site-phase
    // timing and rule 2.1.1 allows resource permanent-events at any phase.
    const state = buildDualHandSitePhaseState({
      site: MINAS_TIRITH,
      resourceCharacters: [ARAGORN],
      resourceHand: [RETURN_OF_THE_KING],
      step: 'enter-or-skip',
      siteEntered: false,
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const act = actions[0].action as PlayPermanentEventAction;
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    expect(act.targetCharacterId).toBe(aragornId);
  });

  // Bug report: a company that moved to Minas Tirith this turn had its
  // `currentSite` reassigned as soon as its own movement/hazard sub-phase
  // completed, but was offered Return of the King while still inside the
  // movement/hazard phase — before the site phase — even though its own
  // hazard resolution had finished and priority had already passed to
  // another company. CoE rule 2.IV.5 / CRF-22 Annotation 25: a company that
  // reveals a new site card is "en route" (not "at" any site) for the rest
  // of the movement/hazard phase, only becoming "at" its site again once the
  // site phase begins.
  test('NOT playable during the movement/hazard phase once the company has moved to Minas Tirith but not yet reached its site phase', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }], hand: [RETURN_OF_THE_KING], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state: GameState = {
      ...base,
      players: [
        { ...base.players[0], companies: [{ ...base.players[0].companies[0], moved: true }] },
        base.players[1],
      ] as typeof base.players,
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
    };
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 3: play-condition (card-not-in-play: Denethor II) ──

  test('NOT playable when Denethor II is in play', () => {
    const MOCK_DENETHOR_DEF = 'mock-denethor-ii' as CardDefinitionId;
    const base = buildSitePhaseState({
      site: MINAS_TIRITH,
      characters: [ARAGORN],
      hand: [RETURN_OF_THE_KING],
    });
    // Inject a mock Denethor II definition and add him to cardsInPlay (simulates any in-play card).
    const stateWithDenethor: GameState = {
      ...base,
      cardPool: {
        ...base.cardPool,
        [MOCK_DENETHOR_DEF as string]: {
          cardType: 'hero-character',
          id: MOCK_DENETHOR_DEF,
          name: 'Denethor II',
        } as unknown as typeof base.cardPool[CardDefinitionId],
      },
      players: [
        {
          ...base.players[0],
          cardsInPlay: [
            ...base.players[0].cardsInPlay,
            { instanceId: mint(), definitionId: MOCK_DENETHOR_DEF, status: CardStatus.Untapped },
          ],
        },
        base.players[1],
      ] as unknown as typeof base.players,
    };
    const actions = viableActions(stateWithDenethor, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Effect 4: stat-modifier (+3 direct-influence) ──

  test('+3 direct influence when Return of the King is attached to Aragorn II', () => {
    // Aragorn base DI = 3; with Return of the King: effective DI = 6.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withCard = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RETURN_OF_THE_KING);
    const state = recomputeDerived(withCard);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const aragornChar = state.players[RESOURCE_PLAYER].characters[aragornId];
    expect(aragornChar.effectiveStats.directInfluence).toBe(6);
  });

  // ── "discard if he leaves play" rule ──

  test('Return of the King is discarded when Aragorn II leaves play', () => {
    // Build a state with Return of the King attached to Aragorn at Moria.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withCard = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RETURN_OF_THE_KING);

    // Enqueue a dice-check (call-of-home) for Aragorn with threshold=24 (guaranteed to fail).
    // Aragorn mind=9 → unusedGI=20-9=11. Roll=2: 2+11=13 < 24 → returns to hand.
    const stateWithPending = enqueueResolution(withCard, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: {
        type: 'dice-check',
        label: 'Call of Home: Aragorn II',
        modifiers: [{ kind: 'unused-gi', player: PLAYER_1 }],
        threshold: 24,
        comparison: 'gte',
        onFail: { type: 'return-character-to-hand' },
        continuation: { kind: 'chain-entry', match: 'target-character' },
        requireTargetPresent: true,
        targetCharacterId: aragornId,
      },
    });

    const rollActions = viableActions({ ...stateWithPending, cheatRollTotal: 2 }, PLAYER_1, 'resolve-dice-check');
    expect(rollActions.length).toBe(1);

    const finalState = dispatch({ ...stateWithPending, cheatRollTotal: 2 }, rollActions[0].action);

    // Aragorn must be back in hand.
    expect(finalState.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === ARAGORN)).toBe(true);
    // Return of the King must be in the discard pile.
    expect(finalState.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === RETURN_OF_THE_KING)).toBe(true);
    // Return of the King must no longer be on any character.
    const stillOnChar = Object.values(finalState.players[RESOURCE_PLAYER].characters)
      .some(ch => ch.items.some(i => i.definitionId === RETURN_OF_THE_KING));
    expect(stillOnChar).toBe(false);
  });
});
