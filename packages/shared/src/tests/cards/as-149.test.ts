/**
 * @module as-149.test
 *
 * Card test: Grey Havens (as-149)
 * Type: minion-site (free-hold) in Lindon, alignment ringwraith. Unique.
 * Nearest Darkhaven: Carn Dûm. Site path: {s}{w}{f}.
 * Playable: Information, Items (minor, major, greater)
 * Automatic-attacks (2): (1st) Elves — 3 strikes with 8 prowess;
 * (2nd) Elves — 2 strikes with 10 prowess.
 *
 * Text:
 *   "Special: Any company moving to this site has its hazard limit increased
 *    by 2. A minion company may not attack another company at this site.
 *    A Ringwraith may not move to this site."
 *
 * This is the minion sibling of the hero haven Grey Havens (tw-399) — its
 * Special text is identical to Edhellond (as-145) / Rivendell (as-160), so it
 * reuses the same three site-rule effects (all already implemented in the
 * engine).
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
import { LEGOLAS, LORIEN } from '../../card-ids.js';
import { reduce, Phase, Alignment } from '../../index.js';
import type { CardDefinitionId, MovementHazardPhaseState, SitePhaseState } from '../../index.js';
import type { PlanMovementAction } from '../../types/actions-organization.js';

const GREY_HAVENS_MINION = 'as-149' as CardDefinitionId;
// tw-399: Grey Havens — the hero (haven) twin of the minion free-hold, sharing
// the location by name (used for the cross-alignment CvCC target).
const GREY_HAVENS_HERO = 'tw-399' as CardDefinitionId;
// as-4: Perchen — minion Man character (no Ringwraith).
const PERCHEN = 'as-4' as CardDefinitionId;
// le-58: The Witch-king — Ringwraith avatar (race: ringwraith).
const THE_WITCH_KING = 'le-58' as CardDefinitionId;
// le-170: Black Rider — mode card lifting the Darkhaven-only movement gate.
const BLACK_RIDER = 'le-170' as CardDefinitionId;
// le-359: Carn Dûm — the minion Darkhaven nearest to Grey Havens (as-149).
const CARN_DUM_MINION = 'le-359' as CardDefinitionId;
// le-386 / tw-407: minion and hero versions of Lond Galen — a border-hold with
// no deny rules (control location for the CvCC test).
const LOND_GALEN_MINION = 'le-386' as CardDefinitionId;
const LOND_GALEN_HERO = 'tw-407' as CardDefinitionId;
// as-156: Old Forest — a minion border-hold with no deny rules whose nearest
// Darkhaven is also Carn Dûm, so it is reachable in the same movement pass as
// Grey Havens (control destination for the Ringwraith movement test).
const OLD_FOREST_MINION = 'as-156' as CardDefinitionId;

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

describe('Grey Havens (as-149)', () => {
  beforeEach(() => resetMint());

  // ─── Rule #1: any company moving to this site has its hazard limit +2 ──────

  test('minion company moving to Grey Havens: hazard limit is 2 + 2 = 4', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM_MINION, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [LOND_GALEN_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const destInstId = mint();
    const company = {
      ...base.players[RESOURCE_PLAYER].companies[0],
      destinationSite: { instanceId: destInstId, definitionId: GREY_HAVENS_MINION, status: CardStatus.Untapped },
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

  test('non-moving company at Grey Havens: hazard limit is NOT increased', () => {
    // Only companies "moving to this site" get the +2 — a company staying at
    // Grey Havens keeps the base limit.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: GREY_HAVENS_MINION, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [LOND_GALEN_MINION],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
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
          { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: LOND_GALEN_MINION, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION] },
          { id: PLAYER_2, companies: [{ site: LOND_GALEN_HERO, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
        ],
      }),
      phaseState: SITE_PHASE_STATE,
    };
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(viableActions(afterPass, PLAYER_1, 'declare-company-attack')).toHaveLength(1);
  });

  test('a minion company at Grey Havens may NOT declare a CvCC attack on a hero company there', () => {
    const state = {
      ...buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: GREY_HAVENS_MINION, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION] },
          { id: PLAYER_2, companies: [{ site: GREY_HAVENS_HERO, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
        ],
      }),
      phaseState: SITE_PHASE_STATE,
    };
    const afterPass = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(viableActions(afterPass, PLAYER_1, 'declare-company-attack')).toHaveLength(0);
  });

  test('reducer rejects a declare-company-attack forced through at Grey Havens', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: GREY_HAVENS_MINION, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM_MINION] },
        { id: PLAYER_2, companies: [{ site: GREY_HAVENS_HERO, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
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

  test('control: a minion company without a Ringwraith may plan movement to Grey Havens', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM_MINION, characters: [PERCHEN] }],
          hand: [],
          siteDeck: [GREY_HAVENS_MINION, LOND_GALEN_MINION],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const greyHavensInst = state.players[0].siteDeck.find(s => s.definitionId === GREY_HAVENS_MINION)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === greyHavensInst)).toBe(true);
  });

  test('a company containing a Ringwraith may NOT plan movement to Grey Havens', () => {
    // The Witch-king rides out under Black Rider mode, which lifts the
    // Darkhaven-only gate — Lond Galen (a non-Darkhaven) is offered, proving the
    // fixture reaches non-Darkhaven sites, but Grey Havens stays barred.
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM_MINION, characters: [THE_WITCH_KING] }],
          hand: [],
          siteDeck: [GREY_HAVENS_MINION, OLD_FOREST_MINION],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, BLACK_RIDER, companyIdAt(state, RESOURCE_PLAYER));
    const greyHavensInst = state.players[0].siteDeck.find(s => s.definitionId === GREY_HAVENS_MINION)!.instanceId;
    const oldForestInst = state.players[0].siteDeck.find(s => s.definitionId === OLD_FOREST_MINION)!.instanceId;

    const plans = viableActions(state, PLAYER_1, 'plan-movement');
    expect(plans.some(ea => (ea.action as PlanMovementAction).destinationSite === oldForestInst)).toBe(true);
    expect(plans.every(ea => (ea.action as PlanMovementAction).destinationSite !== greyHavensInst)).toBe(true);
  });

  test('reducer rejects a plan-movement to Grey Havens forced through for a Ringwraith company', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM_MINION, characters: [THE_WITCH_KING] }],
          hand: [],
          siteDeck: [GREY_HAVENS_MINION, LOND_GALEN_MINION],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    state = addCardInPlay(state, RESOURCE_PLAYER, BLACK_RIDER, companyIdAt(state, RESOURCE_PLAYER));
    const greyHavensInst = state.players[0].siteDeck.find(s => s.definitionId === GREY_HAVENS_MINION)!.instanceId;

    const result = reduce(state, {
      type: 'plan-movement',
      player: PLAYER_1,
      companyId: companyIdAt(state, RESOURCE_PLAYER),
      destinationSite: greyHavensInst,
    });
    expect(result.error).toBe('A site rule forbids this company from moving to this site');
  });
});
