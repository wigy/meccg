/**
 * @module tw-241.test
 *
 * Card test: Fog (tw-241)
 * Type: hero-resource-event (Long-event, Environment), non-unique.
 *
 * Card text:
 *   "Environment. Playable only if Gates of Morning is in play. Treat all
 *    Free-domains [{f}] as Border-lands [{b}] and all Border-lands [{b}] as
 *    Wildernesses [{w}] and all Shadow-lands [{s}] as Wildernesses [{w}] and
 *    all Dark-domains [{d}] as Shadow-lands [{s}]. Cannot be duplicated."
 *
 * Effects:
 * | # | Effect                                        | Rule covered                             |
 * |---|------------------------------------------------|-------------------------------------------|
 * | 1 | play-condition (card-in-play, Gates of Morning) | "Playable only if Gates of Morning is in play" |
 * | 2 | region-type-remap (free→border, border→         | "Treat all Free-domains as Border-lands…"  |
 * |   |   wilderness, shadow→wilderness, dark→shadow),  |                                             |
 * |   |   **no `when` gate**                            |                                             |
 * | 3 | duplication-limit (scope game, max 1)           | "Cannot be duplicated"                     |
 *
 * Engine support (all shipped, precedent Morgul Night tw-62 / Fell Winter
 * le-111 / Snowstorm tw-91):
 * - `play-condition` `requires: 'card-in-play'` now also gates hero-resource
 *   long-event play in `legal-actions/long-event.ts` (added for this card —
 *   the check previously existed only for hazard long-events, resource
 *   short-events and resource permanent-events).
 * - `region-type-remap` reinterprets whole classes of region on a company's
 *   traversed site path before creature keying (`collectRegionTypeRemaps` /
 *   `applyRegionTypeRemaps`, region-keying.ts), consulted by both keying
 *   matchers (`findCreatureKeyingMatches`, `checkCreatureKeying`). The remap
 *   scans **either** player's `cardsInPlay`, so a hero-resource-event carrying
 *   it behaves identically to a hazard-event. The remap is a *replacement*
 *   applied simultaneously from each region's printed type — a Free-domain
 *   becomes a Border-land and never cascades on to a Wilderness.
 * - `duplication-limit` scope `game` blocks a second copy in play.
 *
 * Unlike Fell Winter, Fog's remap carries **no** `when` gate: Gates of Morning
 * is a play *condition* only ("Playable only if…"), so once Fog is in play the
 * reinterpretation stands on its own (mirrors Morgul Night / Doors of Night).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, ORC_GUARD,
  GATES_OF_MORNING,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildTestState, resetMint,
  makeMHState, addCardInPlay,
  reduce, actionAs,
  playLongEventAndResolve, viableActions,
  P1_COMPANY,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
  computeLegalActions,
} from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, PlayHazardAction, PlayLongEventAction,
  NotPlayableAction, CreatureKeyingMatch, EvaluatedAction,
} from '../../index.js';

const FOG = 'tw-241' as CardDefinitionId;
/** Man hazard-creature keyed to a single Border-land [{b}] — region type only. */
const ABDUCTOR = 'tw-1' as CardDefinitionId;
/** Awakened Plant keyed to a single Wilderness [{w}] — region type only. */
const HUORN = 'tw-45' as CardDefinitionId;
/** Unique Troll keyed to a single Dark-domain [{d}] — region type only. */
const GOTHMOG = 'td-28' as CardDefinitionId;

/** Resource player (PLAYER_1) holds Fog and a company; hazard player (PLAYER_2) holds the named hazards. */
function baseState(resourceHand: CardDefinitionId[], hazardHand: CardDefinitionId[] = []): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.LongEvent,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: resourceHand, siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hazardHand, siteDeck: [RIVENDELL] },
    ],
  });
}

function resourceHandInstance(state: GameState, defId: CardDefinitionId): CardInstanceId {
  return state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === defId)!.instanceId;
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

