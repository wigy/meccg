/**
 * @module wh-9.test
 *
 * Card test: Saruman (wh-9)
 * Type: hero-character (Fallen-wizard avatar)
 *
 * Printed text:
 *   "Unique. Can use sorcery. Your non-weapon/non-armor/non-shield/non-helmet
 *    items are each worth full marshalling points. May tap to use a Palantír he
 *    bears. -1 to all corruption checks. At the beginning of your end-of-turn
 *    phase, you may tap Saruman to take one spell or sorcery card from your
 *    discard pile to your hand."
 *
 * Card shape (data):
 *   - Unique / Fallen-wizard avatar; `skills` includes `sorcery` ("Can use
 *     sorcery" — structural, consumed by the engine's spell-playability checks).
 *   - effects:
 *     1. check-modifier (corruption, -1) — "-1 to all corruption checks".
 *        Collected for every corruption check Saruman makes (matches the
 *        certified Gandalf tw-156 pattern for a wizard's personal modifier).
 *     2. play-flag can-use-palantir — "May tap to use a Palantír he bears"
 *        (same modelling as Calendal le-4, which has the identical printed
 *        clause). Makes `bearer.canUsePalantir` true so any Palantír Saruman
 *        bears offers its grant-action.
 *     3. fw-mp-full (cards: items) (filter: not weapon/armor/shield/helmet) — exempts
 *        Saruman-player items from the MEWH §4 1-MP clamp so non-combat items
 *        score their full printed MP.
 *     4. grant-action saruman-fetch-spell — end-of-turn: tap Saruman, move one
 *        card keyworded "spell" or "sorcery" from the discard pile to hand.
 *
 * These tests drive the reducer / legal-action / recompute pipeline; the card
 * shape itself is documented above rather than asserted against the JSON.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  viableActions, dispatch,
  charIdAt, getCharacter,
  RESOURCE_PLAYER,
  GLAMDRING, WIZARDS_LAUGHTER, ARAGORN, LEGOLAS,
  ISENGARD, RIVENDELL, LORIEN, MORIA,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import { enqueueResolution } from '../../engine/pending.js';
import { computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, ActivateGrantedAction, CorruptionCheckAction,
} from '../../index.js';

// ─── Local card-ID constants ───────────────────────────────────────────────
const SARUMAN_FW     = 'wh-9'   as CardDefinitionId; // Fallen-wizard Saruman
const ITHIL_STONE    = 'as-69'  as CardDefinitionId; // non-combat item, MP 5, no keywords
const PALANTIR_ORTHANC = 'tw-300' as CardDefinitionId; // hero Palantír with a grant-action
const TORMENTED_EARTH = 'as-102' as CardDefinitionId; // carries the "sorcery" keyword

describe('Saruman (wh-9)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: non-combat items worth full MP (MEWH §4 exception) ────────────

  test('non-combat item scores full printed MP; weapon stays clamped to 1', () => {
    // Saruman (Fallen-wizard avatar) bears Glamdring (weapon, 2 MP) and
    // The Ithil-stone (non-combat, 5 MP). MEWH §4 clamps the weapon to 1, but
    // Saruman's exemption gives the non-combat item its full 5 MP.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [{ defId: SARUMAN_FW, items: [GLAMDRING, ITHIL_STONE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    // weapon clamped to 1 + non-combat full 5 = 6
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(6);
  });

  test('exemption is player-wide: non-combat item on a non-Saruman character still scores full MP', () => {
    // "Your ... items" — the exemption applies to every item the Fallen-wizard
    // player controls while Saruman is in play, not only items on Saruman.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW, { defId: ARAGORN, items: [ITHIL_STONE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    // Ithil-stone (on Aragorn) scores its full 5 MP because Saruman is in play.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(5);
  });

  test('without Saruman, the same items are both clamped to 1 (control)', () => {
    // A Fallen-wizard company that does NOT contain Saruman: the exemption is
    // not active, so both items fall under the MEWH §4 1-MP clamp.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [{ defId: ARAGORN, items: [GLAMDRING, ITHIL_STONE] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    // Both items clamped to 1 → item total 2.
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(2);
  });

  // ─── Rule: -1 to all corruption checks ───────────────────────────────────

  test('Saruman applies -1 to his corruption checks', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const sarumanId = charIdAt(base, RESOURCE_PLAYER, 0, 0);

    const withCheck = enqueueResolution(base, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: {
        type: 'corruption-check',
        characterId: sarumanId,
        modifier: 0,
        reason: 'test',
        possessions: [],
        transferredItemId: null,
      },
    });

    const actions = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.action.type === 'corruption-check')
      .map(ea => ea.action as CorruptionCheckAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].corruptionModifier).toBe(-1);
  });

  // ─── Rule: may tap to use a Palantír he bears ────────────────────────────

  test('Palantír grant-action offered when Saruman bears the Palantír', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [{ defId: SARUMAN_FW, items: [PALANTIR_ORTHANC] }] }],
          hand: [],
          // Palantír of Orthanc requires 5+ cards in the play deck.
          playDeck: [GLAMDRING, ITHIL_STONE, WIZARDS_LAUGHTER, TORMENTED_EARTH, MORIA],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantir = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard',
    );
    expect(palantir).toHaveLength(1);
  });

  test('Palantír grant-action NOT offered to a bearer that cannot use a Palantír', () => {
    // Aragorn has no can-use-palantir flag, and the Palantír item does not grant
    // it — so bearer.canUsePalantir is false and the ability is not offered.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [{ defId: ARAGORN, items: [PALANTIR_ORTHANC] }] }],
          hand: [],
          playDeck: [GLAMDRING, ITHIL_STONE, WIZARDS_LAUGHTER, TORMENTED_EARTH, MORIA],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const palantir = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-fetch-discard',
    );
    expect(palantir).toHaveLength(0);
  });

  // ─── Rule: end-of-turn spell/sorcery fetch ───────────────────────────────

  test('end-of-turn fetch offers one action per spell/sorcery card, not other cards', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW] }],
          hand: [],
          // spell + sorcery should be eligible; Glamdring (weapon) is not.
          discardPile: [WIZARDS_LAUGHTER, TORMENTED_EARTH, GLAMDRING],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const fetch = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'saruman-fetch-spell',
    );
    expect(fetch).toHaveLength(2);

    const targetedDefIds = fetch.map(ea => {
      const tid = (ea.action as ActivateGrantedAction).targetCardId!;
      return state.players[RESOURCE_PLAYER].discardPile.find(c => c.instanceId === tid)!.definitionId;
    });
    expect(targetedDefIds).toContain(WIZARDS_LAUGHTER);
    expect(targetedDefIds).toContain(TORMENTED_EARTH);
    expect(targetedDefIds).not.toContain(GLAMDRING);
  });

  test('activating the fetch taps Saruman and moves the card from discard to hand (no corruption check)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });
    const spellInstanceId = state.players[RESOURCE_PLAYER].discardPile[0].instanceId;

    const fetch = viableActions(state, PLAYER_1, 'activate-granted-action').find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'saruman-fetch-spell',
    )!;
    expect(fetch).toBeDefined();

    const after = dispatch(state, fetch.action);

    // Saruman is tapped.
    expect(getCharacter(after, RESOURCE_PLAYER, SARUMAN_FW).status).toBe(CardStatus.Tapped);
    // Spell moved discard → hand.
    expect(after.players[RESOURCE_PLAYER].discardPile).toHaveLength(0);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(after.players[RESOURCE_PLAYER].hand[0].instanceId).toBe(spellInstanceId);
    expect(after.players[RESOURCE_PLAYER].hand[0].definitionId).toBe(WIZARDS_LAUGHTER);
    // Saruman's fetch does NOT enqueue a corruption check (unlike Wizard's Staff).
    expect(after.pendingResolutions).toHaveLength(0);
  });

  test('end-of-turn fetch NOT offered when Saruman is tapped', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [{ defId: SARUMAN_FW, status: CardStatus.Tapped }] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    const fetch = viableActions(state, PLAYER_1, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'saruman-fetch-spell',
    );
    expect(fetch).toHaveLength(0);
  });

  test('end-of-turn fetch NOT offered to the non-active player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.EndOfTurn,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        {
          id: PLAYER_2,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW] }],
          hand: [],
          discardPile: [WIZARDS_LAUGHTER],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const fetch = viableActions(state, PLAYER_2, 'activate-granted-action').filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'saruman-fetch-spell',
    );
    expect(fetch).toHaveLength(0);
  });
});
