/**
 * @module dm-96.test
 *
 * Card test: Twisted Tales (dm-96)
 * Type: hazard-event (short)
 *
 * "Playable on an untapped diplomat agent. Tap the agent who may then make an
 * influence attempt against a faction playable at the agent's site. +6 to
 * influence attempt. Attempt is automatically successful if target faction is
 * playable at the agent's home site. Cannot be played if your opponent is a
 * minion player."
 *
 * Card shape:
 *   - effects[0]: agent-tap-faction-influence
 *     (agentFilter: target.skills $includes "diplomat", attemptBonus 6,
 *      autoSuccessAtHomeSite true)
 *
 * Engine support:
 *   - Legal actions (legal-actions/movement-hazard.ts): one `play-hazard` per
 *     (untapped agent matching `agentFilter`, opponent in-play faction playable
 *     at that agent's current site). Gated off against a minion opponent
 *     (isMinionOrBalrog).
 *   - Reducer (mh-agents.ts handleAgentTapFactionInfluence): taps AND reveals
 *     the agent (declaring an influence attempt reveals it, rule 10.14),
 *     discards the event, counts the hazard, and enqueues the standard
 *     `opponent-influence-defend` resolution carrying the rule-10.14 bonuses
 *     (+2 DI at a home site; faction playable at a home site → value 0, +2 roll)
 *     plus this card's `attemptBonus` as the attempt's `boostModifier`. The
 *     attempt is not an agent action, so `remainingActions` is untouched.
 *   - Resolution (reducer-site.ts resolveOpponentInfluenceDefend): an
 *     `autoSuccess` attempt skips both rolls and seizes (discards) the faction;
 *     otherwise the defender rolls as usual. The defending side is read from
 *     `attempt.targetPlayer`, so an attempt declared by the (non-active) hazard
 *     player discards from the resource player's cards, not its own.
 *
 * Fixtures: hazard player (PLAYER_2, Ringwraith) holds Twisted Tales and a
 * face-down untapped Gergeli (dm-12 — diplomat agent, DI 2, home sites
 * Shrel-Kain / Lake-town / Easterling Camp). The hero opponent (PLAYER_1,
 * Wizard) fields Aragorn + Legolas + Elladan (mind 9+6+4 = 19, so 1 unused
 * general influence) and has a faction in play: Men of Dorwinion (tw-278,
 * playable at Shrel-Kain — Gergeli's first home site, where a face-down agent
 * sits) for the automatic-success case, or Men of Anórien (tw-277, influence 8,
 * playable at Minas Tirith) for the away-from-home rolling case.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, LORIEN,
  buildTestState, resetMint, makeMHState, makeAgent, addCardInPlay,
  dispatch, viableActions, mint,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment, CardStatus,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type {
  GameState, CardDefinitionId, PlayHazardAction, AgentInPlay,
  SiteInPlay, MovementHazardPhaseState, PendingResolution, OpponentInfluenceAttempt,
} from '../../index.js';

const TWISTED_TALES = 'dm-96' as CardDefinitionId;
const GERGELI = 'dm-12' as CardDefinitionId;          // diplomat agent, DI 2
const BILL_FERNY = 'dm-3' as CardDefinitionId;        // agent, no diplomat skill
const ELLADAN = 'tw-143' as CardDefinitionId;         // mind 4
const MEN_OF_DORWINION = 'tw-278' as CardDefinitionId; // hero faction @ Shrel-Kain
const MEN_OF_ANORIEN = 'tw-277' as CardDefinitionId;   // hero faction @ Minas Tirith, influence 8
const RANGERS_OF_THE_NORTH = 'tw-311' as CardDefinitionId; // hero faction @ Bree
const MINAS_TIRITH_MINION = 'le-391' as CardDefinitionId;
const MINION_LORIEN = 'le-388' as CardDefinitionId;

/** The queued influence attempt, or undefined when none was enqueued. */
function queuedAttempt(state: GameState): OpponentInfluenceAttempt | undefined {
  const pending = state.pendingResolutions.find(
    (r: PendingResolution) => r.kind.type === 'opponent-influence-defend',
  );
  if (!pending || pending.kind.type !== 'opponent-influence-defend') return undefined;
  return pending.kind.attempt;
}

