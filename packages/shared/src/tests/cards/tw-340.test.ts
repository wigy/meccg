/**
 * @module tw-340.test
 *
 * Card test: Test of Lore (tw-340)
 * Type: hero-resource-event (short, alignment: wizard), non-unique, 0 MP
 *
 * "Sage only. Play to test a gold ring in a sage's company; subtract one from
 * the result of the roll."
 *
 * Test of Lore is Test of Form (tw-338) / Test of Fire (le-239) with a −1
 * roll modifier: same play-window, play-target, and legal-action crossing of
 * (sage × gold ring borne in that sage's company), but the queued
 * `gold-ring-test` carries `rollModifier: -1` instead of 0, so the 2d6 result
 * is one lower before it is checked against the tested ring's own
 * `ring-test-table`.
 *
 * Engine support:
 * | # | Rule                                                     | Status      | Notes                                                        |
 * |---|-----------------------------------------------------------|-------------|--------------------------------------------------------------|
 * | 1 | Playable during the organization phase                    | IMPLEMENTED | play-window phase:organization                               |
 * | 2 | Sage only — a sage must be in the ring's company           | IMPLEMENTED | play-target filter target.skills $includes sage              |
 * | 3 | Requires a gold ring in that sage's company                | IMPLEMENTED | (sage × gold ring) crossing; not playable otherwise          |
 * | 4 | No tap cost — the sage is NOT tapped                       | IMPLEMENTED | play-target carries no cost                                  |
 * | 5 | Playing enqueues the gold-ring test with a −1 modifier     | IMPLEMENTED | enqueue-gold-ring-test rollModifier: -1                      |
 * | 6 | The roll is 2d6 − 1, and the ring is discarded regardless  | IMPLEMENTED | rollModifier -1 folded into the pending resolution's total   |
 * | 7 | The modified total maps to categories via the ring's table | IMPLEMENTED | ring-test-table consulted with the modified total            |
 *
 * Fixture alignment: hero (wizard) — hero characters, hero sites, hero rings.
 *
 * Character fixtures:
 *   - BILBO   (tw-131): hobbit, scout+sage — the sage
 *   - FRODO   (tw-152): hobbit, scout+diplomat — a non-sage companion / bearer
 *   - ARAGORN (tw-120): opponent dummy
 *
 * Ring fixtures:
 *   - PRECIOUS_GOLD_RING (tw-306): gold-ring; table = lesser any, magic 1–5,
 *       dwarven 8+, the-one-ring 10+
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  BILBO, FRODO, ARAGORN, PRECIOUS_GOLD_RING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  Phase, CardStatus,
  buildTestState, resetMint, makeSitePhase,
  findCharInstanceId, viableActions,
  getCharacter, dispatch, dispatchResult,
  rollGoldRingTest, ringPlayOffer,
  expectCharStatus, expectCharItemCount, expectInDiscardPile,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, GameState, PlayShortEventAction } from '../../index.js';

const TEST_OF_LORE = 'tw-340' as CardDefinitionId;

/** Bilbo (sage) + Frodo (bearing the Precious Gold Ring) at Rivendell. */
const SAGE_COMPANY: Parameters<typeof buildTestState>[0] = {
  activePlayer: PLAYER_1,
  phase: Phase.Organization,
  recompute: true,
  players: [
    {
      id: PLAYER_1,
      companies: [{ site: RIVENDELL, characters: [BILBO, { defId: FRODO, items: [PRECIOUS_GOLD_RING] }] }],
      hand: [TEST_OF_LORE],
      siteDeck: [MORIA],
    },
    { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
  ],
};

describe('Test of Lore (tw-340)', () => {
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO, FRODO] }], hand: [TEST_OF_LORE], siteDeck: [MORIA] },
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
          hand: [TEST_OF_LORE],
          siteDeck: [MORIA],
        },
        SAGE_COMPANY.players[1],
      ],
    });

    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
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

  // ── Rule 5: playing enqueues the gold-ring test with a −1 modifier ────────

  test('playing discards the event and enqueues a gold-ring test with rollModifier -1', () => {
    const state = buildTestState(SAGE_COMPANY);
    const ringId = getCharacter(state, RESOURCE_PLAYER, FRODO).items[0].instanceId;
    const frodoId = findCharInstanceId(state, RESOURCE_PLAYER, FRODO);

    const afterPlay = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);

    expect(afterPlay.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(afterPlay, RESOURCE_PLAYER, TEST_OF_LORE);

    const pending = afterPlay.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('gold-ring-test');
    if (pending[0].kind.type !== 'gold-ring-test') return;
    expect(pending[0].kind.goldRingInstanceId).toBe(ringId);
    expect(pending[0].kind.characterInstanceId).toBe(frodoId);
    // Test of Lore subtracts one from the roll (unlike Test of Form's 0).
    expect(pending[0].kind.rollModifier).toBe(-1);

    expectCharItemCount(afterPlay, RESOURCE_PLAYER, FRODO, 1);
  });

  // ── Rules 6–7: the roll is 2d6 − 1 and maps via the ring's own table ──────

  test('rolling the test applies the -1 modifier and discards the gold ring regardless of result', () => {
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

  test('a raw roll of 6 (modified total 5) opens the magic-ring band that an unmodified 6 would miss', () => {
    // Precious Gold Ring's table: magic-ring 1-5, dwarven-ring 8+, the-one-ring
    // 10+, lesser-ring any. A raw 6 alone would land outside the magic band
    // (1-5); Test of Lore's -1 pulls the checked total down to 5, inside it.
    const state = buildTestState(SAGE_COMPANY);
    const afterPlay = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);
    const afterRoll = rollGoldRingTest(afterPlay, PLAYER_1, 6);

    const offer = ringPlayOffer(afterRoll, PLAYER_1);
    expect(offer.eligibleCategories).toContain('magic-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('dwarven-ring');
    expect(offer.eligibleCategories).not.toContain('the-one-ring');
  });

  test('a raw roll of 11 (modified total 10) opens the-one-ring band', () => {
    const state = buildTestState(SAGE_COMPANY);
    const afterPlay = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);
    const afterRoll = rollGoldRingTest(afterPlay, PLAYER_1, 11);

    const offer = ringPlayOffer(afterRoll, PLAYER_1);
    expect(offer.eligibleCategories).toContain('the-one-ring');
    expect(offer.eligibleCategories).toContain('dwarven-ring');
    expect(offer.eligibleCategories).toContain('lesser-ring');
    expect(offer.eligibleCategories).not.toContain('magic-ring');
  });

  test('the player may pass the offer — the gold ring stays discarded', () => {
    const state = buildTestState(SAGE_COMPANY);
    const afterPlay = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);
    const afterRoll = rollGoldRingTest(afterPlay, PLAYER_1, 3);

    const passes = viableActions(afterRoll, PLAYER_1, 'pass');
    expect(passes.length).toBeGreaterThanOrEqual(1);
    const afterPass = dispatch(afterRoll, passes[0].action);

    expect(afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
    expectInDiscardPile(afterPass, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
    expectCharItemCount(afterPass, RESOURCE_PLAYER, FRODO, 0);
  });
});
