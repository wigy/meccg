/**
 * @module le-393.test
 *
 * Card test: Mount Doom (le-393)
 * Type: minion-site (shadow-hold)
 *
 * Text:
 *   "Nearest Darkhaven: Minas Morgul.
 *    Playable: Information.
 *    Automatic-attacks: Orcs — 1 strike with 6 prowess.
 *    Special: Any sage may tap to test a ring at this site, modifying the
 *    result by -3."
 *
 * Site Structural Checks:
 * | # | Property          | Status | Notes                                                       |
 * |---|-------------------|--------|-------------------------------------------------------------|
 * | 1 | siteType          | OK     | "shadow-hold" — matches {S}                                 |
 * | 2 | sitePath          | OK     | [shadow, dark] — matches {s}{d}                             |
 * | 3 | nearestHaven      | OK     | "Minas Morgul" — valid minion darkhaven (le-390)           |
 * | 4 | region            | OK     | "Gorgoroth"                                                 |
 * | 5 | playableResources | OK     | [information]                                              |
 * | 6 | automaticAttacks  | OK     | Orcs — 1 strike, 6 prowess (auto-attack list is structural) |
 * | 7 | resourceDraws     | OK     | 2                                                           |
 * | 8 | hazardDraws       | OK     | 1                                                           |
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                                |
 * |---|------------------------------------------|-------------|------------------------------------------------------|
 * | 1 | Haven path movement                      | IMPLEMENTED | Minas Morgul ↔ Mount Doom via starter movement       |
 * | 2 | Card draws                               | IMPLEMENTED | resourceDraws (2) / hazardDraws (1)                  |
 * | 3 | site-rule: sage-tap-ring-test (-3)        | IMPLEMENTED | a sage taps to test a borne gold ring at -3          |
 *
 * The "Special" rule is implemented as the `sage-tap-ring-test` site-rule:
 * during the organization phase, any untapped sage in a company at this site
 * may tap (`test-ring-at-site`) to test a gold-ring item borne in that company.
 * The shared `gold-ring-test` resolution then rolls 2d6 with the -3 modifier,
 * discards the ring, and offers a matching special ring.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, MORIA,
  Phase, Alignment, CardStatus,
  buildTestState, resetMint, pool,
  viableActions, findCharInstanceId, getCharacter, dispatch, RESOURCE_PLAYER,
} from '../test-helpers.js';
import {
  isSiteCard, buildMovementMap, getReachableSites, computeLegalActions,
} from '../../index.js';
import type { SiteCard, CardDefinitionId, TestRingAtSiteAction, GoldRingTestRollAction } from '../../index.js';

const MOUNT_DOOM = 'le-393' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const MORIA_LE = 'le-392' as CardDefinitionId; // minion shadow-hold WITHOUT the sage-tap rule
const HADOR = 'le-14' as CardDefinitionId;      // minion-character, ringwraith, sage
const WITCH_KING = 'le-58' as CardDefinitionId; // minion-character, ringwraith, sage (2nd sage)
const MIONID = 'as-3' as CardDefinitionId;      // minion-character, man, NOT a sage (warrior/ranger)
const THE_LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId; // gold-ring item

/** Build a minion company at MOUNT_DOOM during the organization phase. */
function orgStateAtMountDoom(
  chars: Parameters<typeof buildTestState>[0]['players'][number]['companies'][number]['characters'],
  site: CardDefinitionId = MOUNT_DOOM,
) {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site, characters: chars }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [MORIA],
      },
    ],
  });
}

