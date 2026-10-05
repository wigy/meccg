/**
 * @module tw-309.test
 *
 * Card test: Quiet Lands (tw-309)
 * Type: hero-resource-event (short, Environment), non-unique.
 *
 * Card text:
 *   "Environment. Until the end of the turn, the number of strikes for one
 *    automatic-attack at a Shadow-hold [{S}] or a Ruins & Lairs [{R}] is
 *    reduced by half (rounded up). Alternatively, if Gates of Morning is in
 *    play, treat one Shadow-land [{s}] as a Wilderness [{w}] or one
 *    Shadow-hold [{S}] as a Ruins & Lairs [{R}] until the end of the turn.
 *    Cannot be duplicated."
 *
 * Effects (data):
 *   - duplication-limit (scope turn, max 1).
 *   - auto-attack-strike-halving (siteTypes shadow-hold, ruins-and-lairs):
 *       offered during the site phase while the active company has not yet
 *       entered its site (enter-or-skip), one action per automatic-attack
 *       (`targetAutoAttackIndex`). Rides the chain; on resolution a turn-scoped
 *       `auto-attack-strikes-halved` constraint makes `reducer-site.ts` halve
 *       that attack's strikes (rounded up) when it is initiated.
 *   - region-transform (when Gates of Morning, duration turn, shadow →
 *       wilderness): one action per Shadow-land region.
 *   - site-transform (when Gates of Morning, duration turn, shadow-hold →
 *       ruins-and-lairs): one action per Shadow-hold that is a company's
 *       current or destination site; installs a turn-scoped `site.type`
 *       override read by `getEffectiveSiteType`.
 *   The three modes are alternatives: each action carries exactly one choice.
 *
 * | # | Rule                                                               | Status |
 * |---|--------------------------------------------------------------------|--------|
 * | 1 | Halving offered at a Shadow-hold before its automatic-attack       | OK     |
 * | 2 | Halving offered at a Ruins & Lairs; not at a Haven                 | OK     |
 * | 3 | Not offered once the automatic-attacks have been faced             | OK     |
 * | 4 | Moria's Orcs: 4 strikes → 2                                        | OK     |
 * | 5 | Bandit Lair's Men: 3 strikes → 2 (rounded up)                      | OK     |
 * | 6 | The halving lasts until end of turn (turn-scoped constraint)       | OK     |
 * | 7 | Without Gates of Morning: no region / site alternatives            | OK     |
 * | 8 | With Gates of Morning: Shadow-land → Wilderness (creature keying)  | OK     |
 * | 9 | With Gates of Morning: Shadow-hold → Ruins & Lairs (site keying)   | OK     |
 * |10 | Cannot be duplicated: a second copy is not playable this turn      | OK     |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS, GIMLI,
  GATES_OF_MORNING, ORC_GUARD,
  RIVENDELL, MORIA, BANDIT_LAIR,
  buildSitePhaseState, buildMovingToSiteState, setupAutoAttackStep, atSiteEnterOrSkip, resetMint,
  addCardInPlay, dispatch, resolveChain, viableActions, mhWindowOnPath, hazardCreatureKeyings,
} from '../test-helpers.js';
import { RegionType, SiteType } from '../../index.js';
import { getEffectiveSiteType } from '../../engine/effective.js';
import type { CardDefinitionId, PlayShortEventAction } from '../../index.js';

const QUIET_LANDS = 'tw-309' as CardDefinitionId;
/** Animal creature keyed to Border-land or Wilderness (region types only). */
const WOLVES = 'tw-114' as CardDefinitionId;
/** Orc creature keyed to Wilderness/Border-land regions or a Ruins & Lairs site. */
const ORC_RAIDERS = 'tw-75' as CardDefinitionId;
const COMPANY = [ARAGORN, LEGOLAS, GIMLI];

