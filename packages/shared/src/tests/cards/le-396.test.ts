/**
 * @module le-396.test
 *
 * Card test: Nûrniag Camp (le-396)
 * Type: minion-site (shadow-hold) in Nurn
 * Effects: none
 *
 * Text (authoritative — cardnum LE-396 "Nûrniag Camp", alignment Minion):
 *   "Nearest Darkhaven: Minas Morgul"
 *   (the remaining card text is a flavor quote, not a rule).
 *
 * Like the sibling minion shadow-hold le-394 (Mount Gram), the Lidless Eye
 * Nûrniag Camp prints NO "Playable:" line (attributes.playable is "") and NO
 * "Automatic-attacks:" line (attributes.autoAttack is ""). It is a bare keying
 * site: a company may pass through or stop, but it offers no resource plays and
 * triggers no automatic attack. The faction Nûrniags (le-273) is the resource
 * the site exists to support, but that playability lives on the faction card,
 * not on the site.
 *
 * Site path "{s}{d}{d}" → [shadow, dark, dark]; nearest darkhaven Minas Morgul.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                       |
 * |---|-------------------|--------|-------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — matches cardnum siteType "{S}"              |
 * | 2 | sitePath          | OK     | [shadow, dark, dark] — matches cardnum Path "{s}{d}{d}"     |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion darkhaven (le-390)            |
 * | 4 | region            | OK     | "Nurn" — valid region                                       |
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
 * | 4 | Haven path movement             | IMPLEMENTED | Minas Morgul ↔ Nûrniag Camp via starter        |
 * | 5 | Region movement                 | IMPLEMENTED | sites reachable within 4 regions of Nurn       |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  LORIEN, MINAS_TIRITH, EDHELLOND,
  resetMint, pool,
  buildTestState, viableActions, viableFor, dispatch, companyIdAt,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Phase, Alignment,
} from '../../index.js';
import type { CardDefinitionId, SiteCard, SitePhaseState, GameState } from '../../index.js';

const NURNIAG_CAMP = 'le-396' as CardDefinitionId;        // minion shadow-hold under test
const NURNIAG_CAMP_AS = 'as-140' as CardDefinitionId;     // hero-side Nûrniag Camp (control)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;        // Nûrniag Camp's nearest darkhaven
const MORIA_LE = 'le-392' as CardDefinitionId;            // shadow-hold WITH minor items + auto-attack (control)
const LIEUTENANT_OF_MORGUL = 'le-22' as CardDefinitionId;
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;     // minor minion item

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

describe('Nûrniag Camp (le-396)', () => {
  beforeEach(() => resetMint());

  // ─── No resources playable (empty playableResources) ────────────────────────

  test('a minor minion item is NOT playable at Nûrniag Camp (no Playable line)', () => {
    // Nûrniag Camp lists no playableResources, so even a plain minor item
    // (Strange Rations) cannot be played here.
    const state = siteState(NURNIAG_CAMP, [STRANGE_RATIONS], playResourcesState());
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable).toHaveLength(0);
  });

  test('control: the same minor item IS playable at Moria (which allows minor items)', () => {
    // Regression guard: the item itself is playable; it is Nûrniag Camp's empty
    // playableResources — not the item — that blocks it above.
    const state = siteState(MORIA_LE, [STRANGE_RATIONS], playResourcesState());
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('only `pass` is viable in the play-resources step at Nûrniag Camp', () => {
    const state = siteState(NURNIAG_CAMP, [], playResourcesState());
    const viable = viableFor(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── No automatic attack (empty automaticAttacks) ───────────────────────────

  test('entering Nûrniag Camp triggers no automatic attack (skips to declare-agent-attack)', () => {
    // With an empty automaticAttacks list and no dynamic-auto-attack effect,
    // entering the site advances straight to declare-agent-attack and never
    // initiates combat.
    const state = siteState(NURNIAG_CAMP, [], enterOrSkipState());
    const companyId = companyIdAt(state, 0);
    const after = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });

    expect(after.combat).toBeNull();
    expect(after.phaseState.phase).toBe(Phase.Site);
    expect((after.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  test('control: entering Moria (which has an Orc auto-attack) goes to reveal-on-guard-attacks', () => {
    // Regression guard: the no-combat outcome above is driven by Nûrniag Camp's
    // empty automaticAttacks. A shadow-hold that DOES list an auto-attack
    // routes through the on-guard reveal / automatic-attacks path instead.
    const state = siteState(MORIA_LE, [], enterOrSkipState());
    const companyId = companyIdAt(state, 0);
    const after = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });

    expect((after.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });

  // ─── Movement: starter via the Minas Morgul darkhaven ───────────────────────

  test('starter movement from Minas Morgul reaches Nûrniag Camp (le-396)', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterCamp = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (NURNIAG_CAMP as string),
    );

    expect(starterCamp).toBeDefined();
  });

  test('starter movement from Nûrniag Camp returns to Minas Morgul', () => {
    const nurniagCamp = pool[NURNIAG_CAMP as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, nurniagCamp, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Minas Morgul');
  });

  test('starter movement from a hero haven does NOT reach minion Nûrniag Camp (le-396)', () => {
    // le-396's nearest darkhaven is Minas Morgul; a hero haven cannot starter to
    // it. (The hero-side Nûrniag Camp, as-140, keyed to Edhellond, is a separate
    // card.)
    const edhellond = pool[EDHELLOND as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, edhellond, allSites);
    const starterCampLe = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (NURNIAG_CAMP as string),
    );
    const starterCampAs = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (NURNIAG_CAMP_AS as string),
    );

    expect(starterCampLe).toBeUndefined();
    // Sanity: the hero-side Nûrniag Camp (keyed to Edhellond) IS reachable,
    // confirming the negative above is about alignment/keying, not the name.
    expect(starterCampAs).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Nûrniag Camp stays within 4 regions of Nurn', () => {
    const nurniagCamp = pool[NURNIAG_CAMP as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, nurniagCamp, allSites);
    let regionCount = 0;
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      regionCount++;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
    expect(regionCount).toBeGreaterThan(0);
  });
});
