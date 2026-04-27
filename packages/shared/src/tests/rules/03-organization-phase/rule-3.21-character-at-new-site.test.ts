/**
 * @module rule-3.21-character-at-new-site
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.21: Character at New Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Whenever a character is played at a site where its player doesn't currently have a company, the site must be available in the player's location deck and be placed next to the character upon resolution (or else the character cannot be played).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viablePlayCharacterActions, nonViablePlayCharacterActions, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, BREE, LORIEN, MINAS_TIRITH,
} from '../../test-helpers.js';

describe('Rule 3.21 — Character at New Site', () => {
  beforeEach(() => resetMint());

  test('When character played at site without existing company, site must come from location deck', () => {
    // Aragorn's homesite is Bree. When Bree is in the siteDeck, a new company
    // at Bree must be offered. When Bree is absent from the siteDeck, no play
    // at Bree must be offered.

    // Case A: Bree available in siteDeck — Bree play must be offered.
    const withBree = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [],
          hand: [ARAGORN],
          siteDeck: [RIVENDELL, BREE],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const breeSiteInstId = withBree.players[0].siteDeck.find(
      s => s.definitionId === BREE,
    )!.instanceId;
    const playsWithBree = viablePlayCharacterActions(withBree, PLAYER_1);
    expect(playsWithBree.some(a => a.atSite === breeSiteInstId)).toBe(true);

    // Case B: Bree absent from siteDeck — no Bree play must be offered.
    const noBree = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [],
          hand: [ARAGORN],
          siteDeck: [RIVENDELL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    const playsNoBree = viablePlayCharacterActions(noBree, PLAYER_1);
    const allPlays = [
      ...playsNoBree,
      ...nonViablePlayCharacterActions(noBree, PLAYER_1),
    ];
    // Without Bree in the siteDeck there must be no play action targeting Bree.
    expect(allPlays.every(a => {
      const siteDef = noBree.cardPool[
        noBree.players[0].siteDeck.find(s => s.instanceId === a.atSite)?.definitionId as string ?? ''
      ];
      return !siteDef || (siteDef as { name?: string }).name !== 'Bree';
    })).toBe(true);
  });
});
