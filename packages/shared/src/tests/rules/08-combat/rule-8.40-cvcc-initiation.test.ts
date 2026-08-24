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
const MORIA_HERO = 'tw-413' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;
const EAGLES_EYRIE_HERO = 'tw-391' as CardDefinitionId;
const EAGLES_EYRIE_MINION = 'as-144' as CardDefinitionId;

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

  test('CvCC step offers a pass when the active company dissolved on its way there', () => {
    // The site's automatic attacks can kill the last character of the company
    // that just entered, and the company dissolves (rule 2.07) while the site
    // phase is still working through its steps. `activeCompanyIndex` then
    // points past the end of the companies array — the dangling index every
    // per-company site step guards for. This step offered nothing at all for
    // it, so neither player had a viable action and the game deadlocked; the
    // reducer, for its part, read `company.id` off `undefined` on the pass.
    const state = buildSiteState({ siteEntered: true, opponentInteraction: null });
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect((afterPass.phaseState as SitePhaseState).step).toBe('declare-company-attack');

    // Dissolve P1's only company, exactly as cleanupEmptyCompanies leaves it.
    const dissolved = {
      ...afterPass,
      players: [
        { ...afterPass.players[0], companies: [], characters: {} },
        afterPass.players[1],
      ] as typeof afterPass.players,
    };

    expect(viableActions(dissolved, PLAYER_1, 'declare-company-attack')).toHaveLength(0);
    expect(viableActions(dissolved, PLAYER_1, 'pass')).toHaveLength(1);

    // The pass finishes the dissolved company's slot; no company is left
    // unhandled, so the site phase ends (rule 6.20).
    const afterDissolvedPass = dispatch(dissolved, { type: 'pass', player: PLAYER_1 });
    expect(afterDissolvedPass.phaseState.phase).toBe(Phase.EndOfTurn);
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

  test('CvCC allowed: wizard at hero-Moria vs ringwraith at minion-Moria (same name, different card IDs)', () => {
    // Regression test: hero version (tw-413) and minion version (le-392) of Moria are
    // different card IDs but represent the same physical site — CvCC must be offered.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA_HERO, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [],
        },
      ],
      phase: Phase.Site,
    });

    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };

    const s = { ...state, phaseState: sitePhaseState };
    const afterPass = dispatch(s, { type: 'pass', player: PLAYER_1 });
    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).toBe('declare-company-attack');

    const actions = viableActions(afterPass, PLAYER_1, 'declare-company-attack');
    expect(actions.length).toBe(1);
  });

  test('CvCC allowed: ringwraith at minion-Eagles-Eyrie vs wizard at hero-Eagles-Eyrie (same name, different card IDs)', () => {
    // Regression test for game mpv5bx8n-3j9fua: ringwraith company at as-144 and wizard
    // company at tw-391 are both "Eagles' Eyrie" but different card IDs.  CvCC must be
    // offered when the ringwraith is the resource (active) player.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: EAGLES_EYRIE_MINION, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: EAGLES_EYRIE_HERO, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
      phase: Phase.Site,
    });

    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };

    const s = { ...state, phaseState: sitePhaseState };
    const afterPass = dispatch(s, { type: 'pass', player: PLAYER_1 });
    const ps = afterPass.phaseState as SitePhaseState;
    expect(ps.step).toBe('declare-company-attack');

    const actions = viableActions(afterPass, PLAYER_1, 'declare-company-attack');
    expect(actions.length).toBe(1);
  });
});
