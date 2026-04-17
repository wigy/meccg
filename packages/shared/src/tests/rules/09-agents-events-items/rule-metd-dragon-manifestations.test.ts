/**
 * @module rule-metd-dragon-manifestations
 *
 * METD (The Dragons) §4 — Manifestations of Dragons.
 *
 * This test covers the manifestation-tagging + lair-suppression mechanics
 * (expansion plan step 5). The full defeat cascade (sweeping all sister
 * manifestations, blocking replays) lands in step 8.
 */

import { describe, expect, test } from 'vitest';
import { ARAGORN, BILBO, LEGOLAS, RIVENDELL, LORIEN, MINAS_TIRITH } from '../../../index.js';
import type { CardDefinitionId, CardInstance, ManifestId } from '../../../index.js';
import { Phase } from '../../../index.js';
import {
  isManifestationDefeated,
  getActiveAutoAttacks,
  manifestIdOf,
} from '../../../engine/manifestations.js';
import {
  PLAYER_1,
  PLAYER_2,
  buildTestState,
  mint,
} from '../../test-helpers.js';

const SMAUG = 'tw-90' as CardDefinitionId;
const SMAUG_AHUNT = 'td-70' as CardDefinitionId;
const SMAUG_AT_HOME = 'td-71' as CardDefinitionId;
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId;

const EARCARAXE = 'td-20' as CardDefinitionId;

function blankState() {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      {
        id: PLAYER_1,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        companies: [{ site: LORIEN, characters: [LEGOLAS] }],
        hand: [],
        siteDeck: [RIVENDELL],
      },
    ],
  });
}

describe('METD §4 — Manifestation tagging', () => {
  test('all three Smaug cards share the basic creature\'s manifestId', () => {
    const state = blankState();
    expect(manifestIdOf(state.cardPool[SMAUG])).toBe(SMAUG);
    expect(manifestIdOf(state.cardPool[SMAUG_AHUNT])).toBe(SMAUG);
    expect(manifestIdOf(state.cardPool[SMAUG_AT_HOME])).toBe(SMAUG);
  });

  test('non-manifestation cards have no manifestId', () => {
    const state = blankState();
    expect(manifestIdOf(state.cardPool[ARAGORN])).toBeUndefined();
    expect(manifestIdOf(state.cardPool[RIVENDELL])).toBeUndefined();
  });

  test('lair sites carry lairOf pointing to the resident Dragon', () => {
    const state = blankState();
    const lonely = state.cardPool[LONELY_MOUNTAIN];
    expect((lonely as { lairOf?: ManifestId }).lairOf).toBe(SMAUG);
  });
});

describe('METD §4 — isManifestationDefeated', () => {
  test('returns false initially (nothing in either eliminated pile)', () => {
    const state = blankState();
    expect(isManifestationDefeated(state, SMAUG as ManifestId)).toBe(false);
    expect(isManifestationDefeated(state, EARCARAXE as ManifestId)).toBe(false);
  });

  test('returns true once any chain card lands in either eliminated pile', () => {
    const base = blankState();
    // Drop Smaug-Ahunt into P2's eliminated pile (manifestId = tw-90 Smaug).
    const ahuntInst: CardInstance = { instanceId: mint(), definitionId: SMAUG_AHUNT };
    const state = {
      ...base,
      players: [
        base.players[0],
        { ...base.players[1], outOfPlayPile: [ahuntInst] },
      ] as typeof base.players,
    };
    expect(isManifestationDefeated(state, SMAUG as ManifestId)).toBe(true);
    // Other chains unaffected.
    expect(isManifestationDefeated(state, EARCARAXE as ManifestId)).toBe(false);
  });
});

describe('METD §4 — Lair auto-attack suppression', () => {
  test('lair keeps its Dragon auto-attack while the Dragon is undefeated', () => {
    const state = blankState();
    const lonely = state.cardPool[LONELY_MOUNTAIN] as import('../../../index.js').SiteCard;
    const attacks = getActiveAutoAttacks(state, lonely);
    expect(attacks).toHaveLength(1);
    expect(attacks[0].creatureType).toBe('Dragon');
  });

  test('lair loses its Dragon auto-attack once the Dragon is defeated', () => {
    const base = blankState();
    const basicInst: CardInstance = { instanceId: mint(), definitionId: SMAUG };
    const state = {
      ...base,
      players: [
        { ...base.players[0], outOfPlayPile: [basicInst] },
        base.players[1],
      ] as typeof base.players,
    };
    const lonely = state.cardPool[LONELY_MOUNTAIN] as import('../../../index.js').SiteCard;
    const attacks = getActiveAutoAttacks(state, lonely);
    expect(attacks).toHaveLength(0);
  });

  test('non-lair sites are unaffected by manifestation state', () => {
    const base = blankState();
    const basicInst: CardInstance = { instanceId: mint(), definitionId: SMAUG };
    const state = {
      ...base,
      players: [
        { ...base.players[0], outOfPlayPile: [basicInst] },
        base.players[1],
      ] as typeof base.players,
    };
    const rivendell = state.cardPool[RIVENDELL] as import('../../../index.js').SiteCard;
    expect(getActiveAutoAttacks(state, rivendell)).toBe(rivendell.automaticAttacks);
  });
});
