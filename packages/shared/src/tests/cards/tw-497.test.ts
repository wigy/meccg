/**
 * @module tw-497.test
 *
 * Card test: A Pack at the Door (tw-497)
 * Type: hazard-event (long), non-unique, Neutral.
 *
 * Card text (authoritative — data/cards.json TW-497):
 *   "Playable if Doors of Night is in play. Each non-unique Animal, Spider and
 *    Wolf creature may be played in Border-lands [{b}], Border-holds [{B}] or
 *    Ruins & Lairs [{R}]. The creature must be playable in a non-Coastal Sea
 *    [{c}] region."
 *
 * Effects:
 *   1. `play-condition` (card-in-play "Doors of Night") — the long-event itself
 *      is only playable while Doors of Night is in play.
 *   2. `grant-creature-keying` (extended) — while this long-event is in play,
 *      any hazard creature whose definition is a non-unique Animal/Spider/Wolf
 *      AND whose own printed keying offers a non-Coastal-Sea region
 *      (`requiresNonCoastalKeying`) may be keyed to:
 *        - a Border-hold [{B}] or Ruins & Lairs [{R}] site (siteFilter.siteTypes), OR
 *        - a Border-land [{b}] region on the company's path (siteFilter.regionTypes).
 *
 * Engine Support:
 * | # | Feature                                              | Status      | Notes                                             |
 * |---|------------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | play-condition card-in-play "Doors of Night"         | IMPLEMENTED | playHazardsActions long/permanent branch           |
 * | 2 | grant-creature-keying site-type branch (B / R)       | IMPLEMENTED | inPlayGrantsCreatureKeying siteFilter.siteTypes    |
 * | 3 | grant-creature-keying region-type branch (Border)    | IMPLEMENTED | inPlayGrantsCreatureKeying siteFilter.regionTypes  |
 * | 4 | requiresNonCoastalKeying excludes Coastal-Sea-only   | IMPLEMENTED | creatureHasNonCoastalRegionKeying (new)            |
 * | 5 | creatureFilter excludes unique / non-target races    | IMPLEMENTED | creatureFilter $and race+unique                    |
 *
 * Playable: YES
 * Certified: 2026-07-17
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, LORIEN, MINAS_TIRITH, BREE, BANDIT_LAIR, WELLINGHALL, DOORS_OF_NIGHT,
  resetMint, buildTestState, makeMHState, viableActions,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, PlayHazardAction, MovementHazardPhaseState,
} from '../../index.js';
import { CardStatus } from '../../index.js';

const A_PACK_AT_THE_DOOR = 'tw-497' as CardDefinitionId;
// Watcher in the Water: non-unique Animal keyed to {w}{w} / {c} / Moria — has a
// non-Coastal-Sea region keying (Wilderness), so it qualifies for the grant, and
// is NOT normally keyable at a Border-hold / Ruins & Lairs / lone Border region.
const WATCHER_IN_THE_WATER = 'tw-110' as CardDefinitionId;
// Wolves: non-unique Wolf keyed to border/wilderness region (no site-type keying).
const WOLVES = 'tw-114' as CardDefinitionId;
// Fell Turtle: non-unique Animal keyed ONLY to Coastal Sea [{c}] — excluded by
// the "must be playable in a non-Coastal Sea region" clause.
const FELL_TURTLE = 'tw-34' as CardDefinitionId;
// Landroval: a UNIQUE Animal — excluded by the non-unique clause.
const LANDROVAL = 'le-81' as CardDefinitionId;
// Assassin: a Man (not Animal/Spider/Wolf) — never granted keying.
const ASSASSIN = 'tw-8' as CardDefinitionId;

/** A fixed in-play instance of A Pack at the Door (the long-event resolved into play). */
const packInPlay: CardInPlay = {
  instanceId: 'pack-1' as CardInstanceId,
  definitionId: A_PACK_AT_THE_DOOR,
  status: CardStatus.Untapped,
};

/**
 * Wizard hero company (PLAYER_1, active) at `site`; the opposing hazard player
 * (PLAYER_2) holds `hazardHand`. When `withPack`, A Pack at the Door sits in
 * PLAYER_2's `cardsInPlay`. `mh` overrides the movement/hazard phase state
 * (e.g. a resolved Border-land path for the region-type branch).
 */
