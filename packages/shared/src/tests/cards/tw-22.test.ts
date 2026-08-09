/**
 * @module tw-22.test
 *
 * Card test: Clouds (tw-22)
 * Type: hazard-event (long, environment)
 * Effects: 2 (duplication-limit, stat-modifier)
 *
 * "Environment. If Doors of Night is in play, the prowess of each hazard
 *  creature is modified by +2. Cannot be duplicated."
 *
 * Unlike Sun (tw-335, "each automatic-attack and hazard creature"), Clouds
 * names only hazard creatures — site automatic-attacks and agent hazard
 * attacks are excluded via `attack.isAutomaticAttack $ne true` and
 * `attack.isAgentAttack $ne true`.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase,
  ARAGORN,
  ORC_PATROL,
  DOORS_OF_NIGHT,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, ISENGARD,
  CardStatus,
  buildTestState, resetMint, buildSitePhaseState,
  addP2CardsInPlay, setupAutoAttackStep,
  setupCombatWithCaveDrake,
  viableActions,
  makeSitePhase, makeAgent, withAgentInPlay, makeMHState,
  dispatch, HAZARD_PLAYER,
} from '../test-helpers.js';
import type { CardInPlay, CardInstanceId, CardDefinitionId, DeclareAgentAttackAction } from '../../index.js';

const CLOUDS = 'tw-22' as CardDefinitionId;
const ELERINA = 'dm-7' as CardDefinitionId; // Man agent, prowess 5
const AGENT_SITE_ID = 'test-tw22-agent-site' as CardInstanceId;

const cloudsInPlay: CardInPlay = {
  instanceId: 'clouds-1' as CardInstanceId,
  definitionId: CLOUDS,
  status: CardStatus.Untapped,
};

const doorsOfNightInPlay: CardInPlay = {
  instanceId: 'don-1' as CardInstanceId,
  definitionId: DOORS_OF_NIGHT,
  status: CardStatus.Untapped,
};

describe('Clouds (tw-22)', () => {
  beforeEach(() => resetMint());

  test('hazard creature prowess +2 when Doors of Night is in play', () => {
    // Orc-patrol: 3 strikes, 6 prowess → 8 prowess with Clouds + Doors of Night.
    const s = setupCombatWithCaveDrake({
      heroChars: [ARAGORN],
      creatureDefId: ORC_PATROL,
      hazardCardsInPlay: [cloudsInPlay, doorsOfNightInPlay],
    });
    expect(s.combat).not.toBeNull();
    expect(s.combat!.creatureRace).toBe('orc');
    expect(s.combat!.strikeProwess).toBe(8);
    expect(s.combat!.strikesTotal).toBe(3);
  });

  test('hazard creature prowess unchanged without Doors of Night', () => {
    const s = setupCombatWithCaveDrake({
      heroChars: [ARAGORN],
      creatureDefId: ORC_PATROL,
      hazardCardsInPlay: [cloudsInPlay],
    });
    expect(s.combat).not.toBeNull();
    expect(s.combat!.strikeProwess).toBe(6);
    expect(s.combat!.strikesTotal).toBe(3);
  });

  test('automatic-attack is unaffected even with Doors of Night in play', () => {
    // Isengard: Wolves 3 strikes, 7 prowess. Clouds' bonus is hazard-creature
    // only — a site automatic-attack must stay at 7.
    const state = setupAutoAttackStep(
      addP2CardsInPlay(buildSitePhaseState({ site: ISENGARD }), [cloudsInPlay, doorsOfNightInPlay]),
    );
    const nextState = dispatch(state, { type: 'pass', player: PLAYER_1 });
    expect(nextState.combat).toBeDefined();
    expect(nextState.combat!.strikeProwess).toBe(7);
    expect(nextState.combat!.strikesTotal).toBe(3);
  });

  test('agent attack is unaffected even with Doors of Night in play', () => {
    // Agent hazard attacks run through the same global all-attacks modifiers
    // as creature attacks, so Clouds gates on `attack.isAgentAttack $ne true`.
    // Elerína (dm-7) has prowess 5 and, revealed away from home, takes no
    // rule-3.iv.6.1 modifier: the attack stays at 5.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [], cardsInPlay: [cloudsInPlay, doorsOfNightInPlay] },
        { id: PLAYER_2, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const agent = makeAgent(ELERINA, { revealed: true });
    const state = withAgentInPlay(
      { ...base, phaseState: makeSitePhase({ step: 'declare-agent-attack', siteEntered: false }) },
      HAZARD_PLAYER,
      { ...agent, siteStack: [{ instanceId: AGENT_SITE_ID, definitionId: MORIA, status: CardStatus.Untapped }] },
    );

    const declare = viableActions(state, PLAYER_2, 'declare-agent-attack')
      .find(ea => (ea.action as DeclareAgentAttackAction).tapForExtraStrike !== true);
    expect(declare).toBeDefined();

    const after = dispatch(state, declare!.action);
    expect(after.combat).not.toBeNull();
    expect(after.combat!.strikeProwess).toBe(5);
  });

  test('cannot be duplicated (duplication-limit scope game max 1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [CLOUDS], siteDeck: [MINAS_TIRITH], cardsInPlay: [cloudsInPlay] },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
    const actions = viableActions(readyState, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.viable);
    expect(actions).toHaveLength(0);
  });

  test('cannot be duplicated when the opponent has a copy in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA], cardsInPlay: [cloudsInPlay] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [CLOUDS], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
    const actions = viableActions(readyState, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.viable);
    expect(actions).toHaveLength(0);
  });

  test('is playable when no other copy is in play (positive control)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [CLOUDS], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const readyState = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
    const actions = viableActions(readyState, PLAYER_2, 'play-hazard')
      .filter(a => a.action.type === 'play-hazard' && a.viable);
    expect(actions.length).toBeGreaterThan(0);
  });
});
