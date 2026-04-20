/**
 * @module td-91.test
 *
 * Card test: Fram Framson (td-91)
 * Type: hero-character (wizard alignment)
 * Effects: 2 (play-flag: not-starting-character, play-flag: home-site-only)
 *
 * "Unique. He may not be one of the starting characters. He may only be
 *  brought into play at his home site. +3 prowess against Dragon and
 *  Drake attacks."
 *
 * Fram Framson is a unique Warrior/Ranger Man with homesite Framsburg.
 * His card text forbids him from being one of the starting characters —
 * he must enter play later, drawn from the play deck and brought into
 * play at Framsburg.
 *
 * Engine Support:
 * | # | Feature                                | Status      | Notes                              |
 * |---|---------------------------------------|-------------|------------------------------------|
 * | 1 | not-starting-character draft rejection | IMPLEMENTED | character-draft rule + play-flag    |
 * | 2 | home-site-only play restriction        | IMPLEMENTED | organization-characters.ts          |
 * | 3 | +3 prowess vs Dragon/Drake attacks     | TODO        | not modeled in DSL yet              |
 *
 * Playable: YES
 * Certified: 2026-04-20
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  createGame,
  resetMint,
  makePlayDeck,
  pool,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS, GIMLI, FARAMIR, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
  Alignment,
  draftInstId,
} from '../test-helpers.js';
import type { CardDefinitionId, GameConfig } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';

const FRAM_FRAMSON = 'td-91' as CardDefinitionId;

describe('Fram Framson (td-91)', () => {
  beforeEach(() => resetMint());

  test('cannot be drafted as a starting character', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN, BILBO, FRAM_FRAMSON],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [LEGOLAS, GIMLI, FARAMIR, DAGGER_OF_WESTERNESSE],
          playDeck: makePlayDeck(),
          siteDeck: [LORIEN, MORIA, MINAS_TIRITH],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    const state = createGame(config, pool);
    const framInstanceId = draftInstId(state, 0, FRAM_FRAMSON);

    const actions = computeLegalActions(state, PLAYER_1);

    const framPick = actions.find(
      ea => ea.action.type === 'draft-pick'
        && ea.action.characterInstanceId === framInstanceId,
    );
    expect(framPick).toBeDefined();
    expect(framPick!.viable).toBe(false);
    expect(framPick!.reason).toMatch(/may not be one of the starting characters/);
  });

  test('other characters in the pool remain viable picks', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN, BILBO, FRAM_FRAMSON],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [LEGOLAS, GIMLI, FARAMIR, DAGGER_OF_WESTERNESSE],
          playDeck: makePlayDeck(),
          siteDeck: [LORIEN, MORIA, MINAS_TIRITH],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    const state = createGame(config, pool);
    const aragornInstanceId = draftInstId(state, 0, ARAGORN);

    const actions = computeLegalActions(state, PLAYER_1);
    const aragornPick = actions.find(
      ea => ea.action.type === 'draft-pick'
        && ea.action.characterInstanceId === aragornInstanceId,
    );
    expect(aragornPick).toBeDefined();
    expect(aragornPick!.viable).toBe(true);
  });
});
