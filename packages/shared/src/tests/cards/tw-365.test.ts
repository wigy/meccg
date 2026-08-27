/**
 * @module tw-365.test
 *
 * Card test: Wizard's Test (tw-365)
 * Type: hero-resource-event (short, keyword: spell, alignment: wizard)
 *
 * "Spell. Wizard only, and only if a character in his company has a gold ring.
 *  Play to test a gold ring; make two rolls and choose one result to use for
 *  the test. Wizard makes a corruption check modified by -1."
 *
 * The card is the Wizard's own route into the Rule 9.21 gold-ring test — the
 * same shared `gold-ring-test` pending resolution the Darkhaven auto-test,
 * Gandalf's tap-test and Test of Fire (le-239) use — with two twists: the test
 * makes **two** rolls and the player picks which total the ring's
 * `ring-test-table` is read with, and the Wizard pays for the spell with a
 * corruption check at -1. Unlike Rule 9.21's tap-test, no character is tapped.
 *
 * Engine support:
 * | # | Rule                                                       | Status      | Notes                                                        |
 * |---|------------------------------------------------------------|-------------|--------------------------------------------------------------|
 * | 1 | Spell — counts as a spell card for cards keyed to spells   | IMPLEMENTED | `keywords: ["spell"]`, read as `source.keywords` by the check |
 * | 2 | Wizard only                                                | IMPLEMENTED | play-target character filter `target.race: wizard`            |
 * | 3 | Only if a character in HIS company has a gold ring         | IMPLEMENTED | (wizard × gold ring in his company) crossing in the emitter   |
 * | 4 | Playable during any phase of the Wizard's turn              | IMPLEMENTED | no play-window — CoE rule 2.1.1 default (resource short-events are legal in any phase of their own turn unless restricted) |
 * | 5 | No tap cost — the Wizard is not tapped                     | IMPLEMENTED | play-target has no cost                                       |
 * | 6 | Play to test a gold ring                                   | IMPLEMENTED | on-event self-enters-play → enqueue-gold-ring-test            |
 * | 7 | Make two rolls                                             | IMPLEMENTED | `rollCount: 2` — one gold-ring-test-roll action per roll      |
 * | 8 | Choose one result to use for the test                      | IMPLEMENTED | choose-gold-ring-test-roll per distinct total → ring table    |
 * | 9 | The gold ring is discarded by the test                     | IMPLEMENTED | shared gold-ring-test finalization (once the result is set)   |
 * |10 | A matching special ring may replace it                     | IMPLEMENTED | ring-play-offer → play-ring-after-test                        |
 * |11 | Wizard makes a corruption check modified by -1             | IMPLEMENTED | on-event self-enters-play → enqueue-corruption-check (-1)     |
 *
 * Playable: YES
 *
 * Fixture alignment: hero (wizard) — hero characters, hero sites, hero rings.
 *
 * Character fixtures:
 *   - PALLANDO (tw-175): Wizard with no corruption modifiers of his own and no
 *     gold-ring grant-action, so the test observes only this card's rules
 *   - FRODO (tw-152):    ring bearer (a non-Wizard companion)
 *   - ARAGORN (tw-120):  non-Wizard company leader / opponent dummy
 *
 * Ring fixtures:
 *   - PRECIOUS_GOLD_RING (tw-306): gold-ring; table = Lesser any, Magic 1-5,
 *     Dwarven 8+, The One Ring 10+ — so a low total and a high total open
 *     genuinely different rings, which is what makes the choice meaningful
 *   - MAGIC_RING_STEALTH (tw-274): special, keyword magic-ring
 *   - DWARVEN_RING (tw-213):       special, keyword dwarven-ring
 *   - WIZARDS_STAFF (td-170):      +2 to any corruption check required by a spell
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  FRODO, ARAGORN, LEGOLAS, PRECIOUS_GOLD_RING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE,
  Phase, CardStatus,
  buildTestState, resetMint,
  findCharInstanceId, viableActions, getCharacter, makeSitePhase,
  attachItemToChar, addCardToHand, reduce, dispatch, dispatchResult,
  enqueueCorruptionCheck,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type {
  CardDefinitionId, CardInstanceId, GameState,
  PlayShortEventAction, ChooseGoldRingTestRollAction, CorruptionCheckAction,
  PlayRingAfterTestAction,
} from '../../index.js';

// ── Card under test ──────────────────────────────────────────────────────────
const WIZARDS_TEST = 'tw-365' as CardDefinitionId;

// ── Fixtures ─────────────────────────────────────────────────────────────────
const PALLANDO = 'tw-175' as CardDefinitionId;          // Wizard, no own modifiers
const MAGIC_RING_STEALTH = 'tw-274' as CardDefinitionId; // special, magic-ring
const DWARVEN_RING = 'tw-213' as CardDefinitionId;       // special, dwarven-ring
const WIZARDS_STAFF = 'td-170' as CardDefinitionId;      // +2 to spell corruption checks

/**
 * Organization-phase state: the Wizard and Frodo (bearing the Precious Gold
 * Ring) at Rivendell with Wizard's Test in hand; Legolas opposite.
 */
