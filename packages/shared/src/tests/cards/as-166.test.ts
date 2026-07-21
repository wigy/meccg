/**
 * @module as-166.test
 *
 * Card test: The Under-grottos (as-166)
 * Type: minion-site (ruins-and-lairs, under-deeps) in High Pass — the Ringwraith
 * (minion) twin of the Balrog ba-101 and hero dm-39 Under-grottos. Same Under-deeps
 * machinery, with the minion-specific playability line (minor/major/gold-ring
 * items) and minion adjacency rolls.
 *
 * Card text:
 *   Adjacent Sites: Goblin-gate (0), The Under-leas (7), The Under-gates (7)
 *   Playable: Items (minor, major, gold ring)
 *   Automatic-attacks (2):
 *     (1st) Orcs — 4 strikes with 7 prowess
 *     (2nd) Opponent may play as an automatic-attack one non-unique hazard
 *           creature from his hand normally keyed to a Shadow-hold [{S}]
 *   Special: When a gold ring is tested in a company at this site, the result
 *     of the roll is modified by +1.
 *
 * Rules interpretation: The Under-deeps machinery is alignment-agnostic (proved by
 * The Iron-deeps as-152 / The Pûkel-deeps as-158). The 2nd automatic-attack is the
 * shared `dynamic-auto-attack` primitive keyed to Shadow-hold {S}; a Shadow-hold-
 * keyed attack against the Ringwraith defender IS detainment (§3.II.2.R1), while the
 * site's own 1st Orc attack (keyed to this R&L site, Orc not a Shadow-land race) is
 * NOT. The gold-ring "Special" is the shared `auto-test-gold-ring` primitive with a
 * +1 roll modifier.
 *
 * Data encoding (filled/added this pass — the imported AS under-deeps entry was
 * missing all of these, the recurring AS-site import bug):
 *   - `automaticAttacks[0].creatureType` filled to "Orcs" (was "").
 *   - `adjacentSites` (Goblin-gate 0 / The Under-leas 7 / The Under-gates 7 —
 *     minion rolls per the printed line).
 *   - the two `effects` (was `[]`): `dynamic-auto-attack` (shadow-hold) and
 *     `auto-test-gold-ring` (rollModifier 1).
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                  |
 * |---|-------------------|--------|--------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid ({R})                        |
 * | 2 | sitePath          | OK     | [] — under-deeps site, no region path                  |
 * | 3 | nearestHaven      | OK     | "" — under-deeps site, no nearest haven                |
 * | 4 | region            | OK     | "High Pass"                                            |
 * | 5 | playableResources | OK     | [minor, major, gold-ring]                              |
 * | 6 | automaticAttacks  | FIXED  | Orcs, 4 strikes, 7 prowess (creatureType filled)       |
 * | 7 | resourceDraws     | OK     | 1                                                      |
 * | 8 | hazardDraws       | OK     | 3                                                      |
 * | 9 | keywords          | OK     | ["under-deeps"]                                        |
 * |10 | adjacentSites     | FIXED  | Goblin-gate 0 / Under-leas 7 / Under-gates 7           |
 * |11 | effects           | FIXED  | dynamic-auto-attack (shadow-hold) + auto-test-gold-ring |
 *
 * Engine Support:
 * | # | Feature                                        | Status      | Notes                                        |
 * |---|------------------------------------------------|-------------|----------------------------------------------|
 * | 1 | Site phase flow                                | IMPLEMENTED | select-company, enter-or-skip, play-resources|
 * | 2 | First auto-attack (Orcs 4 str / 7 prowess)     | IMPLEMENTED | passes through as data                        |
 * | 3 | Minor/major/gold-ring playability (no greater) | IMPLEMENTED | playableResources gate                       |
 * | 4 | 2nd auto-attack (shadow-hold keyed, dynamic)   | IMPLEMENTED | dynamic-auto-attack site-rule                |
 * | 5 | Shadow-hold attack vs Ringwraith is detainment | IMPLEMENTED | §3.II.2.R1                                    |
 * | 6 | Gold ring test +1 modifier (auto-test)         | IMPLEMENTED | auto-test-gold-ring rollModifier:1           |
 * | 7 | Under-deeps movement (adjacentSites)           | IMPLEMENTED | rule 3.45                                    |
 *
 * Playable: YES
 * Certified: 2026-07-21
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MINAS_TIRITH, ASSASSIN, ORC_PATROL, PRECIOUS_GOLD_RING,
  resetMint, pool,
  buildTestState, makeSitePhase,
  setupAutoAttackStep,
  viableActions, dispatch,
} from '../test-helpers.js';
import { Phase, Alignment } from '../../index.js';
import type {
  CardDefinitionId, GameState, SitePhaseState,
  PlayHeroResourceAction, PlaySiteAutoAttackAction,
} from '../../index.js';

const THE_UNDER_GROTTOS = 'as-166' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;        // minion haven (siteDeck filler only)
const THE_MOUTH = 'le-24' as CardDefinitionId;          // Ringwraith minion character
const STRANGE_RATIONS = 'le-345' as CardDefinitionId;   // minor minion item (playable)
const SABLE_SHIELD = 'le-341' as CardDefinitionId;      // major minion item (playable)
const SCROLL_OF_ISILDUR = 'le-343' as CardDefinitionId; // greater minion item (NOT playable here)

/** A Ringwraith company at The Under-grottos, site phase, at the play-resources step. */
function minionAtGrottos(hand: CardDefinitionId[]): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_UNDER_GROTTOS, characters: [THE_MOUTH] }], hand, siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeSitePhase() };
}

