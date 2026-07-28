/**
 * @module tw-62.test
 *
 * Card test: Morgul Night (tw-62)
 * Type: hazard-event (Long-event, Environment), non-unique.
 *
 * Card text:
 *   "Environment. Playable if Doors of Night is in play. Treat all Wildernesses
 *    [{w}] as Shadow-lands [{s}] and all Shadow-lands [{s}] as Dark-domains
 *    [{d}]. Cannot be duplicated."
 *
 * Effects:
 * | # | Effect                                   | Rule covered                                        |
 * |---|------------------------------------------|-----------------------------------------------------|
 * | 1 | play-condition (card-in-play, Doors of   | "Playable if Doors of Night is in play"             |
 * |   |   Night)                                 |                                                     |
 * | 2 | region-type-remap (wilderness→shadow,    | "Treat all Wildernesses as Shadow-lands and all     |
 * |   |   shadow→dark), **no `when` gate**       |  Shadow-lands as Dark-domains"                      |
 * | 3 | duplication-limit (scope game, max 1)    | "Cannot be duplicated"                              |
 *
 * Engine support (all shipped, precedent Fell Winter le-111 / Snowstorm tw-91):
 * - `play-condition` `requires: 'card-in-play'` gates hazard long-event play in
 *   `legal-actions/movement-hazard.ts`.
 * - `region-type-remap` reinterprets whole classes of region on a company's
 *   traversed site path before creature keying (`collectRegionTypeRemaps` /
 *   `applyRegionTypeRemaps`, region-keying.ts), consulted by both keying
 *   matchers (`findCreatureKeyingMatches`, `checkCreatureKeying`). The remap is
 *   a *replacement* applied simultaneously from each region's printed type, so
 *   a Wilderness becomes a Shadow-land and never cascades on to a Dark-domain.
 * - `duplication-limit` scope `game` blocks a second copy in play.
 *
 * Unlike Fell Winter, Morgul Night's remap carries **no** `when` gate: Doors of
 * Night is a play *condition* only ("Playable if…"), so once Morgul Night is in
 * play the reinterpretation stands on its own.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  DOORS_OF_NIGHT, ORC_GUARD,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, addCardInPlay,
  reduce, resolveChain,
  P1_COMPANY,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
  computeLegalActions,
} from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, CompanyId, PlayHazardAction,
  CreatureKeyingMatch,
} from '../../index.js';

const MORGUL_NIGHT = 'tw-62' as CardDefinitionId;
/** Awakened Plant keyed to a single Wilderness [{w}] — region type only. */
const HUORN = 'tw-45' as CardDefinitionId;

/** Resource player (PLAYER_1) holds a company; hazard player (PLAYER_2) holds the named hazards. */
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

function handInstance(state: GameState, defId: CardDefinitionId): CardInstanceId {
  return state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === defId)!.instanceId;
}

