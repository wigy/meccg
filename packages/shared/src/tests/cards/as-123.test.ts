/**
 * @module as-123.test
 *
 * Card test: Dwarven Ring of Thélor's Tribe (as-123)
 * Type: minion-resource-item (unique, subtype: special)
 * Alignment: ringwraith
 * Keywords: ring, dwarven-ring
 * Corruption: 3 base, 5 for Dwarf bearer
 *
 * "Unique. Dwarven Ring. Playable only with a gold ring and after a test
 *  indicates a Dwarven Ring. Values in parentheses apply to a Dwarf bearer.
 *  Tap a Dwarf bearer to search your play deck and/or your discard pile
 *  for any one or two minor items; place these items in your hand and
 *  reshuffle your play deck. Bearer then makes a corruption check modified by +2."
 *
 * Engine support:
 * | # | Rule                                                    | Status      | Notes                                             |
 * |---|---------------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Unique; keyword dwarven-ring (ring-play-offer system)   | IMPLEMENTED | unique:true + keyword; ring-play-offer mechanic   |
 * | 2 | Corruption points 3 base, 5 for Dwarf bearer            | IMPLEMENTED | stat-modifier effect when bearer.race=dwarf       |
 * | 3 | Tap Dwarf bearer: fetch 1-2 minor items to hand         | IMPLEMENTED | grant-action recall-to-hand + enqueue-pending-fetch fetchTo:hand |
 * | 4 | Can fetch from deck and/or discard pile                 | IMPLEMENTED | fetchFrom: ["deck","discard-pile"]                |
 * | 5 | Play deck reshuffled after deck search                  | IMPLEMENTED | handleFetchFromPile reshuffle on deck source      |
 * | 6 | Tap ability only for Dwarf bearer                       | IMPLEMENTED | when: { bearer.race: "dwarf" }                   |
 * | 7 | Bearer makes corruption check modified by +2 after fetch | IMPLEMENTED | postCorruptionCheck + postCorruptionCheckModifier:2 |
 *
 * Fixture alignment: minion (ringwraith)
 *
 * Character fixtures:
 *   - DROR  (dm-6):  dwarf, warrior+diplomat — Dwarf bearer for ability tests
 *   - GORBAG(le-11): orc, warrior+scout      — non-Dwarf bearer (ability must not fire)
 *
 * Site fixtures:
 *   - DOL_GULDUR (le-367): minion haven (darkhaven) — organization phase base
 *   - ETTENMOORS (le-373): ruins-and-lairs, minor items playable — secondary site
 *
 * Item fixtures (minor):
 *   - OLD_TREASURE    (as-129): minion minor item
 *   - SAW_TOOTHED_BLADE(le-342): minion minor item
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  Phase, Alignment,
  buildTestState, resetMint,
  attachItemToChar,
  viableActions, dispatch,
  findCharInstanceId,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { ActivateGrantedAction } from '../../types/actions-organization.js';
import type { FetchFromPileAction } from '../../types/actions-short-event.js';

// ── Card under test ──────────────────────────────────────────────────────────
const DWARVEN_RING = 'as-123' as CardDefinitionId;

// ── Minion Dwarf characters ──────────────────────────────────────────────────
const DROR = 'dm-6' as CardDefinitionId;   // dwarf, warrior+diplomat

// ── Non-Dwarf minion character ───────────────────────────────────────────────
const GORBAG = 'le-11' as CardDefinitionId; // orc, warrior+scout

// ── Sites ────────────────────────────────────────────────────────────────────
const DOL_GULDUR = 'le-367' as CardDefinitionId;  // minion haven
const ETTENMOORS = 'le-373' as CardDefinitionId;  // ruins-and-lairs, minor items

// ── Minor item fixtures ──────────────────────────────────────────────────────
const OLD_TREASURE = 'as-129' as CardDefinitionId;      // minion minor item
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId; // minion minor item

/** Build an organization phase state for a minion (ringwraith) company. */
function buildMinionOrgPhase(opts: {
  characters: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
  playDeck?: CardDefinitionId[];
  hand?: CardDefinitionId[];
}): ReturnType<typeof buildTestState> {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: opts.characters }],
        hand: opts.hand ?? [],
        siteDeck: [ETTENMOORS],
        discardPile: opts.discardPile ?? [],
        playDeck: opts.playDeck ?? [],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
        hand: [],
        siteDeck: [ETTENMOORS],
      },
    ],
  });
}

