/**
 * @module tw-327.test
 *
 * Card test: Shield of Iron-bound Ash (tw-327)
 * Type: hero-resource-item (minor), non-unique, 0 corruption.
 * Effects:
 *   1. stat-modifier: +1 body, max 8
 *   2. item-tap-strike-bonus: tap to gain +1 prowess against one strike
 *
 * "Shield. +1 to body to a maximum of 8. Tap Shield of Iron-bound Ash
 *  to gain +1 prowess against one strike."
 *
 * Tests:
 * 1. +1 body (max 8) is reflected in effective stats for a character
 *    with base body < 8.
 * 2. tap-item-for-strike action IS available during resolve-strike when
 *    the shield bearer is the current strike target.
 * 3. The reported `need` on the tap-item-for-strike action is 1 less
 *    than normal tap-to-fight (reflecting the +1 prowess bonus).
 * 4. Executing tap-item-for-strike taps the item and accumulates +1
 *    on strikeProwessBonus for the current strike.
 * 5. The action is NOT available during the assign-strikes (cancel)
 *    window — only during resolve-strike.
 * 6. A tapped shield does not emit a tap-item-for-strike action.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI,
  CAVE_DRAKE, ORC_PATROL,
  RIVENDELL, LORIEN, MINAS_TIRITH, MORIA,
  buildTestState, resetMint, Phase,
  setupCombatWithCaveDrake, assignBothStrikesTo,
  dispatch,
  getCharacter, attachItemToChar,
  findCharInstanceId, viableActions,
  makeCancelWindowCombat,
  actionAs, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, CardStatus } from '../../index.js';
import type { CardDefinitionId, TapItemForStrikeAction, ResolveStrikeAction } from '../../index.js';

const SHIELD = 'tw-327' as CardDefinitionId;
const THEODEN_ID = 'tw-182' as CardDefinitionId;

describe('Shield of Iron-bound Ash (tw-327)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: +1 body, max 8 ──────────────────────────────────────────

  test('+1 body is reflected in effective stats for a character with base body < 8', () => {
    // Théoden (tw-182) has base body 6; with the shield it should be 7,
    // which is below the max-8 cap so the full +1 applies.
    const withoutShield = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [THEODEN_ID] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const withShield = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: THEODEN_ID, items: [SHIELD] }] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    const baseBody = getCharacter(withoutShield, RESOURCE_PLAYER, THEODEN_ID).effectiveStats.body;
    const withShieldBody = getCharacter(withShield, RESOURCE_PLAYER, THEODEN_ID).effectiveStats.body;
    expect(withShieldBody).toBe(baseBody + 1);
    expect(withShieldBody).toBeLessThanOrEqual(8);
  });

  // ─── Effect 2: tap to gain +1 prowess for one strike ───────────────────

  test('tap-item-for-strike IS available during resolve-strike for the shield bearer', () => {
    let s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
    });
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, ARAGORN, SHIELD);
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const tapActions = viableActions(s1, PLAYER_1, 'tap-item-for-strike');
    expect(tapActions).toHaveLength(1);

    const shieldId = getCharacter(s1, RESOURCE_PLAYER, ARAGORN).items
      .find(it => it.definitionId === SHIELD)?.instanceId;
    const act = actionAs<TapItemForStrikeAction>(tapActions[0].action);
    expect(act.cardInstanceId).toBe(shieldId);
    expect(act.characterInstanceId).toBe(findCharInstanceId(s1, RESOURCE_PLAYER, ARAGORN));
  });

  test('need on tap-item-for-strike is 1 less than normal tap-to-fight', () => {
    let s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
    });
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, ARAGORN, SHIELD);
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const actions = computeLegalActions(s1, PLAYER_1);
    const tapNeed = actionAs<ResolveStrikeAction>(
      actions.find(a => a.viable && a.action.type === 'resolve-strike' &&
        actionAs<ResolveStrikeAction>(a.action).tapToFight === true)!.action,
    ).need;
    const shieldNeed = actionAs<TapItemForStrikeAction>(
      actions.find(a => a.viable && a.action.type === 'tap-item-for-strike')!.action,
    ).need;

    expect(shieldNeed).toBe(tapNeed - 1);
  });

  test('executing tap-item-for-strike taps the item and sets strikeProwessBonus to +1', () => {
    let s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
    });
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, ARAGORN, SHIELD);
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    const tapAction = viableActions(s1, PLAYER_1, 'tap-item-for-strike')[0];
    const s2 = dispatch(s1, tapAction.action);

    // Shield is now tapped.
    const shieldItem = getCharacter(s2, RESOURCE_PLAYER, ARAGORN).items
      .find(it => it.definitionId === SHIELD)!;
    expect(shieldItem.status).toBe(CardStatus.Tapped);

    // strikeProwessBonus is accumulated.
    const strike = s2.combat!.strikeAssignments[s2.combat!.currentStrikeIndex];
    expect(strike.strikeProwessBonus ?? 0).toBe(1);

    // Combat is still in resolve-strike with the bonus now factored in.
    expect(s2.combat!.phase).toBe('resolve-strike');
  });

  test('tap-item-for-strike is NOT available during assign-strikes (cancel window)', () => {
    let base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [GIMLI] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });
    base = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, SHIELD);

    const combatState = makeCancelWindowCombat(base, {
      creatureDefId: ORC_PATROL,
      creatureRace: 'orc',
      attackSourceType: 'creature',
      strikesTotal: 1,
      strikeProwess: 5,
    });

    const tapActions = viableActions(combatState, PLAYER_1, 'tap-item-for-strike');
    expect(tapActions).toHaveLength(0);
  });

  test('a tapped shield does not emit a tap-item-for-strike action', () => {
    let s0 = setupCombatWithCaveDrake({
      heroChars: [ARAGORN, LEGOLAS],
      creatureDefId: CAVE_DRAKE,
    });
    s0 = attachItemToChar(s0, RESOURCE_PLAYER, ARAGORN, SHIELD);
    const s1 = assignBothStrikesTo(s0, ARAGORN);

    // Tap the shield manually.
    const shieldInstance = getCharacter(s1, RESOURCE_PLAYER, ARAGORN).items
      .find(it => it.definitionId === SHIELD)!;
    const aragornId = findCharInstanceId(s1, RESOURCE_PLAYER, ARAGORN);
    const s2 = {
      ...s1,
      players: [
        {
          ...s1.players[RESOURCE_PLAYER],
          characters: {
            ...s1.players[RESOURCE_PLAYER].characters,
            [aragornId as string]: {
              ...s1.players[RESOURCE_PLAYER].characters[aragornId as string],
              items: s1.players[RESOURCE_PLAYER].characters[aragornId as string].items.map(it =>
                it.instanceId === shieldInstance.instanceId
                  ? { ...it, status: CardStatus.Tapped }
                  : it,
              ),
            },
          },
        },
        s1.players[1],
      ] as unknown as typeof s1.players,
    };

    const tapActions = viableActions(s2, PLAYER_1, 'tap-item-for-strike');
    expect(tapActions).toHaveLength(0);
  });
});
