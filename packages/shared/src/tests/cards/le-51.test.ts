/**
 * @module le-51.test
 *
 * Card test: Akhôrahil the Ringwraith (le-51)
 * Type: minion-character (Ringwraith avatar), alignment ringwraith, unique.
 * Base stats: prowess 8, body 9, direct influence 3, mind null (avatar).
 * Skills: sage, sorcery, spirit-magic, shadow-magic ("Can use sorcery,
 * spirit-magic, and shadow-magic").
 *
 * Card text:
 *   "Unique. Manifestation of Akhôrahil. Can use sorcery, spirit-magic, and
 *    shadow-magic. +3 direct influence in Heralded Lord mode. +1 prowess in
 *    Fell Rider mode. As your Ringwraith, when a magic card used by him has to
 *    be discarded, return it to the play deck and reshuffle."
 *
 * Distinct rules:
 *   1. +3 direct influence in Heralded Lord mode — a `stat-modifier`
 *      (direct-influence +3) gated on `bearer.ringwraithMode === heralded-lord`.
 *   2. +1 prowess in Fell Rider mode — a `stat-modifier` (prowess +1) gated on
 *      `bearer.ringwraithMode === fell-rider`. The mode is established by a mode
 *      card (Heralded Lord le-190 / Fell Rider le-183) bound to the company;
 *      the avatar's per-mode change flows into `effectiveStats`.
 *   3. Magic-recycling passive — a `magic-discard-to-deck` flag. While Akhôrahil
 *      is a player's revealed Ringwraith, any magic card (a card with a
 *      `spell` / `sorcery` / `spirit-magic` / `shadow-magic` keyword) the player
 *      casts is shuffled back into their play deck (and the deck reshuffled)
 *      when it would otherwise be discarded, rather than going to the discard
 *      pile. Implemented by `discardOrRecyclePlayedEvent` (reducer-utils.ts),
 *      which is wired into every point a just-played magic event lands in the
 *      caster's discard pile: the resource short-event fall-through
 *      (reducer-events.ts), the cancel-attack discard (combat-cancel.ts), and
 *      the cancel-influence discard (pending-reducers.ts).
 *
 * "Manifestation of Akhôrahil" / "Unique" are structural: uniqueness is the
 * 1-per-deck rule (`unique: true`) and the avatar-selection system; the
 * manifestation clause links le-51 to Akhôrahil Unleashed (le-162) and needs
 * no engine primitive (matching every certified Ringwraith sibling).
 *
 * Rule coverage:
 * | # | Rule                                                              | Status      |
 * |---|-------------------------------------------------------------------|-------------|
 * | 1 | Base stats (no mode): DI 3, prowess 8                              | IMPLEMENTED |
 * | 2 | +3 direct influence in Heralded Lord mode (prowess unchanged)      | IMPLEMENTED |
 * | 3 | +1 prowess in Fell Rider mode (direct influence unchanged)         | IMPLEMENTED |
 * | 4 | Casting a magic short event recycles it to the play deck (reshuffle)| IMPLEMENTED |
 * | 5 | The recycled magic card is NOT in the discard pile                 | IMPLEMENTED |
 * | 6 | Same magic card under a non-Akhôrahil avatar (Adûnaphel) discards   | IMPLEMENTED |
 * | 7 | A magic cancel-attack (as-102) recycles via the combat-cancel path  | IMPLEMENTED |
 * | 8 | A non-magic cancel-attack (le-216) still discards normally          | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   AKHORAHIL (le-51)     - this card; sorcery + spirit-magic + shadow-magic user
 *   WORDS (le-258)        - spirit-magic short event (recycled when cast)
 *   TORMENTED_EARTH (as-102) - sorcery cancel-attack magic card
 *   ORC_QUARRELS (le-216) - non-magic cancel-attack (vs orc), the control
 *   ADUNAPHEL (le-50)     - spirit-magic Ringwraith avatar WITHOUT the passive
 *   HERALDED_LORD (le-190) / FELL_RIDER (le-183) - Ringwraith mode cards
 *   VARIAG_CAMP (le-411)  - minion border-hold (company site; not a haven)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch,
  getCharacter, findHandCardId, viableActions,
  addCardInPlay, companyIdAt, recomputeDerived,
  expectInPile, expectNotInPile,
  makeCancelWindowCombat, LORIEN, MINAS_TIRITH,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, Phase,
} from '../test-helpers.js';
import { Alignment, Race } from '../../index.js';
import type { CardDefinitionId, CancelAttackAction, PlayShortEventAction, GameState } from '../../index.js';

const AKHORAHIL = 'le-51' as CardDefinitionId;
const WORDS = 'le-258' as CardDefinitionId;
const TORMENTED_EARTH = 'as-102' as CardDefinitionId;
const ORC_QUARRELS = 'le-216' as CardDefinitionId;
const ADUNAPHEL = 'le-50' as CardDefinitionId;
const HERALDED_LORD = 'le-190' as CardDefinitionId;
const FELL_RIDER = 'le-183' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
// Arbitrary filler cards to give the play deck non-zero size (any defs work).
const FILLER_A = 'le-11' as CardDefinitionId;
const FILLER_B = 'le-14' as CardDefinitionId;

/** Org-phase state: PLAYER_1 (ringwraith) with `avatar` + hand + play deck. */
function orgState(avatar: CardDefinitionId, hand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: VARIAG_CAMP, characters: [avatar] }],
        hand,
        playDeck: [FILLER_A, FILLER_B],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: [] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

