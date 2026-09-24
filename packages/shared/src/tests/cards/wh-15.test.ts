/**
 * @module wh-15.test
 *
 * Card test: Cast from the Order (wh-15)
 * Type: hazard-event (permanent, played on a Fallen-wizard)
 *
 * Printed text:
 *   "Playable on a Fallen-wizard. Make a roll and add the Fallen-wizard's
 *    stage points. If the result is less than 16, discard this card.
 *    Otherwise, place this card with the Fallen-wizard. The Fallen-wizard's
 *    player must use minion sites for Border-holds [{B}], Free-holds [{F}],
 *    and hero Havens [{H}]. Also, the Fallen-wizard's company is overt."
 *
 * Card shape (data): 4 effects —
 *   1. play-target character, filter `target.race = fallen-wizard`
 *   2. on-event self-enters-play → win-condition-roll, rollModifiers:
 *      ["stage-points"], bands: `{ lt: 16, outcome: discard-self }`,
 *      `{ gte: 16, outcome: keep }`
 *   3. fw-site-alignment-restriction require:minion
 *      siteTypes:[border-hold, free-hold, haven] (unconditional — unlike
 *      Heart Grown Cold wh-21, no stage-point gating)
 *   4. company-overt
 *
 * Engine support:
 * | # | Feature                                  | Status      | Notes                                              |
 * |---|-------------------------------------------|-------------|-----------------------------------------------------|
 * | 1 | Playable only on a Fallen-wizard           | IMPLEMENTED | play-hazard target filter on `target.race`         |
 * | 2 | Roll + stage points, <16 discards this card| IMPLEMENTED | win-condition-roll reused beyond win cards, new     |
 * |   |                                             |             | `stage-points` roll modifier                        |
 * | 3 | >=16 keeps the card attached               | IMPLEMENTED | win-condition-roll `keep` outcome                   |
 * | 4 | Discard-self works from the hazard slot    | IMPLEMENTED | discardSourceFromAvatar now checks `hazards` too    |
 * |   |                                             |             | (previously items-only, for resource event cards)   |
 * | 5 | Must use minion sites for B/F/H            | IMPLEMENTED | fw-site-alignment-restriction now also scans        |
 * |   |                                             |             | character-attached hazards, not just cardsInPlay    |
 * | 6 | Fallen-wizard's company is overt           | IMPLEMENTED | isCovertCompany now also checks attached hazards    |
 * |   |                                             |             | for `company-overt`, alongside allies               |
 *
 * Playable: YES
 * Certified: 2026-09-24
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachHazardToChar, addCardInPlay, movementDestinationDefIds, viableActions,
  makeMHState, findCharInstanceId, dispatch, resolveChain,
  expectInDiscardPile,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  LEGOLAS, RIVENDELL, BREE, LORIEN,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import { isCovertCompany } from '../../engine/reducer-utils.js';
import type { CardDefinitionId, PlayHazardAction } from '../../index.js';

const CAST_FROM_THE_ORDER = 'wh-15' as CardDefinitionId;
/** Gandalf the Fallen-wizard: race fallen-wizard. */
const GANDALF_FW = 'wh-4' as CardDefinitionId;
/** Isengard, a Fallen-wizard Wizardhaven (site deck filler). */
const ISENGARD_WH = 'wh-56' as CardDefinitionId;
/** Plotting Ruin: `stage-points value: 3` — used to give the Fallen-wizard a real, recompute-stable stage-point total. */
const PLOTTING_RUIN = 'wh-79' as CardDefinitionId;

const ETTENMOORS = 'le-373' as CardDefinitionId;        // minion R&L, Rhudaur — the FW origin
const MINION_RIVENDELL = 'as-160' as CardDefinitionId;  // minion free-hold (hero tw-421/RIVENDELL is a Haven)
const MINION_BREE = 'le-356' as CardDefinitionId;       // minion border-hold (hero BREE)

/**
 * A Fallen-wizard MH-phase state with Gandalf (and optionally an Orc) at
 * Ettenmoors, wh-15 in the opponent's hand. `player.stagePoints` is a
 * *derived* field recomputed from actual stage cards in play after every
 * dispatched action (`recomputeDerived`'s `playerStagePoints`) — a one-off
 * field mutation would be wiped out by the very first `play-hazard`/
 * `pass-chain-priority` dispatch in `resolveChain`'s multi-step resolution.
 * Stage points requested here are therefore backed by real copies of
 * Plotting Ruin (wh-79, 3 stage points each) in `cardsInPlay`, so the total
 * survives every recompute along the way. Only multiples of 3 are supported.
 */
function baseState(opts: { stagePoints?: number; companions?: CardDefinitionId[] } = {}) {
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.FallenWizard,
        companies: [{ site: ETTENMOORS, characters: [GANDALF_FW, ...(opts.companions ?? [])] }],
        hand: [],
        siteDeck: [ISENGARD_WH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [CAST_FROM_THE_ORDER],
        siteDeck: [RIVENDELL],
      },
    ],
  });
  const points = opts.stagePoints ?? 0;
  if (points % 3 !== 0) throw new Error('baseState only supports stage-point totals divisible by 3 (Plotting Ruin grants 3 each)');
  for (let i = 0; i < points / 3; i++) {
    state = addCardInPlay(state, RESOURCE_PLAYER, PLOTTING_RUIN);
  }
  return state;
}

