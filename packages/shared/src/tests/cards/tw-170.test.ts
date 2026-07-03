/**
 * @module tw-170.test
 *
 * Card test: Merry (tw-170)
 * Type: hero-character (wizard alignment)
 * Effects: 2 (check-modifier corruption +2, play-flag home-site-only)
 *
 * "Unique. Unless he is one of the starting characters, he may only be
 *  brought into play at his home site. All of his corruption checks are
 *  modified by +2."
 *
 * Merry is a unique Hobbit Scout with homesite Bag End. Like the other
 * Bag End hobbits (Frodo tw-152, Sam Gamgee tw-180), his home-site-only
 * restriction applies only when playing him from hand — he remains a
 * legal starting-character draft pick, which the draft test below covers.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import type { CardDefinitionId, GameConfig } from '../../index.js';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FARAMIR, HALDIR, BILBO, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM,
  GLAMDRING,
  Phase, Alignment,
  buildTestState, resetMint,
  createGame, makePlayDeck, pool, draftInstId,
  findCharInstanceId, viablePlayCharacterActions,
  enqueueTransferCorruptionCheck,
  getCharacter, RESOURCE_PLAYER,
} from '../test-helpers.js';
import { computeLegalActions, BAG_END } from '../../index.js';
import type { CorruptionCheckAction } from '../../index.js';

const MERRY = 'tw-170' as CardDefinitionId;

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Merry (tw-170)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: check-modifier (corruption +2) ────────────────────────────

  test('+2 corruption modifier lowers need on pending corruption check', () => {
    // Merry holding Glamdring with a pending corruption check.
    // need = CP + 1 - modifier
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [{ defId: MERRY, items: [GLAMDRING] }, LEGOLAS] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const merryId = findCharInstanceId(state, RESOURCE_PLAYER, MERRY);
    const glamdringInstId = getCharacter(state, RESOURCE_PLAYER, MERRY).items[0].instanceId;

    const stateWithCheck = enqueueTransferCorruptionCheck(state, PLAYER_1, merryId, glamdringInstId);

    const actions = computeLegalActions(stateWithCheck, PLAYER_1);
    const ccActions = actions
      .filter(a => a.viable && a.action.type === 'corruption-check')
      .map(a => a.action as CorruptionCheckAction);

    expect(ccActions.length).toBe(1);
    expect(ccActions[0].characterId).toBe(merryId);
    expect(ccActions[0].corruptionModifier).toBe(2);
    expect(ccActions[0].need).toBe(ccActions[0].corruptionPoints + 1 - 2);
  });

  // ── Effect 2: play-flag home-site-only ──────────────────────────────────

  test('can be played at homesite Bag End', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [MERRY],
          siteDeck: [BAG_END, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    // Merry should be playable at Bag End (from site deck)
    const merryActions = actions.filter(a => {
      const siteDef = state.cardPool[
        state.players[0].siteDeck.find(c => c.instanceId === a.atSite)?.definitionId as CardDefinitionId
      ];
      return siteDef && 'name' in siteDef && siteDef.name === 'Bag End';
    });
    expect(merryActions.length).toBeGreaterThanOrEqual(1);
  });

  test('cannot be played at a haven (home-site-only restriction)', () => {
    // Merry is in hand, but only havens are available (no Bag End in site deck)
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [LEGOLAS] }],
          hand: [MERRY],
          siteDeck: [RIVENDELL, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.length).toBe(0);
  });

  test('cannot join a company at a haven', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [HALDIR] }],
          hand: [MERRY],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.length).toBe(0);
  });

  test('can join a company already at Bag End', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [HALDIR] }],
          hand: [MERRY],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = viablePlayCharacterActions(state, PLAYER_1);
    expect(actions.length).toBeGreaterThanOrEqual(1);
  });

  // ── "Unless he is one of the starting characters" ───────────────────────

  test('remains a viable starting-character draft pick', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN, BILBO, MERRY],
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
    const merryInstanceId = draftInstId(state, 0, MERRY);

    const actions = computeLegalActions(state, PLAYER_1);
    const merryPick = actions.find(
      ea => ea.action.type === 'draft-pick'
        && ea.action.characterInstanceId === merryInstanceId,
    );
    expect(merryPick).toBeDefined();
    expect(merryPick!.viable).toBe(true);
  });
});
