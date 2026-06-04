/**
 * @module le-247.test
 *
 * Card test: Under His Blow (le-247)
 * Type: minion-resource-event (short, alignment: ringwraith)
 * Effects: 1
 *
 * "Untapped character does not tap against one strike."
 *
 * `strike-modifier` with `dodge: true` — the target character resolves the
 * strike at full prowess without tapping. Unlike Dodge (tw-209) there is no
 * body penalty if the character is wounded.
 *
 * This tests:
 * 1. play-strike-event action appears during resolve-strike when card is in hand
 * 2. Dodging character does not tap on success
 * 3. When wounded by dodged strike, body check has no penalty (unlike Dodge -1)
 * 4. Card is discarded from hand after use
 * 5. Full prowess used — no -3 untapped-to-fight penalty
 * 6. Card is NOT available outside combat
 *
 * Fixtures:
 *   LAGDUF (le-18)        — minion orc, warrior, prowess 5, body 8
 *   CAVE_DRAKE (tw-020)   — dragon, 2 strikes, prowess 10, keyed wilderness×2/R-&-L
 *   MORIA_MINION (le-392) — minion shadow-hold (travel via wilderness path)
 *   DOL_GULDUR (le-367)   — minion haven
 *   MINAS_MORGUL (le-390) — minion haven
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  CAVE_DRAKE,
  buildTestState, resetMint, Phase,
  makeMHState, playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch, expectCharStatus, expectInDiscardPile,
  resolveChain, RESOURCE_PLAYER, HAZARD_PLAYER, findCharInstanceId,
} from '../test-helpers.js';
import { computeLegalActions, RegionType, SiteType, CardStatus } from '../../index.js';
import type { PlayStrikeEventAction, BodyCheckRollAction, CardDefinitionId } from '../../index.js';

const UNDER_HIS_BLOW = 'le-247' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;         // orc warrior, prowess 5, body 8

const MORIA_MINION = 'le-392' as CardDefinitionId;  // shadow-hold
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // minion haven

/** Build an M/H state with Lagduf at a minion shadow-hold, Cave-Drake in hazard hand. */
function setupMinionCombat(minionHand: readonly CardDefinitionId[]) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [...minionHand], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [CAVE_DRAKE], siteDeck: [MORIA_MINION] },
    ],
  });
  const mhState = makeMHState({
    activeCompanyIndex: 0,
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Hithaeglir', 'Eriador'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  });
  const gameState = { ...base, phaseState: mhState };
  const creatureId = handCardId(gameState, HAZARD_PLAYER);
  const companyId = companyIdAt(gameState, RESOURCE_PLAYER);
  const s0 = playCreatureHazardAndResolve(gameState, PLAYER_2, creatureId, companyId, {
    method: 'region-type',
    value: 'wilderness',
  });
  expect(s0.combat).not.toBeNull();
  return s0;
}

/** Pass the cancel window (P1), then attacker assigns both strikes to Lagduf. */
function assignBothStrikesToLagduf(state: ReturnType<typeof setupMinionCombat>) {
  const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
  let s = dispatch(state, { type: 'pass', player: PLAYER_1 });
  s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: lagdufId });
  s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: lagdufId, excess: true });
  expect(s.combat!.phase).toBe('resolve-strike');
  return s;
}

describe('Under His Blow (le-247)', () => {
  beforeEach(() => resetMint());

  test('play-strike-event appears during resolve-strike when Under His Blow is in hand', () => {
    const s0 = setupMinionCombat([UNDER_HIS_BLOW]);
    const s1 = assignBothStrikesToLagduf(s0);

    const actions = computeLegalActions(s1, PLAYER_1);
    const strikeEventActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(strikeEventActions.length).toBe(1);
    expect((strikeEventActions[0].action as PlayStrikeEventAction).cardInstanceId).toBe(
      handCardId(s1, RESOURCE_PLAYER),
    );
  });

  test('dodging character does not tap on success', () => {
    const s0 = setupMinionCombat([UNDER_HIS_BLOW]);
    const s1 = assignBothStrikesToLagduf(s0);

    const dodgeAction = computeLegalActions(s1, PLAYER_1).find(
      a => a.viable && a.action.type === 'play-strike-event',
    )!;

    // Roll high: Lagduf prowess 5 - 1 excess = 4; need 10-4+1 = 7+. Cheat 12 → success.
    const s2 = resolveChain(dispatch({ ...s1, cheatRollTotal: 12 }, dodgeAction.action));

    expectCharStatus(s2, RESOURCE_PLAYER, LAGDUF, CardStatus.Untapped);
    expect(s2.players[RESOURCE_PLAYER].hand.length).toBe(0);
    expectInDiscardPile(s2, RESOURCE_PLAYER, UNDER_HIS_BLOW);
  });

  test('when wounded by dodged strike, body check has no penalty (unlike Dodge)', () => {
    const s0 = setupMinionCombat([UNDER_HIS_BLOW]);
    const s1 = assignBothStrikesToLagduf(s0);

    const dodgeAction = computeLegalActions(s1, PLAYER_1).find(
      a => a.viable && a.action.type === 'play-strike-event',
    )!;

    // Roll low: Lagduf prowess 4 + 2 = 6 < 10 → wounded.
    const s2 = resolveChain(dispatch({ ...s1, cheatRollTotal: 2 }, dodgeAction.action));

    expect(s2.combat!.phase).toBe('body-check');
    expect(s2.combat!.bodyCheckTarget).toBe('character');

    // Lagduf body 8, no penalty → need roll > 8, i.e., need 9+
    const bcActions = computeLegalActions(s2, PLAYER_2);
    const bcAction = bcActions.find(a => a.viable && a.action.type === 'body-check-roll')!;
    expect((bcAction.action as BodyCheckRollAction).need).toBe(9);

    // Verify no dodge body penalty — dodgeBodyPenalty defaults to 0 (unlike Dodge's -1)
    const strike = s2.combat!.strikeAssignments[s2.combat!.currentStrikeIndex];
    expect(strike.dodged).toBe(true);
    expect(strike.dodgeBodyPenalty).toBe(0);
  });

  test('dodge uses full prowess — same need as tap-to-fight', () => {
    const s0 = setupMinionCombat([UNDER_HIS_BLOW]);
    const s1 = assignBothStrikesToLagduf(s0);

    const actions = computeLegalActions(s1, PLAYER_1);
    const dodgeAction = actions.find(a => a.viable && a.action.type === 'play-strike-event')!;
    const tapAction = actions.find(a => a.viable && a.action.type === 'resolve-strike'
      && (a.action as { tapToFight: boolean }).tapToFight === true)!;

    expect((dodgeAction.action as PlayStrikeEventAction).need).toBe(
      (tapAction.action as { need: number }).need,
    );
  });

  test('Under His Blow is NOT available outside combat (long-event phase)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.LongEvent,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [LAGDUF] }], hand: [UNDER_HIS_BLOW], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    expect(actions.filter(a => a.action.type === 'play-short-event')).toHaveLength(0);
    expect(actions.some(a => a.action.type === 'not-playable')).toBe(true);
  });
});
