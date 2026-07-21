/**
 * @module as-155.test
 *
 * Card test: Lórien (as-155)
 * Type: minion-site (free-hold) in Wold & Foothills, alignment ringwraith. Unique.
 * Nearest Darkhaven: Dol Guldur. Site path: {d}{s}{w}.
 * Playable: Information, Items (minor, major, greater, gold ring)
 * Automatic-attacks (3): (1st) Elves — 4 strikes with 8 prowess;
 * (2nd) Elves — 3 strikes with 9 prowess; (3rd) Elves — 2 strikes with 10 prowess.
 *
 * Text:
 *   "Special: Any company moving to this site has its hazard limit increased
 *    by 2. A minion company may not attack another company at this site.
 *    A Ringwraith may not move to this site."
 *
 * This is the minion-Elf-haven sibling of Rivendell (as-160) and Edhellond
 * (as-145) — identical Special text, so it reuses the same three site-rule
 * effects (all already implemented in the engine). The only shared location
 * twin of Lórien is the hero haven Lórien (tw-408); the two versions share the
 * location by name.
 *
 * Effects:
 * | # | Effect Type                        | Status      | Notes                                             |
 * |---|------------------------------------|-------------|---------------------------------------------------|
 * | 1 | site-rule hazard-limit-modifier +2 | IMPLEMENTED | snapshotHazardLimit reads destination site rules  |
 * | 2 | site-rule deny-company-attack      | IMPLEMENTED | when attacker.isMinion — CvCC suppressed here     |
 * | 3 | site-rule deny-company-move        | IMPLEMENTED | when company.hasRingwraith — destination dropped  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, mint, viableActions, dispatch,
  makeMHState, companyIdAt,
  addCardInPlay,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  CardStatus,
} from '../test-helpers.js';
import { LEGOLAS, LORIEN, EDHELLOND } from '../../card-ids.js';
import { reduce, Phase, Alignment } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState, SitePhaseState } from '../../index.js';
import type { PlanMovementAction } from '../../types/actions-organization.js';

const LORIEN_MINION = 'as-155' as CardDefinitionId;
// LORIEN (tw-408) is the hero-haven twin of Lórien, sharing the location by name.
const LORIEN_HERO = LORIEN;
// as-4: Perchen — minion Man character (no Ringwraith).
const PERCHEN = 'as-4' as CardDefinitionId;
// le-58: The Witch-king — Ringwraith avatar (race: ringwraith).
const THE_WITCH_KING = 'le-58' as CardDefinitionId;
// le-170: Black Rider — mode card lifting the Darkhaven-only movement gate.
const BLACK_RIDER = 'le-170' as CardDefinitionId;
// le-367: Dol Guldur — the minion Darkhaven nearest to Lórien (as-155).
const DOL_GULDUR_MINION = 'le-367' as CardDefinitionId;
// le-386 / tw-407: minion and hero versions of Lond Galen — a border-hold with
// no deny rules (control location for the CvCC tests).
const LOND_GALEN_MINION = 'le-386' as CardDefinitionId;
const LOND_GALEN_HERO = 'tw-407' as CardDefinitionId;
// le-382: Hermit's Hill — a non-haven minion site in Wold & Foothills (Lórien's
// own region) with no deny rules. Reachable from Dol Guldur alongside Lórien, so
// it is the "fixture reaches a non-Darkhaven site" control for the Ringwraith
// movement tests.
const HERMITS_HILL = 'le-382' as CardDefinitionId;

const SITE_PHASE_STATE: SitePhaseState = {
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

describe('Lórien (as-155)', () => {
  beforeEach(() => resetMint());

  // ─── Rule #1: any company moving to this site has its hazard limit +2 ──────

  test('minion company moving to Lórien: hazard limit is 2 + 2 = 4', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR_MINION, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [LOND_GALEN_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: EDHELLOND, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const destInstId = mint();
    const company = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: LORIEN_MINION, status: CardStatus.Untapped },
    };
    const players = [
      { ...base.players[RESOURCE_PLAYER], companies: [company] },
      base.players[1],
    ] as typeof base.players;

    const state = { ...base, players, phaseState: makeMHState({ step: 'set-hazard-limit' }) };
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const result = next.phaseState as MovementHazardPhaseState;

    expect(result.step).toBe('draw-cards');
    expect(result.hazardLimitAtReveal).toBe(4); // 2 (base for 1 char) + 2 (site-rule)
  });

  test('non-moving company at Lórien: hazard limit is NOT increased', () => {
    // Only companies "moving to this site" get the +2 — a company staying at
    // Lórien keeps the base limit.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: LORIEN_MINION, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [LOND_GALEN_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: EDHELLOND, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const state = { ...base, phaseState: makeMHState({ step: 'set-hazard-limit' }) };
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    const result = next.phaseState as MovementHazardPhaseState;

    expect(result.hazardLimitAtReveal).toBe(2); // base only, no site-rule bonus
  });

  // ─── Rule #2: a minion company may not attack another company here ─────────

  test('control: a minion company at Lond Galen may declare a CvCC attack on a hero company there', () => {
    // Same fixture at a location without the deny rule proves the attack would
    // otherwise be offered (minion → hero is legal per the alignment matrix).
    const state = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: LOND_GALEN_MINION, characters: [PERCHEN] }], hand: [], siteDeck: [DOL_GULDUR_MINION] },
          { id: PLAYER_2, companies: [{ site: LOND_GALEN_HERO, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN_HERO] },
        ],
      }),
      phaseState: SITE_PHASE_STATE,
    };
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(viableActions(afterPass, PLAYER_1, 'declare-company-attack')).toHaveLength(1);
  });

  test('a minion company at Lórien may NOT declare a CvCC attack on a hero company there', () => {
    const state = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN_MINION, characters: [PERCHEN] }], hand: [], siteDeck: [DOL_GULDUR_MINION] },
          { id: PLAYER_2, companies: [{ site: LORIEN_HERO, characters: [LEGOLAS] }], hand: [], siteDeck: [EDHELLOND] },
        ],
      }),
      phaseState: SITE_PHASE_STATE,
    };
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(viableActions(afterPass, PLAYER_1, 'declare-company-attack')).toHaveLength(0);
  });

  test('reducer rejects a declare-company-attack forced through at Lórien', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN_MINION, characters: [PERCHEN] }], hand: [], siteDeck: [DOL_GULDUR_MINION] },
        { id: PLAYER_2, companies: [{ site: LORIEN_HERO, characters: [LEGOLAS] }], hand: [], siteDeck: [EDHELLOND] },
      ],
    });
    const state = {
      ...base,
      phaseState: { ...SITE_PHASE_STATE, step: 'declare-company-attack' } as SitePhaseState,
    };
    const result = reduce(state, {
      type: 'declare-company-attack',
      player: PLAYER_1,
      attackingCompanyId: companyIdAt(state, 0),
      targetCompanyId: companyIdAt(state, 1),
    });
    expect(result.error).toBe('A site rule forbids company-vs-company attacks at this site');
  });

  // ─── Rule #3: a Ringwraith may not move to this site ───────────────────────

  test('control: a minion company without a Ringwraith may plan movement to Lórien', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR_MINION, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [LORIEN_MINION, HERMITS_HILL],
        },
        { id: PLAYER_2, companies: [{ site: EDHELLOND, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const lorienInst = state.players[0].siteDeck.find(s => s.definitionId === LORIEN_MINION)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === lorienInst)).toBe(true);
  });

  test('a company containing a Ringwraith may NOT plan movement to Lórien', () => {
    // The Witch-king rides out under Black Rider mode, which lifts the
    // Darkhaven-only gate — Hermit's Hill (a non-Darkhaven in Lórien's region) is
    // offered, proving the fixture reaches non-Darkhaven sites, but Lórien stays
    // barred.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR_MINION, characters: [THE_WITCH_KING] }],
          hand: [],
          siteDeck: [LORIEN_MINION, HERMITS_HILL],
        },
        { id: PLAYER_2, companies: [{ site: EDHELLOND, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, BLACK_RIDER, companyIdAt(state, RESOURCE_PLAYER));
    const lorienInst = state.players[0].siteDeck.find(s => s.definitionId === LORIEN_MINION)!.instanceId;
    const hermitsInst = state.players[0].siteDeck.find(s => s.definitionId === HERMITS_HILL)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === hermitsInst)).toBe(true);
    expect(plans.every(ea => (ea.action as PlanMovementAction).destinationSite !== lorienInst)).toBe(true);
  });

  test('reducer rejects a plan-movement to Lórien forced through for a Ringwraith company', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR_MINION, characters: [THE_WITCH_KING] }],
          hand: [],
          siteDeck: [LORIEN_MINION, HERMITS_HILL],
        },
        { id: PLAYER_2, companies: [{ site: EDHELLOND, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, BLACK_RIDER, companyIdAt(state, RESOURCE_PLAYER));
    const lorienInst = state.players[0].siteDeck.find(s => s.definitionId === LORIEN_MINION)!.instanceId;

    const result = reduce(state, {
      type: 'plan-movement',
      player: PLAYER_1,
      companyId: companyIdAt(state, RESOURCE_PLAYER),
      destinationSite: lorienInst,
    });
    expect(result.error).toBe('A site rule forbids this company from moving to this site');
  });
});
