/**
 * @module ba-101.test
 *
 * Card test: The Under-grottos (ba-101)
 * Type: balrog-site (ruins-and-lairs, under-deeps) in High Pass — the Balrog
 * reprint of the DM Under-grottos (dm-39), with a +1 (rather than +2) gold-ring
 * test modifier, an Undead (rather than Orcs) first automatic-attack, and only
 * minor/gold-ring items playable.
 *
 * Card text:
 *   Adjacent Sites: Goblin-gate (0), The Under-leas (6), The Under-gates (6)
 *   Playable: Items (minor, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Undead — 4 strikes with 7 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *       creature from his hand normally keyed to a Shadow-hold [{S}]
 *   Special: When a gold ring is tested in a company at this site, the result
 *     of the roll is modified by +1.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                      |
 * |---|-------------------|--------|------------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                  |
 * | 2 | sitePath          | OK     | [] — under-deeps site, uses adjacentSites                  |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no standard haven path              |
 * | 4 | region            | OK     | "High Pass"                                                |
 * | 5 | playableResources | FIXED  | ["minor","gold-ring"] — was [], filled from card text      |
 * | 6 | automaticAttacks  | OK     | Undead, 4 strikes, 7 prowess (1st attack)                  |
 * | 7 | resourceDraws     | OK     | 1                                                          |
 * | 8 | hazardDraws       | OK     | 1                                                          |
 * | 9 | keywords          | OK     | ["under-deeps"]                                            |
 * |10 | adjacentSites     | OK     | Goblin-gate(0), Under-leas(6), Under-gates(6)              |
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                                 |
 * |---|------------------------------------------------|-------------|-------------------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED | select-company, enter-or-skip, play-resources         |
 * | 2 | First auto-attack (Undead 4 str / 7 prowess)   | IMPLEMENTED | passes through as data                                 |
 * | 3 | Minor/gold-ring playability (no major)         | IMPLEMENTED | playableResources gate                                |
 * | 4 | 2nd auto-attack (shadow-hold keyed, dynamic)   | IMPLEMENTED | dynamic-auto-attack site-rule                         |
 * | 5 | Gold ring test +1 modifier (auto-test)         | IMPLEMENTED | auto-test-gold-ring rollModifier:1 — fires from       |
 * |   |                                                |             | handleSitePlayHeroResource when a ring is played here |
 * | 6 | Under-deeps movement (adjacentSites)           | IMPLEMENTED | rule 3.45                                             |
 *
 * Playable: YES
 * Certified: 2026-07-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LORIEN, LEGOLAS,
  PRECIOUS_GOLD_RING, DAGGER_OF_WESTERNESSE, GLAMDRING,
  ORC_WARBAND, CAVE_DRAKE,
  resetMint, pool,
  buildTestState, makeSitePhase,
  setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import { Phase, Alignment } from '../../index.js';
import type {
  CardDefinitionId, GameState, SitePhaseState, PlayHeroResourceAction, PlaySiteAutoAttackAction,
} from '../../index.js';

const THE_UNDER_GROTTOS = 'ba-101' as CardDefinitionId;
const THE_UNDER_GATES = 'ba-100' as CardDefinitionId;   // adjacent Balrog Darkhaven, used to seat the opponent
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;     // Balrog-specific orc

/** A Balrog company at The Under-grottos, site phase, at the play-resources step. */
function balrogAtGrottos(hand: CardDefinitionId[], characters: unknown[] = [CROOK_LEGGED_ORC]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GROTTOS, characters: characters as never }], hand, siteDeck: [] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

describe('The Under-grottos (ba-101)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + gold ring, NOT major) ─────────────────────────

  test('minor item (Dagger of Westernesse) is playable at The Under-grottos', () => {
    const state = balrogAtGrottos([DAGGER_OF_WESTERNESSE]);
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBeGreaterThan(0);
  });

  test('gold-ring item (Precious Gold Ring) is playable at The Under-grottos', () => {
    const state = balrogAtGrottos([PRECIOUS_GOLD_RING]);
    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is NOT playable at The Under-grottos', () => {
    const state = balrogAtGrottos([GLAMDRING]);
    // playableResources is minor + gold-ring only — a major item is rejected.
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ─── Gold ring auto-test: +1 modifier ────────────────────────────────────────

  test('playing a gold ring at The Under-grottos enqueues a gold-ring-test with rollModifier +1', () => {
    const state = balrogAtGrottos([PRECIOUS_GOLD_RING]);

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThan(0);
    const playAction = playActions[0].action as PlayHeroResourceAction;

    const afterPlay = dispatch(state, playAction);

    const ringTest = afterPlay.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
    expect(ringTest).toBeDefined();
    const kind = ringTest!.kind;
    if (kind.type !== 'gold-ring-test') throw new Error('unreachable');
    expect(kind.rollModifier).toBe(1);
    expect(kind.goldRingInstanceId).toBe(playAction.cardInstanceId);
  });

  test('playing a minor item at The Under-grottos does NOT enqueue a gold-ring-test', () => {
    const state = balrogAtGrottos([DAGGER_OF_WESTERNESSE]);

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThan(0);
    const afterPlay = dispatch(state, playActions[0].action);

    const ringTest = afterPlay.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
    expect(ringTest).toBeUndefined();
  });

  // ─── First automatic attack: Undead 4/7 ──────────────────────────────────────

  test('first automatic attack: Undead — 4 strikes with 7 prowess', () => {
    const state = setupAutoAttackStep(balrogAtGrottos([]));
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.creatureRace).toBe('undead');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── 2nd auto-attack: dynamic (shadow-hold keyed) ────────────────────────────

  test('step is automatic-attacks after setup', () => {
    const state = setupAutoAttackStep(balrogAtGrottos([]));
    expect((state.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  test('shadow-hold keyed Orc-warband is offered to the opponent as 2nd auto-attack', () => {
    // Balrog company at the site (P1); the opponent (P2) holds a shadow-hold-keyed creature.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GROTTOS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: THE_UNDER_GATES, characters: [] }], hand: [ORC_WARBAND], siteDeck: [] },
      ],
    });
    const state: GameState = { ...base, phaseState: { ...makeSitePhase(), step: 'play-site-auto-attack' } };
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const orcInst = state.players[1].hand[0].instanceId;
    expect((actions[0].action as PlaySiteAutoAttackAction).cardInstanceId).toBe(orcInst);
  });

  test('ruins-and-lairs keyed Cave-drake is NOT offered as 2nd auto-attack (shadow-hold keying only)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: THE_UNDER_GROTTOS, characters: [CROOK_LEGGED_ORC] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: THE_UNDER_GATES, characters: [] }], hand: [CAVE_DRAKE], siteDeck: [] },
      ],
    });
    const state: GameState = { ...base, phaseState: { ...makeSitePhase(), step: 'play-site-auto-attack' } };
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  // ─── Card pool sanity ────────────────────────────────────────────────────────

  test('ba-101 is in the card pool as The Under-grottos', () => {
    const def = pool[THE_UNDER_GROTTOS as string];
    expect(def).toBeDefined();
    expect((def as { name: string }).name).toBe('The Under-grottos');
  });
});
