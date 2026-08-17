/**
 * @module dm-14.test
 *
 * Card test: Golodhros (dm-14)
 * Type: minion-character (agent, dúnadan; warrior/sage/diplomat/spirit-magic;
 * prowess 5, body 9, mind 9, DI 4; homesite Minas Morgul, Cirith Ungol,
 * Barad-dûr)
 *
 * "Unique. Agent. Can use spirit-magic. Agent only: may tap to make an
 * influence check on an ally, faction, or character."
 *
 * Card shape:
 *   - effects[0]: agent-tap-influence (targetKinds: character, ally, faction)
 *
 * Engine support (rule 10.14, pre-existing — this card is the reference
 * fixture for the rule-10.14 rules test):
 *   - Legal actions (`agentInfluenceActions`, legal-actions/movement-hazard.ts):
 *     one `agent-influence-attempt` per untapped/unwounded in-play-at-turn-start
 *     agent carrying `agent-tap-influence`, per eligible target of each listed
 *     kind. Character/ally targets require the agent to be at the active
 *     company's (destination or current) site; faction targets require the
 *     agent to be at a site where the faction is playable — independently, so
 *     an agent can offer faction attempts while away from the company.
 *   - Reducer (`handleAgentInfluenceAttempt`, mh-agents.ts): reveals + taps the
 *     agent (not an agent action — `remainingActions` untouched, no hazard
 *     count), applies rule-10.14 bonuses (+2 DI at a home site; target mind or
 *     faction value treated as 0 with +2 roll when the target shares a home
 *     site with the agent, or the faction is playable at the agent's home),
 *     and enqueues the standard `opponent-influence-defend` resolution with
 *     `revealedCard: null` (rule 10.14: "the hazard player cannot reveal an
 *     identical card from their hand").
 *
 * Fixtures: Golodhros (Ringwraith) as the hazard player's agent, opposite a
 * Wizard resource player (cross-alignment penalty -5 throughout). Gorbag
 * (le-11, home Minas Morgul) is the shared-home character target; Bill the
 * Pony (tw-198, mind 1, no homesite) is the plain ally target; Orcs of
 * Gorgoroth (le-275, playable at Barad-dûr — one of Golodhros's home sites)
 * is the at-home faction target, Men of Anórien (tw-277, playable at Minas
 * Tirith, influence 8) the away-from-home one.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, LORIEN, MEN_OF_ANORIEN,
  buildTestState, resetMint, makeMHState, makeAgent, addCardInPlay, attachAllyToChar,
  dispatch, viableActions, mint, findCharInstanceId,
  Alignment, CardStatus,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type {
  GameState, CardDefinitionId, AgentInPlay, SiteInPlay,
  MovementHazardPhaseState, PendingResolution, OpponentInfluenceAttempt,
  AgentInfluenceAttemptAction,
} from '../../index.js';

const GOLODHROS = 'dm-14' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;                 // home Minas Morgul (shared with Golodhros)
const BILL_THE_PONY = 'tw-198' as CardDefinitionId;         // hero ally, mind 1, no homesite
const ORCS_OF_GORGOROTH = 'le-275' as CardDefinitionId;     // faction playable at Barad-dûr, influence 9
const MINAS_MORGUL_SITE = 'le-390' as CardDefinitionId;     // minion site, Golodhros home #1
const BARAD_DUR_SITE = 'le-352' as CardDefinitionId;        // minion site, Golodhros home #3
const MINAS_TIRITH_MINION_SITE = 'le-391' as CardDefinitionId; // minion "Minas Tirith", not a Golodhros home

/** The queued influence attempt, or undefined when none was enqueued. */
function queuedAttempt(state: GameState): OpponentInfluenceAttempt | undefined {
  const pending = state.pendingResolutions.find(
    (r: PendingResolution) => r.kind.type === 'opponent-influence-defend',
  );
  if (!pending || pending.kind.type !== 'opponent-influence-defend') return undefined;
  return pending.kind.attempt;
}

