/**
 * @module dm-74.test
 *
 * Card test: Never Seen Him (dm-74)
 * Type: hazard-event — permanent-event, non-unique
 * Effects: 3
 *   1. play-target — target: agent (playable on any of the hazard player's own
 *      agents, face-up or face-down)
 *   2. extra-agent-actions — value: 1
 *   3. duplication-limit — scope: agent, max: 1
 *
 * Card text: "Playable on an agent. Target agent may take an extra agent
 *  action (which does not count against the hazard limit) each time he
 *  normally takes an agent action. Cannot be duplicated on a given agent.
 *  Cannot be played if your opponent is a minion player."
 *
 * Engine support:
 *  - A hazard permanent-event played on one of the hazard player's own agents
 *    (`play-target: "agent"`, generalized from Inner Cunning dm-68's
 *    attachment mechanism). Enters cardsInPlay bound to the target agent via
 *    `CardInPlay.attachedToAgentId`.
 *  - `countExtraAgentActions(state, agentId)` (mh-agents.ts) scopes the bonus
 *    action to the one bound agent alone — other agents belonging to the same
 *    (or the opposing) player are unaffected. `reducer-untap.ts` uses this to
 *    set the bound agent's `remainingActions` to 2 each untap; the acting
 *    agent's own action handlers use it to determine which of the agent's
 *    actions this turn are free (don't count against the hazard limit).
 *  - Unlike dm-68 (which discards on reveal), Never Seen Him carries no
 *    `agent-reveal-site-override` marker, so `discardOrphanedAgentAttachedEvents`
 *    leaves it attached through reveal — it only discards once the bound
 *    agent leaves play entirely.
 *  - Guarded by the minion-opponent restriction (isMinionOrBalrog), matching
 *    the other agent-related hazard cards' convention.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, makeAgent,
  viableActions, dispatch, resolveChain,
  findHandCardId, assertEveryInstanceReachable,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment,
} from '../test-helpers.js';
import { Phase, CardStatus, computeLegalActions } from '../../index.js';
import type {
  GameState, CardDefinitionId, CardInstanceId, CompanyId, AgentInPlay, CardInPlay,
  PlayHazardAction, UntapPhaseState,
} from '../../index.js';

const NEVER_SEEN_HIM = 'dm-74' as CardDefinitionId;
// Minion agents (keyword "agent"):
const ANARIN = 'dm-1' as CardDefinitionId;          // home: Moria (minion shadow-hold)
const THE_GRIMBURGOTH = 'dm-15' as CardDefinitionId; // home: Dol Guldur (minion haven)
// Minion sites:
const MORIA_MINION = 'le-392' as CardDefinitionId; // shadow-hold (Anarin's home)

const AGENT_A_ID = 'agent-nsh-a' as CompanyId;
const AGENT_B_ID = 'agent-nsh-b' as CompanyId;

/** A face-down Anarin agent (target of Never Seen Him in most tests). */
const agentA = (opts?: { revealed?: boolean }): AgentInPlay => ({
  ...makeAgent(ANARIN, opts),
  id: AGENT_A_ID,
});

/** A second, unrelated face-down agent — never targeted by Never Seen Him. */
const agentB = (): AgentInPlay => ({
  ...makeAgent(THE_GRIMBURGOTH),
  id: AGENT_B_ID,
});

/**
 * Build an M/H state: PLAYER_1 (resource) is active; PLAYER_2 (hazard, minion)
 * holds Never Seen Him. Caller supplies the hazard player's agents.
 */
const buildState = (opts: {
  resourceAlignment?: Alignment;
  agents?: () => AgentInPlay[];
  hazardSiteDeck?: CardDefinitionId[];
}): GameState => {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: opts.resourceAlignment ?? Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [NEVER_SEEN_HIM],
        siteDeck: opts.hazardSiteDeck ?? [],
      },
    ],
  });
  const withMH: GameState = { ...base, phaseState: makeMHState() };
  if (!opts.agents) return withMH;
  return {
    ...withMH,
    players: [
      withMH.players[RESOURCE_PLAYER],
      { ...withMH.players[HAZARD_PLAYER], agents: opts.agents() },
    ] as typeof withMH.players,
  };
};

/** Play Never Seen Him on the given agent, resolving the chain. */
const playOnAgent = (state: GameState, agentId: CompanyId): GameState => {
  const cardId = findHandCardId(state, HAZARD_PLAYER, NEVER_SEEN_HIM);
  const play = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
    const act = a.action as PlayHazardAction;
    return act.cardInstanceId === cardId && act.targetAgentId === agentId && a.viable;
  });
  expect(play).toBeDefined();
  return resolveChain(dispatch(state, play!.action));
};

