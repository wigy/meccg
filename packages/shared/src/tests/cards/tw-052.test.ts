/**
 * @module tw-052.test
 *
 * Card test: Lost in Dark-domains (tw-52)
 * Type: hazard-event (short, company-targeting)
 * Effects: 3 (play-condition site-path condition:{moving:true}, play-target
 *             company, on-event self-enters-play when:sitePath.darkCount>=1
 *             → add-constraint hazard-limit-multiplier value:2 scope:turn)
 *
 * "Playable on a company that is moving this turn. If the company has a
 *  Dark-domain [{d}] in its site path, its hazard limit is doubled until
 *  the end of the turn."
 *
 * Certified: 2026-08-23
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce, dispatch,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  makeMHState,
  handCardId, companyIdAt,
  viableActions,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { RegionType } from '../../index.js';
import type { CardDefinitionId, GameState, MovementHazardPhaseState, PlayHazardAction } from '../../index.js';
import { currentHazardLimit } from '../../engine/hazard-limit.js';

const LOST_IN_DARK_DOMAINS = 'tw-52' as CardDefinitionId;

function buildState(opts: { moving: boolean }): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN], ...(opts.moving ? { destinationSite: MORIA } : {}) }],
        hand: [],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LOST_IN_DARK_DOMAINS], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

/** Resolve the chain by having both players pass priority until it closes. */
function resolveChain(state: GameState): GameState {
  let current = state;
  for (let i = 0; i < 10 && current.chain !== null; i++) {
    const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
    if (r.error) break;
    current = r.state;
  }
  return current;
}

describe('Lost in Dark-domains (tw-52)', () => {
  beforeEach(() => resetMint());

  test('offered as viable on a moving company even without a Dark-domain in its path', () => {
    const base = buildState({ moving: true });
    const lidInstance = handCardId(base, HAZARD_PLAYER);
    const mhState = makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [RegionType.Wilderness] });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction);
    const play = playActions.find(a => a.cardInstanceId === lidInstance);
    expect(play).toBeDefined();
    expect(play!.targetCompanyId).toBe(companyIdAt(base, RESOURCE_PLAYER));
  });

  test('NOT offered when the company is not moving this turn', () => {
    const base = buildState({ moving: false });
    const lidInstance = handCardId(base, HAZARD_PLAYER);
    const mhState = makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [] });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const playActions = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction);
    expect(playActions.find(a => a.cardInstanceId === lidInstance)).toBeUndefined();
  });

  test('playing it on a moving company with a Dark-domain in its path doubles the hazard limit', () => {
    const base = buildState({ moving: true });
    const compId = companyIdAt(base, RESOURCE_PLAYER);
    const lidInstance = handCardId(base, HAZARD_PLAYER);
    const mhState = makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [RegionType.Dark], hazardLimitAtReveal: 4 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };
    const limitBefore = currentHazardLimit(stateAtPlayHazards, mhState, compId);
    expect(limitBefore).toBe(4);

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: lidInstance,
      targetCompanyId: compId,
    });
    const resolved = resolveChain(afterPlay);
    expect(resolved.chain).toBeNull();

    const constraint = resolved.activeConstraints.find(
      c => c.kind.type === 'hazard-limit-multiplier' && c.target.kind === 'company' && c.target.companyId === compId,
    );
    expect(constraint).toBeDefined();
    expect((constraint!.kind as { value: number }).value).toBe(2);
    expect(constraint!.scope).toEqual({ kind: 'turn' });

    const mhAfter = resolved.phaseState as MovementHazardPhaseState;
    expect(currentHazardLimit(resolved, mhAfter, compId)).toBe(limitBefore * 2);
  });

  test('playing it on a moving company WITHOUT a Dark-domain leaves the hazard limit unchanged', () => {
    const base = buildState({ moving: true });
    const compId = companyIdAt(base, RESOURCE_PLAYER);
    const lidInstance = handCardId(base, HAZARD_PLAYER);
    const mhState = makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [RegionType.Wilderness], hazardLimitAtReveal: 4 });
    const stateAtPlayHazards = { ...base, phaseState: mhState };
    const limitBefore = currentHazardLimit(stateAtPlayHazards, mhState, compId);

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: lidInstance,
      targetCompanyId: compId,
    });
    const resolved = resolveChain(afterPlay);
    expect(resolved.chain).toBeNull();

    expect(resolved.activeConstraints.find(c => c.kind.type === 'hazard-limit-multiplier')).toBeUndefined();

    const mhAfter = resolved.phaseState as MovementHazardPhaseState;
    expect(currentHazardLimit(resolved, mhAfter, compId)).toBe(limitBefore);
  });

  test('the card is discarded (short event) once the chain resolves', () => {
    const base = buildState({ moving: true });
    const compId = companyIdAt(base, RESOURCE_PLAYER);
    const lidInstance = handCardId(base, HAZARD_PLAYER);
    const mhState = makeMHState({ activeCompanyIndex: 0, resolvedSitePath: [RegionType.Dark] });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: lidInstance,
      targetCompanyId: compId,
    });
    const resolved = resolveChain(afterPlay);

    const inDiscard = resolved.players[HAZARD_PLAYER].discardPile.find(c => c.instanceId === lidInstance);
    expect(inDiscard).toBeDefined();
    expect(inDiscard!.definitionId).toBe(LOST_IN_DARK_DOMAINS);
  });
});
