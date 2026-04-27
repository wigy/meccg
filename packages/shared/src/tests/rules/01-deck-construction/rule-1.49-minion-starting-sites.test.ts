/**
 * @module rule-1.49-minion-starting-sites
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.49: Minion Starting Sites
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] A Ringwraith player may have up to two starting companies, which can only begin play at Minas Morgul and/or Dol Guldur. If declaring more than one starting site, the player must also declare how their starting company will be split between the sites.
 */

import { describe, test, expect } from 'vitest';
import {
  runActions, makePlayDeck, pool, draftInstId,
  PLAYER_1, PLAYER_2, ARAGORN, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { GameConfig, CardDefinitionId } from '../../../index.js';

const THE_MOUTH = 'le-24' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;
const ETTENMOORS = 'le-373' as CardDefinitionId;

describe('Rule 1.49 — Minion Starting Sites', () => {
  test('[MINION] Ringwraith may have up to two starting companies at Minas Morgul and/or Dol Guldur', () => {
    const config: GameConfig = {
      players: [
        {
          id: PLAYER_1,
          name: 'Alice',
          alignment: Alignment.Ringwraith,
          draftPool: [THE_MOUTH],
          playDeck: makePlayDeck(),
          siteDeck: [MINAS_MORGUL, DOL_GULDUR, ETTENMOORS],
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
    // With single-character pools, the draft ends automatically after both picks
    // (no draft-stop needed — the game advances when pools are exhausted).
    const mouthInstId = draftInstId(state, 0, THE_MOUTH);
    const aragornInstId = draftInstId(state, 1, ARAGORN);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: mouthInstId },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: aragornInstId },
    ]);

    // With single-character pools and no items, the draft auto-ends and the game
    // may skip item-draft and character-deck-draft, landing at starting-site-selection
    // immediately. If not yet there, advance with passes.
    for (let i = 0; i < 4; i++) {
      if (state.phaseState.phase !== 'setup') break;
      const setupStep = (state.phaseState as { phase: 'setup'; setupStep: { step: string } }).setupStep;
      if (setupStep.step === 'starting-site-selection') break;
      state = runActions(state, [
        { type: 'pass', player: PLAYER_1 },
        { type: 'pass', player: PLAYER_2 },
      ]);
    }

    // Verify we're at starting-site-selection
    expect(state.phaseState.phase).toBe('setup');
    const step = (state.phaseState as { phase: 'setup'; setupStep: { step: string } }).setupStep;
    expect(step.step).toBe('starting-site-selection');

    // PLAYER_1 site deck has [MINAS_MORGUL, DOL_GULDUR, ETTENMOORS].
    // Ringwraith alignment allows only Minas Morgul and Dol Guldur as starting sites.
    const actions = computeLegalActions(state, PLAYER_1);
    const siteSel = actions.filter(ea => ea.action.type === 'select-starting-site');

    const minasMorgulInst = state.players[0].siteDeck.find(
      c => c.definitionId === MINAS_MORGUL,
    )!.instanceId;
    const dolGuldurInst = state.players[0].siteDeck.find(
      c => c.definitionId === DOL_GULDUR,
    )!.instanceId;
    const ettenmoorsInst = state.players[0].siteDeck.find(
      c => c.definitionId === ETTENMOORS,
    )!.instanceId;

    const minasMorgulAction = siteSel.find(
      ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === minasMorgulInst,
    );
    const dolGuldurAction = siteSel.find(
      ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === dolGuldurInst,
    );
    const ettenmoorsAction = siteSel.find(
      ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === ettenmoorsInst,
    );

    // Both darkhavens are viable starting sites for ringwraith
    expect(minasMorgulAction?.viable).toBe(true);
    expect(dolGuldurAction?.viable).toBe(true);
    // Other sites are not viable
    expect(ettenmoorsAction?.viable).toBe(false);

    // Select Minas Morgul — Ringwraith maxStartingSites is 2, so Dol Guldur is still selectable
    state = runActions(state, [
      { type: 'select-starting-site', player: PLAYER_1, siteInstanceId: minasMorgulInst },
    ]);

    const actionsAfterOne = computeLegalActions(state, PLAYER_1);
    const siteSelAfter = actionsAfterOne.filter(ea => ea.action.type === 'select-starting-site');
    const dolGuldurAfterAction = siteSelAfter.find(
      ea => (ea.action as { siteInstanceId?: unknown }).siteInstanceId === dolGuldurInst,
    );
    expect(dolGuldurAfterAction?.viable).toBe(true);

    // Select Dol Guldur too — now at the maximum of 2 starting sites
    state = runActions(state, [
      { type: 'select-starting-site', player: PLAYER_1, siteInstanceId: dolGuldurInst },
    ]);

    // No more site selections available once at max
    const actionsAfterTwo = computeLegalActions(state, PLAYER_1);
    const siteSelAfterTwo = actionsAfterTwo.filter(ea => ea.action.type === 'select-starting-site');
    expect(siteSelAfterTwo).toHaveLength(0);
  });
});
