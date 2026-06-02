/**
 * @module le-352.test
 *
 * Card test: Barad-dûr (le-352)
 * Type: minion-site (dark-hold)
 *
 * Text:
 *   "Nearest Darkhaven: Minas Morgul.
 *    Special: Treat this site as a Darkhaven during the untap phase.
 *    Any gold ring item at this site is automatically tested during the
 *    site phase (the site need not be entered). All ring tests at this
 *    site are modified by -3."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                     |
 * |---|-------------------|--------|-----------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — matches {D}                                 |
 * | 2 | sitePath          | OK     | [shadow, dark] — matches {s}{d}                           |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion haven (le-390)              |
 * | 4 | region            | OK     | "Gorgoroth" — adjacent to Imlad Morgul (Minas Morgul)     |
 * | 5 | playableResources | OK     | [] — no items may be played here                          |
 * | 6 | automaticAttacks  | OK     | [] — no automatic-attacks                                 |
 * | 7 | resourceDraws     | OK     | 2                                                         |
 * | 8 | hazardDraws       | OK     | 1                                                         |
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                                 |
 * |---|------------------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                          | IMPLEMENTED | select-company, enter-or-skip (no resources, no AA)   |
 * | 2 | Haven path movement                      | IMPLEMENTED | Minas Morgul ↔ Barad-dûr via starter movement         |
 * | 3 | Region movement                          | IMPLEMENTED | sites within 4 regions of Gorgoroth                   |
 * | 4 | Card draws                               | IMPLEMENTED | resourceDraws (2) / hazardDraws (1)                   |
 * | 5 | site-rule: heal-during-untap             | IMPLEMENTED | wounded characters heal during untap at this site     |
 * | 6 | site-rule: site-phase-ring-auto-test     | IMPLEMENTED | borne gold rings auto-tested before enter-or-skip     |
 * | 7 | -3 modifier on all ring tests at site    | IMPLEMENTED | captured in site-phase-ring-auto-test rollModifier    |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RIVENDELL, LORIEN, MORIA,
  LEGOLAS,
  resetMint, pool, buildTestState, Phase, Alignment, CardStatus,
  dispatch, expectCharStatus, RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, computeLegalActions,
} from '../../index.js';
import type { SiteCard, CardDefinitionId, SitePhaseState } from '../../index.js';

const BARAD_DUR = 'le-352' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId; // minion-character, ringwraith
const THE_LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId;

/** Build a SitePhaseState at the select-company step. */
const SELECT_COMPANY_PHASE: SitePhaseState = {
  phase: Phase.Site,
  step: 'select-company',
  activeCompanyIndex: -1,
  handledCompanyIds: [],
  siteEntered: false,
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

describe('Barad-dûr (le-352)', () => {
  beforeEach(() => resetMint());

  // ─── Movement ───────────────────────────────────────────────────────────────

  test('reachable from Minas Morgul (nearest darkhaven) via starter movement', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(BARAD_DUR);
  });

  test('starter movement from Barad-dûr returns to Minas Morgul', () => {
    const baradDur = pool[BARAD_DUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, baradDur, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).toContain(MINAS_MORGUL);
  });

  test('not reachable from Dol Guldur via starter movement', () => {
    // Barad-dûr's nearest darkhaven is Minas Morgul, not Dol Guldur.
    const dolGuldur = pool[DOL_GULDUR as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, dolGuldur, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(BARAD_DUR);
  });

  test('not reachable from a hero haven via starter movement', () => {
    // Barad-dûr is a minion site; hero havens have no starter route to it.
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterIds = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.id);

    expect(starterIds).not.toContain(BARAD_DUR);
  });

  // ─── Untap phase: Darkhaven treatment ───────────────────────────────────────
  // Barad-dûr's text: "Treat this site as a Darkhaven during the untap phase."
  // The observable effect is that wounded (inverted) characters at Barad-dûr
  // heal to tapped during untap, as they would at a haven. The rest of the
  // game still treats the site as a dark-hold.

  test('wounded character at Barad-dûr heals during untap (Darkhaven rule)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [{ defId: MIONID, status: CardStatus.Inverted }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });

    // Wounded → tapped (same behavior as at a haven).
    expectCharStatus(nextState, RESOURCE_PLAYER, MIONID, CardStatus.Tapped);
  });

  test('tapped character at Barad-dûr untaps normally during untap', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [{ defId: MIONID, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });

    expectCharStatus(nextState, RESOURCE_PLAYER, MIONID, CardStatus.Untapped);
  });

  test('regression: wounded character at a non-Barad-dûr dark-hold does NOT heal during untap', () => {
    // Guards against the heal-during-untap site-rule leaking to other sites
    // that lack the rule. Moria (le-392) is a shadow-hold with its own
    // site-rule but NOT heal-during-untap, so wounded characters there stay
    // wounded during untap.
    const MORIA_LE = 'le-392' as CardDefinitionId;
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_LE, characters: [{ defId: MIONID, status: CardStatus.Inverted }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const nextState = dispatch(state, { type: 'untap', player: PLAYER_1 });

    expectCharStatus(nextState, RESOURCE_PLAYER, MIONID, CardStatus.Inverted);
  });

  // ─── Site phase: gold ring auto-test ────────────────────────────────────────
  // "Any gold ring item at this site is automatically tested during the site
  //  phase (the site need not be entered). All ring tests at this site are
  //  modified by -3."

  test('borne gold ring at Barad-dûr is auto-tested when company is selected', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: BARAD_DUR,
            characters: [{ defId: MIONID, items: [THE_LEAST_OF_GOLD_RINGS] }],
          }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const selectCompanyState = { ...state, phaseState: SELECT_COMPANY_PHASE };
    const companyId = selectCompanyState.players[0].companies[0].id;
    const afterSelect = dispatch(selectCompanyState, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });

    // gold-ring-test pending resolution must be enqueued with rollModifier -3.
    const ringTest = afterSelect.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
    expect(ringTest).toBeDefined();
    const kind = ringTest!.kind;
    if (kind.type !== 'gold-ring-test') throw new Error('unreachable');
    expect(kind.rollModifier).toBe(-3);
  });

  test('gold ring auto-test fires even when company does not enter the site', () => {
    // The gold-ring-test pending resolution is enqueued at select-company,
    // before enter-or-skip. Legal actions at that point must be gold-ring-test-roll
    // (not enter-site or pass), proving the test precedes the entry decision.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: BARAD_DUR,
            characters: [{ defId: MIONID, items: [THE_LEAST_OF_GOLD_RINGS] }],
          }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const selectCompanyState = { ...state, phaseState: SELECT_COMPANY_PHASE };
    const companyId = selectCompanyState.players[0].companies[0].id;
    const afterSelect = dispatch(selectCompanyState, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });

    // Legal actions after select-company should be gold-ring-test-roll only
    // (pending resolution drains before enter-or-skip is offered).
    const actions = computeLegalActions(afterSelect, PLAYER_1);
    const viableTypes = actions.filter(a => a.viable).map(a => a.action.type);
    expect(viableTypes).toContain('gold-ring-test-roll');
    expect(viableTypes).not.toContain('enter-site');
    expect(viableTypes).not.toContain('pass');
  });

  test('all ring tests at Barad-dûr have a -3 modifier applied to the 2d6 roll', () => {
    // After select-company the gold-ring-test is pending. The legal action
    // carries the same -3 rollModifier as the pending resolution.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: BARAD_DUR,
            characters: [{ defId: MIONID, items: [THE_LEAST_OF_GOLD_RINGS] }],
          }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const selectCompanyState = { ...state, phaseState: SELECT_COMPANY_PHASE };
    const companyId = selectCompanyState.players[0].companies[0].id;
    const afterSelect = dispatch(selectCompanyState, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });

    // Get ring instance ID from the pending resolution.
    const ringTestRes = afterSelect.pendingResolutions.find(r => r.kind.type === 'gold-ring-test')!;
    const kind = ringTestRes.kind;
    if (kind.type !== 'gold-ring-test') throw new Error('unreachable');
    const ringInstId = kind.goldRingInstanceId;

    // The legal action for the roll carries the -3 rollModifier.
    const rollActions = computeLegalActions(afterSelect, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'gold-ring-test-roll');
    expect(rollActions).toHaveLength(1);
    const rollAction = rollActions[0].action as { rollModifier: number };
    expect(rollAction.rollModifier).toBe(-3);

    // Dispatch the roll and verify the ring is discarded afterwards.
    const afterRoll = dispatch(afterSelect, rollActions[0].action);
    const ringInDiscard = afterRoll.players[0].discardPile.some(c => c.instanceId === ringInstId);
    expect(ringInDiscard).toBe(true);

    const chars = Object.values(afterRoll.players[0].characters);
    const ringStillOnChar = chars.some(ch => ch.items.some(i => i.instanceId === ringInstId));
    expect(ringStillOnChar).toBe(false);

    // ring-play-offer must follow (Rule 9.21).
    const offerRes = afterRoll.pendingResolutions.find(r => r.kind.type === 'ring-play-offer');
    expect(offerRes).toBeDefined();
  });

  test('company without a gold ring at Barad-dûr gets no ring-test at select-company', () => {
    // Regression: the site rule must only fire for borne gold rings, not
    // for any item or character.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR, characters: [MIONID] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });

    const selectCompanyState = { ...state, phaseState: SELECT_COMPANY_PHASE };
    const companyId = selectCompanyState.players[0].companies[0].id;
    const afterSelect = dispatch(selectCompanyState, {
      type: 'select-company',
      player: PLAYER_1,
      companyId,
    });

    // No gold-ring-test pending resolution.
    const ringTest = afterSelect.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
    expect(ringTest).toBeUndefined();

    // Player should get enter-or-skip choices.
    const actions = computeLegalActions(afterSelect, PLAYER_1);
    const viableTypes = actions.filter(a => a.viable).map(a => a.action.type);
    expect(viableTypes).toContain('pass');
  });
});
