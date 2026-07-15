/**
 * @module le-162.test
 *
 * Card test: Akhôrahil Unleashed (le-162)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0.
 *
 * Card text:
 *   "Playable on Akhôrahil the Ringwraith (as your Ringwraith). You may take a
 *    magic card from your play deck or discard pile to your hand (reshuffle
 *    play deck if searched)."
 *
 * Modelled by two DSL effects:
 *   1. `play-target` (character) filtered to `target.name === "Akhôrahil the
 *      Ringwraith"` AND `target.isRevealedAvatar` — the card is playable only
 *      on Akhôrahil while he is the player's own revealed Ringwraith avatar (a
 *      Ringwraith *follower* controlled by another avatar does not qualify).
 *   2. `move` (`select: target`, `from: ["deck", "discard"]`, `to: "hand"`,
 *      `count: 1`, `shuffleAfter: true`) filtered to magic cards (an `$or`
 *      over the keywords spell / sorcery / spirit-magic / shadow-magic — every
 *      magic card carries one). Drives the shared fetch-to-deck sub-flow, which
 *      offers one `fetch-from-pile` per matching card in the play deck and
 *      discard pile, moves the chosen card to hand, and reshuffles the play
 *      deck when the card was searched out of the deck.
 *
 * Rule coverage:
 * | # | Rule                                                             | Status      |
 * |---|------------------------------------------------------------------|-------------|
 * | 1 | Playable on Akhôrahil while he is the revealed Ringwraith avatar  | IMPLEMENTED |
 * | 2 | Not playable when Akhôrahil is absent (name gate)                | IMPLEMENTED |
 * | 3 | Not playable when Akhôrahil is a follower, not the revealed avatar| IMPLEMENTED |
 * | 4 | Fetch offers every magic card in play deck + discard; excludes    | IMPLEMENTED |
 * |   | non-magic cards                                                   |             |
 * | 5 | Taking a magic card from the play deck moves it to hand + reshuffle| IMPLEMENTED |
 * | 6 | Taking a magic card from the discard pile moves it to hand        | IMPLEMENTED |
 * | 7 | "You may" — passing takes nothing; the event still discards       | IMPLEMENTED |
 * | 8 | Only one card may be taken (count 1)                               | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, resolveChain,
  viableActions, actionAs, findCharInstanceId,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment } from '../../index.js';
import type {
  CardDefinitionId, GameState,
  PlayShortEventAction, FetchFromPileAction,
} from '../../index.js';

const AKHORAHIL_UNLEASHED = 'le-162' as CardDefinitionId;
const AKHORAHIL = 'le-51' as CardDefinitionId;            // Akhôrahil the Ringwraith (avatar)
const KHAMUL = 'le-55' as CardDefinitionId;               // a second Ringwraith avatar

// Minion magic cards (different magic skill types — both count as "magic").
const DEEPER_SHADOW = 'le-179' as CardDefinitionId;       // shadow-magic
const POISONOUS_DESPAIR = 'le-219' as CardDefinitionId;   // spirit-magic
// A non-magic minion card (must NOT be fetchable).
const BLACK_MACE = 'le-299' as CardDefinitionId;          // weapon item

// Minion sites + hero sites for the opposing company.
const VARIAG_CAMP = 'le-411' as CardDefinitionId;         // minion border-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;
const RIVENDELL = 'tw-404' as CardDefinitionId;

/**
 * A minion Ringwraith in the long-event phase (a general window in which
 * resource short-events may be played). `characters` seeds Akhôrahil's
 * company; `playDeck` / `discardPile` seed the fetch sources.
 */
function buildState(opts: {
  characters?: (CardDefinitionId | { defId: CardDefinitionId; followerOf?: number })[];
  playDeck?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.LongEvent,
    recompute: true,
    players: [
      {
        id: PLAYER_1, alignment: Alignment.Ringwraith,
        companies: [{ site: VARIAG_CAMP, characters: opts.characters ?? [AKHORAHIL] }],
        hand: [AKHORAHIL_UNLEASHED],
        playDeck: opts.playDeck ?? [],
        discardPile: opts.discardPile ?? [],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: [] }],
        hand: [], siteDeck: [RIVENDELL],
      },
    ],
  });
}