describe('Mount Doom (le-393)', () => {
  beforeEach(() => resetMint());

  // ─── Movement ───────────────────────────────────────────────────────────────

  test('reachable from Minas Morgul (nearest darkhaven) via starter movement', () => {
    const minasMorgul = pool[MINAS_MORGUL as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, minasMorgul, allSites);
    const starterIds = reachable.filter(r => r.movementType === 'starter').map(r => r.site.id);

    expect(starterIds).toContain(MOUNT_DOOM);
  });

  test('starter movement from Mount Doom returns to Minas Morgul', () => {
    const mountDoom = pool[MOUNT_DOOM as string] as SiteCard;
    const allSites = Object.values(pool).filter(isSiteCard);
    const movementMap = buildMovementMap(pool);

    const reachable = getReachableSites(movementMap, mountDoom, allSites);
    const starterIds = reachable.filter(r => r.movementType === 'starter').map(r => r.site.id);

    expect(starterIds).toContain(MINAS_MORGUL);
  });

  // ─── Special: sage taps to test a ring at this site (-3) ──────────────────────

  test('untapped sage with a gold ring in company can tap to test it', () => {
    // Hador (sage) tests a gold ring borne by a non-sage companion (Mîonid).
    const state = orgStateAtMountDoom([HADOR, { defId: MIONID, items: [THE_LEAST_OF_GOLD_RINGS] }]);

    const actions = viableActions(state, PLAYER_1, 'test-ring-at-site');
    expect(actions).toHaveLength(1);

    const action = actions[0].action as TestRingAtSiteAction;
    expect(action.characterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, HADOR));
    const ringInstId = getCharacter(state, RESOURCE_PLAYER, MIONID).items[0].instanceId;
    expect(action.targetCardId).toBe(ringInstId);
  });

  test('a sage may test a gold ring it bears itself', () => {
    const state = orgStateAtMountDoom([{ defId: HADOR, items: [THE_LEAST_OF_GOLD_RINGS] }]);

    const actions = viableActions(state, PLAYER_1, 'test-ring-at-site');
    expect(actions).toHaveLength(1);
    const ringInstId = getCharacter(state, RESOURCE_PLAYER, HADOR).items[0].instanceId;
    expect((actions[0].action as TestRingAtSiteAction).targetCardId).toBe(ringInstId);
  });

  test('"any sage" — every untapped sage in the company gets an activation', () => {
    const state = orgStateAtMountDoom([
      { defId: HADOR, items: [THE_LEAST_OF_GOLD_RINGS] },
      WITCH_KING,
    ]);

    const actions = viableActions(state, PLAYER_1, 'test-ring-at-site');
    // One activation per (sage × ring): two sages, one ring → two actions.
    expect(actions).toHaveLength(2);
    const sageIds = (actions.map(a => (a.action as TestRingAtSiteAction).characterId)).sort();
    const expected = [
      findCharInstanceId(state, RESOURCE_PLAYER, HADOR),
      findCharInstanceId(state, RESOURCE_PLAYER, WITCH_KING),
    ].sort();
    expect(sageIds).toEqual(expected);
  });

  test('a tapped sage cannot tap to test (cost unpayable)', () => {
    const state = orgStateAtMountDoom([
      { defId: HADOR, status: CardStatus.Tapped, items: [THE_LEAST_OF_GOLD_RINGS] },
    ]);

    const actions = viableActions(state, PLAYER_1, 'test-ring-at-site');
    expect(actions).toHaveLength(0);
  });

  test('a non-sage character cannot test a ring (no sage in company)', () => {
    const state = orgStateAtMountDoom([{ defId: MIONID, items: [THE_LEAST_OF_GOLD_RINGS] }]);

    const actions = viableActions(state, PLAYER_1, 'test-ring-at-site');
    expect(actions).toHaveLength(0);
  });

  test('no gold ring in the company means no test action', () => {
    const state = orgStateAtMountDoom([HADOR]);

    const actions = viableActions(state, PLAYER_1, 'test-ring-at-site');
    expect(actions).toHaveLength(0);
  });

  test('regression: the same sage + ring at a site without the rule offers no test', () => {
    // Moria (le-392) is a minion shadow-hold with its own site-rule but NOT
    // sage-tap-ring-test — proving the action is gated on the site rule, not
    // merely on having a sage and a gold ring.
    const state = orgStateAtMountDoom(
      [{ defId: HADOR, items: [THE_LEAST_OF_GOLD_RINGS] }],
      MORIA_LE,
    );

    const actions = viableActions(state, PLAYER_1, 'test-ring-at-site');
    expect(actions).toHaveLength(0);
  });

  test('activating the test taps the sage and enqueues a gold-ring-test at -3', () => {
    const state = orgStateAtMountDoom([{ defId: HADOR, items: [THE_LEAST_OF_GOLD_RINGS] }]);
    const action = viableActions(state, PLAYER_1, 'test-ring-at-site')[0].action;

    const after = dispatch(state, action);

    // The sage is tapped (the cost).
    const hador = getCharacter(after, RESOURCE_PLAYER, HADOR);
    expect(hador.status).toBe(CardStatus.Tapped);

    // A gold-ring-test resolution is pending with the site's -3 modifier.
    const ringTest = after.pendingResolutions.find(r => r.kind.type === 'gold-ring-test');
    expect(ringTest).toBeDefined();
    const kind = ringTest!.kind;
    if (kind.type !== 'gold-ring-test') throw new Error('unreachable');
    expect(kind.rollModifier).toBe(-3);
  });

  test('the -3 modifier is applied to the ring-test result and the ring is discarded', () => {
    const state = orgStateAtMountDoom([{ defId: HADOR, items: [THE_LEAST_OF_GOLD_RINGS] }]);
    const ringInstId = getCharacter(state, RESOURCE_PLAYER, HADOR).items[0].instanceId;
    const testAction = viableActions(state, PLAYER_1, 'test-ring-at-site')[0].action;

    const afterTap = dispatch(state, testAction);

    // The pending roll action carries the -3 modifier.
    const rollActions = computeLegalActions(afterTap, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'gold-ring-test-roll');
    expect(rollActions).toHaveLength(1);
    expect((rollActions[0].action as GoldRingTestRollAction).rollModifier).toBe(-3);

    // Roll a raw 12; with the -3 site modifier the effective total is 9.
    const afterRoll = dispatch({ ...afterTap, cheatRollTotal: 12 }, rollActions[0].action);

    // The gold ring has been discarded from the bearer.
    const bearer = getCharacter(afterRoll, RESOURCE_PLAYER, HADOR);
    expect(bearer.items.some(i => i.instanceId === ringInstId)).toBe(false);
    expect(afterRoll.players[0].discardPile.some(c => c.instanceId === ringInstId)).toBe(true);

    // A ring-play-offer follows, exposing the modified total (12 - 3 = 9).
    const offer = afterRoll.pendingResolutions.find(r => r.kind.type === 'ring-play-offer');
    expect(offer).toBeDefined();
    const offerKind = offer!.kind;
    if (offerKind.type !== 'ring-play-offer') throw new Error('unreachable');
    expect(offerKind.rollTotal).toBe(9);

    // At total 9, the gold ring's table yields lesser-ring only — NOT
    // dwarven-ring (10+) or the-one-ring (12+), which a raw-12 roll would
    // have qualified for. This is the observable proof the -3 applied.
    expect(offerKind.eligibleCategories).toContain('lesser-ring');
    expect(offerKind.eligibleCategories).not.toContain('dwarven-ring');
    expect(offerKind.eligibleCategories).not.toContain('the-one-ring');
  });
});
