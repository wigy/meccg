/**
 * @module wh-58.test
 *
 * Card test: The White Towers (wh-58)
 * Type: fallen-wizard-site (haven)
 * Effects: 1 (site-rule cancel-attacks)
 *
 * Card text: "Special: If one of your companies is at this site, all attacks
 * against it are canceled."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                          |
 * |---|-------------------|--------|------------------------------------------------|
 * | 1 | siteType          | OK     | "haven" — valid                                |
 * | 2 | sitePath          | OK     | Empty (correct for haven)                      |
 * | 3 | nearestHaven      | OK     | Empty (correct for haven)                      |
 * | 4 | havenPaths        | OK     | {} — matches the other WH Wizardhavens         |
 * | 5 | region            | OK     | "Arthedain" — valid region in card pool        |
 * | 6 | playableResources | OK     | Empty (correct for haven)                      |
 * | 7 | automaticAttacks  | OK     | Empty (correct for haven)                      |
 * | 8 | resourceDraws     | OK     | 2                                              |
 * | 9 | hazardDraws       | OK     | 2                                              |
 *
 * Engine Support:
 * | # | Feature                     | Status      | Notes                                                 |
 * |---|-----------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow             | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | Cancel attacks at this site | IMPLEMENTED | site-rule cancel-attacks marks hazard-creature plays  |
 * |   |                             |             | non-viable when the target company's effective site   |
 * |   |                             |             | is The White Towers                                   |
 *
 * Playable: YES
 * Certified: 2026-06-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, LEGOLAS, ORC_PATROL,
  RIVENDELL, MORIA,
  resetMint,
  buildSitePhaseState, buildTestState,
  viableFor, viableActions, makeMHState,
} from '../test-helpers.js';
import { computeLegalActions, Phase, Alignment } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const THE_WHITE_TOWERS = 'wh-58' as CardDefinitionId;

describe('The White Towers (wh-58)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at The White Towers (haven)', () => {
    const state = buildSitePhaseState({ site: THE_WHITE_TOWERS });
    const viable = viableFor(state, PLAYER_1);

    // Havens list no playableResources and carry no resource-playing site
    // rules, so the only legal action should be `pass`.
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Cancel-attacks engine behavior ─────────────────────────────────────────

  test('hazard creature is non-viable against a company at The White Towers', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: THE_WHITE_TOWERS, characters: [GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    // No hazard play is viable against the protected company...
    const plays = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    // ...and every blocked play cites the cancel-attacks reason.
    const all = computeLegalActions(mhState, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/canceled at The White Towers/);
  });

  test('cancel-attacks reason is NOT cited when the company is at a non-cancel site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: RIVENDELL, characters: [GANDALF] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [LEGOLAS] }],
          hand: [ORC_PATROL],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const mhState: GameState = { ...state, phaseState: makeMHState() };

    const plays = computeLegalActions(mhState, PLAYER_2)
      .filter(ea => ea.action.type === 'play-hazard');
    // Rivendell carries no cancel-attacks rule, so no play should be blocked
    // with the cancel-attacks reason (whatever the keying viability is).
    for (const ea of plays) {
      expect(ea.reason ?? '').not.toMatch(/canceled at/);
    }
  });
});
