/**
 * @module dm-92.test
 *
 * Card test: To Get You Away (dm-92)
 * Type: hazard-event (permanent)
 *
 * "Tap an agent at target company's new site. Agent may attack (not counting
 * against hazard limit) during the movement/hazard phase. Attacker chooses
 * defending characters. A successful strike doesn't wound the defending
 * character, instead the character is taken prisoner at one of the agent's
 * home sites (attacker's choice, regardless of site's location) and the agent
 * returns to the same site. Rescue-attack: Same race as agent — 3 strikes
 * with 8 prowess. Cannot be played if your opponent is a minion player."
 *
 * Card shape:
 *   - effects[0]: tap-agent-at-site (prowessBonus 0, attackerAssigns,
 *     strikeEffect "take-prisoner-at-agent-home", rescueAttack 3 × 8)
 *
 * The agent used throughout is Bill Ferny (dm-3): Man, prowess 2, body 8,
 * home sites Bree and Cameth Brin. Face-down at home (Bree), his attack has
 * prowess 2 + 5 = 7. The prison site is declared with the play
 * (`prisonSiteInstanceId`): Bree (his own site after the reveal) or Cameth
 * Brin (a home-site card from the hazard player's location deck).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, GIMLI, BREE,
  buildSitePhaseState, resetMint,
  dispatch, viableActions, findCharInstanceId,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment, CardStatus,
  charIdAt,
  buildAgentAtBreeMHState, hazardSiteDeckId, playHazardWithPrisonSite, fightAgentStrike,
} from '../test-helpers.js';
import type {
  GameState, CardDefinitionId, ConstraintId, ActiveConstraint, HazardHost,
  MovementHazardPhaseState, PlayHazardAction, SitePhaseState,
} from '../../index.js';

const TO_GET_YOU_AWAY = 'dm-92' as CardDefinitionId;
const CAMETH_BRIN = 'tw-379' as CardDefinitionId;

describe('To Get You Away (dm-92)', () => {
  beforeEach(() => resetMint());

  // ---- Playability ----

  test('playable with an untapped agent at the new site — one action per home site to hold the prisoner', () => {
    const state = buildAgentAtBreeMHState(TO_GET_YOU_AWAY, CAMETH_BRIN);
    const plays = viableActions(state, PLAYER_2, 'play-hazard').map(a => a.action as PlayHazardAction);
    const breeId = hazardSiteDeckId(state, BREE);
    const camethId = hazardSiteDeckId(state, CAMETH_BRIN);
    // Face-down Bill Ferny is revealed with the Bree card; the prisoner may be
    // held at Bree (his site) or at Cameth Brin (regardless of location).
    expect(plays).toHaveLength(2);
    expect(plays.every(a => a.homeSiteInstanceId === breeId)).toBe(true);
    expect(plays.map(a => a.prisonSiteInstanceId).sort()).toEqual([breeId, camethId].sort());
  });

  test('not playable without an agent at the company\'s new site', () => {
    const plays = viableActions(buildAgentAtBreeMHState(TO_GET_YOU_AWAY, CAMETH_BRIN, { agent: false }), PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('not playable when the agent is already tapped (it must tap)', () => {
    const plays = viableActions(buildAgentAtBreeMHState(TO_GET_YOU_AWAY, CAMETH_BRIN, { agentStatus: CardStatus.Tapped }), PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  test('not playable if the opponent is a minion player', () => {
    const plays = viableActions(buildAgentAtBreeMHState(TO_GET_YOU_AWAY, CAMETH_BRIN, { alignment: Alignment.Ringwraith }), PLAYER_2, 'play-hazard');
    expect(plays).toHaveLength(0);
  });

  // ---- The attack ----

  test('taps the agent and starts an attacker-assigned agent attack; the card counts once against the hazard limit', () => {
    const state = buildAgentAtBreeMHState(TO_GET_YOU_AWAY, CAMETH_BRIN);
    const before = (state.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany;
    const after = playHazardWithPrisonSite(state, CAMETH_BRIN);

    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.character.status).toBe(CardStatus.Tapped);
    expect(agent.revealed).toBe(true);

    expect(after.combat).not.toBeNull();
    expect(after.combat!.attackSource.type).toBe('agent');
    expect(after.combat!.assignmentPhase).toBe('attacker');
    expect(after.combat!.strikesTotal).toBe(1);
    expect(after.combat!.strikeProwess).toBe(7);

    // The card itself is the one hazard; the attack adds nothing further.
    expect((after.phaseState as MovementHazardPhaseState).hazardsPlayedThisCompany).toBe(before + 1);
    // The permanent-event is in play while the attack resolves.
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === TO_GET_YOU_AWAY)).toBe(true);
  });

  test('a successful strike takes the character prisoner at the chosen home site and the agent returns there', () => {
    const state = buildAgentAtBreeMHState(TO_GET_YOU_AWAY, CAMETH_BRIN);
    const played = playHazardWithPrisonSite(state, CAMETH_BRIN);
    const aragornId = charIdAt(played, RESOURCE_PLAYER);
    // Agent 12 + 7 = 19 beats Aragorn 2 + 6 = 8.
    const after = fightAgentStrike(played, 12, 2);

    expect(after.combat).toBeNull();
    // Not wounded: taken prisoner instead.
    expect(after.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe(CardStatus.Inverted);
    expect(after.activeConstraints.some(c =>
      c.kind.type === 'character-is-prisoner'
      && c.target.kind === 'character' && c.target.characterId === aragornId)).toBe(true);

    // Held at Cameth Brin by the To Get You Away host, whose rescue-attack is
    // the agent's race (Man) with 3 strikes of 8 prowess.
    expect(after.hazardHosts).toHaveLength(1);
    const host = after.hazardHosts[0];
    expect(host.hostCard.definitionId).toBe(TO_GET_YOU_AWAY);
    expect(host.rescueSiteCard.definitionId).toBe(CAMETH_BRIN);
    expect(host.prisoners).toEqual([aragornId]);
    expect(host.rescueAttacks).toEqual([{ race: 'man', strikes: 3, prowess: 8 }]);
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === TO_GET_YOU_AWAY)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === TO_GET_YOU_AWAY)).toBe(false);

    // The agent returns to Cameth Brin; the Bree card goes back to the location deck.
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.siteStack.map(s => s.definitionId)).toEqual([CAMETH_BRIN]);
    expect(after.players[HAZARD_PLAYER].siteDeck.map(s => s.definitionId)).toEqual([BREE]);
  });

  test('choosing the agent\'s own home site keeps the prisoner and the agent there', () => {
    const state = buildAgentAtBreeMHState(TO_GET_YOU_AWAY, CAMETH_BRIN);
    const played = playHazardWithPrisonSite(state, BREE);
    const aragornId = charIdAt(played, RESOURCE_PLAYER);
    const after = fightAgentStrike(played, 12, 2);

    expect(after.hazardHosts).toHaveLength(1);
    expect(after.hazardHosts[0].rescueSiteCard.definitionId).toBe(BREE);
    expect(after.hazardHosts[0].prisoners).toEqual([aragornId]);
    const agent = after.players[HAZARD_PLAYER].agents[0];
    expect(agent.siteStack.map(s => s.definitionId)).toEqual([BREE]);
    expect(after.players[HAZARD_PLAYER].siteDeck.map(s => s.definitionId)).toEqual([CAMETH_BRIN]);
  });

  test('if the strike fails, no prisoner is taken and the card is discarded when the attack ends', () => {
    const state = buildAgentAtBreeMHState(TO_GET_YOU_AWAY, CAMETH_BRIN);
    const played = playHazardWithPrisonSite(state, CAMETH_BRIN);
    const aragornId = charIdAt(played, RESOURCE_PLAYER);
    // Agent 2 + 7 = 9 loses to Aragorn 12 + 6 = 18.
    let after = fightAgentStrike(played, 2, 12);
    // The defeated strike triggers the agent's body check (defender rolls
    // low: the agent survives). The attack then ends.
    const bodyCheck = viableActions(after, PLAYER_1, 'body-check-roll');
    expect(bodyCheck).toHaveLength(1);
    after = dispatch({ ...after, cheatRollTotal: 2 }, bodyCheck[0].action);

    expect(after.combat).toBeNull();
    expect(after.hazardHosts).toHaveLength(0);
    expect(after.activeConstraints.some(c => c.kind.type === 'character-is-prisoner')).toBe(false);
    expect(after.players[RESOURCE_PLAYER].characters[aragornId]).toBeDefined();
    expect(after.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === TO_GET_YOU_AWAY)).toBe(false);
    expect(after.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === TO_GET_YOU_AWAY)).toBe(true);
  });

  // ---- Rescue ----

  test('rescuing the prisoner faces a rescue-attack of the agent\'s race — 3 strikes with 8 prowess', () => {
    // Capture at Cameth Brin, then take the resulting host record to a site
    // phase where the prisoner's company stands at Cameth Brin.
    const captured = fightAgentStrike(playHazardWithPrisonSite(buildAgentAtBreeMHState(TO_GET_YOU_AWAY, CAMETH_BRIN), CAMETH_BRIN), 12, 2);
    const capturedHost = captured.hazardHosts[0];

    resetMint();
    const base = buildSitePhaseState({ site: CAMETH_BRIN, characters: [ARAGORN, GIMLI] });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const hostId = capturedHost.hostCard.instanceId;
    const prisonerConstraint: ActiveConstraint = {
      id: 'c-prisoner-tgya' as ConstraintId,
      source: hostId,
      sourceDefinitionId: TO_GET_YOU_AWAY,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: aragornId },
      kind: { type: 'character-is-prisoner', hostInstanceId: hostId },
    };
    const host: HazardHost = { ...capturedHost, prisoners: [aragornId] };
    const state: GameState = {
      ...base,
      activeConstraints: [...base.activeConstraints, prisonerConstraint],
      hazardHosts: [host],
    };

    expect(viableActions(state, PLAYER_1, 'rescue-prisoner')).toHaveLength(1);
    const after = dispatch(state, { type: 'rescue-prisoner', player: PLAYER_1, hostInstanceId: hostId });
    expect((after.phaseState as SitePhaseState).step).toBe('rescue-attacks');
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('man');
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.strikeProwess).toBe(8);
    expect(after.combat!.protectedFromStrikeAssignment).toContain(aragornId);
  });
});