/** Every region type the creature can currently be keyed by, as offered to the hazard player. */
function keyingRegionTypes(state: GameState, defId: CardDefinitionId): string[] {
  const inst = handInstance(state, defId);
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

describe('Morgul Night (tw-62)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: "Playable if Doors of Night is in play" ───────────────────────

  test('not playable while Doors of Night is absent, playable once it is in play', () => {
    const state: GameState = {
      ...baseState([MORGUL_NIGHT]),
      phaseState: movingThrough([RegionType.Wilderness], ['Fangorn']),
    };
    const inst = handInstance(state, MORGUL_NIGHT);
    const isMorgulNightPlay = (ea: { action: { type: string } }) =>
      ea.action.type === 'play-hazard'
      && (ea.action as PlayHazardAction).cardInstanceId === inst;

    const withoutDon = computeLegalActions(state, PLAYER_2).find(isMorgulNightPlay);
    expect(withoutDon?.viable).toBe(false);
    expect(withoutDon?.reason).toMatch(/Doors of Night/);

    const withDon = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    expect(computeLegalActions(withDon, PLAYER_2).find(isMorgulNightPlay)?.viable).toBe(true);
  });

  test('resolving Morgul Night moves it from hand into the hazard player\'s cardsInPlay', () => {
    const state: GameState = addCardInPlay(
      { ...baseState([MORGUL_NIGHT]), phaseState: movingThrough([RegionType.Wilderness], ['Fangorn']) },
      HAZARD_PLAYER, DOORS_OF_NIGHT,
    );
    const inst = handInstance(state, MORGUL_NIGHT);
    const companyId: CompanyId = P1_COMPANY;
    const r = reduce(state, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: inst, targetCompanyId: companyId });
    expect(r.error).toBeUndefined();
    const after = resolveChain(r.state);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === inst)).toBe(true);
    expect(after.players[HAZARD_PLAYER].hand.some(c => c.definitionId === MORGUL_NIGHT)).toBe(false);
  });

  // ─── Rule 3: "Cannot be duplicated" ────────────────────────────────────────

  test('a second copy is blocked while one Morgul Night is already in play', () => {
    let state: GameState = {
      ...baseState([MORGUL_NIGHT]),
      phaseState: movingThrough([RegionType.Wilderness], ['Fangorn']),
    };
    // Doors of Night present, so the block can only come from the duplication limit.
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    state = addCardInPlay(state, HAZARD_PLAYER, MORGUL_NIGHT);
    const inst = handInstance(state, MORGUL_NIGHT);
    const dup = computeLegalActions(state, PLAYER_2).find(
      ea => ea.action.type === 'play-hazard' && ea.action.cardInstanceId === inst,
    );
    expect(dup?.viable).toBe(false);
    expect(dup?.reason).toMatch(/duplicat/i);
  });

  // ─── Rule 2a: all Wildernesses count as Shadow-lands ───────────────────────

  test('a {s}/{d}-keyed creature is unplayable on a Wilderness path, and keyable once Morgul Night is in play', () => {
    const path = movingThrough([RegionType.Wilderness], ['Fangorn']);
    let state: GameState = { ...baseState([ORC_GUARD]), phaseState: path };
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([]);

    state = addCardInPlay(state, HAZARD_PLAYER, MORGUL_NIGHT);
    // The Wilderness is now a Shadow-land — and only a Shadow-land: the remap is
    // applied from the printed type, so it never cascades on to a Dark-domain.
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([RegionType.Shadow]);
  });

  test('Wildernesses stop counting as Wildernesses — a {w}-keyed creature loses its keying', () => {
    const path = movingThrough([RegionType.Wilderness], ['Fangorn']);
    let state: GameState = { ...baseState([HUORN]), phaseState: path };
    expect(keyingRegionTypes(state, HUORN)).toEqual([RegionType.Wilderness]);

    state = addCardInPlay(state, HAZARD_PLAYER, MORGUL_NIGHT);
    expect(keyingRegionTypes(state, HUORN)).toEqual([]);
  });

  // ─── Rule 2b: all Shadow-lands count as Dark-domains ───────────────────────

  test('a Shadow-land path is keyed as a Dark-domain instead of a Shadow-land', () => {
    const path = movingThrough([RegionType.Shadow], ['Dagorlad']);
    let state: GameState = { ...baseState([ORC_GUARD]), phaseState: path };
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([RegionType.Shadow]);

    state = addCardInPlay(state, HAZARD_PLAYER, MORGUL_NIGHT);
    // Replacement, not addition: the Shadow-land *is* a Dark-domain now.
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([RegionType.Dark]);
  });

  test('both substitutions apply simultaneously across a mixed path', () => {
    const path = movingThrough(
      [RegionType.Wilderness, RegionType.Shadow],
      ['Fangorn', 'Dagorlad'],
    );
    let state: GameState = { ...baseState([ORC_GUARD]), phaseState: path };
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([RegionType.Shadow]);

    state = addCardInPlay(state, HAZARD_PLAYER, MORGUL_NIGHT);
    // Wilderness→Shadow-land and Shadow-land→Dark-domain resolve together, so
    // the path offers both keys at once (dark, shadow — sorted).
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([RegionType.Dark, RegionType.Shadow].sort());
  });

  // ─── Doors of Night is a play condition only, not a standing requirement ────

  test('the remap keeps working after Doors of Night has left play', () => {
    // Morgul Night in play, Doors of Night gone: unlike Fell Winter (whose remap
    // carries a `when` gate), Morgul Night only needed Doors of Night to be
    // played — the reinterpretation then stands on its own.
    const path = movingThrough([RegionType.Wilderness], ['Fangorn']);
    const state: GameState = addCardInPlay(
      { ...baseState([ORC_GUARD]), phaseState: path },
      HAZARD_PLAYER, MORGUL_NIGHT,
    );
    expect(state.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === DOORS_OF_NIGHT)).toBe(false);
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([RegionType.Shadow]);
  });

  // ─── The reducer agrees with the offer (write path uses the same remap) ─────

  test('the reducer accepts the remapped keying it offered', () => {
    const path = movingThrough([RegionType.Wilderness], ['Fangorn']);
    const state: GameState = addCardInPlay(
      { ...baseState([ORC_GUARD]), phaseState: path },
      HAZARD_PLAYER, MORGUL_NIGHT,
    );
    const inst = handInstance(state, ORC_GUARD);
    const r = reduce(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: inst,
      targetCompanyId: P1_COMPANY,
      keyedBy: { method: 'region-type', value: RegionType.Shadow },
    });
    expect(r.error).toBeUndefined();
  });

  test('the reducer still rejects a creature the remap does not key', () => {
    const path = movingThrough([RegionType.Wilderness], ['Fangorn']);
    const state: GameState = addCardInPlay(
      { ...baseState([HUORN]), phaseState: path },
      HAZARD_PLAYER, MORGUL_NIGHT,
    );
    const inst = handInstance(state, HUORN);
    const r = reduce(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: inst,
      targetCompanyId: P1_COMPANY,
      keyedBy: { method: 'region-type', value: RegionType.Wilderness },
    });
    expect(r.error).toBeDefined();
  });
});
