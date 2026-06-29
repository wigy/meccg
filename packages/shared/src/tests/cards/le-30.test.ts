/**
 * @module le-30.test
 *
 * Card test: Orc Brawler (le-30)
 * Type: minion-character (ringwraith alignment)
 * Stats: Orc warrior, prowess 3, body 8, mind 1, DI 0, MP 0
 * Homesite: Any Dark-hold
 *
 * Card text:
 *   "Discard on a body check result of 7 or 8. -1 to all corruption checks."
 *
 * (The English text abbreviates "all corruption checks"; the Spanish/French
 * printings read "all of his corruption checks" — the modifier is scoped to
 * this character's own checks, like Orc Tracker le-34 / Orc Veteran le-35.)
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
 *   ORC_BRAWLER (le-30)        - minion orc warrior, body 8, discardBodyCheck [7,8]
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

const ORC_BRAWLER = 'le-30' as CardDefinitionId;
const RED_BOOK = 'le-339' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // minion haven
const HOARMURATH = 'le-53' as CardDefinitionId;       // minion ringwraith (attacker filler)
const MORIA = 'le-392' as CardDefinitionId;           // shadow-hold (siteDeck filler)

describe('Orc Brawler (le-30)', () => {
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
          companies: [{ site: DOL_GULDUR, characters: [{ defId: ORC_BRAWLER, items: [RED_BOOK] }] }],
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

    const brawlerId = findCharInstanceId(state, RESOURCE_PLAYER, ORC_BRAWLER);
    const itemInstId = getCharacter(state, RESOURCE_PLAYER, ORC_BRAWLER).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, brawlerId, itemInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(brawlerId);
    expect(ccActions[0].corruptionModifier).toBe(-1);
    // need = CP + 1 - modifier. With modifier -1, need = CP + 2.
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - (-1));
  });

  // ── Structural: discardBodyCheck [7, 8] in combat ───────────────────────────
  //
  // Each case builds a wounded Orc Brawler facing a body check, forces the 2d6
  // total via `cheatRollTotal`, and dispatches the body-check-roll resolution
  // made by the attacking player (PLAYER_2).

  test('body-check roll of 7 sends Orc Brawler to the discard pile', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
      ],
    });
    const brawlerId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_BRAWLER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, ORC_BRAWLER, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: brawlerId }),
      cheatRollTotal: 7, // 7 ∈ discardBodyCheck → discard pile
    };
    const s = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 8, explanation: 'test' });

    expect(s.players[0].characters[brawlerId]).toBeUndefined();
    expect(s.players[0].discardPile.some(c => c.definitionId === ORC_BRAWLER)).toBe(true);
    expect(s.players[0].outOfPlayPile.some(c => c.definitionId === ORC_BRAWLER)).toBe(false);
  });

  test('body-check roll of 8 sends Orc Brawler to the discard pile', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
      ],
    });
    const brawlerId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_BRAWLER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, ORC_BRAWLER, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: brawlerId }),
      cheatRollTotal: 8, // 8 ∈ discardBodyCheck → discard pile
    };
    const s = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 8, explanation: 'test' });

    expect(s.players[0].characters[brawlerId]).toBeUndefined();
    expect(s.players[0].discardPile.some(c => c.definitionId === ORC_BRAWLER)).toBe(true);
    expect(s.players[0].outOfPlayPile.some(c => c.definitionId === ORC_BRAWLER)).toBe(false);
  });

  test('body-check roll of 9 eliminates (out-of-play), not the printed 7/8 discard', () => {
    // 9 > body 8 and is not in discardBodyCheck {7,8}: the orc is eliminated to
    // the out-of-play pile, confirming only 7/8 trigger the discard-pile path.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
      ],
    });
    const brawlerId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_BRAWLER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, ORC_BRAWLER, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: brawlerId }),
      cheatRollTotal: 9, // 9 > body 8, ∉ {7,8} → eliminated to out-of-play
    };
    const s = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 8, explanation: 'test' });

    expect(s.players[0].characters[brawlerId]).toBeUndefined();
    expect(s.players[0].outOfPlayPile.some(c => c.definitionId === ORC_BRAWLER)).toBe(true);
    expect(s.players[0].discardPile.some(c => c.definitionId === ORC_BRAWLER)).toBe(false);
  });

  test('body-check roll of 6 leaves Orc Brawler wounded but in play', () => {
    // 6 <= body 8 and not in {7,8}: the wound stands but the orc survives in play.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_BRAWLER] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [HOARMURATH] }], hand: [], siteDeck: [MORIA], playDeck: makePlayDeck() },
      ],
    });
    const brawlerId = findCharInstanceId(base, RESOURCE_PLAYER, ORC_BRAWLER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const wounded = setCharStatus(base, RESOURCE_PLAYER, ORC_BRAWLER, CardStatus.Inverted);
    const readyState: GameState = {
      ...wounded,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: brawlerId }),
      cheatRollTotal: 6, // 6 <= body 8, ∉ {7,8} → wounded, stays in play
    };
    const s = dispatch(readyState, { type: 'body-check-roll', player: PLAYER_2, need: 8, explanation: 'test' });

    expect(s.players[0].characters[brawlerId]).toBeDefined();
    expect(s.players[0].discardPile.some(c => c.definitionId === ORC_BRAWLER)).toBe(false);
    expect(s.players[0].outOfPlayPile.some(c => c.definitionId === ORC_BRAWLER)).toBe(false);
  });
});
