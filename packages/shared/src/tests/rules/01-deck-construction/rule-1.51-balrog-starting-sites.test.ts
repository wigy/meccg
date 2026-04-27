/**
 * @module rule-1.51-balrog-starting-sites
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.51: Balrog Starting Sites
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [BALROG] A Balrog player may have up to two starting companies, which can only begin play at Moria and/or the Under-gates. If declaring more than one starting site, the player must also declare how their starting company will be split between the sites.
 */

import { describe, test, expect } from 'vitest';
import {
  runActions, makePlayDeck, pool, draftInstId,
  PLAYER_1, PLAYER_2, ARAGORN, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { GameConfig, CardDefinitionId } from '../../../index.js';

const AZOG = 'ba-2' as CardDefinitionId;
const MORIA_BALROG = 'ba-93' as CardDefinitionId;
const THE_UNDER_GATES = 'ba-100' as CardDefinitionId;

describe('Rule 1.51 — Balrog Starting Sites', () => {
  test('[BALROG] Balrog may have up to two starting companies at Moria and/or Under-gates', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Balrog,
          draftPool: [AZOG],
          playDeck: makePlayDeck(),
          siteDeck: [MORIA_BALROG, THE_UNDER_GATES],
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
    // With single-character pools, the draft ends automatically after both picks.
    const azogInstId = draftInstId(state, 0, AZOG);
    const aragornInstId = draftInstId(state, 1, ARAGORN);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: azogInstId },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: aragornInstId },
    ]);

    // Advance past any intermediate setup steps to starting-site-selection.
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

    // PLAYER_1 site deck has [MORIA_BALROG, THE_UNDER_GATES] — both are valid balrog starting sites.
    const actions = computeLegalActions(state, PLAYER_1);
    const siteSel = actions.filter(ea => ea.action.type === 'select-starting-site');

    const moriaInst = state.players[0].siteDeck.find(
      c => c.definitionId === MORIA_BALROG,
    )!.instanceId;
    const underGatesInst = state.players[0].siteDeck.find(
      c => c.definitionId === THE_UNDER_GATES,
    )!.instanceId;

    const moriaAction = siteSel.find(
      ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === moriaInst,
    );
    const underGatesAction = siteSel.find(
      ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === underGatesInst,
    );

    // Both balrog darkhavens are viable starting sites
    expect(moriaAction?.viable).toBe(true);
    expect(underGatesAction?.viable).toBe(true);

    // Select Moria — Balrog maxStartingSites is 2, so The Under-gates is still selectable
    state = runActions(state, [
      { type: 'select-starting-site', player: PLAYER_1, siteInstanceId: moriaInst },
    ]);

    const actionsAfterOne = computeLegalActions(state, PLAYER_1);
    const siteSelAfter = actionsAfterOne.filter(ea => ea.action.type === 'select-starting-site');
    const underGatesAfterAction = siteSelAfter.find(
      ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === underGatesInst,
    );
    expect(underGatesAfterAction?.viable).toBe(true);

    // Select The Under-gates too — now at the maximum of 2 starting sites
    state = runActions(state, [
      { type: 'select-starting-site', player: PLAYER_1, siteInstanceId: underGatesInst },
    ]);

    // No more site selections available once at max
    const actionsAfterTwo = computeLegalActions(state, PLAYER_1);
    const siteSelAfterTwo = actionsAfterTwo.filter(ea => ea.action.type === 'select-starting-site');
    expect(siteSelAfterTwo).toHaveLength(0);
  });
});
