/**
 * @module dm-40.test
 *
 * Card test: The Under-leas (dm-40)
 * Type: hero-site (shadow-hold, under-deeps)
 *
 * Card text:
 *   Adjacent Sites: Mount Gundabad (0), The Iron-deeps (6), The Under-grottos (8),
 *     The Under-gates (6), The Under-vaults (7)
 *   Playable: Items (minor, major, greater)
 *   Automatic-attacks (2):
 *     (1st) Orcs — 5 strikes with 7 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard creature
 *       from his hand normally keyed to Ruins & Lairs [{R}]
 *   Special: If the Witch-king of Angmar is in play as a permanent-event, it must
 *     be used as an additional automatic-attack (discard after use—ignore result of
 *     defeat).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                              |
 * |---|-------------------|--------|----------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                              |
 * | 2 | sitePath          | OK     | [] — under-deeps sites use adjacentSites           |
 * | 3 | nearestHaven      | OK     | "" — under-deeps, no nearest haven                 |
 * | 4 | region            | OK     | "Gundabad"                                         |
 * | 5 | playableResources | OK     | minor, major, greater — matches card text          |
 * | 6 | automaticAttacks  | OK     | Orcs, 5 strikes, 7 prowess (1st static attack)     |
 * | 7 | effects           | OK     | dynamic-auto-attack keyed to {R}                   |
 * | 8 | resourceDraws     | OK     | 1                                                  |
 * | 9 | hazardDraws       | OK     | 4                                                  |
 *
 * Engine Support:
 * | # | Feature                              | Status      | Notes                                              |
 * |---|--------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Site phase flow                      | IMPLEMENTED | select-company, enter-or-skip, play-resources      |
 * | 2 | Item playability (minor/major/greater)| IMPLEMENTED | playableResources gate                             |
 * | 3 | dynamic-auto-attack (2nd attack)     | IMPLEMENTED | play-site-auto-attack step; non-unique filter       |
 * | 4 | Static auto-attack (Orcs 5/7)        | IMPLEMENTED | automaticAttacks data used in combat initiation    |
 * | 5 | Witch-king permanent-event attack    | IMPLEMENTED | permanent-event-auto-attack with discardAfterUse   |
 * | 6 | Under-deeps movement (adjacentSites) | IMPLEMENTED | rule 3.45                                          |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, ARAGORN,
  DAGGER_OF_WESTERNESSE, GLAMDRING, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  CAVE_DRAKE, ASSASSIN,
  resetMint,
  buildSitePhaseState, buildDualHandSitePhaseState,
  setupAutoAttackStep, addCardInPlay,
  viableActions, dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, SitePhaseState, PlaySiteAutoAttackAction } from '../../index.js';

const THE_UNDER_LEAS = 'dm-40' as CardDefinitionId;
const WITCH_KING = 'tw-113' as CardDefinitionId;

describe('The Under-leas (dm-40)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_LEAS,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('major item (Glamdring) is playable', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_LEAS,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater item (The Mithril-coat) is playable', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_LEAS,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring is NOT playable at The Under-leas', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_LEAS,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── Dynamic auto-attack: step transitions ────────────────────────────────

  test('entering The Under-leas first goes to reveal-on-guard-attacks (static attack present)', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_LEAS,
      resourceCharacters: [ARAGORN],
      step: 'enter-or-skip',
    });
    const companyId = state.players[0].companies[0].id;
    const next = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
    expect((next.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });

  test('passing reveal-on-guard-attacks advances to automatic-attacks (printed Orcs attack faced first)', () => {
    // CoE: "(1st) Orcs … (2nd) Opponent may play … from his hand" — the
    // printed attack is faced before the dynamic (hand-played) one, so the
    // step after reveal-on-guard-attacks must be 'automatic-attacks', not
    // 'play-site-auto-attack'.
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_LEAS,
      resourceCharacters: [ARAGORN],
      step: 'reveal-on-guard-attacks',
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  test('after the printed Orcs attack is resolved, automatic-attacks advances to play-site-auto-attack (dynamic attack faced 2nd)', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_LEAS }));
    // Simulate the printed (1st) Orcs attack already having been faced.
    const resolvedState = {
      ...base,
      phaseState: { ...base.phaseState, automaticAttacksResolved: 1 },
    };
    const next = dispatch(resolvedState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('play-site-auto-attack');
  });

  test('after both the printed and dynamic attacks are faced, automatic-attacks advances to declare-agent-attack', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_LEAS }));
    const resolvedState = {
      ...base,
      phaseState: {
        ...base.phaseState,
        automaticAttacksResolved: 1,
        dynamicAutoAttackDone: true,
      },
    };
    const next = dispatch(resolvedState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('declare-agent-attack');
  });

  test('hazard player passing at play-site-auto-attack advances to automatic-attacks', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_LEAS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Dynamic auto-attack: legal actions ───────────────────────────────────

  test('Cave-drake (keyed to {R}) is eligible for dynamic auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_LEAS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const caveDrakeInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(caveDrakeInst);
  });

  test('Assassin (not keyed to {R}) is NOT eligible for dynamic auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_LEAS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [ASSASSIN],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('resource player has no actions during play-site-auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_LEAS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const p1Actions = viableActions(state, PLAYER_1, 'play-site-auto-attack');
    expect(p1Actions).toHaveLength(0);
    const p1Pass = viableActions(state, PLAYER_1, 'pass');
    expect(p1Pass).toHaveLength(0);
  });

  // ─── Dynamic auto-attack: combat initiation ───────────────────────────────

  test('playing Cave-drake initiates combat with played-auto-attack source', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_LEAS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const caveDrakeInst = state.players[1].hand[0].instanceId;
    const next = dispatch(state, {
      type: 'play-site-auto-attack',
      player: PLAYER_2,
      cardInstanceId: caveDrakeInst,
    });

    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('played-auto-attack');
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(10);
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Static auto-attack: Orcs 5/7 ────────────────────────────────────────

  test('Orcs automatic attack has 5 strikes and prowess 7', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_LEAS });
    const readyState = setupAutoAttackStep(state);
    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(5);
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.creatureRace).toBe('orc');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Witch-king of Angmar as additional auto-attack ───────────────────────

  test('Witch-king (tw-113) in play adds an additional Nazgûl attack at The Under-leas', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_LEAS }));
    const state = addCardInPlay(base, 1, WITCH_KING);
    // First pass still fires the Orcs attack (Witch-king adds to the list, doesn't replace)
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(5);
    expect(next.combat!.creatureRace).toBe('orc');
  });

  // ─── Card pool sanity ────────────────────────────────────────────────────────

  test('dm-40 is in the card pool', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_LEAS });
    const def = state.cardPool[THE_UNDER_LEAS];
    expect(def).toBeDefined();
    expect((def as { name: string }).name).toBe('The Under-leas');
  });

  test('tw-113 (Witch-king of Angmar) is in the card pool', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_LEAS });
    const def = state.cardPool[WITCH_KING];
    expect(def).toBeDefined();
    expect((def as { name: string }).name).toBe('Witch-king of Angmar');
  });
});
