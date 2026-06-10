/**
 * @module le-394.test
 *
 * Card test: Mount Gram (le-394)
 * Type: minion-site (shadow-hold) in Angmar
 * Effects: none
 *
 * Text (authoritative — cardnum MELE "Mount Gram", alignment Minion):
 *   "Nearest Darkhaven: Carn Dûm"
 *   (the remaining card text is a flavor quote, not a rule).
 *
 * Unlike most sites — and unlike the hero-side Mount Gram (tw-415) and the
 * sibling minion shadow-holds (le-392 Moria, le-395 Mount Gundabad) — the
 * Lidless Eye Mount Gram prints NO "Playable:" line and NO "Automatic-attacks:"
 * line. It is a bare keying site: a company may pass through or stop, but it
 * offers no resource plays and triggers no automatic attack.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                       |
 * |---|-------------------|--------|-------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                       |
 * | 2 | sitePath          | OK     | [shadow] — matches cardnum Path " s "                       |
 * | 3 | nearestHaven      | OK     | "Carn Dûm" — valid minion darkhaven (le-359)                |
 * | 4 | region            | OK     | "Angmar" — valid region                                     |
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
 * | 4 | Haven path movement             | IMPLEMENTED | Carn Dûm ↔ Mount Gram via starter movement     |
 * | 5 | Region movement                 | IMPLEMENTED | sites reachable within 4 regions of Angmar     |
 *
 * Playable: YES
 * Certified: 2026-06-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  resetMint, pool,
  buildTestState, viableActions, viableFor, dispatch, companyIdAt,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, Phase, Alignment,
} from '../../index.js';
import type { CardDefinitionId, SiteCard, SitePhaseState, GameState } from '../../index.js';

const MOUNT_GRAM = 'le-394' as CardDefinitionId;       // minion shadow-hold under test
const MOUNT_GRAM_TW = 'tw-415' as CardDefinitionId;    // hero-side Mount Gram (control)
const CARN_DUM = 'le-359' as CardDefinitionId;         // Mount Gram's nearest darkhaven
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
        siteDeck: [CARN_DUM],
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

describe('Mount Gram (le-394)', () => {
  beforeEach(() => resetMint());

  // ─── No resources playable (empty playableResources) ────────────────────────

  test('a minor minion item is NOT playable at Mount Gram (no Playable line)', () => {
    // Mount Gram lists no playableResources, so even a plain minor item
    // (Strange Rations) cannot be played here.
    const state = siteState(MOUNT_GRAM, [STRANGE_RATIONS], playResourcesState());
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable).toHaveLength(0);
  });

  test('control: the same minor item IS playable at Moria (which allows minor items)', () => {
    // Regression guard: the item itself is playable; it is Mount Gram's empty
    // playableResources — not the item — that blocks it above.
    const state = siteState(MORIA_LE, [STRANGE_RATIONS], playResourcesState());
    const viable = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(viable.length).toBeGreaterThan(0);
  });

  test('only `pass` is viable in the play-resources step at Mount Gram', () => {
    const state = siteState(MOUNT_GRAM, [], playResourcesState());
    const viable = viableFor(state, PLAYER_1);
    expect(viable).toHaveLength(1);
    expect(viable[0].action.type).toBe('pass');
  });

  // ─── No automatic attack (empty automaticAttacks) ───────────────────────────

  test('entering Mount Gram triggers no automatic attack (skips to declare-agent-attack)', () => {
    // With an empty automaticAttacks list and no dynamic-auto-attack effect,
    // entering the site advances straight to declare-agent-attack and never
    // initiates combat.
    const state = siteState(MOUNT_GRAM, [], enterOrSkipState());
    const companyId = companyIdAt(state, 0);
    const after = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });

    expect(after.combat).toBeNull();
    expect(after.phaseState.phase).toBe(Phase.Site);
    expect((after.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  test('control: entering Moria (which has an Orc auto-attack) goes to reveal-on-guard-attacks', () => {
    // Regression guard: the no-combat outcome above is driven by Mount Gram's
    // empty automaticAttacks. A shadow-hold that DOES list an auto-attack
    // routes through the on-guard reveal / automatic-attacks path instead.
    const state = siteState(MORIA_LE, [], enterOrSkipState());
    const companyId = companyIdAt(state, 0);
    const after = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });

    expect((after.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });

  // ─── Movement: starter via the Carn Dûm darkhaven ───────────────────────────

  test('starter movement from Carn Dûm reaches Mount Gram (le-394)', () => {
    const carnDum = pool[CARN_DUM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, carnDum, allSites);
    const starterGram = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MOUNT_GRAM as string),
    );

    expect(starterGram).toBeDefined();
  });

  test('starter movement from Mount Gram returns to Carn Dûm', () => {
    const mountGram = pool[MOUNT_GRAM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, mountGram, allSites);
    const starterNames = reachable
      .filter(r => r.movementType === 'starter')
      .map(r => r.site.name);

    expect(starterNames).toContain('Carn Dûm');
  });

  test('starter movement from a hero haven does NOT reach minion Mount Gram (le-394)', () => {
    // le-394's nearest darkhaven is Carn Dûm; a hero haven cannot starter to it.
    // (The hero-side Mount Gram, tw-415, keyed to Rivendell, is a separate card.)
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterGramLe = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MOUNT_GRAM as string),
    );
    const starterGramTw = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (MOUNT_GRAM_TW as string),
    );

    expect(starterGramLe).toBeUndefined();
    // Sanity: the hero-side Mount Gram (keyed to Rivendell) IS reachable,
    // confirming the negative above is about alignment/keying, not the name.
    expect(starterGramTw).toBeDefined();
  });

  // ─── Region movement ────────────────────────────────────────────────────────

  test('region movement from Mount Gram stays within 4 regions of Angmar', () => {
    const mountGram = pool[MOUNT_GRAM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, mountGram, allSites);
    let regionCount = 0;
    for (const r of reachable) {
      if (r.movementType !== 'region') continue;
      regionCount++;
      expect(r.regionDistance!).toBeLessThanOrEqual(4);
    }
    expect(regionCount).toBeGreaterThan(0);
  });
});
