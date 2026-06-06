/**
 * @module rule-1.12-minion-characters
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.12: Minion Characters
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith player's characters can only be minion characters, with agent character cards counting as characters for deck-building requirements. During the game, an agent card in a Ringwraith player's deck counts as both a character card and a hazard card until it is played as one or the other.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viablePlayCharacterActions, Phase,
  PLAYER_1, PLAYER_2,
  LEGOLAS,
  LORIEN,
  Alignment,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../../index.js';

// The Grimburgoth (dm-15): minion agent character, homesite "Dol Guldur", mind 8
const GRIMBURGOTH = 'dm-15' as CardDefinitionId;
// Dol Guldur (le-367): minion haven site — matches The Grimburgoth's homesite
const DOL_GULDUR = 'le-367' as CardDefinitionId;
// Carn Dûm (le-359): minion haven used as second site deck entry
const CARN_DUM = 'le-359' as CardDefinitionId;

describe('Rule 1.12 — Minion Characters', () => {
  beforeEach(() => resetMint());

  test('[MINION] Ringwraith player can play agent character at the agent\'s home site', () => {
    // The Grimburgoth has the "agent" keyword and homesite "Dol Guldur". For a
    // Ringwraith player, agents count as character cards and may be played at
    // the agent's home site (rule 1.12 / rule 2.II.2.2.5). The engine must
    // offer a viable play-character action at Dol Guldur.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          hand: [GRIMBURGOTH],
          siteDeck: [DOL_GULDUR, CARN_DUM],
          companies: [],
        },
        { id: PLAYER_2, hand: [], siteDeck: [], companies: [{ site: LORIEN, characters: [LEGOLAS] }] },
      ],
      recompute: true,
    });

    const grimburgothInstId = state.players[0].hand.find(c => c.definitionId === GRIMBURGOTH)?.instanceId;
    const dolGuldurInstId = state.players[0].siteDeck.find(s => s.definitionId === DOL_GULDUR)?.instanceId;

    const viable = viablePlayCharacterActions(state, PLAYER_1);

    // The Grimburgoth must be playable at its homesite (Dol Guldur)
    expect(viable.some(a =>
      a.characterInstanceId === grimburgothInstId &&
      a.atSite === dolGuldurInstId,
    )).toBe(true);
  });
});
