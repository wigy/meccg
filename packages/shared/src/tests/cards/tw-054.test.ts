/**
 * @module tw-054.test
 *
 * Card test: Lost in Shadow-lands (tw-54)
 * Type: hazard-event (short), company-targeting
 * Effects: 3
 *   1. play-condition site-path, `destinationSiteType.$exists` (moving company)
 *   2. play-target company
 *   3. on-event self-enters-play → add-constraint `hazard-limit-region-count`,
 *      scope:turn, target:target-company, regionType:shadow, value:1, floor:0
 *
 * Text:
 *   "Playable on a moving company. Its hazard limit increases by one for
 *    every Shadow-land [{s}] in its site path."
 *
 * Unlike Fair Sailing (tw-232, a resource short event whose reduction is
 * baked into `hazardLimitAtReveal` by `snapshotHazardLimit` because it is
 * played at end-of-organization, before the site path is even resolved),
 * this is a hazard-event short event played mid-M/H-phase, *after* the
 * target company's site path is already resolved. It resolves through the
 * chain's generic self-enters-play add-constraint path
 * (`applyAddConstraintFromOnEvent` / `buildConstraintKind` in
 * constraint-kind.ts), and the resulting `hazard-limit-region-count`
 * constraint (added *after* reveal) is read live by `effectiveHazardLimit` /
 * `currentHazardLimit` (hazard-limit.ts) against the company's already-known
 * `resolvedSitePath`.
 *
 * "Playable on a moving company" (no minimum Shadow-land count, unlike Lost
 * at Sea tw-50's explicit "if the company has a Coastal Sea" clause) is
 * enforced via the site-path play-condition's `destinationSiteType` field,
 * which per CoE rule 2.IV.ii is populated only for a genuinely moving
 * company (a stationary company has a site of origin but no site path).
 *
 * Engine Support:
 * | # | Rule (card text)                                    | Status      | Mechanism                                                        |
 * |---|------------------------------------------------------|-------------|-------------------------------------------------------------------|
 * | 1 | Playable on a moving company                         | IMPLEMENTED | play-condition site-path, destinationSiteType $exists             |
 * | 2 | hazard limit increases by one per Shadow-land in path | IMPLEMENTED | hazard-limit-region-count constraint, read live in currentHazardLimit |
 *
 * Playable: YES
 * Certified: 2026-08-23
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  makeMHState,
  handCardId, companyIdAt, dispatch,
  viableActionsForHandCard,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { RegionType, SiteType, currentHazardLimit } from '../../index.js';
import type {
  GameState, CardDefinitionId, CompanyId, MovementHazardPhaseState, PlayHazardAction,
} from '../../index.js';

const LOST_IN_SHADOW_LANDS = 'tw-54' as CardDefinitionId;

// Standard setup: resource company (P1) at Rivendell, hazard player (P2) at
// Lorien holding Lost in Shadow-lands only.
const LISL_PLAYERS = [
  { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
  { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LOST_IN_SHADOW_LANDS], siteDeck: [MINAS_TIRITH] },
] as const;

/** Build an M/H state at the play-hazards step with the given resolved site path. */
function mhStateWithPath(path: RegionType[], destination: SiteType | null): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: LISL_PLAYERS as never,
  });
  return {
    ...base,
    phaseState: makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: path,
      destinationSiteType: destination,
    }),
  };
}

/** Resolve a chain fully by alternating pass-chain-priority until it clears. */
function resolveChain(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 10 && current.chain !== null; i++) {
    const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
    if (r.error) break;
    current = r.state;
  }
  return current;
}

describe('Lost in Shadow-lands (tw-54)', () => {
  beforeEach(() => resetMint());

  test('playable on a moving company with a Shadow-land in its site path', () => {
    const state = mhStateWithPath([RegionType.Shadow], SiteType.ShadowHold);
    const actions = viableActionsForHandCard(
      state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, LOST_IN_SHADOW_LANDS,
    );
    expect(actions.length).toBeGreaterThan(0);
    const play = actions[0].action as PlayHazardAction;
    expect(play.targetCompanyId).toBe(companyIdAt(state, RESOURCE_PLAYER));
    expect(play.targetCharacterId).toBeUndefined();
  });

  test('playable on a moving company with no Shadow-land in its site path (no minimum required)', () => {
    const state = mhStateWithPath([RegionType.Wilderness], SiteType.Haven);
    const actions = viableActionsForHandCard(
      state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, LOST_IN_SHADOW_LANDS,
    );
    expect(actions.length).toBeGreaterThan(0);
  });

  test('not playable against a non-moving company (no site path)', () => {
    const state = mhStateWithPath([], null);
    const actions = viableActionsForHandCard(
      state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, LOST_IN_SHADOW_LANDS,
    );
    expect(actions).toHaveLength(0);
  });

  test('playing it through reduce adds a hazard-limit-region-count constraint to the target company', () => {
    const state = mhStateWithPath([RegionType.Shadow, RegionType.Wilderness], SiteType.ShadowHold);
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId,
    });
    expect(afterPlay.chain).not.toBeNull();

    const current = resolveChain(afterPlay);
    expect(current.chain).toBeNull();

    // The short event is discarded after resolution.
    const inDiscard = current.players[1].discardPile.find(c => c.instanceId === cardId);
    expect(inDiscard).toBeDefined();
    expect(inDiscard!.definitionId).toBe(LOST_IN_SHADOW_LANDS);

    const constraints = current.activeConstraints.filter(
      c => c.kind.type === 'hazard-limit-region-count'
        && c.target.kind === 'company'
        && c.target.companyId === targetCompanyId,
    );
    expect(constraints).toHaveLength(1);
    expect(constraints[0].kind).toEqual({
      type: 'hazard-limit-region-count',
      regionType: RegionType.Shadow,
      perCount: 1,
      floor: 0,
    });
    expect(constraints[0].scope).toEqual({ kind: 'turn' });
    expect(constraints[0].source).toBe(cardId);
  });

  test('the live hazard limit increases by one per Shadow-land in the resolved site path', () => {
    const state = mhStateWithPath(
      [RegionType.Shadow, RegionType.Wilderness, RegionType.Shadow],
      SiteType.ShadowHold,
    );
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);
    const before = currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, targetCompanyId);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId,
    });
    const current = resolveChain(afterPlay);
    const after = currentHazardLimit(current, current.phaseState as MovementHazardPhaseState, targetCompanyId);

    // Two Shadow-lands in the path → +2 to the live limit.
    expect(after).toBe(before + 2);
  });

  test('no increase to the live hazard limit when the site path has no Shadow-land', () => {
    const state = mhStateWithPath([RegionType.Wilderness, RegionType.Free], SiteType.FreeHold);
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);
    const before = currentHazardLimit(state, state.phaseState as MovementHazardPhaseState, targetCompanyId);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId,
    });
    const current = resolveChain(afterPlay);
    const after = currentHazardLimit(current, current.phaseState as MovementHazardPhaseState, targetCompanyId);

    expect(after).toBe(before);
  });

  test('the constraint does not affect a different company', () => {
    const state = mhStateWithPath([RegionType.Shadow], SiteType.ShadowHold);
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId,
    });
    const current = resolveChain(afterPlay);

    const otherLimit = currentHazardLimit(
      current,
      current.phaseState as MovementHazardPhaseState,
      'other-co' as CompanyId,
    );
    // Base hazard limit of a company the constraint does not target.
    expect(otherLimit).toBe((current.phaseState as MovementHazardPhaseState).hazardLimitAtReveal);
  });
});
