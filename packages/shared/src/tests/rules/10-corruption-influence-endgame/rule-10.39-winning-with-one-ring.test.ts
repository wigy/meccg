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
  buildTestState, PLAYER_1, PLAYER_2, resetMint,
  dispatch, findCharInstanceId, RESOURCE_PLAYER,
} from '../../test-helpers.js';
import type { EndOfTurnPhaseState } from '../../../index.js';

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
        const char = p.characters[rwId as string];
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

  // One sub-test per remaining alignment. These cards are implemented in later
  // phases of specs/2026-06-08-one-ring-win-conditions.md; the assertions live
  // in the per-card nightly tests under tests/cards/.
  test.todo('[HERO] Cracks of Doom (tw-205): Ring at Mount Doom, −4 corruption check success ⇒ win');
  test.todo("[HERO] Gollum's Fate (tw-247): Ring + Gollum at Mount Doom ⇒ immediate win");
  test.todo('[FALLEN-WIZARD] A New Ringlord (wh-60): end-of-turn roll > 9 ⇒ win');
  test.todo('[BALROG] Challenge the Power (ba-52): roll > 10 ⇒ win');
});
