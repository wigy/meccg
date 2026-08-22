/**
 * @module tw-191.test
 *
 * Card test: Anduin River (tw-191)
 * Type: hero-resource-event (short)
 * Effects: 6
 *   1. play-window: organization, step end-of-org
 *   2. play-target company, filter { company.skills: $includes ranger },
 *      cost { tap: skilled-character-in-company, skill: ranger }   (mode A)
 *   3. on-event self-enters-play → add-constraint `region-adjacency-shortcut`,
 *      scope:turn, target:target-company, regionPairs: the 5 listed pairs
 *   4. play-target company, filter { company.skills: $includes ranger }  (mode B)
 *   5. on-event self-enters-play → add-constraint `hazard-limit-region-name-match`,
 *      scope:turn, target:target-company, regionNames: the 6 listed regions,
 *      value:-2, floor:2
 *   6. duplication-limit scope:company, max:1
 *
 * Text:
 *   "Playable at the end of the organization phase on a company containing a
 *    ranger. If the company uses region cards for its site path, tap the
 *    ranger to move as if the following pairs of regions were adjacent:
 *    Rohan and Dagorlad, Anórien and Dagorlad, Anórien and Ithilien, Lebennin
 *    and Ithilien, Lebennin and Harondor. Alternatively, if the site moved to
 *    is in one of the regions listed above, the hazard limit is reduced by
 *    two (to a minimum of 2). Cannot be duplicated on a given company."
 *
 * The card offers two mutually-exclusive end-of-org modes on the same
 * company (the shape *The Cock Crows* tw-342 established for dual-mode
 * short-events, generalized here to two `play-target` effects sharing one
 * `play-window`/`duplication-limit`): tapping an untapped ranger installs a
 * `region-adjacency-shortcut` constraint (mode A — a no-op if the company
 * ultimately uses starter/Under-deeps movement, since it is only consulted
 * by region-movement pathfinding); playing the card without tapping installs
 * a `hazard-limit-region-name-match` constraint (mode B), read once the
 * company's destination is known. `endOfOrgEligibility`/the end-of-org
 * emitter (organization.ts) now iterate every `play-target` effect on a
 * card, so both modes are offered independently and share the card's single
 * company-scoped `duplication-limit`.
 *
 * Neither mode requires the company to have already declared a destination
 * ("on a company containing a ranger" — no `company.moving` filter, unlike
 * Fair Sailing tw-232): mode A must be playable *before* a destination is
 * chosen so the widened region-adjacency graph can inform which sites
 * `planMovementActions` (organization-companies.ts) subsequently offers —
 * plan-movement never re-runs once a destination is set, so gating on
 * `company.moving` would make the shortcut unable to ever unlock a new
 * destination.
 *
 * Engine Support:
 * | # | Rule (card text)                                             | Status      | Mechanism                                                        |
 * |---|---------------------------------------------------------------|-------------|-------------------------------------------------------------------|
 * | 1 | Playable at the end of the organization phase                 | IMPLEMENTED | play-window phase:organization step:end-of-org                    |
 * | 2 | on a company containing a ranger                               | IMPLEMENTED | play-target company filter { company.skills: $includes ranger }   |
 * | 3 | tap the ranger to move as if the pairs were adjacent           | IMPLEMENTED | cost tap:skilled-character-in-company + region-adjacency-shortcut |
 * | 4 | (region movement pathfinding actually treats the pairs as adjacent) | IMPLEMENTED | withExtraRegionAdjacency consulted at plan-movement + declare-path |
 * | 5 | Alternatively, hazard limit reduced by 2 if dest region matches | IMPLEMENTED | hazard-limit-region-name-match constraint, read in snapshotHazardLimit |
 * | 6 | to a minimum of 2                                              | IMPLEMENTED | floor semantics mirroring hazard-limit-region-count                |
 * | 7 | Cannot be duplicated on a given company                        | IMPLEMENTED | duplication-limit scope:company, shared by both modes              |
 *
 * Playable: YES
 * Certified: 2026-08-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, mint, dispatch, Phase,
  makeMHState, viableActions, viableFor, charIdAt, setCharStatus,
  companyIdAt, findHandCardId, RESOURCE_PLAYER,
  PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import {
  Alignment, CardStatus, ARAGORN, LEGOLAS, GIMLI, RIVENDELL, LORIEN, MORIA,
} from '../../index.js';
import type {
  CardDefinitionId, GameState, MovementHazardPhaseState, PlayShortEventAction,
} from '../../index.js';
import { MovementType } from '../../types/common.js';
import type { DeclarePathAction } from '../../types/actions-movement-hazard.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

const ANDUIN_RIVER = 'tw-191' as CardDefinitionId;
const KILI = 'tw-167' as CardDefinitionId; // warrior/scout — no ranger skill

// Sites with known region geography (see tw-regions.json adjacentRegions).
const PELARGIR = 'tw-419' as CardDefinitionId;        // free-hold, Lebennin
const SOUTHRON_OASIS = 'tw-426' as CardDefinitionId;  // border-hold, Harondor — listed region

const REGION_PAIRS: readonly (readonly [string, string])[] = [
  ['Rohan', 'Dagorlad'],
  ['Anórien', 'Dagorlad'],
  ['Anórien', 'Ithilien'],
  ['Lebennin', 'Ithilien'],
  ['Lebennin', 'Harondor'],
];
const REGION_NAMES = ['Rohan', 'Dagorlad', 'Anórien', 'Ithilien', 'Lebennin', 'Harondor'];

/** Organization-phase state: the hero company sits at Rivendell. */
function orgState(characters: readonly CardDefinitionId[], dest?: CardDefinitionId): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [...characters], ...(dest ? { destinationSite: dest } : {}) }],
        hand: [ANDUIN_RIVER],
        siteDeck: [MORIA, SOUTHRON_OASIS],
        playDeck: [],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [],
        playDeck: [],
      },
    ],
  });
}