/** A Ringwraith company at The Under-grottos, with the hazard player's hand configurable. */
function grottosWithHazardHand(hazardHand: CardDefinitionId[], step: SitePhaseState['step']): GameState {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: THE_UNDER_GROTTOS, characters: [THE_MOUTH] }], hand: [], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hazardHand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: { ...makeSitePhase(), step, siteEntered: true } };
}

describe('The Under-grottos (as-166)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability (minor + major + gold-ring; NOT greater) ───────────────

  test('minor item (Strange Rations) is playable at The Under-grottos', () => {
    expect(viableActions(minionAtGrottos([STRANGE_RATIONS]), PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('major item (Sable Shield) is playable at The Under-grottos', () => {
    expect(viableActions(minionAtGrottos([SABLE_SHIELD]), PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('gold-ring item (Precious Gold Ring) is playable at The Under-grottos', () => {
    expect(viableActions(minionAtGrottos([PRECIOUS_GOLD_RING]), PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('greater item (Scroll of Isildur) is NOT playable at The Under-grottos', () => {
    // playableResources is minor + major + gold-ring only — a greater item is rejected.
    expect(viableActions(minionAtGrottos([SCROLL_OF_ISILDUR]), PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ─── Gold ring auto-test: +1 modifier ────────────────────────────────────────

  test('playing a gold ring at The Under-grottos enqueues a gold-ring-test with rollModifier +1', () => {
    const state = minionAtGrottos([PRECIOUS_GOLD_RING]);

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(1);
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
    const state = minionAtGrottos([STRANGE_RATIONS]);

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(1);
    const afterPlay = dispatch(state, playActions[0].action);

    const ringTest = afterPlay.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
    expect(ringTest).toBeUndefined();
  });

  // ─── First automatic attack: Orcs 4/7 (NOT detainment) ───────────────────────

  test('first automatic attack: Orcs — 4 strikes with 7 prowess, a normal (non-detainment) attack', () => {
    const state = setupAutoAttackStep(minionAtGrottos([]));
    const next = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(4);
    expect(next.combat!.strikeProwess).toBe(7);
    expect(next.combat!.creatureRace).toBe('orc');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
    // Orc keyed to this R&L site is not a Shadow-land race → §3.II.2.R1 does not
    // fire → normal attack, not detainment.
    expect(next.combat!.detainment).toBe(false);
  });

  // ─── 2nd auto-attack: dynamic (shadow-hold keyed) ────────────────────────────

  test('shadow-hold keyed Orc-patrol is offered to the opponent as 2nd auto-attack', () => {
    const state = grottosWithHazardHand([ORC_PATROL], 'play-site-auto-attack');
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(1);
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    expect((actions[0].action as PlaySiteAutoAttackAction).cardInstanceId).toBe(orcPatrolInst);
  });

  test('a non-Shadow-hold keyed creature (Assassin) is NOT offered as 2nd auto-attack', () => {
    // Assassin keys to border-hold {B} / free-hold {F} — not shadow-hold.
    const state = grottosWithHazardHand([ASSASSIN], 'play-site-auto-attack');
    expect(viableActions(state, PLAYER_2, 'play-site-auto-attack')).toHaveLength(0);
  });

  test('passing at play-site-auto-attack advances to automatic-attacks without combat', () => {
    const state = grottosWithHazardHand([], 'play-site-auto-attack');
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  test('playing Orc-patrol as 2nd auto-attack initiates combat — detainment vs the Ringwraith company (§3.II.2.R1)', () => {
    const state = grottosWithHazardHand([ORC_PATROL], 'play-site-auto-attack');
    const orcPatrolInst = state.players[1].hand[0].instanceId;
    const next = dispatch(state, {
      type: 'play-site-auto-attack',
      player: PLAYER_2,
      cardInstanceId: orcPatrolInst,
    });

    expect(next.combat).not.toBeNull();
    expect(next.combat!.attackSource.type).toBe('played-auto-attack');
    expect(next.combat!.creatureRace).toBe('orc');
    // A Shadow-hold-keyed creature vs the Ringwraith company is detainment.
    expect(next.combat!.detainment).toBe(true);
  });

  // ─── Card pool sanity ────────────────────────────────────────────────────────

  test('as-166 is in the card pool as The Under-grottos', () => {
    const def = pool[THE_UNDER_GROTTOS as string];
    expect(def).toBeDefined();
    expect((def as { name: string }).name).toBe('The Under-grottos');
  });
});