describe('Fog (tw-241)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: "Playable only if Gates of Morning is in play" ────────────────

  test('not playable while Gates of Morning is absent, playable once it is in play', () => {
    const state = baseState([FOG]);
    const inst = resourceHandInstance(state, FOG);
    const isFogAction = (ea: EvaluatedAction) => {
      if (ea.action.type === 'not-playable') return actionAs<NotPlayableAction>(ea.action).cardInstanceId === inst;
      if (ea.action.type === 'play-long-event') return actionAs<PlayLongEventAction>(ea.action).cardInstanceId === inst;
      return false;
    };

    const withoutGom = computeLegalActions(state, PLAYER_1).find(isFogAction);
    expect(withoutGom?.viable).toBe(false);
    expect(withoutGom?.action.type).toBe('not-playable');
    expect(withoutGom?.reason).toMatch(/Gates of Morning/);

    const withGom = addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING);
    const withGomAction = computeLegalActions(withGom, PLAYER_1).find(isFogAction);
    expect(withGomAction?.viable).toBe(true);
    expect(withGomAction?.action.type).toBe('play-long-event');
  });

  test('resolving Fog moves it from hand into the resource player\'s cardsInPlay', () => {
    const state = addCardInPlay(baseState([FOG]), RESOURCE_PLAYER, GATES_OF_MORNING);
    const inst = resourceHandInstance(state, FOG);
    const after = playLongEventAndResolve(state, PLAYER_1, inst);
    expect(after.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === inst)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === FOG)).toBe(false);
  });

  // ─── Rule 3: "Cannot be duplicated" ─────────────────────────────────────────

  test('a second copy is blocked while one Fog is already in play', () => {
    let state = addCardInPlay(baseState([FOG]), RESOURCE_PLAYER, GATES_OF_MORNING);
    // Gates of Morning present, so the block can only come from the duplication limit.
    state = addCardInPlay(state, RESOURCE_PLAYER, FOG);
    const actions = viableActions(state, PLAYER_1, 'play-long-event');
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated when the opponent has a copy in play', () => {
    let state = addCardInPlay(baseState([FOG]), RESOURCE_PLAYER, GATES_OF_MORNING);
    state = addCardInPlay(state, HAZARD_PLAYER, FOG);
    const actions = viableActions(state, PLAYER_1, 'play-long-event');
    expect(actions).toHaveLength(0);
  });

  // ─── Rule 2a: all Free-domains count as Border-lands ────────────────────────

  test('a {b}-keyed creature is unplayable on a Free-domain path, and keyable once Fog is in play', () => {
    const path = movingThrough([RegionType.Free], ['The Shire']);
    let state: GameState = { ...baseState([], [ABDUCTOR]), phaseState: path };
    expect(keyingRegionTypes(state, ABDUCTOR)).toEqual([]);

    state = addCardInPlay(state, RESOURCE_PLAYER, FOG);
    // The Free-domain is now a Border-land — and only a Border-land: the remap
    // is applied from the printed type, so it never cascades on to a Wilderness.
    expect(keyingRegionTypes(state, ABDUCTOR)).toEqual([RegionType.Border]);
  });

  // ─── Rule 2b: all Border-lands count as Wildernesses ────────────────────────

  test('a {w}-keyed creature is unplayable on a Border-land path, and keyable once Fog is in play', () => {
    const path = movingThrough([RegionType.Border], ['Sarn Ford']);
    let state: GameState = { ...baseState([], [HUORN]), phaseState: path };
    expect(keyingRegionTypes(state, HUORN)).toEqual([]);

    state = addCardInPlay(state, RESOURCE_PLAYER, FOG);
    expect(keyingRegionTypes(state, HUORN)).toEqual([RegionType.Wilderness]);
  });

  // ─── Rule 2c: all Shadow-lands count as Wildernesses ────────────────────────

  test('Shadow-lands stop counting as Shadow-lands — a {w}-keyed creature gains keying, a {s}/{d}-keyed one loses its keying', () => {
    const path = movingThrough([RegionType.Shadow], ['Dagorlad']);
    let state: GameState = { ...baseState([], [HUORN, ORC_GUARD]), phaseState: path };
    expect(keyingRegionTypes(state, HUORN)).toEqual([]);
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([RegionType.Shadow]);

    state = addCardInPlay(state, RESOURCE_PLAYER, FOG);
    // Replacement, not addition: the Shadow-land *is* a Wilderness now, so the
    // {w}-keyed creature gains keying while the {s}/{d}-keyed one loses it.
    expect(keyingRegionTypes(state, HUORN)).toEqual([RegionType.Wilderness]);
    expect(keyingRegionTypes(state, ORC_GUARD)).toEqual([]);
  });

  // ─── Rule 2d: all Dark-domains count as Shadow-lands ────────────────────────

  test('Dark-domains stop counting as Dark-domains — a {d}-only-keyed creature loses its keying', () => {
    const path = movingThrough([RegionType.Dark], ['Dagorlad']);
    let state: GameState = { ...baseState([], [GOTHMOG]), phaseState: path };
    expect(keyingRegionTypes(state, GOTHMOG)).toEqual([RegionType.Dark]);

    state = addCardInPlay(state, RESOURCE_PLAYER, FOG);
    expect(keyingRegionTypes(state, GOTHMOG)).toEqual([]);
  });

  test('all four substitutions apply simultaneously across a mixed path', () => {
    const path = movingThrough(
      [RegionType.Free, RegionType.Border, RegionType.Shadow, RegionType.Dark],
      ['The Shire', 'Sarn Ford', 'Dagorlad', 'Udûn'],
    );
    let state: GameState = { ...baseState([], [ABDUCTOR, HUORN, GOTHMOG]), phaseState: path };
    expect(keyingRegionTypes(state, ABDUCTOR)).toEqual([RegionType.Border]);
    expect(keyingRegionTypes(state, HUORN)).toEqual([]);
    expect(keyingRegionTypes(state, GOTHMOG)).toEqual([RegionType.Dark]);

    state = addCardInPlay(state, RESOURCE_PLAYER, FOG);
    // free→border, border→wilderness, shadow→wilderness, dark→shadow, all at once.
    expect(keyingRegionTypes(state, ABDUCTOR)).toEqual([RegionType.Border]);
    expect(keyingRegionTypes(state, HUORN)).toEqual([RegionType.Wilderness]);
    expect(keyingRegionTypes(state, GOTHMOG)).toEqual([]);
  });

  // ─── Gates of Morning is a play condition only, not a standing requirement ──

  test('the remap keeps working after Gates of Morning has left play', () => {
    // Fog in play, Gates of Morning gone: only needed to be in play at the
    // moment Fog was played — the reinterpretation then stands on its own.
    const path = movingThrough([RegionType.Free], ['The Shire']);
    const state: GameState = addCardInPlay(
      { ...baseState([], [ABDUCTOR]), phaseState: path },
      RESOURCE_PLAYER, FOG,
    );
    expect(state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === GATES_OF_MORNING)).toBe(false);
    expect(keyingRegionTypes(state, ABDUCTOR)).toEqual([RegionType.Border]);
  });

  // ─── The reducer agrees with the offer (write path uses the same remap) ────

  test('the reducer accepts the remapped keying it offered', () => {
    const path = movingThrough([RegionType.Free], ['The Shire']);
    const state: GameState = addCardInPlay(
      { ...baseState([], [ABDUCTOR]), phaseState: path },
      RESOURCE_PLAYER, FOG,
    );
    const inst = hazardHandInstance(state, ABDUCTOR);
    const r = reduce(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: inst,
      targetCompanyId: P1_COMPANY,
      keyedBy: { method: 'region-type', value: RegionType.Border },
    });
    expect(r.error).toBeUndefined();
  });

  test('the reducer still rejects a creature the remap does not key', () => {
    const path = movingThrough([RegionType.Dark], ['Udûn']);
    const state: GameState = addCardInPlay(
      { ...baseState([], [GOTHMOG]), phaseState: path },
      RESOURCE_PLAYER, FOG,
    );
    const inst = hazardHandInstance(state, GOTHMOG);
    const r = reduce(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: inst,
      targetCompanyId: P1_COMPANY,
      keyedBy: { method: 'region-type', value: RegionType.Dark },
    });
    expect(r.error).toBeDefined();
  });
});