describe('Golodhros (dm-14)', () => {
  beforeEach(() => resetMint());

  /**
   * Hazard player (PLAYER_2, Ringwraith) fields Golodhros as an agent at
   * `agentSite`; the resource player (PLAYER_1, Wizard) has a company at
   * Lórien (destination Minas Tirith, one of Golodhros's non-home sites, so
   * character/ally targets normally line up with the away-from-home faction
   * fixture) plus whatever cards `withCompanyOf`/`faction` install.
   */
  function baseState(opts: {
    agentSite: CardDefinitionId;
    companyCharacters?: CardDefinitionId[];
    destinationSite?: string;
    faction?: CardDefinitionId;
  }): GameState {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: opts.companyCharacters ?? [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_TIRITH_MINION_SITE, characters: [] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const built = makeAgent(GOLODHROS);
    const agent: AgentInPlay = {
      ...built,
      siteStack: [{ instanceId: mint(), definitionId: opts.agentSite, status: CardStatus.Untapped } as SiteInPlay],
      revealed: false,
    };

    const withAgent: GameState = {
      ...state,
      phaseState: makeMHState({ destinationSiteName: opts.destinationSite ?? null }),
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], agents: [agent] },
      ] as typeof state.players,
    };

    return opts.faction ? addCardInPlay(withAgent, RESOURCE_PLAYER, opts.faction) : withAgent;
  }

  function influenceAction(state: GameState, targetKind: 'character' | 'ally' | 'faction') {
    const actions = viableActions(state, PLAYER_2, 'agent-influence-attempt')
      .filter(a => (a.action as AgentInfluenceAttemptAction).targetKind === targetKind);
    return actions;
  }

  // ─── Character target ──────────────────────────────────────────────────

  test('character target: offered when Golodhros is at the company site, with home-site DI bonus', () => {
    const state = baseState({
      agentSite: MINAS_MORGUL_SITE,
      companyCharacters: [ARAGORN],
      destinationSite: 'Minas Morgul',
    });
    const actions = influenceAction(state, 'character');
    expect(actions).toHaveLength(1);

    const after = dispatch(state, actions[0].action);
    const attempt = queuedAttempt(after)!;
    expect(attempt).toBeDefined();
    expect(attempt.targetKind).toBe('character');
    expect(attempt.targetPlayer).toBe(PLAYER_1);
    // Base DI 4 + home-site bonus 2 = 6 (Golodhros is at Minas Morgul, his home).
    expect(attempt.influencerDI).toBe(6);
    // Cannot reveal an identical card (rule 10.14).
    expect(attempt.revealedCard).toBeNull();
    // Cross-alignment (Ringwraith vs Wizard) penalty.
    expect(attempt.crossAlignmentPenalty).toBe(-5);
  });

  test('character target sharing a home site with Golodhros: mind treated as 0, +2 roll', () => {
    const state = baseState({
      agentSite: MINAS_MORGUL_SITE,
      companyCharacters: [GORBAG],
      destinationSite: 'Minas Morgul',
    });
    const actions = influenceAction(state, 'character');
    expect(actions).toHaveLength(1);

    const after = dispatch({ ...state, cheatRollTotal: 5 }, actions[0].action);
    const attempt = queuedAttempt(after)!;
    // Gorbag's printed mind is 6, but he shares Minas Morgul with Golodhros.
    expect(attempt.targetMind).toBe(0);
    // die1+die2 forced to 5, plus the shared-home +2 roll bonus.
    expect(attempt.attackerRoll).toBe(7);
  });

  test('character target: NOT offered when Golodhros is away from the company site', () => {
    const state = baseState({
      agentSite: BARAD_DUR_SITE,
      companyCharacters: [ARAGORN],
      destinationSite: 'Minas Morgul',
    });
    expect(influenceAction(state, 'character')).toHaveLength(0);
  });

  test('agent not at home: no +2 DI bonus, target mind stays full (not shared home)', () => {
    const state = baseState({
      agentSite: MINAS_MORGUL_SITE,
      companyCharacters: [ARAGORN],
      destinationSite: 'Minas Morgul',
    });
    const actions = influenceAction(state, 'character');
    const after = dispatch(state, actions[0].action);
    const attempt = queuedAttempt(after)!;
    // Aragorn's home is not Minas Morgul, so no shared-home mind=0 bonus.
    expect(attempt.targetMind).not.toBe(0);
  });

  test('a successful character influence attempt discards the target from the resource player', () => {
    // Aragorn + Legolas fielded alongside Gorbag so the resource player's
    // unused general influence (20 - 6 - 9 - 6 = -1) can't shield him.
    const state = baseState({
      agentSite: MINAS_MORGUL_SITE,
      companyCharacters: [GORBAG, ARAGORN, LEGOLAS],
      destinationSite: 'Minas Morgul',
    });
    const gorbagId = findCharInstanceId(state, RESOURCE_PLAYER, GORBAG);
    const actions = influenceAction(state, 'character');
    const gorbagAction = actions.find(a => (a.action as AgentInfluenceAttemptAction).targetInstanceId === gorbagId)!;
    expect(gorbagAction).toBeDefined();

    const declared = dispatch({ ...state, cheatRollTotal: 10 }, gorbagAction.action);
    const defend = viableActions({ ...declared, cheatRollTotal: 2 }, PLAYER_1, 'opponent-influence-defend');
    expect(defend).toHaveLength(1);
    const resolved = dispatch({ ...declared, cheatRollTotal: 2 }, defend[0].action);
    expect(resolved.players[RESOURCE_PLAYER].characters[gorbagId]).toBeUndefined();
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === GORBAG)).toBe(true);
  });

  // ─── Ally target ────────────────────────────────────────────────────────

  test('ally target: offered when Golodhros is at the company site, full mind (no shared home)', () => {
    let state = baseState({
      agentSite: MINAS_MORGUL_SITE,
      companyCharacters: [ARAGORN],
      destinationSite: 'Minas Morgul',
    });
    state = attachAllyToChar(state, RESOURCE_PLAYER, ARAGORN, BILL_THE_PONY);

    const actions = influenceAction(state, 'ally');
    expect(actions).toHaveLength(1);

    const after = dispatch(state, actions[0].action);
    const attempt = queuedAttempt(after)!;
    expect(attempt.targetKind).toBe('ally');
    expect(attempt.targetMind).toBe(1);
  });

  // ─── Faction target ─────────────────────────────────────────────────────

  test('faction target at Golodhros home site: value 0, +2 roll', () => {
    const state = baseState({
      agentSite: BARAD_DUR_SITE,
      companyCharacters: [ARAGORN],
      destinationSite: 'Minas Tirith',
      faction: ORCS_OF_GORGOROTH,
    });
    const actions = influenceAction(state, 'faction');
    expect(actions).toHaveLength(1);

    const after = dispatch({ ...state, cheatRollTotal: 6 }, actions[0].action);
    const attempt = queuedAttempt(after)!;
    expect(attempt.targetKind).toBe('faction');
    expect(attempt.targetMind).toBe(0);
    // Base DI 4 + home-site bonus 2 = 6.
    expect(attempt.influencerDI).toBe(6);
    // die1+die2 forced to 6, plus the faction-at-home +2 roll bonus.
    expect(attempt.attackerRoll).toBe(8);
  });

  test('faction target away from any Golodhros home site: full value, no roll bonus', () => {
    const state = baseState({
      agentSite: MINAS_TIRITH_MINION_SITE,
      companyCharacters: [ARAGORN],
      destinationSite: 'Minas Tirith',
      faction: MEN_OF_ANORIEN,
    });
    const actions = influenceAction(state, 'faction');
    expect(actions).toHaveLength(1);

    const after = dispatch({ ...state, cheatRollTotal: 6 }, actions[0].action);
    const attempt = queuedAttempt(after)!;
    expect(attempt.targetMind).toBe(8); // full influence value, not 0
    expect(attempt.influencerDI).toBe(4); // no home bonus (Minas Tirith isn't Golodhros's home)
    expect(attempt.attackerRoll).toBe(6); // no +2 roll bonus
  });

  test('a successful faction influence attempt discards the faction from the resource player', () => {
    // Aragorn + Gorbag fielded so the resource player's unused general
    // influence (20 - 9 - 6 = 5) doesn't shield the faction outright.
    const state = baseState({
      agentSite: BARAD_DUR_SITE,
      companyCharacters: [ARAGORN, GORBAG],
      destinationSite: 'Minas Tirith',
      faction: ORCS_OF_GORGOROTH,
    });
    const actions = influenceAction(state, 'faction');
    const factionId = state.players[RESOURCE_PLAYER].cardsInPlay[0].instanceId;
    const declared = dispatch({ ...state, cheatRollTotal: 10 }, actions[0].action);
    const defend = viableActions({ ...declared, cheatRollTotal: 2 }, PLAYER_1, 'opponent-influence-defend');
    expect(defend).toHaveLength(1);
    const resolved = dispatch({ ...declared, cheatRollTotal: 2 }, defend[0].action);
    expect(resolved.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.instanceId === factionId)).toBe(false);
    expect(resolved.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === ORCS_OF_GORGOROTH)).toBe(true);
  });

  // ─── Not an agent action ────────────────────────────────────────────────

  test('the influence attempt is not an agent action: remainingActions untouched, no hazard counted, agent tapped+revealed', () => {
    const state = baseState({
      agentSite: MINAS_MORGUL_SITE,
      companyCharacters: [ARAGORN],
      destinationSite: 'Minas Morgul',
    });
    const before = state.players[HAZARD_PLAYER].agents[0].remainingActions;
    const beforeHazards = (state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    const actions = influenceAction(state, 'character');
    const after = dispatch(state, actions[0].action);

    expect(after.players[HAZARD_PLAYER].agents[0].remainingActions).toBe(before);
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(beforeHazards);
    expect(after.players[HAZARD_PLAYER].agents[0].character.status).toBe(CardStatus.Tapped);
    expect(after.players[HAZARD_PLAYER].agents[0].revealed).toBe(true);
  });
});
