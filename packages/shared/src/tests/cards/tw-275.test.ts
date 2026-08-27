/**
 * @module tw-275.test
 *
 * Card test: Magic Ring of Words (tw-275)
 * Type: hero-resource-item (subtype: special)
 * Keywords: ring
 *
 * "Magic Ring. Playable only with a gold ring and after a test indicates a
 *  Magic Ring. Gives the bearer diplomat skill. If the bearer is already a
 *  diplomat, he gets +3 to direct influence. Cannot be duplicated on a given
 *  character."
 *
 * Engine support:
 * | # | Feature                                                | Status      | Notes                                             |
 * |---|---------------------------------------------------------|-------------|-----------------------------------------------------|
 * | 1 | Eligible as ring-test replacement for matching roll    | IMPLEMENTED | keyword ring matched against test table            |
 * | 2 | Gives the bearer diplomat skill                        | IMPLEMENTED | grant-skill effect + getEffectiveSkills()           |
 * | 3 | Natural diplomat gets +3 direct influence              | IMPLEMENTED | stat-modifier with when bearer.naturalSkills        |
 * | 4 | Bearer who is only a diplomat via the ring gets no +3  | IMPLEMENTED | when condition reads natural skills only            |
 * | 5 | Cannot be duplicated on a given character              | IMPLEMENTED | duplication-limit scope:character max:1             |
 *
 * Mirrors the Magic Ring of Courage (tw-271) shape: `stat-modifier`'s `when`
 * is evaluated against the effective-stats context, where `bearer.skills` is
 * merged with every item's granted skills — including this ring's own
 * `grant-skill`. The bonus therefore gates on `bearer.naturalSkills` (printed
 * skills only) so it doesn't trivially satisfy itself once the ring is in
 * play.
 *
 * Character selection:
 * - FRODO (tw-152): scout+diplomat, direct influence 1 — natural diplomat,
 *   used for Rule 3 (the +3 direct-influence bonus).
 * - ARAGORN (tw-120): warrior+scout+ranger, direct influence 3, NOT a
 *   diplomat — used for Rule 2 (grant-skill observable via Lordly Presence's
 *   diplomat-only targeting) and Rule 4 (no +3 bonus) and Rule 5
 *   (duplication limit).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, PlayShortEventAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO,
  RANGERS_OF_THE_NORTH, BREE,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  Phase,
  buildTestState, buildInfluenceAttemptChainState, resetMint, recomputeDerived, getCharacter,
  findCharInstanceId, viableActions, dispatch,
  attachItemToChar, addCardToHand,
  RESOURCE_PLAYER,
  enqueueGoldRingTest,
} from '../test-helpers.js';

const MAGIC_RING_OF_WORDS = 'tw-275' as CardDefinitionId;
const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;
// "Diplomat only" short event with a play-target filter on target.skills
// $includes diplomat, playable only in response to a live influence attempt.
const LORDLY_PRESENCE = 'tw-267' as CardDefinitionId;

describe('Magic Ring of Words (tw-275)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: gold-ring-test eligibility ────────────────────────────────────

  test('magic-ring offered when roll total matches magic-ring range (1–5 on Precious Gold Ring)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_WORDS);

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
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_WORDS);

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
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const ringId = withRing.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_WORDS);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 4 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playAction = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')[0].action;
    const afterPlay = dispatch(afterRoll, playAction);

    expect(afterPlay.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING_OF_WORDS)).toBeUndefined();
    expect(
      afterPlay.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === MAGIC_RING_OF_WORDS),
    ).toBeDefined();
  });

  // ── Rule 2: gives the bearer diplomat skill ───────────────────────────────

  test('non-diplomat bearer (Aragorn) counts as diplomat for Lordly Presence targeting when ring is held', () => {
    // Aragorn (tw-120) is warrior+scout+ranger, not a diplomat. With the ring
    // he should satisfy Lordly Presence's diplomat filter
    // (`target.skills.$includes.diplomat`). Lordly Presence is only playable
    // in response to a live influence attempt, so the fixture declares one
    // (Rangers of the North at Bree) before checking.
    const built = buildInfluenceAttemptChainState({
      characters: [ARAGORN],
      site: BREE,
      hand: [LORDLY_PRESENCE, RANGERS_OF_THE_NORTH],
      factionDefId: RANGERS_OF_THE_NORTH,
    });
    const state = attachItemToChar(built, RESOURCE_PLAYER, ARAGORN, MAGIC_RING_OF_WORDS);

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions.some(a => a.optionId === 'lordly-presence-boost')).toBe(true);
  });

  test('non-diplomat without ring (Aragorn): Lordly Presence boost not offered', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [ARAGORN],
      site: BREE,
      hand: [LORDLY_PRESENCE, RANGERS_OF_THE_NORTH],
      factionDefId: RANGERS_OF_THE_NORTH,
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions.some(a => a.optionId === 'lordly-presence-boost')).toBe(false);
  });

  // ── Rules 3 & 4: natural diplomat gets +3 direct influence; ring-only diplomat does not ──

  function orgBase(bearerDefId: CardDefinitionId) {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [bearerDefId] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN === bearerDefId ? FRODO : ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
  }

  test('a natural diplomat bearer (Frodo) gains +3 direct influence', () => {
    const state = recomputeDerived(attachItemToChar(orgBase(FRODO), RESOURCE_PLAYER, FRODO, MAGIC_RING_OF_WORDS));
    const frodo = getCharacter(state, RESOURCE_PLAYER, FRODO);
    expect(frodo.effectiveStats.directInfluence).toBe(4); // 1 + 3
  });

  test('a non-diplomat bearer (Aragorn) gains no direct-influence bonus, despite being granted the diplomat skill', () => {
    const state = recomputeDerived(attachItemToChar(orgBase(ARAGORN), RESOURCE_PLAYER, ARAGORN, MAGIC_RING_OF_WORDS));
    const aragorn = getCharacter(state, RESOURCE_PLAYER, ARAGORN);
    expect(aragorn.effectiveStats.directInfluence).toBe(3); // unchanged — the +3 gate reads natural skills only
  });

  // ── Rule 5: cannot be duplicated on a given character ────────────────────

  test('a character already bearing a copy is not offered a second one after the gold-ring test', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [FRODO] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const withExistingRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, MAGIC_RING_OF_WORDS);
    const withGoldRing = attachItemToChar(withExistingRing, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const goldRingId = withGoldRing.players[RESOURCE_PLAYER].characters[aragornId].items
      .find(i => i.definitionId === PRECIOUS_GOLD_RING)!.instanceId;
    const withHand = addCardToHand(withGoldRing, RESOURCE_PLAYER, MAGIC_RING_OF_WORDS);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, goldRingId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 3 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(0);
  });
});