function mhAt(
  site: CardDefinitionId,
  hazardHand: CardDefinitionId[],
  opts: { withPack?: boolean; cardsInPlay?: CardInPlay[]; mh?: Partial<MovementHazardPhaseState> } = {},
): GameState {
  const p2InPlay = [
    ...(opts.withPack ? [packInPlay] : []),
    ...(opts.cardsInPlay ?? []),
  ];
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      {
        id: PLAYER_2, alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: hazardHand, siteDeck: [MINAS_TIRITH],
        cardsInPlay: p2InPlay,
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

describe('A Pack at the Door (tw-497)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: playable only if Doors of Night is in play ──────────────────

  test('the long-event is playable while Doors of Night is in play', () => {
    const state = mhAt(BREE, [A_PACK_AT_THE_DOOR], { cardsInPlay: [
      { instanceId: 'don-1' as CardInstanceId, definitionId: DOORS_OF_NIGHT, status: CardStatus.Untapped },
    ] });
    const packId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredAtAll(state, packId)).toBe(true);
  });

  test('the long-event is NOT playable when Doors of Night is not in play', () => {
    const state = mhAt(BREE, [A_PACK_AT_THE_DOOR]);
    const packId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    // Offered as non-viable with a Doors-of-Night reason (never viable).
    const all = computeLegalActions(state, PLAYER_2);
    const entry = all.find(ea => (ea.action as PlayHazardAction).cardInstanceId === packId
      && ea.action.type === 'play-hazard');
    expect(entry?.viable).toBe(false);
    expect(entry?.reason).toMatch(/Doors of Night/);
  });

  // ─── Effect 2: grant-creature-keying — site-type branch ────────────────────

  test('a non-unique Animal is keyable at a Border-hold [{B}] while the Pack is in play', () => {
    const state = mhAt(BREE, [WATCHER_IN_THE_WATER], { withPack: true });
    const watcherId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, watcherId)).toBe(true);
  });

  test('a non-unique Animal is keyable at a Ruins & Lairs [{R}] while the Pack is in play', () => {
    const state = mhAt(BANDIT_LAIR, [WATCHER_IN_THE_WATER], { withPack: true });
    const watcherId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, watcherId)).toBe(true);
  });

  test('a non-unique Wolf is also granted keying (wolves race) at a Border-hold', () => {
    const state = mhAt(BREE, [WOLVES], { withPack: true });
    const wolvesId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, wolvesId)).toBe(true);
  });

  // ─── Effect 2: grant-creature-keying — region-type branch (Border-lands) ───

  test('a non-unique Animal is keyable to a Border-land [{b}] region on the path while the Pack is in play', () => {
    // Company at a Free-hold (Wellinghall) so the site-type branch cannot fire;
    // the resolved path holds a single Border region → only the region branch can key it.
    const state = mhAt(WELLINGHALL, [WATCHER_IN_THE_WATER], {
      withPack: true,
      mh: { resolvedSitePath: [RegionType.Border], resolvedSitePathNames: ['Enedhwaith'] },
    });
    const watcherId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, watcherId)).toBe(true);
  });

  test('without a Border region on the path (and not at a B/R site) the grant does not key it', () => {
    // Free-hold, wilderness-only path: neither branch of the grant matches.
    const state = mhAt(WELLINGHALL, [WATCHER_IN_THE_WATER], {
      withPack: true,
      mh: { resolvedSitePath: [RegionType.Wilderness], resolvedSitePathNames: ['Rhudaur'] },
    });
    const watcherId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, watcherId)).toBe(false);
    expect(offeredAtAll(state, watcherId)).toBe(false);
  });

  // ─── Control: no grant without the Pack in play ────────────────────────────

  test('without the Pack in play, the same Animal is NOT keyable at the Border-hold', () => {
    const state = mhAt(BREE, [WATCHER_IN_THE_WATER]);
    const watcherId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, watcherId)).toBe(false);
    expect(offeredAtAll(state, watcherId)).toBe(false);
  });

  // ─── The non-Coastal-Sea clause ────────────────────────────────────────────

  test('a Coastal-Sea-only Animal (Fell Turtle) is NOT keyed by the grant (non-Coastal-Sea clause)', () => {
    const state = mhAt(BANDIT_LAIR, [FELL_TURTLE], { withPack: true });
    const turtleId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, turtleId)).toBe(false);
    expect(offeredAtAll(state, turtleId)).toBe(false);
  });

  // ─── The non-unique clause ─────────────────────────────────────────────────

  test('a UNIQUE Animal (Landroval) is NOT keyed by the grant (non-unique clause)', () => {
    const state = mhAt(BREE, [LANDROVAL], { withPack: true });
    const landrovalId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, landrovalId)).toBe(false);
  });

  // ─── Race restriction ──────────────────────────────────────────────────────

  test('a non-Animal/Spider/Wolf creature (Assassin, a Man) is NOT granted keying at a Ruins & Lairs', () => {
    const state = mhAt(BANDIT_LAIR, [ASSASSIN], { withPack: true });
    const assassinId = state.players[HAZARD_PLAYER].hand[0].instanceId;
    expect(offeredViaKeyingBypass(state, assassinId)).toBe(false);
    expect(offeredAtAll(state, assassinId)).toBe(false);
  });
});