function wizardCompanyWithRing(): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [PALLANDO, { defId: FRODO, items: [PRECIOUS_GOLD_RING] }] }],
        hand: [WIZARDS_TEST],
        siteDeck: [MORIA],
      },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
}

/** The one `play-short-event` action for Wizard's Test, or throw. */
function playAction(state: GameState): PlayShortEventAction {
  const plays = viableActions(state, PLAYER_1, 'play-short-event');
  expect(plays.length).toBe(1);
  return plays[0].action as PlayShortEventAction;
}

/** Play Wizard's Test and make both rolls, cheating in `first` then `second`. */
function playAndRollTwice(state: GameState, first: number, second: number): GameState {
  const afterPlay = dispatch(state, playAction(state));

  const roll1 = viableActions(afterPlay, PLAYER_1, 'gold-ring-test-roll');
  expect(roll1.length).toBe(1);
  const afterFirst = dispatch({ ...afterPlay, cheatRollTotal: first }, roll1[0].action);

  const roll2 = viableActions(afterFirst, PLAYER_1, 'gold-ring-test-roll');
  expect(roll2.length).toBe(1);
  return dispatch({ ...afterFirst, cheatRollTotal: second }, roll2[0].action);
}

/** Resolve the chosen total, returning the state after the test finalizes. */
function chooseTotal(state: GameState, total: number): GameState {
  const choices = viableActions(state, PLAYER_1, 'choose-gold-ring-test-roll')
    .map(a => a.action as ChooseGoldRingTestRollAction);
  const chosen = choices.find(c => c.rollTotal === total);
  expect(chosen).toBeDefined();
  return dispatch(state, chosen!);
}

/** The player's queued pending resolutions, in queue order. */
function pendingKinds(state: GameState): readonly string[] {
  return state.pendingResolutions.filter(r => r.actor === PLAYER_1).map(r => r.kind.type);
}

/** The queued `ring-play-offer` kind for player 1, or throw. */
function ringOffer(state: GameState) {
  const offer = state.pendingResolutions.find(r => r.actor === PLAYER_1 && r.kind.type === 'ring-play-offer');
  if (!offer || offer.kind.type !== 'ring-play-offer') throw new Error('expected a queued ring-play-offer');
  return offer.kind;
}

