/**
 * @module tw-050.test
 *
 * Card test: Lost at Sea (tw-50)
 * Type: hazard-event (short), company-targeting
 * Effects: 3 (play-condition site-path [coastal], play-target company,
 *             on-event self-enters-play → add-constraint
 *             site-phase-do-nothing scope:company-site-phase)
 *
 * "Playable on a company that is moving this turn. If the company has a
 *  Coastal Sea [{c}] in its site path, it may do nothing at the site
 *  during its site phase."
 *
 * The Coastal-Sea clause is modeled as a playability gate (`play-condition`
 * requires `site-path`, `sitePath.coastalCount >= 1`). Per the general MECCG
 * rule that a card may not be played if it can have no effect, Lost at Sea is
 * only legally playable on a moving company whose site path actually contains a
 * Coastal Sea — otherwise its do-nothing effect is inert. An empty site path
 * (a non-moving company) has a coastal count of zero, so the same gate also
 * enforces "playable on a company that is moving this turn". This reuses the
 * existing site-path play-condition machinery (dm-97, dm-88) and the
 * site-phase-do-nothing constraint (le-119 / tw-53) — no new engine code.
 *
 * Engine Support:
 * | # | Feature                                    | Status      | Notes                                    |
 * |---|--------------------------------------------|-------------|------------------------------------------|
 * | 1 | Coastal-Sea site-path gate                 | IMPLEMENTED | play-condition requires site-path        |
 * | 2 | Play target = company                      | IMPLEMENTED | play-hazard's targetCompanyId            |
 * | 3 | Adds site-phase-do-nothing constraint      | IMPLEMENTED | on-event self-enters-play apply          |
 * | 4 | Constraint collapses enter-or-skip to pass | IMPLEMENTED | constraint filter (legal-actions/pending)|
 * | 5 | Constraint does not affect other companies | IMPLEMENTED | constraint filter checks active company  |
 *
 * Certified: 2026-07-07
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  makeMHState,
  handCardId, companyIdAt, dispatch,
  viableActionTypes, viableActionsForHandCard,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { RegionType, SiteType } from '../../index.js';
import type {
  GameState, CardDefinitionId, CompanyId, SitePhaseState, PlayHazardAction,
} from '../../index.js';

const LOST_AT_SEA = 'tw-50' as CardDefinitionId;

// Standard setup: resource company (P1) at Rivendell, hazard player (P2) at
// Lorien holding Lost at Sea only.
const LAS_PLAYERS = [
  { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
  { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LOST_AT_SEA], siteDeck: [MINAS_TIRITH] },
] as const;

/** Build an M/H state at the play-hazards step with the given resolved site path. */
function mhStateWithPath(path: RegionType[], destination: SiteType): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: LAS_PLAYERS as never,
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

/** A Site-phase enter-or-skip state for the active company. */
function enterOrSkipState(): SitePhaseState {
  return {
    phase: Phase.Site,
    step: 'enter-or-skip',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    automaticAttacksResolved: 0,
    siteEntered: false,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: null,
    pendingOpponentInfluence: null,
  };
}

describe('Lost at Sea (tw-50)', () => {
  beforeEach(() => resetMint());

  test('playable on a moving company with a Coastal Sea in its site path', () => {
    const state = mhStateWithPath([RegionType.Coastal], SiteType.BorderHold);
    const actions = viableActionsForHandCard(
      state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, LOST_AT_SEA,
    );
    expect(actions.length).toBeGreaterThan(0);
    const play = actions[0].action as PlayHazardAction;
    expect(play.targetCompanyId).toBe(companyIdAt(state, RESOURCE_PLAYER));
    // play-target = company, so no per-character target is carried.
    expect(play.targetCharacterId).toBeUndefined();
  });

  test('playable when a Coastal Sea sits among other regions in the path', () => {
    const state = mhStateWithPath(
      [RegionType.Wilderness, RegionType.Coastal, RegionType.Border],
      SiteType.BorderHold,
    );
    const actions = viableActionsForHandCard(
      state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, LOST_AT_SEA,
    );
    expect(actions.length).toBeGreaterThan(0);
  });

  test('not playable when the moving company has no Coastal Sea in its path', () => {
    const state = mhStateWithPath(
      [RegionType.Wilderness, RegionType.Border],
      SiteType.BorderHold,
    );
    const actions = viableActionsForHandCard(
      state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, LOST_AT_SEA,
    );
    expect(actions).toHaveLength(0);
  });

  test('not playable against a non-moving company (empty site path)', () => {
    const state = mhStateWithPath([], SiteType.Haven);
    const actions = viableActionsForHandCard(
      state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, LOST_AT_SEA,
    );
    expect(actions).toHaveLength(0);
  });

  test('playing it through reduce adds a site-phase-do-nothing constraint to the target company', () => {
    const state = mhStateWithPath([RegionType.Coastal], SiteType.BorderHold);
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId,
    });
    expect(afterPlay.chain).not.toBeNull();

    // Resolve the chain (both players pass priority).
    let current = afterPlay;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    // The short event is discarded after resolution.
    const inDiscard = current.players[1].discardPile.find(c => c.instanceId === cardId);
    expect(inDiscard).toBeDefined();
    expect(inDiscard!.definitionId).toBe(LOST_AT_SEA);

    // The self-enters-play handler added the do-nothing constraint on the company.
    const constraints = current.activeConstraints.filter(
      c => c.kind.type === 'site-phase-do-nothing'
        && c.target.kind === 'company'
        && c.target.companyId === targetCompanyId,
    );
    expect(constraints).toHaveLength(1);
    expect(constraints[0].source).toBe(cardId);
    expect(constraints[0].scope).toEqual({ kind: 'company-site-phase', companyId: targetCompanyId });
  });

  test('after playing it, the target company is locked into pass at enter-or-skip', () => {
    const state = mhStateWithPath([RegionType.Coastal], SiteType.BorderHold);
    const targetCompanyId = companyIdAt(state, RESOURCE_PLAYER);
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId,
    });
    let current = afterPlay;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    // Sanity: without the constraint the company could enter or pass.
    const unconstrained: GameState = { ...current, activeConstraints: [], phaseState: enterOrSkipState() };
    const before = viableActionTypes(unconstrained, PLAYER_1);
    expect(before).toContain('enter-site');
    expect(before).toContain('pass');

    // With the constraint in effect the enter-or-skip menu collapses to pass.
    const atSite: GameState = { ...current, phaseState: enterOrSkipState() };
    expect(viableActionTypes(atSite, PLAYER_1)).toEqual(['pass']);
  });

  test('the do-nothing constraint does not affect a different company', () => {
    const state = mhStateWithPath([RegionType.Coastal], SiteType.BorderHold);
    const cardId = handCardId(state, HAZARD_PLAYER);

    const afterPlay = dispatch(state, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardId,
      targetCompanyId: companyIdAt(state, RESOURCE_PLAYER),
    });
    let current = afterPlay;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    // Retarget the constraint at a fictitious other company — the real company
    // should regain its full enter-or-skip menu.
    const retargeted: GameState = {
      ...current,
      activeConstraints: current.activeConstraints.map(c =>
        c.kind.type === 'site-phase-do-nothing'
          ? { ...c, target: { kind: 'company', companyId: 'other-co' as CompanyId } }
          : c,
      ),
      phaseState: enterOrSkipState(),
    };
    const actions = viableActionTypes(retargeted, PLAYER_1);
    expect(actions).toContain('enter-site');
    expect(actions).toContain('pass');
  });
});
