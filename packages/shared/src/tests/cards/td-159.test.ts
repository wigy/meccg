/**
 * @module td-159.test
 *
 * Card test: Trickery (td-159)
 * Type: hero-resource-event (short event), wizard alignment. 0 MP.
 * Non-unique.
 *
 * Card text:
 *   "Scout only against an Orc, Troll, Man, Elf, Slayer, Awakened Plant, or
 *    Giant attack against his company. Make a roll; if the result is greater
 *    than 5, the attack is canceled."
 *
 * Effects:
 *   1. cancel-attack — requires a scout in the defending company, gated on
 *      the attacking creature's race, no tap/discard cost. Not automatic:
 *      resolving the chain entry enqueues a 2d6 dice-check (no skill bonus);
 *      only a total greater than 5 cancels the attack.
 *
 * | # | Rule                                                        | Status | Notes                                          |
 * |---|--------------------------------------------------------------|--------|-------------------------------------------------|
 * | 1 | Scout only                                                  | OK     | cancel-attack requiredSkill "scout"              |
 * | 2 | Against Orc/Troll/Man/Elf/Slayer/Awakened Plant/Giant attack | OK     | when enemy.race $in [...]                        |
 * | 3 | Not offered against a non-qualifying race (e.g. Undead)     | OK     | when condition gate                              |
 * | 4 | Not offered without a scout in company                      | OK     | requiredSkill character-match gate               |
 * | 5 | Make a roll; if greater than 5, the attack is canceled      | OK     | roll { threshold: 5, comparison: gt } → dice-check|
 * | 6 | A roll of 5 or less does NOT cancel — combat continues      | OK     | dice-check onFail → chain entry resolves, no-op   |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, ELROND,
  ORC_PATROL, BARROW_WIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions,
  makeMHState,
  playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch, expectInDiscardPile,
  resolveChain, reduce, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CancelAttackAction } from '../../index.js';
import { RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId } from '../../index.js';

const TRICKERY = 'td-159' as CardDefinitionId;

/** Build a state at the pre-strike cancel window for a creature attack. */
function buildCombatState(opts: {
  companyChars: CardDefinitionId[];
  creature: CardDefinitionId;
}) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: opts.companyChars }], hand: [TRICKERY], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [opts.creature], siteDeck: [RIVENDELL] },
    ],
  });

  const mhState = makeMHState({
    activeCompanyIndex: 0,
    resolvedSitePath: [RegionType.Shadow],
    resolvedSitePathNames: ['Gorgoroth'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  });
  const stateAtMH = { ...base, phaseState: mhState };

  const creatureId = handCardId(stateAtMH, HAZARD_PLAYER);
  const targetCompanyId = companyIdAt(stateAtMH, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(
    stateAtMH, PLAYER_2, creatureId, targetCompanyId,
    { method: 'region-type', value: 'shadow' },
  );
}

describe('Trickery (td-159)', () => {
  beforeEach(() => resetMint());

  // ─── Rules 1-2: Scout only, against a qualifying race ──────────────────────

  test('cancel-attack available against an Orc attack with a scout in company', () => {
    const combatState = buildCombatState({ companyChars: [ARAGORN], creature: ORC_PATROL });
    expect(combatState.combat).toBeDefined();
    expect(combatState.combat!.phase).toBe('assign-strikes');

    const cancelActions = viableActions(combatState, PLAYER_1, 'cancel-attack');
    expect(cancelActions).toHaveLength(1);
    const cancelAction = cancelActions[0].action as CancelAttackAction;
    expect(cancelAction.scoutInstanceId).toBeUndefined();
  });

  // ─── Rule 3: not offered against a non-qualifying race ─────────────────────

  test('cancel-attack NOT available against a non-qualifying race (Undead)', () => {
    const combatState = buildCombatState({ companyChars: [ARAGORN], creature: BARROW_WIGHT });
    expect(combatState.combat).toBeDefined();
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  // ─── Rule 4: not offered without a scout in company ─────────────────────────

  test('cancel-attack NOT available when no scout in company', () => {
    const combatState = buildCombatState({ companyChars: [ELROND], creature: ORC_PATROL });
    expect(combatState.combat).toBeDefined();
    expect(viableActions(combatState, PLAYER_1, 'cancel-attack')).toHaveLength(0);
  });

  // ─── Rules 5-6: make a roll; greater than 5 cancels the attack ─────────────

  test('declaring the cancel discards the card and enqueues a roll — combat stays open until it resolves', () => {
    const combatState = buildCombatState({ companyChars: [ARAGORN], creature: ORC_PATROL });
    const cancelAction = viableActions(combatState, PLAYER_1, 'cancel-attack')[0].action as CancelAttackAction;

    const declared = dispatch(combatState, cancelAction);
    expect(declared.chain).not.toBeNull();
    expect(declared.combat).not.toBeNull();
    expect(declared.players[RESOURCE_PLAYER].hand).toHaveLength(0);
    expectInDiscardPile(declared, RESOURCE_PLAYER, TRICKERY);

    const resolved = resolveChain(declared);
    // The chain entry resolving un-negated enqueues a dice-check rather than
    // canceling outright — combat is still open, waiting on the roll.
    expect(resolved.combat).not.toBeNull();
    const rolls = resolved.pendingResolutions.filter(r => r.kind.type === 'dice-check');
    expect(rolls).toHaveLength(1);
    expect(rolls[0].actor).toBe(PLAYER_1);
    if (rolls[0].kind.type === 'dice-check') {
      expect(rolls[0].kind.threshold).toBe(5);
      expect(rolls[0].kind.comparison).toBe('gt');
      expect(rolls[0].kind.modifiers).toEqual([]);
    }
  });

  test('a roll greater than 5 cancels the attack', () => {
    const combatState = buildCombatState({ companyChars: [ARAGORN], creature: ORC_PATROL });
    const cancelAction = viableActions(combatState, PLAYER_1, 'cancel-attack')[0].action as CancelAttackAction;
    const resolved = resolveChain(dispatch(combatState, cancelAction));

    const rollAction = viableActions(resolved, PLAYER_1, 'resolve-dice-check')[0].action;
    const result = reduce({ ...resolved, cheatRollTotal: 6 }, rollAction);
    expect(result.error).toBeUndefined();
    expect(result.state.combat).toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
    expectInDiscardPile(result.state, HAZARD_PLAYER, ORC_PATROL);
  });

  test('a roll of exactly 5 does NOT cancel — combat continues', () => {
    const combatState = buildCombatState({ companyChars: [ARAGORN], creature: ORC_PATROL });
    const cancelAction = viableActions(combatState, PLAYER_1, 'cancel-attack')[0].action as CancelAttackAction;
    const resolved = resolveChain(dispatch(combatState, cancelAction));

    const rollAction = viableActions(resolved, PLAYER_1, 'resolve-dice-check')[0].action;
    const result = reduce({ ...resolved, cheatRollTotal: 5 }, rollAction);
    expect(result.error).toBeUndefined();
    expect(result.state.combat).not.toBeNull();
    expect(result.state.pendingResolutions).toHaveLength(0);
  });
});
