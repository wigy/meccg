/**
 * @module tw-285.test
 *
 * Card test: Moon (tw-285)
 * Type: hero-resource-event (long-event, Environment), non-unique.
 *
 * Card text:
 *   "Environment. If Gates of Morning is in play, treat all Wildernesses [{w}]
 *    as Border-lands [{b}] and all Border-lands [{b}] as Free-domains [{f}]
 *    for the purposes of playing hazards. If Doors of Night is in play, treat
 *    all Dark-domains [{d}] as Shadow-lands [{s}] and all Shadow-lands [{s}]
 *    as Wildernesses [{w}] for the purposes of playing hazards. Cannot be
 *    duplicated."
 *
 * Moon carried an empty `effects` array in the data — this printing had never
 * had its region remap encoded, so with Gates of Morning or Doors of Night in
 * play, region-keyed hazard creatures resolved against the printed region
 * types instead of the remapped ones, and a second copy was not blocked.
 *
 * Rule coverage:
 *
 * | # | Rule                                                         | Status | Notes                                    |
 * |---|----------------------------------------------------------------|--------|--------------------------------------------|
 * | 1 | With Gates of Morning: {w}→{b} for keying                     | FIXED  | `region-type-remap`, gated live on GoM    |
 * | 2 | With Gates of Morning: {b}→{f} for keying (border stops keying {b}) | FIXED | same effect                         |
 * | 3 | With Doors of Night: {d}→{s} for keying (dark stops keying {d})| FIXED  | `region-type-remap`, gated live on DoN   |
 * | 4 | With Doors of Night: {s}→{w} for keying                        | FIXED  | same effect                               |
 * | 5 | The two remaps are independently gated (GoM alone does not     | FIXED  | each has its own `when: { inPlay }`       |
 * |   |   trigger the DoN remap and vice versa)                        |        |                                            |
 * | 6 | Remaps are gated *live* — they turn off once the gating card    | FIXED  | mirrors Fell Winter tw-35                 |
 * |   |   leaves play                                                  |        |                                            |
 * | 7 | Cannot be duplicated                                            | FIXED  | `duplication-limit` scope game, max 1     |
 *
 * Uses the `region-type-remap` primitive (Fell Winter le-111/tw-35, Morgul
 * Night tw-62, Fog tw-241) unchanged: two independent effect entries on the
 * same card, each with its own `when: { inPlay }` gate, both collected by
 * `collectRegionTypeRemaps`. No hazard creature in the pool keys to a single
 * Dark-domain-or-Shadow-land pair the way the {d}→{s} step needs to positively
 * confirm the substitution, so that step is verified with Orc-guard (tw-072,
 * keyed to *both* Shadow-land and Dark-domain): it stays keyable on a
 * Dark-domain path before and after the remap, but the region-type it is
 * keyed *as* flips from `dark` to `shadow`, which only happens if the
 * substitution actually fired.
 *
 * Playable: FULLY — CERTIFIED.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, ORC_GUARD,
  GATES_OF_MORNING, DOORS_OF_NIGHT,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, addCardInPlay,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, Alignment, RegionType, SiteType, computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayHazardAction, CreatureKeyingMatch } from '../../index.js';

const MOON = 'tw-285' as CardDefinitionId;
/** Man hazard-creature keyed to a single Border-land [{b}] — region type only. */
const ABDUCTOR = 'tw-1' as CardDefinitionId;
/** Awakened Plant keyed to a single Wilderness [{w}] — region type only. */
const HUORN = 'tw-45' as CardDefinitionId;
/** Unique Troll keyed to a single Dark-domain [{d}] — region type only. */
const GOTHMOG = 'td-28' as CardDefinitionId;

function baseState(hazardHand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hazardHand, siteDeck: [RIVENDELL] },
    ],
  });
}

/** Resource player (PLAYER_1, Wizard) holds Moon in hand, for the long-event playability checks. */
function longEventState(resourceHand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.LongEvent,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: resourceHand, siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
}

function hazardHandInstance(state: GameState, defId: CardDefinitionId): CardInstanceId {
  return state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === defId)!.instanceId;
}

