/**
 * @module le-238.test
 *
 * Card test: Swift Strokes (le-238)
 * Type: minion-resource-event (short)
 * Alignment: ringwraith
 * Effects: 1 (strike-modifier, reroll + prowessBonus 1, warrior-only filter)
 *
 * "Warrior only. Warrior receives +1 prowess against one strike and obtains
 * two random values against it, choosing the one to use."
 *
 * This tests:
 * 1. play-strike-event appears during resolve-strike when the target is a warrior.
 * 2. Warrior-only filter blocks the action when the target is not a warrior.
 * 3. The need is 1 less than tap-to-fight need (reflecting the +1 prowess bonus).
 * 4. Two dice rolls are emitted (kept + discarded) and the better total is used.
 * 5. The +1 prowess bonus is applied before rolling — character effectively fights
 *    at prowess+1 with reroll.
 * 6. Character taps on success (like normal tap-to-fight).
 * 7. Swift Strokes is discarded from hand after use.
 * 8. Not playable outside combat.
 *
 * Characters:
 *   le-18  Lagduf (orc warrior, prowess 5) — warrior test subject
 *   le-4   Calendal (elf scout/sage, prowess 4) — non-warrior, filter target
 *   le-36  Ostisen (man scout, prowess 3) — hazard-player placeholder
 *
 * Sites:
 *   le-392  Moria (shadow-hold, minion version)
 *   le-367  Dol Guldur (minion haven)
 *   le-390  Minas Morgul (minion haven)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  CAVE_DRAKE,
  buildTestState, resetMint,
  makeMHState, playCreatureHazardAndResolve,
  handCardId, companyIdAt, dispatch, expectCharStatus, expectInDiscardPile,
  findCharInstanceId, dispatchResult, actionAs,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus, RegionType, SiteType } from '../../index.js';
import type {
  GameState,
  CardDefinitionId,
  PlayStrikeEventAction,
  PlayShortEventAction,
  NotPlayableAction,
  ResolveStrikeAction,
} from '../../index.js';

const SWIFT_STROKES = 'le-238' as CardDefinitionId;
const LAGDUF = 'le-18' as CardDefinitionId;      // warrior orc, prowess 5
const CALENDAL = 'le-4' as CardDefinitionId;     // scout/sage elf, prowess 4 — NOT a warrior
const OSTISEN = 'le-36' as CardDefinitionId;     // scout man, prowess 3 — hazard-player placeholder

const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold (resource player site)
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven (hazard player site)
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven (siteDeck)

/** Set up MH-phase combat: Lagduf (or given minion chars) at Moria with Cave Drake played. */
function setupMinionCombat(opts: {
  resourceChars: readonly CardDefinitionId[];
  resourceHand?: readonly CardDefinitionId[];
}): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: MORIA_MINION, characters: [...opts.resourceChars] }],
        hand: [...(opts.resourceHand ?? [])],
        siteDeck: [DOL_GULDUR],
      },
      {
        id: PLAYER_2,
        companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
        hand: [CAVE_DRAKE],
        siteDeck: [DOL_GULDUR],
      },
    ],
  });
  const mhState = makeMHState({
    resolvedSitePath: [RegionType.Wilderness, RegionType.Wilderness],
    resolvedSitePathNames: ['Hollin', 'Enedhwaith'],
    destinationSiteType: SiteType.ShadowHold,
    destinationSiteName: 'Moria',
  });
  const state = { ...base, phaseState: mhState };
  const creatureId = handCardId(state, HAZARD_PLAYER);
  const companyId = companyIdAt(state, RESOURCE_PLAYER);
  return playCreatureHazardAndResolve(state, PLAYER_2, creatureId, companyId, {
    method: 'region-type' as const,
    value: 'wilderness',
  });
}

/** Assign both Cave Drake strikes to the given character (Cave Drake has attacker-chooses). */
function assignBothTo(state: GameState, defId: CardDefinitionId): GameState {
  const targetId = findCharInstanceId(state, RESOURCE_PLAYER, defId);
  let s = dispatch(state, { type: 'pass', player: PLAYER_1 });
  s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: targetId });
  s = dispatch(s, { type: 'assign-strike', player: PLAYER_2, characterId: targetId, excess: true });
  expect(s.combat!.phase).toBe('resolve-strike');
  return s;
}

