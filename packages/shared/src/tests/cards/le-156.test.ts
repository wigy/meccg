/**
 * @module le-156.test
 *
 * Card test: War-warg (le-156)
 * Type: minion-resource-ally
 * Alignment: ringwraith
 * Stats: prowess 3, body 6, mind 1, 1 MP (ally)
 *
 * Card text:
 *   "Playable at any tapped or untapped Ruins & Lairs [{R}] with a Wolf
 *    automatic-attack. If the War-warg and its controlling character are
 *    both targets of strikes from the same attack, you may tap War-warg to
 *    give +2 body to its controlling character."
 *
 * Effects:
 *   1. play-flag: playable-at-tapped-site — playable at a tapped site (in
 *      addition to untapped, the default)
 *   2. ally-body-check-boost — tap (self) to add +2 to the controlling
 *      character's effective body for the pending body check, offered only
 *      when the ally itself was also struck by the same attack
 *   + playableAt: [{ siteType: "ruins-and-lairs", when: Wolf auto-attack }]
 *
 * | # | Rule                                                       | Status | Notes                                                   |
 * |---|-------------------------------------------------------------|--------|----------------------------------------------------------|
 * | 1 | Playable at any R&L with a Wolf automatic-attack, tapped     | OK     | playableAt siteType + when(site.autoAttack.race) + flag  |
 * |   | or untapped                                                  |        |                                                            |
 * | 2 | NOT playable at a R&L without a Wolf automatic-attack        | OK     | playableAt `when` clause excludes non-matching sites      |
 * | 3 | Tap War-warg to give +2 body to controlling character, only  | OK     | ally-body-check-boost, gated on both being struck by the  |
 * |   | when both are targets of strikes from the same attack        |        | same attack (checked structurally in the legal-action      |
 * |   |                                                               |        | generator and re-verified in the reducer)                  |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  resetMint, buildTestState, buildSitePhaseState,
  attachAllyToChar, getCharacter, findCharInstanceId, setCharStatus,
  companyIdAt, viableActions, dispatch,
  makeBodyCheckCombat, makeShadowMHState,
  Phase, CardStatus,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState,
  PlayHeroResourceAction, CombatState,
} from '../../index.js';

const WAR_WARG = 'le-156' as CardDefinitionId;

// Minion character to bear the ally (man, prowess 5, body 7).
const ASTERNAK = 'le-1' as CardDefinitionId;

// A Ruins & Lairs site with a Wolf automatic-attack (required keying).
const OST_IN_EDHIL = 'le-397' as CardDefinitionId;
// A Ruins & Lairs site WITHOUT a Wolf automatic-attack (control).
const BANDIT_LAIR = 'le-351' as CardDefinitionId;

const LORIEN = 'tw-410' as CardDefinitionId;
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;

describe('War-warg (le-156)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1 & 2: playable at a R&L with a Wolf automatic-attack ───────────

  test('IS playable at an untapped Ruins & Lairs with a Wolf automatic-attack', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: OST_IN_EDHIL,
      hand: [WAR_WARG],
    });
    const allyInst = state.players[0].hand[0].instanceId;
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === allyInst);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('IS also playable at a TAPPED Ruins & Lairs with a Wolf automatic-attack', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: OST_IN_EDHIL,
      hand: [WAR_WARG],
      siteStatus: CardStatus.Tapped,
    });
    const allyInst = state.players[0].hand[0].instanceId;
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === allyInst);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a Ruins & Lairs without a Wolf automatic-attack', () => {
    const state = buildSitePhaseState({
      characters: [ASTERNAK],
      site: BANDIT_LAIR,
      hand: [WAR_WARG],
    });
    const allyInst = state.players[0].hand[0].instanceId;
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'play-hero-resource')
      .map(a => a.action as PlayHeroResourceAction)
      .filter(a => a.cardInstanceId === allyInst);
    expect(playActions).toHaveLength(0);
  });

  // ─── Rule 3: tap War-warg to give +2 body, only when both are struck ──────

  /**
   * Build a body-check-phase combat where Asternak (already wounded by a
   * strike) faces the pending body check, with War-warg attached and,
   * optionally, also a target of a strike from the same attack (a second,
   * already-resolved strike assignment on the ally's own instance ID).
   */
  function buildBodyCheckState(opts: { allyAlsoStruck: boolean }): { state: GameState; charId: CardInstanceId; allyInst: CardInstanceId } {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: OST_IN_EDHIL, characters: [ASTERNAK] }], hand: [], siteDeck: [BANDIT_LAIR] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, ASTERNAK, WAR_WARG);
    const charId = findCharInstanceId(withAlly, RESOURCE_PLAYER, ASTERNAK);
    const allyInst = getCharacter(withAlly, RESOURCE_PLAYER, ASTERNAK).allies[0].instanceId;
    const wounded = setCharStatus(withAlly, RESOURCE_PLAYER, ASTERNAK, CardStatus.Inverted);

    const charCombat = makeBodyCheckCombat({ companyId: companyIdAt(wounded, RESOURCE_PLAYER), characterId: charId });
    const combat: CombatState = opts.allyAlsoStruck
      ? {
          ...charCombat,
          strikesTotal: 2,
          strikeAssignments: [
            ...charCombat.strikeAssignments,
            { characterId: allyInst, excessStrikes: 0, resolved: true, result: 'wounded' },
          ],
        }
      : charCombat;

    return {
      state: { ...wounded, phaseState: makeShadowMHState(), combat },
      charId,
      allyInst,
    };
  }

  test('the tap-ally-body-check-boost action IS offered when both War-warg and its controlling character are struck', () => {
    const { state, allyInst } = buildBodyCheckState({ allyAlsoStruck: true });
    const actions = viableActions(state, PLAYER_1, 'tap-ally-body-check-boost')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === allyInst);
    expect(actions).toHaveLength(1);
  });

  test('the action is NOT offered when War-warg was not also struck by the same attack', () => {
    const { state, allyInst } = buildBodyCheckState({ allyAlsoStruck: false });
    const actions = viableActions(state, PLAYER_1, 'tap-ally-body-check-boost')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === allyInst);
    expect(actions).toHaveLength(0);
  });

  test('tapping War-warg adds +2 to the body-check "need" and taps the ally', () => {
    const { state, allyInst } = buildBodyCheckState({ allyAlsoStruck: true });

    const [beforeRoll] = viableActions(state, PLAYER_2, 'body-check-roll');
    expect((beforeRoll.action as { need: number }).need).toBe(8); // body 7 + 1

    const after = dispatch(state, { type: 'tap-ally-body-check-boost', player: PLAYER_1, cardInstanceId: allyInst });

    const allyAfter = getCharacter(after, RESOURCE_PLAYER, ASTERNAK).allies.find(a => a.instanceId === allyInst);
    expect(allyAfter?.status).toBe(CardStatus.Tapped);

    const [afterRoll] = viableActions(after, PLAYER_2, 'body-check-roll');
    expect((afterRoll.action as { need: number }).need).toBe(10); // body 7 + 2 (boost) + 1
  });

  test('the boost is no longer offered once War-warg is tapped', () => {
    const { state, allyInst } = buildBodyCheckState({ allyAlsoStruck: true });
    const after = dispatch(state, { type: 'tap-ally-body-check-boost', player: PLAYER_1, cardInstanceId: allyInst });
    const again = viableActions(after, PLAYER_1, 'tap-ally-body-check-boost')
      .filter(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === allyInst);
    expect(again).toHaveLength(0);
  });

  test('the boost flips a real body-check outcome: without it, a roll of 9 eliminates the body-7 character', () => {
    const { state, charId } = buildBodyCheckState({ allyAlsoStruck: true });
    const ready = { ...state, cheatRollTotal: 9 };
    const [bodyCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
    const after = dispatch(ready, bodyCheck.action);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === charId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).not.toContain(charId);
  });

  test('the boost flips a real body-check outcome: tapping War-warg first, the same roll of 9 survives', () => {
    const { state, charId, allyInst } = buildBodyCheckState({ allyAlsoStruck: true });
    const boosted = dispatch(state, { type: 'tap-ally-body-check-boost', player: PLAYER_1, cardInstanceId: allyInst });
    const ready = { ...boosted, cheatRollTotal: 9 };
    const [bodyCheck] = viableActions(ready, PLAYER_2, 'body-check-roll');
    const after = dispatch(ready, bodyCheck.action);
    // Effective body 7 + 2 = 9, roll 9 is not greater than 9 → survives.
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === charId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toContain(charId);
  });
});
