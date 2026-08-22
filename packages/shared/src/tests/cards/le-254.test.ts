/**
 * @module le-254.test
 *
 * Card test: Where There's a Whip (le-254)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0.
 *
 * Card text:
 *   "Playable on an untapped Orc or Troll character bearing a Whip. Each
 *    tapped character in the bearer's company with a mind and prowess less
 *    than the bearer's makes a body check modified by -2. Failing the body
 *    check wounds, but does not eliminate the character. An Orc or Troll is
 *    discarded according to its card. Each unwounded character in the
 *    company becomes untapped."
 *
 * Distinct rules:
 *   1. Play-target — `play-target` (character) filtered to an untapped
 *      Orc/Troll bearing an item named "Whip" (`target.itemNames $includes
 *      "Whip"`).
 *   2. Company-wide discipline (`whip-discipline`, modifier -2) — every OTHER
 *      character in the bearer's company that is tapped, has a mind > 0, and
 *      has a lower effective prowess than the bearer makes a body check (2d6
 *      - 2 vs body, CoE 3.I.1). A failing character of any race is wounded
 *      instead of eliminated (the card's own override); an Orc/Troll whose
 *      modified total matches a printed `discardBodyCheck` number is
 *      discarded instead ("according to its card", CoE 3.I.3/3.I.4 — same
 *      matchOutcome band as Veils Flung Away le-146).
 *   3. Exclusions — a member who is already untapped, has no mind, or whose
 *      prowess is not lower than the bearer's is never checked.
 *   4. "Each unwounded character in the company becomes untapped" — every
 *      excluded (never-checked) member is untapped immediately; a checked
 *      member who passes is untapped too.
 *
 * Rule coverage:
 * | # | Rule                                                                    | Status      |
 * |---|--------------------------------------------------------------------------|-------------|
 * | 1 | Playable on an untapped Orc/Troll bearing a Whip                         | IMPLEMENTED |
 * | 2 | NOT playable on a tapped bearer                                          | IMPLEMENTED |
 * | 3 | NOT playable on a bearer without a Whip                                  | IMPLEMENTED |
 * | 4 | NOT playable on a non-Orc/Troll bearer                                   | IMPLEMENTED |
 * | 5 | Eligible followers are enqueued for a body check; excluded ones are not  | IMPLEMENTED |
 * | 6 | Orc/Troll follower discarded on his printed discard number               | IMPLEMENTED |
 * | 6b| Orc/Troll follower failing above the discard number is wounded           | IMPLEMENTED |
 * | 7 | Passing Orc/Troll follower stays in play and becomes untapped            | IMPLEMENTED |
 * | 8 | Failing non-Orc/Troll follower is wounded, not eliminated                | IMPLEMENTED |
 * | 9 | Passing non-Orc/Troll follower becomes untapped, unwounded               | IMPLEMENTED |
 * | 10| Follower with prowess not lower than the bearer's is untapped, unchecked | IMPLEMENTED |
 * | 11| Already-untapped follower is left alone, unchecked                      | IMPLEMENTED |
 * | 12| Follower without a mind (Ringwraith) is untapped, unchecked             | IMPLEMENTED |
 * | 13| Playing the card discards it to the controller's discard pile           | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   WHIP_EVENT (le-254)      - minion short event (this card)
 *   WHIP_ITEM (le-348)       - Whip item, Orc/Troll only
 *   LIEUT_ANGMAR (le-20)     - troll leader, prowess 8, body 9, mind 9 (bearer)
 *   LIEUT_MORGUL (le-22)     - troll leader, prowess 8, body 9, mind 9 (prowess-excluded follower)
 *   ORC_CAPTAIN (le-31)      - orc, prowess 5, body 8, mind 5, discardBodyCheck [8]
 *   ASTERNAK (le-1)          - man, prowess 5, body 7, mind 5
 *   LAGDUF (le-18)           - orc, prowess 5, body 8, mind 3 (already-untapped follower)
 *   DWAR (le-52)             - ringwraith, prowess 9, mind null (no-mind follower)
 *   VARIAG_CAMP (le-411)     - minion border-hold (site of origin)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch,
  viableActions, findHandCardId, getCharacter,
  expectInDiscardPile, expectCharStatus, expectCharInPlay, expectCharNotInPlay,
  setCharStatus, attachItemToChar,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { Phase, CardStatus, Alignment } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, GameState, PlayShortEventAction, ResolveDiceCheckAction } from '../../index.js';

const WHIP_EVENT = 'le-254' as CardDefinitionId;
const WHIP_ITEM = 'le-348' as CardDefinitionId;
const LIEUT_ANGMAR = 'le-20' as CardDefinitionId;  // troll, prowess 8
const LIEUT_MORGUL = 'le-22' as CardDefinitionId;  // troll, prowess 8
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;   // orc, prowess 5, body 8, discardBodyCheck [8]
const ASTERNAK = 'le-1' as CardDefinitionId;       // man, prowess 5, body 7
const LAGDUF = 'le-18' as CardDefinitionId;        // orc, prowess 5
const DWAR = 'le-52' as CardDefinitionId;          // ringwraith, prowess 9, mind null
const VARIAG_CAMP = 'le-411' as CardDefinitionId;

/** Org-phase state for the ringwraith player with a bearer (+ Whip) plus optional followers. */
function whipState(opts: {
  followers: CardDefinitionId[];
  bearerTapped?: boolean;
  withWhip?: boolean;
  bearer?: CardDefinitionId;
}): GameState {
  const bearer = opts.bearer ?? LIEUT_ANGMAR;
  let state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: VARIAG_CAMP, characters: [bearer, ...opts.followers] }],
        hand: [WHIP_EVENT],
        siteDeck: [VARIAG_CAMP],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: VARIAG_CAMP, characters: [] }],
        hand: [],
        siteDeck: [VARIAG_CAMP],
      },
    ],
  });
  if (opts.withWhip !== false) {
    state = attachItemToChar(state, RESOURCE_PLAYER, bearer, WHIP_ITEM);
  }
  if (opts.bearerTapped) {
    state = setCharStatus(state, RESOURCE_PLAYER, bearer, CardStatus.Tapped);
  }
  return state;
}

