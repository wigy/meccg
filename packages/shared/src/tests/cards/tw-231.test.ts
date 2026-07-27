/**
 * @module tw-231.test
 *
 * Card test: Fair Gold Ring (tw-231)
 * Type: hero-resource-item (subtype: gold-ring, alignment: wizard)
 * Corruption: 1, Marshalling Points: 1, non-unique
 *
 * "Discard Fair Gold Ring when tested. If tested, make a roll to determine
 *  which ring card may be immediately played: The One Ring (11,12+);
 *  a Dwarven Ring (9,10,11,12+); a Magic Ring (1,2,3,4,5,6);
 *  a Lesser Ring (any result)."
 *
 * Engine support:
 * | # | Rule                                          | Status      | Notes                                                          |
 * |---|-----------------------------------------------|-------------|----------------------------------------------------------------|
 * | 1 | +1 corruption point on bearer                 | IMPLEMENTED | itemDef.corruptionPoints summed by recomputeDerived            |
 * | 2 | Discard the ring when tested                  | IMPLEMENTED | applyGoldRingTestResolution discards on the roll               |
 * | 3 | Roll determines which ring may be played      | IMPLEMENTED | ring-test-table → eligibleRingCategories → ring-play-offer     |
 * | 4 | The One Ring on 11+                           | IMPLEMENTED | ring-test-table row min:11                                     |
 * | 5 | A Dwarven Ring on 9+                          | IMPLEMENTED | ring-test-table row min:9                                      |
 * | 6 | A Magic Ring on 1–6                           | IMPLEMENTED | ring-test-table row min:1 max:6                                |
 * | 7 | A Lesser Ring on any result                   | IMPLEMENTED | ring-test-table row min:null max:null                          |
 * | 8 | "immediately played"                          | IMPLEMENTED | play-ring-after-test attaches the ring to the former bearer    |
 * | 9 | No deck/discard search clause                 | IMPLEMENTED | no ring-test-search — ring-play-offer has no searchCategories  |
 *
 * Fair Gold Ring is the middle rung of the TW hero gold-ring ladder: its bands
 * sit one pip harder than Precious Gold Ring (tw-306: One Ring 10+, Dwarven 8+,
 * Magic 1–5) and one pip easier than Beautiful Gold Ring (tw-196: One Ring 12+,
 * Dwarven 10+, Magic 1–7). The band gap that is unique to this card is 7–8:
 * both totals fall above the Magic band (max 6) and below the Dwarven minimum
 * (9), so only a Lesser Ring may be played.
 *
 * The hero route to a test is a Wizard tapping to test a gold ring in his
 * company (Gandalf tw-156's `grant-action test-gold-ring`), which applies
 * `enqueue-gold-ring-test` and so resolves through the shared `gold-ring-test`
 * resolution — the only path that reads this ring's own `ring-test-table`.
 *
 * Fixture alignment: hero (wizard) — hero characters, hero sites, hero rings.
 *
 * Character fixtures:
 *   - GANDALF (tw-156): Wizard, taps to test a gold ring in his company
 *   - FRODO (tw-152):   ring bearer
 *   - ARAGORN (tw-120): opponent dummy
 *
 * Ring fixtures (special rings, category keyword on the card):
 *   - THE_ONE_RING (tw-347):       keyword the-one-ring, unique
 *   - DWARVEN_RING (tw-213):       keyword dwarven-ring, unique
 *   - MAGIC_RING_STEALTH (tw-274): keyword magic-ring
 *   - LESSER_RING (tw-266):        keyword lesser-ring
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  GANDALF, FRODO, ARAGORN,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase, CardStatus,
  buildTestState, resetMint,
  findCharInstanceId, viableActions,
  attachItemToChar, addCardToHand, addCardToPlayDeck,
  getCharacter, dispatch, dispatchResult,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
  testGoldRingViaWizard, ringPlayOffer, offeredRingInstanceIds,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type { CardDefinitionId } from '../../index.js';

const FAIR_GOLD_RING = 'tw-231' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;
const DWARVEN_RING = 'tw-213' as CardDefinitionId;
const MAGIC_RING_STEALTH = 'tw-274' as CardDefinitionId;
const LESSER_RING = 'tw-266' as CardDefinitionId;

/** Gandalf + Frodo (bearing the Fair Gold Ring) at Rivendell, Aragorn opposite. */
const RING_COMPANY: Parameters<typeof buildTestState>[0] = {
  activePlayer: PLAYER_1,
  phase: Phase.Organization,
  recompute: true,
  players: [
    {
      id: PLAYER_1,
      companies: [{ site: RIVENDELL, characters: [GANDALF, { defId: FRODO, items: [FAIR_GOLD_RING] }] }],
      hand: [],
      siteDeck: [MORIA],
    },
    { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
  ],
};

describe('Fair Gold Ring (tw-231)', () => {
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

    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, FRODO, FAIR_GOLD_RING));
    expect(withRing.players[RESOURCE_PLAYER].characters[frodoId].effectiveStats.corruptionPoints).toBe(1);
  });

  // ── Rule 1: "Discard Fair Gold Ring when tested." ──────────────────────────

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
    const afterRoll = testGoldRingViaWizard(buildTestState(RING_COMPANY), PLAYER_1, 7);

    expectCharItemCount(afterRoll, RESOURCE_PLAYER, FRODO, 0);
    expectInDiscardPile(afterRoll, RESOURCE_PLAYER, FAIR_GOLD_RING);
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
    const offer = ringPlayOffer(testGoldRingViaWizard(buildTestState(RING_COMPANY), PLAYER_1, 1), PLAYER_1);
    expect(offer.eligibleCategories).toContain('magic-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('dwarven-ring');
    expect(offer.eligibleCategories).not.toContain('the-one-ring');
  });

  test('roll 6: magic-ring still eligible (top of its 1–6 band)', () => {
    const offer = ringPlayOffer(testGoldRingViaWizard(buildTestState(RING_COMPANY), PLAYER_1, 6), PLAYER_1);
    expect(offer.eligibleCategories).toContain('magic-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('dwarven-ring');
    expect(offer.eligibleCategories).not.toContain('the-one-ring');
  });

  test('roll 7: past the magic-ring band, short of dwarven — lesser only', () => {
    const offer = ringPlayOffer(testGoldRingViaWizard(buildTestState(RING_COMPANY), PLAYER_1, 7), PLAYER_1);
    expect(offer.eligibleCategories).toEqual(['lesser-ring']);
  });

  test('roll 8: still lesser-ring only (this ring needs 9 for a Dwarven Ring)', () => {
    const offer = ringPlayOffer(testGoldRingViaWizard(buildTestState(RING_COMPANY), PLAYER_1, 8), PLAYER_1);
    expect(offer.eligibleCategories).toEqual(['lesser-ring']);
  });

  test('roll 9: dwarven-ring becomes eligible; the-one-ring does not', () => {
    const offer = ringPlayOffer(testGoldRingViaWizard(buildTestState(RING_COMPANY), PLAYER_1, 9), PLAYER_1);
    expect(offer.eligibleCategories).toContain('dwarven-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('the-one-ring');
    expect(offer.eligibleCategories).not.toContain('magic-ring');
  });

  test('roll 10: dwarven-ring eligible, the-one-ring still one short of its minimum', () => {
    const offer = ringPlayOffer(testGoldRingViaWizard(buildTestState(RING_COMPANY), PLAYER_1, 10), PLAYER_1);
    expect(offer.eligibleCategories).toContain('dwarven-ring');
    expect(offer.eligibleCategories).not.toContain('the-one-ring');
  });

  test('roll 11: the-one-ring becomes eligible', () => {
    const offer = ringPlayOffer(testGoldRingViaWizard(buildTestState(RING_COMPANY), PLAYER_1, 11), PLAYER_1);
    expect(offer.eligibleCategories).toContain('the-one-ring');
    expect(offer.eligibleCategories).toContain('dwarven-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('magic-ring');
  });

  test('roll 12: every high-band category eligible; magic-ring still excluded', () => {
    const offer = ringPlayOffer(testGoldRingViaWizard(buildTestState(RING_COMPANY), PLAYER_1, 12), PLAYER_1);
    expect(offer.eligibleCategories).toContain('the-one-ring');
    expect(offer.eligibleCategories).toContain('dwarven-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('magic-ring');
  });

  // ── Rule 8: an eligible ring in hand may be played immediately ────────────

  test('The One Ring in hand is offered on a roll of 11', () => {
    const state = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, THE_ONE_RING);
    const afterRoll = testGoldRingViaWizard(state, PLAYER_1, 11);

    const oneRingId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === THE_ONE_RING)!.instanceId;
    expect(offeredRingInstanceIds(afterRoll, PLAYER_1)).toContain(oneRingId);
  });

  test('The One Ring in hand is NOT offered on a roll of 10 (below its minimum of 11)', () => {
    const state = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, THE_ONE_RING);
    const afterRoll = testGoldRingViaWizard(state, PLAYER_1, 10);

    expect(offeredRingInstanceIds(afterRoll, PLAYER_1)).toHaveLength(0);
  });

  test('roll 9 offers a Dwarven Ring from hand but not a Magic Ring', () => {
    const withDwarven = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, DWARVEN_RING);
    const state = addCardToHand(withDwarven, RESOURCE_PLAYER, MAGIC_RING_STEALTH);
    const afterRoll = testGoldRingViaWizard(state, PLAYER_1, 9);

    const dwarvenId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DWARVEN_RING)!.instanceId;
    const magicId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING_STEALTH)!.instanceId;
    expect(offeredRingInstanceIds(afterRoll, PLAYER_1)).toContain(dwarvenId);
    expect(offeredRingInstanceIds(afterRoll, PLAYER_1)).not.toContain(magicId);
  });

  test('roll 8 offers neither a Dwarven Ring nor a Magic Ring from hand', () => {
    // The 7–8 gap is what distinguishes this ring from tw-306 (dwarven 8+) and
    // tw-196 (magic 1–7): on an 8 neither band applies.
    const withDwarven = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, DWARVEN_RING);
    const state = addCardToHand(withDwarven, RESOURCE_PLAYER, MAGIC_RING_STEALTH);
    const afterRoll = testGoldRingViaWizard(state, PLAYER_1, 8);

    expect(offeredRingInstanceIds(afterRoll, PLAYER_1)).toHaveLength(0);
  });

  test('roll 6 offers a Magic Ring from hand but not a Dwarven Ring', () => {
    const withDwarven = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, DWARVEN_RING);
    const state = addCardToHand(withDwarven, RESOURCE_PLAYER, MAGIC_RING_STEALTH);
    const afterRoll = testGoldRingViaWizard(state, PLAYER_1, 6);

    const dwarvenId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DWARVEN_RING)!.instanceId;
    const magicId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING_STEALTH)!.instanceId;
    expect(offeredRingInstanceIds(afterRoll, PLAYER_1)).toContain(magicId);
    expect(offeredRingInstanceIds(afterRoll, PLAYER_1)).not.toContain(dwarvenId);
  });

  test('a Lesser Ring in hand is offered on any result — even a 2', () => {
    const state = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, LESSER_RING);
    const afterRoll = testGoldRingViaWizard(state, PLAYER_1, 2);

    const lesserId = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === LESSER_RING)!.instanceId;
    expect(offeredRingInstanceIds(afterRoll, PLAYER_1)).toContain(lesserId);
  });

  test('playing the offered ring attaches it to the former gold-ring bearer', () => {
    const state = addCardToHand(buildTestState(RING_COMPANY), RESOURCE_PLAYER, THE_ONE_RING);
    const afterRoll = testGoldRingViaWizard(state, PLAYER_1, 12);

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
    const afterRoll = testGoldRingViaWizard(state, PLAYER_1, 4);

    const passes = viableActions(afterRoll, PLAYER_1, 'pass');
    expect(passes.length).toBe(1);
    const afterPass = dispatch(afterRoll, passes[0].action);

    expect(afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
    expect(afterPass.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === LESSER_RING)).toBe(true);
    expectCharItemCount(afterPass, RESOURCE_PLAYER, FRODO, 0);
  });

  // ── Rule 9: no search clause on this ring ────────────────────────────────

  test('the offer carries no searchCategories (this ring has no search clause)', () => {
    const offer = ringPlayOffer(testGoldRingViaWizard(buildTestState(RING_COMPANY), PLAYER_1, 11), PLAYER_1);
    expect(offer.searchCategories).toBeUndefined();
  });

  test('an eligible Lesser Ring sitting in the play deck is not offered', () => {
    const state = addCardToPlayDeck(buildTestState(RING_COMPANY), RESOURCE_PLAYER, LESSER_RING);
    const afterRoll = testGoldRingViaWizard(state, PLAYER_1, 4);

    expect(offeredRingInstanceIds(afterRoll, PLAYER_1)).toHaveLength(0);
  });
});
