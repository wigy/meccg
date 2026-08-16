/**
 * @module tw-274.test
 *
 * Card test: Magic Ring of Stealth (tw-274)
 * Type: hero-resource-item (subtype: special)
 * Keywords: ring, magic-ring
 *
 * "Magic Ring. Playable only with a gold ring and after a test indicates a
 *  Magic Ring. Gives the bearer scout skill. If the bearer is already a scout,
 *  he may tap the Magic Ring of Stealth to cancel a strike directed against him.
 *  Cannot be duplicated on a given character."
 *
 * Engine support:
 * | # | Feature                                              | Status      | Notes                                         |
 * |---|------------------------------------------------------|-------------|-----------------------------------------------|
 * | 1 | Gives the bearer scout skill                         | IMPLEMENTED | grant-skill effect + getItemGrantedSkills()   |
 * | 2 | Natural scout may tap ring to cancel a strike        | IMPLEMENTED | cancel-strike with when bearer.skills.scout   |
 * | 3 | Non-natural scout cannot use cancel-strike           | IMPLEMENTED | when condition reads natural skills only      |
 * | 4 | Cannot be duplicated on a given character            | IMPLEMENTED | duplication-limit scope:character max:1       |
 * | 5 | Eligible as ring-test replacement for matching roll  | IMPLEMENTED | keyword magic-ring matched against test table |
 *
 * Character selection:
 * - LEGOLAS (tw-168): warrior+diplomat, no scout — used for Rule 1 and Rule 3
 * - FRODO (tw-152): scout+diplomat — used for Rule 2 (natural scout cancel-strike)
 * - ARAGORN (tw-120): warrior+scout+ranger — natural scout, used for baseline
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, FRODO,
  ORC_LIEUTENANT,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  STEALTH,
  Phase,
  buildTestState, resetMint, makeMHState,
  findCharInstanceId, viableActions, dispatch, resolveChain,
  attachItemToChar, handCardId, companyIdAt, actionAs,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  enqueueGoldRingTest, addCardToHand,
} from '../test-helpers.js';
import { computeLegalActions, SiteType } from '../../index.js';
import type { CancelStrikeAction } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const MAGIC_RING_OF_STEALTH = 'tw-274' as CardDefinitionId;
const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;

describe('Magic Ring of Stealth (tw-274)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Gives the bearer scout skill ────────────────────────────────

  test('non-scout bearer (Legolas) counts as scout for Stealth targeting when ring is held', () => {
    // Legolas (tw-168) is warrior+diplomat, not a scout. With the ring he
    // should satisfy Stealth's scout filter (`target.skills.$includes.scout`).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: LEGOLAS, items: [MAGIC_RING_OF_STEALTH] }] }],
          hand: [STEALTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('non-scout without ring (Legolas): Stealth not playable', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [STEALTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    expect(playActions.length).toBe(0);
  });

  // ── Rule 2: Natural scout may cancel a strike ────────────────────────────

  test('natural scout bearer (Frodo) can tap ring to cancel a strike', () => {
    // Frodo (tw-152) is scout+diplomat; with the ring he can tap it to cancel.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: FRODO, items: [MAGIC_RING_OF_STEALTH] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePathNames: [],
      resolvedSitePath: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const ltId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ltId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'ruins-and-lairs' },
    });
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();

    const frodoId = findCharInstanceId(afterChain, RESOURCE_PLAYER, FRODO);
    const ringInstanceId = afterChain.players[RESOURCE_PLAYER].characters[frodoId].items[0].instanceId;

    const afterAssign = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: frodoId,
      tapped: false,
    });

    const cancelActions = computeLegalActions(afterAssign, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-strike');

    expect(cancelActions.length).toBeGreaterThanOrEqual(1);
    expect(cancelActions.some(ea => actionAs<CancelStrikeAction>(ea.action).cancellerInstanceId === ringInstanceId)).toBe(true);
  });

  // ── Rule 3: Non-natural scout cannot use cancel-strike ───────────────────

  test('bearer who is only a scout via ring grant (Legolas) cannot use cancel-strike', () => {
    // Legolas is NOT a natural scout. The ring grants scout for targeting
    // but the cancel-strike when condition reads natural skills only.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: LEGOLAS, items: [MAGIC_RING_OF_STEALTH] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [ORC_LIEUTENANT],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const mhState = makeMHState({
      resolvedSitePathNames: [],
      resolvedSitePath: [],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const gameState = { ...state, phaseState: mhState };

    const ltId = handCardId(gameState, HAZARD_PLAYER);
    const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
    const afterPlay = dispatch(gameState, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: ltId,
      targetCompanyId: companyId,
      keyedBy: { method: 'site-type' as const, value: 'ruins-and-lairs' },
    });
    const afterChain = resolveChain(afterPlay);
    expect(afterChain.combat).not.toBeNull();

    const legolasId = findCharInstanceId(afterChain, RESOURCE_PLAYER, LEGOLAS);

    const afterAssign = dispatch(afterChain, {
      type: 'assign-strike',
      player: PLAYER_1,
      characterId: legolasId,
      tapped: false,
    });

    const cancelActions = computeLegalActions(afterAssign, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'cancel-strike');

    expect(cancelActions).toHaveLength(0);
  });

  // ── Corruption points: printed 2 CP, not 0 ───────────────────────────────

  test('bearer suffers 2 corruption points from the ring (printed CP, not 0)', () => {
    // Bug report: a bearer holding the ring showed 0 CP instead of the
    // printed 2. The card data had corruptionPoints: 0 instead of 2.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: LEGOLAS, items: [MAGIC_RING_OF_STEALTH] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withDerived = recomputeDerived(base);
    const legolasId = findCharInstanceId(withDerived, RESOURCE_PLAYER, LEGOLAS);
    const char = withDerived.players[RESOURCE_PLAYER].characters[legolasId];

    expect(char.effectiveStats.corruptionPoints).toBe(2);
  });

  // ── Rule 5: Gold-ring test eligibility ──────────────────────────────────

  test('magic-ring offered when roll total matches magic-ring range (1–5 on Precious Gold Ring)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_STEALTH);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 3 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(1);
  });

  test('magic-ring NOT offered when roll total is outside magic-ring range', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_STEALTH);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 7 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(0);
  });

  test('magic-ring played via test: moves from hand onto the character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_STEALTH);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 4 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playAction = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')[0].action;
    const afterPlay = dispatch(afterRoll, playAction);

    expect(afterPlay.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING_OF_STEALTH)).toBeUndefined();
    expect(
      afterPlay.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === MAGIC_RING_OF_STEALTH),
    ).toBeDefined();
  });
});
