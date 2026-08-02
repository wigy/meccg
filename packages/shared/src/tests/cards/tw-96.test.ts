/**
 * @module tw-96.test
 *
 * Card test: The Nazgûl are Abroad (tw-96)
 * Type: hazard-event (permanent), non-unique.
 *
 * Card text:
 *   "Nazgûl may attack a hero company containing the bearer of The One Ring
 *    at any site that is not a Free-hold [{F}] or Haven [{H}]. Nazgûl may
 *    attack any hero company possessing any Ring in a Shadow-land [{s}] or
 *    Shadow-hold [{S}]. If Doors of Night is in play, at the end of each
 *    turn, each player may return one Nazgûl permanent-event from his
 *    discard pile to his hand. Cannot be duplicated."
 *
 * Effects:
 *   1. `duplication-limit` (scope "game", max 1) — "Cannot be duplicated."
 *   2. `grant-creature-keying` #1 — any Nazgûl creature may be keyed to any
 *      site except Free-hold/Haven (`siteFilter.excludeSiteTypes`) against a
 *      hero company bearing The One Ring (`companyFilter`:
 *      `company.alignment === "hero"` AND
 *      `company.itemKeywords includes "the-one-ring"`).
 *   3. `grant-creature-keying` #2 — any Nazgûl creature may be keyed to a
 *      Shadow-hold site or a Shadow-land region on the path against a hero
 *      company possessing any Ring (`company.itemKeywords includes "ring"`).
 *   4. `on-event: end-of-turn`, `actor: "both"`, `when: {inPlay: "Doors of
 *      Night"}` — each player may return one Nazgûl permanent-event
 *      (`keywords includes "Nazgûl"`) from discard to hand.
 *
 * Engine Support:
 * | # | Feature                                                | Status      | Notes                                          |
 * |---|---------------------------------------------------------|-------------|-------------------------------------------------|
 * | 1 | Cannot be duplicated (game scope, max 1)                 | IMPLEMENTED | duplication-limit gates play-hazard             |
 * | 2 | Rule 1: keying to any non-Free-hold/Haven site vs        | IMPLEMENTED | grant-creature-keying siteFilter.excludeSiteTypes |
 * |   | One-Ring-bearing hero company                            |             | + companyFilter (new)                           |
 * | 3 | Rule 2: keying to Shadow-hold/Shadow-land vs any-Ring    | IMPLEMENTED | grant-creature-keying siteFilter siteTypes/      |
 * |   | hero company                                             |             | regionTypes + companyFilter (new)               |
 * | 4 | Rule 3: end-of-turn fetch to hand (both players), gated  | IMPLEMENTED | on-event end-of-turn actor:both,                |
 * |   | on Doors of Night                                        |             | fireEndOfTurnFetchEffects (reducer-site.ts)     |
 *
 * Playable: YES — all rules implemented.
 * Certified: 2026-08-02
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, HAZARD_PLAYER, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  LORIEN, MINAS_TIRITH, RIVENDELL, BREE, MORIA,
  resetMint, buildTestState, makeMHState, makeSitePhase, viableActions,
  addCardInPlay, dispatch,
} from '../test-helpers.js';
import { THE_ONE_RING, DOORS_OF_NIGHT } from '../../card-ids.js';
import { Phase, Alignment, RegionType } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, PlayHazardAction, MovementHazardPhaseState,
} from '../../index.js';
import { CardStatus } from '../../index.js';

const NAZGUL_ABROAD = 'tw-96' as CardDefinitionId;
// Witch-king of Angmar: Nazgûl, keyed only to Dark-holds/dark regions or the
// named regions Angmar/Gundabad/Gorgoroth/Imlad Morgul — never naturally
// keyable at Bree (border-hold), Moria (shadow-hold), Minas Tirith (free-hold)
// or Rivendell (haven), so any keying there proves the grant, not native keying.
const WITCH_KING = 'tw-113' as CardDefinitionId;
// Barrow-wight: a hazard creature with no Nazgûl keyword — must never be
// granted keying by this card, and has no alt-permanent-event escape valve.
const BARROW_WIGHT = 'tw-14' as CardDefinitionId;
// Lesser Ring: a Ring item (keyword "ring") that is NOT The One Ring.
const LESSER_RING = 'tw-266' as CardDefinitionId;

const abroadInPlay: CardInPlay = {
  instanceId: 'abroad-1' as CardInstanceId,
  definitionId: NAZGUL_ABROAD,
  status: CardStatus.Untapped,
};

function mhAt(opts: {
  site: CardDefinitionId;
  items?: CardDefinitionId[];
  defenderAlignment?: Alignment;
  hazardHand: CardDefinitionId[];
  withAbroad?: boolean;
  mh?: Partial<MovementHazardPhaseState>;
}): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: opts.defenderAlignment ?? Alignment.Wizard,
        companies: [{ site: opts.site, characters: [{ defId: ARAGORN, items: opts.items ?? [] }] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: opts.hazardHand,
        siteDeck: [MINAS_TIRITH],
        cardsInPlay: opts.withAbroad ? [abroadInPlay] : [],
      },
    ],
  });
  return { ...state, phaseState: makeMHState(opts.mh) };
}

/** Whether the hazard player is offered a viable `play-hazard` for `instanceId` keyed via the grant (keying-bypass). */
function offeredViaKeyingBypass(state: GameState, instanceId: CardInstanceId): boolean {
  return viableActions(state, PLAYER_2, 'play-hazard').some(ea => {
    const a = ea.action as PlayHazardAction;
    return a.cardInstanceId === instanceId && a.keyedBy?.method === 'keying-bypass';
  });
}

