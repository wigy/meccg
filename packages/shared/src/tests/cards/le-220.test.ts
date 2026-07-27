/**
 * @module le-220.test
 *
 * Card test: Ready to His Will (le-220)
 * Type: minion-resource-event (permanent), Ringwraith alignment
 *
 * Card text: "Playable on an Orc, Troll, Giant, Slayer, or Man hazard creature
 * with one strike for each of its attacks. All attacks of the creature are
 * canceled. The creature becomes an ally under the control of any character in
 * the company that now taps. It has a mind of 1, 1 ally marshalling point,
 * prowess equal to its normal prowess minus 7, and a body equal to 8. Place
 * this card with the creature."
 *
 * Effect: convert-creature-to-ally — races [orc/orcs/troll/trolls/giant/
 * slayer/men], maxStrikes 1, controllerTaps true, ally { mind 1, body 8,
 * prowessModifier -7 }.
 *
 * The defending (Ringwraith) player plays the card during the creature's
 * attack (assign-strikes window). One action is offered per (card, untapped
 * controlling character) pair. On play: all the creature's attacks are
 * canceled, the creature card becomes an ally on the chosen character (which
 * taps) with the overridden stats, and the event card is placed with the
 * creature in cards-in-play (where it scores its 1 ally marshalling point).
 *
 * Fixtures: Giant (tw-39, race giant, 1 strike, printed prowess 13 → ally
 * prowess 6) as the eligible creature; Orc-patrol (tw-074, 3 strikes) and
 * Barrow-wight (tw-015, undead) as ineligible creatures.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  resetMint,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  buildRingwraithCreatureCombat,
  viableActions, findAction, dispatch,
  charIdAt, companyIdAt,
} from '../test-helpers.js';
import { CardStatus, computeLegalActions, Race } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CombatState, ConvertCreatureToAllyAction } from '../../index.js';

const READY_TO_HIS_WILL = 'le-220' as CardDefinitionId;
const GIANT = 'tw-39' as CardDefinitionId;          // giant, 1 strike, printed prowess 13
const ORC_PATROL = 'tw-074' as CardDefinitionId;    // orc, 3 strikes (too many)
const BARROW_WIGHT = 'tw-015' as CardDefinitionId;  // undead, 1 strike (ineligible race)
const ORC_BRAWLER = 'le-30' as CardDefinitionId;    // minion orc, mind 1
const MUZGASH = 'le-25' as CardDefinitionId;        // minion orc, mind 2

describe('Ready to His Will (le-220)', () => {
  beforeEach(() => resetMint());

  // ── Availability ────────────────────────────────────────────────────

  test('offered against an eligible 1-strike Orc/Troll/Giant/Slayer/Man creature', () => {
    const { state } = buildRingwraithCreatureCombat({
      creatureDefId: GIANT, creatureRace: Race.Giant, characters: [ORC_BRAWLER], hand: [READY_TO_HIS_WILL],
    });
    const actions = viableActions(state, PLAYER_1, 'convert-creature-to-ally');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as ConvertCreatureToAllyAction).controllingCharacterId)
      .toBe(charIdAt(state, RESOURCE_PLAYER));
  });

  test('one action per untapped character; tapped characters are excluded', () => {
    const { state } = buildRingwraithCreatureCombat({
      creatureDefId: GIANT, creatureRace: Race.Giant, characters: [ORC_BRAWLER, MUZGASH], hand: [READY_TO_HIS_WILL],
    });
    // Both untapped → two controller choices.
    expect(viableActions(state, PLAYER_1, 'convert-creature-to-ally')).toHaveLength(2);

    // Tap the first character → only the second remains a valid controller.
    const firstCharId = charIdAt(state, RESOURCE_PLAYER, 0, 0);
    const tapped = {
      ...state,
      players: state.players.map((p, i) => i === RESOURCE_PLAYER
        ? { ...p, characters: { ...p.characters, [firstCharId]: { ...p.characters[firstCharId], status: CardStatus.Tapped } } }
        : p) as unknown as typeof state.players,
    };
    const remaining = viableActions(tapped, PLAYER_1, 'convert-creature-to-ally');
    expect(remaining).toHaveLength(1);
    expect((remaining[0].action as ConvertCreatureToAllyAction).controllingCharacterId)
      .toBe(charIdAt(state, RESOURCE_PLAYER, 0, 1));
  });

  test('NOT offered against a creature with more than one strike', () => {
    const { state } = buildRingwraithCreatureCombat({
      creatureDefId: ORC_PATROL, creatureRace: Race.Orc, characters: [ORC_BRAWLER], hand: [READY_TO_HIS_WILL],
    });
    expect(viableActions(state, PLAYER_1, 'convert-creature-to-ally')).toHaveLength(0);
  });

  test('NOT offered against an ineligible race (undead)', () => {
    const { state } = buildRingwraithCreatureCombat({
      creatureDefId: BARROW_WIGHT, creatureRace: Race.Undead, characters: [ORC_BRAWLER], hand: [READY_TO_HIS_WILL],
    });
    expect(viableActions(state, PLAYER_1, 'convert-creature-to-ally')).toHaveLength(0);
  });

  test('NOT offered to the attacking (hazard) player', () => {
    const { state } = buildRingwraithCreatureCombat({
      creatureDefId: GIANT, creatureRace: Race.Giant, characters: [ORC_BRAWLER], hand: [READY_TO_HIS_WILL],
    });
    expect(viableActions(state, PLAYER_2, 'convert-creature-to-ally')).toHaveLength(0);
  });

  // ── Conversion ──────────────────────────────────────────────────────

  test('converts the creature into a controlled ally, taps the controller, ends combat', () => {
    const { state, creatureInstanceId } = buildRingwraithCreatureCombat({
      creatureDefId: GIANT, creatureRace: Race.Giant, characters: [ORC_BRAWLER], hand: [READY_TO_HIS_WILL],
    });
    const controllerId = charIdAt(state, RESOURCE_PLAYER);

    const action = findAction<ConvertCreatureToAllyAction>(
      state, PLAYER_1, 'convert-creature-to-ally',
      a => a.controllingCharacterId === controllerId,
    );
    expect(action).toBeDefined();

    const after = dispatch(state, action!);

    // All attacks canceled → combat ends.
    expect(after.combat).toBeNull();

    // Creature removed from the attacker's cards-in-play.
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === creatureInstanceId)).toBe(false);

    // Creature is now an ally on the controlling character, which has tapped.
    const controller = after.players[RESOURCE_PLAYER].characters[controllerId];
    expect(controller.status).toBe(CardStatus.Tapped);
    expect(controller.allies).toHaveLength(1);
    const ally = controller.allies[0];
    expect(ally.instanceId).toBe(creatureInstanceId);
    expect(ally.definitionId).toBe(GIANT);
    expect(ally.status).toBe(CardStatus.Untapped);
    // mind 1, body 8, prowess = printed prowess (13) − 7 = 6.
    expect(ally.statOverride).toEqual({ mind: 1, prowess: 6, body: 8 });
  });

  test('places the event card with the creature and scores 1 ally marshalling point', () => {
    const { state, creatureInstanceId } = buildRingwraithCreatureCombat({
      creatureDefId: GIANT, creatureRace: Race.Giant, characters: [ORC_BRAWLER], hand: [READY_TO_HIS_WILL],
    });
    const action = findAction<ConvertCreatureToAllyAction>(state, PLAYER_1, 'convert-creature-to-ally');
    const after = dispatch(state, action!);

    const def = after.players[RESOURCE_PLAYER];
    // Event card left the hand …
    expect(def.hand.some(c => c.definitionId === READY_TO_HIS_WILL)).toBe(false);
    // … and is in play, attached to the new ally ("place this card with the creature").
    const eventInPlay = def.cardsInPlay.find(c => c.definitionId === READY_TO_HIS_WILL);
    expect(eventInPlay).toBeDefined();
    expect(eventInPlay!.attachedTo).toBe(creatureInstanceId);

    // Scores its 1 ally marshalling point.
    expect(def.marshallingPoints.ally).toBe(1);
  });

  // ── The converted ally uses its overridden stats in combat ──────────

  test('converted ally fights at its overridden prowess (creature prowess − 7)', () => {
    const { state, creatureInstanceId } = buildRingwraithCreatureCombat({
      creatureDefId: GIANT, creatureRace: Race.Giant, characters: [ORC_BRAWLER], hand: [READY_TO_HIS_WILL],
    });
    const action = findAction<ConvertCreatureToAllyAction>(state, PLAYER_1, 'convert-creature-to-ally');
    const converted = dispatch(state, action!);

    // A fresh attack (prowess 9) is assigned to the converted ally. The ally
    // fights at prowess 6, so the tapped "need" is 9 − 6 + 1 = 4 (vs 9 − 0 + 1
    // = 10 if the override were ignored and the creature definition's 0
    // ally-prowess used).
    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId: 'fake-site' as CardInstanceId, attackIndex: 0 },
      companyId: companyIdAt(converted, RESOURCE_PLAYER),
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 9,
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: creatureInstanceId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };
    const inCombat = { ...converted, combat };

    const resolveActions = computeLegalActions(inCombat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'resolve-strike');
    expect(resolveActions.length).toBeGreaterThan(0);
    const tapToFight = resolveActions.find(ea => (ea.action as { tapToFight?: boolean }).tapToFight === true);
    expect(tapToFight).toBeDefined();
    expect((tapToFight!.action as { need: number }).need).toBe(4);
  });
});
