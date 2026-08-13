/**
 * @module tw-271.test
 *
 * Card test: Magic Ring of Courage (tw-271)
 * Type: hero-resource-item (subtype: special)
 * Keywords: ring, magic-ring
 *
 * "Magic Ring. Playable only with a gold ring and after a test indicates a
 *  Magic Ring. Gives the bearer warrior skill. If the bearer is already a
 *  warrior, he gets +2 to prowess. May not be duplicated on a given
 *  character."
 *
 * Engine support:
 * | # | Feature                                              | Status      | Notes                                            |
 * |---|-------------------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Eligible as ring-test replacement for matching roll  | IMPLEMENTED | keyword magic-ring matched against test table    |
 * | 2 | Gives the bearer warrior skill                       | IMPLEMENTED | grant-skill effect + getEffectiveSkills()         |
 * | 3 | Natural warrior gets +2 prowess                      | IMPLEMENTED | stat-modifier with when bearer.naturalSkills      |
 * | 4 | Bearer who is only a warrior via the ring gets no +2 | IMPLEMENTED | when condition reads natural skills only          |
 * | 5 | Cannot be duplicated on a given character            | IMPLEMENTED | duplication-limit scope:character max:1           |
 *
 * Rule 1 also fixes a data bug: tw-271 carried only the `ring` keyword, not
 * `magic-ring`, so the gold-ring test's ring-play-offer path (which matches a
 * hand card's keywords against the rolled RingCategory) could never have
 * offered it.
 *
 * Rule 3/4 needed a new context field: `stat-modifier`'s `when` is evaluated
 * against the effective-stats context, where `bearer.skills` is merged with
 * every item's granted skills — including this ring's own `grant-skill`. A
 * naive `{ "bearer.skills": { "$includes": "warrior" } }` gate would then
 * always be true once the ring is in play, regardless of whether the bearer
 * was a warrior beforehand. `bearer.naturalSkills` (printed skills only,
 * `recompute-derived.ts`'s `buildEffectiveStatsContext`) fixes this — mirrors
 * the existing `requiresNaturalSkill` convention on `item-slot-modifier`.
 *
 * Character selection:
 * - ARAGORN (tw-120): warrior+scout+ranger, prowess 6 — natural warrior, used
 *   for Rule 3 (the +2 prowess bonus) and Rule 5 (duplication limit).
 * - FRODO (tw-152): scout+diplomat, prowess 1, NOT a warrior — used for Rule 2
 *   (grant-skill observable via targeting) and Rule 4 (no +2 bonus).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, PlayShortEventAction } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, FRODO,
  MEN_OF_LEBENNIN, PELARGIR,
  MORIA, LORIEN, MINAS_TIRITH, RIVENDELL,
  Phase,
  buildTestState, buildInfluenceAttemptChainState, resetMint, recomputeDerived, getCharacter,
  findCharInstanceId, viableActions, dispatch,
  attachItemToChar, addCardToHand,
  RESOURCE_PLAYER,
  enqueueGoldRingTest,
} from '../test-helpers.js';

const MAGIC_RING_OF_COURAGE = 'tw-271' as CardDefinitionId;
const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;
// "Warrior only" short event with a play-target filter on target.skills
// $includes warrior, playable only in response to a live influence attempt.
const MUSTER = 'tw-288' as CardDefinitionId;

describe('Magic Ring of Courage (tw-271)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: gold-ring-test eligibility (also exercises the magic-ring keyword fix) ──

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
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_COURAGE);

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
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_COURAGE);

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
    const withHand = addCardToHand(withRing, RESOURCE_PLAYER, MAGIC_RING_OF_COURAGE);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, ringId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 4 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playAction = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')[0].action;
    const afterPlay = dispatch(afterRoll, playAction);

    expect(afterPlay.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING_OF_COURAGE)).toBeUndefined();
    expect(
      afterPlay.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === MAGIC_RING_OF_COURAGE),
    ).toBeDefined();
  });

  // ── Rule 2: gives the bearer warrior skill ───────────────────────────────

  test('non-warrior bearer (Frodo) counts as warrior for Muster targeting when ring is held', () => {
    // Frodo (tw-152) is scout+diplomat, not a warrior. With the ring he should
    // satisfy Muster's warrior filter (`target.skills.$includes.warrior`).
    // Muster is only playable in response to a live influence attempt, so the
    // fixture declares one (Men of Lebennin at Pelargir) before checking.
    const built = buildInfluenceAttemptChainState({
      characters: [FRODO],
      site: PELARGIR,
      hand: [MUSTER, MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });
    const state = attachItemToChar(built, RESOURCE_PLAYER, FRODO, MAGIC_RING_OF_COURAGE);

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions.some(a => a.optionId === 'influence-boost')).toBe(true);
  });

  test('non-warrior without ring (Frodo): Muster influence-boost not offered', () => {
    const state = buildInfluenceAttemptChainState({
      characters: [FRODO],
      site: PELARGIR,
      hand: [MUSTER, MEN_OF_LEBENNIN],
      factionDefId: MEN_OF_LEBENNIN,
    });

    const actions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions.some(a => a.optionId === 'influence-boost')).toBe(false);
  });

  // ── Rules 3 & 4: natural warrior gets +2 prowess; ring-only warrior does not ──

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

  test('a natural warrior bearer (Aragorn) gains +2 prowess', () => {
    const state = recomputeDerived(attachItemToChar(orgBase(ARAGORN), RESOURCE_PLAYER, ARAGORN, MAGIC_RING_OF_COURAGE));
    const aragorn = getCharacter(state, RESOURCE_PLAYER, ARAGORN);
    expect(aragorn.effectiveStats.prowess).toBe(8); // 6 + 2
  });

  test('a non-warrior bearer (Frodo) gains no prowess bonus, despite being granted the warrior skill', () => {
    const state = recomputeDerived(attachItemToChar(orgBase(FRODO), RESOURCE_PLAYER, FRODO, MAGIC_RING_OF_COURAGE));
    const frodo = getCharacter(state, RESOURCE_PLAYER, FRODO);
    expect(frodo.effectiveStats.prowess).toBe(1); // unchanged — the +2 gate reads natural skills only
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
    const withExistingRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, MAGIC_RING_OF_COURAGE);
    const withGoldRing = attachItemToChar(withExistingRing, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const goldRingId = withGoldRing.players[RESOURCE_PLAYER].characters[aragornId].items
      .find(i => i.definitionId === PRECIOUS_GOLD_RING)!.instanceId;
    const withHand = addCardToHand(withGoldRing, RESOURCE_PLAYER, MAGIC_RING_OF_COURAGE);

    const withPending = enqueueGoldRingTest(withHand, PLAYER_1, goldRingId, aragornId);
    const afterRoll = dispatch(
      { ...withPending, cheatRollTotal: 3 },
      viableActions(withPending, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions).toHaveLength(0);
  });
});