function anduinPlays(state: GameState): PlayShortEventAction[] {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, ANDUIN_RIVER);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.cardInstanceId === cardId);
}

/** Play Anduin River's ranger-tap mode (mode A). */
function playTapMode(state: GameState, rangerId: ReturnType<typeof charIdAt>): GameState {
  return dispatch(state, {
    type: 'play-short-event',
    player: PLAYER_1,
    cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, ANDUIN_RIVER),
    targetScoutInstanceId: rangerId,
  });
}

/** Play Anduin River's no-tap "alternatively" mode (mode B). */
function playNoTapMode(state: GameState, companyId: ReturnType<typeof companyIdAt>): GameState {
  return dispatch(state, {
    type: 'play-short-event',
    player: PLAYER_1,
    cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, ANDUIN_RIVER),
    targetCompanyId: companyId,
  });
}

function declarePathActions(state: GameState): DeclarePathAction[] {
  return viableFor(state, PLAYER_1)
    .filter(a => a.action.type === 'declare-path')
    .map(a => a.action as DeclarePathAction);
}

/**
 * Build a movement/hazard-phase state stopped at `set-hazard-limit` for a
 * single company whose declared destination is `dest`. Dispatching `pass`
 * snapshots the real hazard limit through the production
 * `snapshotHazardLimit` code path.
 */
function hazardLimitWithConstraint(characterCount: number, dest: CardDefinitionId): number {
  const characters = [ARAGORN, LEGOLAS, GIMLI].slice(0, characterCount);
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters, destinationSite: dest }],
        hand: [],
        siteDeck: [],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  const constrained = addConstraint(state, {
    source: mint(),
    sourceDefinitionId: ANDUIN_RIVER,
    scope: { kind: 'turn' },
    target: { kind: 'company', companyId },
    kind: { type: 'hazard-limit-region-name-match', regionNames: REGION_NAMES, value: -2, floor: 2 },
  });
  const ready: GameState = {
    ...constrained,
    phaseState: makeMHState({
      step: 'set-hazard-limit',
      activeCompanyIndex: 0,
      destinationSiteType: null,
      destinationSiteName: null,
    }),
  };
  const after = dispatch(ready, { type: 'pass', player: PLAYER_1 });
  return (after.phaseState as MovementHazardPhaseState).hazardLimitAtReveal;
}

