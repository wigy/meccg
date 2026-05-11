/**
 * @module dm-33.test
 *
 * Card test: The Iron-deeps (dm-33)
 * Type: hero-site (dark-hold) in Angmar
 * Effects: 1 — `site-rule: dynamic-auto-attack` keyed to {r} (Ruins & Lairs)
 *
 * Card text (2nd attack portion):
 *   "Automatic-attacks (2): (1st) Trolls — 3 strikes with 9 prowess
 *   (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *   creature from his hand normally keyed to Ruins & Lairs [{r}]"
 *
 * Also covers: The Gem-deeps (dm-30) — Shadow-hold keying uniqueness test.
 * Both sites share the DM Under-deeps `dynamic-auto-attack` feature.
 *
 * Engine Support:
 * | # | Feature                          | Status      | Notes                                            |
 * |---|----------------------------------|-------------|--------------------------------------------------|
 * | 1 | `site-rule: dynamic-auto-attack` | IMPLEMENTED | play-site-auto-attack step added in legal-actions/site.ts |
 * | 2 | Static attack fires first        | IMPLEMENTED | automaticAttacksResolved < total attacks         |
 * | 3 | Dynamic step after static attacks | IMPLEMENTED | step advances to play-site-auto-attack            |
 * | 4 | Keying filter                    | IMPLEMENTED | creature must match keying.siteTypes             |
 * | 5 | Unique creature rejected         | IMPLEMENTED | def.unique check in playSiteAutoAttackActions    |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN,
  CAVE_DRAKE, ASSASSIN, ORC_WARBAND, BERT_BURAT,
  buildSitePhaseState, buildDualHandSitePhaseState,
  setupAutoAttackStep,
  viableActions, dispatch,
  resetMint,
} from '../test-helpers.js';
import type { CardDefinitionId, PlaySiteAutoAttackAction } from '../../index.js';

const DM_IRON_DEEPS = 'dm-33' as CardDefinitionId;
const DM_GEM_DEEPS = 'dm-30' as CardDefinitionId;

describe('DM Under-deeps — dynamic auto-attack (dm-33 Iron-deeps)', () => {
  beforeEach(() => resetMint());

  // ─── Step ordering: static attack fires before dynamic step ───────────────

  test('at automaticAttacksResolved=0: pass triggers the static Troll attack (3 strikes, 9 prowess)', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: DM_IRON_DEEPS }));
    // automaticAttacksResolved = 0 → first (printed) Troll attack fires
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(9);
  });

  test('at automaticAttacksResolved=0: step is automatic-attacks, not play-site-auto-attack yet', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: DM_IRON_DEEPS }));
    expect((state.phaseState).step).toBe('automatic-attacks');
  });

  // ─── play-site-auto-attack: keying filter ─────────────────────────────────

  test('Cave-drake (ruins-and-lairs keyed, non-unique) is offered at play-site-auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: DM_IRON_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const caveDrakeInst = state.players[1].hand[0].instanceId;
    expect((actions[0].action as PlaySiteAutoAttackAction).cardInstanceId).toBe(caveDrakeInst);
  });

  test('Assassin (free-hold/border-hold keyed) is NOT offered at play-site-auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: DM_IRON_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [ASSASSIN],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('only the matching creature is offered when both keyed and non-keyed are in hand', () => {
    const state = buildDualHandSitePhaseState({
      site: DM_IRON_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE, ASSASSIN],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const caveDrakeInst = state.players[1].hand[0].instanceId;
    expect((actions[0].action as PlaySiteAutoAttackAction).cardInstanceId).toBe(caveDrakeInst);
  });

  test('resource player has no actions during play-site-auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: DM_IRON_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    expect(viableActions(state, PLAYER_1, 'play-site-auto-attack')).toHaveLength(0);
  });

  test('hazard player passing skips dynamic attack (no combat)', () => {
    const state = buildDualHandSitePhaseState({
      site: DM_IRON_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(next.combat).toBeNull();
  });

  // ─── Uniqueness enforcement (dm-30 Gem-deeps, shadow-hold keying) ─────────
  //
  // Bert (Burat) [tw-016] is unique and keyed to shadow-hold — it would
  // match dm-30's keying if not for being unique. This test verifies the
  // uniqueness guard in playSiteAutoAttackActions.

  test('dm-30 (shadow-hold keying): unique creature Bert is NOT offered', () => {
    const state = buildDualHandSitePhaseState({
      site: DM_GEM_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [BERT_BURAT],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('dm-30 (shadow-hold keying): non-unique Orc-warband IS offered', () => {
    const state = buildDualHandSitePhaseState({
      site: DM_GEM_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_WARBAND],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
  });

  test('dm-30: unique Bert filtered, non-unique Orc-warband offered, when both in hand', () => {
    const state = buildDualHandSitePhaseState({
      site: DM_GEM_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [BERT_BURAT, ORC_WARBAND],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    // Only Orc-warband is offered (Bert is unique and therefore ineligible)
    expect(actions).toHaveLength(1);
    const orcWarbandInst = state.players[1].hand[1].instanceId;
    expect((actions[0].action as PlaySiteAutoAttackAction).cardInstanceId).toBe(orcWarbandInst);
  });
});
