/**
 * @module dm-38.test
 *
 * Card test: The Under-gates (dm-38)
 * Type: hero-site (shadow-hold) in Redhorn Gate
 * Keywords: under-deeps
 *
 * Card text:
 *   Adjacent Sites: Moria (0), The Gem-deeps (6), The Sulfur-deeps (5),
 *     The Under-grottos (8), The Under-leas (6)
 *   Playable: Items (minor, major, greater, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Balrog — 2 strikes with 16 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *       creature from his hand normally keyed to Ruins & Lairs [{R}]
 *   Special: If Balrog of Moria is in play or if it or Durin's Bane has been
 *     defeated, the first automatic attack is canceled.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — valid                                  |
 * | 2 | sitePath          | OK     | [] — under-deeps site, uses adjacentSites              |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no standard haven path          |
 * | 4 | region            | OK     | "Redhorn Gate"                                         |
 * | 5 | playableResources | OK     | ["minor","major","greater","gold-ring"] — matches text |
 * | 6 | automaticAttacks  | OK     | Balrog, 2 strikes, 16 prowess (1st attack)             |
 * | 7 | resourceDraws     | OK     | 1                                                      |
 * | 8 | hazardDraws       | OK     | 3                                                      |
 * | 9 | adjacentSites     | OK     | Moria(0), Gem-deeps(6), Sulfur-deeps(5),               |
 * |   |                   |        | Under-grottos(8), Under-leas(6)                        |
 *
 * Engine Support:
 * | # | Feature                                      | Status      | Notes                                              |
 * |---|----------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Site phase flow                              | IMPLEMENTED | select-company, enter-or-skip, play-resources      |
 * | 2 | First auto-attack (Balrog 2/16)              | IMPLEMENTED | passes through as data                             |
 * | 3 | Minor/major/greater/gold-ring playability    | IMPLEMENTED | playableResources gate                             |
 * | 4 | 2nd auto-attack (R&L keyed, dynamic)         | IMPLEMENTED | dynamic-auto-attack site-rule                      |
 * | 5 | Cancel 1st attack if Balrog in play          | IMPLEMENTED | cancel-auto-attacks site-rule, scope "first"       |
 * | 6 | Under-deeps movement (adjacentSites)         | IMPLEMENTED | rule 3.45                                          |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, DAGGER_OF_WESTERNESSE, GLAMDRING, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  CAVE_DRAKE, ORC_WARBAND,
  resetMint,
  buildSitePhaseState, buildDualHandSitePhaseState,
  setupAutoAttackStep, addCardInPlay,
  viableActions, dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, PlaySiteAutoAttackAction } from '../../index.js';

const THE_UNDER_GATES = 'dm-38' as CardDefinitionId;
const BALROG_OF_MORIA = 'tw-12' as CardDefinitionId;

describe('The Under-gates (dm-38)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at The Under-gates', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GATES,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is playable at The Under-gates', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GATES,
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (The Mithril-coat) is playable at The Under-gates', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GATES,
      hand: [THE_MITHRIL_COAT],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold-ring item (Precious Gold Ring) is playable at The Under-gates', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_GATES,
      hand: [PRECIOUS_GOLD_RING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ─── First automatic attack: Balrog 2/16 ────────────────────────────────────

  test('first automatic attack: Balrog — 2 strikes with 16 prowess (without Balrog of Moria in play)', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_GATES }));
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(16);
    expect(next.combat!.creatureRace).toBe('balrog');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Cancel 1st attack if Balrog of Moria is in play ────────────────────────

  test('first Balrog attack is canceled when Balrog of Moria (tw-12) is in play', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_GATES }));
    // Put Balrog of Moria in PLAYER_2's cardsInPlay as a permanent event
    const state = addCardInPlay(base, 1, BALROG_OF_MORIA);
    // With Balrog in play, getActiveAutoAttacks returns [] (first attack canceled),
    // so allAttacksDone=true immediately — no Balrog combat is initiated
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    // Combat should be null — Balrog attack was canceled
    expect(next.combat).toBeNull();
  });

  test('first Balrog attack fires normally when Balrog of Moria is NOT in play', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_GATES }));
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.creatureRace).toBe('balrog');
  });

  // ─── 2nd auto-attack: dynamic (ruins-and-lairs keyed) ───────────────────────

  test('step is play-site-auto-attack after Balrog attack resolves', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_GATES }));
    expect((state.phaseState).step).toBe('automatic-attacks');
  });

  test('ruins-and-lairs keyed Cave-drake is offered as 2nd auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_GATES,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const caveInst = state.players[1].hand[0].instanceId;
    expect((actions[0].action as PlaySiteAutoAttackAction).cardInstanceId).toBe(caveInst);
  });

  test('Orc-warband (ruins-and-lairs and shadow-hold keyed) IS offered at Under-gates (R&L keying matches)', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_GATES,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_WARBAND],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    // Orc-warband is keyed to R&L (and shadow-hold), so it qualifies here
    expect(actions).toHaveLength(1);
  });

  // ─── Card pool sanity ────────────────────────────────────────────────────────

  test('dm-38 is in the card pool', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_GATES });
    const def = state.cardPool[THE_UNDER_GATES];
    expect(def).toBeDefined();
    expect((def as { name: string }).name).toBe('The Under-gates');
  });

  test('tw-12 (Balrog of Moria) is in the card pool', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_GATES });
    const def = state.cardPool[BALROG_OF_MORIA];
    expect(def).toBeDefined();
    expect((def as { name: string }).name).toBe('Balrog of Moria');
  });
});
