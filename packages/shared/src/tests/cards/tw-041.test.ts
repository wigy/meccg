/**
 * @module tw-041.test
 *
 * Card test: Gloom (tw-41)
 * Type: hazard-event (short, environment)
 *
 * "Environment. Playable only on a company that is moving this turn. One
 *  character (attacker's choice) in that company suffers -1 to his prowess
 *  until the end of the turn. Alternatively, if Doors of Night is in play,
 *  treat one Border-land [{b}] as a Wilderness [{w}] or one Border-hold [{B}]
 *  as a Ruins & Lairs [{R}] until the end of the turn. Cannot be duplicated."
 *
 * The two modes are mutually exclusive ("Alternatively"):
 * - Mode A (`play-target` `target: "character"`, filter `{ "company.moving":
 *   true }` + `on-event self-enters-play` → `character-stat-modifier` prowess
 *   -1, scope turn): one action per character in the moving company — the
 *   hazard player's ("attacker's") choice. Not offered at all when the
 *   company is not moving.
 * - Mode B (`on-event company-arrives-at-site` → `region-type-override` /
 *   `site-type-override`): with Doors of Night in play, a single untargeted
 *   action reinterprets the destination Border-land as a Wilderness, or the
 *   destination Border-hold as a Ruins & Lairs, for the turn. Suppressed
 *   whenever a character was targeted (Mode A chosen).
 * - `duplication-limit` scope:turn max:1 — "Cannot be duplicated".
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, resolveChain, viableActions,
  makeMHState, handCardId, findCharInstanceId, playHazardAndResolve,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER, P1_COMPANY,
} from '../test-helpers.js';
import { Phase, SiteType, RegionType, CardStatus } from '../../index.js';
import type { GameState, MovementHazardPhaseState, CardInstanceId, CardDefinitionId } from '../../index.js';

const GLOOM = 'tw-41' as CardDefinitionId;
const ARAGORN = 'tw-120' as CardDefinitionId;    // base prowess 6
const LEGOLAS = 'tw-168' as CardDefinitionId;
const DOORS_OF_NIGHT = 'tw-28' as CardDefinitionId;
const RIVENDELL = 'tw-421' as CardDefinitionId;  // haven (origin)
const MINAS_TIRITH = 'tw-412' as CardDefinitionId; // free-hold
const BREE = 'tw-378' as CardDefinitionId;       // border-hold
const MORIA = 'tw-413' as CardDefinitionId;

/** Doors-of-Night in the hazard player's cardsInPlay. */
const donInPlay = {
  instanceId: 'don-1' as CardInstanceId,
  definitionId: DOORS_OF_NIGHT,
  status: CardStatus.Untapped,
};

/** targetCharacterId of a play-hazard evaluated action (undefined = Mode B). */
function targetOf(a: { action: unknown }): CardInstanceId | undefined {
  return (a.action as { targetCharacterId?: CardInstanceId }).targetCharacterId;
}

