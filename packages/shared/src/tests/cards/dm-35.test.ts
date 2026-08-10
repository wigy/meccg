/**
 * @module dm-35.test
 *
 * Card test: The Sulfur-deeps (dm-35)
 * Type: hero-site (dark-hold, under-deeps)
 *
 * Card text:
 *   Adjacent Sites: Dol Guldur (0), The Under-courts (5), The Pûkel-deeps (9),
 *     The Under-gates (5), The Under-galleries (8)
 *   Playable: Items (minor, major, greater)
 *   Automatic-attacks (2):
 *     (1st) Trolls — 2 strikes with 9 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard creature
 *           from his hand normally keyed to Shadow-holds [S]
 *   Special: If Khamûl the Easterling or Adûnaphel is in play as a permanent-event,
 *     one must be used as an additional automatic-attack (attacker's choice,
 *     discard after use—ignore result of defeat).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — matches authoritative {D}             |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no path needed               |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no haven needed              |
 * | 4 | playableResources | OK     | ["minor","major","greater"] — matches card text     |
 * | 5 | automaticAttacks  | OK     | 1st (Trolls 2/9) in data; 2nd dynamic               |
 * | 6 | resourceDraws     | OK     | 1                                                   |
 * | 7 | hazardDraws       | OK     | 4                                                   |
 *
 * Engine Support:
 * | # | Feature                                | Status      | Notes                                           |
 * |---|----------------------------------------|-------------|-------------------------------------------------|
 * | 1 | Site phase flow                        | IMPLEMENTED | play-resources step                             |
 * | 2 | Item playability (minor/major/greater)  | IMPLEMENTED | playableResources gate                          |
 * | 3 | 1st auto-attack: Trolls 2/9            | IMPLEMENTED | data correct                                    |
 * | 4 | 2nd auto-attack (dynamic, shadow-hold) | IMPLEMENTED | play-site-auto-attack step                      |
 * | 5 | Khamûl/Adûnaphel extra auto-attack     | IMPLEMENTED | permanent-event-auto-attack, discardAfterUse    |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO,
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT,
  CAVE_DRAKE, ORC_WARBAND,
  resetMint,
  buildSitePhaseState, buildDualHandSitePhaseState,
  setupAutoAttackStep,
  dispatch, viableActions,
} from '../test-helpers.js';
import type { CardDefinitionId, SitePhaseState } from '../../index.js';

const SULFUR_DEEPS = 'dm-35' as CardDefinitionId;

describe('The Sulfur-deeps (dm-35)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ─────────────────────────────────────────────────────

  test('minor items are playable at The Sulfur-deeps', () => {
    const state = buildSitePhaseState({
      site: SULFUR_DEEPS,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are playable at The Sulfur-deeps', () => {
    const state = buildSitePhaseState({
      site: SULFUR_DEEPS,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items are playable at The Sulfur-deeps', () => {
    const state = buildSitePhaseState({
      site: SULFUR_DEEPS,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Automatic attack (1st): Trolls 2 strikes / 9 prowess ────────────────

  test('first automatic attack (Trolls) triggers with 2 strikes and 9 prowess', () => {
    const state = buildSitePhaseState({
      site: SULFUR_DEEPS,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const afterFirst = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(afterFirst.combat).not.toBeNull();
    expect(afterFirst.combat!.strikesTotal).toBe(2);
    expect(afterFirst.combat!.strikeProwess).toBe(9);
    expect(afterFirst.combat!.creatureRace).toBe('troll');
    expect(afterFirst.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Dynamic auto-attack: step transitions ────────────────────────────────

  test('entering The Sulfur-deeps advances to automatic-attacks (printed Trolls attack faced first)', () => {
    // Printed automatic-attacks are always faced first, in card order (e.g.
    // "(1st) Trolls … (2nd) Opponent may play … from his hand"); the dynamic
    // (hand-played) attack is offered only after the printed attack.
    const state = buildDualHandSitePhaseState({
      site: SULFUR_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'enter-or-skip',
    });
    const companyId = state.players[0].companies[0].id;
    const afterEnter = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
    expect((afterEnter.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
    const afterReveal = dispatch(afterEnter, { type: 'pass', player: PLAYER_2 });
    expect((afterReveal.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  test('Orc-warband (shadow-hold keyed) is offered at play-site-auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: SULFUR_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_WARBAND],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
  });

  test('Cave-drake (ruins-and-lairs keyed) is NOT offered at play-site-auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: SULFUR_DEEPS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });
});
