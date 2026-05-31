/**
 * @module rule-8.41-cvcc-alignment-restrictions
 *
 * CoE Rules — Section 8: Combat
 * Rule 8.41: CvCC Alignment Restrictions
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's company can only attack a Ringwraith player's company, a Fallen-wizard player's overt company, or a Balrog player's company.
 * [MINION] A Ringwraith player's company can only attack a Wizard player's company or a Fallen-Wizard player's company.
 * [FALLEN-WIZARD] A Fallen-wizard player's covert company can only attack a Ringwraith player's company or a Balrog player's company.
 * [FALLEN-WIZARD] A Fallen-wizard player's overt company may attack any company, and may be attacked by any company.
 * [BALROG] A Balrog player's company can only attack a Wizard player's company or a Fallen-Wizard player's company.
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

function buildAlignmentState(p1Alignment: Alignment, p2Alignment: Alignment) {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: p1Alignment,
        companies: [{ site: MORIA, characters: [ARAGORN] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
      {
        id: PLAYER_2,
        alignment: p2Alignment,
        companies: [{ site: MORIA, characters: [PERCHEN] }],
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

  return { ...state, phaseState: sitePhaseState };
}

function canDeclareAttack(p1Alignment: Alignment, p2Alignment: Alignment): boolean {
  const state = buildAlignmentState(p1Alignment, p2Alignment);
  const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
  const actions = viableActions(afterPass, PLAYER_1, 'declare-company-attack');
  return actions.length > 0;
}

describe('Rule 8.41 — CvCC Alignment Restrictions', () => {
  beforeEach(() => resetMint());

  // Wizard attacks
  test('Wizard can attack Ringwraith', () => {
    expect(canDeclareAttack(Alignment.Wizard, Alignment.Ringwraith)).toBe(true);
  });

  test('Wizard can attack Fallen-wizard', () => {
    expect(canDeclareAttack(Alignment.Wizard, Alignment.FallenWizard)).toBe(true);
  });

  test('Wizard can attack Balrog', () => {
    expect(canDeclareAttack(Alignment.Wizard, Alignment.Balrog)).toBe(true);
  });

  test('Wizard cannot attack Wizard', () => {
    expect(canDeclareAttack(Alignment.Wizard, Alignment.Wizard)).toBe(false);
  });

  // Ringwraith attacks
  test('Ringwraith can attack Wizard', () => {
    expect(canDeclareAttack(Alignment.Ringwraith, Alignment.Wizard)).toBe(true);
  });

  test('Ringwraith can attack Fallen-wizard', () => {
    expect(canDeclareAttack(Alignment.Ringwraith, Alignment.FallenWizard)).toBe(true);
  });

  test('Ringwraith cannot attack Ringwraith', () => {
    expect(canDeclareAttack(Alignment.Ringwraith, Alignment.Ringwraith)).toBe(false);
  });

  test('Ringwraith cannot attack Balrog', () => {
    expect(canDeclareAttack(Alignment.Ringwraith, Alignment.Balrog)).toBe(false);
  });

  // Fallen-wizard attacks (covert default — most restrictive)
  test('Fallen-wizard (covert) can attack Ringwraith', () => {
    expect(canDeclareAttack(Alignment.FallenWizard, Alignment.Ringwraith)).toBe(true);
  });

  test('Fallen-wizard (covert) can attack Balrog', () => {
    expect(canDeclareAttack(Alignment.FallenWizard, Alignment.Balrog)).toBe(true);
  });

  test('Fallen-wizard (covert) cannot attack Wizard', () => {
    expect(canDeclareAttack(Alignment.FallenWizard, Alignment.Wizard)).toBe(false);
  });

  test('Fallen-wizard (covert) cannot attack Fallen-wizard', () => {
    expect(canDeclareAttack(Alignment.FallenWizard, Alignment.FallenWizard)).toBe(false);
  });

  // Balrog attacks
  test('Balrog can attack Wizard', () => {
    expect(canDeclareAttack(Alignment.Balrog, Alignment.Wizard)).toBe(true);
  });

  test('Balrog can attack Fallen-wizard', () => {
    expect(canDeclareAttack(Alignment.Balrog, Alignment.FallenWizard)).toBe(true);
  });

  test('Balrog cannot attack Ringwraith', () => {
    expect(canDeclareAttack(Alignment.Balrog, Alignment.Ringwraith)).toBe(false);
  });

  test('Balrog cannot attack Balrog', () => {
    expect(canDeclareAttack(Alignment.Balrog, Alignment.Balrog)).toBe(false);
  });
});
