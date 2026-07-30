/**
 * @module gi-summary-bonus.test
 *
 * Regression test for bug report 344a0fc393ba2897 (game ms6gbt8d-5na91m, seq
 * 437): "+5 GI is not reflected on GI summary." *Bade to Rule* (le-167) was
 * attached to Indûr the Ringwraith, giving the player a +5
 * `generalInfluenceBonus` (engine-verified: `generalInfluenceUsed` 14,
 * `generalInfluenceBonus` 5). The projection already exposes the correctly
 * computed effective pool via `PlayerView.generalInfluence` (see
 * `effectiveGeneralInfluence` in reducer-utils.ts), but `renderPlayerNames`
 * ignored it and recomputed the remaining GI from the raw `GENERAL_INFLUENCE`
 * constant, so the displayed number never grew with the bonus.
 *
 * The fix reads `view.self`/`view.opponent`.`generalInfluence` (the effective
 * pool) instead of the raw constant, so any in-play bonus is reflected.
 *
 * Uses a hand-rolled DOM stub (the package runs vitest in the default node
 * environment, with no jsdom) that captures each metric cell's `innerHTML`.
 */

import './test-dom-bootstrap.js'; // must precede the render-player-names import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Phase } from '@meccg/shared';
import type { PlayerView, MarshallingPointTotals } from '@meccg/shared';
import { renderPlayerNames } from './render-player-names.js';

// --- Minimal DOM stub -------------------------------------------------------

class StubEl {
  innerHTML = '';
  title = '';
  textContent = '';
  style: Record<string, string> = {};
  classList = { add(): void { /* no-op */ }, remove(): void { /* no-op */ }, toggle(): void { /* no-op */ }, contains: () => false };
  getBoundingClientRect() { return { top: 0, right: 0, left: 0, bottom: 0 }; }
}

let elements: Record<string, StubEl>;

beforeEach(() => {
  elements = {};
  for (const id of [
    'self-name', 'opponent-name', 'self-mp', 'self-gi', 'self-sp',
    'opponent-mp', 'opponent-gi', 'opponent-sp', 'self-deck-box',
    'opponent-deck-box', 'opponent-hazard-limit', 'opponent-score',
  ]) elements[id] = new StubEl();
  (globalThis as unknown as { document: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const ZERO_MP: MarshallingPointTotals = { character: 0, item: 0, faction: 0, ally: 0, kill: 0, misc: 0 };

/** A PlayerView mirroring game ms6gbt8d-5na91m at seq 437: only fields renderPlayerNames reads are set. */
function viewWithBonus(): PlayerView {
  return {
    self: {
      id: 'p1', name: 'Alice', alignment: 'ringwraith',
      generalInfluenceUsed: 14, generalInfluence: 25,
      marshallingPoints: ZERO_MP, callableMarshallingPoints: ZERO_MP,
      characters: {}, cardsInPlay: [], stagePoints: 0, lastDiceRoll: null,
    },
    opponent: {
      id: 'p2', name: 'Bob', alignment: 'wizard',
      generalInfluenceUsed: 7, generalInfluence: 20,
      marshallingPoints: ZERO_MP, callableMarshallingPoints: ZERO_MP,
      characters: {}, cardsInPlay: [], stagePoints: 0, lastDiceRoll: null,
    },
    activePlayer: 'p1',
    phaseState: { phase: Phase.Organization },
  } as unknown as PlayerView;
}

describe('GI summary reflects an in-play general-influence bonus (Bade to Rule)', () => {
  test('remaining GI is the effective pool (20 + 5 bonus) minus used, not the raw 20', () => {
    renderPlayerNames(viewWithBonus(), {});
    // Effective pool 25 - used 14 = 11. Without the fix this read 20 - 14 = 6.
    expect(elements['self-gi'].innerHTML).toContain('>11<');
    expect(elements['self-gi'].innerHTML).not.toContain('>6<');
  });

  test('a player with no bonus still uses the base pool of 20', () => {
    renderPlayerNames(viewWithBonus(), {});
    // Effective pool 20 - used 7 = 13.
    expect(elements['opponent-gi'].innerHTML).toContain('>13<');
  });
});
