/**
 * @module tw-239.test
 *
 * Card test: Favor of the Valar (tw-239)
 * Type: hero-resource-event (short, unique)
 * Alignment: wizard
 *
 * Text:
 *   "Unique. Playable during your organization phase. Shuffle your hand and
 *    your discard pile into your play deck (site cards remain in the discard
 *    pile). Draw a new hand of 8 cards. Remove Favor of the Valar from the
 *    game. Cannot be included in a Fallen-wizard's deck."
 *
 * Effects:
 *   1. play-window: phase organization
 *   2. new-hand: handSize 8
 *   3. play-flag: remove-from-game
 *   4. deck-restriction: excluded-from-deck when deck.alignment fallen-wizard (rule 1.18)
 *
 * Engine support table:
 * | # | Rule                                                                 | Status      |
 * |---|----------------------------------------------------------------------|-------------|
 * | 1 | Playable only during the player's organization phase                 | IMPLEMENTED |
 * | 2 | Played as an action on the chain of effects (CoE 9.4/9.5)            | IMPLEMENTED |
 * | 3 | Hand and discard pile shuffled into the play deck                    | IMPLEMENTED |
 * | 4 | Site cards remain in the discard pile (separate siteDiscardPile)     | IMPLEMENTED |
 * | 5 | A new hand of 8 cards is drawn (fewer at deck exhaustion)            | IMPLEMENTED |
 * | 6 | The spent card is removed from the game (out-of-play, not discard)   | IMPLEMENTED |
 * | 7 | Cannot be included in a Fallen-wizard's deck (rule 1.18)             | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures (hero, per the card's wizard alignment):
 *   LEGOLAS / RIVENDELL   - the company anchoring the organization phase
 *   Hero resource filler (Concealment, Dodge, Dark Quarrels, Sun, Halfling
 *   Strength, Wizard's Laughter, Vanishment, Smoke Rings) - hand/deck/discard
 *   contents whose instances must all survive the reshuffle
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, pool,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  viableActions, findHandCardId, dispatch, resolveChain,
  Phase, Alignment,
  LEGOLAS, GIMLI, RIVENDELL, LORIEN,
  CONCEALMENT, DODGE, DARK_QUARRELS, SUN, HALFLING_STRENGTH,
  WIZARDS_LAUGHTER, VANISHMENT, SMOKE_RINGS,
  HERO_RESOURCES_30, HAZARD_CREATURES_12,
} from '../test-helpers.js';
import { validateDeck } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, DeckList } from '../../index.js';

const FAVOR_OF_THE_VALAR = 'tw-239' as CardDefinitionId;
const WHITE_TOWERS = 'wh-58' as CardDefinitionId;

function buildFavorState(opts: {
  phase?: Phase;
  hand?: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
}) {
  return buildTestState({
    phase: opts.phase ?? Phase.Organization,
    activePlayer: PLAYER_1,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
        hand: [FAVOR_OF_THE_VALAR, ...(opts.hand ?? [])],
        siteDeck: [RIVENDELL],
        playDeck: opts.playDeck ?? [],
        discardPile: opts.discardPile ?? [],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [GIMLI] }],
        hand: [],
        siteDeck: [LORIEN],
      },
    ],
  });
}

/** Instance ids of every card in the player's play-deck zones (hand + deck + discard). */
function playZoneIds(state: ReturnType<typeof buildFavorState>, playerIdx: number): CardInstanceId[] {
  const p = state.players[playerIdx];
  return [...p.hand, ...p.playDeck, ...p.discardPile].map(c => c.instanceId);
}

