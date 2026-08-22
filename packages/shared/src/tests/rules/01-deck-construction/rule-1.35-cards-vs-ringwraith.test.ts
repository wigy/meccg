/**
 * @module rule-1.35-cards-vs-ringwraith
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.35: Cards Not Playable vs Ringwraith
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * The following cards cannot be played against a Ringwraith opponent, and have no effect on Ringwraith players nor their entities if played by a Ringwraith player:
 * • Hazards that require an agent (as an active condition)
 * • Bane of the Ithil-stone
 * • The Black Enemy's Wrath
 * • Foul Fumes
 * • In the Heart of His Realm
 * • Mordor in Arms
 * • Mûmak
 * • Worn and Famished
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, Phase, computeLegalActions } from '../../../index.js';
import type { CardDefinitionId } from '../../../index.js';
import {
  buildTestState, resetMint, handCardId,
  viableActions, nonViableOfType,
  makeWildernessMHState, buildAgentHazardVsOpponent,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN,
} from '../../test-helpers.js';

// dm-72 = Mordor in Arms — a hazard permanent-event with no play-target,
// so it is unconditionally offered as a viable play-hazard action once
// BANNED_VS_RINGWRAITH_OPPONENT is not blocking it.
const MORDOR_IN_ARMS = 'dm-72' as CardDefinitionId;

// as-33 = Pilfer Anything Unwatched — "Playable on an untapped agent", the
// clearest case of an agent as an active condition, and one whose own text
// carries no opponent clause.
const PILFER_ANYTHING_UNWATCHED = 'as-33' as CardDefinitionId;
// tw-128 = Beretar — home site Bree, so he is a legal target for Pilfer while
// Bill Ferny sits face-down at home.
const BERETAR = 'tw-128' as CardDefinitionId;
// dm-62 = Great Need or Purpose — "Each agent may take an extra agent action",
// one of the three cards CRF 22 names as still playable vs a Ringwraith.
const GREAT_NEED_OR_PURPOSE = 'dm-62' as CardDefinitionId;

describe('Rule 1.35 — Cards Not Playable vs Ringwraith', () => {
  beforeEach(() => resetMint());

  test('a banned card is viable to play when the opponent is not a Ringwraith player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [MORDOR_IN_ARMS], siteDeck: [] },
      ],
    });
    const gameState = { ...state, phaseState: makeWildernessMHState() };
    const cardId = handCardId(gameState, HAZARD_PLAYER);

    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays.some(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardId)).toBe(true);
  });

  test('a banned card cannot be played when the opponent is a Ringwraith player', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [MORDOR_IN_ARMS], siteDeck: [] },
      ],
    });
    const gameState = { ...state, phaseState: makeWildernessMHState() };
    const cardId = handCardId(gameState, HAZARD_PLAYER);
    const actions = computeLegalActions(gameState, PLAYER_2);

    // Never offered as a viable play-hazard action.
    const plays = viableActions(gameState, PLAYER_2, 'play-hazard');
    expect(plays.some(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardId)).toBe(false);

    // Reported to the UI as explicitly not-playable, naming the minion opponent
    // (the ban covers both Ringwraith and Balrog players).
    const notPlayable = nonViableOfType(actions, 'not-playable')
      .find(a => 'cardInstanceId' in a.action && a.action.cardInstanceId === cardId);
    expect(notPlayable?.reason).toMatch(/minion player/);
  });

  // ── First bullet: hazards that require an agent ──────────────────────────
  //
  // Unlike the seven named cards, this bullet is a class, and the class is
  // narrower than its wording: CRF 22 spells out that *Near to Hear a Whisper*,
  // *Sudden Fury* and *Great Need or Purpose* "may be played because they do not
  // target a specific agent". So the ban is on a hazard whose active condition
  // names one agent, not on any hazard that mentions agents.

  test('a hazard that targets a specific agent is not playable against a Ringwraith opponent', () => {
    // Pilfer Anything Unwatched: "Playable on an untapped agent." Its own card
    // text carries no opponent clause, so rule 1.8.1 is the only thing that can
    // stop it — and the same fixture with a Wizard opponent proves it would
    // otherwise be a live play.
    const vsWizard = buildAgentHazardVsOpponent(PILFER_ANYTHING_UNWATCHED, Alignment.Wizard, [BERETAR, LEGOLAS]);
    const vsRingwraith = buildAgentHazardVsOpponent(PILFER_ANYTHING_UNWATCHED, Alignment.Ringwraith, [BERETAR, LEGOLAS]);

    expect(viableActions(vsWizard, PLAYER_2, 'play-hazard')).toHaveLength(1);
    expect(viableActions(vsRingwraith, PLAYER_2, 'play-hazard')).toHaveLength(0);
  });

  test('a hazard that affects agents at large stays playable against a Ringwraith opponent', () => {
    // Great Need or Purpose: "Each agent may take an extra agent action each
    // time he normally takes an agent action." It names no agent, so the ban
    // does not reach it — CRF 22 lists it by name as still playable.
    const vsWizard = buildAgentHazardVsOpponent(GREAT_NEED_OR_PURPOSE, Alignment.Wizard, [ARAGORN]);
    const vsRingwraith = buildAgentHazardVsOpponent(GREAT_NEED_OR_PURPOSE, Alignment.Ringwraith, [ARAGORN]);

    expect(viableActions(vsWizard, PLAYER_2, 'play-hazard')).toHaveLength(1);
    expect(viableActions(vsRingwraith, PLAYER_2, 'play-hazard')).toHaveLength(1);
  });
});
