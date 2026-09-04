/**
 * @module tw-339.test
 *
 * Card test: Test of Form (tw-339)
 * Type: hero-resource-event (short, alignment: wizard), non-unique, 0 MP
 *
 * "Sage only. Play to test a gold ring in a sage's company."
 *
 * tw-339 is an alternate-art reprint of Test of Form (tw-338, image
 * TestofForm.jpg vs TestofForm2.jpg here) — identical card text and rules,
 * confirmed against the authoritative card database (same `text`, same
 * `attributes.subtype`, different `image`/`rarity`/`artist`). It is the hero
 * counterpart of Test of Fire (le-239): the active, roll-based gold-ring test
 * of Rule 6.2. Playing it runs the full test on a chosen gold ring borne by a
 * character in a sage's company — 2d6 (no roll modifier), the tested gold
 * ring's own `ring-test-table` maps the total to the eligible ring
 * categories, the gold ring is discarded regardless of result, and an
 * eligible special ring may immediately replace it on its former bearer.
 *
 * Unlike the Wizard tap-test (Gandalf tw-156's `test-gold-ring` granted
 * action) this route costs no tap at all — the sage merely authorizes the
 * test.
 *
 * Engine support:
 * | # | Rule                                                   | Status      | Notes                                                        |
 * |---|--------------------------------------------------------|-------------|--------------------------------------------------------------|
 * | 1 | Playable during the organization phase                 | IMPLEMENTED | play-window phase:organization                               |
 * | 2 | Sage only — a sage must be in the ring's company       | IMPLEMENTED | play-target filter target.skills $includes sage              |
 * | 3 | Requires a gold ring in that sage's company            | IMPLEMENTED | (sage × gold ring) crossing; not playable otherwise          |
 * | 4 | No tap cost — the sage is NOT tapped                   | IMPLEMENTED | play-target carries no cost                                  |
 * | 5 | One action per gold ring (deduped across sages)        | IMPLEMENTED | legal-action emitter offers each ring exactly once           |
 * | 6 | Playing enqueues the full gold-ring test               | IMPLEMENTED | enqueue-gold-ring-test → gold-ring-test pending resolution   |
 * | 7 | The test rolls 2d6 unmodified and discards the ring    | IMPLEMENTED | rollModifier 0; ring to discard pile on the roll             |
 * | 8 | The roll maps to categories via the tested ring's table| IMPLEMENTED | ring-test-table → ring-play-offer eligibleCategories         |
 * | 9 | A matching special ring may replace the gold ring      | IMPLEMENTED | play-ring-after-test attaches it to the former bearer        |
 * |10 | The player may decline and play no ring                | IMPLEMENTED | pass clears the ring-play-offer                              |
 *
 * Fixture alignment: hero (wizard) — hero characters, hero sites, hero rings.
 * No Wizard is used in any fixture, so the only route to a test is this card
 * (a Wizard would contribute a competing `test-gold-ring` granted action).
 *
 * Character fixtures:
 *   - BILBO   (tw-131): hobbit, scout+sage — the sage
 *   - BALIN   (tw-123): dwarf, warrior+sage — a second sage
 *   - FRODO   (tw-152): hobbit, scout+diplomat — a non-sage companion / bearer
 *   - ARAGORN (tw-120): opponent dummy
 *
 * Ring fixtures:
 *   - PRECIOUS_GOLD_RING (tw-306): gold-ring; table = lesser any, magic 1–5,
 *       dwarven 8+, the-one-ring 10+
 *   - LESSER_RING (tw-266), MAGIC_RING_STEALTH (tw-274), DWARVEN_RING (tw-213):
 *       special rings carrying their category keyword
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  BILBO, BALIN, FRODO, ARAGORN, PRECIOUS_GOLD_RING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase, CardStatus,
  buildTestState, resetMint, makeSitePhase,
  findCharInstanceId, viableActions,
  attachItemToChar, addCardToHand,
  getCharacter, dispatch, dispatchResult,
  rollGoldRingTest, ringPlayOffer, offeredRingInstanceIds,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, PlayShortEventAction } from '../../index.js';

const TEST_OF_FORM = 'tw-339' as CardDefinitionId;
const LESSER_RING = 'tw-266' as CardDefinitionId;
const MAGIC_RING_STEALTH = 'tw-274' as CardDefinitionId;
const DWARVEN_RING = 'tw-213' as CardDefinitionId;

/** Bilbo (sage) + Frodo (bearing the Precious Gold Ring) at Rivendell. */
const SAGE_COMPANY: Parameters<typeof buildTestState>[0] = {
  activePlayer: PLAYER_1,
  phase: Phase.Organization,
  recompute: true,
  players: [
    {
      id: PLAYER_1,
      companies: [{ site: RIVENDELL, characters: [BILBO, { defId: FRODO, items: [PRECIOUS_GOLD_RING] }] }],
      hand: [TEST_OF_FORM],
      siteDeck: [MORIA],
    },
    { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
  ],
};

describe('Test of Form (tw-339)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–3: playability gating ─────────────────────────────────────────

  test('offered during the organization phase when a sage shares the gold ring company', () => {
    const state = buildTestState(SAGE_COMPANY);
    const ringId = getCharacter(state, RESOURCE_PLAYER, FRODO).items[0].instanceId;

    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(1);
    expect((plays[0].action as PlayShortEventAction).targetGoldRingInstanceId).toBe(ringId);
  });

  test('not offered when the sage company holds no gold ring', () => {
    const state = buildTestState({
      ...SAGE_COMPANY,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO, FRODO] }], hand: [TEST_OF_FORM], siteDeck: [MORIA] },
        SAGE_COMPANY.players[1],
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('not offered when the ring-bearing company has no sage', () => {
    const state = buildTestState({
      ...SAGE_COMPANY,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: FRODO, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [TEST_OF_FORM],
          siteDeck: [MORIA],
        },
        SAGE_COMPANY.players[1],
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('a gold ring in another company of the same player is not testable', () => {
    // Bilbo (the sage) travels alone; the gold ring sits in a second, sage-less
    // company. "In a sage's company" is a company-scoped requirement.
    const state = buildTestState({
      ...SAGE_COMPANY,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [BILBO] },
            { site: MORIA, characters: [{ defId: FRODO, items: [PRECIOUS_GOLD_RING] }] },
          ],
          hand: [TEST_OF_FORM],
          siteDeck: [MINAS_TIRITH],
        },
        SAGE_COMPANY.players[1],
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('a gold ring borne by a non-sage in the sage company is testable', () => {
    // Frodo (no sage skill) carries the ring; Bilbo's presence authorizes it.
    const state = buildTestState(SAGE_COMPANY);
    const frodoRingId = getCharacter(state, RESOURCE_PLAYER, FRODO).items[0].instanceId;

    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect((plays[0].action as PlayShortEventAction).targetGoldRingInstanceId).toBe(frodoRingId);
  });

  test('not offered during the site phase (organization play-window only)', () => {
    const base = buildTestState(SAGE_COMPANY);
    const inSitePhase: GameState = { ...base, phaseState: makeSitePhase() };

    expect(viableActions(inSitePhase, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  // ── Rule 4: no tap cost ───────────────────────────────────────────────────

  test('playing the card taps nobody — neither the sage nor the ring bearer', () => {
    const state = buildTestState(SAGE_COMPANY);
    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect((plays[0].action as PlayShortEventAction).targetScoutInstanceId).toBeFalsy();

    const afterPlay = dispatch(state, plays[0].action);

    expectCharStatus(afterPlay, RESOURCE_PLAYER, BILBO, CardStatus.Untapped);
    expectCharStatus(afterPlay, RESOURCE_PLAYER, FRODO, CardStatus.Untapped);
  });

  // ── Rule 5: one action per gold ring ──────────────────────────────────────

  test('two gold rings in the sage company emit two actions targeting distinct rings', () => {
    const base = buildTestState(SAGE_COMPANY);
    const state = attachItemToChar(base, RESOURCE_PLAYER, BILBO, PRECIOUS_GOLD_RING);

    const plays = viableActions(state, PLAYER_1, 'play-short-event');
    expect(plays).toHaveLength(2);
    const ringIds = plays.map(p => (p.action as PlayShortEventAction).targetGoldRingInstanceId);
    expect(new Set(ringIds).size).toBe(2);
  });

  test('two sages and one ring still emit a single action (the ring is offered once)', () => {
    const state = buildTestState({
      ...SAGE_COMPANY,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [BILBO, BALIN, { defId: FRODO, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [TEST_OF_FORM],
          siteDeck: [MORIA],
        },
        SAGE_COMPANY.players[1],
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(1);
  });

  // ── Rule 6: playing enqueues the gold-ring test ───────────────────────────

  test('playing discards the event and enqueues an unmodified gold-ring test on the ring', () => {
    const state = buildTestState(SAGE_COMPANY);
    const ringId = getCharacter(state, RESOURCE_PLAYER, FRODO).items[0].instanceId;
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);

    const afterPlay = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);

    expect(afterPlay.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(afterPlay, RESOURCE_PLAYER, TEST_OF_FORM);

    const pending = afterPlay.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('gold-ring-test');
    if (pending[0].kind.type !== 'gold-ring-test') return;
    expect(pending[0].kind.goldRingInstanceId).toBe(ringId);
    // The test resolves on the ring's bearer, not on the authorizing sage.
    expect(pending[0].kind.characterInstanceId).toBe(frodoId);
    // Test of Form adds nothing to the roll (unlike Test of Lore's −1).
    expect(pending[0].kind.rollModifier).toBe(0);

    // The gold ring stays borne until the test is actually rolled.
    expectCharItemCount(afterPlay, RESOURCE_PLAYER, FRODO, 1);
  });

  // ── Rules 7–8: the roll discards the ring and consults its own table ──────

  test('rolling the test rolls 2d6 and discards the gold ring regardless of result', () => {
    const state = buildTestState(SAGE_COMPANY);
    const afterPlay = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);

    const rolls = viableActions(afterPlay, PLAYER_1, 'gold-ring-test-roll');
    expect(rolls).toHaveLength(1);
    const result = dispatchResult({ ...afterPlay, cheatRollTotal: 6 }, rolls[0].action);

    const roll = result.state.players[RESOURCE_PLAYER].lastDiceRoll;
    expect(roll!.die1 + roll!.die2).toBe(6);
    expect(result.effects!.some(e => e.effect === 'dice-roll')).toBe(true);
    expectInDiscardPile(result.state, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
    expectCharItemCount(result.state, RESOURCE_PLAYER, FRODO, 0);
  });

  test('roll 4 offers the Precious Gold Ring table bands for a low result', () => {
    const state = buildTestState(SAGE_COMPANY);
    const afterPlay = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);
    const afterRoll = rollGoldRingTest(afterPlay, PLAYER_1, 4);

    const offer = ringPlayOffer(afterRoll, PLAYER_1);
    expect(offer.eligibleCategories).toContain('magic-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('dwarven-ring');
    expect(offer.eligibleCategories).not.toContain('the-one-ring');
  });

  test('roll 10 opens the high bands of the tested ring — the one ring included', () => {
    const state = buildTestState(SAGE_COMPANY);
    const afterPlay = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);
    const afterRoll = rollGoldRingTest(afterPlay, PLAYER_1, 10);

    const offer = ringPlayOffer(afterRoll, PLAYER_1);
    expect(offer.eligibleCategories).toContain('the-one-ring');
    expect(offer.eligibleCategories).toContain('dwarven-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('magic-ring');
  });

  // ── Rule 9: an eligible ring in hand replaces the tested gold ring ────────

  test('an eligible ring in hand is offered and attaches to the former bearer', () => {
    const withRings = addCardToHand(
      addCardToHand(buildTestState(SAGE_COMPANY), RESOURCE_PLAYER, MAGIC_RING_STEALTH),
      RESOURCE_PLAYER, DWARVEN_RING,
    );
    const magicId = withRings.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MAGIC_RING_STEALTH)!.instanceId;
    const dwarvenId = withRings.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DWARVEN_RING)!.instanceId;
    const frodoId = findCharInstanceId(withRings, RESOURCE_PLAYER, FRODO);

    const afterPlay = dispatch(withRings, viableActions(withRings, PLAYER_1, 'play-short-event')[0].action);
    const afterRoll = rollGoldRingTest(afterPlay, PLAYER_1, 4);

    // On a 4 only the magic-ring band is open; the Dwarven Ring stays in hand.
    const offered = offeredRingInstanceIds(afterRoll, PLAYER_1);
    expect(offered).toContain(magicId);
    expect(offered).not.toContain(dwarvenId);

    const plays = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    const afterPlayRing = dispatch(afterRoll, plays.find(p => p.action.type === 'play-ring-after-test')!.action);

    expect(afterPlayRing.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === MAGIC_RING_STEALTH)).toBe(false);
    // The replacement lands on Frodo (who bore the gold ring), not on the sage.
    const frodoItems = afterPlayRing.players[RESOURCE_PLAYER].characters[frodoId].items;
    expect(frodoItems.map(i => i.definitionId)).toEqual([MAGIC_RING_STEALTH]);
    expectCharItemCount(afterPlayRing, RESOURCE_PLAYER, BILBO, 0);
  });

  // ── Rule 10: the offer may be declined ────────────────────────────────────

  test('the player may pass the offer — the gold ring stays discarded, the ring stays in hand', () => {
    const withRing = addCardToHand(buildTestState(SAGE_COMPANY), RESOURCE_PLAYER, LESSER_RING);
    const afterPlay = dispatch(withRing, viableActions(withRing, PLAYER_1, 'play-short-event')[0].action);
    const afterRoll = rollGoldRingTest(afterPlay, PLAYER_1, 2);

    const passes = viableActions(afterRoll, PLAYER_1, 'pass');
    expect(passes.length).toBeGreaterThanOrEqual(1);
    const afterPass = dispatch(afterRoll, passes[0].action);

    expect(afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
    expect(afterPass.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === LESSER_RING)).toBe(true);
    expectInDiscardPile(afterPass, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
    expectCharItemCount(afterPass, RESOURCE_PLAYER, FRODO, 0);
  });
});
