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
  runSimpleDraft, runActions, makeDraftConfig,
  PLAYER_1, PLAYER_2, RIVENDELL,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';

describe('Rule 1.48 — Hero Starting Site', () => {
  test('[HERO] Wizard player starting company can only begin at Rivendell', () => {
    // Two Rivendell copies keep this a genuine choice — with only one legal
    // site, the engine auto-resolves the pick instead of listing options
    // (see the Rule 1.47 auto-resolve test).
    const base = makeDraftConfig();
    const config = {
      ...base,
      players: [{ ...base.players[0], siteDeck: [RIVENDELL, ...base.players[0].siteDeck] }, base.players[1]] as typeof base.players,
    };

    // Start from the character-draft result and advance to starting-site-selection.
    let state = runSimpleDraft(config);

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

    // PLAYER_1's site deck has [RIVENDELL, RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM].
    // The wizard alignment rule restricts starting sites to Rivendell only.
    const actions = computeLegalActions(state, PLAYER_1);
    const siteSel = actions.filter(ea => ea.action.type === 'select-starting-site');

    const rivendellInstIds = new Set(
      state.players[0].siteDeck.filter(c => c.definitionId === RIVENDELL).map(c => c.instanceId as string),
    );
    const rivendellActions = siteSel.filter(
      ea => rivendellInstIds.has((ea.action as { siteInstanceId?: string }).siteInstanceId ?? ''),
    );
    expect(rivendellActions.length).toBe(2);
    expect(rivendellActions.every(ea => ea.viable)).toBe(true);

    // All other sites should be non-viable (not an allowed starting site)
    const nonRivendell = siteSel.filter(
      ea => !rivendellInstIds.has((ea.action as { siteInstanceId?: string }).siteInstanceId ?? ''),
    );
    expect(nonRivendell.length).toBeGreaterThan(0);
    expect(nonRivendell.every(ea => !ea.viable)).toBe(true);
  });
});
