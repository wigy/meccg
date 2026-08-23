/**
 * @module tw-055.test
 *
 * Card test: Lost in the Wilderness (tw-55)
 * Type: hazard-event (short, company-targeting)
 * Effects: 3
 *   1. play-condition site-path, `movementType` $exists (company is genuinely moving)
 *   2. play-target company
 *   3. on-event self-enters-play -> add-constraint `hazard-limit-region-count`,
 *      scope:turn, target:target-company, regionType:wilderness, value:1,
 *      floor:0 (floor is inert for a positive `value`)
 *
 * Text:
 *   "Playable on a moving company. Its hazard limit increases by one for
 *    every Wilderness [{w}] in its site path."
 *
 * Unlike Fair Sailing (tw-232) -- an organization-phase resource event whose
 * count is deferred to `snapshotHazardLimit` because the site path isn't
 * known yet -- Lost in the Wilderness is a hazard short-event played during
 * the target company's own M/H phase, *after* its path is already resolved.
 * It therefore reuses verbatim the primitive Lost in Border-lands (tw-51)
 * introduced: the `hazard-limit-region-count` constraint installed through
 * the chain's generic self-enters-play add-constraint path
 * (`buildConstraintKind`, constraint-kind.ts) is read *live* by
 * `effectiveHazardLimit`/`currentHazardLimit` (hazard-limit.ts) against the
 * company's already-resolved `resolvedSitePath`, rather than being baked
 * into `hazardLimitAtReveal` at snapshot time.
 *
 * The one piece of engine work this card adds is its "moving company" gate:
 * `checkSitePathCondition` now exposes `mhState.movementType`, which is set
 * only when the resource player actually declared a path for the active
 * company. Its sibling tw-51 gates on `destinationSiteType` instead, which
 * is backfilled from the *current* site for a stationary company and so
 * cannot distinguish moving from non-moving on its own.
 *
 * Engine Support:
 * | # | Rule (card text)                                     | Status      | Mechanism |
 * |---|-------------------------------------------------------|-------------|-----------|
 * | 1 | Playable on a moving company                          | IMPLEMENTED | play-condition site-path, `movementType` $exists |
 * | 2 | Hazard limit increases by one per Wilderness in path   | IMPLEMENTED | hazard-limit-region-count constraint, counted against resolvedSitePath |
 * | 3 | The increase is live for the rest of the company's M/H | IMPLEMENTED | effectiveHazardLimit (hazard-limit.ts) |
 *
 * Playable: YES
 * Certified: 2026-08-23
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce, dispatch,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA,
  makeMHState,
  handCardId, companyIdAt,
  viableActions, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { RegionType, currentHazardLimit } from '../../index.js';
import type {
  CardDefinitionId, GameState, MovementHazardPhaseState, PlayHazardAction,
} from '../../index.js';
import { MovementType } from '../../types/common.js';
import { sweepExpired } from '../../engine/pending.js';

const LOST_IN_THE_WILDERNESS = 'tw-55' as CardDefinitionId;

function baseState(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LOST_IN_THE_WILDERNESS], siteDeck: [] },
    ],
  });
}

/** Resolve the chain by having both players pass priority in turn. */
function resolveChain(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 10 && current.chain !== null; i++) {
    const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
    if (r.error) break;
    current = r.state;
  }
  return current;
}