describe('Quiet Lands (tw-309)', () => {
  beforeEach(() => resetMint());

  // ─── Rules 1-3: when the strike-halving mode is offered ─────────────────────

  test('offered at a Shadow-hold (Moria) before its automatic-attack, once per attack', () => {
    const state = atSiteEnterOrSkip(buildSitePhaseState({ site: MORIA, hand: [QUIET_LANDS], characters: COMPANY }));
    expect(viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction).map(a => a.targetAutoAttackIndex)).toEqual([0]);
  });

  test('offered at a Ruins & Lairs (Bandit Lair), but not at a Haven', () => {
    const lair = atSiteEnterOrSkip(buildSitePhaseState({ site: BANDIT_LAIR, hand: [QUIET_LANDS], characters: COMPANY }));
    expect(viableActions(lair, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction).map(a => a.targetAutoAttackIndex)).toEqual([0]);
    const haven = atSiteEnterOrSkip(buildSitePhaseState({ site: RIVENDELL, hand: [QUIET_LANDS], characters: COMPANY }));
    expect(viableActions(haven, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction)).toHaveLength(0);
  });

  test('not offered once the company has entered and faced the automatic-attacks', () => {
    const state = buildSitePhaseState({ site: MORIA, hand: [QUIET_LANDS] }); // play-resources step
    expect(viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction).filter(a => a.targetAutoAttackIndex !== undefined)).toHaveLength(0);
  });

  // ─── Rules 4-6: the halving itself ──────────────────────────────────────────

  test('baseline: Moria\'s Orc automatic-attack has 4 strikes', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: COMPANY });
    const combat = dispatch(setupAutoAttackStep(state), { type: 'pass', player: PLAYER_1 }).combat;
    expect(combat?.strikesTotal).toBe(4);
  });

  test('Moria\'s Orc automatic-attack is halved: 4 strikes → 2', () => {
    const state = atSiteEnterOrSkip(buildSitePhaseState({ site: MORIA, hand: [QUIET_LANDS], characters: COMPANY }));
    const resolved = resolveChain(dispatch(state, viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction).find(a => a.targetAutoAttackIndex === 0)!));
    const after = dispatch(setupAutoAttackStep(resolved), { type: 'pass', player: PLAYER_1 });
    expect(after.combat?.strikesTotal).toBe(2);
    expect(after.combat?.strikeProwess).toBe(7); // prowess untouched
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === QUIET_LANDS)).toBe(true);
  });

  test('Bandit Lair\'s Men automatic-attack: 3 strikes → 2 (rounded up)', () => {
    const state = atSiteEnterOrSkip(buildSitePhaseState({ site: BANDIT_LAIR, hand: [QUIET_LANDS], characters: COMPANY }));
    const resolved = resolveChain(dispatch(state, viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction).find(a => a.targetAutoAttackIndex === 0)!));
    const after = dispatch(setupAutoAttackStep(resolved), { type: 'pass', player: PLAYER_1 });
    expect(after.combat?.strikesTotal).toBe(2);
  });

  test('the halving is a turn-scoped constraint bound to the company, site and attack', () => {
    const state = atSiteEnterOrSkip(buildSitePhaseState({ site: MORIA, hand: [QUIET_LANDS], characters: COMPANY }));
    const resolved = resolveChain(dispatch(state, viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction).find(a => a.targetAutoAttackIndex === 0)!));
    const c = resolved.activeConstraints.find(k => k.kind.type === 'auto-attack-strikes-halved');
    expect(c).toBeDefined();
    expect(c!.scope).toEqual({ kind: 'turn' });
    expect(c!.target).toEqual({ kind: 'company', companyId: state.players[RESOURCE_PLAYER].companies[0].id });
    expect(c!.kind).toEqual({ type: 'auto-attack-strikes-halved', siteDefinitionId: MORIA, attackIndex: 0 });
  });

  // ─── Rule 7: alternatives require Gates of Morning ──────────────────────────

  test('without Gates of Morning no region or site alternative is offered', () => {
    const state = buildMovingToSiteState({ destination: MORIA, hand: [QUIET_LANDS], hazards: [] });
    expect(viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction)).toHaveLength(0);
    expect(viableActions(addCardInPlay(state, RESOURCE_PLAYER, GATES_OF_MORNING), PLAYER_1, 'play-short-event').length).toBeGreaterThan(0);
  });

  test('with Gates of Morning: Shadow-land regions and the Shadow-hold destination are offered', () => {
    const state = addCardInPlay(buildMovingToSiteState({ destination: MORIA, hand: [QUIET_LANDS], hazards: [] }), RESOURCE_PLAYER, GATES_OF_MORNING);
    const offered = viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction);
    const regions = offered.filter(a => a.targetRegionName).map(a => `${a.targetRegionName}→${a.newRegionType}`);
    expect(regions).toContain('Imlad Morgul→wilderness');
    expect(regions).toContain('Angmar→wilderness');
    expect(regions).not.toContain('Rhudaur→wilderness'); // a Wilderness, not a Shadow-land
    const moriaInst = state.players[RESOURCE_PLAYER].companies[0].destinationSite!.instanceId;
    expect(offered.filter(a => a.targetSiteInstanceId)).toEqual([
      expect.objectContaining({ targetSiteInstanceId: moriaInst, newSiteType: SiteType.RuinsAndLairs }),
    ]);
  });

  // ─── Rule 8: Shadow-land → Wilderness ──────────────────────────────────────

  test('treating Imlad Morgul as a Wilderness re-keys creatures for the turn', () => {
    const state = addCardInPlay(buildMovingToSiteState({ destination: MORIA, hand: [QUIET_LANDS], hazards: [WOLVES, ORC_GUARD] }), RESOURCE_PLAYER, GATES_OF_MORNING);
    const after = resolveChain(dispatch(state, viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction).find(a => a.targetRegionName === 'Imlad Morgul')!));

    const override = after.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier' && c.kind.attribute === 'region.type',
    );
    expect(override?.scope).toEqual({ kind: 'turn' });

    const before = mhWindowOnPath(state, 'Imlad Morgul', RegionType.Shadow, SiteType.ShadowHold, 'Moria');
    expect(hazardCreatureKeyings(before, WOLVES)).toEqual([]);
    expect(hazardCreatureKeyings(before, ORC_GUARD)).toContain('region-type:shadow');

    const onPath = mhWindowOnPath(after, 'Imlad Morgul', RegionType.Shadow, SiteType.ShadowHold, 'Moria');
    expect(hazardCreatureKeyings(onPath, WOLVES)).toEqual(['region-type:wilderness']);
    expect(hazardCreatureKeyings(onPath, ORC_GUARD)).not.toContain('region-type:shadow');
  });

  // ─── Rule 9: Shadow-hold → Ruins & Lairs ────────────────────────────────────

  test('treating Moria as a Ruins & Lairs changes its effective type and site keying for the turn', () => {
    const state = addCardInPlay(buildMovingToSiteState({ destination: MORIA, hand: [QUIET_LANDS], hazards: [ORC_GUARD, ORC_RAIDERS] }), RESOURCE_PLAYER, GATES_OF_MORNING);
    const after = resolveChain(dispatch(state, viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction).find(a => a.targetSiteInstanceId)!));

    const moria = after.players[RESOURCE_PLAYER].companies[0].destinationSite!;
    expect(getEffectiveSiteType(state, MORIA, SiteType.ShadowHold, moria.instanceId)).toBe(SiteType.ShadowHold);
    expect(getEffectiveSiteType(after, MORIA, SiteType.ShadowHold, moria.instanceId)).toBe(SiteType.RuinsAndLairs);
    const override = after.activeConstraints.find(
      c => c.kind.type === 'attribute-modifier' && c.kind.attribute === 'site.type',
    );
    expect(override?.scope).toEqual({ kind: 'turn' });

    // A Wilderness path, so only the site-type keying differs.
    const before = mhWindowOnPath(state, 'Rhudaur', RegionType.Wilderness, SiteType.ShadowHold, 'Moria');
    expect(hazardCreatureKeyings(before, ORC_GUARD)).toContain('site-type:shadow-hold');
    expect(hazardCreatureKeyings(before, ORC_RAIDERS)).not.toContain('site-type:ruins-and-lairs');

    const onPath = mhWindowOnPath(after, 'Rhudaur', RegionType.Wilderness, SiteType.ShadowHold, 'Moria');
    expect(hazardCreatureKeyings(onPath, ORC_GUARD)).not.toContain('site-type:shadow-hold');
    expect(hazardCreatureKeyings(onPath, ORC_RAIDERS)).toContain('site-type:ruins-and-lairs');
  });

  // ─── Rule 10: cannot be duplicated ──────────────────────────────────────────

  test('cannot be duplicated: a second copy is not playable the same turn', () => {
    const state = atSiteEnterOrSkip(buildSitePhaseState({ site: MORIA, hand: [QUIET_LANDS, QUIET_LANDS], characters: COMPANY }));
    const after = resolveChain(dispatch(state, viableActions(state, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction).find(a => a.targetAutoAttackIndex === 0)!));
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(1);
    expect(viableActions(after, PLAYER_1, 'play-short-event').map(ea => ea.action as PlayShortEventAction)).toHaveLength(0);
  });
});