/** All viable le-254 play actions targeting a specific bearer instance. */
function whipActionsForTarget(state: GameState, targetId: CardInstanceId): PlayShortEventAction[] {
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.targetCharacterId === targetId && a.cardInstanceId === findHandCardId(state, RESOURCE_PLAYER, WHIP_EVENT));
}

describe("Where There's a Whip (le-254)", () => {
  beforeEach(() => resetMint());

  // ── Play-target: untapped Orc/Troll bearing a Whip ────────────────────────

  test('playable on an untapped Orc/Troll bearer with a Whip', () => {
    const state = whipState({ followers: [] });
    const bearerId = getCharacter(state, RESOURCE_PLAYER, LIEUT_ANGMAR).instanceId;
    expect(whipActionsForTarget(state, bearerId)).toHaveLength(1);
  });

  test('NOT playable on a tapped bearer', () => {
    const state = whipState({ followers: [], bearerTapped: true });
    const bearerId = getCharacter(state, RESOURCE_PLAYER, LIEUT_ANGMAR).instanceId;
    expect(whipActionsForTarget(state, bearerId)).toHaveLength(0);
  });

  test('NOT playable on a bearer without a Whip', () => {
    const state = whipState({ followers: [], withWhip: false });
    const bearerId = getCharacter(state, RESOURCE_PLAYER, LIEUT_ANGMAR).instanceId;
    expect(whipActionsForTarget(state, bearerId)).toHaveLength(0);
  });

  test('NOT playable on a non-Orc/Troll bearer (Asternak, a Man)', () => {
    const state = whipState({ followers: [], bearer: ASTERNAK });
    const bearerId = getCharacter(state, RESOURCE_PLAYER, ASTERNAK).instanceId;
    expect(whipActionsForTarget(state, bearerId)).toHaveLength(0);
  });

  // ── Company selection: who gets checked, who is swept untapped ───────────

  test('eligible followers are enqueued for a body check; excluded followers are untapped immediately', () => {
    let state = whipState({ followers: [ORC_CAPTAIN, ASTERNAK, LIEUT_MORGUL, LAGDUF, DWAR] });
    state = setCharStatus(state, RESOURCE_PLAYER, ORC_CAPTAIN, CardStatus.Tapped);
    state = setCharStatus(state, RESOURCE_PLAYER, ASTERNAK, CardStatus.Tapped);
    state = setCharStatus(state, RESOURCE_PLAYER, LIEUT_MORGUL, CardStatus.Tapped); // prowess 8, not < bearer's 8
    // LAGDUF stays untapped (already untapped, excluded)
    state = setCharStatus(state, RESOURCE_PLAYER, DWAR, CardStatus.Tapped); // no mind, excluded

    const bearerId = getCharacter(state, RESOURCE_PLAYER, LIEUT_ANGMAR).instanceId;
    const after = dispatch(state, whipActionsForTarget(state, bearerId)[0]);

    const checks = after.pendingResolutions.filter(r => r.kind.type === 'dice-check');
    expect(checks).toHaveLength(2);
    const checkedIds = new Set(checks.map(r => (r.kind as { targetCharacterId?: CardInstanceId }).targetCharacterId));
    expect(checkedIds.has(getCharacter(after, RESOURCE_PLAYER, ORC_CAPTAIN).instanceId)).toBe(true);
    expect(checkedIds.has(getCharacter(after, RESOURCE_PLAYER, ASTERNAK).instanceId)).toBe(true);

    // Excluded followers are untapped immediately — never checked.
    expectCharStatus(after, RESOURCE_PLAYER, LIEUT_MORGUL, CardStatus.Untapped);
    expectCharStatus(after, RESOURCE_PLAYER, LAGDUF, CardStatus.Untapped);
    expectCharStatus(after, RESOURCE_PLAYER, DWAR, CardStatus.Untapped);
    // The bearer himself was already untapped (a precondition of playing the card).
    expectCharStatus(after, RESOURCE_PLAYER, LIEUT_ANGMAR, CardStatus.Untapped);
  });

  test('playing the card discards it to the controller’s discard pile', () => {
    const state = whipState({ followers: [] });
    const bearerId = getCharacter(state, RESOURCE_PLAYER, LIEUT_ANGMAR).instanceId;
    const inst = findHandCardId(state, RESOURCE_PLAYER, WHIP_EVENT);
    const after = dispatch(state, whipActionsForTarget(state, bearerId)[0]);
    expectInDiscardPile(after, RESOURCE_PLAYER, inst);
  });

  // ── Body check: Orc/Troll follower discard vs. survive ────────────────────

  test('an Orc/Troll follower whose total matches his discard number is discarded', () => {
    // Orc Captain: body 8, discardBodyCheck [8], roll modifier -2.
    // Roll 10: total 8 matches the printed discard number -> discarded
    // ("An Orc or Troll is discarded according to its card").
    let state = whipState({ followers: [ORC_CAPTAIN] });
    state = setCharStatus(state, RESOURCE_PLAYER, ORC_CAPTAIN, CardStatus.Tapped);
    const bearerId = getCharacter(state, RESOURCE_PLAYER, LIEUT_ANGMAR).instanceId;
    const orcId = getCharacter(state, RESOURCE_PLAYER, ORC_CAPTAIN).instanceId;

    let s = dispatch(state, whipActionsForTarget(state, bearerId)[0]);
    const dc = s.pendingResolutions.find(r => r.kind.type === 'dice-check' && (r.kind as { targetCharacterId?: CardInstanceId }).targetCharacterId === orcId);
    expect(dc).toBeDefined();
    if (dc?.kind.type === 'dice-check') {
      expect(dc.kind.threshold).toBe(8);
      expect(dc.kind.matchOutcome?.values).toEqual([8]);
    }

    s = { ...s, cheatRollTotal: 10 };
    const rollActions = computeLegalActions(s, PLAYER_1).filter(a => a.viable && a.action.type === 'resolve-dice-check');
    expect(rollActions).toHaveLength(1);
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expectCharNotInPlay(s, RESOURCE_PLAYER, orcId);
    expect(s.players[RESOURCE_PLAYER].discardPile.map(c => c.definitionId)).toContain(ORC_CAPTAIN);
  });

  test('an Orc/Troll follower failing above his discard number is wounded, not discarded', () => {
    // Orc Captain: body 8, discard [8]. Roll 11: total 9 misses the discard
    // number and exceeds body -> an ordinary failed check, which per the card
    // text wounds but does not eliminate (or discard) the character.
    let state = whipState({ followers: [ORC_CAPTAIN] });
    state = setCharStatus(state, RESOURCE_PLAYER, ORC_CAPTAIN, CardStatus.Tapped);
    const bearerId = getCharacter(state, RESOURCE_PLAYER, LIEUT_ANGMAR).instanceId;
    const orcId = getCharacter(state, RESOURCE_PLAYER, ORC_CAPTAIN).instanceId;

    let s = dispatch(state, whipActionsForTarget(state, bearerId)[0]);
    s = { ...s, cheatRollTotal: 11 };
    const rollActions = computeLegalActions(s, PLAYER_1).filter(a => a.viable && a.action.type === 'resolve-dice-check');
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expectCharInPlay(s, RESOURCE_PLAYER, orcId);
    expectCharStatus(s, RESOURCE_PLAYER, ORC_CAPTAIN, CardStatus.Inverted);
  });

  test('a passing Orc/Troll follower survives and becomes untapped', () => {
    // Roll 9: effective 7 <= 8 -> passes -> untapped, still in play.
    let state = whipState({ followers: [ORC_CAPTAIN] });
    state = setCharStatus(state, RESOURCE_PLAYER, ORC_CAPTAIN, CardStatus.Tapped);
    const bearerId = getCharacter(state, RESOURCE_PLAYER, LIEUT_ANGMAR).instanceId;

    let s = dispatch(state, whipActionsForTarget(state, bearerId)[0]);
    s = { ...s, cheatRollTotal: 9 };
    const rollActions = computeLegalActions(s, PLAYER_1).filter(a => a.viable && a.action.type === 'resolve-dice-check');
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expectCharInPlay(s, RESOURCE_PLAYER, getCharacter(s, RESOURCE_PLAYER, ORC_CAPTAIN).instanceId);
    expectCharStatus(s, RESOURCE_PLAYER, ORC_CAPTAIN, CardStatus.Untapped);
  });

  // ── Body check: non-Orc/Troll follower wound vs. survive ──────────────────

  test('a failing non-Orc/Troll follower (Asternak) is wounded, not eliminated', () => {
    // Asternak: body 7. Roll 10: effective 8 > 7 -> fails -> wounded.
    let state = whipState({ followers: [ASTERNAK] });
    state = setCharStatus(state, RESOURCE_PLAYER, ASTERNAK, CardStatus.Tapped);
    const bearerId = getCharacter(state, RESOURCE_PLAYER, LIEUT_ANGMAR).instanceId;

    let s = dispatch(state, whipActionsForTarget(state, bearerId)[0]);
    const astarId = getCharacter(s, RESOURCE_PLAYER, ASTERNAK).instanceId;
    const dc = s.pendingResolutions.find(r => r.kind.type === 'dice-check' && (r.kind as { targetCharacterId?: CardInstanceId }).targetCharacterId === astarId);
    if (dc?.kind.type === 'dice-check') expect(dc.kind.threshold).toBe(7);

    s = { ...s, cheatRollTotal: 10 };
    const rollActions = computeLegalActions(s, PLAYER_1).filter(a => a.viable && a.action.type === 'resolve-dice-check');
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expectCharInPlay(s, RESOURCE_PLAYER, astarId);
    expectCharStatus(s, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);
  });

  test('a passing non-Orc/Troll follower survives unwounded and becomes untapped', () => {
    // Roll 9: effective 7, not > 7 -> passes -> untapped.
    let state = whipState({ followers: [ASTERNAK] });
    state = setCharStatus(state, RESOURCE_PLAYER, ASTERNAK, CardStatus.Tapped);
    const bearerId = getCharacter(state, RESOURCE_PLAYER, LIEUT_ANGMAR).instanceId;

    let s = dispatch(state, whipActionsForTarget(state, bearerId)[0]);
    s = { ...s, cheatRollTotal: 9 };
    const rollActions = computeLegalActions(s, PLAYER_1).filter(a => a.viable && a.action.type === 'resolve-dice-check');
    s = dispatch(s, rollActions[0].action as ResolveDiceCheckAction);

    expectCharStatus(s, RESOURCE_PLAYER, ASTERNAK, CardStatus.Untapped);
  });
});
