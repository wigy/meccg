/**
 * @module td-33.test
 *
 * Card test: Icy Touch (td-33)
 * Type: hazard-event (permanent), neutral, non-unique.
 *
 * Text:
 *   "Playable on a company facing an Undead attack. The prowess of the
 *    attack is modified by +1. Corruption. The next character wounded by
 *    the attack (on whom a corruption card has not already been played
 *    this turn) receives 2 corruption points (place this card with the
 *    character). Discard Icy Touch if it is not played with a character.
 *    During his organization phase, a character with this card may tap and
 *    attempt to remove it. Make a roll: if this result is greater than a
 *    6, discard this card."
 *
 * Card shape:
 *   - effects[0]: `modify-attack` (fromHand, player "attacker") — +1
 *     prowess to the attack, gated `when: { "enemy.race": "undead" }`, and
 *     carrying the new `attachCorruptionOnWound: true` rider.
 *   - effects[1]: `stat-modifier` corruption-points +2 (applies once the
 *     card is attached to a bearer, same mechanism as every other
 *     corruption card).
 *   - effects[2]: `grant-action` `remove-self-on-roll`, `cost: { tap: "bearer" }`,
 *     threshold 7 ("greater than 6").
 *   - `keywords: ["corruption"]`, `removalNumber: 6` (data-level, matching
 *     every other certified corruption card).
 *
 * Engine support (new primitive):
 *   - `ModifyAttackEffect.attachCorruptionOnWound` (types/effects.ts) and
 *     `CombatState.pendingCorruptionAttach` (types/state-combat.ts): a
 *     from-hand `modify-attack` rider that, on top of the ordinary
 *     immediate-discard behavior, marks the just-discarded card as eligible
 *     for reattachment (`handleModifyAttack`, combat-actions.ts).
 *   - `finalizeCombat` (combat-finalize.ts): reusing the existing
 *     `woundedCharIds` list (strike-array order, detainment-aware), scans
 *     for the first character wounded by the attack with no corruption card
 *     already played on him this turn (`corruptionCardsPlayedPerChar`,
 *     Movement/Hazard phase only — matching every other consumer of that
 *     field) and still in play. If found, the card is spliced out of its
 *     owner's discard pile and onto that character's `hazards`, and
 *     `corruptionCardsPlayedPerChar` is updated. If not found, the card
 *     simply remains discarded — "discard if not played with a character"
 *     requires no separate code path.
 *
 * Rule coverage:
 * | #  | Rule                                                                  | Status      |
 * |----|------------------------------------------------------------------------|-------------|
 * | 1  | Offered to the attacker vs a non-detainment-gated Undead attack        | IMPLEMENTED |
 * | 2  | NOT offered vs a non-Undead attack                                     | IMPLEMENTED |
 * | 3  | NOT offered to the defending (resource) player                         | IMPLEMENTED |
 * | 4  | Playing it adds +1 prowess, discards the card, charges hazard limit    | IMPLEMENTED |
 * | 5  | +2 corruption points while attached                                    | IMPLEMENTED |
 * | 6  | Attack wounds a character → card attaches to him, granting 2 CP        | IMPLEMENTED |
 * | 7  | Attack fully defeated (no wound) → card stays discarded                | IMPLEMENTED |
 * | 8  | Detainment attack (tap, not wound) → card stays discarded              | IMPLEMENTED |
 * | 9  | A character already bearing a corruption card this turn is skipped —   | IMPLEMENTED |
 * |    | the card attaches to the next eligible wounded character instead       |             |
 * | 10 | During organization, the bearer may tap to attempt removal; roll > 6   | IMPLEMENTED |
 * |    | discards the card                                                       |             |
 * | 11 | Roll ≤ 6 keeps the card attached (bearer still taps)                    | IMPLEMENTED |
 *
 * Playable: YES — every rule is implemented in the engine and exercised by
 * assertions below.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  BILBO, LEGOLAS,
  MORIA, LORIEN,
  buildTestState, resetMint, makeMHState,
  viableActions, dispatch, executeAction,
  findCharInstanceId, attachHazardToChar,
  expectCharStatus, expectInDiscardPile,
} from '../test-helpers.js';
import { Phase, Race, CardStatus } from '../../index.js';
import { makeCancelWindowCombat } from '../test-helpers-builders.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import type {
  GameState, CardDefinitionId, CardInstanceId, ModifyAttackAction, MovementHazardPhaseState,
  ActivateGrantedAction,
} from '../../index.js';

const ICY_TOUCH = 'td-33' as CardDefinitionId;

/** Base two-player MH state: PLAYER_1 defends with `characters`, PLAYER_2 (hazard) holds `hand`. */
function baseState(characters: CardDefinitionId[], hand: CardDefinitionId[]): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters }], hand: [], siteDeck: [LORIEN] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand, siteDeck: [MORIA] },
    ],
  });
}

