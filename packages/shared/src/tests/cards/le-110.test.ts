/**
 * @module le-110.test
 *
 * Card test: Doors of Night (le-110) — The Lidless Eye reprint of tw-28.
 * Type: hazard-event (permanent, environment)
 * Effects: 2 (duplication-limit scope:game max:1, on-event self-enters-play
 *   discard-cards-in-play filter:{hero,minion}-resource-event+environment)
 *
 * "Environment. When Doors of Night is played, all resource environment cards
 *  in play are immediately discarded, and all resource environment effects are
 *  canceled. Cannot be duplicated."
 *
 * The discard filter matches both hero resource environments (Gates of Morning)
 * and minion resource environments (Skies of Fire, which "acts as Gates of
 * Morning"). "Cannot be duplicated" is enforced by card name, so the tw-28 and
 * le-110 printings share a single in-play copy.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  GATES_OF_MORNING, DOORS_OF_NIGHT, TWILIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  viableActions,
  P1_COMPANY, makeMHState,
  playHazardAndResolve,
  handCardId, dispatch, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId, GameState } from '../../index.js';

// The LE printing of Doors of Night, and the minion "acts as Gates of Morning"
// resource environment it must also discard.
const DOORS_OF_NIGHT_LE = 'le-110' as CardDefinitionId;
const SKIES_OF_FIRE = 'le-228' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Doors of Night (le-110)', () => {
  beforeEach(() => resetMint());

  test('can be played as a hazard permanent event during M/H play-hazards step', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT_LE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };

    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);

    const donId = handCardId(mhGameState, HAZARD_PLAYER);

    // After declaring, the card sits on the chain (not in hand, not in cardsInPlay).
    const declareState = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(declareState.players[1].hand).toHaveLength(0);
    expect(declareState.players[1].cardsInPlay).toHaveLength(0);
    expect(declareState.chain).not.toBeNull();
    expect(declareState.chain!.entries[0].card?.instanceId).toBe(donId);

    // After the chain resolves, the card enters cardsInPlay.
    const s = playHazardAndResolve(mhGameState, PLAYER_2, donId, P1_COMPANY);
    expect(s.chain).toBeNull();
    expect(s.players[1].hand).toHaveLength(0);
    expect(s.players[1].cardsInPlay).toHaveLength(1);
    expect(s.players[1].cardsInPlay[0].instanceId).toBe(donId);
  });

  test('discards Gates of Morning (hero resource environment) when played', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT_LE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = handCardId(mhGameState, HAZARD_PLAYER);
    const s = playHazardAndResolve(mhGameState, PLAYER_2, donId, P1_COMPANY);

    expect(s.players[1].cardsInPlay).toHaveLength(1);
    expect(s.players[1].cardsInPlay[0].instanceId).toBe(donId);
    // Gates of Morning discarded from P1 cardsInPlay.
    expect(s.players[0].cardsInPlay).toHaveLength(0);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain('gom-1' as CardInstanceId);
  });

  test('discards Skies of Fire (minion resource environment) when played', () => {
    const sofInPlay: CardInPlay = {
      instanceId: 'sof-1' as CardInstanceId,
      definitionId: SKIES_OF_FIRE,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], cardsInPlay: [sofInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT_LE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = handCardId(mhGameState, HAZARD_PLAYER);
    const s = playHazardAndResolve(mhGameState, PLAYER_2, donId, P1_COMPANY);

    // Doors of Night in play; the minion resource environment is discarded too.
    expect(s.players[1].cardsInPlay).toHaveLength(1);
    expect(s.players[1].cardsInPlay[0].instanceId).toBe(donId);
    expect(s.players[0].cardsInPlay).toHaveLength(0);
    expect(s.players[0].discardPile.map(c => c.instanceId)).toContain('sof-1' as CardInstanceId);
  });

  test('no opposing environments to discard is a no-op', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT_LE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = handCardId(mhGameState, HAZARD_PLAYER);
    const s = playHazardAndResolve(mhGameState, PLAYER_2, donId, P1_COMPANY);

    expect(s.players[1].cardsInPlay).toHaveLength(1);
    expect(s.players[0].discardPile).toHaveLength(0);
    expect(s.players[1].discardPile).toHaveLength(0);
  });

  test('cannot be duplicated — blocked while another Doors of Night is in play', () => {
    const donInPlay: CardInPlay = {
      instanceId: 'don-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT_LE,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT_LE], siteDeck: [MINAS_TIRITH], cardsInPlay: [donInPlay] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated across printings — a tw-28 copy blocks the le-110 copy (name-based)', () => {
    const twDonInPlay: CardInPlay = {
      instanceId: 'don-tw-1' as CardInstanceId,
      definitionId: DOORS_OF_NIGHT, // tw-28, same card name
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT_LE], siteDeck: [MINAS_TIRITH], cardsInPlay: [twDonInPlay] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('opponent responds with Twilight to cancel Doors of Night before it discards Gates of Morning', () => {
    const gomInPlay: CardInPlay = {
      instanceId: 'gom-1' as CardInstanceId,
      definitionId: GATES_OF_MORNING,
      status: CardStatus.Untapped,
    };

    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [TWILIGHT], siteDeck: [MORIA], cardsInPlay: [gomInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [DOORS_OF_NIGHT_LE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const mhGameState: GameState = { ...state, phaseState: makeMHState() };
    const donId = handCardId(mhGameState, HAZARD_PLAYER);
    const p1Twilight = handCardId(mhGameState, RESOURCE_PLAYER);

    // P2 plays DoN → chain starts, P1 gets priority.
    let current = dispatch(mhGameState, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: donId, targetCompanyId: P1_COMPANY });
    expect(current.chain!.priority).toBe(PLAYER_1);

    // P1 responds with Twilight targeting DoN on the chain.
    current = dispatch(current, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: p1Twilight, targetInstanceId: donId });

    // Both pass → chain resolves LIFO: Twilight negates DoN.
    current = dispatch(current, { type: 'pass-chain-priority', player: PLAYER_2 });
    current = dispatch(current, { type: 'pass-chain-priority', player: PLAYER_1 });

    const s = current;
    expect(s.chain).toBeNull();
    // DoN negated → goes to discard, never enters play.
    expect(s.players[1].cardsInPlay).toHaveLength(0);
    expect(s.players[1].discardPile.map(c => c.instanceId)).toContain(donId);
    // Gates of Morning survives.
    expect(s.players[0].cardsInPlay).toHaveLength(1);
    expect(s.players[0].cardsInPlay[0].instanceId).toBe('gom-1' as CardInstanceId);
  });
});
