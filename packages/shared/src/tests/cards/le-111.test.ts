/**
 * @module le-111.test
 *
 * Card test: Fell Winter (le-111)
 * Type: hazard-event (long-event, Environment), non-unique.
 *
 * Card text:
 *   "Environment. Each Border-hold [{B}] receives an additional
 *    automatic-attack: Wolves — 3 strikes with 7 prowess. Additionally, if
 *    Doors of Night is in play, treat all Free-domains [{f}] as Border-lands
 *    [{b}] and all Border-lands [{b}] as Wildernesses [{w}]. Cannot be
 *    duplicated."
 *
 * Effects:
 * | # | Effect                        | Rule covered                                            |
 * |---|-------------------------------|---------------------------------------------------------|
 * | 1 | permanent-event-auto-attack   | every Border-hold gains a Wolves 3×7 automatic-attack   |
 * |   |   (siteType: border-hold)     | (matched by printed site type, not a fixed site list)   |
 * | 2 | region-type-remap             | while Doors of Night is in play, all Free-domains count |
 * |   |   (when: DoN in play)         | as Border-lands and all Border-lands as Wildernesses    |
 * |   |                               | for creature keying (simultaneous, never cascading)     |
 * | 3 | duplication-limit (game)      | "Cannot be duplicated"                                  |
 *
 * Engine support:
 * - `permanent-event-auto-attack` now accepts a `siteType` targeting every site
 *   of that printed type (generalizes the fixed-`siteIds` Spawn augmentations),
 *   collected in `collectPermanentEventAttacks` (manifestations.ts).
 * - `region-type-remap` reinterprets whole classes of region on a company's
 *   traversed site path before creature keying, gated live on `inPlay`
 *   (`collectRegionTypeRemaps` / `applyRegionTypeRemaps`, region-keying.ts),
 *   consulted by both keying matchers.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  DOORS_OF_NIGHT,
  MORIA, LORIEN, RIVENDELL, MINAS_TIRITH,
  CardStatus,
  buildTestState, resetMint,
  makeMHState, addCardInPlay,
  buildSitePhaseState, addP2CardsInPlay, setupAutoAttackStep, dispatch,
  viableActions, reduce, resolveChain,
  P1_COMPANY,
  HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  Phase, Alignment, RegionType, SiteType,
  computeLegalActions,
} from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CardInPlay, GameState, CompanyId,
} from '../../index.js';

const FELL_WINTER = 'le-111' as CardDefinitionId;
const BREE = 'tw-378' as CardDefinitionId;          // Border-hold, no printed auto-attacks
const GIANT = 'tw-39' as CardDefinitionId;          // keyed {w}{w} (region type only)
const ABDUCTOR = 'tw-1' as CardDefinitionId;        // keyed {b} OR at a Border-hold

const fellWinterInPlay: CardInPlay = {
  instanceId: 'fw-1' as CardInstanceId,
  definitionId: FELL_WINTER,
  status: CardStatus.Untapped,
};

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

function creaturePlayable(state: GameState, defId: CardDefinitionId): boolean {
  const inst = handInstance(state, defId);
  return computeLegalActions(state, PLAYER_2).some(
    ea => ea.action.type === 'play-hazard' && ea.action.cardInstanceId === inst && ea.viable,
  );
}

describe('Fell Winter (le-111)', () => {
  beforeEach(() => resetMint());

  // ─── Playability + duplication ─────────────────────────────────────────────

  test('playable as a hazard long-event during the M/H play-hazards step', () => {
    const state: GameState = { ...baseState([FELL_WINTER]), phaseState: makeMHState() };
    const actions = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === handInstance(state, FELL_WINTER));
    expect(actions.length).toBeGreaterThan(0);
  });

  test('resolving Fell Winter places it into the hazard player\'s cardsInPlay', () => {
    const state: GameState = { ...baseState([FELL_WINTER]), phaseState: makeMHState() };
    const inst = handInstance(state, FELL_WINTER);
    const companyId: CompanyId = P1_COMPANY;
    const r = reduce(state, { type: 'play-hazard', player: PLAYER_2, cardInstanceId: inst, targetCompanyId: companyId });
    expect(r.error).toBeUndefined();
    const after = resolveChain(r.state);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === inst)).toBe(true);
    expect(after.players[HAZARD_PLAYER].hand.some(c => c.definitionId === FELL_WINTER)).toBe(false);
  });

  test('cannot be duplicated — blocked while another Fell Winter is in play', () => {
    let state: GameState = { ...baseState([FELL_WINTER]), phaseState: makeMHState() };
    state = addCardInPlay(state, HAZARD_PLAYER, FELL_WINTER);
    const inst = handInstance(state, FELL_WINTER);
    const actions = viableActions(state, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.action.cardInstanceId === inst);
    expect(actions).toHaveLength(0);
  });

  // ─── Rule 1: additional Wolves 3×7 automatic-attack at every Border-hold ────

  test('a Border-hold (Bree) gains a Wolves 3×7 automatic-attack while Fell Winter is in play', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: BREE, characters: [ARAGORN] }), [fellWinterInPlay]),
    );
    const next = dispatch(base, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(7);
  });

  test('without Fell Winter, the same Border-hold has no automatic-attack', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: BREE, characters: [ARAGORN] }));
    const next = dispatch(base, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
  });

  test('a non-Border-hold (free-hold Minas Tirith) gains no Wolves attack from Fell Winter', () => {
    const base = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: MINAS_TIRITH, characters: [ARAGORN] }), [fellWinterInPlay]),
    );
    const next = dispatch(base, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
  });

  // ─── Rule 2: region-type remap for creature keying (needs Doors of Night) ───

  test('a {w}{w} creature is NOT playable on a two-Border-land path without Fell Winter', () => {
    const state: GameState = { ...baseState([GIANT]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Border, RegionType.Border],
      resolvedSitePathNames: ['Andrast', 'Enedwaith'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    expect(creaturePlayable(state, GIANT)).toBe(false);
  });

  test('Fell Winter alone (no Doors of Night) does NOT remap Border-lands', () => {
    let state: GameState = { ...baseState([GIANT]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Border, RegionType.Border],
      resolvedSitePathNames: ['Andrast', 'Enedwaith'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    state = addCardInPlay(state, HAZARD_PLAYER, FELL_WINTER);
    expect(creaturePlayable(state, GIANT)).toBe(false);
  });

  test('Fell Winter + Doors of Night: all Border-lands count as Wildernesses, so a {w}{w} creature becomes playable', () => {
    let state: GameState = { ...baseState([GIANT]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Border, RegionType.Border],
      resolvedSitePathNames: ['Andrast', 'Enedwaith'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    state = addCardInPlay(state, HAZARD_PLAYER, FELL_WINTER);
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    expect(creaturePlayable(state, GIANT)).toBe(true);
    // It is keyed via a (remapped) wilderness region-type.
    const inst = handInstance(state, GIANT);
    const act = computeLegalActions(state, PLAYER_2).find(
      ea => ea.action.type === 'play-hazard' && ea.action.cardInstanceId === inst && ea.viable,
    );
    const keyed = (act!.action as { keyedBy?: { method: string; value: string } }).keyedBy;
    expect(keyed).toEqual({ method: 'region-type', value: RegionType.Wilderness });
  });

  test('Fell Winter + Doors of Night: all Free-domains count as Border-lands, so a Border-keyed creature becomes playable on a Free-domain path', () => {
    let state: GameState = { ...baseState([ABDUCTOR]), phaseState: makeMHState({
      resolvedSitePath: [RegionType.Free],
      resolvedSitePathNames: ['Lamedon'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    }) };
    // Control: without the environment, a Free-domain path keys neither the
    // {b} entry nor the border-hold entry (destination is Ruins & Lairs).
    expect(creaturePlayable(state, ABDUCTOR)).toBe(false);
    state = addCardInPlay(state, HAZARD_PLAYER, FELL_WINTER);
    state = addCardInPlay(state, HAZARD_PLAYER, DOORS_OF_NIGHT);
    expect(creaturePlayable(state, ABDUCTOR)).toBe(true);
    const inst = handInstance(state, ABDUCTOR);
    const act = computeLegalActions(state, PLAYER_2).find(
      ea => ea.action.type === 'play-hazard' && ea.action.cardInstanceId === inst && ea.viable,
    );
    const keyed = (act!.action as { keyedBy?: { method: string; value: string } }).keyedBy;
    expect(keyed).toEqual({ method: 'region-type', value: RegionType.Border });
  });

  test('the remap is simultaneous, not cascading: a Free-domain becomes a Border-land, never a Wilderness', () => {
    // A {w}{w} creature on a two-Free-domain path stays unplayable even with
    // Fell Winter + Doors of Night: Free→Border (each mapped from its printed
    // type), so the path is Border-lands, not Wildernesses.
    const twoFreePath = makeMHState({
      resolvedSitePath: [RegionType.Free, RegionType.Free],
      resolvedSitePathNames: ['Lamedon', 'Anfalas'],
      destinationSiteType: SiteType.RuinsAndLairs, destinationSiteName: 'Moria',
    });
    let giantState: GameState = { ...baseState([GIANT]), phaseState: twoFreePath };
    giantState = addCardInPlay(giantState, HAZARD_PLAYER, FELL_WINTER);
    giantState = addCardInPlay(giantState, HAZARD_PLAYER, DOORS_OF_NIGHT);
    expect(creaturePlayable(giantState, GIANT)).toBe(false);
    // ...but a Border-keyed creature IS playable on that same remapped path.
    let abductorState: GameState = { ...baseState([ABDUCTOR]), phaseState: twoFreePath };
    abductorState = addCardInPlay(abductorState, HAZARD_PLAYER, FELL_WINTER);
    abductorState = addCardInPlay(abductorState, HAZARD_PLAYER, DOORS_OF_NIGHT);
    expect(creaturePlayable(abductorState, ABDUCTOR)).toBe(true);
  });
});
