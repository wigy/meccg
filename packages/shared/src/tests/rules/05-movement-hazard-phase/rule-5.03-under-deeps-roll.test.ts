/**
 * @module rule-5.03-under-deeps-roll
 *
 * CoE Rules — Section 5: Movement/Hazard Phase
 * Rule 5.03: Under-Deeps Movement Roll
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If the company's current site is an Under-deeps site when the company's new site is revealed, the resource player must make an Under-deeps movement roll (prior to determining site paths) and the company must stay at its current site if the roll is less than the number listed next to the new site's name on the site of origin; in this case, the company does not move and the new site is returned to its player's location deck, but this does not count as the company being "returned" to its current site.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, viableFor, viableActionTypes, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  MORIA, LORIEN,
  Phase,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../test-helpers.js';
import type { MovementHazardPhaseState } from '../../../index.js';
import { MovementType } from '../../../types/common.js';
import type { DeclarePathAction } from '../../../types/actions-movement-hazard.js';

// DM Under-deeps site IDs (single-use, defined locally per project convention)
const THE_UNDER_GATES = 'dm-38' as CardDefinitionId;   // adj: Moria(0), Under-grottos(8)
const THE_UNDER_GROTTOS = 'dm-39' as CardDefinitionId; // adj: Goblin-gate(0), Under-gates(8)

describe('Rule 5.03 — Under-Deeps Movement Roll', () => {
  beforeEach(() => resetMint());

  test('reveal-new-site step offers declare-path under-deeps when sites are adjacent', () => {
    // Moving from Moria (surface) to The Under-gates (dm-38, under-deeps): the sites are
    // adjacent (Under-gates lists Moria with roll 0). The reveal-new-site step must offer
    // declare-path with movementType 'under-deeps'.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: THE_UNDER_GATES }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const actions = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'declare-path') as { action: DeclarePathAction }[];

    expect(actions.some(a => a.action.movementType === MovementType.UnderDeeps)).toBe(true);
  });

  test('reveal-new-site step does not offer declare-path under-deeps for non-adjacent sites', () => {
    // Moving from Moria to Lorien: these sites are not Under-deeps adjacent.
    // No under-deeps declare-path should be offered.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: LORIEN }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const actions = viableFor(state, PLAYER_1)
      .filter(a => a.action.type === 'declare-path') as { action: DeclarePathAction }[];

    expect(actions.some(a => a.action.movementType === MovementType.UnderDeeps)).toBe(false);
  });

  test('Under-deeps movement with roll 0 (surface to under-deeps) auto-advances through set-hazard-limit to draw-cards', () => {
    // Moving from Moria (surface) to The Under-gates (under-deeps): The Under-gates lists
    // "Moria: 0" in adjacentSites. Since origin (Moria) is not an under-deeps site, the
    // required roll is always 0 — no dice roll step is entered; the engine now auto-advances
    // through set-hazard-limit and order-effects to draw-cards (empty resolvedSitePath).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: THE_UNDER_GATES }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };

    const result = reduce(state, {
      type: 'declare-path',
      player: PLAYER_1,
      movementType: MovementType.UnderDeeps,
    });

    expect(result.error).toBeUndefined();
    const mhState = result.state.phaseState as MovementHazardPhaseState;
    expect(mhState.step).toBe('draw-cards');
    expect(mhState.resolvedSitePath).toHaveLength(0);
    expect(mhState.movementType).toBe(MovementType.UnderDeeps);
  });

  test('Under-deeps roll success (>= required) auto-advances through set-hazard-limit to draw-cards', () => {
    // Moving from The Under-gates (dm-38, under-deeps) to The Under-grottos (dm-39,
    // under-deeps): The Under-gates lists "The Under-grottos: 8" in adjacentSites,
    // requiring a roll of at least 8. A roll of 8 (the minimum) is a success.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_GATES, characters: [ARAGORN], destinationSite: THE_UNDER_GROTTOS }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    // First declare under-deeps path from reveal-new-site → enters under-deeps-roll step
    const revealState = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
    const afterDeclare = reduce(revealState, {
      type: 'declare-path',
      player: PLAYER_1,
      movementType: MovementType.UnderDeeps,
    });
    expect(afterDeclare.error).toBeUndefined();
    const rollStep = afterDeclare.state.phaseState as MovementHazardPhaseState;
    expect(rollStep.step).toBe('under-deeps-roll');
    expect(rollStep.underDeepsRollRequired).toBe(8);

    // Roll exactly 8 (success): cheatRollTotal=8 means both dice sum to 8
    const afterRoll = reduce(
      { ...afterDeclare.state, cheatRollTotal: 8 },
      { type: 'under-deeps-roll', player: PLAYER_1 },
    );
    expect(afterRoll.error).toBeUndefined();
    const mhState = afterRoll.state.phaseState as MovementHazardPhaseState;
    expect(mhState.step).toBe('draw-cards');
    expect(mhState.resolvedSitePath).toHaveLength(0);
    expect(mhState.underDeepsRollRequired).toBeUndefined();
  });

  test('Under-deeps roll failure (< required) returns destination to site deck and company stays', () => {
    // Same movement as above (Under-gates → Under-grottos, required roll 8).
    // A roll of 7 is a failure: destination is returned to the site deck, the company
    // stays at The Under-gates, and this does NOT count as being "returned" (returnedToOrigin
    // must remain false).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_GATES, characters: [ARAGORN], destinationSite: THE_UNDER_GROTTOS }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const revealState = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
    const afterDeclare = reduce(revealState, {
      type: 'declare-path',
      player: PLAYER_1,
      movementType: MovementType.UnderDeeps,
    });
    expect(afterDeclare.error).toBeUndefined();

    // Roll 7 (failure — less than required 8)
    const afterRoll = reduce(
      { ...afterDeclare.state, cheatRollTotal: 7 },
      { type: 'under-deeps-roll', player: PLAYER_1 },
    );
    expect(afterRoll.error).toBeUndefined();

    const player1 = afterRoll.state.players.find(p => p.id === PLAYER_1)!;
    const company = player1.companies[0];

    // Company has no destination — it stays at its current site
    expect(company.destinationSite).toBeNull();

    // Destination returned to site deck
    const destInDeck = player1.siteDeck.some(s => s.definitionId === THE_UNDER_GROTTOS);
    expect(destInDeck).toBe(true);

    // Company still at its current Under-deeps site (not displaced)
    expect(company.currentSite?.definitionId).toBe(THE_UNDER_GATES);
  });

  test('roll failure does NOT return a destination that is a sibling company\'s in-play site instance', () => {
    // Rules 3.37/3.39: movement may target a sibling company's in-play site
    // card — the card INSTANCE is shared. Regression: the failed-roll path
    // returned the shared instance to the location deck unconditionally, so
    // the same card instance existed both under the sibling company and in
    // the site deck (a duplicated card instance).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: THE_UNDER_GATES, characters: [ARAGORN] },        // active mover
            { site: THE_UNDER_GROTTOS, characters: [GIMLI] },        // sibling holding the instance
          ],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    // Point the mover's destination at the SIBLING's in-play site instance.
    const sharedInstance = base.players[0].companies[1].currentSite!;
    const withSharedDest = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: base.players[0].companies.map((c, i) =>
            i === 0 ? { ...c, destinationSite: sharedInstance } : c),
        },
        base.players[1],
      ] as unknown as typeof base.players,
    };

    const revealState = { ...withSharedDest, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
    const afterDeclare = reduce(revealState, {
      type: 'declare-path',
      player: PLAYER_1,
      movementType: MovementType.UnderDeeps,
    });
    expect(afterDeclare.error).toBeUndefined();

    const afterRoll = reduce(
      { ...afterDeclare.state, cheatRollTotal: 2 }, // failure
      { type: 'under-deeps-roll', player: PLAYER_1 },
    );
    expect(afterRoll.error).toBeUndefined();

    const player1 = afterRoll.state.players.find(p => p.id === PLAYER_1)!;
    // Movement negated…
    expect(player1.companies[0].destinationSite).toBeNull();
    // …the sibling still holds the instance…
    expect(player1.companies[1].currentSite?.instanceId).toBe(sharedInstance.instanceId);
    // …and the instance was NOT duplicated into the location deck.
    expect(player1.siteDeck.some(s => s.instanceId === sharedInstance.instanceId)).toBe(false);
  });

  test('Under-deeps roll failure still conducts the company\'s movement/hazard phase (rule 2.IV)', () => {
    // Rule 2.IV: "they must initiate a movement/hazard phase for each of their
    // companies... each proceeds through the following Steps 1-8 ... regardless
    // of whether the company is moving." A failed under-deeps roll (5.03) must
    // not skip straight to the next company — it must continue through the
    // hazard-limit/hazard-play steps at the company's current site, just like
    // a company that never declared movement at all.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_GATES, characters: [ARAGORN], destinationSite: THE_UNDER_GROTTOS }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const revealState = { ...base, phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false }) };
    const afterDeclare = reduce(revealState, {
      type: 'declare-path',
      player: PLAYER_1,
      movementType: MovementType.UnderDeeps,
    });
    expect(afterDeclare.error).toBeUndefined();

    // Roll 7 (failure — less than required 8)
    const afterRoll = reduce(
      { ...afterDeclare.state, cheatRollTotal: 7 },
      { type: 'under-deeps-roll', player: PLAYER_1 },
    );
    expect(afterRoll.error).toBeUndefined();

    const mhState = afterRoll.state.phaseState as MovementHazardPhaseState;
    // Still processing this company (index 0), not advanced past it, and its
    // hazard limit was set for its current site — the phase is not skipped.
    expect(mhState.activeCompanyIndex).toBe(0);
    expect(mhState.handledCompanyIds).not.toContain('company-p1-0');
    expect(mhState.step).toBe('play-hazards');
    expect(mhState.hazardLimitAtReveal).toBeGreaterThan(0);
    expect(mhState.destinationSiteName).toBe('The Under-gates');

    // The hazard player must now be able to act against this company.
    expect(viableActionTypes(afterRoll.state, PLAYER_2).length).toBeGreaterThan(0);
  });

  test('Under-deeps movement: hazard player has no actions during under-deeps-roll step', () => {
    // During the under-deeps-roll step, only the resource player acts (rolling dice).
    // The hazard player must have no legal actions.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: THE_UNDER_GATES, characters: [ARAGORN], destinationSite: THE_UNDER_GROTTOS }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const state = {
      ...base,
      phaseState: makeMHState({
        step: 'under-deeps-roll',
        underDeepsRollRequired: 8,
        movementType: MovementType.UnderDeeps,
        destinationSiteName: 'The Under-grottos',
      }),
    };

    expect(viableActionTypes(state, PLAYER_2)).toHaveLength(0);
    expect(viableActionTypes(state, PLAYER_1)).toContain('under-deeps-roll');
  });
});
