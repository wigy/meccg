/**
 * @module le-233.test
 *
 * Card test: Spying out the Land (le-233)
 * Type: minion-resource-event (short), alignment ringwraith, non-unique.
 * Marshalling Points: 0. Keywords: Magic, Spirit-magic.
 *
 * Card text:
 *   "Magic. Spirit-magic. Playable on a spirit-magic-using character during
 *    the organization phase. Opponent may reveal to you any hazards from his
 *    hand, and only those hazards can be played during the character
 *    company's movement/hazard phase. Unless he is a Ringwraith, character
 *    makes a corruption check modified by -3."
 *
 * Effects:
 *   1. play-window: organization
 *   2. play-target: character, filter `target.skills $includes spirit-magic`
 *   3. on-event self-enters-play → enqueue-reveal-hazards-choice
 *      (`agentAlternative: false`) — the shared Here Is a Snake! (dm-137)
 *      reveal-hazards-choice resolution, on the target character's company,
 *      without Snake's tap-reveal-agent alternative. On `pass` the revealed
 *      set becomes an `only-revealed-hazards-on-company` constraint scoped
 *      `company-mh-phase`, so it survives the organization phase and lasts
 *      through that company's movement/hazard phase.
 *   4. on-event self-enters-play → enqueue-corruption-check -3, gated
 *      `$not target.race ringwraith`.
 *
 * Rule coverage:
 * | # | Rule                                                                  | Status      |
 * |---|-----------------------------------------------------------------------|-------------|
 * | 1 | Playable on a spirit-magic user; not on a non-spirit-magic character   | IMPLEMENTED |
 * | 2 | Playable only during the organization phase                            | IMPLEMENTED |
 * | 3 | Opponent may reveal any hazards from hand (no agent alternative)       | IMPLEMENTED |
 * | 4 | Only revealed hazards playable during the company's M/H phase          | IMPLEMENTED |
 * | 5 | Revealing nothing blocks every hazard play against the company         | IMPLEMENTED |
 * | 6 | Restriction outlives the org phase, expires with the company's M/H     | IMPLEMENTED |
 * | 7 | Ringwraith target makes no corruption check                            | IMPLEMENTED |
 * | 8 | Non-Ringwraith target makes a corruption check modified by -3          | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   SPYING (le-233)       - this card
 *   ADUNAPHEL (le-50)     - Ringwraith, spirit-magic user
 *   GORBAG (le-11)        - orc (warrior/scout, no spirit-magic)
 *   VARIAG_CAMP (le-411)  - minion border-hold (company site)
 *   LURE (tw-60)          - hazard permanent-event on a non-Ringwraith character
 *   FOOLISH_WORDS (td-25) - hazard permanent-event on any character
 *   BADUILA (dm-2)        - face-down agent held by the hazard player
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, dispatch, makeMHState, viableActions,
  findHandCardId, expectInDiscardPile, getCharacter, companyIdAt,
  MINAS_TIRITH, PLAYER_1, PLAYER_2, Phase, RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CardInstanceId, CompanyId, GameState, PlayShortEventAction, PlayHazardAction,
  AgentInPlay, CharacterInPlay,
} from '../../index.js';
import { Alignment, CardStatus, ZERO_EFFECTIVE_STATS, reduce } from '../../index.js';
import { sweepExpired } from '../../engine/pending.js';

const SPYING = 'le-233' as CardDefinitionId;
const ADUNAPHEL = 'le-50' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;
const VARIAG_CAMP = 'le-411' as CardDefinitionId;
const LURE = 'tw-60' as CardDefinitionId;
const FOOLISH_WORDS = 'td-25' as CardDefinitionId;
const BADUILA = 'dm-2' as CardDefinitionId;
const MORIA = 'tw-413' as CardDefinitionId;

const AGENT_CHAR: CharacterInPlay = {
  instanceId: 'test-le233-agent-char' as CardInstanceId,
  definitionId: BADUILA,
  status: CardStatus.Untapped,
  items: [], allies: [], hazards: [], followers: [],
  controlledBy: 'general',
  effectiveStats: ZERO_EFFECTIVE_STATS,
};

const AGENT: AgentInPlay = {
  id: 'agent-0-0' as CompanyId,
  character: AGENT_CHAR,
  revealed: false,
  siteStack: [{ instanceId: 'test-le233-agent-site' as CardInstanceId, definitionId: MORIA, status: CardStatus.Untapped }],
  remainingActions: 1,
  inPlayAtTurnStart: true,
  attackedThisSitePhase: false,
  discardAtEndOfTurn: false,
};

/**
 * Organization phase for the Ringwraith player (Adûnaphel + Gorbag at Variag
 * Camp, Spying out the Land in hand). The hero opponent holds two hazard
 * permanent-events, both playable on Gorbag in the M/H phase.
 */