describe('Never Seen Him (dm-74)', () => {
  beforeEach(() => resetMint());

  // ─── Play-target: offered per agent ────────────────────────────────────

  test('is playable on each of the hazard player\'s own agents, face-down or face-up', () => {
    const state = buildState({ agents: () => [agentA({ revealed: false }), { ...agentB(), revealed: true }] });
    const cardId = findHandCardId(state, HAZARD_PLAYER, NEVER_SEEN_HIM);
    const plays = viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
      const act = a.action as PlayHazardAction;
      return act.cardInstanceId === cardId && a.viable;
    });
    const targetedAgents = plays.map(a => (a.action as PlayHazardAction).targetAgentId);
    expect(new Set(targetedAgents)).toEqual(new Set([AGENT_A_ID, AGENT_B_ID]));
  });

  test('is not offered when the hazard player has no agents in play', () => {
    const state = buildState({});
    const cardId = findHandCardId(state, HAZARD_PLAYER, NEVER_SEEN_HIM);
    const viable = viableActions(state, PLAYER_2, 'play-hazard').filter(a =>
      (a.action as PlayHazardAction).cardInstanceId === cardId && a.viable,
    );
    expect(viable).toHaveLength(0);
  });

  test('is not playable when the opponent is a minion player', () => {
    const state = buildState({
      resourceAlignment: Alignment.Ringwraith,
      agents: () => [agentA()],
    });
    const cardId = findHandCardId(state, HAZARD_PLAYER, NEVER_SEEN_HIM);
    const viable = viableActions(state, PLAYER_2, 'play-hazard').filter(a =>
      (a.action as PlayHazardAction).cardInstanceId === cardId && a.viable,
    );
    expect(viable).toHaveLength(0);
  });

  // ─── Resolution: attaches to the targeted agent ────────────────────────

  test('resolving it attaches the card to the targeted agent via attachedToAgentId', () => {
    const state = buildState({ agents: () => [agentA(), agentB()] });
    const after = playOnAgent(state, AGENT_A_ID);

    const inPlay = after.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === NEVER_SEEN_HIM);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToAgentId).toBe(AGENT_A_ID);
    assertEveryInstanceReachable(after);
  });

  // ─── Duplication limit: one copy per agent ─────────────────────────────

  test('cannot be duplicated on the same agent, but may target a different one', () => {
    const attached: CardInPlay = {
      instanceId: 'nsh-on-a' as CardInstanceId,
      definitionId: NEVER_SEEN_HIM,
      status: CardStatus.Untapped,
      attachedToAgentId: AGENT_A_ID,
    };
    const base = buildState({ agents: () => [agentA(), agentB()] });
    const state: GameState = {
      ...base,
      players: [
        base.players[RESOURCE_PLAYER],
        { ...base.players[HAZARD_PLAYER], cardsInPlay: [attached] },
      ] as typeof base.players,
    };

    const cardId = findHandCardId(state, HAZARD_PLAYER, NEVER_SEEN_HIM);
    const plays = computeLegalActions(state, PLAYER_2).filter(a =>
      a.action.type === 'play-hazard' && a.action.cardInstanceId === cardId,
    );
    const onA = plays.find(a => (a.action as PlayHazardAction).targetAgentId === AGENT_A_ID);
    const onB = plays.find(a => (a.action as PlayHazardAction).targetAgentId === AGENT_B_ID);
    expect(onA?.viable).toBe(false);
    expect(onB?.viable).toBe(true);
  });

  // ─── Untap: extra action scoped to the bound agent only ────────────────

  describe('untap-phase remainingActions (per-agent scoping)', () => {
    function buildUntapState(cardsInPlay: CardInPlay[]) {
      const base = buildTestState({
        activePlayer: PLAYER_2,
        phase: Phase.Untap,
        players: [
          { id: PLAYER_1, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [] }], hand: [], siteDeck: [RIVENDELL] },
        ],
      });
      const phaseState: UntapPhaseState = {
        phase: Phase.Untap,
        untapped: false,
        hazardSideboardDestination: null,
        hazardSideboardFetched: 0,
        hazardSideboardAccessed: false,
        resourcePlayerPassed: false,
        hazardPlayerPassed: false,
      };
      return {
        ...base,
        players: [
          base.players[0],
          { ...base.players[1], agents: [agentA(), agentB()], cardsInPlay },
        ] as unknown as typeof base.players,
        phaseState,
      };
    }

    test('the bound agent gets 2 remaining actions; the other agent still gets 1', () => {
      const attached: CardInPlay = {
        instanceId: 'nsh-on-a' as CardInstanceId,
        definitionId: NEVER_SEEN_HIM,
        status: CardStatus.Untapped,
        attachedToAgentId: AGENT_A_ID,
      };
      const state = buildUntapState([attached]);
      const after = dispatch(state, { type: 'untap', player: PLAYER_2 });

      const agents = after.players[HAZARD_PLAYER].agents;
      expect(agents.find(a => a.id === AGENT_A_ID)!.remainingActions).toBe(2);
      expect(agents.find(a => a.id === AGENT_B_ID)!.remainingActions).toBe(1);
    });

    test('without Never Seen Him in play, both agents get only 1 remaining action', () => {
      const state = buildUntapState([]);
      const after = dispatch(state, { type: 'untap', player: PLAYER_2 });

      const agents = after.players[HAZARD_PLAYER].agents;
      expect(agents.find(a => a.id === AGENT_A_ID)!.remainingActions).toBe(1);
      expect(agents.find(a => a.id === AGENT_B_ID)!.remainingActions).toBe(1);
    });
  });

  // ─── The extra action is free (doesn't count against the hazard limit) ─

  test('the bound agent\'s second action in a turn does not count against the hazard limit', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA_MINION, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const attached: CardInPlay = {
      instanceId: 'nsh-on-a' as CardInstanceId,
      definitionId: NEVER_SEEN_HIM,
      status: CardStatus.Untapped,
      attachedToAgentId: AGENT_A_ID,
    };
    const agentWith2Actions: AgentInPlay = {
      ...agentA({ revealed: true }),
      character: { ...agentA({ revealed: true }).character, status: CardStatus.Untapped },
      remainingActions: 2,
    };
    const state: GameState = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], agents: [agentWith2Actions], cardsInPlay: [attached] },
      ] as unknown as typeof base.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 5, hazardsPlayedThisCompany: 0 }),
    };

    // First action: key creatures (base action — counts against the hazard limit).
    const keyActions = viableActions(state, PLAYER_2, 'agent-key-creatures');
    expect(keyActions.length).toBeGreaterThan(0);
    const afterFirst = dispatch(state, keyActions[0].action);
    expect(afterFirst.players[HAZARD_PLAYER].agents[0].remainingActions).toBe(1);
    expect((afterFirst.phaseState as { hazardsPlayedThisCompany?: number }).hazardsPlayedThisCompany).toBe(1);

    // Second action: untap (the extra action — free, does not count).
    const untapActions = viableActions(afterFirst, PLAYER_2, 'agent-untap');
    expect(untapActions.length).toBeGreaterThan(0);
    const afterSecond = dispatch(afterFirst, untapActions[0].action);
    expect(afterSecond.players[HAZARD_PLAYER].agents[0].remainingActions).toBe(0);
    expect((afterSecond.phaseState as { hazardsPlayedThisCompany?: number }).hazardsPlayedThisCompany).toBe(1);
  });

  // ─── Persistence: unlike dm-68, stays attached through reveal ──────────

  test('stays attached (does not discard) once the bound agent is revealed', () => {
    const state = buildState({
      agents: () => [{ ...agentA({ revealed: false }), inPlayAtTurnStart: false, remainingActions: 0 }],
      hazardSiteDeck: [MORIA_MINION],
    });
    const attached = playOnAgent(state, AGENT_A_ID);
    expect(attached.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === NEVER_SEEN_HIM)).toBe(true);

    const reveal = viableActions(attached, PLAYER_2, 'reveal-agent').find(a =>
      (a.action as { agentId: CompanyId }).agentId === AGENT_A_ID,
    );
    expect(reveal).toBeDefined();
    const revealed = dispatch(attached, reveal!.action);

    expect(revealed.players[HAZARD_PLAYER].agents[0].revealed).toBe(true);
    // Still in play, still bound — no "discard on reveal" for this card.
    const stillAttached = revealed.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === NEVER_SEEN_HIM);
    expect(stillAttached).toBeDefined();
    expect(stillAttached!.attachedToAgentId).toBe(AGENT_A_ID);
    assertEveryInstanceReachable(revealed);
  });

  // ─── Orphan sweep: discarded once the bound agent leaves play entirely ─

  test('is discarded once its bound agent leaves play entirely', () => {
    const attached: CardInPlay = {
      instanceId: 'nsh-orphan' as CardInstanceId,
      definitionId: NEVER_SEEN_HIM,
      status: CardStatus.Untapped,
      attachedToAgentId: AGENT_A_ID,
    };
    // Agent A has already left play — only agent B remains.
    const base = buildState({ agents: () => [agentB()] });
    const state: GameState = {
      ...base,
      players: [
        base.players[RESOURCE_PLAYER],
        { ...base.players[HAZARD_PLAYER], cardsInPlay: [attached] },
      ] as typeof base.players,
    };

    // Any dispatched action runs the post-reduce sweep.
    const after = dispatch(state, { type: 'pass', player: PLAYER_1 });

    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === NEVER_SEEN_HIM)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === NEVER_SEEN_HIM)).toBe(true);
    assertEveryInstanceReachable(after);
  });
});