/** Viable play-short-event actions for Akhôrahil Unleashed. */
function playActions(state: GameState): PlayShortEventAction[] {
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => actionAs<PlayShortEventAction>(ea.action));
}

/** Fetch-from-pile offers currently open for the resource player. */
function fetchOffers(state: GameState): FetchFromPileAction[] {
  return viableActions(state, PLAYER_1, 'fetch-from-pile')
    .map(ea => actionAs<FetchFromPileAction>(ea.action));
}

describe('Akhôrahil Unleashed (le-162)', () => {
  beforeEach(() => resetMint());

  // ── Play restriction: "on Akhôrahil the Ringwraith (as your Ringwraith)" ──

  test('playable on Akhôrahil while he is the revealed Ringwraith avatar', () => {
    const state = buildState({ playDeck: [DEEPER_SHADOW] });
    const akhId = findCharInstanceId(state, RESOURCE_PLAYER, AKHORAHIL);

    const plays = playActions(state);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetCharacterId).toBe(akhId);
  });

  test('not playable when Akhôrahil is absent — a different Ringwraith avatar (name gate)', () => {
    // Khamûl is the revealed avatar; Akhôrahil is not in play. The name gate
    // rejects Khamûl, so the card is not playable on him.
    const state = buildState({ characters: [KHAMUL], playDeck: [DEEPER_SHADOW] });
    expect(playActions(state)).toHaveLength(0);
  });

  test('not playable when Akhôrahil rides as a Ringwraith follower (not the revealed avatar)', () => {
    // Khamûl is the revealed avatar; Akhôrahil is his follower. "As your
    // Ringwraith" therefore does not apply to Akhôrahil.
    const state = buildState({
      characters: [KHAMUL, { defId: AKHORAHIL, followerOf: 0 }],
      playDeck: [DEEPER_SHADOW],
    });

    // Sanity: Akhôrahil really is controlled by Khamûl (a follower).
    const akhId = findCharInstanceId(state, RESOURCE_PLAYER, AKHORAHIL);
    expect(state.players[RESOURCE_PLAYER].characters[akhId].controlledBy).not.toBe('general');

    expect(playActions(state)).toHaveLength(0);
  });

  // ── Fetch: "a magic card from your play deck or discard pile to your hand" ──

  test('fetch offers every magic card in the play deck and discard pile, excludes non-magic', () => {
    const state = buildState({
      playDeck: [DEEPER_SHADOW, BLACK_MACE],   // one magic (shadow), one non-magic
      discardPile: [POISONOUS_DESPAIR],        // one magic (spirit)
    });
    const next = resolveChain(dispatch(state, playActions(state)[0]));

    const offers = fetchOffers(next);
    // Exactly the two magic cards (deck + discard); Black Mace excluded.
    expect(offers).toHaveLength(2);

    const deckMagic = next.players[RESOURCE_PLAYER].playDeck.find(c => c.definitionId === DEEPER_SHADOW)!;
    const discardMagic = next.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === POISONOUS_DESPAIR)!;
    const blackMace = next.players[RESOURCE_PLAYER].playDeck.find(c => c.definitionId === BLACK_MACE)!;

    const offered = offers.map(a => a.cardInstanceId);
    expect(offered).toContain(deckMagic.instanceId);
    expect(offered).toContain(discardMagic.instanceId);
    expect(offered).not.toContain(blackMace.instanceId);

    // Sources are threaded correctly: the deck card is a 'deck' fetch, the
    // discard card a 'discard-pile' fetch.
    expect(offers.find(a => a.cardInstanceId === deckMagic.instanceId)!.source).toBe('deck');
    expect(offers.find(a => a.cardInstanceId === discardMagic.instanceId)!.source).toBe('discard-pile');
  });

  test('taking a magic card from the play deck moves it to hand and reshuffles the deck (searched)', () => {
    const state = buildState({ playDeck: [DEEPER_SHADOW, BLACK_MACE] });
    const eventInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const originalDeckSize = state.players[RESOURCE_PLAYER].playDeck.length;

    const afterPlay = resolveChain(dispatch(state, playActions(state)[0]));
    const deckMagicId = afterPlay.players[RESOURCE_PLAYER].playDeck.find(c => c.definitionId === DEEPER_SHADOW)!.instanceId;

    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: deckMagicId, source: 'deck',
    });

    const p = afterFetch.players[RESOURCE_PLAYER];
    // Magic card moved deck → hand.
    expect(p.hand.map(c => c.definitionId)).toContain(DEEPER_SHADOW);
    expect(p.playDeck.map(c => c.instanceId)).not.toContain(deckMagicId);
    // The play deck was searched: exactly one card removed, the rest retained
    // (no card lost when reshuffling).
    expect(p.playDeck.length).toBe(originalDeckSize - 1);
    expect(p.playDeck.map(c => c.definitionId)).toContain(BLACK_MACE);

    // Sub-flow cleared; the event lands in the discard pile.
    expect(afterFetch.pendingEffects).toHaveLength(0);
    expect(p.discardPile.map(c => c.instanceId)).toContain(eventInst);
  });

  test('taking a magic card from the discard pile moves it to hand', () => {
    const state = buildState({ discardPile: [POISONOUS_DESPAIR] });
    const eventInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const afterPlay = resolveChain(dispatch(state, playActions(state)[0]));
    const discardMagicId = afterPlay.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === POISONOUS_DESPAIR)!.instanceId;

    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: discardMagicId, source: 'discard-pile',
    });

    const p = afterFetch.players[RESOURCE_PLAYER];
    // Magic card moved discard → hand; only the spent event remains in discard.
    expect(p.hand.map(c => c.definitionId)).toContain(POISONOUS_DESPAIR);
    expect(p.discardPile.map(c => c.definitionId)).not.toContain(POISONOUS_DESPAIR);
    expect(p.discardPile.map(c => c.instanceId)).toContain(eventInst);
    expect(afterFetch.pendingEffects).toHaveLength(0);
  });

  test('"You may" — passing the fetch takes nothing, and the event still discards', () => {
    const state = buildState({ playDeck: [DEEPER_SHADOW], discardPile: [POISONOUS_DESPAIR] });
    const eventInst = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const afterPlay = resolveChain(dispatch(state, playActions(state)[0]));
    // A fetch is on offer, but the player may decline.
    expect(fetchOffers(afterPlay).length).toBeGreaterThan(0);

    const afterPass = dispatch(afterPlay, { type: 'pass', player: PLAYER_1 });

    const p = afterPass.players[RESOURCE_PLAYER];
    // Nothing taken: the magic cards stay where they were.
    expect(p.hand.map(c => c.definitionId)).not.toContain(DEEPER_SHADOW);
    expect(p.hand.map(c => c.definitionId)).not.toContain(POISONOUS_DESPAIR);
    expect(p.playDeck.map(c => c.definitionId)).toContain(DEEPER_SHADOW);
    // Sub-flow cleared; the event still lands in the discard pile.
    expect(afterPass.pendingEffects).toHaveLength(0);
    expect(p.discardPile.map(c => c.instanceId)).toContain(eventInst);
  });

  test('only one card may be taken (count 1) — the sub-flow ends after a single fetch', () => {
    const state = buildState({ playDeck: [DEEPER_SHADOW], discardPile: [POISONOUS_DESPAIR] });

    const afterPlay = resolveChain(dispatch(state, playActions(state)[0]));
    const deckMagicId = afterPlay.players[RESOURCE_PLAYER].playDeck.find(c => c.definitionId === DEEPER_SHADOW)!.instanceId;

    const afterFetch = dispatch(afterPlay, {
      type: 'fetch-from-pile', player: PLAYER_1, cardInstanceId: deckMagicId, source: 'deck',
    });

    // After a single pick the sub-flow closes even though a second magic card
    // (the one in the discard pile) is still present.
    expect(afterFetch.pendingEffects).toHaveLength(0);
    expect(fetchOffers(afterFetch)).toHaveLength(0);
    expect(afterFetch.players[RESOURCE_PLAYER].discardPile.map(c => c.definitionId)).toContain(POISONOUS_DESPAIR);
  });
});