describe('Dwarven Ring of Thélor\'s Tribe (as-123)', () => {
  beforeEach(() => resetMint());

  // ── Rule 2: Corruption points — base 3, Dwarf bearer 5 ───────────────────

  test('base corruption points are 3 for a non-Dwarf bearer', () => {
    const base = buildMinionOrgPhase({ characters: [GORBAG] });
    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, GORBAG, DWARVEN_RING));
    const gorbagId = findCharInstanceId(withRing, RESOURCE_PLAYER, GORBAG);
    const char = withRing.players[RESOURCE_PLAYER].characters[gorbagId as string];
    expect(char.effectiveStats.corruptionPoints).toBe(3);
  });

  test('corruption points are 5 for a Dwarf bearer (parenthetical value applies)', () => {
    const base = buildMinionOrgPhase({ characters: [DROR] });
    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING));
    const drorId = findCharInstanceId(withRing, RESOURCE_PLAYER, DROR);
    const char = withRing.players[RESOURCE_PLAYER].characters[drorId as string];
    // 3 base + 2 (Dwarf bonus from stat-modifier effect) = 5
    expect(char.effectiveStats.corruptionPoints).toBe(5);
  });

  // ── Rule 6: Tap ability only available for Dwarf bearer ───────────────────

  test('tap ability (recall-to-hand) is NOT offered when bearer is not a Dwarf', () => {
    const base = buildMinionOrgPhase({
      characters: [GORBAG],
      discardPile: [OLD_TREASURE],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivations = activations.filter(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    expect(ringActivations).toHaveLength(0);
  });

  test('tap ability (recall-to-hand) IS offered when bearer is a Dwarf', () => {
    const base = buildMinionOrgPhase({
      characters: [DROR],
      discardPile: [OLD_TREASURE],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivations = activations.filter(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    expect(ringActivations).toHaveLength(1);
  });

  // ── Rule 3: Activating taps the bearer ────────────────────────────────────

  test('activating the ability taps the Dwarf bearer', () => {
    const base = buildMinionOrgPhase({
      characters: [DROR],
      discardPile: [OLD_TREASURE],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivation = activations.find(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    expect(ringActivation).toBeDefined();

    const afterActivation = dispatch(withRing, ringActivation!.action);

    const drorId = findCharInstanceId(afterActivation, RESOURCE_PLAYER, DROR);
    const char = afterActivation.players[RESOURCE_PLAYER].characters[drorId as string];
    expect(char.status).toBe('tapped');
  });

  // ── Rule 4: Minor items from discard pile are offered as fetch candidates ─

  test('minor items in discard pile are offered as fetch-from-pile candidates', () => {
    const base = buildMinionOrgPhase({
      characters: [DROR],
      discardPile: [OLD_TREASURE, SAW_TOOTHED_BLADE],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivation = activations.find(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    const afterActivation = dispatch(withRing, ringActivation!.action);

    const fetches = viableActions(afterActivation, PLAYER_1, 'fetch-from-pile');
    const discardFetches = fetches.filter(a =>
      (a.action as FetchFromPileAction).source === 'discard-pile',
    );
    // Two minor items in discard pile → two fetch actions
    expect(discardFetches).toHaveLength(2);
  });

  test('minor items in deck are offered as fetch-from-pile candidates', () => {
    const base = buildMinionOrgPhase({
      characters: [DROR],
      playDeck: [OLD_TREASURE],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivation = activations.find(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    const afterActivation = dispatch(withRing, ringActivation!.action);

    const fetches = viableActions(afterActivation, PLAYER_1, 'fetch-from-pile');
    const deckFetches = fetches.filter(a =>
      (a.action as FetchFromPileAction).source === 'deck',
    );
    expect(deckFetches).toHaveLength(1);
  });

  test('non-minor items are NOT offered as fetch candidates', () => {
    // SAW_TOOTHED_BLADE is minor; a special item should not appear
    const base = buildMinionOrgPhase({
      characters: [DROR],
      discardPile: [DWARVEN_RING], // special subtype — should not be offered
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivation = activations.find(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    const afterActivation = dispatch(withRing, ringActivation!.action);

    const fetches = viableActions(afterActivation, PLAYER_1, 'fetch-from-pile');
    // The extra DWARVEN_RING in discard is special, not minor — must be excluded
    const discardFetches = fetches.filter(a =>
      (a.action as FetchFromPileAction).source === 'discard-pile',
    );
    expect(discardFetches).toHaveLength(0);
  });

  // ── Rule 4+5: Fetched cards go to hand; deck is reshuffled ───────────────

  test('fetching from discard places card in hand and removes it from discard', () => {
    const base = buildMinionOrgPhase({
      characters: [DROR],
      discardPile: [OLD_TREASURE],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivation = activations.find(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    const afterActivation = dispatch(withRing, ringActivation!.action);

    const fetches = viableActions(afterActivation, PLAYER_1, 'fetch-from-pile');
    const afterFetch = dispatch(afterActivation, fetches[0].action);

    // Card is now in hand
    const hand = afterFetch.players[RESOURCE_PLAYER].hand;
    expect(hand.some(c => c.definitionId === OLD_TREASURE)).toBe(true);

    // Card is no longer in discard pile
    const discard = afterFetch.players[RESOURCE_PLAYER].discardPile;
    expect(discard.some(c => c.definitionId === OLD_TREASURE)).toBe(false);
  });

  test('fetching from deck places card in hand and reshuffles deck', () => {
    const base = buildMinionOrgPhase({
      characters: [DROR],
      playDeck: [OLD_TREASURE, SAW_TOOTHED_BLADE],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivation = activations.find(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    const afterActivation = dispatch(withRing, ringActivation!.action);

    const fetches = viableActions(afterActivation, PLAYER_1, 'fetch-from-pile');
    const deckFetch = fetches.find(a => (a.action as FetchFromPileAction).source === 'deck');
    expect(deckFetch).toBeDefined();

    const afterFetch = dispatch(afterActivation, deckFetch!.action);

    // Fetched card is in hand
    const hand = afterFetch.players[RESOURCE_PLAYER].hand;
    expect(hand.some(c => c.definitionId === OLD_TREASURE || c.definitionId === SAW_TOOTHED_BLADE)).toBe(true);

    // Deck contains the remaining card (was reshuffled)
    const deck = afterFetch.players[RESOURCE_PLAYER].playDeck;
    expect(deck).toHaveLength(1);
  });

  // ── Rule 3 (count): Up to 2 items can be fetched ─────────────────────────

  test('second fetch-from-pile is offered after first pick (up to 2 minor items)', () => {
    const base = buildMinionOrgPhase({
      characters: [DROR],
      discardPile: [OLD_TREASURE, SAW_TOOTHED_BLADE],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivation = activations.find(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    const afterActivation = dispatch(withRing, ringActivation!.action);

    const firstFetches = viableActions(afterActivation, PLAYER_1, 'fetch-from-pile');
    expect(firstFetches.length).toBeGreaterThanOrEqual(1);

    const afterFirstFetch = dispatch(afterActivation, firstFetches[0].action);

    // Second pick: still one minor item in discard
    const secondFetches = viableActions(afterFirstFetch, PLAYER_1, 'fetch-from-pile');
    expect(secondFetches.length).toBeGreaterThanOrEqual(1);
  });

  test('player can pass after first pick (not required to take second item)', () => {
    const base = buildMinionOrgPhase({
      characters: [DROR],
      discardPile: [OLD_TREASURE, SAW_TOOTHED_BLADE],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivation = activations.find(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    const afterActivation = dispatch(withRing, ringActivation!.action);

    const firstFetches = viableActions(afterActivation, PLAYER_1, 'fetch-from-pile');
    const afterFirstFetch = dispatch(afterActivation, firstFetches[0].action);

    // Pass is offered alongside the second fetch
    const passes = viableActions(afterFirstFetch, PLAYER_1, 'pass');
    expect(passes).toHaveLength(1);
  });

  // ── Rule 7: Corruption check +2 after fetch completes ───────────────────

  test('corruption check with +2 modifier is enqueued after all fetches complete', () => {
    const base = buildMinionOrgPhase({
      characters: [DROR],
      discardPile: [OLD_TREASURE],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivation = activations.find(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    const afterActivation = dispatch(withRing, ringActivation!.action);

    // Take the one available fetch
    const fetches = viableActions(afterActivation, PLAYER_1, 'fetch-from-pile');
    const afterFetch = dispatch(afterActivation, fetches[0].action);

    // Now pass to complete the second pick slot
    const passes = viableActions(afterFetch, PLAYER_1, 'pass');
    const afterPass = dispatch(afterFetch, passes[0].action);

    // Corruption check should be pending for the Dwarf bearer
    const pending = afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const corruptionCheck = pending.find(r => r.kind.type === 'corruption-check');
    expect(corruptionCheck).toBeDefined();
    // Modifier should be +2 (roll bonus)
    if (corruptionCheck?.kind.type === 'corruption-check') {
      expect(corruptionCheck.kind.modifier).toBe(2);
    }
  });

  test('corruption check is also enqueued when player passes without fetching any item', () => {
    const base = buildMinionOrgPhase({
      characters: [DROR],
      discardPile: [OLD_TREASURE],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activations = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActivation = activations.find(a =>
      (a.action as ActivateGrantedAction).actionId === 'recall-to-hand',
    );
    const afterActivation = dispatch(withRing, ringActivation!.action);

    // Pass both fetch slots without taking any cards
    const passes1 = viableActions(afterActivation, PLAYER_1, 'pass');
    const afterPass1 = dispatch(afterActivation, passes1[0].action);

    // Check if corruption check is already pending, or pass again
    const pending1 = afterPass1.pendingResolutions.filter(r => r.actor === PLAYER_1);
    if (pending1.length === 0) {
      const passes2 = viableActions(afterPass1, PLAYER_1, 'pass');
      const afterPass2 = dispatch(afterPass1, passes2[0].action);
      const pending2 = afterPass2.pendingResolutions.filter(r => r.actor === PLAYER_1);
      const check = pending2.find(r => r.kind.type === 'corruption-check');
      expect(check).toBeDefined();
    } else {
      const check = pending1.find(r => r.kind.type === 'corruption-check');
      expect(check).toBeDefined();
    }
  });
});