describe('Favor of the Valar (tw-239)', () => {
  beforeEach(() => resetMint());

  test('is a playable resource short-event during the organization phase', () => {
    const state = buildFavorState({
      hand: [CONCEALMENT],
      playDeck: [SUN, DODGE],
      discardPile: [DARK_QUARRELS],
    });
    const favorId = findHandCardId(state, RESOURCE_PLAYER, FAVOR_OF_THE_VALAR);
    const playActions = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === favorId);
    expect(playActions).toHaveLength(1);
  });

  test('is NOT playable outside the organization phase (play-window)', () => {
    const state = buildFavorState({
      phase: Phase.LongEvent,
      playDeck: [SUN, DODGE],
    });
    const favorId = findHandCardId(state, RESOURCE_PLAYER, FAVOR_OF_THE_VALAR);
    const playActions = viableActions(state, PLAYER_1, 'play-short-event')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === favorId);
    expect(playActions).toHaveLength(0);
  });

  test('is declared on the chain of effects rather than resolving immediately (CoE 9.4/9.5)', () => {
    const state = buildFavorState({
      hand: [CONCEALMENT, DODGE],
      playDeck: [SUN, DARK_QUARRELS],
      discardPile: [HALFLING_STRENGTH],
    });
    const favorId = findHandCardId(state, RESOURCE_PLAYER, FAVOR_OF_THE_VALAR);

    const onChain = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: favorId });

    // A chain is now active and the card rides on it (left the hand) — nothing
    // has been shuffled or drawn yet.
    expect(onChain.chain).not.toBeNull();
    expect(onChain.chain!.entries).toHaveLength(1);
    expect(onChain.chain!.entries[0].card?.instanceId).toBe(favorId);
    // Priority sits with the opponent so they may respond before resolution.
    expect(onChain.chain!.priority).toBe(PLAYER_2);

    const p1 = onChain.players[RESOURCE_PLAYER];
    expect(p1.hand.map(c => c.instanceId)).not.toContain(favorId);
    expect(p1.hand).toHaveLength(2); // remaining hand untouched until resolution
    expect(p1.playDeck).toHaveLength(2); // deck untouched
    expect(p1.discardPile).toHaveLength(1); // discard untouched
    expect(p1.outOfPlayPile).toHaveLength(0);

    const oppActions = viableActions(onChain, PLAYER_2, 'pass-chain-priority');
    expect(oppActions).toHaveLength(1);
  });

  test('shuffles hand and discard into the play deck, draws a new hand of 8, and removes itself from the game', () => {
    // 3 other hand cards + 4 discard cards + 5 deck cards = 12 pooled cards.
    const state = buildFavorState({
      hand: [CONCEALMENT, DODGE, DARK_QUARRELS],
      playDeck: [SUN, HALFLING_STRENGTH, WIZARDS_LAUGHTER, VANISHMENT, SMOKE_RINGS],
      discardPile: [CONCEALMENT, DODGE, SUN, DARK_QUARRELS],
    });
    const favorId = findHandCardId(state, RESOURCE_PLAYER, FAVOR_OF_THE_VALAR);
    const pooledIds = playZoneIds(state, RESOURCE_PLAYER).filter(id => id !== favorId);
    expect(pooledIds).toHaveLength(12);

    const onChain = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: favorId });
    const next = resolveChain(onChain);

    expect(next.chain).toBeNull();
    const p = next.players[RESOURCE_PLAYER];

    // A fresh hand of exactly 8, the remaining 4 pooled cards form the deck,
    // and every card came from the pooled hand+discard+deck (no instance lost
    // or conjured).
    expect(p.hand).toHaveLength(8);
    expect(p.playDeck).toHaveLength(4);
    const afterIds = [...p.hand, ...p.playDeck].map(c => c.instanceId);
    expect([...afterIds].sort()).toEqual([...pooledIds].sort());

    // Favor of the Valar itself is removed from the game: out-of-play pile,
    // never the discard pile (cannot be recurred), never shuffled into the deck.
    expect(p.outOfPlayPile.map(c => c.instanceId)).toContain(favorId);
    expect(p.discardPile).toHaveLength(0);
    expect(afterIds).not.toContain(favorId);

    // The card-driven reshuffle is not a rule-1.31 deck exhaustion.
    expect(p.deckExhaustionCount).toBe(0);

    // Site cards remain untouched in their own zones.
    expect(p.siteDeck).toHaveLength(1);
  });

  test('draws fewer than 8 when hand + discard + deck hold fewer cards', () => {
    // 1 other hand card + 1 discard card + 2 deck cards = 4 pooled cards.
    const state = buildFavorState({
      hand: [CONCEALMENT],
      playDeck: [SUN, DODGE],
      discardPile: [DARK_QUARRELS],
    });
    const favorId = findHandCardId(state, RESOURCE_PLAYER, FAVOR_OF_THE_VALAR);
    const pooledIds = playZoneIds(state, RESOURCE_PLAYER).filter(id => id !== favorId);

    const onChain = dispatch(state, { type: 'play-short-event', player: PLAYER_1, cardInstanceId: favorId });
    const next = resolveChain(onChain);

    const p = next.players[RESOURCE_PLAYER];
    // All 4 available cards drawn as the new hand; deck empty; no card lost.
    expect([...p.hand.map(c => c.instanceId)].sort()).toEqual([...pooledIds].sort());
    expect(p.playDeck).toHaveLength(0);
    expect(p.discardPile).toHaveLength(0);
    expect(p.outOfPlayPile.map(c => c.instanceId)).toContain(favorId);
    expect(p.deckExhaustionCount).toBe(0);
  });

  test('cannot be included in a Fallen-wizard deck (rule 1.18)', () => {
    const fwDeck: DeckList = {
      id: 'test-fw-favor',
      name: 'FW Favor of the Valar',
      alignment: 'fallen-wizard',
      pool: [],
      sideboard: [],
      sites: [{ name: 'The White Towers', card: WHITE_TOWERS, qty: 1 }],
      deck: {
        characters: [],
        hazards: [...HAZARD_CREATURES_12],
        resources: [{ name: 'Favor of the Valar', card: FAVOR_OF_THE_VALAR, qty: 1 }],
      },
    };
    const errors = validateDeck(fwDeck, pool).filter(e => e.card === FAVOR_OF_THE_VALAR);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('not allowed');
  });

  test('is allowed in a hero (wizard) deck', () => {
    const heroDeck: DeckList = {
      id: 'test-hero-favor',
      name: 'Hero Favor of the Valar',
      alignment: 'hero',
      pool: [],
      sideboard: [],
      sites: [{ name: 'Rivendell', card: RIVENDELL, qty: 1 }],
      deck: {
        characters: [],
        hazards: [...HAZARD_CREATURES_12],
        resources: [
          ...HERO_RESOURCES_30,
          { name: 'Favor of the Valar', card: FAVOR_OF_THE_VALAR, qty: 1 },
        ],
      },
    };
    const bannedErrors = validateDeck(heroDeck, pool)
      .filter(e => e.card === FAVOR_OF_THE_VALAR && e.message.includes('not allowed'));
    expect(bannedErrors).toHaveLength(0);
  });
});
