/**
 * @module td-124.test
 *
 * Card test: Hey! come merry dol! (td-124)
 * Type: hero-resource-event (short), non-unique, 0 MP.
 * Effects: 3
 *   1. play-window: organization, step end-of-org
 *   2. play-target company, DSL filter { company.moving: true }
 *   3. on-event self-enters-play → add-constraint `site-path-reduction`,
 *      scope:turn, target:target-company, regionHalvings: ["wilderness"]
 *
 * Text:
 *   "Playable at the end of the organization phase on a moving company. Each
 *    Wilderness [{w}] symbol in the company's site path counts as half a
 *    Wilderness [{w}]. When calculating the number of Wildernesses [{w}] in
 *    such a site path, round down the final result."
 *
 * The company-targeted constraint is read when the company's site path is
 * resolved (`applySitePathReduction`, mh-steps.ts): N Wilderness tokens become
 * floor(N / 2), and the reduced path flows to creature keying and every other
 * site-path consumer.
 *
 * Engine Support:
 * | # | Rule (card text)                                       | Status      | Mechanism                                        |
 * |---|--------------------------------------------------------|-------------|--------------------------------------------------|
 * | 1 | Playable at the end of the organization phase           | IMPLEMENTED | play-window phase:organization step:end-of-org   |
 * | 2 | on a moving company                                     | IMPLEMENTED | play-target company filter { company.moving }    |
 * | 3 | Each Wilderness counts as half a Wilderness             | IMPLEMENTED | site-path-reduction `halve` (company-targeted)   |
 * | 4 | round down the final result                             | IMPLEMENTED | floor(N / 2) tokens kept                         |
 * | 5 | (only "the company's" path — other companies unaffected)| IMPLEMENTED | constraint target { kind: company }              |
 *
 * Playable: YES
 * Certified: 2026-09-25
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, Phase, makeMHState, viableActions,
  companyIdAt, findHandCardId, expectInDiscardPile, RESOURCE_PLAYER,
  PLAYER_1, PLAYER_2,
} from '../test-helpers.js';
import { Alignment, RegionType, ARAGORN, BILBO, LEGOLAS, LORIEN, RIVENDELL } from '../../index.js';
import type {
  CardDefinitionId, CreatureCard, GameState, MovementHazardPhaseState, PlayShortEventAction,
} from '../../index.js';
import { MovementType } from '../../types/common.js';
import { checkCreatureKeying } from '../../engine/mh-hazard-play.js';

const HEY_COME_MERRY_DOL = 'td-124' as CardDefinitionId;
const BREE = 'tw-378' as CardDefinitionId;               // sitePath [w, w]
const DUNNISH_CLAN_HOLD = 'tw-390' as CardDefinitionId;  // sitePath [w, w, w]
const GIANT = 'tw-39' as CardDefinitionId;               // keyed to {w}{w}

const HOLLIN = 'tw-466' as CardDefinitionId;       // Wilderness
const REDHORN_GATE = 'tw-481' as CardDefinitionId; // Wilderness
const RHUDAUR = 'tw-482' as CardDefinitionId;      // Wilderness
const ROHAN = 'tw-483' as CardDefinitionId;        // Border-land

/**
 * Organization-phase state: two hero companies at Rivendell. Company 0 has
 * declared movement to `dest` (when given); company 1 moves to `otherDest`.
 */
function orgState(dest?: CardDefinitionId, otherDest: CardDefinitionId = BREE): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Wizard,
        companies: [
          { site: RIVENDELL, characters: [ARAGORN], ...(dest ? { destinationSite: dest } : {}) },
          { site: RIVENDELL, characters: [BILBO], destinationSite: otherDest },
        ],
        hand: [HEY_COME_MERRY_DOL],
        siteDeck: [],
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

/** Viable plays of this card in `state`. */
function plays(state: GameState): PlayShortEventAction[] {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, HEY_COME_MERRY_DOL);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.cardInstanceId === cardId);
}

/** Play the card on company 0 (moving to `dest`). */
function playOnCompany(dest: CardDefinitionId, otherDest?: CardDefinitionId): GameState {
  const base = orgState(dest, otherDest);
  return dispatch(base, {
    type: 'play-short-event',
    player: PLAYER_1,
    cardInstanceId: findHandCardId(base, RESOURCE_PLAYER, HEY_COME_MERRY_DOL),
    targetCompanyId: companyIdAt(base, RESOURCE_PLAYER, 0),
  });
}

/** Enter the M/H reveal-new-site step for company `companyIndex`. */
function atReveal(state: GameState, companyIndex = 0): GameState {
  return {
    ...state,
    phaseState: makeMHState({ step: 'reveal-new-site', siteRevealed: true, activeCompanyIndex: companyIndex }),
  };
}

/** Declare starter movement for the active M/H company. */
function declareStarter(state: GameState): GameState {
  return dispatch(state, { type: 'declare-path', player: PLAYER_1, movementType: MovementType.Starter });
}

function mh(state: GameState): MovementHazardPhaseState {
  return state.phaseState as MovementHazardPhaseState;
}

