/**
 * @module rule-8.40-cvcc-initiation
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.40: CvCC Initiation Conditions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * A resource player's company may attack a hazard player's company at the end of its site phase if both companies are at the same site, the resource player's company has entered the site, and the resource player has not made an influence attempt against any of the hazard player's cards this turn nor attacked any of the hazard player's companies this turn.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, Alignment } from '../../../index.js';
import type { SitePhaseState } from '../../../index.js';
import {
  buildTestState, PLAYER_1, PLAYER_2, resetMint, dispatch, viableActions,
} from '../../test-helpers.js';

const ARAGORN = 'tw-120' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const MORIA = 'tw-d21' as CardDefinitionId;
const MORIA_AS = 'as-169' as CardDefinitionId;
const RIVENDELL = 'tw-d01' as CardDefinitionId;

function buildSiteState(opts: {
  siteEntered: boolean;
  opponentInteraction: 'influence' | 'attack' | null;
  sameSite?: boolean;
}) {
  const p2Site = opts.sameSite === false ? RIVENDELL : MORIA;

  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: p2Site, characters: [PERCHEN] }],
        hand: [],
        siteDeck: [MORIA_AS],
      },
    ],
    phase: Phase.Site,
  });

  const sitePhaseState: SitePhaseState = {
    phase: Phase.Site,
    step: 'play-resources',
    activeCompanyIndex: 0,
    handledCompanyIds: [],
    siteEntered: opts.siteEntered,
    resourcePlayed: false,
    minorItemAvailable: false,
    hoardBountyAvailable: false,
    thoroughSearchAvailable: false,
    declaredAgentAttack: null,
    automaticAttacksResolved: 0,
    awaitingOnGuardReveal: false,
    pendingResourceAction: null,
    opponentInteractionThisTurn: opts.opponentInteraction,
    pendingOpponentInfluence: null,
  };

  return { ...state, phaseState: sitePhaseState };
}

describe('Rule 8.40 — CvCC Initiation Conditions', () => {
  beforeEach(() => resetMint());

  test('CvCC allowed: same site, entered, no prior interaction', () => {
    const state = buildSiteState({ siteEntered: true, opponentInteraction: null });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).toBe('declare-company-attack');

    const actions = viableActions(afterPass, PLAYER_1, 'declare-company-attack');
    expect(actions.length).toBe(1);
  });

  test('CvCC not allowed: company has not entered the site', () => {
    const state = buildSiteState({ siteEntered: false, opponentInteraction: null });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).not.toBe('declare-company-attack');
  });

  test('CvCC not allowed: influence attempt made this turn', () => {
    const state = buildSiteState({ siteEntered: true, opponentInteraction: 'influence' });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).not.toBe('declare-company-attack');
  });

  test('CvCC not allowed: CvCC attack already made this turn', () => {
    const state = buildSiteState({ siteEntered: true, opponentInteraction: 'attack' });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).not.toBe('declare-company-attack');
  });

  test('CvCC not allowed: companies at different sites', () => {
    const state = buildSiteState({ siteEntered: true, opponentInteraction: null, sameSite: false });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });

    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).not.toBe('declare-company-attack');
  });

  test('CvCC occurs at end of site phase: after play-resources', () => {
    const state = buildSiteState({ siteEntered: true, opponentInteraction: null });

    // Initial step is play-resources, not declare-company-attack
    expect((state.phaseState).step).toBe('play-resources');

    // After passing play-resources, we enter declare-company-attack
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect((afterPass.phaseState as SitePhaseState).step).toBe('declare-company-attack');
  });

  test('CvCC: passing declare-company-attack advances to next company', () => {
    const state = buildSiteState({ siteEntered: true, opponentInteraction: null });
    let s = dispatch(state, { type: 'pass', player: PLAYER_1 });
    // Now in declare-company-attack
    s = dispatch(s, { type: 'pass', player: PLAYER_1 });

    // Should advance to select-company (since there's only one company, it might advance to end-of-turn)
    const ps = s.phaseState as SitePhaseState;
    // Either select-company for remaining companies, or end-of-turn if no more companies
    expect(['select-company', 'discard'].includes(ps.step as string)
      || s.phaseState.phase === 'end-of-turn').toBe(true);
  });
});
