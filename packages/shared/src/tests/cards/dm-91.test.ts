/**
 * @module dm-91.test
 *
 * Card test: Sudden Fury (dm-91)
 * Type: hazard-event (short)
 *
 * "Playable on a site. Until the end of the turn, any attack by a scout agent
 * at this site has its number of strikes increased by one and attacker
 * chooses defending characters."
 *
 * Card shape:
 *   - effects[0]: play-target site
 *   - effects[1]: agent-attack-boost (agentFilter: target.skills $includes
 *     scout, strikesBonus: 1, attackerChoosesDefenders: true)
 *
 * Engine support:
 *   - Played during the M/H phase on the active company's (new) site; on
 *     resolution the chain installs a turn-scoped `agent-attack-boost`
 *     constraint bound to that site (chain-reducer.ts
 *     `applyAgentAttackBoostConstraint`).
 *   - Every agent-attack builder — site-phase `declare-agent-attack`
 *     (reducer-site.ts), M/H `agent-tap-attack` and `tap-agent-at-site`
 *     (mh-agents.ts) — reads it through `agentAttackSiteBoost`
 *     (reducer-utils.ts): +1 strike and attacker assignment for a scout agent
 *     attacking at the bound site (matched by site name). The 1-strike
 *     single-target lock is dropped so the two strikes go to different
 *     characters.
 *   - "Until the end of the turn": the constraint has `turn` scope and is
 *     swept at turn end.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, BREE,
  buildTestState, resetMint, makeMHState, makeSitePhase,
  dispatch, viableActions, resolveChain,
  makeBillFernyAgent,
  CardStatus,
} from '../test-helpers.js';
import { Phase, ZERO_EFFECTIVE_STATS } from '../../index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';
import type {
  AgentInPlay, GameState, PlayHazardAction,
  CardDefinitionId, CardInstanceId, CompanyId,
} from '../../index.js';

const SUDDEN_FURY = 'dm-91' as CardDefinitionId;
const CUNNING_FOES = 'dm-50' as CardDefinitionId;  // tap-agent-at-site (warrior agent)
const ANARIN = 'dm-1' as CardDefinitionId;         // scout/diplomat agent, agent-tap-attack, home Moria
const LEAMON = 'dm-19' as CardDefinitionId;        // warrior-only agent (not a scout), home Cameth Brin

const SCOUT_FILTER = { 'target.skills': { $includes: 'scout' } };

describe('Sudden Fury (dm-91)', () => {
  beforeEach(() => resetMint());

  /** Bind a Sudden Fury `agent-attack-boost` constraint to `site` directly. */
  function withFury(state: GameState, site: CardDefinitionId): GameState {
    return addConstraint(state, {
      source: 'fury-1' as CardInstanceId,
      sourceDefinitionId: SUDDEN_FURY,
      scope: { kind: 'turn' },
      target: { kind: 'player', playerId: PLAYER_1 },
      kind: {
        type: 'agent-attack-boost',
        siteDefinitionId: site,
        agentFilter: SCOUT_FILTER,
        strikesBonus: 1,
        attackerChoosesDefenders: true,
      },
    });
  }

  /** A revealed agent standing at `site` via its own site stack. */
  function agentAt(definitionId: CardDefinitionId, site: CardDefinitionId): AgentInPlay {
    return {
      id: `agent-${definitionId as string}-0` as CompanyId,
      character: {
        instanceId: `test-agent-${definitionId as string}` as CardInstanceId,
        definitionId,
        status: CardStatus.Untapped,
        items: [], allies: [], hazards: [], followers: [],
        controlledBy: 'general',
        effectiveStats: ZERO_EFFECTIVE_STATS,
      },
      revealed: true,
      siteStack: [{ instanceId: `test-agent-site-${definitionId as string}` as CardInstanceId, definitionId: site, status: CardStatus.Untapped }],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };
  }

  function withAgent(state: GameState, agent: AgentInPlay): GameState {
    return {
      ...state,
      players: [
        state.players[RESOURCE_PLAYER],
        { ...state.players[HAZARD_PLAYER], agents: [agent] },
      ] as unknown as GameState['players'],
    };
  }

  /**
   * M/H phase: P1's company (Aragorn, Legolas) moves Rivendell → Bree. P2
   * holds Sudden Fury and Cunning Foes, with Bill Ferny (warrior/scout)
   * face-down at his home site Bree.
   */
  function mhState(): GameState {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS], destinationSite: BREE }], hand: [], siteDeck: [BREE] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [SUDDEN_FURY, CUNNING_FOES], siteDeck: [] },
      ],
    });
    return withAgent({ ...state, phaseState: makeMHState() }, makeBillFernyAgent());
  }

  function playSuddenFury(state: GameState): GameState {
    const play = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => state.players[HAZARD_PLAYER].hand.find(c => c.instanceId === (a.action as PlayHazardAction).cardInstanceId)?.definitionId === SUDDEN_FURY);
    expect(play).toBeDefined();
    // "Playable on a site": bound to the company's new site.
    expect((play!.action as PlayHazardAction).targetSiteDefinitionId).toBe(BREE);
    return resolveChain(dispatch(state, play!.action));
  }

  function playCunningFoes(state: GameState): GameState {
    const play = viableActions(state, PLAYER_2, 'play-hazard')
      .find(a => state.players[HAZARD_PLAYER].hand.find(c => c.instanceId === (a.action as PlayHazardAction).cardInstanceId)?.definitionId === CUNNING_FOES);
    expect(play).toBeDefined();
    return dispatch(state, play!.action);
  }

  test('played on the company\'s site: installs a turn-scoped boost bound to it and goes to discard', () => {
    const state = mhState();
    const furyId = state.players[HAZARD_PLAYER].hand.find(c => c.definitionId === SUDDEN_FURY)!.instanceId;

    const after = playSuddenFury(state);

    expect(after.players[HAZARD_PLAYER].hand.map(c => c.instanceId)).not.toContain(furyId);
    expect(after.players[HAZARD_PLAYER].discardPile.map(c => c.instanceId)).toContain(furyId);
    const c = after.activeConstraints.find(k => k.kind.type === 'agent-attack-boost');
    expect(c).toBeDefined();
    expect(c!.kind).toMatchObject({ siteDefinitionId: BREE, strikesBonus: 1, attackerChoosesDefenders: true });
    expect(c!.scope).toEqual({ kind: 'turn' });
  });

  test('M/H tap-agent-at-site attack by a scout agent at the site gets +1 strike (2 strikes)', () => {
    const control = playCunningFoes(mhState());
    expect(control.combat!.strikesTotal).toBe(1);

    const after = playCunningFoes(playSuddenFury(mhState()));

    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.assignmentPhase).toBe('attacker');
    // Two strikes: no single-target lock — each goes to a different character.
    expect(after.combat!.forceSingleTarget).toBeFalsy();
  });

  test('attacker chooses defending characters: both strikes assigned by the hazard player to different characters', () => {
    let s = playCunningFoes(playSuddenFury(mhState()));

    expect(viableActions(s, PLAYER_1, 'assign-strike')).toHaveLength(0);
    const first = viableActions(s, PLAYER_2, 'assign-strike');
    expect(first.length).toBeGreaterThan(0);
    s = dispatch(s, first[0].action);
    const second = viableActions(s, PLAYER_2, 'assign-strike');
    expect(second.length).toBeGreaterThan(0);
    s = dispatch(s, second[0].action);

    const targets = s.combat!.strikeAssignments.map(a => a.characterId);
    expect(targets).toHaveLength(2);
    expect(new Set(targets).size).toBe(2);
  });

  test('M/H agent-tap-attack by a scout agent at the site gets +1 strike and attacker assignment', () => {
    // Anarin (scout, agent-tap-attack) revealed at Bree; no attacker
    // assignment of its own.
    const moving = mhState();
    const base = withAgent(
      { ...moving, phaseState: makeMHState({ destinationSiteName: 'Bree' }) },
      agentAt(ANARIN, BREE),
    );
    const tapAttack = (s: GameState) => dispatch(s, viableActions(s, PLAYER_2, 'agent-tap-attack')[0].action);
    const control = tapAttack(base);
    expect(control.combat!.strikesTotal).toBe(1);
    expect(control.combat!.assignmentPhase).toBe('defender');

    const after = tapAttack(withFury(base, BREE));
    expect(after.combat!.strikesTotal).toBe(2);
    expect(after.combat!.assignmentPhase).toBe('attacker');
  });

  describe('site-phase agent attack', () => {
    /** Site phase at declare-agent-attack; P1's company at Lórien. */
    function siteState(agentDef: CardDefinitionId): GameState {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: LORIEN, characters: [ARAGORN, LEGOLAS] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      return withAgent(
        { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
        agentAt(agentDef, LORIEN),
      );
    }

    function declare(state: GameState): GameState {
      const declares = viableActions(state, PLAYER_2, 'declare-agent-attack');
      expect(declares.length).toBeGreaterThan(0);
      return dispatch(state, declares[0].action);
    }

    test('scout agent attacking at the site: 2 strikes, attacker assigns', () => {
      const control = declare(siteState(ANARIN));
      expect(control.combat!.strikesTotal).toBe(1);
      expect(control.combat!.assignmentPhase).toBe('defender');

      const after = declare(withFury(siteState(ANARIN), LORIEN));
      expect(after.combat!.strikesTotal).toBe(2);
      expect(after.combat!.assignmentPhase).toBe('attacker');
      expect(after.combat!.forceSingleTarget).toBeFalsy();
    });

    test('a non-scout agent is unaffected', () => {
      const after = declare(withFury(siteState(LEAMON), LORIEN));
      expect(after.combat!.strikesTotal).toBe(1);
      expect(after.combat!.assignmentPhase).toBe('defender');
    });

    test('an attack at a different site is unaffected', () => {
      const after = declare(withFury(siteState(ANARIN), BREE));
      expect(after.combat!.strikesTotal).toBe(1);
      expect(after.combat!.assignmentPhase).toBe('defender');
    });
  });

  test('until the end of the turn: the boost is swept at turn end', () => {
    const played = playSuddenFury(mhState());
    expect(played.activeConstraints.some(c => c.kind.type === 'agent-attack-boost')).toBe(true);

    const swept = sweepExpired(played, { kind: 'turn-end' });
    expect(swept.activeConstraints.some(c => c.kind.type === 'agent-attack-boost')).toBe(false);
  });
});
