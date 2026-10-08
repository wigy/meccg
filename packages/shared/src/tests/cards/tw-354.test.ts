/**
 * @module tw-354.test
 *
 * Card test: True Fána (tw-354)
 * Type: hero-resource-event (short, spell)
 *
 * Card text: "Spell. Wizard only. Before resolving an attack against the
 * Wizard's company, make a roll and add the Wizard's prowess to the result.
 * If the total is greater than the attack's prowess, all of the attack's
 * strikes fail (if the attack has body, make body checks to determine if the
 * attack is defeated). Otherwise, the attack proceeds normally. Wizard makes a
 * corruption check modified by -3. Cannot be used in company vs. company
 * combat."
 *
 * Effects:
 *   1. attack-roll-strikes-fail — requiredRace "wizard", cost = corruption
 *      check -3. Offered in the pre-resolution cancel window (one action per
 *      Wizard in the attacked company, carrying `targetCharacterId`), never in
 *      CvCC. On play: 2d6 + the Wizard's prowess vs the attack's prowess; a
 *      greater total sets `combat.forcedStrikeDefeat` (every strike fails, a
 *      creature with body still faces body checks), otherwise nothing changes.
 *      The corruption check is enqueued either way.
 *
 * Fixtures: Gandalf (tw-156, wizard, prowess 6) and Aragorn (not a Wizard)
 * facing a one-strike Orc attack of prowess 10. The strike is placed directly
 * on Gandalf (`placeSingleStrikeOn`) after the Wizard's corruption check is
 * passed with a roll of 12.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint,
  Phase, PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, GANDALF,
  MORIA, LORIEN, MINAS_TIRITH,
  viableActions, makeCancelWindowCombat, placeSingleStrikeOn,
  dispatch, executeAction, expectInDiscardPile,
  findCharInstanceId,
} from '../test-helpers.js';
import type { BuildTestStateOpts, PlayerSetup } from '../test-helpers.js';
import { Race } from '../../index.js';
import type { CardDefinitionId, GameState, PlayShortEventAction } from '../../index.js';

const TRUE_FANA = 'tw-354' as CardDefinitionId;

const ATTACK = { creatureRace: Race.Orc, strikesTotal: 1, strikeProwess: 10 };
const OPPONENT: PlayerSetup = { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] };
const WIZARD_COMPANY: BuildTestStateOpts = {
  activePlayer: PLAYER_1,
  phase: Phase.MovementHazard,
  recompute: true,
  players: [
    { id: PLAYER_1, companies: [{ site: MORIA, characters: [GANDALF, ARAGORN] }], hand: [TRUE_FANA], siteDeck: [MINAS_TIRITH] },
    OPPONENT,
  ],
};

describe('True Fána (tw-354)', () => {
  beforeEach(() => resetMint());

  // ── Availability ────────────────────────────────────────────────────

  test('offered before the attack resolves, cast by the Wizard only', () => {
    const state = makeCancelWindowCombat(buildTestState(WIZARD_COMPANY), ATTACK);
    const actions = viableActions(state, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(actions).toHaveLength(1);
    expect(actions[0].targetCharacterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, GANDALF));
  });

  test('NOT offered when no Wizard is in the attacked company', () => {
    const base = buildTestState({
      ...WIZARD_COMPANY,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [TRUE_FANA], siteDeck: [MINAS_TIRITH] },
        OPPONENT,
      ],
    });
    const state = makeCancelWindowCombat(base, ATTACK);
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT offered once strikes have been assigned (the attack is already resolving)', () => {
    const state = placeSingleStrikeOn(makeCancelWindowCombat(buildTestState(WIZARD_COMPANY), ATTACK), GANDALF);
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT offered in company vs. company combat', () => {
    const base = makeCancelWindowCombat(buildTestState(WIZARD_COMPANY), ATTACK);
    const state: GameState = {
      ...base,
      combat: {
        ...base.combat!,
        isCvCC: true,
        attackSource: { type: 'company-attack', attackingCompanyId: base.players[1].companies[0].id },
      },
    };
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  // ── Roll succeeds: all strikes fail, body checks still made ─────────

  test('roll + Wizard prowess > attack prowess: all strikes fail, body check vs the attack, -3 corruption check', () => {
    const base = makeCancelWindowCombat(buildTestState(WIZARD_COMPANY), ATTACK);
    const state: GameState = { ...base, combat: { ...base.combat!, creatureBody: 8 }, cheatRollTotal: 5 };
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);

    // 5 + Gandalf's prowess 6 = 11 > 10.
    const after = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);

    expect(after.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, TRUE_FANA);
    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind).toMatchObject({ type: 'corruption-check', modifier: -3, characterId: gandalfId });
    expect(after.combat).not.toBeNull();
    expect(after.combat!.forcedStrikeDefeat).toBe(true);

    // Even the worst strike roll (2 + 6 = 8 < 10) fails to hit Gandalf; the
    // attack has body, so a body check against it follows.
    const checked = executeAction(after, PLAYER_1, 'corruption-check', 12);
    expect(checked.pendingResolutions).toHaveLength(0);
    const afterStrike = executeAction(placeSingleStrikeOn(checked, GANDALF), PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike.combat!.strikeAssignments[0].result).toBe('success');
    expect(afterStrike.combat!.bodyCheckTarget).toBe('creature');
  });

  test('a successful roll against an attack without body makes no body check', () => {
    const base = makeCancelWindowCombat(buildTestState(WIZARD_COMPANY), ATTACK);
    const state: GameState = { ...base, combat: { ...base.combat!, creatureBody: null }, cheatRollTotal: 5 };

    const after = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);
    expect(after.combat!.forcedStrikeDefeat).toBe(true);

    const checked = executeAction(after, PLAYER_1, 'corruption-check', 12);
    const afterStrike = executeAction(placeSingleStrikeOn(checked, GANDALF), PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike.combat?.bodyCheckTarget ?? null).toBeNull();
  });

  // ── Roll fails: the attack proceeds normally ────────────────────────

  test('roll + Wizard prowess equal to the attack prowess: attack proceeds normally, check still made', () => {
    const base = makeCancelWindowCombat(buildTestState(WIZARD_COMPANY), ATTACK);
    const state: GameState = { ...base, combat: { ...base.combat!, creatureBody: 8 }, cheatRollTotal: 4 };
    const gandalfId = findCharInstanceId(state, RESOURCE_PLAYER, GANDALF);

    // 4 + 6 = 10, not greater than 10.
    const after = dispatch(state, viableActions(state, PLAYER_1, 'play-short-event')[0].action);

    expectInDiscardPile(after, RESOURCE_PLAYER, TRUE_FANA);
    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind).toMatchObject({ type: 'corruption-check', modifier: -3, characterId: gandalfId });
    expect(after.combat!.forcedStrikeDefeat).toBeFalsy();

    // The strike resolves normally: 2 + 6 = 8 < 10 wounds Gandalf.
    const checked = executeAction(after, PLAYER_1, 'corruption-check', 12);
    const afterStrike = executeAction(placeSingleStrikeOn(checked, GANDALF), PLAYER_1, 'resolve-strike', 2, true);
    expect(afterStrike.combat!.strikeAssignments[0].result).toBe('wounded');
    expect(afterStrike.combat!.bodyCheckTarget).toBe('character');
  });
});
