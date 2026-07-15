/**
 * @module le-239.test
 *
 * Card test: Test of Fire (le-239)
 * Type: minion-resource-event (short, alignment: ringwraith)
 *
 * "Sage only. Play to test a gold ring in a sage's company."
 *
 * Test of Fire is the active, roll-based gold-ring test (Rule 6.2): the sage's
 * company must hold a gold ring; playing the event runs the full test on the
 * chosen gold ring — 2d6 roll, the gold ring's own `ring-test-table` maps the
 * total to the eligible ring categories, the ring is discarded, and the player
 * may replace it with a matching special ring from hand.
 *
 * Engine support:
 * | # | Rule                                                     | Status      | Notes                                                       |
 * |---|----------------------------------------------------------|-------------|-------------------------------------------------------------|
 * | 1 | Playable during the organization phase                   | IMPLEMENTED | play-window phase:organization                              |
 * | 2 | Sage only — a sage must share the gold ring's company    | IMPLEMENTED | play-target filter target.skills:sage (crossed with rings)  |
 * | 3 | Requires a gold ring in the sage's company               | IMPLEMENTED | (sage × gold ring) crossing; not playable otherwise         |
 * | 4 | No tap cost — the sage is NOT tapped                      | IMPLEMENTED | play-target has no cost                                     |
 * | 5 | One action per gold ring (deduped across sages)          | IMPLEMENTED | legal-action emitter offers each ring once                 |
 * | 6 | Playing the card enqueues a full gold-ring-test          | IMPLEMENTED | enqueue-gold-ring-test → gold-ring-test pending resolution  |
 * | 7 | The test rolls 2d6 (rollModifier 0) and discards ring    | IMPLEMENTED | gold-ring-test-roll; ring to discard pile                  |
 * | 8 | Roll total maps to eligible categories via the ring      | IMPLEMENTED | ring-test-table → ring-play-offer eligibleCategories        |
 * | 9 | A matching special ring may replace the gold ring        | IMPLEMENTED | play-ring-after-test attaches ring to the former bearer     |
 * |10 | The player may pass and play no ring                     | IMPLEMENTED | pass clears the ring-play-offer                            |
 *
 * Fixture alignment: minion (ringwraith) — minion characters + minion gold ring
 * from the LE set. (Following le-226 Secrets of Their Forging, the shared ring
 * fixtures work under the default test alignment.)
 *
 * Character fixtures:
 *   - HADOR    (le-14): dunadan, warrior+sage — a sage
 *   - CIRYAHER (le-6):  dunadan, scout+sage    — a second sage
 *   - GORBAG   (le-11): orc, warrior           — a non-sage companion
 *
 * Ring fixtures:
 *   - LEAST_OF_GOLD_RINGS (le-315): subtype gold-ring, ring-test-table
 *       (lesser-ring any, magic-ring 1-7, dwarven-ring 10+, the-one-ring 12+)
 *   - MINOR_RING          (le-324): subtype special, keyword lesser-ring
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  attachItemToChar, addCardToHand,
  dispatch, dispatchResult, viableActions, RESOURCE_PLAYER,
  findCharInstanceId, getCharacter,
  expectCharStatus, expectInDiscardPile,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction } from '../../index.js';

// ── Card under test ──────────────────────────────────────────────────────────
const TEST_OF_FIRE = 'le-239' as CardDefinitionId;

// ── Minion characters ────────────────────────────────────────────────────────
const HADOR = 'le-14' as CardDefinitionId;       // warrior+sage
const CIRYAHER = 'le-6' as CardDefinitionId;     // scout+sage
const GORBAG = 'le-11' as CardDefinitionId;      // warrior (no sage skill)

// ── Sites ────────────────────────────────────────────────────────────────────
const DIMRILL_DALE = 'le-365' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const ETTENMOORS = 'le-373' as CardDefinitionId;

// ── Ring items ───────────────────────────────────────────────────────────────
const LEAST_OF_GOLD_RINGS = 'le-315' as CardDefinitionId; // gold-ring, ring-test-table
const MINOR_RING = 'le-324' as CardDefinitionId;          // special, lesser-ring

/** Build an organization-phase state with the resource player's company. */
function buildOrgState(characters: CardDefinitionId[]): ReturnType<typeof buildTestState> {
  return buildTestState({
    activePlayer: PLAYER_1,
    recompute: true,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: DIMRILL_DALE, characters }],
        hand: [],
        siteDeck: [ETTENMOORS],
      },
      {
        id: PLAYER_2,
        companies: [{ site: DOL_GULDUR, characters: [GORBAG] }],
        hand: [],
        siteDeck: [DIMRILL_DALE],
      },
    ],
  });
}

