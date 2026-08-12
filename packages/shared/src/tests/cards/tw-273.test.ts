/**
 * @module tw-273.test
 *
 * Card test: Magic Ring of Nature (tw-273)
 * Type: hero-resource-item (subtype: special)
 * Keywords: ring, magic-ring
 *
 * "Magic Ring. Playable only with a gold ring and after a test indicates a
 *  Magic Ring. Gives the bearer ranger skill. If the bearer is already a
 *  ranger, he may tap to cancel an attack against his company. Cannot be
 *  duplicated on a given character."
 *
 * Engine support:
 * | # | Feature                                              | Status      | Notes                                          |
 * |---|-------------------------------------------------------|-------------|-------------------------------------------------|
 * | 1 | Gives the bearer ranger skill                        | IMPLEMENTED | grant-skill effect + getEffectiveSkills()       |
 * | 2 | Natural ranger may tap to cancel an attack            | IMPLEMENTED | cancel-attack cost:{tap:bearer}, when bearer.skills.ranger |
 * | 3 | Non-natural ranger cannot use cancel-attack           | IMPLEMENTED | when condition reads printed skills only        |
 * | 4 | Cannot be duplicated on a given character             | IMPLEMENTED | duplication-limit scope:character max:1         |
 * | 5 | Eligible as ring-test replacement for matching roll   | IMPLEMENTED | keyword magic-ring matched against test table   |
 *
 * Engine change: item-borne `cancel-attack` effects previously had no
 * `bearer.skills` field in their `when` evaluation context (only
 * `bearer.companySize`/`atHaven`/`destinationRegion`) — the item loop in
 * `resolveCancelAttackActions` (`legal-actions/combat.ts`) now merges the
 * bearing character's printed skills into `bearer.skills` (mirroring the
 * `cancel-strike` convention of reading `charDef.skills`, not
 * `getEffectiveSkills`, so a ring's own `grant-skill` never satisfies its own
 * "if already a <skill>" gate).
 *
 * Character selection:
 * - ARAGORN (tw-120): warrior+scout+ranger — natural ranger, used for Rule 2
 * - LEGOLAS (tw-168): warrior+diplomat, no ranger — used for Rules 1 and 3
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, CancelAttackAction, PlayPermanentEventAction } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  Phase,
  buildTestState, resetMint,
  findCharInstanceId, viableActions, dispatch,
  attachItemToChar, expectCharStatus,
  makeCancelWindowCombat,
  RESOURCE_PLAYER,
  enqueueGoldRingTest, addCardToHand,
} from '../test-helpers.js';
import { CardStatus } from '../../index.js';

const MAGIC_RING_OF_NATURE = 'tw-273' as CardDefinitionId;
const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;
const PROMPTINGS_OF_WISDOM = 'wh-34' as CardDefinitionId;

describe('Magic Ring of Nature (tw-273)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Gives the bearer ranger skill ───────────────────────────────

  test('non-ranger bearer (Legolas) counts as ranger for Promptings of Wisdom targeting when ring is held', () => {
    // Legolas (tw-168) is warrior+diplomat, not a ranger. With the ring he
    // should satisfy Promptings of Wisdom's ranger filter
    // (`target.skills.$includes.ranger`).
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: LEGOLAS, items: [MAGIC_RING_OF_NATURE] }] }],
          hand: [PROMPTINGS_OF_WISDOM],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(1);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    expect((playActions[0].action as PlayPermanentEventAction).targetCharacterId).toBe(legolasId);
  });

  test('non-ranger without ring (Legolas): Promptings of Wisdom not playable', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [LEGOLAS] }],
          hand: [PROMPTINGS_OF_WISDOM],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(playActions).toHaveLength(0);
  });

  // ── Rule 2: Natural ranger may tap to cancel an attack ──────────────────

  test('natural ranger bearer (Aragorn) can tap to cancel an attack against his company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, MAGIC_RING_OF_NATURE);
    const state = makeCancelWindowCombat(withItem, {});

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(1);
    const action = actions[0].action as CancelAttackAction;
    expect(action.type).toBe('cancel-attack');
  });

  test('activating cancel-attack cancels combat immediately, tapping the bearer but not the ring', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, MAGIC_RING_OF_NATURE);
    const state = makeCancelWindowCombat(withItem, {});

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    const after = dispatch(state, actions[0].action);

    expect(after.combat).toBeNull();
    expect(after.chain).toBeNull();

    expectCharStatus(after, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);

    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const ring = after.players[RESOURCE_PLAYER].characters[aragornId].items
      .find(i => i.definitionId === MAGIC_RING_OF_NATURE);
    expect(ring).toBeDefined();
    expect(ring!.status).toBe(CardStatus.Untapped);
  });

  test('cancel-attack is NOT offered when bearer is already tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, status: CardStatus.Tapped }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, MAGIC_RING_OF_NATURE);
    const state = makeCancelWindowCombat(withItem, {});

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(0);
  });

  // ── Rule 3: Non-natural ranger cannot use cancel-attack ──────────────────

  test('bearer who is only a ranger via ring grant (Legolas) cannot tap to cancel an attack', () => {
    // Legolas is NOT a natural ranger. The ring grants ranger for targeting
    // purposes but the cancel-attack when condition reads printed skills only.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const withItem = attachItemToChar(base, RESOURCE_PLAYER, LEGOLAS, MAGIC_RING_OF_NATURE);
    const state = makeCancelWindowCombat(withItem, {});

    const actions = viableActions(state, PLAYER_1, 'cancel-attack');
    expect(actions).toHaveLength(0);
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
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_NATURE);

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
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_NATURE);

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
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_NATURE);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 4 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playAction = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')[0].action;
    const afterPlay = dispatch(afterRoll, playAction);

    expect(afterPlay.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING_OF_NATURE)).toBeUndefined();
    expect(
      afterPlay.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === MAGIC_RING_OF_NATURE),
    ).toBeDefined();
  });
});
