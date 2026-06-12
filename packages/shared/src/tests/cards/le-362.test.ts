/**
 * @module le-362.test
 *
 * Card test: Cirith Ungol (le-362)
 * Type: minion-site (dark-hold) in Imlad Morgul
 * Effects: none
 *
 * Text (authoritative — cardnum LE "Cirith Ungol", alignment Minion):
 *   "Nearest Darkhaven: Minas Morgul"
 *   (the remaining card text is a flavor quote, not a rule).
 *
 * Like the sibling minion site le-394 (Mount Gram), the Lidless Eye Cirith
 * Ungol prints NO "Playable:" line and NO "Automatic-attacks:" line
 * (`attributes.playable` and `attributes.autoAttack` are both empty in
 * data/cards.json). It is a bare keying site: a company may pass through or
 * stop, but it offers no resource plays and triggers no automatic attack.
 * The hero-side Cirith Ungol (tw-382, keyed to Lórien) is a separate card.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                       |
 * |---|-------------------|--------|-------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                                         |
 * | 2 | sitePath          | OK     | [shadow] — matches cardnum Path "{s}"                       |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion darkhaven (le-390)            |
 * | 4 | region            | OK     | "Imlad Morgul" — valid region                               |
 * | 5 | playableResources | OK     | [] — card prints no Playable line                           |
 * | 6 | automaticAttacks  | OK     | [] — card prints no Automatic-attacks line                  |
 * | 7 | resourceDraws     | OK     | 1                                                           |
 * | 8 | hazardDraws       | OK     | 1                                                           |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                          |
 * |---|---------------------------------|-------------|------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources  |
 * | 2 | No resources playable           | IMPLEMENTED | empty playableResources → no item plays        |
 * | 3 | No automatic attack             | IMPLEMENTED | empty automaticAttacks → enter skips to        |
 * |   |                                 |             | declare-agent-attack, no combat initiated      |
 * | 4 | Haven path movement             | IMPLEMENTED | Minas Morgul ↔ Cirith Ungol via starter        |
 * | 5 | Region movement                 | IMPLEMENTED | sites reachable within 4 regions of Imlad Morgul|
 *
 * Playable: YES
 * Certified: 2026-06-12
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  LORIEN, MINAS_TIRITH,
  resetMint, pool,
  buildTestState, viableActions, viableFor, dispatch, companyIdAt,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Phase, Alignment,
} from '../../index.js';
import type { CardDefinitionId, SiteCard, SitePhaseState, GameState } from '../../index.js';

const CIRITH_UNGOL = 'le-362' as CardDefinitionId;     // minion dark-hold under test
const CIRITH_UNGOL_TW = 'tw-382' as CardDefinitionId;  // hero-side Cirith Ungol (control, keyed to Lórien)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;     // Cirith Ungol's nearest darkhaven
const MORIA_LE = 'le-392' as CardDefinitionId;         // shadow-hold WITH minor items + auto-attack (control)
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;  // minor minion item

const playResourcesState = (): SitePhaseState => ({
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
});

const enterOrSkipState = (): SitePhaseState => ({
  ...playResourcesState(),
  step: 'enter-or-skip',
  siteEntered: false,
});

function siteState(site: CardDefinitionId, hand: CardDefinitionId[], phaseState: SitePhaseState): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site, characters: [LIEUTENANT_OF_MORGUL] }],
        hand,
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
  return { ...base, phaseState };
}

describe('Cirith Ungol (le-362)', () => {
  beforeEach(() => resetMint());

  // ─── No resources playable (empty playableResources) ────────────────────────

  test('a minor minion item is NOT playable at Cirith Ungol (no Playable line)', () => {
    // Cirith Ungol lists no playableResources, so even a plain minor item
    // (Strange Rations) cannot be played here.
    const state = siteState(CIRITH_UNGOL, [STRANGE_RATIONS], playResourcesState());
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable).toHaveLength(0);
  });

  test('control: the same minor item IS playable at Moria (which allows minor items)', () => {
    // Regression guard: the item itself is playable; it is Cirith Ungol's empty
    // playableResources — not the item — that blocks it above.
    const state = siteState(MORIA_LE, [STRANGE_RATIONS], playResourcesState());
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('only `pass` is viable in the play-resources step at Cirith Ungol', () => {
    const state = siteState(CIRITH_UNGOL, [], playResourcesState());
    const viable = viableFor(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── No automatic attack (empty automaticAttacks) ───────────────────────────

  test('entering Cirith Ungol triggers no automatic attack (skips to declare-agent-attack)', () => {
    // With an empty automaticAttacks list and no dynamic-auto-attack effect,
    // entering the site advances straight to declare-agent-attack and never
    // initiates combat.
    const state = siteState(CIRITH_UNGOL, [], enterOrSkipState());
    const companyId = companyIdAt(state, 0);
    const after = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });

    expect(after.combat).toBeNull();
    expect(after.phaseState.phase).toBe(Phase.Site);
    expect((after.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  test('control: entering Moria (which has an Orc auto-attack) goes to reveal-on-guard-attacks', () => {
    // Regression guard: the no-combat outcome above is driven by Cirith Ungol's
    // empty automaticAttacks. A shadow-hold that DOES list an auto-attack
    // routes through the on-guard reveal / automatic-attacks path instead.
    const state = siteState(MORIA_LE, [], enterOrSkipState());
    const companyId = companyIdAt(state, 0);
    const after = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });

    expect((after.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });

  // ─── Movement: starter via the Minas Morgul darkhaven ───────────────────────

  test('starter movement from Minas Morgul reaches Cirith Ungol (le-362)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterCu = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CIRITH_UNGOL as string),
    );

    expect(starterCu).toBeDefined();
  });

  test('starter movement from Cirith Ungol returns to Minas Morgul', () => {
    const cirithUngol = pool[CIRITH_UNGOL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, cirithUngol, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Minas Morgul');
  });

  test('starter movement from a hero haven (Lórien) reaches hero Cirith Ungol but NOT minion le-362', () => {
    // le-362's nearest darkhaven is Minas Morgul; a hero haven cannot starter
    // to it. The hero-side Cirith Ungol (tw-382) is keyed to Lórien, so it IS
    // reachable — confirming the negative is about alignment/keying, not name.
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterCuLe = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CIRITH_UNGOL as string),
    );
    const starterCuTw = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (CIRITH_UNGOL_TW as string),
    );

    expect(starterCuLe).toBeUndefined();
    expect(starterCuTw).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Cirith Ungol stays within 4 regions of Imlad Morgul', () => {
    const cirithUngol = pool[CIRITH_UNGOL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, cirithUngol, allSites);
    let regionCount = 0;
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      regionCount++;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
    expect(regionCount).toBeGreaterThan(0);
  });
});
