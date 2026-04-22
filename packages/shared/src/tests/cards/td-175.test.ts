/**
 * @module td-175.test
 *
 * Card test: Framsburg (td-175)
 * Type: hero-site (ruins-and-lairs) in Anduin Vales
 * Effects: 1 — `site-rule: dynamic-auto-attack` keyed to {R}, {S}, {w}, {s}
 *
 * Text:
 *   Nearest Haven: Lórien.
 *   Playable: Items (minor).
 *   Automatic-attacks: When a company enters this site, opponent may play
 *     one creature from his hand that is treated in all ways as the site's
 *     automatic-attack (if defeated, creature is discarded). It must
 *     normally be playable keyed to a Ruins & Lairs [{R}], Shadow-hold
 *     [{S}], single Wilderness [{w}], or Shadow-land [{s}].
 *   Special: Contains a hoard.
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                    |
 * |---|-------------------|--------|----------------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                                |
 * | 2 | sitePath          | OK     | [wilderness, border] — matches {w}{b}                    |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid haven in card pool                      |
 * | 4 | region            | OK     | "Anduin Vales" — valid region in card pool               |
 * | 5 | playableResources | OK     | [minor] — matches card text                              |
 * | 6 | automaticAttacks  | OK     | [] — dynamic (see `dynamic-auto-attack` effect)          |
 * | 7 | resourceDraws     | OK     | 1                                                        |
 * | 8 | hazardDraws       | OK     | 2                                                        |
 * | 9 | keywords          | OK     | ["hoard"] — enables hoard-item playability filter        |
 *
 * Engine Support:
 * | # | Feature                         | Status      | Notes                                                |
 * |---|---------------------------------|-------------|------------------------------------------------------|
 * | 1 | Site phase flow                 | IMPLEMENTED | select-company, enter-or-skip, play-resources        |
 * | 2 | Item playability (minor only)   | IMPLEMENTED | minor allowed; major/greater/gold-ring denied        |
 * | 3 | Hoard-item playability          | IMPLEMENTED | site keyword `hoard` enables hoard-only items        |
 * | 4 | Haven path movement             | IMPLEMENTED | movement-map.ts resolves nearestHaven (Lórien)       |
 * | 5 | Region movement                 | IMPLEMENTED | Anduin Vales adjacent to Wold & Foothills            |
 * | 6 | Card draws                      | IMPLEMENTED | resourceDraws/hazardDraws used in M/H phase          |
 * | 7 | `site-rule: dynamic-auto-attack`| IMPLEMENTED | new `play-site-auto-attack` step + `played-auto-attack` source |
 * | 8 | Post-combat disposition         | IMPLEMENTED | played creature routes to hazard's discard (no MP)   |
 *
 * Playable: YES
 * Certified: 2026-04-22
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, ARAGORN, BILBO,
  DAGGER_OF_WESTERNESSE, GLAMDRING, THE_MITHRIL_COAT, PRECIOUS_GOLD_RING,
  CAVE_DRAKE, ASSASSIN,
  resetMint, pool,
  buildSitePhaseState, buildDualHandSitePhaseState,
  viableActions, dispatch, dispatchResult,
  findCharInstanceId,
  findInPile,
} from '../test-helpers.js';
import {
  LORIEN, RIVENDELL,
  isSiteCard, buildMovementMap, getReachableSites,
  reduce,
} from '../../index.js';
import type { SiteCard, CardDefinitionId, GameState, SitePhaseState, PlaySiteAutoAttackAction } from '../../index.js';

const FRAMSBURG = 'td-175' as CardDefinitionId;
const ADAMANT_HELMET = 'td-96' as CardDefinitionId;

describe('Framsburg (td-175)', () => {
  beforeEach(() => resetMint());

  // ─── Item playability ──────────────────────────────────────────────────────

  test('minor items are playable at Framsburg', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('major items are NOT playable at Framsburg (only minor allowed)', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [GLAMDRING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('greater items are NOT playable at Framsburg', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [THE_MITHRIL_COAT],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('gold-ring items are NOT playable at Framsburg', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [PRECIOUS_GOLD_RING],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions).toHaveLength(0);
  });

  test('hoard minor item (Adamant Helmet) is playable at Framsburg', () => {
    const state = buildSitePhaseState({
      site: FRAMSBURG,
      characters: [ARAGORN],
      hand: [ADAMANT_HELMET],
    });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Dynamic auto-attack: step transitions ─────────────────────────────────

  test('entering Framsburg advances to the play-site-auto-attack step', () => {
    const state = buildDualHandSitePhaseState({
      site: FRAMSBURG,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'enter-or-skip',
    });
    const companyId = state.players[0].companies[0].id;
    const next = dispatch(state, { type: 'enter-site', player: PLAYER_1, companyId });
    expect((next.phaseState as SitePhaseState).step).toBe('play-site-auto-attack');
  });

  test('hazard player passing at play-site-auto-attack advances to automatic-attacks (no combat)', () => {
    const state = buildDualHandSitePhaseState({
      site: FRAMSBURG,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
    });
    const next = dispatch(state, { type: 'pass', player: PLAYER_2 });
    expect(next.combat).toBeNull();
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Dynamic auto-attack: legal actions ────────────────────────────────────

  test('hazard player may play a matching creature (Cave-drake — keyedTo wilderness/ruins-and-lairs)', () => {
    const state = buildDualHandSitePhaseState({
      site: FRAMSBURG,
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

  test('hazard player may NOT play a non-matching creature (Assassin — keyedTo free-hold/border-hold)', () => {
    const state = buildDualHandSitePhaseState({
      site: FRAMSBURG,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [ASSASSIN],
    });
    const actions = viableActions(state, PLAYER_2, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
  });

  test('matching creatures are filtered: Cave-drake offered, Assassin suppressed, pass always available', () => {
    const state = buildDualHandSitePhaseState({
      site: FRAMSBURG,
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

  test('resource player has no actions during play-site-auto-attack', () => {
    const state = buildDualHandSitePhaseState({
      site: FRAMSBURG,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const actions = viableActions(state, PLAYER_1, 'play-site-auto-attack');
    expect(actions).toHaveLength(0);
    const passActions = viableActions(state, PLAYER_1, 'pass');
    expect(passActions).toHaveLength(0);
  });

  // ─── Dynamic auto-attack: combat initiation ────────────────────────────────

  test('playing Cave-drake initiates combat with played-auto-attack source and cave-drake stats', () => {
    const state = buildDualHandSitePhaseState({
      site: FRAMSBURG,
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

    // Creature moved from hand to hazard's cardsInPlay during combat.
    expect(next.players[1].hand.find(c => c.instanceId === caveDrakeInst)).toBeUndefined();
    expect(next.players[1].cardsInPlay.find(c => c.instanceId === caveDrakeInst)).toBeDefined();

    // Phase advances to automatic-attacks so static auto-attacks (if any)
    // resolve next, and then the site flow continues normally.
    expect((next.phaseState as SitePhaseState).step).toBe('automatic-attacks');
  });

  // ─── Dynamic auto-attack: post-combat disposition ──────────────────────────

  test('after defeating the played creature, it goes to hazard discard (not defender kill pile)', () => {
    // Run combat to completion: both of Cave-drake's strikes defeated by
    // Aragorn/Bilbo with a cheat roll of 12 (9+12=21 and 1+12=13, both
    // > 10 creature prowess → result='success' for both).
    const state = buildDualHandSitePhaseState({
      site: FRAMSBURG,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const caveDrakeInst = state.players[1].hand[0].instanceId;
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const bilboId = findCharInstanceId(state, 0, BILBO);

    let result = dispatchResult(state, {
      type: 'play-site-auto-attack',
      player: PLAYER_2,
      cardInstanceId: caveDrakeInst,
    });
    expect(result.error).toBeUndefined();

    // Assign both strikes up-front (assign-strikes phase requires all
    // strikes committed before resolution starts).
    result = dispatchResult(result.state, {
      type: 'assign-strike', player: PLAYER_1, characterId: aragornId,
    });
    expect(result.error).toBeUndefined();
    result = dispatchResult(result.state, {
      type: 'assign-strike', player: PLAYER_1, characterId: bilboId,
    });
    expect(result.error).toBeUndefined();

    // Walk strikes through choose-strike-order → resolve-strike until
    // combat finalizes. Each iteration resolves one strike with a
    // winning roll.
    while (result.state.combat) {
      if (result.state.combat.phase === 'choose-strike-order') {
        const orderActions = viableActions(result.state, PLAYER_1, 'choose-strike-order');
        expect(orderActions.length).toBeGreaterThan(0);
        result = reduce(result.state, orderActions[0].action);
        expect(result.error).toBeUndefined();
        continue;
      }
      if (result.state.combat.phase === 'resolve-strike') {
        const resolveActions = viableActions(
          { ...result.state, cheatRollTotal: 12 } as GameState,
          PLAYER_1,
          'resolve-strike',
        );
        expect(resolveActions.length).toBeGreaterThan(0);
        result = reduce(
          { ...result.state, cheatRollTotal: 12 } as GameState,
          resolveActions[0].action,
        );
        expect(result.error).toBeUndefined();
        continue;
      }
      break;
    }

    // Combat finalized with all strikes defeated.
    expect(result.state.combat).toBeNull();

    // Creature is in hazard's discardPile (not defender's killPile).
    const inHazardDiscard = findInPile(result.state, 1, 'discardPile', caveDrakeInst);
    expect(inHazardDiscard).toBeDefined();

    const inResourceKillPile = findInPile(result.state, 0, 'killPile', caveDrakeInst);
    expect(inResourceKillPile).toBeUndefined();

    // Creature no longer in cardsInPlay.
    expect(result.state.players[1].cardsInPlay.find(c => c.instanceId === caveDrakeInst))
      .toBeUndefined();
  });

  test('after un-defeated combat (character wounded), creature still goes to hazard discard', () => {
    // Bilbo + Aragorn company. Bilbo (prowess 1) takes the first strike
    // with a low roll (4): 1 + 4 = 5 < 10 → wounded. Aragorn takes the
    // second strike with a winning roll (12): 9 + 12 = 21 > 10 → success.
    // Not all strikes defeated (one wounded) → creature goes to hazard
    // discard (not to defender's killPile).
    const state = buildDualHandSitePhaseState({
      site: FRAMSBURG,
      resourceCharacters: [ARAGORN, BILBO],
      step: 'play-site-auto-attack',
      hazardHand: [CAVE_DRAKE],
    });
    const caveDrakeInst = state.players[1].hand[0].instanceId;
    const aragornId = findCharInstanceId(state, 0, ARAGORN);
    const bilboId = findCharInstanceId(state, 0, BILBO);

    let result = dispatchResult(state, {
      type: 'play-site-auto-attack',
      player: PLAYER_2,
      cardInstanceId: caveDrakeInst,
    });
    expect(result.error).toBeUndefined();

    // Strike 1 → Bilbo, strike 2 → Aragorn.
    result = dispatchResult(result.state, {
      type: 'assign-strike', player: PLAYER_1, characterId: bilboId,
    });
    expect(result.error).toBeUndefined();
    result = dispatchResult(result.state, {
      type: 'assign-strike', player: PLAYER_1, characterId: aragornId,
    });
    expect(result.error).toBeUndefined();

    // Walk the mixed combat: defender picks Bilbo's strike first (low roll
    // → wounded, survives body check), then Aragorn's strike (high roll →
    // defeated).
    let strikeCount = 0;
    while (result.state.combat) {
      const combat = result.state.combat;
      if (combat.phase === 'choose-strike-order') {
        // Pick Bilbo's strike first (lower-prowess character first so the
        // wounded outcome lands on strike 1).
        const orderActions = viableActions(result.state, PLAYER_1, 'choose-strike-order');
        expect(orderActions.length).toBeGreaterThan(0);
        const bilboChoice = orderActions.find(a => {
          const idx = (a.action as { strikeIndex: number }).strikeIndex;
          return combat.strikeAssignments[idx].characterId === bilboId;
        });
        result = reduce(result.state, (bilboChoice ?? orderActions[0]).action);
        expect(result.error).toBeUndefined();
        continue;
      }
      if (combat.phase === 'resolve-strike') {
        const currentChar = combat.strikeAssignments[combat.currentStrikeIndex].characterId;
        const roll = currentChar === bilboId ? 4 : 12;
        const resolveActions = viableActions(
          { ...result.state, cheatRollTotal: roll } as GameState,
          PLAYER_1,
          'resolve-strike',
        );
        expect(resolveActions.length).toBeGreaterThan(0);
        result = reduce(
          { ...result.state, cheatRollTotal: roll } as GameState,
          resolveActions[0].action,
        );
        expect(result.error).toBeUndefined();
        strikeCount++;
        continue;
      }
      if (combat.phase === 'body-check') {
        // Body checks are rolled by the attacking (hazard) player.
        const bodyActions = viableActions(result.state, PLAYER_2, 'body-check-roll');
        expect(bodyActions.length).toBeGreaterThan(0);
        result = reduce(
          { ...result.state, cheatRollTotal: 12 } as GameState,
          bodyActions[0].action,
        );
        expect(result.error).toBeUndefined();
        continue;
      }
      break;
    }
    expect(strikeCount).toBe(2);
    expect(result.state.combat).toBeNull();

    // Not all strikes defeated → creature goes to hazard discard
    // (never to defender's killPile regardless of outcome).
    const inHazardDiscard = findInPile(result.state, 1, 'discardPile', caveDrakeInst);
    expect(inHazardDiscard).toBeDefined();
    const inResourceKillPile = findInPile(result.state, 0, 'killPile', caveDrakeInst);
    expect(inResourceKillPile).toBeUndefined();
  });

  // ─── Movement: Lórien → Framsburg ──────────────────────────────────────────

  test('starter movement from Lórien reaches Framsburg', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (FRAMSBURG as string),
    );
    expect(starterEntry).toBeDefined();
  });

  test('starter movement from Rivendell does NOT reach Framsburg', () => {
    const rivendell = pool[RIVENDELL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, rivendell, allSites);
    const starterEntry = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (FRAMSBURG as string),
    );
    expect(starterEntry).toBeUndefined();
  });

  test('starter movement from Framsburg reaches Lórien', () => {
    const framsburg = pool[FRAMSBURG as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, framsburg, allSites);
    const starterLorien = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LORIEN as string),
    );
    expect(starterLorien).toBeDefined();
  });

  test('region movement from Lórien reaches Framsburg (Anduin Vales adjacent to Wold & Foothills)', () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const regionEntry = reachable.find(
      r => r.movementType === 'region' && r.site.id === (FRAMSBURG as string),
    );
    expect(regionEntry).toBeDefined();
    expect(regionEntry!.regionDistance).toBe(2);
  });
});