describe("Wizard's Test (tw-365)", () => {
  beforeEach(() => resetMint());

  // ── Rules 2-5: playability gating ─────────────────────────────────────────

  test('playable in the organization phase on the Wizard, naming the gold ring to test', () => {
    const state = wizardCompanyWithRing();
    const ringId = getCharacter(state, RESOURCE_PLAYER, FRODO).items[0].instanceId;

    const action = playAction(state);
    expect(action.targetGoldRingInstanceId).toBe(ringId);
    // The play-target is the Wizard — he is the one who makes the corruption check.
    expect(action.targetCharacterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, PALLANDO));
    // No tap cost: nothing is offered as a tap target.
    expect(action.targetScoutInstanceId).toBeFalsy();
  });

  test('NOT playable when no Wizard is in the ring-bearing company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, { defId: FRODO, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [WIZARDS_TEST],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT playable when the Wizard company holds no gold ring', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [PALLANDO, FRODO] }],
          hand: [WIZARDS_TEST],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT playable when the gold ring is in another of the player\'s companies', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [PALLANDO] },
            { site: BREE, characters: [{ defId: FRODO, items: [PRECIOUS_GOLD_RING] }] },
          ],
          hand: [WIZARDS_TEST],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('also playable during the site phase (CoE 2.1.1: resource short-events are legal in any phase of the resource player\'s turn)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [PALLANDO, { defId: FRODO, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [WIZARDS_TEST],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(1);
  });

  test('also playable during the long-event phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [PALLANDO, { defId: FRODO, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [WIZARDS_TEST],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(1);
  });

  test('one play action per gold ring in the Wizard company', () => {
    const base = wizardCompanyWithRing();
    const state = attachItemToChar(base, RESOURCE_PLAYER, PALLANDO, PRECIOUS_GOLD_RING);

    const rings = new Set(
      viableActions(state, PLAYER_1, 'play-short-event')
        .map(a => (a.action as PlayShortEventAction).targetGoldRingInstanceId as CardInstanceId),
    );
    expect(rings.size).toBe(2);
    expect(rings).toContain(getCharacter(state, RESOURCE_PLAYER, FRODO).items[0].instanceId);
    expect(rings).toContain(getCharacter(state, RESOURCE_PLAYER, PALLANDO).items[0].instanceId);
  });

  test('playing taps nobody and discards the spent event', () => {
    const state = wizardCompanyWithRing();
    const after = dispatch(state, playAction(state));

    expectCharStatus(after, RESOURCE_PLAYER, PALLANDO, CardStatus.Untapped);
    expectCharStatus(after, RESOURCE_PLAYER, FRODO, CardStatus.Untapped);
    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, WIZARDS_TEST);
  });

  // ── Rules 6-7: the two-roll test ──────────────────────────────────────────

  test('playing queues a two-roll gold-ring test ahead of the Wizard corruption check', () => {
    const state = wizardCompanyWithRing();
    const ringId = getCharacter(state, RESOURCE_PLAYER, FRODO).items[0].instanceId;
    const after = dispatch(state, playAction(state));

    expect(pendingKinds(after)).toEqual(['gold-ring-test', 'corruption-check']);
    const test = after.pendingResolutions[0];
    if (test.kind.type !== 'gold-ring-test') throw new Error('expected gold-ring-test');
    expect(test.kind.goldRingInstanceId).toBe(ringId);
    expect(test.kind.characterInstanceId).toBe(findCharInstanceId(after, RESOURCE_PLAYER, FRODO));
    expect(test.kind.rollCount).toBe(2);
    expect(test.kind.rolledTotals).toBeUndefined();
  });

  test('the test makes two rolls: the first roll is recorded and a second is required', () => {
    const state = wizardCompanyWithRing();
    const afterPlay = dispatch(state, playAction(state));

    const roll1 = viableActions(afterPlay, PLAYER_1, 'gold-ring-test-roll');
    expect(roll1.length).toBe(1);
    const result = dispatchResult({ ...afterPlay, cheatRollTotal: 4 }, roll1[0].action);
    const afterFirst = result.state;

    expect(result.effects!.some(e => e.effect === 'dice-roll')).toBe(true);
    // Still the same resolution, still at the head — the corruption check may
    // not jump the queue between the two rolls.
    expect(pendingKinds(afterFirst)).toEqual(['gold-ring-test', 'corruption-check']);
    const test = afterFirst.pendingResolutions[0];
    if (test.kind.type !== 'gold-ring-test') throw new Error('expected gold-ring-test');
    expect(test.kind.rolledTotals).toEqual([4]);
    // Nothing has been decided yet: the ring is still borne, no offer queued.
    expectCharItemCount(afterFirst, RESOURCE_PLAYER, FRODO, 1);
    // A second roll is the only thing on offer.
    expect(viableActions(afterFirst, PLAYER_1, 'gold-ring-test-roll')).toHaveLength(1);
    expect(viableActions(afterFirst, PLAYER_1, 'choose-gold-ring-test-roll')).toHaveLength(0);
  });

  test('after both rolls the player is offered a choice between the two results', () => {
    const afterRolls = playAndRollTwice(wizardCompanyWithRing(), 4, 9);

    const test = afterRolls.pendingResolutions[0];
    if (test.kind.type !== 'gold-ring-test') throw new Error('expected gold-ring-test');
    expect(test.kind.rolledTotals).toEqual([4, 9]);

    const choices = viableActions(afterRolls, PLAYER_1, 'choose-gold-ring-test-roll')
      .map(a => (a.action as ChooseGoldRingTestRollAction).rollTotal);
    expect(choices.sort((a, b) => a - b)).toEqual([4, 9]);
    // No further rolls, and the ring is still borne until a result is chosen.
    expect(viableActions(afterRolls, PLAYER_1, 'gold-ring-test-roll')).toHaveLength(0);
    expectCharItemCount(afterRolls, RESOURCE_PLAYER, FRODO, 1);
  });

  test('two identical rolls collapse to a single choice', () => {
    const afterRolls = playAndRollTwice(wizardCompanyWithRing(), 7, 7);

    const choices = viableActions(afterRolls, PLAYER_1, 'choose-gold-ring-test-roll')
      .map(a => (a.action as ChooseGoldRingTestRollAction).rollTotal);
    expect(choices).toEqual([7]);

    // Resolving it runs the test on 7: Lesser Ring only (Magic is 1-5, Dwarven 8+).
    const after = dispatch(afterRolls, viableActions(afterRolls, PLAYER_1, 'choose-gold-ring-test-roll')[0].action);
    expect(ringOffer(after).eligibleCategories).toEqual(['lesser-ring']);
  });

  test('a total that was not rolled cannot be chosen', () => {
    const afterRolls = playAndRollTwice(wizardCompanyWithRing(), 4, 9);
    const choice = viableActions(afterRolls, PLAYER_1, 'choose-gold-ring-test-roll')[0]
      .action as ChooseGoldRingTestRollAction;

    const result = reduce(afterRolls, { ...choice, rollTotal: 12 });
    expect(result.error).toBeTruthy();
    expect(pendingKinds(result.state)[0]).toBe('gold-ring-test');
  });

  // ── Rules 8-10: the chosen result drives the test ─────────────────────────

  test('choosing the low result reads the ring table at that total (Magic Ring)', () => {
    const afterRolls = playAndRollTwice(wizardCompanyWithRing(), 4, 9);
    const after = chooseTotal(afterRolls, 4);

    const offer = ringOffer(after);
    expect(offer.rollTotal).toBe(4);
    expect(offer.eligibleCategories).toContain('magic-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('dwarven-ring');
  });

  test('choosing the high result reads the ring table at that total (Dwarven Ring)', () => {
    const afterRolls = playAndRollTwice(wizardCompanyWithRing(), 4, 9);
    const after = chooseTotal(afterRolls, 9);

    const offer = ringOffer(after);
    expect(offer.rollTotal).toBe(9);
    expect(offer.eligibleCategories).toContain('dwarven-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('magic-ring');
  });

  test('the gold ring is discarded once a result is chosen', () => {
    const afterRolls = playAndRollTwice(wizardCompanyWithRing(), 4, 9);
    const after = chooseTotal(afterRolls, 4);

    expectCharItemCount(after, RESOURCE_PLAYER, FRODO, 0);
    expectInDiscardPile(after, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
  });

  test('the chosen result decides which special ring may replace the gold ring', () => {
    let state = wizardCompanyWithRing();
    state = addCardToHand(state, RESOURCE_PLAYER, MAGIC_RING_STEALTH);
    state = addCardToHand(state, RESOURCE_PLAYER, DWARVEN_RING);

    // Choose the low total: the Magic Ring is playable, the Dwarven Ring is not.
    const lowPath = chooseTotal(playAndRollTwice(state, 4, 9), 4);
    const afterLowCheck = dispatch(
      lowPath,
      viableActions(lowPath, PLAYER_1, 'corruption-check')[0].action,
    );
    const lowRings = viableActions(afterLowCheck, PLAYER_1, 'play-ring-after-test')
      .map(a => (a.action as PlayRingAfterTestAction).ringInstanceId);
    const lowDefs = lowRings.map(id => afterLowCheck.players[RESOURCE_PLAYER].hand.find(c => c.instanceId === id)!.definitionId);
    expect(lowDefs).toContain(MAGIC_RING_STEALTH);
    expect(lowDefs).not.toContain(DWARVEN_RING);

    // Same two rolls, the other choice: now the Dwarven Ring is the playable one.
    const highPath = chooseTotal(playAndRollTwice(state, 4, 9), 9);
    const afterHighCheck = dispatch(
      highPath,
      viableActions(highPath, PLAYER_1, 'corruption-check')[0].action,
    );
    const highRings = viableActions(afterHighCheck, PLAYER_1, 'play-ring-after-test')
      .map(a => (a.action as PlayRingAfterTestAction).ringInstanceId);
    const highDefs = highRings.map(id => afterHighCheck.players[RESOURCE_PLAYER].hand.find(c => c.instanceId === id)!.definitionId);
    expect(highDefs).toContain(DWARVEN_RING);
    expect(highDefs).not.toContain(MAGIC_RING_STEALTH);

    // Playing it attaches the replacement ring to the former gold-ring bearer.
    const played = dispatch(
      afterLowCheck,
      viableActions(afterLowCheck, PLAYER_1, 'play-ring-after-test')
        .find(a => (a.action as PlayRingAfterTestAction).ringInstanceId === lowRings[lowDefs.indexOf(MAGIC_RING_STEALTH)])!.action,
    );
    expect(getCharacter(played, RESOURCE_PLAYER, FRODO).items.map(i => i.definitionId)).toEqual([MAGIC_RING_STEALTH]);
  });

  // ── Rule 11: "Wizard makes a corruption check modified by -1" ─────────────

  test('the Wizard — not the ring bearer — makes a corruption check at -1', () => {
    const state = wizardCompanyWithRing();
    const after = dispatch(state, playAction(state));

    const check = after.pendingResolutions[1];
    if (check.kind.type !== 'corruption-check') throw new Error('expected corruption-check');
    expect(check.kind.modifier).toBe(-1);
    expect(check.kind.characterId).toBe(findCharInstanceId(after, RESOURCE_PLAYER, PALLANDO));
  });

  test('the corruption check comes due after the test resolves and applies the -1', () => {
    const afterChoice = chooseTotal(playAndRollTwice(wizardCompanyWithRing(), 4, 9), 4);

    const checks = viableActions(afterChoice, PLAYER_1, 'corruption-check');
    expect(checks).toHaveLength(1);
    // Pallando carries no corruption points and no modifiers of his own:
    // need = CP(0) + 1 - modifier(-1) = 2.
    expect((checks[0].action as CorruptionCheckAction).need).toBe(2);

    const afterCheck = dispatch(afterChoice, checks[0].action);
    expect(pendingKinds(afterCheck)).toEqual(['ring-play-offer']);
  });

  // ── Rule 1: the card is a spell ───────────────────────────────────────────

  test("the check counts as required by a spell — Wizard's Staff applies its +2", () => {
    const base = wizardCompanyWithRing();
    const withStaff = attachItemToChar(base, RESOURCE_PLAYER, PALLANDO, WIZARDS_STAFF);
    const pallandoId = findCharInstanceId(withStaff, RESOURCE_PLAYER, PALLANDO);

    const afterChoice = chooseTotal(playAndRollTwice(withStaff, 4, 9), 4);
    const spellCheck = viableActions(afterChoice, PLAYER_1, 'corruption-check')[0].action as CorruptionCheckAction;
    // Staff CP(2) + 1 - (card -1 + staff's spell bonus +2) = 2.
    expect(spellCheck.need).toBe(2);

    // Control: the same character, the same -1, but a check whose source is not
    // a spell card — the staff's bonus does not apply, so the need is 2 higher.
    const control = enqueueCorruptionCheck(recomputeDerived(withStaff), PLAYER_1, pallandoId, -1);
    const controlCheck = viableActions(control, PLAYER_1, 'corruption-check')[0].action as CorruptionCheckAction;
    expect(controlCheck.need).toBe(spellCheck.need + 2);
  });
});
