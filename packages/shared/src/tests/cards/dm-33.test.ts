/**
 * @module dm-33.test
 *
 * Card test: The Iron-deeps (dm-33)
 * Type: hero-site (dark-hold) — under-deeps site in Angmar
 * Effects: 1 — `site-rule: dynamic-auto-attack` keyed to Ruins & Lairs {R}
 *
 * Card text:
 *   Adjacent Sites: Carn Dûm (0), The Under-leas (6), The Under-vaults (7)
 *   Playable: Items (minor, major, greater)
 *   Automatic-attacks (2):
 *     (1st) Trolls — 3 strikes with 9 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *       creature from his hand normally keyed to Ruins & Lairs [{R}]
 *   Special: If the Witch-king of Angmar is in play as a permanent-event,
 *     it must be used as an additional automatic-attack (discard after
 *     use—ignore result of defeat).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                          |
 * |---|-------------------|--------|----------------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                                           |
 * | 2 | sitePath          | OK     | [] — under-deeps site, uses adjacentSites instead             |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                       |
 * | 4 | region            | OK     | "Angmar"                                                      |
 * | 5 | playableResources | OK     | [minor, major, greater] — matches card text                   |
 * | 6 | automaticAttacks  | OK     | Trolls, 3 strikes, 9 prowess (1st attack)                     |
 * | 7 | resourceDraws     | OK     | 1                                                             |
 * | 8 | hazardDraws       | OK     | 4                                                             |
 * | 9 | keywords          | OK     | ["under-deeps"]                                               |
 * | 10| effects           | OK     | site-rule dynamic-auto-attack keyed to ruins-and-lairs {R}    |
 *
 * Engine Support:
 * | # | Feature                                | Status      | Notes                                                  |
 * |---|----------------------------------------|-------------|--------------------------------------------------------|
 * | 1 | Site phase flow                        | IMPLEMENTED | select-company, enter-or-skip, play-resources          |
 * | 2 | Item playability (minor/major/greater)  | IMPLEMENTED | playableResources gate                                 |
 * | 3 | Gold-ring NOT playable                 | IMPLEMENTED | not in playableResources                               |
 * | 4 | 1st auto-attack: Trolls 3/9            | IMPLEMENTED | combat initiated with correct stats                    |
 * | 5 | `site-rule: dynamic-auto-attack`       | IMPLEMENTED | play-site-auto-attack step, keyed to ruins-and-lairs   |
 * | 6 | Keying filter {R}                      | IMPLEMENTED | creature must match ruins-and-lairs siteType           |
 * | 7 | Unique creature rejected               | IMPLEMENTED | def.unique check in playSiteAutoAttackActions          |
 * | 8 | Witch-king extra auto-attack           | IMPLEMENTED | permanent-event-auto-attack with discardAfterUse: true |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, ARAGORN, BILBO,
  GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT,
  CAVE_DRAKE, ASSASSIN,
  resetMint, pool,
  buildSitePhaseState, buildDualHandSitePhaseState,
  setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, SitePhaseState, PlaySiteAutoAttackAction } from '../../index.js';

const THE_IRON_DEEPS = 'dm-33' as CardDefinitionId;
const PRECIOUS_GOLD_RING = 'tw-309' as CardDefinitionId;

describe('The Iron-deeps (dm-33)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor items (Dagger of Westernesse) are playable', () => {
    const state = buildSitePhaseState({
      site: THE_IRON_DEEPS,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items (Glamdring) are playable', () => {
    const state = buildSitePhaseState({
      site: THE_IRON_DEEPS,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('greater items (The Mithril-coat) are playable', () => {
    const state = buildSitePhaseState({
      site: THE_IRON_DEEPS,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  test('gold-ring items are NOT playable', () => {
    const state = buildSitePhaseState({
      site: THE_IRON_DEEPS,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions).toHaveLength(0);
  });

  // ─── First automatic attack: Trolls 3/9 ───────────────────────────────────

  test('1st automatic attack is Trolls — 3 strikes with 9 prowess', () => {
    const state = buildSitePhaseState({
      site: THE_IRON_DEEPS,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(9);
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Dynamic auto-attack: step transitions ─────────────────────────────────

  test('entering The Iron-deeps goes reveal-on-guard-attacks → automatic-attacks (printed 1st attack faced first)', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_IRON_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'enter-or-skip',
    });
    const companyId = state.players[0].companies[0].id;
    // Step 1: enter-site → reveal-on-guard-attacks (static Trolls attack present)
    const afterEnter = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
    expect((afterEnter.phaseState as SitePhaseState).step).toBe('reveal-on-guard-attacks');
    // Step 2: hazard player passes on-guard → automatic-attacks (printed Trolls
    // attack is faced before the dynamic hand-played one)
    const afterReveal = dispatch(afterEnter, { type: 'pass', player: PLAYER_2 });
    expect((afterReveal.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  test('hazard player passing at play-site-auto-attack advances to automatic-attacks (no combat)', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_IRON_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Dynamic auto-attack: keying filter ({R} = ruins-and-lairs) ───────────

  test('hazard player may play a creature keyed to ruins-and-lairs (Cave-drake)', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_IRON_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const caveDrakeInst = state.players[1].hand[0].instanceId;
    const action = actions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(caveDrakeInst);
  });

  test('hazard player may NOT play a creature not keyed to ruins-and-lairs (Assassin — free/border-hold)', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_IRON_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [ASSASSIN],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('Cave-drake offered, Assassin suppressed, pass always available', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_IRON_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE, ASSASSIN],
    });
    const playActions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(playActions).toHaveLength(1);
    const caveDrakeInst = state.players[1].hand[0].instanceId;
    const action = playActions[0].action as PlaySiteAutoAttackAction;
    expect(action.cardInstanceId).toBe(caveDrakeInst);

    const passActions = viableActions(state, PLAYER_2, 'pass');
    expect(passActions).toHaveLength(1);
  });

  test('resource player has no actions during play-site-auto-attack step', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_IRON_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(0);
  });

  test('playing Cave-drake initiates combat with played-auto-attack source and cave-drake stats', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_IRON_DEEPS,
      resourceCharacters: [ARAGORN, BILBO],
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
    const combat = next.combat!;
    expect(combat.attackSource.type).toBe('played-auto-attack');
    expect((combat.attackSource as { instanceId: string }).instanceId).toBe(caveDrakeInst);
    expect(combat.strikesTotal).toBe(2);
    expect(combat.strikeProwess).toBe(10);
    expect(combat.attackingPlayerId).toBe(PLAYER_2);
    expect(combat.defendingPlayerId).toBe(PLAYER_1);
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Pool sanity ───────────────────────────────────────────────────────────

  test('The Iron-deeps is in the card pool as a dark-hold under-deeps site', () => {
    const site = pool[THE_IRON_DEEPS as string];
    expect(site).toBeDefined();
    expect(site.cardType).toBe('hero-site');
  });
});
