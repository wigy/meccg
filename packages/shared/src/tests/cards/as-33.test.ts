/**
 * @module as-33.test
 *
 * Card test: Pilfer Anything Unwatched (as-33)
 * Type: hazard-event (short)
 *
 * "Playable on an untapped agent. Tap the agent. Make a roll for a character in
 * play of your choice with a home site the same as the agent's current site. To
 * the roll add 5 if the agent's current site is also the agent's home site. If
 * the result is greater than the character's mind plus 5, the character is
 * returned to his player's hand (one item may be transferred to another
 * character in the same company). Cannot be played if your opponent is a minion
 * player."
 *
 * Card shape:
 *   - effects[0]: agent-tap-return-character (atHomeSiteBonus:5, mindBonus:5)
 *
 * Engine support:
 *   - Legal actions (legal-actions/movement-hazard.ts): played on one of the
 *     hazard player's untapped agents, offering one (agent, target) pair per
 *     opponent character in play whose home site matches the agent's current
 *     site. Gated off against a minion opponent (isMinionOrBalrog).
 *   - Reducer (mh-agents.ts handleAgentTapReturnCharacter): taps the agent,
 *     discards the event, counts the hazard, and enqueues a generic `dice-check`
 *     pending resolution — the hazard player rolls 2d6 (+5 when the agent is at
 *     its home site) vs the target's mind + 5 (strict `gt`). On a pass the
 *     `return-character-to-hand` branch returns the opponent's character (a
 *     cross-owner return the branch now resolves by locating the owner).
 *   - Item transfer: `returnCharacterToHand` (with allowItemTransfer) enqueues a
 *     `transfer-returned-item` resolution so the owner may pull one discarded
 *     item back onto a company-mate, or decline.
 *
 * Fixtures: hazard player (PLAYER_2) holds Bill Ferny (dm-3, an agent whose home
 * is Bree) and Pilfer; the hero opponent (PLAYER_1) fields Beretar (tw-128,
 * home Bree, mind 5) so a face-down Bill Ferny sitting at home (Bree) targets
 * him with a +5 bonus and a threshold of mind 5 + 5 = 10.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, DAGGER_OF_WESTERNESSE,
  LORIEN, RIVENDELL,
  buildTestState, resetMint, makeMHState, makeBillFernyAgent,
  dispatch, viableActions, findCharInstanceId, mint,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment, CardStatus,
  attachItemToChar,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { GameState, CardDefinitionId, PlayHazardAction, AgentInPlay, SiteInPlay, MovementHazardPhaseState } from '../../index.js';

const PILFER = 'as-33' as CardDefinitionId;
const BERETAR = 'tw-128' as CardDefinitionId;   // home Bree, mind 5
const ELLADAN = 'tw-143' as CardDefinitionId;   // home Rivendell, mind 4

describe('Pilfer Anything Unwatched (as-33)', () => {
  beforeEach(() => resetMint());

  /**
   * Hazard player (PLAYER_2, minion) holds Pilfer + a face-down untapped Bill
   * Ferny agent sitting at home (Bree, empty site stack). Hero opponent
   * (PLAYER_1) fields Beretar (home Bree) alongside a non-Bree companion so
   * only Beretar is a legal target.
   */
  function baseState(opts?: {
    agentTapped?: boolean;
    withItem?: boolean;
    opponentMinion?: boolean;
    companions?: CardDefinitionId[];
  }): GameState {
    const companions = opts?.companions ?? [BERETAR, LEGOLAS];
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          alignment: opts?.opponentMinion ? Alignment.Ringwraith : Alignment.Wizard,
          companies: [{ site: LORIEN, characters: companions }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          companies: [{ site: RIVENDELL, characters: [] }],
          hand: [PILFER],
          siteDeck: [],
        },
      ],
    });

    const agent: AgentInPlay = opts?.agentTapped
      ? { ...makeBillFernyAgent(), character: { ...makeBillFernyAgent().character, status: CardStatus.Tapped } }
      : makeBillFernyAgent();

    let mh: GameState = {
      ...state,
      phaseState: makeMHState(),
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], agents: [agent] },
      ] as typeof state.players,
    };
    if (opts?.withItem) mh = attachItemToChar(mh, RESOURCE_PLAYER, BERETAR, DAGGER_OF_WESTERNESSE);
    return mh;
  }

  /** Play Pilfer targeting Beretar; returns the state with the dice-check queued. */
  function playAgainstBeretar(startState: GameState): GameState {
    const beretarId = findCharInstanceId(startState, RESOURCE_PLAYER, BERETAR);
    const play = viableActions(startState, PLAYER_2, 'play-hazard')
      .find(a => (a.action as PlayHazardAction).targetCharacterId === beretarId);
    expect(play).toBeDefined();
    return dispatch(startState, play!.action);
  }

  // ─── Playability ──────────────────────────────────────────────────────────

  test('playable on an untapped agent, targeting an opponent character sharing the agent home site', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1); // only Beretar (Bree) matches; Legolas does not
    const action = plays[0].action as PlayHazardAction;
    expect(action.agentInstanceId).toBeDefined();
    const beretarId = findCharInstanceId(state, RESOURCE_PLAYER, BERETAR);
    expect(action.targetCharacterId).toBe(beretarId);
  });

  test('only characters whose home site matches the agent site are offered as targets', () => {
    // Two Bree-home characters → two targets; the non-Bree companion is skipped.
    const state = baseState({ companions: [BERETAR, ARAGORN, LEGOLAS] });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(2);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    expect(plays.some(p => (p.action as PlayHazardAction).targetCharacterId === legolasId)).toBe(false);
  });

  test('NOT playable when the agent is tapped', () => {
    const state = baseState({ agentTapped: true });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable when no character in play shares the agent current site', () => {
    const state = baseState({ companions: [LEGOLAS] }); // no Bree-home character
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable against a minion (Ringwraith) opponent', () => {
    const state = baseState({ opponentMinion: true });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── Play resolution ─────────────────────────────────────────────────────

  test('playing the card taps the agent and discards the event', () => {
    const state = baseState();
    const after = playAgainstBeretar(state);
    expect(after.players[HAZARD_PLAYER].agents[0].character.status).toBe(CardStatus.Tapped);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === PILFER)).toBe(true);
  });

  test('playing the card increments the hazard count by one', () => {
    const state = baseState();
    const before = (state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    const after = playAgainstBeretar(state);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
  });

  test('an agent at its home site enqueues a +5 dice-check vs mind + 5 (strict greater)', () => {
    const state = baseState();
    const after = playAgainstBeretar(state);
    const dc = after.pendingResolutions[0];
    expect(dc.kind.type).toBe('dice-check');
    if (dc.kind.type !== 'dice-check') throw new Error('expected dice-check');
    expect(dc.kind.roller).toBe(PLAYER_2);
    expect(dc.kind.modifiers).toEqual([{ kind: 'constant', value: 5 }]);
    expect(dc.kind.threshold).toBe(10); // Beretar mind 5 + 5
    expect(dc.kind.comparison).toBe('gt');
  });

  test('an agent NOT at its home site enqueues no bonus', () => {
    // Bill Ferny revealed at Rivendell (not one of his home sites); target
    // Elladan (home Rivendell, mind 4) → threshold 9, no +5.
    const state = baseState({ companions: [ELLADAN] });
    const rivendellSite: SiteInPlay = { instanceId: mint(), definitionId: RIVENDELL, status: CardStatus.Untapped };
    const roaming: GameState = {
      ...state,
      players: [
        state.players[RESOURCE_PLAYER],
        {
          ...state.players[HAZARD_PLAYER],
          agents: [{ ...makeBillFernyAgent(), revealed: true, siteStack: [rivendellSite] }],
        },
      ] as typeof state.players,
    };
    const elladanId = findCharInstanceId(roaming, RESOURCE_PLAYER, ELLADAN);
    const play = viableActions(roaming, PLAYER_2, 'play-hazard')
      .find(a => (a.action as PlayHazardAction).targetCharacterId === elladanId);
    expect(play).toBeDefined();
    const after = dispatch(roaming, play!.action);
    const dc = after.pendingResolutions[0];
    if (dc.kind.type !== 'dice-check') throw new Error('expected dice-check');
    expect(dc.kind.modifiers).toEqual([]);
    expect(dc.kind.threshold).toBe(9); // Elladan mind 4 + 5
  });

  test('a successful roll returns the target character to its owner hand', () => {
    const state = baseState();
    let after = playAgainstBeretar(state);
    const beretarId = findCharInstanceId(state, RESOURCE_PLAYER, BERETAR);

    // Roll 12 (+5 at home) = 17 > 10 → pass.
    const roll = viableActions({ ...after, cheatRollTotal: 12 }, PLAYER_2, 'resolve-dice-check');
    expect(roll).toHaveLength(1);
    after = dispatch({ ...after, cheatRollTotal: 12 }, roll[0].action);

    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === BERETAR)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].characters[beretarId]).toBeUndefined();
  });

  test('a failed roll leaves the target character in play', () => {
    const state = baseState();
    let after = playAgainstBeretar(state);
    const beretarId = findCharInstanceId(state, RESOURCE_PLAYER, BERETAR);

    // Roll 2 (+5 at home) = 7, not > 10 → fail.
    const roll = viableActions({ ...after, cheatRollTotal: 2 }, PLAYER_2, 'resolve-dice-check');
    after = dispatch({ ...after, cheatRollTotal: 2 }, roll[0].action);

    expect(after.players[RESOURCE_PLAYER].characters[beretarId]).toBeDefined();
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === BERETAR)).toBe(false);
  });

  // ─── Item transfer ────────────────────────────────────────────────────────

  test('on a successful return the owner may transfer one item to a company-mate', () => {
    const state = baseState({ withItem: true });
    let after = playAgainstBeretar(state);
    after = dispatch({ ...after, cheatRollTotal: 12 }, viableActions({ ...after, cheatRollTotal: 12 }, PLAYER_2, 'resolve-dice-check')[0].action);

    const transfers = viableActions(after, PLAYER_1, 'transfer-returned-item');
    // one decline + one (dagger → Legolas) pairing
    expect(transfers.length).toBeGreaterThanOrEqual(2);

    const legolasId = findCharInstanceId(after, RESOURCE_PLAYER, LEGOLAS);
    const transfer = transfers.find(a => {
      const act = a.action as { itemInstanceId?: string; targetCharacterId?: string };
      return act.targetCharacterId === legolasId && act.itemInstanceId;
    });
    expect(transfer).toBeDefined();
    const moved = dispatch(after, transfer!.action);

    const legolas = moved.players[RESOURCE_PLAYER].characters[legolasId];
    expect(legolas.items.some(i => i.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
    expect(moved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DAGGER_OF_WESTERNESSE)).toBe(false);
  });

  test('declining the transfer leaves the item in the discard pile', () => {
    const state = baseState({ withItem: true });
    let after = playAgainstBeretar(state);
    after = dispatch({ ...after, cheatRollTotal: 12 }, viableActions({ ...after, cheatRollTotal: 12 }, PLAYER_2, 'resolve-dice-check')[0].action);

    const transfers = viableActions(after, PLAYER_1, 'transfer-returned-item');
    const decline = transfers.find(a => {
      const act = a.action as { itemInstanceId?: string };
      return !act.itemInstanceId;
    });
    expect(decline).toBeDefined();
    const declined = dispatch(after, decline!.action);

    expect(declined.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === DAGGER_OF_WESTERNESSE)).toBe(true);
    expect(declined.pendingResolutions.some(r => r.kind.type === 'transfer-returned-item')).toBe(false);
  });
});
