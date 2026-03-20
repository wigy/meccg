import { describe, it, expect } from 'vitest';
import { createGameQuickStart } from '../engine/init.js';
import { reduce } from '../engine/reducer.js';
import {
  pool, makeQuickStartConfig, makeDraftConfig, runSimpleDraft,
  PLAYER_1, ARAGORN, DAGGER_OF_WESTERNESSE,
} from './test-helpers.js';

describe('effective stats', () => {
  it('base stats match character definition when no items equipped', () => {
    const state = createGameQuickStart(makeQuickStartConfig(), pool);
    const p1 = state.players[0];
    const charId = p1.companies[0].characters[0];
    const char = p1.characters[charId as string];
    const def = pool[char.definitionId as string];

    if (def.cardType !== 'hero-character') throw new Error('not a character');

    expect(char.effectiveStats.prowess).toBe(def.prowess);
    expect(char.effectiveStats.body).toBe(def.body);
    expect(char.effectiveStats.directInfluence).toBe(def.directInfluence);
    expect(char.effectiveStats.corruptionPoints).toBe(0);
  });

  it('item modifiers are applied to prowess and body', () => {
    // Draft with items — Aragorn gets 2 Daggers of Westernesse (+1 prowess each)
    let state = runSimpleDraft(makeDraftConfig());

    const p1Char = state.players[0].companies[0].characters[0];

    // Assign both daggers to Aragorn
    let result = reduce(state, { type: 'assign-starting-item', player: PLAYER_1, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: p1Char });
    state = result.state;
    result = reduce(state, { type: 'assign-starting-item', player: PLAYER_1, itemDefId: DAGGER_OF_WESTERNESSE, characterInstanceId: p1Char });
    state = result.state;

    const char = state.players[0].characters[p1Char as string];
    const aragornDef = pool[ARAGORN as string];
    if (aragornDef.cardType !== 'hero-character') throw new Error('not a character');

    // Dagger of Westernesse: +1 prowess, 0 body, 1 CP each
    expect(char.effectiveStats.prowess).toBe(aragornDef.prowess + 2);
    expect(char.effectiveStats.body).toBe(aragornDef.body);
    expect(char.effectiveStats.corruptionPoints).toBe(2);
  });

  it('character without items has zero corruption points', () => {
    const state = runSimpleDraft(makeDraftConfig());

    // Player 2's Legolas has no items assigned yet
    const p2Char = state.players[1].companies[0].characters[0];
    const char = state.players[1].characters[p2Char as string];

    expect(char.effectiveStats.corruptionPoints).toBe(0);
  });
});