describe('Test of Fire (le-239)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1-4: playability gating ─────────────────────────────────────────

  test('offered during organization phase when a sage shares the gold ring company', () => {
    const base = buildOrgState([HADOR]);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, TEST_OF_FIRE);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBeGreaterThanOrEqual(1);
    const action = plays[0].action as PlayShortEventAction;
    // The gold ring is carried on the action; no sage is tapped (no scout target).
    expect(action.targetGoldRingInstanceId).toBeTruthy();
    expect(action.targetScoutInstanceId).toBeFalsy();
  });

  test('not offered when the company has no gold ring', () => {
    const base = buildOrgState([HADOR]);
    const withCard = addCardToHand(base, RESOURCE_PLAYER, TEST_OF_FIRE);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(0);
  });

  test('not offered when no sage is in the ring-bearing company', () => {
    const base = buildOrgState([GORBAG]);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, TEST_OF_FIRE);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(0);
  });

  test('a gold ring borne by a non-sage in the sage company is testable', () => {
    // Gorbag (non-sage) carries the ring; Hador (sage) authorizes the test.
    const base = buildOrgState([HADOR, GORBAG]);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, GORBAG, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, TEST_OF_FIRE);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(1);
    const gorbagRingId = getCharacter(withCard, RESOURCE_PLAYER, GORBAG).items[0].instanceId;
    expect((plays[0].action as PlayShortEventAction).targetGoldRingInstanceId).toBe(gorbagRingId);
  });

  // ── Rule 4: no tap cost — the sage stays untapped ─────────────────────────

  test('playing the card does NOT tap the sage', () => {
    const base = buildOrgState([HADOR]);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, TEST_OF_FIRE);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withCard, plays[0].action);

    expectCharStatus(afterPlay, RESOURCE_PLAYER, HADOR, CardStatus.Untapped);
  });

  // ── Rule 5: one action per gold ring (deduped across sages) ───────────────

  test('two gold rings in the company emit two actions targeting distinct rings', () => {
    const base = buildOrgState([HADOR, GORBAG]);
    const withRing1 = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withRing2 = attachItemToChar(withRing1, RESOURCE_PLAYER, GORBAG, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing2, RESOURCE_PLAYER, TEST_OF_FIRE);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(2);
    const ringIds = plays.map(p => (p.action as PlayShortEventAction).targetGoldRingInstanceId);
    expect(new Set(ringIds).size).toBe(2);
  });

  test('two sages and one ring emit a single action (the ring is offered once)', () => {
    // Unlike Secrets of Their Forging (which taps a sage, one action per sage),
    // Test of Fire taps nothing, so the same ring is offered exactly once.
    const base = buildOrgState([HADOR, CIRYAHER]);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, TEST_OF_FIRE);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    expect(plays.length).toBe(1);
  });

  // ── Rule 6: playing the card enqueues the full gold-ring test ─────────────

  test('playing the card discards the event and enqueues a gold-ring-test on the ring', () => {
    const base = buildOrgState([HADOR]);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, TEST_OF_FIRE);
    const ringId = getCharacter(withCard, RESOURCE_PLAYER, HADOR).items[0].instanceId;
    const hadorId = findCharInstanceId(withCard, RESOURCE_PLAYER, HADOR);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withCard, plays[0].action);

    // Event card leaves hand → discard pile.
    expect(afterPlay.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(afterPlay, RESOURCE_PLAYER, TEST_OF_FIRE);

    // A gold-ring-test pending resolution is enqueued for the chosen ring/bearer.
    const pending = afterPlay.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending).toHaveLength(1);
    expect(pending[0].kind.type).toBe('gold-ring-test');
    if (pending[0].kind.type !== 'gold-ring-test') return;
    expect(pending[0].kind.goldRingInstanceId).toBe(ringId);
    expect(pending[0].kind.characterInstanceId).toBe(hadorId);
    expect(pending[0].kind.rollModifier).toBe(0);

    // The gold ring is still borne until the test is rolled.
    expect(getCharacter(afterPlay, RESOURCE_PLAYER, HADOR).items).toHaveLength(1);
  });

  // ── Rules 7-8: rolling the test discards the ring and offers categories ───

  test('rolling the test discards the gold ring and offers table-eligible categories', () => {
    const base = buildOrgState([HADOR]);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, TEST_OF_FIRE);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withCard, plays[0].action);

    const rollActions = viableActions(afterPlay, PLAYER_1, 'gold-ring-test-roll');
    expect(rollActions).toHaveLength(1);

    // Roll total 7 on The Least of Gold Rings → lesser-ring (any) + magic-ring (1-7).
    const rolled = dispatchResult({ ...afterPlay, cheatRollTotal: 7 }, rollActions[0].action);
    expect(rolled.effects?.some(e => e.effect === 'dice-roll')).toBe(true);
    // Gold ring discarded regardless of outcome.
    expectInDiscardPile(rolled.state, RESOURCE_PLAYER, LEAST_OF_GOLD_RINGS);
    expect(getCharacter(rolled.state, RESOURCE_PLAYER, HADOR).items).toHaveLength(0);

    const offer = rolled.state.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(offer).toHaveLength(1);
    expect(offer[0].kind.type).toBe('ring-play-offer');
    if (offer[0].kind.type !== 'ring-play-offer') return;
    expect(offer[0].kind.eligibleCategories).toContain('lesser-ring');
    expect(offer[0].kind.eligibleCategories).toContain('magic-ring');
    expect(offer[0].kind.eligibleCategories).not.toContain('dwarven-ring');
  });

  // ── Rule 9: a matching special ring may replace the gold ring ─────────────

  test('a matching special ring in hand can be played onto the former ring bearer', () => {
    const base = buildOrgState([HADOR]);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, TEST_OF_FIRE);
    const withMinorRing = addCardToHand(withCard, RESOURCE_PLAYER, MINOR_RING);
    const hadorId = findCharInstanceId(withMinorRing, RESOURCE_PLAYER, HADOR);

    const plays = viableActions(withMinorRing, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withMinorRing, plays[0].action);
    const afterRoll = dispatch(
      { ...afterPlay, cheatRollTotal: 7 },
      viableActions(afterPlay, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    // Minor Ring (lesser-ring) is always eligible.
    const playActions = viableActions(afterRoll, PLAYER_1, 'play-ring-after-test');
    expect(playActions.length).toBeGreaterThanOrEqual(1);

    const afterPlayRing = dispatch(afterRoll, playActions[0].action);
    // The Minor Ring moves from hand onto Hador (who bore the gold ring).
    expect(afterPlayRing.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === MINOR_RING)).toBeUndefined();
    expect(
      afterPlayRing.players[RESOURCE_PLAYER].characters[hadorId].items.find(i => i.definitionId === MINOR_RING),
    ).toBeDefined();
  });

  // ── Rule 10: the player may pass ──────────────────────────────────────────

  test('the player may pass the ring-play-offer, playing no replacement ring', () => {
    const base = buildOrgState([HADOR]);
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, HADOR, LEAST_OF_GOLD_RINGS);
    const withCard = addCardToHand(withRing, RESOURCE_PLAYER, TEST_OF_FIRE);

    const plays = viableActions(withCard, PLAYER_1, 'play-short-event');
    const afterPlay = dispatch(withCard, plays[0].action);
    const afterRoll = dispatch(
      { ...afterPlay, cheatRollTotal: 7 },
      viableActions(afterPlay, PLAYER_1, 'gold-ring-test-roll')[0].action,
    );

    const passes = viableActions(afterRoll, PLAYER_1, 'pass');
    expect(passes.length).toBeGreaterThanOrEqual(1);
    const afterPass = dispatch(afterRoll, passes[0].action);

    // No pending resolutions remain; the gold ring stayed discarded.
    expect(afterPass.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
    expectInDiscardPile(afterPass, RESOURCE_PLAYER, LEAST_OF_GOLD_RINGS);
  });
});
