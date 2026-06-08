/**
 * @module le-34.test
 *
 * Card test: Orc Tracker (le-34)
 * Type: minion-character (ringwraith alignment)
 * Stats: Orc warrior/ranger, prowess 3, body 8, mind 3, DI 0, MP 1
 * Homesite: Any Dark-hold
 *
 * Card text:
 *   "Discard on a body check result of 7 or 8. -1 to all corruption checks."
 *
 * (The English text abbreviates "all corruption checks"; the Spanish/French
 * printings read "all of his corruption checks" — the modifier is scoped to
 * this character's own checks, like Orc Veteran le-35 / Orophin tw-174.)
 *
 * Engine Support:
 * | # | Feature                                | Status      | Notes                                              |
 * |---|----------------------------------------|-------------|----------------------------------------------------|
 * | 1 | discardBodyCheck [7, 8] (structural)   | IMPLEMENTED | combat body-check matching 7 or 8 → discard pile   |
 * | 2 | -1 corruption check modifier           | IMPLEMENTED | check-modifier effect, value -1                    |
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. discardBodyCheck [7, 8]: in combat, a body-check roll of exactly 7 OR 8
 *    sends the orc to the discard pile (not the eliminated/out-of-play pile).
 *    A roll of 9 (> body 8, not in {7,8}) instead eliminates to the out-of-play
 *    pile, confirming only 7/8 trigger the printed discard. A roll of 6
 *    (<= body, not in {7,8}) leaves the orc wounded but in play.
 * 2. -1 modifier applied to corruption checks:
 *    corruptionModifier is -1 and need = CP + 1 - (-1) = CP + 2.
 *
 * Fixtures:
 *   ORC_TRACKER (le-34)        - minion orc warrior/ranger, body 8, discardBodyCheck [7,8]
 *   RED_BOOK (le-339)          - minion resource item, 2 corruption points (triggers check)
 *   DOL_GULDUR (le-367)        - minion haven (home site)
 *   HOARMURATH (le-53)         - minion ringwraith character (attacker-side filler)
 *   MORIA (le-392)             - shadow-hold (siteDeck filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  findCharInstanceId, dispatch,
  RESOURCE_PLAYER,
  makePlayDeck,
  makeShadowMHState,
  makeBodyCheckCombat,
  companyIdAt,
  setCharStatus,
  enqueueTransferCorruptionCheck,
  getCharacter,
  ARAGORN, RIVENDELL,
} from '../test-helpers.js';
import { computeLegalActions, Phase, CardStatus, Alignment } from '../../index.js';
import type { CardDefinitionId, CorruptionCheckAction, GameState } from '../../index.js';

const ORC_TRACKER = 'le-34' as CardDefinitionId;
const RED_BOOK = 'le-339' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const HOARMURATH = 'le-53' as CardDefinitionId;       // minion ringwraith (attacker filler)
const MORIA = 'le-392' as CardDefinitionId;           // shadow-hold (siteDeck filler)

describe('Orc Tracker (le-34)', () => {
  beforeEach(() => resetMint());

  // ── Effect: -1 corruption check modifier ────────────────────────────────────

  test('-1 corruption modifier increases need on pending corruption check', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: ORC_TRACKER, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const trackerId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_TRACKER);
    const itemInstId = getCharacter(state, RESOURCE_PLAYER, ORC_TRACKER).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, trackerId, itemInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(trackerId);
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ── Structural: discardBodyCheck [7, 8] in combat ───────────────────────────
  //
  // Each case builds a wounded Orc Tracker facing a body check, forces the 2d6
  // total via `cheatRollTotal`, and dispatches the body-check-roll resolution
  // made by the attacking player (PLAYER_2).

  test('body-check roll of 7 sends Orc Tracker to the discard pile', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_TRACKER] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
      ],
    });
    const trackerId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_TRACKER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, ORC_TRACKER, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: trackerId }),
      cheatRollTotal: 7, // 7 ∈ discardBodyCheck → discard pile
    };
    const s = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 8, explanation: 'test' });

    expect(s.players[0].characters[trackerId as string]).toBeUndefined();
    expect(s.players[0].discardPile.some(c => c.definitionId === ORC_TRACKER)).toBe(true);
    expect(s.players[0].outOfPlayPile.some(c => c.definitionId === ORC_TRACKER)).toBe(false);
  });

  test('body-check roll of 8 sends Orc Tracker to the discard pile', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_TRACKER] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
      ],
    });
    const trackerId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_TRACKER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, ORC_TRACKER, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: trackerId }),
      cheatRollTotal: 8, // 8 ∈ discardBodyCheck → discard pile
    };
    const s = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 8, explanation: 'test' });

    expect(s.players[0].characters[trackerId as string]).toBeUndefined();
    expect(s.players[0].discardPile.some(c => c.definitionId === ORC_TRACKER)).toBe(true);
    expect(s.players[0].outOfPlayPile.some(c => c.definitionId === ORC_TRACKER)).toBe(false);
  });

  test('body-check roll of 9 eliminates (out-of-play), not the printed 7/8 discard', () => {
    // 9 > body 8 and is not in discardBodyCheck {7,8}: the orc is eliminated to
    // the out-of-play pile, confirming only 7/8 trigger the discard-pile path.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_TRACKER] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
      ],
    });
    const trackerId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_TRACKER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, ORC_TRACKER, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: trackerId }),
      cheatRollTotal: 9, // 9 > body 8, ∉ {7,8} → eliminated to out-of-play
    };
    const s = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 8, explanation: 'test' });

    expect(s.players[0].characters[trackerId as string]).toBeUndefined();
    expect(s.players[0].outOfPlayPile.some(c => c.definitionId === ORC_TRACKER)).toBe(true);
    expect(s.players[0].discardPile.some(c => c.definitionId === ORC_TRACKER)).toBe(false);
  });

  test('body-check roll of 6 leaves Orc Tracker wounded but in play', () => {
    // 6 <= body 8 and not in {7,8}: the wound stands but the orc survives in play.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_TRACKER] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
      ],
    });
    const trackerId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_TRACKER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, ORC_TRACKER, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: trackerId }),
      cheatRollTotal: 6, // 6 <= body 8, ∉ {7,8} → wounded, stays in play
    };
    const s = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 8, explanation: 'test' });

    expect(s.players[0].characters[trackerId as string]).toBeDefined();
    expect(s.players[0].discardPile.some(c => c.definitionId === ORC_TRACKER)).toBe(false);
    expect(s.players[0].outOfPlayPile.some(c => c.definitionId === ORC_TRACKER)).toBe(false);
  });
});
