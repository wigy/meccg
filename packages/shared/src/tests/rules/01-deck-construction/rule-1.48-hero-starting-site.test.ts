/**
 * @module rule-1.48-hero-starting-site
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.48: Hero Starting Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] A Wizard player's starting company can only begin play at Rivendell.
 */

import { describe, test, expect } from 'vitest';
import {
  runSimpleDraft, runActions,
  PLAYER_1, PLAYER_2, RIVENDELL,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';

describe('Rule 1.48 — Hero Starting Site', () => {
  test('[HERO] Wizard player starting company can only begin at Rivendell', () => {
    // Start from the character-draft result and advance to starting-site-selection.
    let state = runSimpleDraft();

    // Skip item-draft: both players pass (no items assigned)
    state = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    // Skip character-deck-draft: both players pass
    state = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    // Verify we're at starting-site-selection
    expect(state.phaseState.phase).toBe('setup');
    const step = (state.phaseState as { phase: 'setup'; setupStep: { step: string } }).setupStep;
    expect(step.step).toBe('starting-site-selection');

    // PLAYER_1's site deck has [RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM].
    // The wizard alignment rule restricts starting sites to Rivendell only.
    const actions = computeLegalActions(state, PLAYER_1);
    const siteSel = actions.filter(ea => ea.action.type === 'select-starting-site');

    // Find the Rivendell instance and check it's viable
    const rivendellInst = state.players[0].siteDeck.find(
      c => c.definitionId === (RIVENDELL),
    )!.instanceId;
    const rivendellAction = siteSel.find(
      ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === rivendellInst,
    );
    expect(rivendellAction?.viable).toBe(true);

    // All other sites should be non-viable (not an allowed starting site)
    const nonRivendell = siteSel.filter(
      ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId !== rivendellInst,
    );
    expect(nonRivendell.length).toBeGreaterThan(0);
    expect(nonRivendell.every(ea => !ea.viable)).toBe(true);
  });
});