describe('Twisted Tales (dm-96)', () => {
  beforeEach(() => resetMint());

  /**
   * Hazard player (PLAYER_2, Ringwraith) holds Twisted Tales and an untapped
   * agent; the hero opponent (PLAYER_1) fields a three-character company and
   * one faction in play.
   */
  function baseState(opts?: {
    agent?: CardDefinitionId;
    agentTapped?: boolean;
    agentSite?: CardDefinitionId;      // site placed on the agent's site stack
    faction?: CardDefinitionId;
    opponentMinion?: boolean;
  }): GameState {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: opts?.opponentMinion ? Alignment.Ringwraith : Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [ARAGORN, LEGOLAS, ELLADAN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINION_LORIEN, characters: [] }],
          hand: [TWISTED_TALES],
          siteDeck: [],
        },
      ],
    });

    const built = makeAgent(opts?.agent ?? GERGELI);
    const agent: AgentInPlay = {
      ...built,
      character: {
        ...built.character,
        status: opts?.agentTapped ? CardStatus.Tapped : CardStatus.Untapped,
      },
      siteStack: opts?.agentSite
        ? [{ instanceId: mint(), definitionId: opts.agentSite, status: CardStatus.Untapped } as SiteInPlay]
        : [],
      revealed: opts?.agentSite !== undefined,
    };

    const withAgent: GameState = {
      ...state,
      phaseState: makeMHState(),
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], agents: [agent] },
      ] as typeof state.players,
    };

    return addCardInPlay(withAgent, RESOURCE_PLAYER, opts?.faction ?? MEN_OF_DORWINION);
  }

  /** Play Twisted Tales with the only viable play-hazard action. */
  function play(state: GameState): GameState {
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    return dispatch(state, plays[0].action);
  }

  // ─── Playability: "on an untapped diplomat agent" ─────────────────────────

  test('playable on an untapped diplomat agent against an opponent faction playable at the agent site', () => {
    const state = baseState();
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(1);
    const action = plays[0].action as PlayHazardAction;
    const agentId = state.players[HAZARD_PLAYER].agents[0].character.instanceId;
    const factionId = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    expect(action.agentInstanceId).toBe(agentId);
    expect(action.targetFactionInstanceId).toBe(factionId);
  });

  test('NOT playable on an agent without the diplomat skill', () => {
    // Bill Ferny (warrior/scout) sits at Bree, where the Rangers of the North
    // are playable — only the missing diplomat skill blocks the play.
    const state = baseState({ agent: BILL_FERNY, faction: RANGERS_OF_THE_NORTH });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable when the diplomat agent is tapped', () => {
    const state = baseState({ agentTapped: true });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable when no opponent faction is playable at the agent site', () => {
    // Gergeli sits at Shrel-Kain; Men of Anórien is playable at Minas Tirith.
    const state = baseState({ faction: MEN_OF_ANORIEN });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable when the opponent has no faction in play', () => {
    const state = baseState();
    const noFaction: GameState = {
      ...state,
      players: [
        { ...state.players[RESOURCE_PLAYER], cardsInPlay: [] },
        state.players[HAZARD_PLAYER],
      ] as typeof state.players,
    };
    expect(viableActions(noFaction, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable against a minion (Ringwraith) opponent', () => {
    const state = baseState({ opponentMinion: true });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  // ─── "Tap the agent" ──────────────────────────────────────────────────────

  test('playing the card taps and reveals the agent and discards the event', () => {
    const after = play(baseState());
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.character.status).toBe(CardStatus.Tapped);
    expect(agent.revealed).toBe(true);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === TWISTED_TALES)).toBe(true);
  });

  test('the influence attempt is not an agent action (remainingActions untouched) and counts one hazard', () => {
    const state = baseState();
    const before = state.players[HAZARD_PLAYER].agents[0].remainingActions;
    const after = play(state);
    expect(after.players[HAZARD_PLAYER].agents[0].remainingActions).toBe(before);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany)
      .toBe((state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany + 1);
  });

  // ─── "+6 to influence attempt" ────────────────────────────────────────────

  test('the attempt carries the card +6 alongside the rule-10.14 home-site bonuses', () => {
    const attempt = queuedAttempt(play(baseState()))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier).toBe(6);
    // Gergeli DI 2, at his home site Shrel-Kain → +2 (rule 10.14).
    expect(attempt.influencerDI).toBe(4);
    expect(attempt.targetKind).toBe('faction');
    expect(attempt.targetPlayer).toBe(PLAYER_1);
    // Aragorn 9 + Legolas 6 + Elladan 4 = 19 of 20 general influence used.
    expect(attempt.opponentGI).toBe(1);
    // Ringwraith influencing a Wizard player's card.
    expect(attempt.crossAlignmentPenalty).toBe(-5);
  });

  test('the defend action explanation names the target faction, not "?"', () => {
    const state = baseState({ agentSite: MINAS_TIRITH_MINION, faction: MEN_OF_ANORIEN });
    const played = play(state);
    const defend = viableActions(played, PLAYER_1, 'opponent-influence-defend');
    expect(defend).toHaveLength(1);
    const action = defend[0].action as { explanation: string };
    expect(action.explanation).toContain('Men of Anórien');
    expect(action.explanation).not.toContain('?');
  });

  test('away from home the +6 is still applied but the faction keeps its full value', () => {
    // Gergeli revealed at Minas Tirith (not one of his home sites) targeting
    // Men of Anórien (playable there, influence 8).
    const state = baseState({ agentSite: MINAS_TIRITH_MINION, faction: MEN_OF_ANORIEN });
    const attempt = queuedAttempt(play({ ...state, cheatRollTotal: 9 }))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier).toBe(6);
    expect(attempt.autoSuccess).toBeUndefined();
    expect(attempt.targetMind).toBe(8);      // full influence value, not 0
    expect(attempt.influencerDI).toBe(2);    // no +2 home bonus
    expect(attempt.attackerRoll).toBe(9);    // rolled, with no +2 home bonus
  });

  test('the +6 is what carries a marginal attempt: 9 + 2 DI - 1 GI - 2 def - 5 cross + 6 = 9 > 8', () => {
    const state = baseState({ agentSite: MINAS_TIRITH_MINION, faction: MEN_OF_ANORIEN });
    const played = play({ ...state, cheatRollTotal: 9 });
    const factionId = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;

    const defending = { ...played, cheatRollTotal: 2 };
    const defend = viableActions(defending, PLAYER_1, 'opponent-influence-defend');
    expect(defend).toHaveLength(1);
    const resolved = dispatch(defending, defend[0].action);

    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MEN_OF_ANORIEN)).toBe(true);
  });

  test('away from home a poor attempt still fails and the faction stays in play', () => {
    const state = baseState({ agentSite: MINAS_TIRITH_MINION, faction: MEN_OF_ANORIEN });
    const played = play({ ...state, cheatRollTotal: 2 });
    const factionId = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;

    const defending = { ...played, cheatRollTotal: 12 };
    const defend = viableActions(defending, PLAYER_1, 'opponent-influence-defend');
    const resolved = dispatch(defending, defend[0].action);

    // 2 + 2 - 1 - 12 - 5 + 6 = -8, not > 8.
    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(true);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MEN_OF_ANORIEN)).toBe(false);
  });

  // ─── "Automatically successful … playable at the agent's home site" ───────

  test('a faction playable at the agent home site makes the attempt automatic (no attacker roll)', () => {
    const attempt = queuedAttempt(play(baseState()))!;
    expect(attempt.autoSuccess).toBe(true);
    expect(attempt.attackerRoll).toBe(0);   // no roll is made
    expect(attempt.targetMind).toBe(0);     // rule 10.14: value treated as zero
  });

  test('an automatic attempt seizes the faction even on the worst possible defence roll', () => {
    const state = baseState();
    const factionId = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    const played = play(state);

    // cheatRollTotal 12 would be the best defence roll available — it is never used.
    const defending = { ...played, cheatRollTotal: 12 };
    const defend = viableActions(defending, PLAYER_1, 'opponent-influence-defend');
    expect(defend).toHaveLength(1);
    const resolved = dispatch(defending, defend[0].action);

    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === MEN_OF_DORWINION)).toBe(true);
    // The hazard player loses nothing of its own to the seizure.
    expect(resolved.players[HAZARD_PLAYER].discardPile.every(c => c.definitionId !== MEN_OF_DORWINION)).toBe(true);
    expect(resolved.pendingResolutions.some((r: PendingResolution) => r.kind.type === 'opponent-influence-defend')).toBe(false);
    // No dice were consumed: the cheat roll is still armed.
    expect(resolved.cheatRollTotal).toBe(12);
  });
});