/** Combat state: PLAYER_1 (ringwraith) with Akhôrahil facing an orc attack. */
function cancelWindow(hand: CardDefinitionId[]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: VARIAG_CAMP, characters: [AKHORAHIL] }],
        hand,
        playDeck: [FILLER_A, FILLER_B],
        siteDeck: [MINAS_TIRITH],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return makeCancelWindowCombat(base, { creatureRace: Race.Orc });
}

describe('Akhôrahil the Ringwraith (le-51)', () => {
  beforeEach(() => resetMint());

  // ── Per-mode stat changes ────────────────────────────────────────────────

  test('base stats with no mode card: prowess 8, direct influence 3', () => {
    const state = orgState(AKHORAHIL, []);
    const akh = getCharacter(state, RESOURCE_PLAYER, AKHORAHIL);
    expect(akh.effectiveStats.prowess).toBe(8);
    expect(akh.effectiveStats.directInfluence).toBe(3);
  });

  test('+3 direct influence in Heralded Lord mode (prowess unchanged)', () => {
    let state = orgState(AKHORAHIL, []);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, HERALDED_LORD, companyId);
    state = recomputeDerived(state);

    const akh = getCharacter(state, RESOURCE_PLAYER, AKHORAHIL);
    expect(akh.effectiveStats.directInfluence).toBe(6); // 3 + 3
    expect(akh.effectiveStats.prowess).toBe(8); // Fell Rider bonus does not apply
  });

  test('+1 prowess in Fell Rider mode (direct influence unchanged)', () => {
    let state = orgState(AKHORAHIL, []);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    state = addCardInPlay(state, RESOURCE_PLAYER, FELL_RIDER, companyId);
    state = recomputeDerived(state);

    const akh = getCharacter(state, RESOURCE_PLAYER, AKHORAHIL);
    expect(akh.effectiveStats.prowess).toBe(9); // 8 + 1
    expect(akh.effectiveStats.directInfluence).toBe(3); // Heralded Lord bonus does not apply
  });

  // ── Magic-recycling passive: resource short-event path ───────────────────

  test('casting a magic short event returns it to the play deck (reshuffled), not the discard pile', () => {
    const state = orgState(AKHORAHIL, [WORDS]);
    const akhId = getCharacter(state, RESOURCE_PLAYER, AKHORAHIL).instanceId;
    const inst = findHandCardId(state, RESOURCE_PLAYER, WORDS);
    const deckBefore = state.players[RESOURCE_PLAYER].playDeck.length;

    const action: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: inst,
      targetCharacterId: akhId,
    };
    const after = dispatch(state, action);

    // Recycled into the play deck rather than discarded.
    expectInPile(after, RESOURCE_PLAYER, 'playDeck', inst);
    expectNotInPile(after, RESOURCE_PLAYER, 'discardPile', inst);
    expect(after.players[RESOURCE_PLAYER].playDeck.length).toBe(deckBefore + 1);
    // No longer in hand.
    expectNotInPile(after, RESOURCE_PLAYER, 'hand', inst);
  });

  test('the same magic card discards normally under a non-Akhôrahil Ringwraith (Adûnaphel)', () => {
    const state = orgState(ADUNAPHEL, [WORDS]);
    const adunId = getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).instanceId;
    const inst = findHandCardId(state, RESOURCE_PLAYER, WORDS);

    const action: PlayShortEventAction = {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: inst,
      targetCharacterId: adunId,
    };
    const after = dispatch(state, action);

    // Adûnaphel carries no magic-discard-to-deck passive → normal discard.
    expectInPile(after, RESOURCE_PLAYER, 'discardPile', inst);
    expectNotInPile(after, RESOURCE_PLAYER, 'playDeck', inst);
  });

  // ── Magic-recycling passive: cancel-attack path + magic-only scoping ─────

  test('a magic cancel-attack (The Tormented Earth) is recycled to the play deck', () => {
    const state = cancelWindow([TORMENTED_EARTH]);
    const inst = findHandCardId(state, RESOURCE_PLAYER, TORMENTED_EARTH);
    const deckBefore = state.players[RESOURCE_PLAYER].playDeck.length;

    const cancelAction = viableActions(state, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction)
      .find(a => (a.mode ?? 'cancel') === 'cancel');
    expect(cancelAction).toBeDefined();

    const after = dispatch(state, cancelAction!);

    // Sorcery magic card → recycled to deck instead of discarded.
    expectInPile(after, RESOURCE_PLAYER, 'playDeck', inst);
    expectNotInPile(after, RESOURCE_PLAYER, 'discardPile', inst);
    expect(after.players[RESOURCE_PLAYER].playDeck.length).toBe(deckBefore + 1);
    // Akhôrahil is a Ringwraith → exempt from the -4 corruption check cost.
    expect(after.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  test('a non-magic cancel-attack (Orc Quarrels) still discards normally under Akhôrahil', () => {
    const state = cancelWindow([ORC_QUARRELS]);
    const inst = findHandCardId(state, RESOURCE_PLAYER, ORC_QUARRELS);

    const cancelAction = viableActions(state, PLAYER_1, 'cancel-attack')
      .map(ea => ea.action as CancelAttackAction)
      .find(a => (a.mode ?? 'cancel') === 'cancel');
    expect(cancelAction).toBeDefined();

    const after = dispatch(state, cancelAction!);

    // No magic keyword → the passive does not apply; card goes to discard.
    expectInPile(after, RESOURCE_PLAYER, 'discardPile', inst);
    expectNotInPile(after, RESOURCE_PLAYER, 'playDeck', inst);
  });
});
