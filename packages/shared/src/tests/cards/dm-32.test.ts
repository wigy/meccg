/**
 * @module dm-32.test
 *
 * Card test: Hermit's Hill (dm-32)
 * Type: hero-site (ruins-and-lairs) in Wold & Foothills
 *
 * Nearest Haven: Lórien (tw-408)
 * Site path: [wilderness]
 * Playable: Items (minor)
 * Automatic-attacks: Men — 3 strikes with 6 prowess
 * Resource draws: 1 / Hazard draws: 1
 *
 * Special: During the site phase, a company may discard two minor items they
 * bear to make any one major item (including a hoard item) playable at this
 * untapped site this turn.
 *
 * Effects: 1 — grant-action (discard-minors-for-major)
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                               |
 * |---|-------------------|--------|-----------------------------------------------------|
 * | 1 | siteType          | OK     | "ruins-and-lairs" — valid                           |
 * | 2 | sitePath          | OK     | ["wilderness"] — matches single-wilderness path     |
 * | 3 | nearestHaven      | OK     | "Lórien" — valid hero haven (tw-408)                |
 * | 4 | region            | OK     | "Wold & Foothills"                                  |
 * | 5 | playableResources | OK     | ["minor"] — matches text                            |
 * | 6 | automaticAttacks  | OK     | Men, 3 strikes / 6 prowess                          |
 * | 7 | resourceDraws     | OK     | 1                                                   |
 * | 8 | hazardDraws       | OK     | 1                                                   |
 * | 9 | effects           | OK     | grant-action "discard-minors-for-major" — IMPLEMENTED |
 *
 * Engine Support:
 * | # | Feature                        | Status      | Notes                                        |
 * |---|--------------------------------|-------------|----------------------------------------------|
 * | 1 | Site phase flow                | IMPLEMENTED | select-company, enter-or-skip, play-resources |
 * | 2 | Automatic attack (Men 3/6)     | IMPLEMENTED | passes through as data                       |
 * | 3 | Minor item playability         | IMPLEMENTED | playableResources gate                       |
 * | 4 | Major item NOT playable by def | IMPLEMENTED | not in playableResources                     |
 * | 5 | Haven path movement            | IMPLEMENTED | movement-map.ts — Lórien ↔ Hermit's Hill     |
 * | 6 | discard-minors-for-major       | IMPLEMENTED | sitePhaseGrantActions + reducer handler      |
 * | 7 | major-item-unlocked constraint | IMPLEMENTED | checked in playResourcesActions              |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, ARAGORN, BILBO,
  LORIEN, GLAMDRING, DAGGER_OF_WESTERNESSE,
  resetMint, pool,
  buildSitePhaseState, setupAutoAttackStep,
  viableActions, dispatch,
  attachItemToChar,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  isSiteCard,
  buildMovementMap,
  getReachableSites,
  CardStatus,
} from '../../index.js';
import type { CardDefinitionId, GameState, SiteCard, ActivateGrantedAction } from '../../index.js';

const HERMITS_HILL = 'dm-32' as CardDefinitionId;

describe("Hermit's Hill (dm-32)", () => {
  beforeEach(() => resetMint());

  // ─── Automatic attack: Men 3/6 ───────────────────────────────────────────────

  test('automatic attack: Men — 3 strikes with 6 prowess', () => {
    const state = buildSitePhaseState({
      site: HERMITS_HILL,
      characters: [ARAGORN],
    });
    const readyState = setupAutoAttackStep(state);

    const next = dispatch(readyState, { type: 'pass', player: PLAYER_1 });
    expect(next.combat).not.toBeNull();
    expect(next.combat!.strikesTotal).toBe(3);
    expect(next.combat!.strikeProwess).toBe(6);
    expect(next.combat!.creatureRace).toBe('man');
    expect(next.combat!.attackSource.type).toBe('automatic-attack');
  });

  // ─── Item playability (default) ──────────────────────────────────────────────

  test('minor item (Dagger of Westernesse) is playable at Hermit\'s Hill', () => {
    const state = buildSitePhaseState({
      site: HERMITS_HILL,
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBeGreaterThan(0);
  });

  test('major item (Glamdring) is NOT playable at Hermit\'s Hill without the special ability', () => {
    const state = buildSitePhaseState({
      site: HERMITS_HILL,
      hand: [GLAMDRING],
    });

    const actions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(actions.length).toBe(0);
  });

  // ─── discard-minors-for-major grant-action ────────────────────────────────────

  test('discard-minors-for-major action offered when company has 2 minor items', () => {
    let state: GameState = buildSitePhaseState({
      site: HERMITS_HILL,
      characters: [ARAGORN, BILBO],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    state = attachItemToChar(state, RESOURCE_PLAYER, BILBO, DAGGER_OF_WESTERNESSE);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const discardAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'discard-minors-for-major',
    );
    expect(discardAction).toBeDefined();
  });

  test('discard-minors-for-major action NOT offered when company has only 1 minor item', () => {
    let state: GameState = buildSitePhaseState({
      site: HERMITS_HILL,
      characters: [ARAGORN],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const discardAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'discard-minors-for-major',
    );
    expect(discardAction).toBeUndefined();
  });

  test('discard-minors-for-major action NOT offered when site is already tapped', () => {
    let state: GameState = buildSitePhaseState({
      site: HERMITS_HILL,
      characters: [ARAGORN, BILBO],
      siteStatus: CardStatus.Tapped,
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    state = attachItemToChar(state, RESOURCE_PLAYER, BILBO, DAGGER_OF_WESTERNESSE);

    const actions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const discardAction = actions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'discard-minors-for-major',
    );
    expect(discardAction).toBeUndefined();
  });

  test('after discarding 2 minor items, major item (Glamdring) becomes playable', () => {
    let state: GameState = buildSitePhaseState({
      site: HERMITS_HILL,
      characters: [ARAGORN, BILBO],
      hand: [GLAMDRING],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    state = attachItemToChar(state, RESOURCE_PLAYER, BILBO, DAGGER_OF_WESTERNESSE);

    // Find and activate the discard-minors-for-major action
    const grantActions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const grantEA = grantActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'discard-minors-for-major',
    );
    expect(grantEA).toBeDefined();
    const afterDiscard = dispatch(state, grantEA!.action as ActivateGrantedAction);

    // Glamdring (major item) should now be playable
    const playActions = viableActions(afterDiscard, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThan(0);

    const glamdringInstanceId = afterDiscard.players[0].hand.find(c => {
      const def = afterDiscard.cardPool[c.definitionId as string];
      return def?.name === 'Glamdring';
    })?.instanceId;
    expect(glamdringInstanceId).toBeDefined();
    expect(
      playActions.some(ea => (ea.action as { cardInstanceId?: string }).cardInstanceId === (glamdringInstanceId as string)),
    ).toBe(true);
  });

  test('discarding 2 minor items removes them from characters and adds them to discard pile', () => {
    let state: GameState = buildSitePhaseState({
      site: HERMITS_HILL,
      characters: [ARAGORN, BILBO],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, DAGGER_OF_WESTERNESSE);
    state = attachItemToChar(state, RESOURCE_PLAYER, BILBO, DAGGER_OF_WESTERNESSE);

    const grantActions = viableActions(state, PLAYER_1, 'activate-granted-action');
    const grantEA = grantActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'discard-minors-for-major',
    );
    expect(grantEA).toBeDefined();

    const afterDiscard = dispatch(state, grantEA!.action as ActivateGrantedAction);

    // All items removed from characters
    const finalItemCount = Object.values(afterDiscard.players[0].characters)
      .reduce((sum, ch) => sum + ch.items.length, 0);
    expect(finalItemCount).toBe(0);

    // Both items in discard pile
    expect(afterDiscard.players[0].discardPile.length).toBe(2);
  });

  // ─── Movement: Lórien ↔ Hermit's Hill ────────────────────────────────────────

  test("starter movement from Lórien reaches Hermit's Hill", () => {
    const lorien = pool[LORIEN as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, lorien, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (HERMITS_HILL as string),
    );

    expect(starter).toBeDefined();
  });

  test("starter movement from Hermit's Hill reaches Lórien", () => {
    const hermitsHill = pool[HERMITS_HILL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, hermitsHill, allSites);
    const starter = reachable.find(
      r => r.movementType === 'starter' && r.site.id === (LORIEN as string),
    );

    expect(starter).toBeDefined();
  });
});
