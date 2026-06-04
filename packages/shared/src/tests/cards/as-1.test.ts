/**
 * @module as-1.test
 *
 * Card test: Bûrat (as-1)
 * Type: minion-character (ringwraith)
 * Prowess 5 / Body 8 / Mind 4 / DI 0 / MP 1
 * Skills: warrior, ranger
 * Race: troll
 * Homesite: Any non-Under-deeps Ruins & Lairs
 *
 * "Unique. Manifestation of 'Bert'. May not be included with a starting
 *  company. May be played on the same turn Tûma and/or Wûluag is played,
 *  without counting against the one character per turn limit. Discard on a
 *  body check result of 8. +1 prowess against Dwarves. Tap Bûrat to untap
 *  Tûma or Wûluag if at the same site. If Tûma and/or Wûluag is in his
 *  company, Bûrat's mind is reduced by one."
 *
 * | # | Effect                                              | Status          | Notes                                    |
 * |---|-----------------------------------------------------|-----------------|------------------------------------------|
 * | 1 | not-starting-character (play-flag)                  | IMPLEMENTED     | blocked at draft; discardBodyCheck[8]    |
 * | 2 | +1 prowess vs Dwarves (stat-modifier)               | IMPLEMENTED     | reason=combat, enemy.race=dwarf          |
 * | 3 | discardBodyCheck: [8] (structural)                  | IMPLEMENTED     | engine handles structurally              |
 * | 4 | may be played same turn as Tûma/Wûluag w/o limit    | NOT IMPLEMENTED | no extra-character-per-turn DSL support  |
 * | 5 | tap to untap Tûma/Wûluag at same site               | NOT IMPLEMENTED | no grant-action type for this            |
 * | 6 | mind -1 when Tûma/Wûluag in company                 | NOT IMPLEMENTED | mind not a supported stat-modifier stat  |
 *
 * Playable: PARTIALLY
 * NOT CERTIFIED — effects 4, 5, 6 require engine support not yet built.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN,
  Alignment,
  buildTestState, resetMint,
  findCharInstanceId,
  Phase,
  createGame, makePlayDeck, pool, draftInstId,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { CardDefinitionId, CharacterCard, GameConfig } from '../../index.js';
import { computeLegalActions } from '../../index.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';

const BURAT = 'as-1' as CardDefinitionId;
const PERCHEN = 'as-4' as CardDefinitionId;
const MIONID = 'as-3' as CardDefinitionId;

// Minion sites for draft and company setup
const MINAS_MORGUL = 'le-390' as CardDefinitionId;  // darkhaven
const DOL_GULDUR = 'le-367' as CardDefinitionId;    // darkhaven
const ETTENMOORS = 'le-373' as CardDefinitionId;    // ruins-and-lairs (minion)

describe('Bûrat (as-1)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: cannot be drafted as a starting character ──────────────────────

  test('cannot be drafted as a starting character', () => {
    // Bûrat carries the not-starting-character play-flag.  When he appears in
    // the draft pool the legal action for picking him must be non-viable.
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Ringwraith,
          draftPool: [BURAT, PERCHEN, MIONID],
          playDeck: makePlayDeck(),
          siteDeck: [MINAS_MORGUL, DOL_GULDUR, ETTENMOORS],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN, LEGOLAS],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    const state = createGame(config, pool);
    const buratInstId = draftInstId(state, 0, BURAT);

    const actions = computeLegalActions(state, PLAYER_1);
    const buratPick = actions.find(
      ea => ea.action.type === 'draft-pick'
        && ea.action.characterInstanceId === buratInstId,
    );

    expect(buratPick).toBeDefined();
    expect(buratPick!.viable).toBe(false);
  });

  // ── Effect 2: +1 prowess against Dwarves ─────────────────────────────────────

  test('+1 prowess in combat against Dwarves', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [BURAT] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const buratId = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    const burat = state.players[RESOURCE_PLAYER].characters[buratId as string];
    const buratDef = state.cardPool[burat.definitionId as string] as CharacterCard;

    expect(computeCombatProwess(state, burat, buratDef, 'dwarf')).toBe(buratDef.prowess + 1);
  });

  test('no prowess bonus against non-Dwarf enemies', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: ETTENMOORS, characters: [BURAT] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        {
          id: PLAYER_2,
          companies: [{ site: LORIEN, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [RIVENDELL],
        },
      ],
    });

    const buratId = findCharInstanceId(state, RESOURCE_PLAYER, BURAT);
    const burat = state.players[RESOURCE_PLAYER].characters[buratId as string];
    const buratDef = state.cardPool[burat.definitionId as string] as CharacterCard;

    expect(computeCombatProwess(state, burat, buratDef, 'orc')).toBe(buratDef.prowess);
    expect(computeCombatProwess(state, burat, buratDef, 'elf')).toBe(buratDef.prowess);
    expect(computeCombatProwess(state, burat, buratDef, 'troll')).toBe(buratDef.prowess);
  });

  // ── Effects 4–6: unimplemented engine rules ───────────────────────────────────

  test.todo('may be played same turn as Tûma/Wûluag without counting against the one-character-per-turn limit');

  test.todo('tap Bûrat to untap Tûma or Wûluag if at the same site');

  test.todo('mind is reduced by 1 when Tûma or Wûluag is in his company');
});
