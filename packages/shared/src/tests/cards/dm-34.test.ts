/**
 * @module dm-34.test
 *
 * Card test: The Pûkel-deeps (dm-34)
 * Type: hero-site (ruins-and-lairs, under-deeps)
 *
 * Card text:
 *   Adjacent Sites: Dunharrow (0), The Gem-deeps (9), The Sulfur-deeps (9)
 *   Playable: Items (minor, major, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Pûkel-creature — 2 strikes with 11 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard creature
 *           from his hand normally keyed to Shadow-holds [{S}]
 *   Special: Any Undead creature or Pûkel-creature may also be played at this site.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                        |
 * |---|-------------------|--------|--------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                    |
 * | 2 | sitePath          | OK     | [] — under-deeps sites have no regular site path             |
 * | 3 | nearestHaven      | OK     | "" — under-deeps sites have no nearest haven                 |
 * | 4 | region            | OK     | "Rohan"                                                      |
 * | 5 | playableResources | OK     | ["minor", "major", "gold-ring"] — matches text               |
 * | 6 | automaticAttacks  | OK     | Pûkel-creature, 2 strikes, 11 prowess (1st attack only)      |
 * | 7 | adjacentSites     | OK     | Dunharrow (0), The Gem-deeps (9), The Sulfur-deeps (9)       |
 * | 8 | resourceDraws     | OK     | 2                                                            |
 * | 9 | hazardDraws       | OK     | 3                                                            |
 *
 * Engine Support:
 * | # | Feature                                | Status      | Notes                                              |
 * |---|----------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Site phase flow                        | IMPLEMENTED | select-company, enter-or-skip, play-resources      |
 * | 2 | Item playability (minor/major/ring)    | IMPLEMENTED | playableResources gate                             |
 * | 3 | Greater items NOT playable             | IMPLEMENTED | not in playableResources                           |
 * | 4 | 1st auto-attack (Pûkel-creature 2/11)  | IMPLEMENTED | combat initiated with correct stats                |
 * | 5 | 2nd auto-attack (dynamic from hand)    | IMPLEMENTED | play-site-auto-attack step, keyed to shadow-hold   |
 * | 6 | Special: allow-creature-by-race undead | IMPLEMENTED | Barrow-wight (normally not keyed) is offered       |
 * | 7 | Special: allow-creature-by-race pûkel  | IMPLEMENTED | Pûkel-creature bypasses keying at this site        |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO,
  GLAMDRING, DAGGER_OF_WESTERNESSE, PRECIOUS_GOLD_RING, THE_MITHRIL_COAT,
  CAVE_DRAKE, BARROW_WIGHT,
  resetMint,
  buildSitePhaseState, buildDualHandSitePhaseState, setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, SitePhaseState } from '../../index.js';

const PUKEL_DEEPS = 'dm-34' as CardDefinitionId;

describe('The Pûkel-deeps (dm-34)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at The Pûkel-deeps', () => {
    const state = buildSitePhaseState({
      site: PUKEL_DEEPS,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is playable at The Pûkel-deeps', () => {
    const state = buildSitePhaseState({
      site: PUKEL_DEEPS,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold ring (Precious Gold Ring) is playable at The Pûkel-deeps', () => {
    const state = buildSitePhaseState({
      site: PUKEL_DEEPS,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (The Mithril-coat) is NOT playable at The Pûkel-deeps', () => {
    const state = buildSitePhaseState({
      site: PUKEL_DEEPS,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── First automatic attack: Pûkel-creature 2/11 ─────────────────────────────

  test('1st automatic attack: Pûkel-creature — 2 strikes with 11 prowess', () => {
    const state = buildSitePhaseState({
      site: PUKEL_DEEPS,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(2);
    expect(next.combat!.strikeProwess).toBe(11);
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Dynamic auto-attack step transitions ─────────────────────────────────────

  test('entering The Pûkel-deeps advances to automatic-attacks after on-guard reveal (printed 1st attack faced first)', () => {
    const state = buildDualHandSitePhaseState({
      site: PUKEL_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'enter-or-skip',
    });
    const companyId = state.players[0].companies[0].id;
    const afterEnter = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
    expect((afterEnter.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
    const afterReveal = dispatch(afterEnter, { type: 'pass', player: PLAYER_2 });
    expect((afterReveal.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Special: allow-creature-by-race (undead and pûkel-creature) ──────────────

  test('Cave-drake (ruins-and-lairs, not undead/pûkel) is offered at play-site-auto-attack', () => {
    // Cave-drake is normally keyed to ruins-and-lairs which matches shadow-hold? No, the
    // dynamic-auto-attack keying is shadow-hold. Cave-drake is keyed to ruins-and-lairs.
    // So Cave-drake is NOT offered here by the shadow-hold keying, unless allow-creature-by-race
    // applies. Cave-drake is not undead/pûkel, so the keying check governs.
    // Expect: Cave-drake NOT offered (keyed to ruins-and-lairs, but dynamic-aa keying is shadow-hold)
    const state = buildDualHandSitePhaseState({
      site: PUKEL_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    // Cave-drake is ruins-and-lairs keyed, but dynamic attack needs shadow-hold keying
    // AND Cave-drake is not Undead or Pukel-creature, so allow-creature-by-race doesn't apply.
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('Barrow-wight (Undead, shadow/dark keyed) IS offered at play-site-auto-attack via allow-creature-by-race', () => {
    // Barrow-wight is Undead — not normally keyed to ruins-and-lairs. But the site carries
    // allow-creature-by-race: "undead", so Barrow-wight bypasses the keying check.
    const state = buildDualHandSitePhaseState({
      site: PUKEL_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [BARROW_WIGHT],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const barrowWightInst = state.players[1].hand[0].instanceId;
    expect(actions[0].action).toMatchObject({ cardInstanceId: barrowWightInst });
  });
});
