/**
 * @module le-108.test
 *
 * Card test: Darkness Under Tree (le-108)
 * Type: hazard-event (short)
 * Effects: 2 (play-condition card-in-play "Doors of Night",
 *             tap-character filter race:$in[orc,troll,man])
 *
 * "Playable on an untapped Orc, Troll, or Man character if Doors of Night is
 *  in play. Tap the character."
 *
 * - `play-condition` `card-in-play` "Doors of Night": the card is not offered
 *   at all while Doors of Night is not in play (either player's cardsInPlay).
 * - `tap-character` filter `race: { $in: [orc, troll, man] }`: one action per
 *   eligible untapped character across both alignments (Orc/Troll from a
 *   minion company, Man from a hero company) — mirrors New Moon (tw-68)'s
 *   Mode A, reusing the same `tap-character` engine primitive. Tapped
 *   characters and non-matching races (e.g. Dúnadan) are excluded.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, resolveChain, viableActions,
  makeMHState, handCardId, findCharInstanceId, setCharStatus,
  expectCharStatus, expectInDiscardPile,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER, P1_COMPANY,
  Phase, CardStatus, DOORS_OF_NIGHT, ARAGORN, RIVENDELL, MORIA,
} from '../test-helpers.js';
import type { GameState, CardInstanceId, CardDefinitionId, PlayHazardAction } from '../../index.js';

const DARKNESS_UNDER_TREE = 'le-108' as CardDefinitionId;
const GAMLING = 'tw-155' as CardDefinitionId;    // hero-character, Man
const GORBAG = 'le-11' as CardDefinitionId;      // minion-character, Orc
const OLD_TROLL = 'le-29' as CardDefinitionId;   // minion-character, Troll
const DOL_GULDUR = 'le-367' as CardDefinitionId; // minion-site, haven
const ETTENMOORS = 'le-373' as CardDefinitionId; // minion-site, ruins-and-lairs

/** Doors-of-Night in the hazard player's cardsInPlay. */
const donInPlay = {
  instanceId: 'don-1' as CardInstanceId,
  definitionId: DOORS_OF_NIGHT,
  status: CardStatus.Untapped,
};

/** targetCharacterId of a play-hazard evaluated action. */
function targetOf(a: { action: unknown }): CardInstanceId | undefined {
  return (a.action as PlayHazardAction).targetCharacterId;
}

describe('Darkness Under Tree (le-108)', () => {
  beforeEach(() => resetMint());

  // ─── play-condition: card-in-play "Doors of Night" ────────────────────────

  test('not playable without Doors of Night in play, even against an eligible Man character', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GAMLING, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [DARKNESS_UNDER_TREE], siteDeck: [MORIA] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ─── tap-character filter: race $in [orc, troll, man] ─────────────────────

  test('with Doors of Night in play, offers tapping the Man character but not the Dúnadan', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GAMLING, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [DARKNESS_UNDER_TREE], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const gamlingId = findCharInstanceId(mhState, RESOURCE_PLAYER, GAMLING);
    const aragornId = findCharInstanceId(mhState, RESOURCE_PLAYER, ARAGORN);
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');

    expect(actions).toHaveLength(1);
    expect(targetOf(actions[0])).toBe(gamlingId);
    expect(actions.some(a => targetOf(a) === aragornId)).toBe(false);
  });

  test('with Doors of Night in play, offers tapping both an Orc and a Troll character', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG, OLD_TROLL] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [DARKNESS_UNDER_TREE], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const gorbagId = findCharInstanceId(mhState, RESOURCE_PLAYER, GORBAG);
    const trollId = findCharInstanceId(mhState, RESOURCE_PLAYER, OLD_TROLL);
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    const targets = actions.map(targetOf);

    expect(targets).toContain(gorbagId);
    expect(targets).toContain(trollId);
    expect(actions).toHaveLength(2);
  });

  test('does not offer an already-tapped Orc as a target (must be untapped)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG, OLD_TROLL] }], hand: [], siteDeck: [ETTENMOORS] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [DARKNESS_UNDER_TREE], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const tapped = setCharStatus(state, RESOURCE_PLAYER, GORBAG, CardStatus.Tapped);
    const mhState: GameState = { ...tapped, phaseState: makeMHState() };

    const gorbagId = findCharInstanceId(mhState, RESOURCE_PLAYER, GORBAG);
    const trollId = findCharInstanceId(mhState, RESOURCE_PLAYER, OLD_TROLL);
    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    const targets = actions.map(targetOf);

    expect(targets).not.toContain(gorbagId);
    expect(targets).toContain(trollId);
  });

  // ─── Resolution: taps the chosen character, card goes to discard ──────────

  test('taps the chosen character on resolution and discards the card', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GAMLING, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [DARKNESS_UNDER_TREE], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const gamlingId = findCharInstanceId(mhState, RESOURCE_PLAYER, GAMLING);
    const aragornId = findCharInstanceId(mhState, RESOURCE_PLAYER, ARAGORN);
    const dutId = handCardId(mhState, HAZARD_PLAYER);

    const afterPlay = dispatch(mhState, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: dutId,
      targetCompanyId: P1_COMPANY, targetCharacterId: gamlingId,
    });
    const resolved = resolveChain(afterPlay);

    expectCharStatus(resolved, RESOURCE_PLAYER, GAMLING, CardStatus.Tapped);
    expectCharStatus(resolved, RESOURCE_PLAYER, ARAGORN, CardStatus.Untapped);
    expectInDiscardPile(resolved, HAZARD_PLAYER, DARKNESS_UNDER_TREE);
    expect(resolved.players[HAZARD_PLAYER].hand).toHaveLength(0);
  });
});
