/**
 * @module tw-299.test
 *
 * Card test: Palantír of Minas Tirith (tw-299)
 * Type: hero-resource-item (special, unique) — hero counterpart of le-333.
 * MP: 2; Corruption: 2; keyword: palantir.
 *
 * "Unique. Palantír. Playable only at Minas Tirith. With its bearer able to use
 *  a Palantír, tap Palantír of Minas Tirith to look at the top five cards of
 *  your play deck; shuffle these 5 cards and return them to the top of your
 *  play deck. Do the same to your opponent's play deck. Bearer makes a
 *  corruption check."
 *
 * Engine Support:
 * | # | Feature                               | Status      | Notes                                           |
 * |---|---------------------------------------|-------------|-------------------------------------------------|
 * | 1 | Playable only at Minas Tirith         | IMPLEMENTED | item-play-site restricts to site by name        |
 * | 2 | Tap ability: shuffle top 5 own deck   | IMPLEMENTED | grant-action palantir-peek-shuffle, shuffle-deck-top apply |
 * | 3 | Tap ability: shuffle top 5 opp deck   | IMPLEMENTED | shuffle-deck-top with toOwner: "opponent"       |
 * | 4 | Corruption check after tap            | IMPLEMENTED | enqueue-corruption-check in sequence apply      |
 * | 5 | Condition: bearer can use Palantír    | IMPLEMENTED | when: { bearer.canUsePalantir: true }           |
 *
 * Fixture alignment: hero-resource-item (wizard); site-play tests use hero
 * sites (TW). Grant-action tests use Saruman (tw-181) as the bearer — a hero
 * character with a native `can-use-palantir` play-flag.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  viableActions, dispatch,
  RESOURCE_PLAYER,
  CardStatus,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, ActivateGrantedAction } from '../../index.js';

// ─── Local card-ID constants ───────────────────────────────────────────────
const PALANTIR_MINAS_TIRITH = 'tw-299' as CardDefinitionId;
const SARUMAN               = 'tw-181' as CardDefinitionId; // hero wizard with can-use-palantir
const ARAGORN               = 'tw-120' as CardDefinitionId; // hero character (no palantir ability)
const LEGOLAS               = 'tw-168' as CardDefinitionId; // hero character
const MINAS_TIRITH_HERO     = 'tw-412' as CardDefinitionId; // free-hold
const RIVENDELL             = 'tw-421' as CardDefinitionId; // haven
const MORIA_HERO            = 'tw-413' as CardDefinitionId; // shadow-hold

// ─── Item-play-site effect ─────────────────────────────────────────────────

describe('Palantír of Minas Tirith (tw-299)', () => {
  beforeEach(() => resetMint());

  test('playable at Minas Tirith (tw-412) during site phase', () => {
    const state = buildSitePhaseState({
      site: MINAS_TIRITH_HERO,
      hand: [PALANTIR_MINAS_TIRITH],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('NOT playable at Rivendell (haven, not Minas Tirith)', () => {
    const state = buildSitePhaseState({
      site: RIVENDELL,
      hand: [PALANTIR_MINAS_TIRITH],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at Moria (shadow-hold, not Minas Tirith)', () => {
    const state = buildSitePhaseState({
      site: MORIA_HERO,
      hand: [PALANTIR_MINAS_TIRITH],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('unique: second copy not playable when one already attached', () => {
    const state = buildSitePhaseState({
      site: MINAS_TIRITH_HERO,
      characters: [{ defId: ARAGORN, items: [PALANTIR_MINAS_TIRITH] }],
      hand: [PALANTIR_MINAS_TIRITH],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Grant-action: bearer condition ──────────────────────────────────────

  test('palantir-peek-shuffle NOT offered when bearer cannot use a Palantír', () => {
    // Aragorn has no can-use-palantir flag; no Align Palantír attached
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH_HERO, characters: [{ defId: ARAGORN, items: [PALANTIR_MINAS_TIRITH] }] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA_HERO] },
      ],
    });
    const actions = viableActions(base, PLAYER_1, 'activate-granted-action');
    const peekActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle',
    );
    expect(peekActions).toHaveLength(0);
  });

  test('palantir-peek-shuffle offered when bearer has native can-use-palantir (Saruman)', () => {
    // Saruman (tw-181) has a native can-use-palantir play-flag; no extra item needed
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH_HERO, characters: [{ defId: SARUMAN, items: [PALANTIR_MINAS_TIRITH] }] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA_HERO] },
      ],
    });

    const actions = viableActions(base, PLAYER_1, 'activate-granted-action');
    const peekActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle',
    );
    expect(peekActions).toHaveLength(1);
  });

  // ─── Grant-action: tap cost and item state ────────────────────────────────

  test('activating palantir-peek-shuffle taps the Palantír item (not the bearer)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH_HERO, characters: [{ defId: SARUMAN, items: [PALANTIR_MINAS_TIRITH] }] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA_HERO] },
      ],
    });

    const actions = viableActions(base, PLAYER_1, 'activate-granted-action');
    const peekActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle',
    );
    expect(peekActions).toHaveLength(1);

    const after = dispatch(base, peekActions[0].action);

    // The bearer (Saruman) remains untapped
    const bearer = Object.values(after.players[RESOURCE_PLAYER].characters)[0];
    expect(bearer.status).toBe(CardStatus.Untapped);

    // The Palantír item is now tapped
    const palantir = bearer.items.find(i => i.definitionId === PALANTIR_MINAS_TIRITH);
    expect(palantir).toBeDefined();
    expect(palantir!.status).toBe(CardStatus.Tapped);
  });

  test('tapped Palantír item cannot activate peek-shuffle again', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH_HERO, characters: [{ defId: SARUMAN, items: [PALANTIR_MINAS_TIRITH] }] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA_HERO] },
      ],
    });

    const actions = viableActions(base, PLAYER_1, 'activate-granted-action');
    const peekAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle',
    );
    expect(peekAction).toBeDefined();
    const after = dispatch(base, peekAction!.action);

    // No further peek-shuffle offered once tapped
    const afterActions = viableActions(after, PLAYER_1, 'activate-granted-action');
    const peekAgain = afterActions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle',
    );
    expect(peekAgain).toHaveLength(0);
  });

  // ─── Grant-action: deck shuffle ───────────────────────────────────────────

  test('activating shuffles own play deck top 5 (same cards, deck length unchanged)', () => {
    const deckCards = [ARAGORN, LEGOLAS, MORIA_HERO, RIVENDELL, MINAS_TIRITH_HERO,
                       ARAGORN, LEGOLAS] as CardDefinitionId[];
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH_HERO, characters: [{ defId: SARUMAN, items: [PALANTIR_MINAS_TIRITH] }] }],
          hand: [],
          siteDeck: [RIVENDELL],
          playDeck: deckCards,
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA_HERO],
          playDeck: deckCards,
        },
      ],
    });

    const actions = viableActions(base, PLAYER_1, 'activate-granted-action');
    const peekAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle',
    );
    expect(peekAction).toBeDefined();
    const after = dispatch(base, peekAction!.action);

    // Own deck length unchanged
    const ownDeckBefore = base.players[RESOURCE_PLAYER].playDeck;
    const ownDeckAfter  = after.players[RESOURCE_PLAYER].playDeck;
    expect(ownDeckAfter).toHaveLength(ownDeckBefore.length);

    // Top 5 cards are the same set of definitions (possibly reordered)
    const topBefore = ownDeckBefore.slice(0, 5).map(c => c.definitionId).sort();
    const topAfter  = ownDeckAfter.slice(0, 5).map(c => c.definitionId).sort();
    expect(topAfter).toEqual(topBefore);

    // Cards at positions 5+ are unaffected
    const restBefore = ownDeckBefore.slice(5).map(c => c.definitionId);
    const restAfter  = ownDeckAfter.slice(5).map(c => c.definitionId);
    expect(restAfter).toEqual(restBefore);
  });

  test('activating shuffles opponent play deck top 5 (same cards, deck length unchanged)', () => {
    const deckCards = [ARAGORN, LEGOLAS, MORIA_HERO, RIVENDELL, MINAS_TIRITH_HERO,
                       ARAGORN, LEGOLAS] as CardDefinitionId[];
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH_HERO, characters: [{ defId: SARUMAN, items: [PALANTIR_MINAS_TIRITH] }] }],
          hand: [],
          siteDeck: [RIVENDELL],
          playDeck: deckCards,
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA_HERO],
          playDeck: deckCards,
        },
      ],
    });

    const actions = viableActions(base, PLAYER_1, 'activate-granted-action');
    const peekAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle',
    );
    expect(peekAction).toBeDefined();
    const after = dispatch(base, peekAction!.action);

    // Opponent deck length unchanged
    const oppDeckBefore = base.players[1].playDeck;
    const oppDeckAfter  = after.players[1].playDeck;
    expect(oppDeckAfter).toHaveLength(oppDeckBefore.length);

    // Top 5 definitions match (set equality)
    const topBefore = oppDeckBefore.slice(0, 5).map(c => c.definitionId).sort();
    const topAfter  = oppDeckAfter.slice(0, 5).map(c => c.definitionId).sort();
    expect(topAfter).toEqual(topBefore);

    // Cards beyond position 5 unaffected
    const restBefore = oppDeckBefore.slice(5).map(c => c.definitionId);
    const restAfter  = oppDeckAfter.slice(5).map(c => c.definitionId);
    expect(restAfter).toEqual(restBefore);
  });

  // ─── Grant-action: corruption check ──────────────────────────────────────

  test('activating enqueues a corruption check on the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH_HERO, characters: [{ defId: SARUMAN, items: [PALANTIR_MINAS_TIRITH] }] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA_HERO] },
      ],
    });

    const actions = viableActions(base, PLAYER_1, 'activate-granted-action');
    const peekAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'palantir-peek-shuffle',
    );
    expect(peekAction).toBeDefined();
    const after = dispatch(base, peekAction!.action);

    // A corruption-check pending resolution is enqueued on the bearer
    const cc = after.pendingResolutions.find(r => r.kind.type === 'corruption-check');
    expect(cc).toBeDefined();
  });
});
