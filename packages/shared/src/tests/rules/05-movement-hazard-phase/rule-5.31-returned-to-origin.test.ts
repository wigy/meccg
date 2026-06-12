/**
 * @module rule-5.31-returned-to-origin
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.31: Company Returned to Origin
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a company is returned to its site of origin during its movement/hazard phase, the company's movement/hazard phase immediately ends and no more actions can be taken during it, the company is no longer considered to have a site path nor to have moved to a site this turn, and the company's player cannot initiate any actions during that company's site phase.
 *
 * Enforcement: an in-play environment carrying a `force-return-to-origin`
 * effect (Snowstorm tw-91, Long Winter le-117, Foul Fumes tw-36) is evaluated
 * against each moving company at the end of that company's M/H phase. When the
 * effect's terrain condition matches the company's site path (and no ranger
 * exemption applies), the company does not move: it stays at its current site,
 * `moved` stays false, its site path is cleared, and a `site-phase-do-nothing`
 * constraint blocks its site phase.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint, dispatch, buildForceReturnMHState, Phase,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, LEGOLAS,
  MINAS_TIRITH, HENNETH_ANNUN,
} from '../../test-helpers.js';
import { RegionType } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';

/** Snowstorm: force-return-to-origin when ≥1 Wilderness, no ranger exception. */
const SNOWSTORM = 'tw-91' as CardDefinitionId;
/** Long Winter: force-return-to-origin when ≥2 Wilderness, ranger exception. */
const LONG_WINTER = 'le-117' as CardDefinitionId;

describe('Rule 5.31 — Company Returned to Origin', () => {
  beforeEach(() => resetMint());

  test('moving company whose site path matches a force-return environment stays at its origin', () => {
    const { state, originInstanceId, companyId } = buildForceReturnMHState(
      [ARAGORN], [RegionType.Wilderness], SNOWSTORM,
    );

    const afterPass1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const after = dispatch(afterPass1, { type: 'pass', player: PLAYER_2 });

    const movedCompany = after.players[RESOURCE_PLAYER].companies[0];
    // Company did NOT move to HENNETH_ANNUN — it remains at its origin.
    expect(movedCompany.currentSite?.instanceId).toBe(originInstanceId);
    expect(movedCompany.currentSite?.definitionId).toBe(MINAS_TIRITH);
    expect(movedCompany.destinationSite).toBeNull();
    expect(movedCompany.moved).toBe(false);
    // The destination site was never consumed from the location deck.
    expect(after.players[RESOURCE_PLAYER].siteDeck.some(c => c.definitionId === HENNETH_ANNUN)).toBe(true);
    // A site-phase-do-nothing constraint now blocks the company's site phase.
    expect(after.activeConstraints.some(
      c => c.kind.type === 'site-phase-do-nothing'
        && c.target.kind === 'company' && c.target.companyId === companyId,
    )).toBe(true);
  });

  test('after returning to origin, the company can only pass during its site phase', () => {
    const { state, companyId } = buildForceReturnMHState(
      [ARAGORN], [RegionType.Wilderness], SNOWSTORM,
    );

    const afterPass1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const inSitePhase = dispatch(afterPass1, { type: 'pass', player: PLAYER_2 });
    expect(inSitePhase.phaseState.phase).toBe(Phase.Site);

    // Resource player selects the returned company for its site phase.
    const atEnterOrSkip = dispatch(inSitePhase, { type: 'select-company', player: PLAYER_1, companyId: companyId as never });

    const viableTypes = new Set(
      computeLegalActions(atEnterOrSkip, PLAYER_1).filter(ea => ea.viable).map(ea => ea.action.type),
    );
    // CoE 5.31: "the company's player cannot initiate any actions during that
    // company's site phase" — the only legal action is to pass.
    expect(viableTypes.has('enter-site')).toBe(false);
    expect([...viableTypes]).toEqual(['pass']);
  });

  test('ranger exception: a company containing a ranger is not forced back', () => {
    // ARAGORN (tw-120) is a ranger; Long Winter exempts companies with a ranger.
    const { state, originInstanceId } = buildForceReturnMHState(
      [ARAGORN], [RegionType.Wilderness, RegionType.Wilderness], LONG_WINTER,
    );

    const afterPass1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const after = dispatch(afterPass1, { type: 'pass', player: PLAYER_2 });

    const movedCompany = after.players[RESOURCE_PLAYER].companies[0];
    // The ranger-bearing company completes its move to HENNETH_ANNUN.
    expect(movedCompany.currentSite?.definitionId).toBe(HENNETH_ANNUN);
    expect(movedCompany.currentSite?.instanceId).not.toBe(originInstanceId);
  });

  test('without a ranger, the same environment forces the company back', () => {
    // LEGOLAS (tw-168) is not a ranger — Long Winter's ≥2-Wilderness clause applies.
    const { state, originInstanceId } = buildForceReturnMHState(
      [LEGOLAS], [RegionType.Wilderness, RegionType.Wilderness], LONG_WINTER,
    );

    const afterPass1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const after = dispatch(afterPass1, { type: 'pass', player: PLAYER_2 });

    const movedCompany = after.players[RESOURCE_PLAYER].companies[0];
    expect(movedCompany.currentSite?.instanceId).toBe(originInstanceId);
    expect(movedCompany.currentSite?.definitionId).toBe(MINAS_TIRITH);
  });

  test('a moving company below the terrain threshold is not forced back', () => {
    // Long Winter requires ≥2 Wildernesses; a single Wilderness does not trigger.
    const { state, originInstanceId } = buildForceReturnMHState(
      [LEGOLAS], [RegionType.Wilderness], LONG_WINTER,
    );

    const afterPass1 = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const after = dispatch(afterPass1, { type: 'pass', player: PLAYER_2 });

    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.definitionId).toBe(HENNETH_ANNUN);
    expect(after.players[RESOURCE_PLAYER].companies[0].currentSite?.instanceId).not.toBe(originInstanceId);
  });
});
