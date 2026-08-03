/**
 * @module rule-3.15-agent-as-character
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.15: Agent Played as Character
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * An agent may be played as a character if it counts as a character for its player's deck-building requirements (i.e. for Ringwraith and Fallen-wizard players). An agent played as a character can only be played at the character's home site, and cannot be targeted nor affected by effects that specifically affect "agents" unless the effect specifies an "agent character."
 *
 * Rule 1.3.W2: For Wizard players, agent cards are treated as hazard cards in all areas throughout the game and cannot be played as characters.
 * Rule 1.3.B2: For Balrog players, agent cards are treated as hazard cards in all areas throughout the game and cannot be played as characters.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, Alignment,
  viablePlayCharacterActions, nonViablePlayCharacterActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN,
} from '../../test-helpers.js';
import type { CardDefinitionId } from '../../../index.js';

// dm-11: Fori the Beardless — minion-character, agent, homesite: Iron Hill Dwarf-hold, mind 4
const FORI_THE_BEARDLESS = 'dm-11' as CardDefinitionId;
// tw-403: Iron Hill Dwarf-hold — hero-site (homesite of Fori the Beardless)
const IRON_HILL_DWARF_HOLD = 'tw-403' as CardDefinitionId;
// dm-182: Freca — minion-character, agent, homesite: "Edoras, Dunnish Clan-hold" (two listed home sites)
const FRECA = 'dm-182' as CardDefinitionId;
// tw-394: Edoras — hero-site, the second of Freca's two comma-listed home sites
const EDORAS = 'tw-394' as CardDefinitionId;

describe('Rule 3.15 — Agent Played as Character', () => {
  beforeEach(() => resetMint());

  test('Wizard player cannot play an agent character card as a character (treated as hazard)', () => {
    // Rule 1.3.W2: For Wizard players, agent cards are treated as hazard cards
    // in all areas throughout the game, so they cannot be played as characters.
    // Fori the Beardless (dm-11) is an agent; p1 is a Wizard — it must be non-viable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Wizard,
          hand: [FORI_THE_BEARDLESS],
          siteDeck: [RIVENDELL, IRON_HILL_DWARF_HOLD],
          companies: [],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        },
      ],
      recompute: true,
    });

    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
    expect(nonViablePlayCharacterActions(state, PLAYER_1).length).toBeGreaterThan(0);
  });

  test('Ringwraith player can play an agent character, but only at its home site', () => {
    // Rule 2.II.2.2.5: Ringwraith players may play agents as characters, but
    // only at the character's home site. Iron Hill Dwarf-hold is Fori's homesite;
    // Rivendell is a haven but NOT the homesite — only the homesite play is viable.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          hand: [FORI_THE_BEARDLESS],
          siteDeck: [IRON_HILL_DWARF_HOLD],
          companies: [],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBe(1);

    const ironHillInst = state.players[0].siteDeck.find(s => s.definitionId === IRON_HILL_DWARF_HOLD)!.instanceId;
    expect(viable[0].atSite).toBe(ironHillInst);
  });

  test('Ringwraith player cannot play an agent character at a haven (home-site-only restriction)', () => {
    // Rule 2.II.2.2.5: An agent played as a character can only be played at the
    // character's home site, not at havens. Rivendell is a haven, not Fori's homesite.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          hand: [FORI_THE_BEARDLESS],
          siteDeck: [RIVENDELL],
          companies: [],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    expect(viablePlayCharacterActions(state, PLAYER_1)).toHaveLength(0);
    const nonViable = nonViablePlayCharacterActions(state, PLAYER_1);
    expect(nonViable.length).toBeGreaterThan(0);
  });

  test('Ringwraith player can play an agent character at any one of its comma-listed home sites', () => {
    // Regression: Freca's homesite is "Edoras, Dunnish Clan-hold" — a
    // comma-separated list naming two valid home sites, either of which
    // satisfies the home-site-only restriction. A company already sitting at
    // Edoras (the second listed name) must make Freca viable there.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          hand: [FRECA],
          siteDeck: [],
          companies: [{ site: EDORAS, characters: [] }],
        },
        {
          id: PLAYER_2,
          hand: [],
          siteDeck: [],
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
        },
      ],
      recompute: true,
    });

    const viable = viablePlayCharacterActions(state, PLAYER_1);
    expect(viable.length).toBe(1);
    expect(viable[0].atSite).toBe(state.players[0].companies[0].currentSite!.instanceId);
  });
});