describe('Gloom (tw-41)', () => {
  beforeEach(() => resetMint());

  // ─── Mode A: -1 prowess to one character (attacker's choice) ──────────────

  test('Mode A — offers one action per character in the moving company', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS], destinationSite: BREE }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [GLOOM], siteDeck: [MORIA] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({ destinationSiteType: SiteType.BorderHold, resolvedSitePath: [RegionType.Border] }),
    };

    const aragornId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, LEGOLAS);
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');

    expect(actions).toHaveLength(2);
    expect(actions.some(a => targetOf(a) === aragornId)).toBe(true);
    expect(actions.some(a => targetOf(a) === legolasId)).toBe(true);
  });

  test('not playable at all on a company that is not moving (no Doors of Night)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [GLOOM], siteDeck: [MORIA] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({}),
    };

    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });

  test('Mode A — applies -1 prowess to the chosen character only, until end of turn', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS], destinationSite: BREE }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [GLOOM], siteDeck: [MORIA] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({ destinationSiteType: SiteType.BorderHold, resolvedSitePath: [RegionType.Border] }),
    };

    const aragornId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, ARAGORN);
    const legolasId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, LEGOLAS);
    expect(mhGameState.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess).toBe(6);

    const gloomId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = dispatch(mhGameState, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: gloomId,
      targetCompanyId: P1_COMPANY, targetCharacterId: aragornId,
    });
    const resolved = resolveChain(afterPlay);

    expect(resolved.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess).toBe(5);
    // Legolas untouched.
    const legolasBase = mhGameState.players[RESOURCE_PLAYER].characters[legolasId].effectiveStats.prowess;
    expect(resolved.players[RESOURCE_PLAYER].characters[legolasId].effectiveStats.prowess).toBe(legolasBase);
    // Short event went to the hazard player's discard pile.
    expect(resolved.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(resolved.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId)).toContain(gloomId);
  });

  // ─── Mode B: Doors-of-Night region/site type overrides ────────────────────

  test('Mode B — Doors of Night + Border-land destination region: region-type-override to Wilderness', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        // Empty company — isolates Mode B (no Mode A candidates to target).
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [], destinationSite: MINAS_TIRITH }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [GLOOM], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.FreeHold,
        destinationSiteName: 'Minas Tirith',
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Anórien'],
      }),
    };

    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(1);
    expect(targetOf(actions[0])).toBeUndefined();

    const gloomId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, gloomId, P1_COMPANY);

    const regionOverride = afterPlay.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'region.type',
    );
    expect(regionOverride).toBeDefined();
    if (regionOverride!.kind.type === 'attribute-modifier') {
      expect(regionOverride!.kind.op).toBe('override');
      expect(regionOverride!.kind.value).toBe(RegionType.Wilderness);
      expect(regionOverride!.kind.filter).toEqual({ 'region.name': 'Anórien' });
    }
    expect(afterPlay.activeConstraints.some(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type')).toBe(false);
  });

  test('Mode B — Doors of Night + Border-hold destination site: site-type-override to Ruins & Lairs', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [], destinationSite: BREE }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [GLOOM], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
        resolvedSitePath: [RegionType.Wilderness],
        resolvedSitePathNames: ['Eriador'],
      }),
    };

    const gloomId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = playHazardAndResolve(mhGameState, PLAYER_2, gloomId, P1_COMPANY);

    const siteOverride = afterPlay.activeConstraints.find(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type',
    );
    expect(siteOverride).toBeDefined();
    if (siteOverride!.kind.type === 'attribute-modifier') {
      expect(siteOverride!.kind.op).toBe('override');
      expect(siteOverride!.kind.value).toBe(SiteType.RuinsAndLairs);
    }
    expect(afterPlay.activeConstraints.some(c =>
      c.kind.type === 'attribute-modifier' && c.kind.attribute === 'region.type')).toBe(false);
  });

  // ─── "Alternatively" — modes are mutually exclusive ───────────────────────

  test('choosing Mode A suppresses the arrival-override even when both would apply', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: BREE }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [GLOOM], siteDeck: [MORIA], cardsInPlay: [donInPlay] },
      ],
    });
    const mhGameState: GameState = {
      ...state,
      phaseState: makeMHState({
        destinationSiteType: SiteType.BorderHold,
        destinationSiteName: 'Bree',
        resolvedSitePath: [RegionType.Border],
        resolvedSitePathNames: ['Eriador'],
      }),
    };

    const aragornId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, ARAGORN);
    // Both a Mode A (target Aragorn) and a Mode B (override) action are offered.
    const actions = viableActions(mhGameState, PLAYER_2, 'play-hazard');
    expect(actions.some(a => targetOf(a) === aragornId)).toBe(true);
    expect(actions.some(a => targetOf(a) === undefined)).toBe(true);

    const gloomId = handCardId(mhGameState, HAZARD_PLAYER);
    const afterPlay = dispatch(mhGameState, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: gloomId,
      targetCompanyId: P1_COMPANY, targetCharacterId: aragornId,
    });
    const resolved = resolveChain(afterPlay);

    // Aragorn's prowess dropped, and NO region/site override was installed.
    expect(resolved.players[RESOURCE_PLAYER].characters[aragornId].effectiveStats.prowess).toBe(5);
    expect(resolved.activeConstraints.some(c =>
      c.kind.type === 'attribute-modifier'
      && (c.kind.attribute === 'site.type' || c.kind.attribute === 'region.type'))).toBe(false);
  });

  // ─── Cannot be duplicated ─────────────────────────────────────────────────

  test('cannot be duplicated — second copy rejected after the first resolves (turn constraint persists)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: BREE }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [GLOOM, GLOOM], siteDeck: [MORIA] },
      ],
    });
    const mh: MovementHazardPhaseState = makeMHState({
      destinationSiteType: SiteType.BorderHold,
      resolvedSitePath: [RegionType.Border],
    });
    const mhGameState: GameState = { ...state, phaseState: mh };

    const aragornId = findCharInstanceId(mhGameState, RESOURCE_PLAYER, ARAGORN);
    const firstId = handCardId(mhGameState, HAZARD_PLAYER, 0);
    const afterPlay = dispatch(mhGameState, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: firstId,
      targetCompanyId: P1_COMPANY, targetCharacterId: aragornId,
    });
    const afterResolve = resolveChain(afterPlay);
    expect(afterResolve.chain).toBeNull();
    expect(afterResolve.activeConstraints.some(c => c.sourceDefinitionId === GLOOM)).toBe(true);

    const actions = viableActions(afterResolve, PLAYER_2, 'play-hazard');
    expect(actions).toHaveLength(0);
  });
});
