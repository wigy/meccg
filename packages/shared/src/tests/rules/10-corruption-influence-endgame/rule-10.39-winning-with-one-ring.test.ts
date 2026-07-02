/**
 * @module rule-10.39-winning-with-one-ring
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.39: Winning with The One Ring
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Winning with The One Ring - The conditions that allow a player to win the game with The One Ring are specific to the type of player.
 * [HERO] If a Wizard player plays Cracks of Doom or Gollum's Fate and the conditions outlined on the card are met, that player wins.
 * [MINION] If a Ringwraith player's company is bearing The One Ring at Barad-dûr, that player wins.
 * [FALLEN-WIZARD] If a Fallen-wizard player has A New Ringlord in play and the conditions outlined on the card are met, that player wins.
 * [BALROG] If a Balrog player has Challenge the Power in play and the conditions outlined on the card are met, that player wins.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Phase, CardDefinitionId, CardStatus, Alignment } from '../../../index.js';
import {
  buildTestState, buildSitePhaseState, PLAYER_1, PLAYER_2, resetMint,
  dispatch, findCharInstanceId, handCardId, RESOURCE_PLAYER,
  attachAllyToChar, attachItemToChar, viableActions, playPermanentEventAndResolve,
  LORIEN,
} from '../../test-helpers.js';
import type { EndOfTurnPhaseState, GameOverPhaseState, GameState, PlayShortEventAction, SitePhaseState } from '../../../index.js';
import { computeLegalActions } from '../../../engine/legal-actions/index.js';

// Minion sites
const BARAD_DUR_MINION = 'le-352' as CardDefinitionId;  // dark-hold (Ringwraith win condition site)
const CARN_DUM = 'le-359' as CardDefinitionId;           // haven (Darkhaven)

// Minion character (Ringwraith avatar)
const ADUNAPHEL = 'le-50' as CardDefinitionId;

// Hero character for opponent
const ARAGORN = 'tw-120' as CardDefinitionId;

// Sites
const RIVENDELL = 'tw-421' as CardDefinitionId;
const MORIA = 'tw-413' as CardDefinitionId;

// The One Ring item
const THE_ONE_RING = 'tw-347' as CardDefinitionId;

// [HERO] Cracks of Doom / Gollum's Fate fixtures
const CRACKS_OF_DOOM = 'tw-205' as CardDefinitionId;
const GOLLUMS_FATE = 'tw-247' as CardDefinitionId;
const FRODO = 'tw-152' as CardDefinitionId;
const GOLLUM = 'tw-246' as CardDefinitionId;
const MOUNT_DOOM = 'tw-414' as CardDefinitionId;

// [FALLEN-WIZARD] A New Ringlord fixtures
const A_NEW_RINGLORD = 'wh-60' as CardDefinitionId;
const GANDALF = 'tw-156' as CardDefinitionId; // wizard avatar, played as Fallen-wizard
const AMON_HEN = 'tw-371' as CardDefinitionId; // Ruins & Lairs where Information is playable

// [BALROG] Challenge the Power fixtures
const CHALLENGE_THE_POWER = 'ba-52' as CardDefinitionId;
const BALROG_STAND_IN = 'le-50' as CardDefinitionId; // ringwraith avatar (mind null) standing in for The Balrog — see ba-52.test.ts
const MORIA_MINION = 'le-392' as CardDefinitionId;

describe('Rule 10.39 — Winning with The One Ring', () => {
  beforeEach(() => resetMint());

  test('[MINION] Ringwraith bearing The One Ring at Barad-dûr wins immediately — even with fewer MP', () => {
    // [MINION] Ringwraith player bears The One Ring at Barad-dûr → immediate win on end-of-turn pass.
    // The opponent has strictly more marshalling points, proving the win is forced
    // by The One Ring (MELE §1) rather than decided by scoring.
    const base = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: BARAD_DUR_MINION, characters: [ADUNAPHEL] }],
          hand: [],
          siteDeck: [CARN_DUM],
          marshallingPoints: { character: 0 },
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          marshallingPoints: { character: 20 },
        },
      ],
    });

    // Attach The One Ring to Adunaphel
    const rwId = findCharInstanceId(base, RESOURCE_PLAYER, ADUNAPHEL);
    const oneRingItem = { instanceId: 'one-ring-inst' as never, definitionId: THE_ONE_RING, status: CardStatus.Untapped };
    const endOfTurnPhaseState: EndOfTurnPhaseState = {
      phase: Phase.EndOfTurn,
      step: 'signal-end',
      discardDone: [true, true],
      resetHandDone: [true, true],
    };
    const stateWithRing = {
      ...base,
      phaseState: endOfTurnPhaseState,
      players: base.players.map((p, i) => {
        if (i !== RESOURCE_PLAYER) return p;
        const char = p.characters[rwId];
        return {
          ...p,
          characters: {
            ...p.characters,
            [rwId as string]: {
              ...char,
              items: [...char.items, oneRingItem],
            },
          },
        };
      }) as unknown as typeof base.players,
    };

    const after = dispatch(stateWithRing, { type: 'pass', player: PLAYER_1 });

    // A One Ring win is immediate (MELE §1): straight to Game Over, bypassing
    // Free Council corruption checks entirely.
    expect(after.phaseState.phase).toBe(Phase.GameOver);
    if (after.phaseState.phase !== Phase.GameOver) throw new Error('expected GameOver');

    // The Ringwraith is the forced winner despite having fewer marshalling points.
    expect(after.phaseState.winner).toBe(PLAYER_1);
    expect(after.phaseState.winReason.kind).toBe('one-ring');
    if (after.phaseState.winReason.kind === 'one-ring') {
      expect(after.phaseState.winReason.alignment).toBe(Alignment.Ringwraith);
      // The Ringwraith positional win has no win-condition card.
      expect(after.phaseState.winReason.card).toBeNull();
    }
  });

  // The full per-card mechanics (playability gating, roll thresholds, failure
  // consequences) for all four cards below are exercised exhaustively in
  // their own nightly card tests (tests/cards/tw-205, tw-247, wh-60, ba-52).
  // Each test here reuses that same real mechanism to prove this rule's
  // specific claim: winning is recorded as a `one-ring` reason tied to the
  // named card and the player's alignment.

  test("[HERO] Cracks of Doom (tw-205): Ring at Mount Doom, successful −4 corruption check ⇒ win", () => {
    const state = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [CRACKS_OF_DOOM],
    });
    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === eventInstance);
    const afterPlay = dispatch(state, playActions[0]);

    // Ring CP 6, modifier −4 → need a die total of 11+ to pass (11 − 4 = 7 > 6).
    const ccAction = viableActions(afterPlay, PLAYER_1, 'corruption-check')[0].action;
    const after = dispatch({ ...afterPlay, cheatRollTotal: 12 }, ccAction);

    expect(after.phaseState.phase).toBe(Phase.GameOver);
    const go = after.phaseState as GameOverPhaseState;
    expect(go.winner).toBe(PLAYER_1);
    expect(go.winReason.kind).toBe('one-ring');
    if (go.winReason.kind === 'one-ring') {
      expect(go.winReason.alignment).toBe(Alignment.Wizard);
      expect(go.winReason.card).toBe(CRACKS_OF_DOOM);
    }
  });

  test("[HERO] Gollum's Fate (tw-247): Ring + Gollum at Mount Doom ⇒ immediate win", () => {
    let state: GameState = buildSitePhaseState({
      site: MOUNT_DOOM,
      characters: [{ defId: FRODO, items: [THE_ONE_RING] }],
      hand: [GOLLUMS_FATE],
    });
    state = attachAllyToChar(state, RESOURCE_PLAYER, FRODO, GOLLUM);

    const eventInstance = handCardId(state, RESOURCE_PLAYER);
    const playActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.cardInstanceId === eventInstance);
    const after = dispatch(state, playActions[0]);

    expect(after.phaseState.phase).toBe(Phase.GameOver);
    const go = after.phaseState as GameOverPhaseState;
    expect(go.winner).toBe(PLAYER_1);
    expect(go.winReason.kind).toBe('one-ring');
    if (go.winReason.kind === 'one-ring') {
      expect(go.winReason.alignment).toBe(Alignment.Wizard);
      expect(go.winReason.card).toBe(GOLLUMS_FATE);
    }
  });

  test('[FALLEN-WIZARD] A New Ringlord (wh-60): end-of-turn roll > 9 ⇒ win', () => {
    let state: GameState = buildTestState({
      phase: Phase.EndOfTurn,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: AMON_HEN, characters: [GANDALF] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF, THE_ONE_RING);
    state = attachItemToChar(state, RESOURCE_PLAYER, GANDALF, A_NEW_RINGLORD);
    const signalEnd: EndOfTurnPhaseState = {
      phase: Phase.EndOfTurn,
      step: 'signal-end',
      discardDone: [true, true],
      resetHandDone: [true, true],
    };
    state = { ...state, phaseState: signalEnd };

    // +1 for the one copy in play; cheat 12 → total 13 > 9 → win.
    const after = dispatch({ ...state, cheatRollTotal: 12 }, { type: 'pass', player: PLAYER_1 });

    expect(after.phaseState.phase).toBe(Phase.GameOver);
    const go = after.phaseState as GameOverPhaseState;
    expect(go.winner).toBe(PLAYER_1);
    expect(go.winReason.kind).toBe('one-ring');
    if (go.winReason.kind === 'one-ring') {
      expect(go.winReason.alignment).toBe(Alignment.FallenWizard);
      expect(go.winReason.card).toBe(A_NEW_RINGLORD);
    }
  });

  test('[BALROG] Challenge the Power (ba-52): roll > 10 ⇒ win', () => {
    let state: GameState = buildTestState({
      phase: Phase.Site,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Balrog,
          companies: [{ site: MORIA_MINION, characters: [BALROG_STAND_IN] }],
          hand: [CHALLENGE_THE_POWER],
          siteDeck: [MORIA],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
        },
      ],
    });
    state = attachItemToChar(state, RESOURCE_PLAYER, BALROG_STAND_IN, THE_ONE_RING);
    const sitePhaseState: SitePhaseState = {
      phase: Phase.Site,
      step: 'play-resources',
      activeCompanyIndex: 0,
      handledCompanyIds: [],
      siteEntered: true,
      resourcePlayed: false,
      minorItemAvailable: false,
      hoardBountyAvailable: false,
      thoroughSearchAvailable: false,
      declaredAgentAttack: null,
      automaticAttacksResolved: 0,
      awaitingOnGuardReveal: false,
      pendingResourceAction: null,
      opponentInteractionThisTurn: null,
      pendingOpponentInfluence: null,
    };
    state = { ...state, phaseState: sitePhaseState };

    const avatarId = findCharInstanceId(state, RESOURCE_PLAYER, BALROG_STAND_IN);
    const cardId = handCardId(state, RESOURCE_PLAYER);
    const after = playPermanentEventAndResolve({ ...state, cheatRollTotal: 12 }, PLAYER_1, cardId, avatarId);

    expect(after.phaseState.phase).toBe(Phase.GameOver);
    const go = after.phaseState as GameOverPhaseState;
    expect(go.winner).toBe(PLAYER_1);
    expect(go.winReason.kind).toBe('one-ring');
    if (go.winReason.kind === 'one-ring') {
      expect(go.winReason.alignment).toBe(Alignment.Balrog);
      expect(go.winReason.card).toBe(CHALLENGE_THE_POWER);
    }
  });
});
