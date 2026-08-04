/**
 * @module le-224.test
 *
 * Card test: Rumor of the One (le-224)
 * Type: minion-resource-event (permanent)
 *
 * "+1 to the corruption points and the marshalling points for all ring items.
 *  Discard when any play deck is exhausted. Cannot be duplicated."
 *
 * Effects tested:
 * 1. in-play-item-modifier — while Rumor is in either player's cardsInPlay,
 *    every borne item with the `ring` keyword gains +1 effective corruption
 *    point on its bearer and +1 marshalling point in the item category. The
 *    boost reaches ring items held by BOTH players (the card text says "all
 *    ring items"). A non-ring item is unaffected.
 * 2. on-event play-deck-exhausted — the permanent event self-discards when a
 *    play-deck exhaust completes (either player's deck).
 * 3. duplication-limit scope:game max:1 — cannot be played while a copy is
 *    already in play.
 *
 * Fixture alignment: minion resource event (alignment "ringwraith"), so the
 * tests build state with minion characters (Gorbag le-11, Shagrat le-39) at
 * minion sites (Dol Guldur le-367, Minas Morgul le-390, Ettenmoors le-373).
 * The ring item used is The Least of Gold Rings (le-315): a minion gold-ring
 * with printed corruption 4 and 2 marshalling points, so no cross-alignment
 * halving applies for a minion bearer. Sable Shield (le-341, corruption 2 /
 * 2 MP, keyword "shield") is the non-ring control item.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  addCardInPlay, attachItemToChar,
  charIdAt, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  expectInDiscardPile, expectInPile,
} from '../test-helpers.js';
import type { CardDefinitionId, EndOfTurnPhaseState } from '../../index.js';
import { computeLegalActions, Alignment } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const RUMOR_OF_THE_ONE = 'le-224' as CardDefinitionId;
const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId; // minion ring item, cp 4 / 2 MP
const SABLE_SHIELD = 'le-341' as CardDefinitionId;         // minion item, cp 2 / 2 MP, non-ring
const GORBAG = 'le-11' as CardDefinitionId;                // minion-character, ringwraith
const SHAGRAT = 'le-39' as CardDefinitionId;               // minion-character, ringwraith
const DOL_GULDUR = 'le-367' as CardDefinitionId;           // minion-site, haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;         // minion-site, haven
const ETTENMOORS_MINION = 'le-373' as CardDefinitionId;    // minion-site, ruins-and-lairs
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;      // reshuffle fodder for deck exhaust

describe('Rumor of the One (le-224)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: +1 corruption / +1 marshalling to ring items ─────────

  test('ring item bearer gains +1 corruption point while Rumor is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
      ],
    });
    const gorbagId = charIdAt(base, RESOURCE_PLAYER);

    // Ring on bearer, no Rumor: printed corruption 4.
    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GORBAG, LEAST_OF_GOLD_RINGS));
    expect(withRing.players[RESOURCE_PLAYER].characters[gorbagId].effectiveStats.corruptionPoints).toBe(4);

    // Add Rumor of the One: ring corruption becomes 5.
    const withRumor = recomputeDerived(addCardInPlay(withRing, RESOURCE_PLAYER, RUMOR_OF_THE_ONE));
    expect(withRumor.players[RESOURCE_PLAYER].characters[gorbagId].effectiveStats.corruptionPoints).toBe(5);
  });

  test('ring item gains +1 marshalling point while Rumor is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
      ],
    });

    // Ring on bearer, no Rumor: item MP category = 2 (printed).
    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GORBAG, LEAST_OF_GOLD_RINGS));
    expect(withRing.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);

    // Add Rumor of the One: item MP becomes 3.
    const withRumor = recomputeDerived(addCardInPlay(withRing, RESOURCE_PLAYER, RUMOR_OF_THE_ONE));
    expect(withRumor.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(3);
  });

  test('non-ring item is unaffected by Rumor (filter matches only ring items)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
      ],
    });
    const gorbagId = charIdAt(base, RESOURCE_PLAYER);

    // Sable Shield (non-ring): printed corruption 2, item MP 2 — unchanged by Rumor.
    const withShield = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, SABLE_SHIELD);
    const withRumor = recomputeDerived(addCardInPlay(withShield, RESOURCE_PLAYER, RUMOR_OF_THE_ONE));

    expect(withRumor.players[RESOURCE_PLAYER].characters[gorbagId].effectiveStats.corruptionPoints).toBe(2);
    expect(withRumor.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });

  test('boost applies to ring items held by both players (global "all ring items")', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
      ],
    });
    const shagratId = charIdAt(base, HAZARD_PLAYER);

    // Ring held by the OPPONENT (player 1); Rumor is in the active player's cardsInPlay.
    const withRing = attachItemToChar(base, HAZARD_PLAYER, SHAGRAT, LEAST_OF_GOLD_RINGS);
    const withRumor = recomputeDerived(addCardInPlay(withRing, RESOURCE_PLAYER, RUMOR_OF_THE_ONE));

    // The opponent's ring corruption is boosted to 5, and their item MP to 3.
    expect(withRumor.players[HAZARD_PLAYER].characters[shagratId].effectiveStats.corruptionPoints).toBe(5);
    expect(withRumor.players[HAZARD_PLAYER].marshallingPoints.item).toBe(3);
  });

  // ── Effect 2: discard when any play deck is exhausted ──────────────

  test('card discards when a play deck exhaust completes during EOT', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [ETTENMOORS_MINION],
          playDeck: [],
          discardPile: [STRANGE_RATIONS],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }],
          hand: [],
          siteDeck: [ETTENMOORS_MINION],
        },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [false, true] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, RESOURCE_PLAYER, RUMOR_OF_THE_ONE);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_1 });
    // Still in play while the exhaust sub-flow is pending.
    expect(afterExhaust.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === RUMOR_OF_THE_ONE,
    )).toBe(true);

    // Completing the exhaust (pass) fires play-deck-exhausted → self-discard.
    // Own deck exhausting: CRF 22 "Exhausted" shuffles the discard into the new play deck.
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_1 });
    expectInPile(afterPass, RESOURCE_PLAYER, 'playDeck', RUMOR_OF_THE_ONE);
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === RUMOR_OF_THE_ONE,
    )).toBe(false);
  });

  test('card discards even when the OPPONENT play deck exhausts (any play deck)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
          hand: [],
          siteDeck: [ETTENMOORS_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }],
          hand: [],
          siteDeck: [ETTENMOORS_MINION],
          playDeck: [],
          discardPile: [STRANGE_RATIONS],
        },
      ],
    });
    const resetHandState = {
      ...base,
      phaseState: {
        ...(base.phaseState as EndOfTurnPhaseState),
        step: 'reset-hand' as const,
        discardDone: [true, true] as [boolean, boolean],
        resetHandDone: [true, false] as [boolean, boolean],
      } as EndOfTurnPhaseState,
    };
    const withEvent = addCardInPlay(resetHandState, RESOURCE_PLAYER, RUMOR_OF_THE_ONE);

    const afterExhaust = dispatch(withEvent, { type: 'deck-exhaust', player: PLAYER_2 });
    const afterPass = dispatch(afterExhaust, { type: 'pass', player: PLAYER_2 });

    expectInDiscardPile(afterPass, RESOURCE_PLAYER, RUMOR_OF_THE_ONE);
    expect(afterPass.players[RESOURCE_PLAYER].cardsInPlay.some(
      c => c.definitionId === RUMOR_OF_THE_ONE,
    )).toBe(false);
  });

  // ── Effect 3: cannot be duplicated ─────────────────────────────────

  test('cannot be duplicated — not playable when a copy is already in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [RUMOR_OF_THE_ONE], siteDeck: [ETTENMOORS_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
      ],
    });
    const withEvent = addCardInPlay(base, RESOURCE_PLAYER, RUMOR_OF_THE_ONE);

    // With a copy already in play, the game-scoped duplication limit removes the
    // second Rumor's play-permanent-event action entirely (contrast the next
    // test, which offers a viable play when no copy is in play).
    const viablePlays = computeLegalActions(withEvent, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-permanent-event');
    expect(viablePlays).toHaveLength(0);
  });

  test('can be played normally when no copy is in play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [RUMOR_OF_THE_ONE], siteDeck: [ETTENMOORS_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [SHAGRAT] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
      ],
    });

    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-permanent-event');

    expect(playActions.length).toBeGreaterThan(0);
  });
});