/** Play wh-15 on Gandalf and resolve the chain with a forced dice-total (pre-stage-points-modifier). */
function playWithRoll(state: ReturnType<typeof baseState>, diceTotal: number) {
  const ready = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }), cheatRollTotal: diceTotal };
  const actions = viableActions(ready, PLAYER_2, 'play-hazard');
  expect(actions.length).toBeGreaterThanOrEqual(1);
  return resolveChain(dispatch(ready, actions[0].action));
}

describe('Cast from the Order (wh-15)', () => {
  beforeEach(() => resetMint());

  // ─── Rule: playable on a Fallen-wizard ──────────────────────────────────────

  test('offered as a hazard play only on the Fallen-wizard, not on companions', () => {
    const state = baseState({ companions: [LEGOLAS] });
    const ready = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const targets = viableActions(ready, PLAYER_2, 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    expect(targets).toEqual([findCharInstanceId(ready, RESOURCE_PLAYER, GANDALF_FW)]);
  });

  test('not offered at all when no Fallen-wizard is in the target company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: ETTENMOORS, characters: [LEGOLAS] }], hand: [], siteDeck: [ISENGARD_WH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAST_FROM_THE_ORDER], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toEqual([]);
  });

  // ─── Rule: roll + stage points determines discard-self vs. keep ────────────

  test('total < 16 discards the card; the Fallen-wizard survives untouched', () => {
    const state = baseState({ stagePoints: 6 });
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW);

    // Dice total 9 + 6 stage points = 15 < 16 → discard-self.
    const after = playWithRoll(state, 9);

    expect(after.players[RESOURCE_PLAYER].characters[gandalfId].hazards).toHaveLength(0);
    expectInDiscardPile(after, HAZARD_PLAYER, CAST_FROM_THE_ORDER);
  });

  test('total >= 16 keeps the card attached to the Fallen-wizard', () => {
    const state = baseState({ stagePoints: 6 });
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF_FW);

    // Dice total 10 + 6 stage points = 16 >= 16 → keep.
    const after = playWithRoll(state, 10);

    expect(after.players[RESOURCE_PLAYER].characters[gandalfId].hazards
      .some(h => h.definitionId === CAST_FROM_THE_ORDER)).toBe(true);
    expect(after.players[HAZARD_PLAYER].discardPile
      .some(c => c.definitionId === CAST_FROM_THE_ORDER)).toBe(false);
  });

  test('stage points are the deciding modifier: same dice roll, different stage points', () => {
    // Dice total 10, no stage points: 10 < 16 → discard-self.
    const withoutSp = playWithRoll(baseState({ stagePoints: 0 }), 10);
    const gandalfWithoutSp = findCharInstanceId(withoutSp, RESOURCE_PLAYER, GANDALF_FW);
    expect(withoutSp.players[RESOURCE_PLAYER].characters[gandalfWithoutSp].hazards).toHaveLength(0);

    // Dice total 10, 6 stage points: 16 >= 16 → keep.
    const withSp = playWithRoll(baseState({ stagePoints: 6 }), 10);
    const gandalfWithSp = findCharInstanceId(withSp, RESOURCE_PLAYER, GANDALF_FW);
    expect(withSp.players[RESOURCE_PLAYER].characters[gandalfWithSp].hazards
      .some(h => h.definitionId === CAST_FROM_THE_ORDER)).toBe(true);
  });

  // ─── Rule: must use minion sites for Border-holds, Free-holds, hero Havens ──

  test('once attached, the hero Haven card is unusable — even at 0 stage points', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 0,
          companies: [{ site: ETTENMOORS, characters: [GANDALF_FW] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, CAST_FROM_THE_ORDER, HAZARD_PLAYER);

    // No minion Rivendell in the location deck — the site becomes unreachable.
    expect(movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER)).not.toContain(RIVENDELL);
  });

  test('once attached, a hero Border-hold is also locked unconditionally', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          stagePoints: 0,
          companies: [{ site: ETTENMOORS, characters: [GANDALF_FW] }],
          hand: [],
          siteDeck: [MINION_BREE, BREE],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, CAST_FROM_THE_ORDER, HAZARD_PLAYER);

    const destinations = movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER);
    expect(destinations).toContain(MINION_BREE);
    expect(destinations).not.toContain(BREE);
  });

  test('when the deck holds both versions of the Haven, the minion card is the one used', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ETTENMOORS, characters: [GANDALF_FW] }],
          hand: [],
          siteDeck: [MINION_RIVENDELL, RIVENDELL],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });
    const state = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, CAST_FROM_THE_ORDER, HAZARD_PLAYER);

    const destinations = movementDestinationDefIds(state, PLAYER_1, RESOURCE_PLAYER);
    expect(destinations).toContain(MINION_RIVENDELL);
    expect(destinations).not.toContain(RIVENDELL);
  });

  // ─── Rule: the Fallen-wizard's company is overt ─────────────────────────────

  test('without the card, the Fallen-wizard company (no Orc/Troll) is covert', () => {
    const base = baseState({});
    const company = base.players[RESOURCE_PLAYER].companies[0];
    expect(isCovertCompany(company, base.players[RESOURCE_PLAYER], base)).toBe(true);
  });

  test('once attached, the Fallen-wizard company is overt', () => {
    const base = baseState({});
    const state = attachHazardToChar(base, RESOURCE_PLAYER, GANDALF_FW, CAST_FROM_THE_ORDER, HAZARD_PLAYER);
    const company = state.players[RESOURCE_PLAYER].companies[0];
    expect(isCovertCompany(company, state.players[RESOURCE_PLAYER], state)).toBe(false);
  });
});
