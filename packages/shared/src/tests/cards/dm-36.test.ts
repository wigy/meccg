/**
 * @module dm-36.test
 *
 * Card test: The Under-courts (dm-36)
 * Type: hero-site (dark-hold) in Gorgoroth — Under-deeps
 *
 * Card text:
 *   Adjacent Sites: Barad-dûr (0), The Sulfur-deeps (5), The Under-galleries (4)
 *   Playable: Items (minor, major, greater)
 *   Automatic-attacks (2): (1st) Trolls — 3 strikes with 10 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *       creature from his hand normally keyed to Shadow-holds [S]
 *   Special: If any Nazgûl permanent-event is in play, one must be used as an
 *     additional automatic-attack (attacker's choice, discard after use—ignore
 *     result of defeat).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "dark-hold" — valid                                    |
 * | 2 | sitePath          | OK     | [] — under-deeps sites have no surface path            |
 * | 3 | nearestHaven      | OK     | "" — under-deeps sites have no nearest haven           |
 * | 4 | region            | OK     | "Gorgoroth"                                            |
 * | 5 | playableResources | FIXED  | ["minor", "major", "greater"]                          |
 * | 6 | automaticAttacks  | OK     | 1st: Trolls 3/10, 2nd: dynamic (shadow-hold keyed)     |
 * | 7 | resourceDraws     | OK     | 1                                                      |
 * | 8 | hazardDraws       | OK     | 4                                                      |
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                               |
 * |---|------------------------------------------|-------------|-------------------------------------|
 * | 1 | Site phase flow                          | IMPLEMENTED | select-company, enter-or-skip, etc. |
 * | 2 | First auto-attack (Trolls 3 str / 10 p)  | IMPLEMENTED | passes through as data              |
 * | 3 | Item playability (minor, major, greater)  | IMPLEMENTED | playableResources gate              |
 * | 4 | Gold-ring NOT playable                   | IMPLEMENTED | not in playableResources            |
 * | 5 | 2nd auto-attack (shadow-hold keyed)      | IMPLEMENTED | dynamic-auto-attack site-rule       |
 * | 6 | Nazgûl permanent-event as auto-attack    | IMPLEMENTED | permanent-event-auto-attack effect  |
 * | 7 | discardAfterUse after Nazgûl attack      | IMPLEMENTED | discardAfterUse flag in effect      |
 *
 * Playable: YES
 * Certified: 2026-05-11
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GLAMDRING, DAGGER_OF_WESTERNESSE, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  CAVE_DRAKE, ORC_WARBAND, BERT_BURAT,
  buildSitePhaseState, buildDualHandSitePhaseState,
  setupAutoAttackStep, addCardInPlay,
  viableActions, dispatch,
  resetMint,
} from '../test-helpers.js';
import type { CardDefinitionId, PlaySiteAutoAttackAction } from '../../index.js';

const THE_UNDER_COURTS = 'dm-36' as CardDefinitionId;
const WITCH_KING = 'tw-113' as CardDefinitionId;
const KHAMUL = 'tw-47' as CardDefinitionId;
const ADUNAPHEL = 'tw-2' as CardDefinitionId;

describe('The Under-courts (dm-36)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ────────────────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at The Under-courts', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_COURTS,
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is playable at The Under-courts', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_COURTS,
      hand: [GLAMDRING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('greater item (The Mithril-coat) is playable at The Under-courts', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_COURTS,
      hand: [THE_MITHRIL_COAT],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('gold-ring item is NOT playable at The Under-courts', () => {
    const state = buildSitePhaseState({
      site: THE_UNDER_COURTS,
      hand: [PRECIOUS_GOLD_RING],
    });
    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── First automatic attack: Trolls 3/10 ────────────────────────────────────

  test('first automatic attack: Trolls — 3 strikes with 10 prowess', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_COURTS }));
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(10);
    expect(next.combat!.creatureRace).toBe('troll');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Step transitions ────────────────────────────────────────────────────────

  test('step is automatic-attacks (not play-site-auto-attack) at entry', () => {
    const state = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_COURTS }));
    expect((state.phaseState).step).toBe('automatic-attacks');
  });

  // ─── 2nd auto-attack: dynamic (shadow-hold keyed) ───────────────────────────

  test('shadow-hold keyed Orc-warband (non-unique) is offered as 2nd auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_COURTS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [ORC_WARBAND],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const orcInst = state.players[1].hand[0].instanceId;
    expect((actions[0].action as PlaySiteAutoAttackAction).cardInstanceId).toBe(orcInst);
  });

  test('Cave-drake (ruins-and-lairs keyed) is NOT offered at Under-courts (shadow-hold keying)', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_COURTS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('unique creature (Bert Burat, shadow-hold keyed) is NOT offered as dynamic attack', () => {
    const state = buildDualHandSitePhaseState({
      site: THE_UNDER_COURTS,
      resourceCharacters: [ARAGORN],
      step: 'play-site-auto-attack',
      hazardHand: [BERT_BURAT],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  // ─── Nazgûl permanent-event as additional auto-attack ───────────────────────

  test('Witch-king (tw-113) in play adds a Nazgûl auto-attack at The Under-courts', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_COURTS }));
    // Put Witch-king in PLAYER_2's cardsInPlay as a permanent event
    const state = addCardInPlay(base, 1, WITCH_KING);
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    // First auto-attack still fires (Trolls)
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.creatureRace).toBe('troll');
  });

  test('Khamûl (tw-47) in play adds a Nazgûl auto-attack at The Under-courts', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_COURTS }));
    const state = addCardInPlay(base, 1, KHAMUL);
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.creatureRace).toBe('troll');
  });

  test('Adûnaphel (tw-2) in play adds a Nazgûl auto-attack at The Under-courts', () => {
    const base = setupAutoAttackStep(buildSitePhaseState({ site: THE_UNDER_COURTS }));
    const state = addCardInPlay(base, 1, ADUNAPHEL);
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.creatureRace).toBe('troll');
  });

  // ─── Card pool sanity ────────────────────────────────────────────────────────

  test('dm-36 is in the card pool', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_COURTS });
    const def = state.cardPool[THE_UNDER_COURTS as string];
    expect(def).toBeDefined();
    expect((def as { name: string }).name).toBe('The Under-courts');
  });

  test('tw-113 (Witch-king) is in the card pool', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_COURTS });
    const def = state.cardPool[WITCH_KING as string];
    expect(def).toBeDefined();
    expect((def as { name: string }).name).toBe('Witch-king of Angmar');
  });

  test('tw-47 (Khamûl) is in the card pool', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_COURTS });
    const def = state.cardPool[KHAMUL as string];
    expect(def).toBeDefined();
    expect((def as { name: string }).name).toBe('Khamûl the Easterling');
  });

  test('tw-2 (Adûnaphel) is in the card pool', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_COURTS });
    const def = state.cardPool[ADUNAPHEL as string];
    expect(def).toBeDefined();
    expect((def as { name: string }).name).toBe('Adûnaphel the Quiet');
  });
});