describe('Lost in the Wilderness (tw-55)', () => {
  beforeEach(() => resetMint());

  test('offered as a viable hazard play against a genuinely moving company', () => {
    const base = baseState();
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const cardId = handCardId(base, HAZARD_PLAYER);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      movementType: MovementType.Region,
      resolvedSitePath: [RegionType.Wilderness],
    });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const plays = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === cardId);

    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
    expect(plays[0].targetCharacterId).toBeUndefined();
  });

  test('NOT offered against a company that has not declared movement', () => {
    const base = baseState();
    const cardId = handCardId(base, HAZARD_PLAYER);
    // movementType stays null (the default) — the company never declared a path.
    const mhState = makeMHState({ activeCompanyIndex: 0 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const plays = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.cardInstanceId === cardId);
    expect(plays).toHaveLength(0);
  });

  test('playing it through reduce adds a hazard-limit-region-count constraint to the target company', () => {
    const base = baseState();
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const cardId = handCardId(base, HAZARD_PLAYER);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      movementType: MovementType.Region,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Free, RegionType.Wilderness],
      hazardLimitAtReveal: 2,
    });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: cardId, targetCompanyId: companyId,
    });
    const resolved = resolveChain(afterPlay);
    expect(resolved.chain).toBeNull();

    // Lost in the Wilderness is a short event — it is discarded once resolved.
    const discarded = resolved.players[1].discardPile.find(c => c.instanceId === cardId);
    expect(discarded?.definitionId).toBe(LOST_IN_THE_WILDERNESS);

    const constraints = resolved.activeConstraints.filter(
      c => c.kind.type === 'hazard-limit-region-count'
        && c.target.kind === 'company'
        && c.target.companyId === companyId,
    );
    expect(constraints).toHaveLength(1);
    expect(constraints[0].kind).toEqual({
      type: 'hazard-limit-region-count',
      regionType: RegionType.Wilderness,
      perCount: 1,
      floor: 0,
    });
    expect(constraints[0].source).toBe(cardId);
    expect(constraints[0].scope.kind).toBe('turn');

    // Two Wildernesses in the path -> +2 to the live hazard limit.
    expect(currentHazardLimit(
      resolved, resolved.phaseState as MovementHazardPhaseState, companyId,
    )).toBe(4);
  });

  test('the increase is live for the rest of the company\'s M/H phase, raising the effective hazard limit', () => {
    const base = baseState();
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const cardId = handCardId(base, HAZARD_PLAYER);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      movementType: MovementType.Region,
      resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
      hazardLimitAtReveal: 2,
    });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    // Base limit (company of 1 -> max(1, 2)) before Lost in the Wilderness resolves.
    expect(currentHazardLimit(stateAtPlayHazards, mhState, companyId)).toBe(2);

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: cardId, targetCompanyId: companyId,
    });
    const resolved = resolveChain(afterPlay);
    const resolvedMhState = resolved.phaseState as MovementHazardPhaseState;

    // Lost in the Wilderness itself counted against the (still base) limit.
    expect(resolvedMhState.hazardsPlayedThisCompany).toBe(1);
    // Its own effect then raises the limit for the rest of the phase: 2 + 2 = 4.
    expect(currentHazardLimit(resolved, resolvedMhState, companyId)).toBe(4);
  });

  test('no increase when the site path has no Wilderness', () => {
    const base = baseState();
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const cardId = handCardId(base, HAZARD_PLAYER);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      movementType: MovementType.Region,
      resolvedSitePath: [RegionType.Free, RegionType.Coastal],
      hazardLimitAtReveal: 2,
    });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: cardId, targetCompanyId: companyId,
    });
    const resolved = resolveChain(afterPlay);

    const constraints = resolved.activeConstraints.filter(
      c => c.kind.type === 'hazard-limit-region-count' && c.target.kind === 'company' && c.target.companyId === companyId,
    );
    expect(constraints).toHaveLength(1);

    const resolvedMhState = resolved.phaseState as MovementHazardPhaseState;
    expect(currentHazardLimit(resolved, resolvedMhState, companyId)).toBe(2);
  });

  test('the constraint clears at turn-end (scope: turn)', () => {
    const base = baseState();
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const cardId = handCardId(base, HAZARD_PLAYER);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      movementType: MovementType.Region,
      resolvedSitePath: [RegionType.Wilderness],
      hazardLimitAtReveal: 2,
    });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard', player: PLAYER_2, cardInstanceId: cardId, targetCompanyId: companyId,
    });
    const resolved = resolveChain(afterPlay);
    expect(resolved.activeConstraints.filter(c => c.kind.type === 'hazard-limit-region-count')).toHaveLength(1);

    const swept = sweepExpired(resolved, { kind: 'turn-end' });
    expect(swept.activeConstraints.filter(c => c.kind.type === 'hazard-limit-region-count')).toHaveLength(0);
  });
});