/** Whether the hazard player is offered ANY viable `play-hazard` for `instanceId`. */
function offeredAtAll(state: GameState, instanceId: CardInstanceId): boolean {
  return viableActions(state, PLAYER_2, 'play-hazard').some(
    ea => (ea.action as PlayHazardAction).cardInstanceId === instanceId,
  );
}

describe('The Nazgûl are Abroad (tw-96)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: cannot be duplicated ─────────────────────────────────────

  test('cannot be duplicated — second copy rejected when one is already in play', () => {
    const state = mhAt({ site: BREE, hazardHand: [NAZGUL_ABROAD], withAbroad: true });
    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('playable as a hazard permanent-event when no copy is yet in play', () => {
    const state = mhAt({ site: BREE, hazardHand: [NAZGUL_ABROAD] });
    const actions = viableActions(state, PLAYER_2, 'play-hazard');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ─── Rule 1: keying to any non-Free-hold/Haven site vs a One-Ring bearer ───

  test('Nazgûl keyable at a Border-hold (Bree) against a hero company bearing The One Ring', () => {
    const state = mhAt({
      site: BREE, items: [THE_ONE_RING], hazardHand: [WITCH_KING], withAbroad: true,
    });
    const wkId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wkId)).toBe(true);
  });

  // Note: Witch-king carries a `creature-alt-event` mode (playable as a
  // permanent-event regardless of keying), so `offeredAtAll` is always true
  // for it — these negative cases assert only that no keying-bypass action
  // (an attack against the target company) is offered.

  test('Nazgûl NOT keyable at a Free-hold (Minas Tirith) even against the One-Ring bearer', () => {
    const state = mhAt({
      site: MINAS_TIRITH, items: [THE_ONE_RING], hazardHand: [WITCH_KING], withAbroad: true,
    });
    const wkId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wkId)).toBe(false);
  });

  test('Nazgûl NOT keyable at a Haven (Rivendell) even against the One-Ring bearer', () => {
    const state = mhAt({
      site: RIVENDELL, items: [THE_ONE_RING], hazardHand: [WITCH_KING], withAbroad: true,
    });
    const wkId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wkId)).toBe(false);
  });

  test('Nazgûl NOT keyable at a Border-hold when the company does not bear The One Ring', () => {
    const state = mhAt({
      site: BREE, items: [], hazardHand: [WITCH_KING], withAbroad: true,
    });
    const wkId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wkId)).toBe(false);
  });

  test('Nazgûl NOT keyable at a Border-hold bearing only a lesser Ring (not The One Ring) — rule 1 requires The One Ring specifically', () => {
    const state = mhAt({
      site: BREE, items: [LESSER_RING], hazardHand: [WITCH_KING], withAbroad: true,
    });
    const wkId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wkId)).toBe(false);
  });

  test('without The Nazgûl are Abroad in play, no grant applies even with the One Ring at a Border-hold', () => {
    const state = mhAt({
      site: BREE, items: [THE_ONE_RING], hazardHand: [WITCH_KING],
    });
    const wkId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wkId)).toBe(false);
  });

  test('a non-Nazgûl creature (Barrow-wight) is never granted keying, even against a One-Ring bearer at a Border-hold', () => {
    const state = mhAt({
      site: BREE, items: [THE_ONE_RING], hazardHand: [BARROW_WIGHT], withAbroad: true,
    });
    const wightId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wightId)).toBe(false);
    // Barrow-wight has no alt-permanent-event mode, so unlike Witch-king it is
    // simply not offered at all when the grant doesn't apply.
    expect(offeredAtAll(state, wightId)).toBe(false);
  });

  // ─── Rule 2: keying to Shadow-hold/Shadow-land vs any Ring ─────────────────

  test('Nazgûl keyable at a Shadow-hold (Moria) against a hero company possessing any Ring (Lesser Ring)', () => {
    const state = mhAt({
      site: MORIA, items: [LESSER_RING], hazardHand: [WITCH_KING], withAbroad: true,
    });
    const wkId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wkId)).toBe(true);
  });

  test('Nazgûl keyable to a Shadow-land region on the path against a Ring-bearing hero company, even at a Border-hold site', () => {
    const state = mhAt({
      site: BREE, items: [LESSER_RING], hazardHand: [WITCH_KING], withAbroad: true,
      mh: { resolvedSitePath: [RegionType.Shadow], resolvedSitePathNames: ['Nurn'] },
    });
    const wkId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wkId)).toBe(true);
  });

  test('Nazgûl NOT keyable at a Shadow-hold without any Ring in the company', () => {
    const state = mhAt({
      site: MORIA, items: [], hazardHand: [WITCH_KING], withAbroad: true,
    });
    const wkId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wkId)).toBe(false);
  });

  test('the grant does not apply to a non-hero (minion) defending company, even bearing a Ring at a Shadow-hold', () => {
    const state = mhAt({
      site: MORIA, items: [LESSER_RING], hazardHand: [WITCH_KING], withAbroad: true,
      defenderAlignment: Alignment.Ringwraith,
    });
    const wkId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wkId)).toBe(false);
  });

  // ─── Rule 3: end-of-turn fetch of a Nazgûl permanent-event to hand ─────────

  test('without Doors of Night, no end-of-turn fetch effects are generated', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        {
          id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH],
          discardPile: [WITCH_KING],
        },
      ],
    });
    const withAbroad = addCardInPlay(base, HAZARD_PLAYER, NAZGUL_ABROAD);
    const inSitePhase = {
      ...withAbroad,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });
    expect(afterTransition.phaseState.phase).toBe(Phase.EndOfTurn);
    expect(afterTransition.pendingEffects.length).toBe(0);
  });

  test('with Doors of Night, both players get a pending fetch-to-hand effect', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          discardPile: [WITCH_KING],
        },
        {
          id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withAbroad = addCardInPlay(base, HAZARD_PLAYER, NAZGUL_ABROAD);
    const withDoN = addCardInPlay(withAbroad, HAZARD_PLAYER, DOORS_OF_NIGHT as unknown as CardDefinitionId);
    const inSitePhase = {
      ...withDoN,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });
    expect(afterTransition.pendingEffects.length).toBe(2);
    const actors = afterTransition.pendingEffects.map(e => e.actor);
    expect(actors).toContain(PLAYER_1);
    expect(actors).toContain(PLAYER_2);
    for (const pe of afterTransition.pendingEffects) {
      expect(pe.type).toBe('card-effect');
      if (pe.type === 'card-effect' && pe.effect.type === 'fetch-to-deck') {
        expect(pe.effect.to).toBe('hand');
        expect(pe.skipDiscard).toBe(true);
      }
    }
  });

  test('with Doors of Night, a player can return the Witch-king (a Nazgûl permanent-event) from discard to hand', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          discardPile: [WITCH_KING],
        },
        {
          id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withAbroad = addCardInPlay(base, HAZARD_PLAYER, NAZGUL_ABROAD);
    const withDoN = addCardInPlay(withAbroad, HAZARD_PLAYER, DOORS_OF_NIGHT as unknown as CardDefinitionId);
    const inSitePhase = {
      ...withDoN,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });
    const wkInstance = afterTransition.players[RESOURCE_PLAYER].discardPile.find(c => c.definitionId === WITCH_KING);
    expect(wkInstance).toBeDefined();

    const afterFetch = dispatch(afterTransition, {
      type: 'fetch-from-pile',
      player: PLAYER_1,
      cardInstanceId: wkInstance!.instanceId,
      source: 'discard-pile',
    });

    expect(afterFetch.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === WITCH_KING)).toBe(true);
    expect(afterFetch.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === WITCH_KING)).toBe(false);
  });

  test('the fetch filter rejects a non-Nazgûl hazard creature (Barrow-wight)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH],
          discardPile: [BARROW_WIGHT],
        },
        {
          id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const withAbroad = addCardInPlay(base, HAZARD_PLAYER, NAZGUL_ABROAD);
    const withDoN = addCardInPlay(withAbroad, HAZARD_PLAYER, DOORS_OF_NIGHT as unknown as CardDefinitionId);
    const inSitePhase = {
      ...withDoN,
      phaseState: makeSitePhase({ step: 'play-resources', handledCompanyIds: [], activeCompanyIndex: 0, siteEntered: true }),
    };

    const afterTransition = dispatch(inSitePhase, { type: 'pass', player: PLAYER_1 });
    const actions = viableActions(afterTransition, PLAYER_1, 'fetch-from-pile');
    expect(actions).toHaveLength(0);
  });
});
