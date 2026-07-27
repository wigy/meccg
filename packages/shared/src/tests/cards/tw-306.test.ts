/**
 * @module tw-306.test
 *
 * Card test: Precious Gold Ring (tw-306)
 * Type: hero-resource-item (subtype: gold-ring, alignment: wizard)
 * Corruption: 1, Marshalling Points: 1, non-unique
 *
 * "Discard Precious Gold Ring when tested. If tested, make a roll to determine
 *  which ring card may be immediately played: The One Ring (10,11,12+);
 *  a Dwarven ring (8,9,10,11,12+); a Magic Ring (1,2,3,4,5);
 *  a Lesser Ring (any result)."
 *
 * Engine support:
 * | # | Rule                                          | Status      | Notes                                                          |
 * |---|-----------------------------------------------|-------------|----------------------------------------------------------------|
 * | 1 | +1 corruption point on bearer                 | IMPLEMENTED | itemDef.corruptionPoints summed by recomputeDerived            |
 * | 2 | Discard the ring when tested                  | IMPLEMENTED | applyGoldRingTestResolution discards on the roll               |
 * | 3 | Roll determines which ring may be played      | IMPLEMENTED | ring-test-table → eligibleRingCategories → ring-play-offer     |
 * | 4 | The One Ring on 10+                           | IMPLEMENTED | ring-test-table row min:10                                     |
 * | 5 | A Dwarven Ring on 8+                          | IMPLEMENTED | ring-test-table row min:8                                      |
 * | 6 | A Magic Ring on 1–5                           | IMPLEMENTED | ring-test-table row min:1 max:5                                |
 * | 7 | A Lesser Ring on any result                   | IMPLEMENTED | ring-test-table row min:null max:null                          |
 * | 8 | "immediately played"                          | IMPLEMENTED | play-ring-after-test attaches the ring to the former bearer    |
 * | 9 | No deck/discard search clause                 | IMPLEMENTED | no ring-test-search — ring-play-offer has no searchCategories  |
 *
 * The natural hero route to a test is a Wizard tapping to test a gold ring in
 * his company (Gandalf tw-156's `grant-action test-gold-ring`). That grant now
 * applies `enqueue-gold-ring-test`, so activating it enqueues the shared
 * `gold-ring-test` pending resolution — the same resolution the minion
 * Darkhaven auto-tests and The Under-grottos (dm-39) use. Only that resolution
 * reads the ring's own `ring-test-table`, so routing the Wizard test through it
 * is what makes this card's roll table apply on the hero path.
 *
 * Fixture alignment: hero (wizard) — hero characters, hero sites, hero rings.
 *
 * Character fixtures:
 *   - GANDALF (tw-156): Wizard, taps to test a gold ring in his company
 *   - FRODO (tw-152):   ring bearer
 *   - ARAGORN (tw-120): opponent dummy
 *
 * Ring fixtures (special rings, category keyword on the card):
 *   - THE_ONE_RING (tw-347):      keyword the-one-ring, unique
 *   - DWARVEN_RING (tw-213):      keyword dwarven-ring, unique
 *   - MAGIC_RING_STEALTH (tw-274):keyword magic-ring
 *   - LESSER_RING (tw-266):       keyword lesser-ring
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, FRODO, ARAGORN, PRECIOUS_GOLD_RING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase, CardStatus,
  buildTestState, resetMint,
  findCharInstanceId, viableActions,
  attachItemToChar, addCardToHand, addCardToPlayDeck,
  getCharacter, dispatch, dispatchResult,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId, GameState, PlayRingAfterTestAction } from '../../index.js';

const THE_ONE_RING = 'tw-347' as CardDefinitionId;
const DWARVEN_RING = 'tw-213' as CardDefinitionId;
const MAGIC_RING_STEALTH = 'tw-274' as CardDefinitionId;
const LESSER_RING = 'tw-266' as CardDefinitionId;

/** Gandalf + Frodo (bearing the Precious Gold Ring) at Rivendell, Aragorn opposite. */
const RING_COMPANY: Parameters<typeof buildTestState>[0] = {
  activePlayer: PLAYER_1,
  phase: Phase.Organization,
  recompute: true,
  players: [
    {
      id: PLAYER_1,
      companies: [{ site: RIVENDELL, characters: [GANDALF, { defId: FRODO, items: [PRECIOUS_GOLD_RING] }] }],
      hand: [],
      siteDeck: [MORIA],
    },
    { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
  ],
};

/**
 * Drive the full hero test route: Gandalf activates `test-gold-ring`, then the
 * queued gold-ring test is rolled with `total` cheated in. Returns the state
 * after the roll — the ring is discarded and a `ring-play-offer` is queued.
 */
function testRingWithRoll(state: GameState, total: number): GameState {
  const grants = viableActions(state, PLAYER_1, 'activate-granted-action');
  expect(grants.length).toBe(1);
  const afterActivate = dispatch(state, grants[0].action);

  const rolls = viableActions(afterActivate, PLAYER_1, 'gold-ring-test-roll');
  expect(rolls.length).toBe(1);
  return dispatch({ ...afterActivate, cheatRollTotal: total }, rolls[0].action);
}

/** The `ring-play-offer` queued for player 1, or throw if none is queued. */
function ringOffer(state: GameState) {
  const pending = state.pendingResolutions.filter(r => r.actor === PLAYER_1);
  expect(pending.length).toBe(1);
  if (pending[0].kind.type !== 'ring-play-offer') throw new Error('expected ring-play-offer');
  return pending[0].kind;
}

describe('Precious Gold Ring (tw-306)', () => {
  beforeEach(() => resetMint());

  // ── Corruption: the ring burdens its bearer while held ────────────────────

  test('bearer gains +1 effective corruption point while the ring is held', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const frodoId = findCharInstanceId(base, RESOURCE_PLAYER, FRODO);
    expect(base.players[RESOURCE_PLAYER].characters[frodoId].effectiveStats.corruptionPoints).toBe(0);

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, PRECIOUS_GOLD_RING));
    expect(withRing.players[RESOURCE_PLAYER].characters[frodoId].effectiveStats.corruptionPoints).toBe(1);
  });

  // ── Rule 1: "Discard Precious Gold Ring when tested." ─────────────────────

  test('Gandalf taps to test the ring, which enqueues the gold-ring test', () => {
    const state = buildTestState(RING_COMPANY);
    const ringInstanceId = getCharacter(state, RESOURCE_PLAYER, FRODO).items[0].instanceId;

    const grants = viableActions(state, PLAYER_1, 'activate-granted-action');
    expect(grants.length).toBe(1);
    const afterActivate = dispatch(state, grants[0].action);

    // Gandalf paid the tap cost; the ring is still on Frodo until the roll.
    expectCharStatus(afterActivate, RESOURCE_PLAYER, GANDALF, CardStatus.Tapped);
    expectCharItemCount(afterActivate, RESOURCE_PLAYER, FRODO, 1);

    const pending = afterActivate.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('gold-ring-test');
    if (pending[0].kind.type !== 'gold-ring-test') return;
    expect(pending[0].kind.goldRingInstanceId).toBe(ringInstanceId);
    expect(pending[0].kind.characterInstanceId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, FRODO));
  });

  test('the ring is discarded from its bearer when tested', () => {
    const afterRoll = testRingWithRoll(buildTestState(RING_COMPANY), 7);

    expectCharItemCount(afterRoll, RESOURCE_PLAYER, FRODO, 0);
    expectInDiscardPile(afterRoll, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
  });

  test('testing rolls 2d6 and reports the dice roll', () => {
    const state = buildTestState(RING_COMPANY);
    const grants = viableActions(state, PLAYER_1, 'activate-granted-action');
    const afterActivate = dispatch(state, grants[0].action);
    const rolls = viableActions(afterActivate, PLAYER_1, 'gold-ring-test-roll');

    const result = dispatchResult({ ...afterActivate, cheatRollTotal: 9 }, rolls[0].action);

    const roll = result.state.players[RESOURCE_PLAYER].lastDiceRoll;
    expect(roll).toBeDefined();
    expect(roll!.die1 + roll!.die2).toBe(9);
    expect(result.effects!.some(e => e.effect === 'dice-roll')).toBe(true);
  });

  // ── Rules 4–7: the roll table ────────────────────────────────────────────

  test('roll 1 (minimum modified total): only lesser-ring and magic-ring', () => {
    // A 2d6 cannot total 1 unaided, but a negative modifier can take it there;
    // the boundary still belongs to the magic-ring row (min 1).
    const afterRoll = testRingWithRoll(buildTestState(RING_COMPANY), 1);
    const offer = ringOffer(afterRoll);
    expect(offer.eligibleCategories).toContain('magic-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('dwarven-ring');
    expect(offer.eligibleCategories).not.toContain('the-one-ring');
  });

  test('roll 5: magic-ring still eligible (top of its 1–5 band)', () => {
    const offer = ringOffer(testRingWithRoll(buildTestState(RING_COMPANY), 5));
    expect(offer.eligibleCategories).toContain('magic-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('dwarven-ring');
    expect(offer.eligibleCategories).not.toContain('the-one-ring');
  });

  test('roll 6: magic-ring no longer eligible, dwarven-ring not yet — lesser only', () => {
    const offer = ringOffer(testRingWithRoll(buildTestState(RING_COMPANY), 6));
    expect(offer.eligibleCategories).toEqual(['lesser-ring']);
  });

  test('roll 7: still lesser-ring only (below the dwarven minimum of 8)', () => {
    const offer = ringOffer(testRingWithRoll(buildTestState(RING_COMPANY), 7));
    expect(offer.eligibleCategories).toEqual(['lesser-ring']);
  });

  test('roll 8: dwarven-ring becomes eligible; the-one-ring does not', () => {
    const offer = ringOffer(testRingWithRoll(buildTestState(RING_COMPANY), 8));
    expect(offer.eligibleCategories).toContain('dwarven-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('the-one-ring');
    expect(offer.eligibleCategories).not.toContain('magic-ring');
  });

  test('roll 9: dwarven-ring eligible, the-one-ring still one short of its minimum', () => {
    const offer = ringOffer(testRingWithRoll(buildTestState(RING_COMPANY), 9));
    expect(offer.eligibleCategories).toContain('dwarven-ring');
    expect(offer.eligibleCategories).not.toContain('the-one-ring');
  });

  test('roll 10: the-one-ring becomes eligible (this ring is the cheapest One Ring test)', () => {
    const offer = ringOffer(testRingWithRoll(buildTestState(RING_COMPANY), 10));
    expect(offer.eligibleCategories).toContain('the-one-ring');
    expect(offer.eligibleCategories).toContain('dwarven-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('magic-ring');
  });

  test('roll 12: every high-band category eligible; magic-ring still excluded', () => {
    const offer = ringOffer(testRingWithRoll(buildTestState(RING_COMPANY), 12));
    expect(offer.eligibleCategories).toContain('the-one-ring');
    expect(offer.eligibleCategories).toContain('dwarven-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('magic-ring');
  });

  // ── Rule 8: an eligible ring in hand may be played immediately ────────────

  test('The One Ring in hand is offered on a roll of 10', () => {
    const state = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, THE_ONE_RING);
    const afterRoll = testRingWithRoll(state, 10);

    const plays = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    const oneRingId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === THE_ONE_RING)!.instanceId;
    expect(plays.map(a => (a.action as PlayRingAfterTestAction).ringInstanceId)).toContain(oneRingId);
  });

  test('The One Ring in hand is NOT offered on a roll of 9 (below its minimum of 10)', () => {
    const state = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, THE_ONE_RING);
    const afterRoll = testRingWithRoll(state, 9);

    expect(viableActions(afterRoll, PLAYER_1, 'play-ring-after-test').length).toBe(0);
  });

  test('roll 8 offers a Dwarven Ring from hand but not a Magic Ring', () => {
    const withDwarven = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, DWARVEN_RING);
    const state = addCardToHand(withDwarven, RESOURCE_PLAYER, MAGIC_RING_STEALTH);
    const afterRoll = testRingWithRoll(state, 8);

    const offered = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')
      .map(a => (a.action as PlayRingAfterTestAction).ringInstanceId);
    const dwarvenId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DWARVEN_RING)!.instanceId;
    const magicId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING_STEALTH)!.instanceId;
    expect(offered).toContain(dwarvenId);
    expect(offered).not.toContain(magicId);
  });

  test('roll 4 offers a Magic Ring from hand but not a Dwarven Ring', () => {
    const withDwarven = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, DWARVEN_RING);
    const state = addCardToHand(withDwarven, RESOURCE_PLAYER, MAGIC_RING_STEALTH);
    const afterRoll = testRingWithRoll(state, 4);

    const offered = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')
      .map(a => (a.action as PlayRingAfterTestAction).ringInstanceId);
    const dwarvenId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DWARVEN_RING)!.instanceId;
    const magicId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING_STEALTH)!.instanceId;
    expect(offered).toContain(magicId);
    expect(offered).not.toContain(dwarvenId);
  });

  test('a Lesser Ring in hand is offered on any result — even a 2', () => {
    const state = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, LESSER_RING);
    const afterRoll = testRingWithRoll(state, 2);

    const lesserId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === LESSER_RING)!.instanceId;
    const offered = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test')
      .map(a => (a.action as PlayRingAfterTestAction).ringInstanceId);
    expect(offered).toContain(lesserId);
  });

  test('playing the offered ring attaches it to the former gold-ring bearer', () => {
    const state = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, THE_ONE_RING);
    const afterRoll = testRingWithRoll(state, 11);

    const plays = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(plays.length).toBeGreaterThanOrEqual(1);
    const afterPlay = dispatch(afterRoll, plays[0].action);

    expect(afterPlay.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === THE_ONE_RING)).toBe(false);
    const items = getCharacter(afterPlay, RESOURCE_PLAYER, FRODO).items;
    expect(items).toHaveLength(1);
    expect(items[0].definitionId).toBe(THE_ONE_RING);
  });

  test('the player may decline the offer and play no ring at all', () => {
    const state = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, LESSER_RING);
    const afterRoll = testRingWithRoll(state, 4);

    const passes = viableActions(afterRoll, PLAYER_1, 'pass');
    expect(passes.length).toBe(1);
    const afterPass = dispatch(afterRoll, passes[0].action);

    expect(afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
    expect(afterPass.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === LESSER_RING)).toBe(true);
    expectCharItemCount(afterPass, RESOURCE_PLAYER, FRODO, 0);
  });

  // ── Rule 9: no search clause on this ring ────────────────────────────────

  test('the offer carries no searchCategories (this ring has no search clause)', () => {
    const offer = ringOffer(testRingWithRoll(buildTestState(RING_COMPANY), 10));
    expect(offer.searchCategories).toBeUndefined();
  });

  test('an eligible Lesser Ring sitting in the play deck is not offered', () => {
    const state = addCardToPlayDeck(buildTestState(RING_COMPANY), RESOURCE_PLAYER, LESSER_RING);
    const afterRoll = testRingWithRoll(state, 4);

    expect(viableActions(afterRoll, PLAYER_1, 'play-ring-after-test').length).toBe(0);
  });
});
