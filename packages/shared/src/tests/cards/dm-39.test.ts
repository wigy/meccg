/**
 * @module dm-39.test
 *
 * Card test: The Under-grottos (dm-39)
 * Type: hero-site (ruins-and-lairs) in High Pass — Under-deeps
 *
 * Card text:
 *   Adjacent Sites: Goblin-gate (0), The Under-leas (8), The Under-gates (8)
 *   Playable: Items (minor, major, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Orcs — 4 strikes with 7 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *       creature from his hand normally keyed to a Shadow-hold [{S}]
 *   Special: When a gold ring is tested in a company at this site, the result
 *     of the roll is modified by +2.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                  |
 * | 2 | sitePath          | OK     | [] — under-deeps site, uses adjacentSites                  |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no standard haven path              |
 * | 4 | region            | OK     | "High Pass"                                                |
 * | 5 | playableResources | FIXED  | ["minor","major","gold-ring"] — matches card text          |
 * | 6 | automaticAttacks  | OK     | Orcs, 4 strikes, 7 prowess (1st attack)                    |
 * | 7 | resourceDraws     | OK     | 1                                                          |
 * | 8 | hazardDraws       | OK     | 3                                                          |
 * | 9 | adjacentSites     | OK     | Goblin-gate(0), Under-leas(8), Under-gates(8)              |
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                                 |
 * |---|------------------------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | First auto-attack (Orcs 4 str / 7 prowess)     | IMPLEMENTED | passes through as data                                |
 * | 3 | Minor/major/gold-ring playability              | IMPLEMENTED | playableResources gate                                |
 * | 4 | 2nd auto-attack (shadow-hold keyed, dynamic)   | IMPLEMENTED | dynamic-auto-attack site-rule                         |
 * | 5 | Gold ring test +2 modifier (auto-test)         | IMPLEMENTED | auto-test-gold-ring rollModifier:2 — fires from       |
 * |   |                                                |             | handleSitePlayHeroResource when ring is played here   |
 * | 6 | Under-deeps movement (adjacentSites)           | IMPLEMENTED | rule 3.45                                             |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, DAGGER_OF_WESTERNESSE, GLAMDRING, PRECIOUS_GOLD_RING,
  CAVE_DRAKE, ORC_WARBAND,
  resetMint,
  buildSitePhaseState, buildDualHandSitePhaseState,
  setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, PlaySiteAutoAttackAction, PlayHeroResourceAction } from '../../index.js';

const THE_UNDER_GROTTOS = 'dm-39' as CardDefinitionId;

describe('The Under-grottos (dm-39)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at The Under-grottos', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GROTTOS,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is playable at The Under-grottos', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GROTTOS,
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold-ring item (Precious Gold Ring) is playable at The Under-grottos', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GROTTOS,
      hand: [PRECIOUS_GOLD_RING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ─── Gold ring auto-test: +2 modifier ───────────────────────────────────────

  test('playing a gold ring at The Under-grottos enqueues a gold-ring-test with rollModifier +2', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GROTTOS,
      hand: [PRECIOUS_GOLD_RING],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThan(0);
    const playAction = playActions[0].action as PlayHeroResourceAction;

    const afterPlay = dispatch(state, playAction);

    const ringTest = afterPlay.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
    expect(ringTest).toBeDefined();
    const kind = ringTest!.kind;
    if (kind.type !== 'gold-ring-test') throw new Error('unreachable');
    expect(kind.rollModifier).toBe(2);
    expect(kind.goldRingInstanceId).toBe(playAction.cardInstanceId);
  });

  test('playing a minor item at The Under-grottos does NOT enqueue a gold-ring-test', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GROTTOS,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThan(0);
    const afterPlay = dispatch(state, playActions[0].action);

    const ringTest = afterPlay.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
    expect(ringTest).toBeUndefined();
  });

  // ─── First automatic attack: Orcs 4/7 ───────────────────────────────────────

  test('first automatic attack: Orcs — 4 strikes with 7 prowess', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_GROTTOS }));
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.creatureRace).toBe('orc');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── 2nd auto-attack: dynamic (shadow-hold keyed) ───────────────────────────

  test('step is automatic-attacks at entry', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_GROTTOS }));
    expect((state.phaseState).step).toBe('automatic-attacks');
  });

  test('shadow-hold keyed Orc-warband is offered as 2nd auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_GROTTOS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_WARBAND],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const orcInst = state.players[1].hand[0].instanceId;
    expect((actions[0].action as PlaySiteAutoAttackAction).cardInstanceId).toBe(orcInst);
  });

  test('ruins-and-lairs keyed Cave-drake is NOT offered as 2nd auto-attack (shadow-hold keying only)', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_GROTTOS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  // ─── Card pool sanity ────────────────────────────────────────────────────────

  test('dm-39 is in the card pool', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_GROTTOS });
    const def = state.cardPool[THE_UNDER_GROTTOS as string];
    expect(def).toBeDefined();
    expect((def as { name: string }).name).toBe('The Under-grottos');
  });
});
