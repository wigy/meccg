/**
 * @module dm-7.test
 *
 * Card test: Elerína (dm-7)
 * Type: minion-character (agent, man; scout/sage/diplomat/shadow-magic/
 * spirit-magic; prowess 5, body 9, mind 8, DI 3; homesite Carn Dûm /
 * Mount Gram)
 *
 * "Unique. Agent. Can use shadow-magic and spirit-magic. Agent only: may tap
 * for an extra strike."
 *
 * Card shape:
 *   - effects[0]: agent-attack-modifier (tapForExtraStrike:true)
 *   - "Can use shadow-magic and spirit-magic" is modeled by the skills array
 *     (Taladhan dm-25 precedent for "Can use shadow-magic").
 *
 * Engine support:
 *   - declareAgentAttackActions (legal-actions/site.ts) offers each
 *     declare-agent-attack in a second variant carrying tapForExtraStrike:true
 *     while the agent is untapped; tapped or wounded agents get only the
 *     plain 1-strike attack.
 *   - handleDeclareAgentAttack (reducer-site.ts) taps the agent as part of a
 *     tapForExtraStrike declaration and builds the combat with
 *     strikesTotal: 2. forceSingleTarget is only set for 1-strike attacks
 *     with attacker assignment, so the 2-strike attack follows the standard
 *     assignment rules (each strike to a different character where possible).
 *
 * Prowess math (rule 3.iv.6.1, Elerína base 5): revealed away from home 5;
 * face-down away from home +2 → 7. The tap buys a strike, never prowess.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, GIMLI,
  MORIA,
  buildTestState, resetMint, makeSitePhase, makeAgent, withAgentInPlay,
  dispatch, viableActions, charIdAt,
  CardStatus,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, DeclareAgentAttackAction } from '../../index.js';

const ELERINA = 'dm-7' as CardDefinitionId;
const ANARIN = 'dm-1' as CardDefinitionId;      // homesite Moria — no agent-attack-modifier (control)

const AGENT_SITE_ID = 'test-dm7-agent-site' as CardInstanceId;

describe('Elerína (dm-7)', () => {
  beforeEach(() => resetMint());

  describe('declare-agent-attack legal actions', () => {
    test('untapped Elerína is offered both the plain attack and the tap-for-extra-strike variant', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const agent = makeAgent(ELERINA, { revealed: true });
      const state = withAgentInPlay(
        { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
        HAZARD_PLAYER,
        { ...agent, siteStack: [{ instanceId: AGENT_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }] },
      );

      const declares = viableActions(state, PLAYER_2, 'declare-agent-attack')
        .map(ea => ea.action as DeclareAgentAttackAction);
      expect(declares).toHaveLength(2);
      expect(declares.filter(a => a.tapForExtraStrike !== true)).toHaveLength(1);
      expect(declares.filter(a => a.tapForExtraStrike === true)).toHaveLength(1);
    });

    test('tapped Elerína gets only the plain attack (the extra strike needs the tap)', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const agent = makeAgent(ELERINA, { revealed: true });
      const state = withAgentInPlay(
        { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
        HAZARD_PLAYER,
        {
          ...agent,
          character: { ...agent.character, status: CardStatus.Tapped },
          siteStack: [{ instanceId: AGENT_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }],
        },
      );

      const declares = viableActions(state, PLAYER_2, 'declare-agent-attack')
        .map(ea => ea.action as DeclareAgentAttackAction);
      expect(declares).toHaveLength(1);
      expect(declares[0].tapForExtraStrike).toBeUndefined();
    });

    test('wounded Elerína gets only the plain attack', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const agent = makeAgent(ELERINA, { revealed: true });
      const state = withAgentInPlay(
        { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
        HAZARD_PLAYER,
        {
          ...agent,
          character: { ...agent.character, status: CardStatus.Inverted },
          siteStack: [{ instanceId: AGENT_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }],
        },
      );

      const declares = viableActions(state, PLAYER_2, 'declare-agent-attack')
        .map(ea => ea.action as DeclareAgentAttackAction);
      expect(declares).toHaveLength(1);
      expect(declares[0].tapForExtraStrike).toBeUndefined();
    });

    test('control: an untapped agent without the effect gets only the plain attack', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const agent = makeAgent(ANARIN, { revealed: true });
      const state = withAgentInPlay(
        { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
        HAZARD_PLAYER,
        { ...agent, siteStack: [{ instanceId: AGENT_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }] },
      );

      const declares = viableActions(state, PLAYER_2, 'declare-agent-attack')
        .map(ea => ea.action as DeclareAgentAttackAction);
      expect(declares).toHaveLength(1);
      expect(declares[0].tapForExtraStrike).toBeUndefined();
    });
  });

  describe('declaring the attack', () => {
    test('tap variant: Elerína taps and the attack has 2 strikes at unmodified prowess', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const agent = makeAgent(ELERINA, { revealed: true });
      const state = withAgentInPlay(
        { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
        HAZARD_PLAYER,
        { ...agent, siteStack: [{ instanceId: AGENT_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }] },
      );

      const tapDeclare = viableActions(state, PLAYER_2, 'declare-agent-attack')
        .find(ea => (ea.action as DeclareAgentAttackAction).tapForExtraStrike === true);
      expect(tapDeclare).toBeDefined();
      const after = dispatch(state, tapDeclare!.action);

      expect(after.combat).not.toBeNull();
      expect(after.combat!.strikesTotal).toBe(2);
      // Revealed, not at home: no prowess modifiers — base 5. The tap buys a
      // strike, never prowess.
      expect(after.combat!.strikeProwess).toBe(5);
      // No attacker-assignment override: the defender assigns as usual, and
      // the 2-strike attack is not forced onto a single character.
      expect(after.combat!.assignmentPhase).toBe('defender');
      expect(after.combat!.forceSingleTarget).toBeUndefined();
      // The tap is paid at declaration.
      const elerina = after.players[HAZARD_PLAYER].agents.find(a => a.character.definitionId === ELERINA);
      expect(elerina!.character.status).toBe(CardStatus.Tapped);
    });

    test('plain variant: 1 strike and Elerína stays untapped', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const agent = makeAgent(ELERINA, { revealed: true });
      const state = withAgentInPlay(
        { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
        HAZARD_PLAYER,
        { ...agent, siteStack: [{ instanceId: AGENT_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }] },
      );

      const plainDeclare = viableActions(state, PLAYER_2, 'declare-agent-attack')
        .find(ea => (ea.action as DeclareAgentAttackAction).tapForExtraStrike !== true);
      expect(plainDeclare).toBeDefined();
      const after = dispatch(state, plainDeclare!.action);

      expect(after.combat).not.toBeNull();
      expect(after.combat!.strikesTotal).toBe(1);
      const elerina = after.players[HAZARD_PLAYER].agents.find(a => a.character.definitionId === ELERINA);
      expect(elerina!.character.status).toBe(CardStatus.Untapped);
    });

    test('face-down away from home: the tap variant still applies rule-3.iv.6.1 prowess (+2) and reveals', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const agent = makeAgent(ELERINA);
      const state = withAgentInPlay(
        { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
        HAZARD_PLAYER,
        { ...agent, siteStack: [{ instanceId: AGENT_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }] },
      );

      const tapDeclare = viableActions(state, PLAYER_2, 'declare-agent-attack')
        .find(ea => (ea.action as DeclareAgentAttackAction).tapForExtraStrike === true);
      expect(tapDeclare).toBeDefined();
      const after = dispatch(state, tapDeclare!.action);

      expect(after.combat!.strikesTotal).toBe(2);
      // Face-down, not at home: +2 → 7.
      expect(after.combat!.strikeProwess).toBe(7);
      const elerina = after.players[HAZARD_PLAYER].agents.find(a => a.character.definitionId === ELERINA);
      expect(elerina!.revealed).toBe(true);
      expect(elerina!.character.status).toBe(CardStatus.Tapped);
    });
  });

  describe('resolving the 2-strike attack', () => {
    test('the two strikes go to different characters and resolve as two strike sequences', () => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.Site,
        players: [
          { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN, GIMLI] }], hand: [], siteDeck: [] },
          { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
        ],
      });
      const agent = makeAgent(ELERINA, { revealed: true });
      const state = withAgentInPlay(
        { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
        HAZARD_PLAYER,
        { ...agent, siteStack: [{ instanceId: AGENT_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }] },
      );

      const tapDeclare = viableActions(state, PLAYER_2, 'declare-agent-attack')
        .find(ea => (ea.action as DeclareAgentAttackAction).tapForExtraStrike === true);
      let s = dispatch(state, tapDeclare!.action);

      const aragornId = charIdAt(s, RESOURCE_PLAYER, 0, 0);
      const gimliId = charIdAt(s, RESOURCE_PLAYER, 0, 1);

      // Defender assigns strike 1 to Aragorn; the remaining strike must then
      // go to a different character (Gimli).
      const firstAssigns = viableActions(s, PLAYER_1, 'assign-strike');
      expect(firstAssigns.length).toBeGreaterThan(0);
      s = dispatch(s, firstAssigns.find(ea => (ea.action as { characterId: CardInstanceId }).characterId === aragornId)!.action);
      const secondAssigns = viableActions(s, PLAYER_1, 'assign-strike');
      expect(secondAssigns.some(ea => (ea.action as { characterId: CardInstanceId }).characterId === aragornId)).toBe(false);
      s = dispatch(s, secondAssigns.find(ea => (ea.action as { characterId: CardInstanceId }).characterId === gimliId)!.action);

      expect(s.combat!.strikeAssignments).toHaveLength(2);
      expect(new Set(s.combat!.strikeAssignments.map(a => a.characterId)).size).toBe(2);

      // With two strikes the defender also chooses the strike order.
      const firstOrder = viableActions(s, PLAYER_1, 'choose-strike-order');
      expect(firstOrder.length).toBeGreaterThan(0);
      s = dispatch(s, firstOrder.find(ea => (ea.action as { characterId: CardInstanceId }).characterId === aragornId)!.action);

      // Strike sequence 1: Elerína rolls 2 (5 + 2 = 7); Aragorn rolls 12 —
      // defender wins, so Elerína faces a body check (she survives on a 2
      // vs body 9).
      s = dispatch({ ...s, cheatRollTotal: 2 }, { type: 'agent-strike-roll', player: PLAYER_2 });
      const firstResolves = viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
      expect(firstResolves.length).toBeGreaterThan(0);
      s = dispatch({ ...s, cheatRollTotal: 12 }, firstResolves[0].action);
      const firstBodyChecks = viableActions(s, PLAYER_2, 'body-check-roll');
      expect(firstBodyChecks.length).toBeGreaterThan(0);
      s = dispatch({ ...s, cheatRollTotal: 2 }, firstBodyChecks[0].action);

      // Strike sequence 2 (only Gimli's strike remains, so no further order
      // choice) runs the same way.
      s = dispatch({ ...s, cheatRollTotal: 2 }, { type: 'agent-strike-roll', player: PLAYER_2 });
      const secondResolves = viableActions({ ...s, cheatRollTotal: 12 }, PLAYER_1, 'resolve-strike');
      expect(secondResolves.length).toBeGreaterThan(0);
      s = dispatch({ ...s, cheatRollTotal: 12 }, secondResolves[0].action);
      const secondBodyChecks = viableActions(s, PLAYER_2, 'body-check-roll');
      expect(secondBodyChecks.length).toBeGreaterThan(0);
      s = dispatch({ ...s, cheatRollTotal: 2 }, secondBodyChecks[0].action);

      // Both strikes resolved: combat over and neither defender wounded.
      // Elerína survives her body checks but is wounded by the defeated
      // strikes (CoE 3.v).
      expect(s.combat).toBeNull();
      expect(s.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe(CardStatus.Inverted);
      expect(s.players[RESOURCE_PLAYER].characters[gimliId].status).not.toBe(CardStatus.Inverted);
      const elerina = s.players[HAZARD_PLAYER].agents.find(a => a.character.definitionId === ELERINA);
      expect(elerina!.character.status).toBe(CardStatus.Inverted);
    });
  });
});
