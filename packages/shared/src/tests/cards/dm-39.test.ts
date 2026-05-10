/**
 * @module dm-39.test
 *
 * Card test: The Under-grottos (dm-39)
 * Type: hero-site (ruins-and-lairs) in High Pass, under-deeps keyword
 * Effects: 2 — `site-rule: dynamic-auto-attack` (keyed to Shadow-hold [{S}]);
 *               `site-rule: auto-test-gold-ring` (rollModifier: +2)
 *
 * Text:
 *   Adjacent Sites: Goblin-gate (0), The Under-leas (8), The Under-gates (8)
 *   Playable: Items (minor, major, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Orcs — 4 strikes with 7 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Shadow-hold [{S}]
 *   Special: When a gold ring is tested in a company at this site,
 *            the result of the roll is modified by +2.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                             |
 * |---|-------------------|--------|-------------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                         |
 * | 2 | sitePath          | OK     | [] — under-deeps sites use adjacentSites instead of path          |
 * | 3 | nearestHaven      | OK     | "" — under-deeps sites have no nearest haven                      |
 * | 4 | region            | OK     | "High Pass" — valid region in card pool                           |
 * | 5 | playableResources | OK     | ["minor", "major", "gold-ring"] — matches card text               |
 * | 6 | automaticAttacks  | OK     | Orcs (4 strikes, 7 prowess); 2nd is dynamic (see effects)         |
 * | 7 | resourceDraws     | OK     | 1                                                                 |
 * | 8 | hazardDraws       | OK     | 3                                                                 |
 * | 9 | keywords          | OK     | ["under-deeps"] — used for movement adjacency                     |
 *
 * Engine Support:
 * | # | Feature                           | Status      | Notes                                                         |
 * |---|-----------------------------------|-------------|---------------------------------------------------------------|
 * | 1 | Site phase flow                   | IMPLEMENTED | select-company, enter-or-skip, play-resources                 |
 * | 2 | Item playability (minor/major/ring)| IMPLEMENTED | minor, major, gold-ring allowed; greater denied               |
 * | 3 | `site-rule: dynamic-auto-attack`  | IMPLEMENTED | play-site-auto-attack step + played-auto-attack source        |
 * | 4 | Shadow-hold keying filter         | IMPLEMENTED | only creatures keyed to shadow-hold are eligible              |
 * | 5 | `site-rule: auto-test-gold-ring`  | IMPLEMENTED | site-phase variant: ring goes to outOfPlayPile, test enqueued |
 * | 6 | gold-ring-test rollModifier: +2   | IMPLEMENTED | modifier applied to 2d6 roll in pending-reducers              |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, ARAGORN, BILBO,
  DAGGER_OF_WESTERNESSE, GLAMDRING, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  ORC_PATROL, CAVE_DRAKE, ASSASSIN,
  resetMint, pool,
  buildSitePhaseState, buildDualHandSitePhaseState,
  viableActions, dispatch, dispatchResult,
  findCharInstanceId,
  findInPile,
  P1_COMPANY,
} from '../test-helpers.js';
import {
  isSiteCard,
  reduce,
} from '../../index.js';
import type { SiteCard, CardDefinitionId, GameState, SitePhaseState, PlaySiteAutoAttackAction } from '../../index.js';

const UNDER_GROTTOS = 'dm-39' as CardDefinitionId;

describe('The Under-grottos (dm-39)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor items are playable at The Under-grottos', () => {
    const state = buildSitePhaseState({
      site: UNDER_GROTTOS,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at The Under-grottos', () => {
    const state = buildSitePhaseState({
      site: UNDER_GROTTOS,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are NOT playable at The Under-grottos', () => {
    const state = buildSitePhaseState({
      site: UNDER_GROTTOS,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('gold ring items are playable at The Under-grottos', () => {
    const state = buildSitePhaseState({
      site: UNDER_GROTTOS,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Dynamic auto-attack: step transitions ─────────────────────────────────

  test('entering The Under-grottos advances to reveal-on-guard-attacks (static Orcs attack present)', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GROTTOS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'enter-or-skip',
    });
    const companyId = state.players[0].companies[0].id;
    const next = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
    expect((next.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
  });

  test('passing reveal-on-guard-attacks advances to play-site-auto-attack (dynamic-auto-attack effect)', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GROTTOS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'reveal-on-guard-attacks',
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect((next.phaseState as SitePhaseState).step).toBe('play-site-auto-attack');
  });

  test('hazard player passing at play-site-auto-attack advances to automatic-attacks (no combat)', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GROTTOS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Dynamic auto-attack: legal actions ────────────────────────────────────

  test('Orc-patrol (keyed to shadow-hold) is eligible as dynamic auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GROTTOS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_PATROL],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(orcPatrolInst);
  });

  test('Cave-drake (keyed to ruins-and-lairs only, not shadow-hold) is NOT eligible', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GROTTOS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('Assassin (keyed to free-hold/border-hold) is NOT eligible', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GROTTOS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [ASSASSIN],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('Orc-patrol offered, Cave-drake suppressed, pass always available', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GROTTOS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_PATROL, CAVE_DRAKE],
    });
    const playActions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(playActions).toHaveLength(1);
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const action = playActions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(orcPatrolInst);

    const passActions = viableActions(state, PLAYER_2, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('resource player has no actions during play-site-auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GROTTOS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_PATROL],
    });
    expect(viableActions(state, PLAYER_1, 'play-site-auto-attack')).toHaveLength(0);
    expect(viableActions(state, PLAYER_1, 'pass')).toHaveLength(0);
  });

  // ─── Dynamic auto-attack: combat initiation ────────────────────────────────

  test('playing Orc-patrol initiates combat with played-auto-attack source', () => {
    const state = buildDualHandSitePhaseState({
      site: UNDER_GROTTOS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_PATROL],
    });
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const next = dispatch(state, {
      type: 'play-site-auto-attack',
      player: PLAYER_2,
      cardInstanceId: orcPatrolInst,
    });

    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('played-auto-attack');
    expect((next.combat!.attackSource as { instanceId: string }).instanceId).toBe(orcPatrolInst);
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Gold ring auto-test: +2 roll modifier ─────────────────────────────────

  test('playing a gold ring at The Under-grottos moves it to outOfPlayPile (not character items)', () => {
    const state = buildSitePhaseState({
      site: UNDER_GROTTOS,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const ringInst = state.players[0].hand[0].instanceId;

    const result = dispatchResult(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: ringInst,
      companyId: P1_COMPANY,
      attachToCharacterId: aragornId,
    });
    expect(result.error).toBeUndefined();

    // Ring must be in outOfPlayPile (waiting for test), NOT in character items.
    const char = result.state.players[0].characters[aragornId as string];
    expect(char.items.find(i => i.instanceId === ringInst)).toBeUndefined();
    expect(result.state.players[0].outOfPlayPile.find(c => c.instanceId === ringInst)).toBeDefined();
  });

  test('playing a gold ring enqueues a gold-ring-test pending resolution with rollModifier +2', () => {
    const state = buildSitePhaseState({
      site: UNDER_GROTTOS,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const ringInst = state.players[0].hand[0].instanceId;

    const result = dispatchResult(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: ringInst,
      companyId: P1_COMPANY,
      attachToCharacterId: aragornId,
    });
    expect(result.error).toBeUndefined();

    const ringTest = result.state.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
    expect(ringTest).toBeDefined();
    const kind = ringTest!.kind;
    if (kind.type !== 'gold-ring-test') throw new Error('unreachable');
    expect(kind.rollModifier).toBe(2);
    expect(kind.goldRingInstanceId).toBe(ringInst);
  });

  test('gold-ring-test-roll action is offered after playing a gold ring', () => {
    const state = buildSitePhaseState({
      site: UNDER_GROTTOS,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const ringInst = state.players[0].hand[0].instanceId;

    const afterPlay = dispatch(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: ringInst,
      companyId: P1_COMPANY,
      attachToCharacterId: aragornId,
    });

    const rollActions = viableActions(afterPlay, PLAYER_1, 'gold-ring-test-roll');
    expect(rollActions).toHaveLength(1);
    const rollAction = rollActions[0].action as { type: string; rollModifier: number };
    expect(rollAction.rollModifier).toBe(2);
  });

  test('rolling the gold-ring-test discards the ring (regardless of result)', () => {
    const state = buildSitePhaseState({
      site: UNDER_GROTTOS,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const ringInst = state.players[0].hand[0].instanceId;

    let result = dispatchResult(state, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: ringInst,
      companyId: P1_COMPANY,
      attachToCharacterId: aragornId,
    });
    expect(result.error).toBeUndefined();

    const rollActions = viableActions(result.state, PLAYER_1, 'gold-ring-test-roll');
    expect(rollActions).toHaveLength(1);
    result = reduce(
      { ...result.state, cheatRollTotal: 10 } as GameState,
      rollActions[0].action,
    );
    expect(result.error).toBeUndefined();

    // Ring is discarded after the test, not in outOfPlayPile.
    expect(findInPile(result.state, 0, 'outOfPlayPile', ringInst)).toBeUndefined();
    expect(findInPile(result.state, 0, 'discardPile', ringInst)).toBeDefined();
  });

  // ─── Site definition checks ────────────────────────────────────────────────

  test('card definition has the expected site-rules in effects', () => {
    const siteDef = pool[UNDER_GROTTOS as string] as SiteCard;
    expect(isSiteCard(siteDef)).toBe(true);
    expect(siteDef.effects).toBeDefined();

    const dynAttack = siteDef.effects!.find(
      e => e.type === 'site-rule' && 'rule' in e && e.rule === 'dynamic-auto-attack',
    );
    expect(dynAttack).toBeDefined();

    const autoTest = siteDef.effects!.find(
      (e): e is { type: 'site-rule'; rule: 'auto-test-gold-ring'; rollModifier: number } =>
        e.type === 'site-rule' && 'rule' in e && e.rule === 'auto-test-gold-ring',
    );
    expect(autoTest).toBeDefined();
    expect(autoTest!.rollModifier).toBe(2);
  });
});