function orgState(phase: Phase = Phase.Organization): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{ site: VARIAG_CAMP, characters: [ADUNAPHEL, GORBAG] }],
        hand: [SPYING],
        playDeck: [MINAS_TIRITH],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Wizard,
        companies: [{ site: MINAS_TIRITH, characters: [] }],
        hand: [LURE, FOOLISH_WORDS],
        siteDeck: [MINAS_TIRITH],
      },
    ],
  });
}

function spyingPlays(state: GameState): PlayShortEventAction[] {
  const cardId = findHandCardId(state, RESOURCE_PLAYER, SPYING);
  return viableActions(state, PLAYER_1, 'play-short-event')
    .map(ea => ea.action as PlayShortEventAction)
    .filter(a => a.cardInstanceId === cardId);
}

function playOn(state: GameState, characterDef: CardDefinitionId): GameState {
  return dispatch(state, {
    type: 'play-short-event',
    player: PLAYER_1,
    cardInstanceId: findHandCardId(state, RESOURCE_PLAYER, SPYING),
    targetCharacterId: getCharacter(state, RESOURCE_PLAYER, characterDef).instanceId,
  });
}

/** Move the (org-phase) state into the company's movement/hazard phase. */
function toMH(state: GameState): GameState {
  return { ...state, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
}

function hazardPlaysAgainst(state: GameState, companyId: CompanyId): Set<CardInstanceId> {
  return new Set(viableActions(state, PLAYER_2, 'play-hazard')
    .map(ea => ea.action as PlayHazardAction)
    .filter(a => a.targetCompanyId === companyId)
    .map(a => a.cardInstanceId));
}

describe('Spying out the Land (le-233)', () => {
  beforeEach(() => resetMint());

  test('playable on a spirit-magic-using character only', () => {
    const state = orgState();
    const plays = spyingPlays(state);
    expect(plays).toHaveLength(1);
    expect(plays[0].targetCharacterId).toBe(getCharacter(state, RESOURCE_PLAYER, ADUNAPHEL).instanceId);
  });

  test('not playable outside the organization phase', () => {
    const state = { ...orgState(Phase.MovementHazard), phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    expect(spyingPlays(state)).toHaveLength(0);
  });

  test('playing it lets the opponent reveal hazards from hand — with no agent alternative', () => {
    const state = orgState();
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const withAgent: GameState = {
      ...state,
      players: [state.players[0], { ...state.players[1], agents: [AGENT] }] as unknown as GameState['players'],
    };
    const after = dispatch(withAgent, spyingPlays(withAgent)[0]);

    expectInDiscardPile(after, RESOURCE_PLAYER, findHandCardId(state, RESOURCE_PLAYER, SPYING));
    expect(after.pendingResolutions).toHaveLength(1);
    const top = after.pendingResolutions[0];
    expect(top.actor).toBe(PLAYER_2);
    expect(top.kind).toEqual({ type: 'reveal-hazards-choice', companyId, revealedIds: [], noAgentAlternative: true });

    const reveals = viableActions(after, PLAYER_2, 'reveal-hazard-for-snake')
      .map(ea => (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId);
    expect(new Set(reveals)).toEqual(new Set([
      findHandCardId(after, HAZARD_PLAYER, LURE),
      findHandCardId(after, HAZARD_PLAYER, FOOLISH_WORDS),
    ]));
    expect(viableActions(after, PLAYER_2, 'pass')).toHaveLength(1);
    expect(viableActions(after, PLAYER_2, 'tap-reveal-agent-for-snake')).toHaveLength(0);

    const tapAttempt = reduce(after, { type: 'tap-reveal-agent-for-snake', player: PLAYER_2, agentId: AGENT.id });
    expect(tapAttempt.error).toBeDefined();
  });

  test('only the revealed hazards can be played during the company\'s movement/hazard phase', () => {
    const state = orgState();
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const lureId = findHandCardId(state, HAZARD_PLAYER, LURE);
    const foolishId = findHandCardId(state, HAZARD_PLAYER, FOOLISH_WORDS);

    // Without the card both hazards are playable against the company.
    const unrestricted = hazardPlaysAgainst(toMH(state), companyId);
    expect(unrestricted.has(lureId)).toBe(true);
    expect(unrestricted.has(foolishId)).toBe(true);

    let after = playOn(state, ADUNAPHEL);
    after = dispatch(after, { type: 'reveal-hazard-for-snake', player: PLAYER_2, cardInstanceId: lureId });
    expect(after.revealedInstances[lureId]).toBe(LURE);
    after = dispatch(after, { type: 'pass', player: PLAYER_2 });

    expect(after.pendingResolutions).toHaveLength(0);
    expect(after.activeConstraints).toHaveLength(1);
    expect(after.activeConstraints[0].kind).toEqual({ type: 'only-revealed-hazards-on-company', allowedInstanceIds: [lureId] });
    expect(after.activeConstraints[0].scope).toEqual({ kind: 'company-mh-phase', companyId });

    const restricted = hazardPlaysAgainst(toMH(after), companyId);
    expect(restricted.has(lureId)).toBe(true);
    expect(restricted.has(foolishId)).toBe(false);
  });

  test('revealing nothing blocks every hazard play against the company', () => {
    const state = orgState();
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = dispatch(playOn(state, ADUNAPHEL), { type: 'pass', player: PLAYER_2 });
    expect(hazardPlaysAgainst(toMH(after), companyId).size).toBe(0);
  });

  test('the restriction survives the organization phase and expires at the end of the company\'s M/H phase', () => {
    const state = orgState();
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const after = dispatch(playOn(state, ADUNAPHEL), { type: 'pass', player: PLAYER_2 });

    const afterOrg = sweepExpired(
      sweepExpired(after, { kind: 'phase-end', phase: Phase.Organization }),
      { kind: 'organization-phase-end', playerId: PLAYER_1, turnNumber: after.turnNumber },
    );
    expect(afterOrg.activeConstraints).toHaveLength(1);

    const afterMH = sweepExpired(afterOrg, { kind: 'company-mh-end', companyId });
    expect(afterMH.activeConstraints).toHaveLength(0);
  });

  test('a Ringwraith target makes no corruption check', () => {
    const after = playOn(orgState(), ADUNAPHEL);
    expect(after.pendingResolutions.filter(r => r.kind.type === 'corruption-check')).toHaveLength(0);
  });

  test('a non-Ringwraith target makes a corruption check modified by -3', () => {
    // Non-Ringwraith spirit-magic users arise via granted skills; the
    // corruption-check gate keys purely on race, so drive the reducer
    // directly against an Orc.
    const state = orgState();
    const after = playOn(state, GORBAG);
    const checks = after.pendingResolutions.filter(r => r.kind.type === 'corruption-check');
    expect(checks).toHaveLength(1);
    expect((checks[0].kind as { modifier?: number }).modifier).toBe(-3);
    expect((checks[0].kind as { characterId?: CardInstanceId }).characterId)
      .toBe(getCharacter(state, RESOURCE_PLAYER, GORBAG).instanceId);
  });
});
