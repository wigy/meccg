/**
 * @module rule-1.50-fw-starting-site
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.50: Fallen-Wizard Starting Site
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [FALLEN-WIZARD] A Fallen-wizard player's starting company can only begin play at the White Towers OR at a Ruins & Lairs in Arthedain or Rhudaur. If that player's starting company begins at a Ruins & Lairs, one of their drafted Stage resources may be Hidden Haven played on that site.
 */

import { describe, test, expect } from 'vitest';
import {
  runActions, makePlayDeck, pool, draftInstId,
  PLAYER_1, PLAYER_2, ARAGORN, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { GameConfig, CardDefinitionId } from '../../../index.js';

const THE_WHITE_TOWERS_FW = 'wh-58' as CardDefinitionId;
const THE_WHITE_TOWERS_HERO = 'tw-430' as CardDefinitionId;
const ETTENMOORS_MINION = 'le-373' as CardDefinitionId;
const WEATHERTOP_HERO = 'tw-436' as CardDefinitionId;
const WEATHERTOP_MINION = 'as-169' as CardDefinitionId;
// A low-mind (5), non-agent character a Fallen-wizard may freely draft without
// an enabling Stage resource (rules 1.42/1.44).
const BALIN = 'tw-123' as CardDefinitionId;

describe('Rule 1.50 — Fallen-Wizard Starting Site', () => {
  test('[FALLEN-WIZARD] Starting company can only begin at White Towers or designated Ruins & Lairs in Arthedain/Rhudaur', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.FallenWizard,
          // A Fallen-wizard may only draft a mind ≤ 5, non-agent character
          // without an enabling Stage resource (rules 1.42/1.44).
          draftPool: [BALIN],
          playDeck: makePlayDeck(),
          siteDeck: [THE_WHITE_TOWERS_FW, THE_WHITE_TOWERS_HERO, ETTENMOORS_MINION, WEATHERTOP_HERO, WEATHERTOP_MINION, RIVENDELL],
          sideboard: [],
        },
        {
          id: PLAYER_2,
          name: 'Bob',
          alignment: Alignment.Wizard,
          draftPool: [ARAGORN],
          playDeck: makePlayDeck(),
          siteDeck: [RIVENDELL],
          sideboard: [],
        },
      ],
      seed: 42,
    };

    let state = createGame(config, pool);

    // Character draft: each player picks their one character.
    const p1BalinInst = draftInstId(state, 0, BALIN);
    const p2AragornInst = draftInstId(state, 1, ARAGORN);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: p1BalinInst },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: p2AragornInst },
    ]);

    // Advance past intermediate setup steps to starting-site-selection.
    for (let i = 0; i < 4; i++) {
      if (state.phaseState.phase !== 'setup') break;
      const setupStep = (state.phaseState as { phase: 'setup'; setupStep: { step: string } }).setupStep;
      if (setupStep.step === 'starting-site-selection') break;
      state = runActions(state, [
        { type: 'pass', player: PLAYER_1 },
        { type: 'pass', player: PLAYER_2 },
      ]);
    }

    expect(state.phaseState.phase).toBe('setup');
    const step = (state.phaseState as { phase: 'setup'; setupStep: { step: string } }).setupStep;
    expect(step.step).toBe('starting-site-selection');

    const actions = computeLegalActions(state, PLAYER_1);
    const siteSel = actions.filter(ea => ea.action.type === 'select-starting-site');

    const findInst = (defId: CardDefinitionId) =>
      state.players[0].siteDeck.find(c => c.definitionId === defId)!.instanceId;

    const whiteTowersFwInst = findInst(THE_WHITE_TOWERS_FW);
    const whiteTowersHeroInst = findInst(THE_WHITE_TOWERS_HERO);
    const ettenmoorsinst = findInst(ETTENMOORS_MINION);
    const weathertopHeroInst = findInst(WEATHERTOP_HERO);
    const weathertopMinionInst = findInst(WEATHERTOP_MINION);
    const rivendellInst = findInst(RIVENDELL);

    // Valid FW starting sites: White Towers (FW version) and Ettenmoors
    expect(siteSel.find(ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === whiteTowersFwInst)?.viable).toBe(true);
    expect(siteSel.find(ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === whiteTowersHeroInst)?.viable).toBe(true);
    expect(siteSel.find(ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === ettenmoorsinst)?.viable).toBe(true);

    // Weathertop is a Ruins & Lairs in Arthedain, so both printings are valid
    // (rule 2.II.7.F1 — a Fallen-wizard may use either version of a Ruins & Lairs).
    expect(siteSel.find(ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === weathertopHeroInst)?.viable).toBe(true);
    expect(siteSel.find(ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === weathertopMinionInst)?.viable).toBe(true);

    // Rivendell is NOT a valid FW starting site
    expect(siteSel.find(ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === rivendellInst)?.viable).toBe(false);
  });
});
