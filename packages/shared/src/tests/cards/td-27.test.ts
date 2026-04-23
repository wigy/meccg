/**
 * @module td-27.test
 *
 * Card test: From the Pits of Angband (td-27)
 * Type: hazard-event (long)
 *
 * Text:
 *   "At the end of each turn, each player may take one unique Dragon
 *    manifestation or one Drake hazard creature from his discard pile and
 *    shuffle it into his play deck. Alternatively, if Doors of Night is in
 *    play, at the end of each turn, each player may return one unique Dragon
 *    manifestation and/or one Drake hazard creature from his discard pile to
 *    his hand. Cannot be duplicated."
 *
 * Engine Support:
 * | # | Rule                                                   | Status          | Notes                                    |
 * |---|--------------------------------------------------------|-----------------|------------------------------------------|
 * | 1 | Cannot be duplicated (game scope, max 1)               | IMPLEMENTED     | duplication-limit gates play-hazard      |
 * | 2 | Can be played as a hazard long-event during M/H        | IMPLEMENTED     | generic hazard long-event play flow      |
 * | 3 | End-of-turn optional fetch (both players, shuffle into | NOT IMPLEMENTED | no end-of-turn trigger fires from in-play |
 * |   | play deck) for unique Dragon manif. OR Drake creature  |                 | long-events; `matchesTrigger` returns     |
 * |   | from discard pile                                      |                 | false for any event but wounded-by-self   |
 * | 4 | Doors of Night alternative: same fetch but into hand   | NOT IMPLEMENTED | depends on (3); no fetch-to-hand trigger  |
 * |   | (and Dragon manifestation AND/OR Drake, not OR)        |                 | action from in-play long-event           |
 *
 * Playable: PARTIALLY — duplication-limit is enforced, but the core
 * recurring end-of-turn fetch ability granted to both players is not
 * implemented. NOT CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  viableActions,
  P1_COMPANY, makeMHState,
  playHazardAndResolve,
  handCardId, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CardInPlay, CardInstanceId, GameState } from '../../index.js';

const FROM_THE_PITS = 'td-27' as CardDefinitionId;

describe('From the Pits of Angband (td-27)', () => {
  beforeEach(() => resetMint());

  test('can be played as a hazard long-event during M/H play-hazards step', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [FROM_THE_PITS], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const mhState: GameState = { ...base, phaseState: makeMHState() };

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);

    const cardId = handCardId(mhState, HAZARD_PLAYER);
    const resolved = playHazardAndResolve(mhState, PLAYER_2, cardId, P1_COMPANY);

    expect(resolved.chain).toBeNull();
    expect(resolved.players[1].hand).toHaveLength(0);
    expect(resolved.players[1].cardsInPlay).toHaveLength(1);
    expect(resolved.players[1].cardsInPlay[0].definitionId).toBe(FROM_THE_PITS);
  });

  test('cannot be duplicated — second copy rejected when one is already in play', () => {
    // "Cannot be duplicated" encodes as duplication-limit scope:game max:1.
    // When a copy of td-27 is already in either player's cardsInPlay, the
    // hazard-play legal-action emitter must not offer another copy.
    const existing: CardInPlay = {
      instanceId: 'pits-1' as CardInstanceId,
      definitionId: FROM_THE_PITS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [FROM_THE_PITS],
          siteDeck: [MINAS_TIRITH],
          cardsInPlay: [existing],
        },
      ],
    });
    const mhState: GameState = { ...base, phaseState: makeMHState() };

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('duplication-limit applies across players (game scope)', () => {
    // The "game" scope sums copies across BOTH players' cardsInPlay —
    // if p1 already has a copy in play, p2 still cannot play a second.
    const existing: CardInPlay = {
      instanceId: 'pits-1' as CardInstanceId,
      definitionId: FROM_THE_PITS,
      status: CardStatus.Untapped,
    };
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          cardsInPlay: [existing],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [FROM_THE_PITS],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const mhState: GameState = { ...base, phaseState: makeMHState() };

    const actions = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  // ─── NOT IMPLEMENTED — end-of-turn trigger mechanics ───────────────────────
  //
  // Enabling these requires three pieces of engine work, none present today:
  //
  // 1. A generic "at end of each turn" trigger that scans long-events in play
  //    for both players. Today `matchesTrigger()` (chain-reducer.ts) only
  //    resolves `character-wounded-by-self`; there is no end-of-turn pulse
  //    that iterates in-play long-events.
  // 2. A per-player optional grant-action at end-of-turn that lets the player
  //    pick one qualifying card from their discard pile. The existing EOT
  //    grant-action infrastructure (legal-actions/end-of-turn.ts,
  //    `EOT_FETCH_KEYWORDS`) only serves the resource/active player and only
  //    from character-borne sources (Saruman, Wizard's Staff) — not from an
  //    in-play hazard long-event offered to both players.
  // 3. Apply types for "shuffle-from-discard-to-deck" (OR filter: unique
  //    Dragon manifestation / Drake hazard-creature) and the Doors-of-Night
  //    alternative that instead moves the card to hand.

  test.todo('at end-of-turn (no DoN), each player may shuffle one unique Dragon manifestation from discard into play deck');

  test.todo('at end-of-turn (no DoN), each player may shuffle one Drake hazard creature from discard into play deck');

  test.todo('fetch filter rejects non-unique Dragon manifestations (only unique ones qualify)');

  test.todo('fetch filter rejects hazard creatures that are not Drakes');

  test.todo('with Doors of Night in play, each player may return one unique Dragon manifestation from discard to hand');

  test.todo('with Doors of Night in play, each player may also return one Drake hazard creature — and both in the same end-of-turn (AND/OR wording)');

  test.todo('end-of-turn fetch is optional — a player may decline');

  test.todo('end-of-turn fetch is offered to BOTH players (including the non-active hazard player)');
});