describe('Hey! come merry dol! (td-124)', () => {
  beforeEach(() => resetMint());

  // ─── Play gate ──────────────────────────────────────────────────────────────

  test('playable during the organization phase on a moving company', () => {
    const base = orgState(BREE);
    const targets = plays(base).map(a => a.targetCompanyId);
    expect(targets).toContain(companyIdAt(base, RESOURCE_PLAYER, 0));
  });

  test('not playable on a company that is not moving', () => {
    const base = orgState(); // company 0 has no declared destination
    const targets = plays(base).map(a => a.targetCompanyId);
    expect(targets).not.toContain(companyIdAt(base, RESOURCE_PLAYER, 0));
    // The moving company 1 is still a legal target.
    expect(targets).toContain(companyIdAt(base, RESOURCE_PLAYER, 1));
  });

  test('not playable outside the organization phase (M/H phase)', () => {
    const base = orgState(BREE);
    const inMH: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(plays(inMH)).toHaveLength(0);
  });

  test('playing it installs a company-targeted Wilderness-halving constraint and discards the card', () => {
    const base = orgState(BREE);
    const cardId = findHandCardId(base, RESOURCE_PLAYER, HEY_COME_MERRY_DOL);
    const companyId = companyIdAt(base, RESOURCE_PLAYER, 0);
    const next = playOnCompany(BREE);

    const constraints = next.activeConstraints.filter(c => c.kind.type === 'site-path-reduction');
    expect(constraints).toHaveLength(1);
    expect(constraints[0].scope.kind).toBe('turn');
    expect(constraints[0].target).toEqual({ kind: 'company', companyId });
    expect(constraints[0].kind).toEqual({ type: 'site-path-reduction', reductions: {}, halve: [RegionType.Wilderness] });
    expectInDiscardPile(next, RESOURCE_PLAYER, cardId);
  });

  // ─── Wilderness counts as half, rounded down ────────────────────────────────

  test('two Wildernesses count as one (Rivendell → Bree, starter movement)', () => {
    const baseline = mh(declareStarter(atReveal(orgState(BREE))));
    expect(baseline.resolvedSitePath).toEqual([RegionType.Wilderness, RegionType.Wilderness]);

    const halved = mh(declareStarter(atReveal(playOnCompany(BREE))));
    expect(halved.resolvedSitePath).toEqual([RegionType.Wilderness]);
  });

  test('three Wildernesses count as one — 1.5 rounded down (Rivendell → Dunnish Clan-hold)', () => {
    const baseline = mh(declareStarter(atReveal(orgState(DUNNISH_CLAN_HOLD))));
    expect(baseline.resolvedSitePath).toEqual([RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness]);

    const halved = mh(declareStarter(atReveal(playOnCompany(DUNNISH_CLAN_HOLD))));
    expect(halved.resolvedSitePath).toEqual([RegionType.Wilderness]);
  });

  test('region movement: only Wilderness tokens are halved, other regions and names stay aligned', () => {
    const declareRegion = (s: GameState) => mh(dispatch(s, {
      type: 'declare-path', player: PLAYER_1, movementType: MovementType.Region,
      regionPath: [HOLLIN, REDHORN_GATE, RHUDAUR, ROHAN],
    }));

    const baseline = declareRegion(atReveal(orgState(BREE)));
    expect(baseline.resolvedSitePath).toEqual([
      RegionType.Wilderness, RegionType.Wilderness, RegionType.Wilderness, RegionType.Border,
    ]);

    const halved = declareRegion(atReveal(playOnCompany(BREE)));
    expect(halved.resolvedSitePath).toEqual([RegionType.Wilderness, RegionType.Border]);
    expect(halved.resolvedSitePathNames).toEqual(['Hollin', 'Rohan']);
  });

  test('a single Wilderness counts as zero (half, rounded down)', () => {
    const declareRegion = (s: GameState) => mh(dispatch(s, {
      type: 'declare-path', player: PLAYER_1, movementType: MovementType.Region,
      regionPath: [HOLLIN, ROHAN],
    }));
    const halved = declareRegion(atReveal(playOnCompany(BREE)));
    expect(halved.resolvedSitePath).toEqual([RegionType.Border]);
  });

  test('the halved path denies a creature keyed to two Wildernesses', () => {
    const giantDef = orgState(BREE).cardPool[GIANT] as CreatureCard;

    const baseline = declareStarter(atReveal(orgState(BREE)));
    expect(checkCreatureKeying(baseline, giantDef, mh(baseline))).toBeUndefined();

    const halved = declareStarter(atReveal(playOnCompany(BREE)));
    expect(checkCreatureKeying(halved, giantDef, mh(halved))).toBeDefined();
  });

  test('only the target company is affected — another moving company keeps its full path', () => {
    const played = playOnCompany(BREE, BREE);
    const other = mh(declareStarter(atReveal(played, 1)));
    expect(other.resolvedSitePath).toEqual([RegionType.Wilderness, RegionType.Wilderness]);
  });
});