/** Every region type the creature can currently be keyed by, as offered to the hazard player. */
function keyingRegionTypes(state: GameState, defId: CardDefinitionId): string[] {
  const inst = hazardHandInstance(state, defId);
  return computeLegalActions(state, PLAYER_2)
    .filter(ea => ea.viable && ea.action.type === 'play-hazard' && ea.action.cardInstanceId === inst)
    .map(ea => (ea.action as PlayHazardAction).keyedBy)
    .filter((k): k is CreatureKeyingMatch => k?.method === 'region-type')
    .map(k => k.value)
    .sort();
}

/** An M/H state where the moving company traverses exactly `path`, arriving at a Ruins & Lairs. */
function movingThrough(path: readonly RegionType[], names: readonly string[]) {
  return makeMHState({
    resolvedSitePath: [...path],
    resolvedSitePathNames: [...names],
    destinationSiteType: SiteType.RuinsAndLairs,
    destinationSiteName: 'Moria',
  });
}

describe('Moon (tw-285)', () => {
  beforeEach(() => resetMint());

  // ─── Rules 1-2: Gates-of-Morning remap ({w}→{b}, {b}→{f}) ─────────────────

  test('with Gates of Morning: a Wilderness path starts keying as a Border-land, not a Wilderness', () => {
    const path = movingThrough([RegionType.Wilderness], ['Eriador']);
    let state: GameState = { ...baseState([HUORN, ABDUCTOR]), phaseState: path };
    expect(keyingRegionTypes(state, HUORN)).toEqual([RegionType.Wilderness]);
    expect(keyingRegionTypes(state, ABDUCTOR)).toEqual([]);

    state = addCardInPlay(state, HAZARD_PLAYER, MOON);
    state = addCardInPlay(state, HAZARD_PLAYER, GATES_OF_MORNING);
    // Replacement, not addition: the Wilderness *is* a Border-land now.
    expect(keyingRegionTypes(state, HUORN)).toEqual([]);
    expect(keyingRegionTypes(state, ABDUCTOR)).toEqual([RegionType.Border]);
  });

  test('with Gates of Morning: a Border-land path stops keying as a Border-land', () => {
    const path = movingThrough([RegionType.Border], ['Sarn Ford']);
    let state: GameState = { ...baseState([ABDUCTOR]), phaseState: path };
    expect(keyingRegionTypes(state, ABDUCTOR)).toEqual([RegionType.Border]);

    state = addCardInPlay(state, HAZARD_PLAYER, MOON);
    state = addCardInPlay(state, HAZARD_PLAYER, GATES_OF_MORNING);
    // The Border-land is now a Free-domain, so the {b}-only creature loses keying.
    expect(keyingRegionTypes(state, ABDUCTOR)).toEqual([]);
  });

  test('Moon alone (without Gates of Morning) does not remap Wilderness/Border-land keying', () => {
    const path = movingThrough([RegionType.Wilderness], ['Eriador']);
    let state: GameState = { ...baseState([HUORN, ABDUCTOR]), phaseState: path };
    state = addCardInPlay(state, HAZARD_PLAYER, MOON);
    expect(keyingRegionTypes(state, HUORN)).toEqual([RegionType.Wilderness]);
    expect(keyingRegionTypes(state, ABDUCTOR)).toEqual([]);
  });

  // ─── Rules 3-4: Doors-of-Night remap ({d}→{s}, {s}→{w}) ───────────────────

  test('with Doors of Night: a Dark-domain path stops keying as a Dark-domain', () => {
    const path = movingThrough([RegionType.Dark], ['Udûn']);
    // Orc-guard keys to both Shadow-land and Dark-domain, so it stays keyable
    // either way — but which region-type it is keyed *as* reveals whether the
    // remap actually happened, not just "some keying survives".
    let state: GameState = { ...baseState([GOTHMOG, ORC_GUARD]), phaseState: path };
    expect(keyingRegionTypes(state, GOTHMOG)).toEqual([RegionType.Dark]);
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([RegionType.Dark]);

    state = addCardInPlay(state, HAZARD_PLAYER, MOON);
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    // Replacement, not addition: the Dark-domain *is* a Shadow-land now, so the
    // {d}-only creature loses keying and the {s}/{d} creature is keyed as {s}.
    expect(keyingRegionTypes(state, GOTHMOG)).toEqual([]);
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([RegionType.Shadow]);
  });

  test('with Doors of Night: a Shadow-land path starts keying as a Wilderness, not a Shadow-land', () => {
    const path = movingThrough([RegionType.Shadow], ['Dagorlad']);
    let state: GameState = { ...baseState([ORC_GUARD, HUORN]), phaseState: path };
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([RegionType.Shadow]);
    expect(keyingRegionTypes(state, HUORN)).toEqual([]);

    state = addCardInPlay(state, HAZARD_PLAYER, MOON);
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([]);
    expect(keyingRegionTypes(state, HUORN)).toEqual([RegionType.Wilderness]);
  });

  test('Moon alone (without Doors of Night) does not remap Dark-domain/Shadow-land keying', () => {
    const path = movingThrough([RegionType.Dark], ['Udûn']);
    let state: GameState = { ...baseState([GOTHMOG]), phaseState: path };
    state = addCardInPlay(state, HAZARD_PLAYER, MOON);
    expect(keyingRegionTypes(state, GOTHMOG)).toEqual([RegionType.Dark]);
  });

  // ─── Rule 5: the two remaps are independently gated ───────────────────────

  test('Gates of Morning alone does not activate the Doors-of-Night remap, and vice versa', () => {
    const shadowPath = movingThrough([RegionType.Shadow], ['Dagorlad']);
    let withGom: GameState = { ...baseState([ORC_GUARD, HUORN]), phaseState: shadowPath };
    withGom = addCardInPlay(withGom, HAZARD_PLAYER, MOON);
    withGom = addCardInPlay(withGom, HAZARD_PLAYER, GATES_OF_MORNING);
    // Gates of Morning's remap has no {s} entry, so a Shadow-land stays a Shadow-land.
    expect(keyingRegionTypes(withGom, ORC_GUARD)).toEqual([RegionType.Shadow]);
    expect(keyingRegionTypes(withGom, HUORN)).toEqual([]);

    const wildernessPath = movingThrough([RegionType.Wilderness], ['Eriador']);
    let withDoors: GameState = { ...baseState([HUORN, ABDUCTOR]), phaseState: wildernessPath };
    withDoors = addCardInPlay(withDoors, HAZARD_PLAYER, MOON);
    withDoors = addCardInPlay(withDoors, HAZARD_PLAYER, DOORS_OF_NIGHT);
    // Doors of Night's remap has no {w} entry, so a Wilderness stays a Wilderness.
    expect(keyingRegionTypes(withDoors, HUORN)).toEqual([RegionType.Wilderness]);
    expect(keyingRegionTypes(withDoors, ABDUCTOR)).toEqual([]);
  });

  // ─── Rule 6: the remap is gated live ──────────────────────────────────────

  test('the Gates-of-Morning remap turns off once Gates of Morning leaves play', () => {
    const path = movingThrough([RegionType.Border], ['Sarn Ford']);
    let state: GameState = { ...baseState([ABDUCTOR]), phaseState: path };
    state = addCardInPlay(state, HAZARD_PLAYER, MOON);
    state = addCardInPlay(state, HAZARD_PLAYER, GATES_OF_MORNING);
    expect(keyingRegionTypes(state, ABDUCTOR)).toEqual([]);

    // Remove Gates of Morning (Moon alone remains) — the remap stops applying.
    const withoutGom: GameState = {
      ...state,
      players: [
        state.players[0],
        { ...state.players[1], cardsInPlay: state.players[1].cardsInPlay.filter(c => c.definitionId !== GATES_OF_MORNING) },
      ] as GameState['players'],
    };
    expect(keyingRegionTypes(withoutGom, ABDUCTOR)).toEqual([RegionType.Border]);
  });

  // ─── Rule 7: cannot be duplicated ──────────────────────────────────────────

  test('cannot be duplicated: a second copy of Moon is not a legal long-event play while one is in play', () => {
    const state = longEventState([MOON]);
    expect(viableActions(state, PLAYER_1, 'play-long-event').length).toBeGreaterThan(0);

    const moonInPlay = addCardInPlay(state, RESOURCE_PLAYER, MOON);
    expect(viableActions(moonInPlay, PLAYER_1, 'play-long-event')).toHaveLength(0);
  });

  test('cannot be duplicated when the opponent holds a copy in play', () => {
    const state = longEventState([MOON]);
    const opponentCopyInPlay = addCardInPlay(state, HAZARD_PLAYER, MOON);
    expect(viableActions(opponentCopyInPlay, PLAYER_1, 'play-long-event')).toHaveLength(0);
  });
});
