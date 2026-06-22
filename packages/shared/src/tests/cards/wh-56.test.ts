/**
 * @module wh-56.test
 *
 * Card test: Isengard (wh-56)
 * Type: fallen-wizard-site (haven)
 * Effects: 1 (site-rule cancel-attacks)
 *
 * "Special: If one of your companies is at this site, all attacks against it
 *  are canceled."
 *
 * Isengard is the Gap of Isen wizardhaven for the fallen-wizard player. Like
 * the other protected wizardhaven / darkhaven sites (The White Towers le→wh-58,
 * Dol Guldur le-367, Minas Morgul, Carn Dûm, Moria), the only printed special
 * rule is the `cancel-attacks` site-rule: any hazard-creature play targeting a
 * company whose effective site is Isengard is marked non-viable.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "haven" — valid                                    |
 * | 2 | sitePath          | OK     | Empty (correct for haven)                          |
 * | 3 | nearestHaven      | OK     | Empty (correct for haven)                          |
 * | 4 | havenPaths        | OK     | Empty — fallen-wizard players get a single         |
 * |   |                   |        | wizardhaven, so no haven-to-haven paths exist      |
 * | 5 | region            | OK     | "Gap of Isen" — valid region in card pool          |
 * | 6 | playableResources | OK     | Empty (correct for haven)                          |
 * | 7 | automaticAttacks  | OK     | Empty (correct for haven)                          |
 * | 8 | resourceDraws     | OK     | 2                                                  |
 * | 9 | hazardDraws       | OK     | 2                                                  |
 *
 * Engine Support:
 * | # | Feature                     | Status      | Notes                                     |
 * |---|-----------------------------|-------------|-------------------------------------------|
 * | 1 | Site phase flow             | IMPLEMENTED | select-company, enter-or-skip, resources  |
 * | 2 | Card draws                  | IMPLEMENTED | resourceDraws / hazardDraws thread through |
 * | 3 | Cancel attacks at this site | IMPLEMENTED | site-rule cancel-attacks marks creature   |
 * |   |                             |             | hazard plays non-viable when the target   |
 * |   |                             |             | company's effective site is Isengard      |
 *
 * Certified: 2026-06-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, MORIA,
  resetMint,
  buildSitePhaseState, buildTestState,
  viableFor, viableActions, makeMHState,
} from '../test-helpers.js';
import { computeLegalActions, Phase } from '../../index.js';
import type { CardDefinitionId, GameState } from '../../index.js';

const ISENGARD = 'wh-56' as CardDefinitionId;
const SARUMAN = 'wh-9' as CardDefinitionId; // fallen-wizard avatar
const ORC_PATROL = 'tw-074' as CardDefinitionId; // hazard creature

describe('Isengard (wh-56)', () => {
  beforeEach(() => resetMint());

  // ─── Site phase behavior ────────────────────────────────────────────────────

  test('no resources playable at Isengard (haven)', () => {
    const state = buildSitePhaseState({ site: ISENGARD, characters: [SARUMAN] });
    const viable = viableFor(state, PLAYER_1);

    // Havens list no playableResources and carry no resource-granting effects,
    // so the only legal action should be `pass`.
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── Cancel-attacks engine behavior ─────────────────────────────────────────

  test('hazard creature (Orc-patrol) is non-viable against a fallen-wizard company at Isengard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: ISENGARD, characters: [SARUMAN] }],
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

    // No viable hazard play exists against the Isengard company...
    const plays = viableActions(mhState, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);

    // ...but the action is surfaced as non-viable with the cancel-attacks reason.
    const all = computeLegalActions(mhState, PLAYER_2).filter(ea => ea.action.type === 'play-hazard');
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(ea => !ea.viable)).toBe(true);
    expect(all[0].reason).toMatch(/canceled at Isengard/);
  });

  test('cancel-attacks reason is NOT cited when the target company is at a non-cancel-attacks site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
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
    // Whatever the viability, no action should be blocked with the
    // cancel-attacks reason (Moria has no such rule).
    for (const ea of plays) {
      expect(ea.reason ?? '').not.toMatch(/canceled at/);
    }
  });
});