/** Resolves a pending body-check, if any, trying whichever side is offered it. */
function resolveBodyCheckIfPending(s: GameState, roll: number): GameState {
  if (s.combat?.phase !== 'body-check') return s;
  const cheated = { ...s, cheatRollTotal: roll };
  const action = viableActions(cheated, PLAYER_1, 'body-check-roll')[0]?.action
    ?? viableActions(cheated, PLAYER_2, 'body-check-roll')[0]?.action;
  return dispatch(cheated, action);
}

describe('Icy Touch (td-33)', () => {
  beforeEach(() => resetMint());

  // ─── Attached corruption points ────────────────────────────────────────

  test('attached Icy Touch adds 2 corruption points to the bearer', () => {
    const base = baseState([BILBO], []);
    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    expect(base.players[RESOURCE_PLAYER].characters[bilboId].effectiveStats.corruptionPoints).toBe(0);

    const withTouch = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, BILBO, ICY_TOUCH));
    expect(withTouch.players[RESOURCE_PLAYER].characters[bilboId].effectiveStats.corruptionPoints).toBe(2);
  });

  // ─── Rule 10 & 11: tap-to-remove during organization ───────────────────

  function orgPhaseState(): GameState {
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [BILBO] }], hand: [], siteDeck: [LORIEN] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
  }

  test('bearer may tap to attempt removal; roll > 6 discards the card', () => {
    const base = orgPhaseState();
    const withTouch = attachHazardToChar(base, RESOURCE_PLAYER, BILBO, ICY_TOUCH);
    const bilboId = findCharInstanceId(withTouch, RESOURCE_PLAYER, BILBO);
    const cheated = { ...withTouch, cheatRollTotal: 7 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const standard = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action as ActivateGrantedAction;
    expect(standard.actionId).toBe('remove-self-on-roll');
    expect(standard.rollThreshold).toBe(7);

    const next = dispatch(cheated, standard);
    expectCharStatus(next, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
    expect(next.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, ICY_TOUCH);
  });

  test('roll <= 6 keeps the card attached but still taps the bearer', () => {
    const base = orgPhaseState();
    const withTouch = attachHazardToChar(base, RESOURCE_PLAYER, BILBO, ICY_TOUCH);
    const bilboId = findCharInstanceId(withTouch, RESOURCE_PLAYER, BILBO);
    const cheated = { ...withTouch, cheatRollTotal: 6 };

    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const standard = actions.find(ea => !(ea.action as ActivateGrantedAction).noTap)!.action;
    const next = dispatch(cheated, standard);

    expectCharStatus(next, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
    const hazards = next.players[RESOURCE_PLAYER].characters[bilboId].hazards;
    expect(hazards).toHaveLength(1);
    expect(hazards[0].definitionId).toBe(ICY_TOUCH);
  });

  // ─── Rules 1-3: playability gate (from-hand modify-attack window) ──────

  test('offered to the attacker vs an Undead attack, pre-assignment', () => {
    const base = baseState([BILBO], [ICY_TOUCH]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Undead,
      strikesTotal: 1,
      strikeProwess: 6,
    });
    const actions = viableActions(combat, PLAYER_2, 'modify-attack');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as ModifyAttackAction).player).toBe(PLAYER_2);
  });

  test('NOT offered vs a non-Undead attack (Orc)', () => {
    const base = baseState([BILBO], [ICY_TOUCH]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Orc,
      strikesTotal: 1,
      strikeProwess: 6,
    });
    expect(viableActions(combat, PLAYER_2, 'modify-attack')).toHaveLength(0);
  });

  test('NOT offered to the defending (resource) player', () => {
    const base = baseState([BILBO], []);
    const withResourceHand: GameState = {
      ...base,
      players: [
        { ...base.players[RESOURCE_PLAYER], hand: [{ instanceId: 'x' as CardInstanceId, definitionId: ICY_TOUCH }] },
        base.players[HAZARD_PLAYER],
      ] as GameState['players'],
    };
    const combat = makeCancelWindowCombat(withResourceHand, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Undead,
      strikesTotal: 1,
      strikeProwess: 6,
    });
    expect(viableActions(combat, PLAYER_1, 'modify-attack')).toHaveLength(0);
  });

  // ─── Rule 4: playing the card ───────────────────────────────────────────

  test('playing it adds +1 prowess, discards the card, and charges the hazard limit', () => {
    const base = baseState([BILBO], [ICY_TOUCH]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Undead,
      strikesTotal: 1,
      strikeProwess: 6,
    });
    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    const after = dispatch(combat, action);

    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.pendingCorruptionAttach).toBeDefined();
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === ICY_TOUCH)).toBe(true);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany ?? 0).toBe(1);
  });

  // ─── Rules 6-9: post-attack dynamic corruption attachment ─────────────

  /** Drives a single-strike attack (Icy Touch already in hand) to finalization. */
  function playAndResolveSingleStrike(opts: {
    strikeRoll: number;
    strikeProwess: number;
    bodyCheckRoll?: number;
    detainment?: boolean;
  }): GameState {
    const base = baseState([BILBO], [ICY_TOUCH]);
    const combat = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Undead,
      strikesTotal: 1,
      strikeProwess: opts.strikeProwess,
    });
    let s: GameState = opts.detainment ? { ...combat, combat: { ...combat.combat!, detainment: true } } : combat;
    const action = viableActions(s, PLAYER_2, 'modify-attack')[0].action;
    s = dispatch(s, action);

    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: bilboId, tapped: false });
    s = executeAction(s, PLAYER_1, 'resolve-strike', opts.strikeRoll);
    s = resolveBodyCheckIfPending(s, opts.bodyCheckRoll ?? 2);
    return s;
  }

  test('attack wounds the defender → Icy Touch attaches, granting 2 corruption points', () => {
    // Bilbo prowess 1 + roll 2 = 3, vs strike prowess 20+1=21 → wounded.
    const s = playAndResolveSingleStrike({ strikeRoll: 2, strikeProwess: 20 });
    expect(s.combat ?? null).toBeNull();

    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    const hazards = s.players[RESOURCE_PLAYER].characters[bilboId].hazards;
    expect(hazards.map(h => h.definitionId)).toContain(ICY_TOUCH);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === ICY_TOUCH)).toBe(false);

    const recomputed = recomputeDerived(s);
    expect(recomputed.players[RESOURCE_PLAYER].characters[bilboId].effectiveStats.corruptionPoints).toBe(2);

    expect((s.phaseState as MovementHazardPhaseState).corruptionCardsPlayedPerChar[bilboId]).toBe(true);
  });

  test('attack fully defeated (no wound) → card remains discarded, attached to nobody', () => {
    // Bilbo prowess 1 + roll 12 = 13 > strike prowess 3+1=4 → strike defeated;
    // automatic-attack has no body (null), auto-defeated with no body check.
    const s = playAndResolveSingleStrike({ strikeRoll: 12, strikeProwess: 3 });
    expect(s.combat ?? null).toBeNull();

    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    expect(s.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === ICY_TOUCH)).toBe(true);
  });

  test('detainment attack (character tapped, not wounded) → card remains discarded', () => {
    const s = playAndResolveSingleStrike({ strikeRoll: 2, strikeProwess: 20, detainment: true });
    expect(s.combat ?? null).toBeNull();

    const bilboId = findCharInstanceId(s, RESOURCE_PLAYER, BILBO);
    expect(s.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === ICY_TOUCH)).toBe(true);
    expectCharStatus(s, RESOURCE_PLAYER, BILBO, CardStatus.Tapped);
  });

  test('a character already bearing a corruption card this turn is skipped — the card attaches to the next eligible wounded character', () => {
    const base = baseState([BILBO, LEGOLAS], [ICY_TOUCH]);
    const bilboId = findCharInstanceId(base, RESOURCE_PLAYER, BILBO);
    const combat0 = makeCancelWindowCombat(base, {
      attackSourceType: 'automatic-attack',
      creatureRace: Race.Undead,
      strikesTotal: 2,
      strikeProwess: 20,
    });
    // Bilbo already had a corruption card played on him this turn.
    const combat: GameState = {
      ...combat0,
      phaseState: makeMHState({ corruptionCardsPlayedPerChar: { [bilboId]: true } }),
    };

    const action = viableActions(combat, PLAYER_2, 'modify-attack')[0].action;
    let s = dispatch(combat, action);

    const legolasId = findCharInstanceId(s, RESOURCE_PLAYER, LEGOLAS);
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: bilboId });
    s = dispatch(s, { type: 'assign-strike', player: PLAYER_1, characterId: legolasId });
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    // Bilbo resolves first (array order): prowess 1 + roll 2 = 3 ≤ 21 → wounded.
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = resolveBodyCheckIfPending(s, 2);
    // Legolas resolves second: prowess 5 + roll 2 = 7 ≤ 21 → wounded.
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = resolveBodyCheckIfPending(s, 2);

    expect(s.combat ?? null).toBeNull();
    expect(s.players[RESOURCE_PLAYER].characters[bilboId].hazards).toHaveLength(0);
    const legolasHazards = s.players[RESOURCE_PLAYER].characters[legolasId].hazards;
    expect(legolasHazards.map(h => h.definitionId)).toContain(ICY_TOUCH);
    expect(s.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === ICY_TOUCH)).toBe(false);
  });
});