describe('Swift Strokes (le-238)', () => {
  beforeEach(() => resetMint());

  test('play-strike-event appears during resolve-strike when target is a warrior, in both tap and stay-untapped variants', () => {
    const s0 = setupMinionCombat({ resourceChars: [LAGDUF, OSTISEN], resourceHand: [SWIFT_STROKES] });
    const s1 = assignBothTo(s0, LAGDUF);

    const actions = computeLegalActions(s1, PLAYER_1);
    const rerollActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    // Swift Strokes' text says nothing about tapping, so it doesn't collapse
    // the defender's independent CoE 3.iv.3 tap/stay-untapped choice — both
    // variants are offered while Lagduf is untapped (bug report: it must not
    // immediately roll under the assumption the character will tap).
    expect(rerollActions.length).toBe(2);
    for (const a of rerollActions) {
      expect(actionAs<PlayStrikeEventAction>(a.action).cardInstanceId).toBe(
        handCardId(s1, RESOURCE_PLAYER),
      );
    }
    expect(rerollActions.some(a => actionAs<PlayStrikeEventAction>(a.action).tapToFight === true)).toBe(true);
    expect(rerollActions.some(a => actionAs<PlayStrikeEventAction>(a.action).tapToFight === false)).toBe(true);
  });

  test('play-strike-event is not available when target is not a warrior', () => {
    const s0 = setupMinionCombat({ resourceChars: [CALENDAL, OSTISEN], resourceHand: [SWIFT_STROKES] });
    const s1 = assignBothTo(s0, CALENDAL);

    const actions = computeLegalActions(s1, PLAYER_1);
    const rerollActions = actions.filter(a => a.viable && a.action.type === 'play-strike-event');
    expect(rerollActions.length).toBe(0);
  });

  test('need is 1 less than tap-to-fight (reflecting +1 prowess bonus)', () => {
    // Lagduf prowess 5 vs Cave Drake prowess 10:
    //   tap-to-fight need = 10 - 5 + 1 = 6
    //   Swift Strokes need = 10 - (5+1) + 1 = 5
    const s0 = setupMinionCombat({ resourceChars: [LAGDUF, OSTISEN], resourceHand: [SWIFT_STROKES] });
    const s1 = assignBothTo(s0, LAGDUF);

    const actions = computeLegalActions(s1, PLAYER_1);
    const tapAction = actions.find(
      a => a.viable && a.action.type === 'resolve-strike' &&
        actionAs<ResolveStrikeAction>(a.action).tapToFight === true,
    )!;
    const swiftAction = actions.find(a => a.viable && a.action.type === 'play-strike-event' &&
      actionAs<PlayStrikeEventAction>(a.action).tapToFight === true)!;

    expect(tapAction).toBeDefined();
    expect(swiftAction).toBeDefined();
    const tapNeed = actionAs<ResolveStrikeAction>(tapAction.action).need;
    const swiftNeed = actionAs<PlayStrikeEventAction>(swiftAction.action).need;
    expect(swiftNeed).toBe(tapNeed - 1);
  });

  test('stay-untapped variant matches plain stay-untapped need, and Lagduf stays untapped on success (CoE 3.iv.3)', () => {
    // Bug report: playing Swift Strokes immediately rolled under the
    // assumption the character would tap — it must still wait for the
    // defender's tap/stay-untapped choice.
    const s0 = setupMinionCombat({ resourceChars: [LAGDUF, OSTISEN], resourceHand: [SWIFT_STROKES] });
    const s1 = assignBothTo(s0, LAGDUF);

    const actions = computeLegalActions(s1, PLAYER_1);
    const untapAction = actions.find(
      a => a.viable && a.action.type === 'resolve-strike' &&
        actionAs<ResolveStrikeAction>(a.action).tapToFight === false,
    )!;
    const swiftUntapAction = actions.find(a => a.viable && a.action.type === 'play-strike-event' &&
      actionAs<PlayStrikeEventAction>(a.action).tapToFight === false)!;

    expect(untapAction).toBeDefined();
    expect(swiftUntapAction).toBeDefined();
    // Same -3 stay-untapped penalty applies as for a plain resolve-strike
    // (offset by Swift Strokes' own +1 prowess bonus).
    const untapNeed = actionAs<ResolveStrikeAction>(untapAction.action).need;
    const swiftUntapNeed = actionAs<PlayStrikeEventAction>(swiftUntapAction.action).need;
    expect(swiftUntapNeed).toBe(untapNeed - 1);

    // First roll cheated to 12 — always the better of the two. Lagduf stays
    // untapped, so the -3 penalty applies: prowess 5 - 3 + 1 (bonus) + 12 = 15 > 10 → success.
    const result = dispatchResult({ ...s1, cheatRollTotal: 12 }, swiftUntapAction.action);
    expectCharStatus(result.state, RESOURCE_PLAYER, LAGDUF, CardStatus.Untapped);
  });

  test('reroll uses the better of two rolls and prowess bonus is applied', () => {
    const s0 = setupMinionCombat({ resourceChars: [LAGDUF, OSTISEN], resourceHand: [SWIFT_STROKES] });
    const s1 = assignBothTo(s0, LAGDUF);

    const swiftAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event' &&
        actionAs<PlayStrikeEventAction>(a.action).tapToFight === true)!;

    // First roll cheated to 12 — always the better of the two.
    // Lagduf prowess 5 + 1 (bonus) + 12 = 18 > Cave Drake prowess 10 → success.
    const result = dispatchResult({ ...s1, cheatRollTotal: 12 }, swiftAction.action);
    const s2 = result.state;

    // Lagduf taps on success.
    expectCharStatus(s2, RESOURCE_PLAYER, LAGDUF, CardStatus.Tapped);

    // Swift Strokes discarded from hand.
    expect(s2.players[0].hand.length).toBe(0);
    expectInDiscardPile(s2, RESOURCE_PLAYER, SWIFT_STROKES);

    // Two dice-roll effects emitted (kept + discarded).
    const diceEffects = result.effects!.filter(e => e.effect === 'dice-roll');
    expect(diceEffects.length).toBe(2);
    const totals = diceEffects.map(e => {
      const d = e as { die1: number; die2: number };
      return d.die1 + d.die2;
    });
    const keptEffect = diceEffects.find(e => !(e as { label: string }).label.includes('discarded'))!;
    const keptTotal = (keptEffect as { die1: number; die2: number }).die1
      + (keptEffect as { die1: number; die2: number }).die2;
    expect(keptTotal).toBe(Math.max(...totals));
    expect(keptTotal).toBe(12);
  });

  test('poor first roll is overridden when second roll is better', () => {
    const s0 = setupMinionCombat({ resourceChars: [LAGDUF, OSTISEN], resourceHand: [SWIFT_STROKES] });
    const s1 = assignBothTo(s0, LAGDUF);

    const swiftAction = computeLegalActions(s1, PLAYER_1)
      .find(a => a.viable && a.action.type === 'play-strike-event' &&
        actionAs<PlayStrikeEventAction>(a.action).tapToFight === true)!;

    const result = dispatchResult({ ...s1, cheatRollTotal: 2 }, swiftAction.action);

    const diceEffects = result.effects!.filter(e => e.effect === 'dice-roll');
    expect(diceEffects.length).toBe(2);
    const totals = diceEffects.map(e => {
      const d = e as { die1: number; die2: number };
      return d.die1 + d.die2;
    });
    expect(totals).toContain(2);
    const keptEffect = diceEffects.find(e => !(e as { label: string }).label.includes('discarded'))!;
    const keptTotal = (keptEffect as { die1: number; die2: number }).die1
      + (keptEffect as { die1: number; die2: number }).die2;
    expect(keptTotal).toBe(Math.max(...totals));
  });

  test('Swift Strokes is not playable as a short event during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA_MINION, characters: [LAGDUF] }],
          hand: [SWIFT_STROKES],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MINAS_MORGUL, characters: [OSTISEN] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
      ],
    });

    const actions = computeLegalActions(state, PLAYER_1);
    const asShortEvent = actions.find(
      a => a.viable && a.action.type === 'play-short-event' &&
        actionAs<PlayShortEventAction>(a.action).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(asShortEvent).toBeUndefined();

    const notPlayable = actions.find(
      a => !a.viable && a.action.type === 'not-playable' &&
        actionAs<NotPlayableAction>(a.action).cardInstanceId === state.players[0].hand[0].instanceId,
    );
    expect(notPlayable).toBeDefined();
  });
});
