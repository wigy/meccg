/**
 * @module dm-104.test
 *
 * Card test: Your Welcome Is Doubtful (dm-104)
 * Type: hazard-event (short)
 *
 * "Playable on an untapped agent. Tap the agent who may then make an
 * influence attempt against an ally or character. +6 to influence attempt
 * (+10 if the agent is a diplomat). An additional +7 to the attempt if
 * target character has the same home site as the agent or if target ally is
 * playable at the agent's home site. Cannot be played if your opponent is a
 * minion player."
 *
 * Card shape:
 *   - effects[0]: agent-tap-opponent-influence
 *     (targetKinds: ["character", "ally"], attemptBonus 6,
 *      diplomatAttemptBonus 10, homeSiteBonus 7)
 *
 * Engine support:
 *   - Legal actions (legal-actions/movement-hazard.ts): one `play-hazard` per
 *     (untapped agent matching the card's `agentFilter` — none here, so any
 *     untapped agent) x (opponent character not an avatar, or opponent ally),
 *     independent of the active company (mirrors Pilfer Anything Unwatched).
 *     Gated off against a minion opponent (isMinionOrBalrog).
 *   - Reducer (mh-agents.ts handleAgentTapOpponentInfluence): taps AND
 *     reveals the agent (declaring an influence attempt reveals it, rule
 *     10.14), discards the event, counts the hazard, and enqueues the
 *     standard `opponent-influence-defend` resolution carrying the rule-10.14
 *     bonuses (+2 DI at a home site; target mind 0 + 2 roll when a character
 *     shares a home site with the agent, or an ally is playable at one of the
 *     agent's home sites) plus this card's own `boostModifier`: attemptBonus
 *     (or diplomatAttemptBonus for a diplomat agent) plus homeSiteBonus under
 *     that same shared-home-site condition. Not an agent action, so
 *     `remainingActions` is untouched.
 *   - Resolution (reducer-site.ts resolveOpponentInfluenceDefend): standard
 *     opponent-influence roll-off; on success the target character/ally is
 *     discarded from the opponent's play.
 *
 * Fixtures: hazard player (PLAYER_2, Ringwraith) holds Your Welcome Is
 * Doubtful and a face-down untapped agent — either Bill Ferny (dm-3, no
 * diplomat skill, home sites Bree / Cameth Brin) or Gergeli (dm-12, diplomat,
 * DI 2, home sites Shrel-Kain / Lake-town / Easterling Camp). The hero
 * opponent (PLAYER_1, Wizard) fields a company whose members vary by test:
 * Legolas (tw-143... actually tw-168, mind 6, home Thranduil's Halls — no
 * overlap with either agent's home sites) for the baseline cases, or Bard
 * Bowman (tw-124, mind 2, home Lake-town — shares a home site with Gergeli)
 * for the shared-home-site case. Bill the Pony (tw-198, playable at Bree /
 * Bag End — shares a home site with Bill Ferny) is attached as an ally for
 * the ally-home-site case.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  LEGOLAS, LORIEN, BARD_BOWMAN,
  buildTestState, resetMint, makeMHState, makeAgent, attachAllyToChar,
  dispatch, viableActions, mint, findCharInstanceId, getCharacter,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment, CardStatus,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type {
  GameState, CardDefinitionId, PlayHazardAction, AgentInPlay,
  SiteInPlay, MovementHazardPhaseState, PendingResolution, OpponentInfluenceAttempt,
} from '../../index.js';

const YOUR_WELCOME = 'dm-104' as CardDefinitionId;
const BILL_FERNY = 'dm-3' as CardDefinitionId;   // agent, no diplomat, home Bree / Cameth Brin
const GERGELI = 'dm-12' as CardDefinitionId;     // diplomat agent, DI 2, home Shrel-Kain / Lake-town / Easterling Camp
const BILL_THE_PONY = 'tw-198' as CardDefinitionId; // ally, mind 1, playable at Bree / Bag End
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

describe('Your Welcome Is Doubtful (dm-104)', () => {
  beforeEach(() => resetMint());

  /**
   * Hazard player (PLAYER_2, Ringwraith) holds Your Welcome Is Doubtful and
   * an untapped agent; the hero opponent (PLAYER_1) fields a company.
   */
  function baseState(opts?: {
    agent?: CardDefinitionId;
    agentTapped?: boolean;
    agentSite?: CardDefinitionId;      // site placed on the agent's site stack
    characters?: CardDefinitionId[];
    allyOn?: CardDefinitionId;         // character to attach Bill the Pony to
    opponentMinion?: boolean;
  }): GameState {
    const characters = opts?.characters ?? [LEGOLAS];
    let state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: opts?.opponentMinion ? Alignment.Ringwraith : Alignment.Wizard,
          companies: [{ site: LORIEN, characters }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINION_LORIEN, characters: [] }],
          hand: [YOUR_WELCOME],
          siteDeck: [],
        },
      ],
    });

    const built = makeAgent(opts?.agent ?? BILL_FERNY);
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

    state = {
      ...state,
      phaseState: makeMHState(),
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], agents: [agent] },
      ] as typeof state.players,
    };

    if (opts?.allyOn) {
      state = attachAllyToChar(state, RESOURCE_PLAYER, opts.allyOn, BILL_THE_PONY);
    }

    return state;
  }

  /** Play Your Welcome Is Doubtful targeting a specific character or ally. */
  function playAgainst(state: GameState, opts: { targetCharacterId?: import('../../index.js').CardInstanceId; targetAllyId?: import('../../index.js').CardInstanceId }): GameState {
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const match = plays.find(p => {
      const a = p.action as PlayHazardAction;
      if (opts.targetCharacterId) return a.targetCharacterId === opts.targetCharacterId;
      if (opts.targetAllyId) return a.targetAllyId === opts.targetAllyId;
      return false;
    });
    expect(match).toBeDefined();
    return dispatch(state, match!.action);
  }

  // ─── Playability: "on an untapped agent … against an ally or character" ──

  test('offers one play-hazard action per opponent character (non-avatar) and per ally', () => {
    const state = baseState({ characters: [LEGOLAS], allyOn: LEGOLAS });
    const plays = viableActions(state, PLAYER_2, 'play-hazard');
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const allyId = getCharacter(state, RESOURCE_PLAYER, LEGOLAS).allies[0].instanceId;

    const charPlays = plays.filter(p => (p.action as PlayHazardAction).targetCharacterId === legolasId);
    const allyPlays = plays.filter(p => (p.action as PlayHazardAction).targetAllyId === allyId);
    expect(charPlays).toHaveLength(1);
    expect(allyPlays).toHaveLength(1);
    expect((charPlays[0].action as PlayHazardAction).agentInstanceId)
      .toBe(state.players[HAZARD_PLAYER].agents[0].character.instanceId);
  });

  test('NOT playable — no untapped agent to pay the tap cost', () => {
    const state = baseState({ agentTapped: true });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('NOT playable against a minion (Ringwraith) opponent', () => {
    const state = baseState({ opponentMinion: true });
    expect(viableActions(state, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('any agent may play it — no diplomat restriction on eligibility', () => {
    // Bill Ferny (warrior/scout, no diplomat) is still offered a play.
    const state = baseState({ agent: BILL_FERNY });
    expect(viableActions(state, PLAYER_2, 'play-hazard').length).toBeGreaterThan(0);
  });

  // ─── "Tap the agent" ──────────────────────────────────────────────────────

  test('playing the card taps and reveals the agent and discards the event', () => {
    const state = baseState();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const after = playAgainst(state, { targetCharacterId: legolasId });
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.character.status).toBe(CardStatus.Tapped);
    expect(agent.revealed).toBe(true);
    expect(after.players[HAZARD_PLAYER].hand).toHaveLength(0);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === YOUR_WELCOME)).toBe(true);
  });

  test('the influence attempt is not an agent action and counts one hazard', () => {
    const state = baseState();
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const before = state.players[HAZARD_PLAYER].agents[0].remainingActions;
    const after = playAgainst(state, { targetCharacterId: legolasId });
    expect(after.players[HAZARD_PLAYER].agents[0].remainingActions).toBe(before);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany)
      .toBe((state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany + 1);
  });

  // ─── "+6 to influence attempt (+10 if the agent is a diplomat)" ───────────

  test('a non-diplomat agent away from home gets +6, target keeps full mind', () => {
    const state = baseState({ agent: BILL_FERNY, agentSite: MINAS_TIRITH_MINION, characters: [LEGOLAS] });
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const attempt = queuedAttempt(playAgainst(state, { targetCharacterId: legolasId }))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier).toBe(6);
    expect(attempt.influencerDI).toBe(1);   // Bill Ferny DI 1, away from home: no +2
    expect(attempt.targetMind).toBe(6);     // Legolas' full mind — no shared home site
    expect(attempt.targetKind).toBe('character');
  });

  test('a diplomat agent away from home gets +10 instead of +6', () => {
    const state = baseState({ agent: GERGELI, agentSite: MINAS_TIRITH_MINION, characters: [LEGOLAS] });
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const attempt = queuedAttempt(playAgainst(state, { targetCharacterId: legolasId }))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier).toBe(10);
    expect(attempt.influencerDI).toBe(2);   // Gergeli DI 2, away from home: no +2
  });

  // ─── "An additional +7 … target character has the same home site" ────────

  test('a shared home site adds +7 on top of the diplomat bonus, and zeroes the target mind', () => {
    // Gergeli (diplomat, home Shrel-Kain/Lake-town/Easterling Camp, defaults
    // to standing at his first home site) vs Bard Bowman (home Lake-town).
    const state = baseState({ agent: GERGELI, characters: [BARD_BOWMAN] });
    const bardId = findCharInstanceId(state, RESOURCE_PLAYER, BARD_BOWMAN);
    const attempt = queuedAttempt(playAgainst(state, { targetCharacterId: bardId }))!;
    expect(attempt).toBeDefined();
    expect(attempt.boostModifier).toBe(17); // 10 (diplomat) + 7 (shared home)
    expect(attempt.influencerDI).toBe(4);   // Gergeli DI 2, at home: +2
    expect(attempt.targetMind).toBe(0);     // rule 10.14: shared home site → mind 0
  });

  test('the +2 rule-10.14 roll bonus rides alongside the card boost when home sites are shared', () => {
    const state = baseState({ agent: GERGELI, characters: [BARD_BOWMAN] });
    const bardId = findCharInstanceId(state, RESOURCE_PLAYER, BARD_BOWMAN);
    const attempt = queuedAttempt(playAgainst({ ...state, cheatRollTotal: 7 }, { targetCharacterId: bardId }))!;
    // Roll 7 (two dice summing to 7 via the cheat roll) + rule-10.14 +2 roll bonus = 9.
    expect(attempt.attackerRoll).toBe(9);
  });

  // ─── "… or if target ally is playable at the agent's home site" ──────────

  test('an ally playable at the agent home site adds +7 and zeroes its mind', () => {
    // Bill Ferny (home Bree/Cameth Brin, defaults to Bree) + Bill the Pony
    // (playable at Bree/Bag End).
    const state = baseState({ agent: BILL_FERNY, characters: [LEGOLAS], allyOn: LEGOLAS });
    const allyId = getCharacter(state, RESOURCE_PLAYER, LEGOLAS).allies[0].instanceId;
    const attempt = queuedAttempt(playAgainst(state, { targetAllyId: allyId }))!;
    expect(attempt).toBeDefined();
    expect(attempt.targetKind).toBe('ally');
    expect(attempt.boostModifier).toBe(13); // 6 (base, no diplomat) + 7 (ally playable at home)
    expect(attempt.influencerDI).toBe(3);   // Bill Ferny DI 1, at home: +2
    expect(attempt.targetMind).toBe(0);     // ally playable at agent's home site → mind 0
  });

  // ─── Resolution: success discards the target ─────────────────────────────

  test('a successful attempt discards the target character from the opponent', () => {
    const state = baseState({ agent: GERGELI, characters: [BARD_BOWMAN] });
    const bardId = findCharInstanceId(state, RESOURCE_PLAYER, BARD_BOWMAN);
    const played = playAgainst({ ...state, cheatRollTotal: 9 }, { targetCharacterId: bardId });

    const defending = { ...played, cheatRollTotal: 2 };
    const defend = viableActions(defending, PLAYER_1, 'opponent-influence-defend');
    expect(defend).toHaveLength(1);
    const resolved = dispatch(defending, defend[0].action);

    expect(resolved.players[RESOURCE_PLAYER].characters[bardId]).toBeUndefined();
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === BARD_BOWMAN)).toBe(true);
  });

  test('a failed attempt leaves the target in place', () => {
    const state = baseState({ agent: BILL_FERNY, agentSite: MINAS_TIRITH_MINION, characters: [LEGOLAS] });
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const played = playAgainst({ ...state, cheatRollTotal: 2 }, { targetCharacterId: legolasId });

    const defending = { ...played, cheatRollTotal: 12 };
    const defend = viableActions(defending, PLAYER_1, 'opponent-influence-defend');
    const resolved = dispatch(defending, defend[0].action);

    expect(resolved.players[RESOURCE_PLAYER].characters[legolasId]).toBeDefined();
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === LEGOLAS)).toBe(false);
  });
});