describe('Anduin River (tw-191)', () => {
  beforeEach(() => resetMint());

  test('offers both modes on a company containing an untapped ranger', () => {
    const base = orgState([ARAGORN]);
    const rangerId = charIdAt(base, RESOURCE_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const plays = anduinPlays(base);
    expect(plays).toHaveLength(2);
    expect(plays.some(a => a.targetScoutInstanceId === rangerId)).toBe(true);
    expect(plays.some(a => a.targetCompanyId === companyId && a.targetScoutInstanceId === undefined)).toBe(true);
  });

  test('not playable on a company without a ranger', () => {
    const base = orgState([KILI]);
    expect(anduinPlays(base)).toHaveLength(0);
  });

  test('only the no-tap mode is offered when the ranger is already tapped', () => {
    const base = orgState([ARAGORN]);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const tapped = setCharStatus(base, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    const plays = anduinPlays(tapped);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetCompanyId).toBe(companyId);
    expect(plays[0].targetScoutInstanceId).toBeUndefined();
  });

  test('the organization-phase play window is enforced — not playable during the M/H phase', () => {
    const base = orgState([ARAGORN]);
    const inMH: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(anduinPlays(inMH)).toHaveLength(0);
  });

  test('playing the ranger-tap mode taps the ranger and installs region-adjacency-shortcut', () => {
    const base = orgState([ARAGORN]);
    const rangerId = charIdAt(base, RESOURCE_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const next = playTapMode(base, rangerId);

    expect(next.players[RESOURCE_PLAYER].characters[rangerId].status).toBe(CardStatus.Tapped);
    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind).toEqual({ type: 'region-adjacency-shortcut', pairs: REGION_PAIRS });
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('playing the no-tap mode installs hazard-limit-region-name-match without tapping anyone', () => {
    const base = orgState([ARAGORN]);
    const rangerId = charIdAt(base, RESOURCE_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const next = playNoTapMode(base, companyId);

    expect(next.players[RESOURCE_PLAYER].characters[rangerId].status).toBe(CardStatus.Untapped);
    expect(next.activeConstraints).toHaveLength(1);
    const constraint = next.activeConstraints[0];
    expect(constraint.kind).toEqual({
      type: 'hazard-limit-region-name-match',
      regionNames: REGION_NAMES,
      value: -2,
      floor: 2,
    });
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('cannot be duplicated on a given company — neither mode is offered once the company already bears one', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [
            { site: RIVENDELL, characters: [ARAGORN] },
            { site: LORIEN, characters: [GIMLI, ARAGORN] },
          ],
          hand: [ANDUIN_RIVER],
          siteDeck: [MORIA],
          playDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [], playDeck: [] },
      ],
    });
    const [companyA, companyB] = state.players[0].companies;
    const constrained = addConstraint(state, {
      source: mint(),
      sourceDefinitionId: ANDUIN_RIVER,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: companyA.id },
      kind: { type: 'hazard-limit-region-name-match', regionNames: REGION_NAMES, value: -2, floor: 2 },
    });

    const plays = anduinPlays(constrained);
    // Company A (already bears the constraint) contributes nothing; company B
    // (a second ranger-bearing company, Gimli + Aragorn) still offers both modes.
    expect(plays.every(a => a.targetCompanyId !== companyA.id)).toBe(true);
    expect(plays.filter(a => a.targetCompanyId === companyB.id || a.targetScoutInstanceId).length).toBeGreaterThan(0);
    expect(plays).toHaveLength(2);
  });

  describe('the ranger-tap mode widens region movement (region-adjacency-shortcut)', () => {
    // Pelargir (Lebennin) → Southron Oasis (Harondor) is a 2-edge span in the
    // base region graph (both border "Mouths of the Anduin"), so at a 2-region
    // cap (same-region or 1 edge only) it is normally unreachable. Anduin
    // River's Lebennin/Harondor pair collapses it to a direct edge.
    function revealState(withShortcut: boolean): GameState {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: Alignment.Wizard,
            companies: [{ site: PELARGIR, characters: [ARAGORN], destinationSite: SOUTHRON_OASIS }],
            hand: [],
            siteDeck: [],
          },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const withState: GameState = {
        ...base,
        phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: false, activeCompanyIndex: 0, maxRegionDistance: 2 }),
      };
      if (!withShortcut) return withState;
      const companyId = companyIdAt(withState, RESOURCE_PLAYER);
      return addConstraint(withState, {
        source: mint(),
        sourceDefinitionId: ANDUIN_RIVER,
        scope: { kind: 'turn' },
        target: { kind: 'company', companyId },
        kind: { type: 'region-adjacency-shortcut', pairs: REGION_PAIRS },
      });
    }

    test('control: at a 2-region cap, without the shortcut the move is refused', () => {
      const state = revealState(false);
      expect(declarePathActions(state).some(a => a.movementType === MovementType.Region)).toBe(false);
    });

    test('with the shortcut installed, the region-movement path is offered', () => {
      const state = revealState(true);
      expect(declarePathActions(state).some(a => a.movementType === MovementType.Region)).toBe(true);
    });
  });

  test('destination outside the listed regions: no reduction', () => {
    // Company of 3 → base limit 3. Moria is in Redhorn Gate, not listed.
    expect(hazardLimitWithConstraint(3, MORIA)).toBe(3);
  });

  test('destination in a listed region: hazard limit reduced by 2', () => {
    // Company of 4 → base limit 4. Southron Oasis is in Harondor (listed) → 4 - 2 = 2.
    expect(hazardLimitWithConstraint(4, SOUTHRON_OASIS)).toBe(2);
  });

  test('the reduction is floored at a minimum of 2, not reduced further', () => {
    // Company of 3 → base limit 3. 3 - 2 = 1, but the floor holds it at 2.
    expect(hazardLimitWithConstraint(3, SOUTHRON_OASIS)).toBe(2);
  });

  test('a limit already at or below the floor is left unchanged', () => {
    // Company of 1 → base limit max(1, 2) = 2, already at the floor.
    expect(hazardLimitWithConstraint(1, SOUTHRON_OASIS)).toBe(2);
  });

  test('both constraint kinds clear at turn-end (scope: turn)', () => {
    const base = orgState([ARAGORN]);
    const rangerId = charIdAt(base, RESOURCE_PLAYER);
    const played = playTapMode(base, rangerId);
    expect(played.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(played, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });
});
