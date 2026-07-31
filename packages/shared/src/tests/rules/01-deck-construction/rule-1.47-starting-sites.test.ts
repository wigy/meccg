/**
 * @module rule-1.47-starting-sites
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.47: Starting Sites
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * Starting Sites - Immediately after the character draft ends, each player must declare their starting site(s) by placing the appropriate card(s) from their location deck with their starting company.
 */

import { describe, test, expect } from 'vitest';
import {
  runSimpleDraft, runActions, makeDraftConfig, RIVENDELL, PLAYER_1, PLAYER_2,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';

describe('Rule 1.47 — Starting Sites', () => {
  test('Each player must declare starting site(s) by placing cards from location deck with starting company', () => {
    // Two Rivendell copies keep this a genuine choice — with only one legal
    // site, the engine now auto-resolves the pick (see Rule 1.47 auto-resolve test).
    const base = makeDraftConfig();
    const config = {
      ...base,
      players: [{ ...base.players[0], siteDeck: [RIVENDELL, ...base.players[0].siteDeck] }, base.players[1]] as typeof base.players,
    };

    // After the character draft, navigate to starting-site-selection.
    let state = runSimpleDraft(config);

    // Skip item-draft: both players pass
    state = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    // Skip character-deck-draft: both players pass
    state = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    // Should be at starting-site-selection
    expect(state.phaseState.phase).toBe('setup');
    const step = (state.phaseState as { phase: 'setup'; setupStep: { step: string } }).setupStep;
    expect(step.step).toBe('starting-site-selection');

    // PLAYER_1's site deck contains RIVENDELL (a valid wizard starting site) plus others.
    // Legal actions for PLAYER_1 must include at least one viable select-starting-site action.
    const p1Actions = computeLegalActions(state, PLAYER_1);
    const p1SiteSel = p1Actions.filter(ea => ea.action.type === 'select-starting-site' && ea.viable);
    expect(p1SiteSel.length).toBeGreaterThan(0);

    // The viable sites must come from PLAYER_1's site deck (not arbitrary sites).
    const p1SiteDeckInstIds = new Set(state.players[0].siteDeck.map(c => c.instanceId as string));
    for (const ea of p1SiteSel) {
      const siteInstId = (ea.action as { siteInstanceId: string }).siteInstanceId;
      expect(p1SiteDeckInstIds.has(siteInstId)).toBe(true);
    }

    // select-starting-site actions are offered for all sites in the deck (viable or not)
    const p1AllSiteSel = p1Actions.filter(ea => ea.action.type === 'select-starting-site');
    expect(p1AllSiteSel.length).toBe(state.players[0].siteDeck.length);
  });

  test('a lone legal starting site is auto-selected instead of forcing a no-choice pick', () => {
    // Bug report: a wizard whose site deck holds a single Rivendell (the only
    // legal wizard starting site) had to manually pick it even though no other
    // choice was ever possible. The engine now applies it automatically.
    let state = runSimpleDraft();

    state = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);
    state = runActions(state, [
      { type: 'pass', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    // PLAYER_1's default site deck [RIVENDELL, MORIA, MINAS_TIRITH, MOUNT_DOOM]
    // has exactly one legal wizard starting site — Rivendell is auto-selected
    // and the player is marked done without any action from them.
    expect(state.phaseState.phase).toBe('setup');
    const step = (state.phaseState as { phase: 'setup'; setupStep: { step: string; siteSelectionState: readonly { done: boolean; selectedSites: readonly { definitionId: string }[] }[] } }).setupStep;
    expect(step.step).toBe('starting-site-selection');
    expect(step.siteSelectionState[0].done).toBe(true);
    expect(step.siteSelectionState[0].selectedSites.map(s => s.definitionId)).toEqual([RIVENDELL]);

    // Rivendell was removed from the site deck and no legal actions remain for
    // that player — the step is not offering them anything more to decide.
    expect(state.players[0].siteDeck.some(c => c.definitionId === RIVENDELL)).toBe(false);
    expect(computeLegalActions(state, PLAYER_1)).toHaveLength(0);
  });
});
