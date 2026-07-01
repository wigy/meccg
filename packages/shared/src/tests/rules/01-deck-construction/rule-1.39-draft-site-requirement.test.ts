/**
 * @module rule-1.39-draft-site-requirement
 *
 * CoE Rules — Section 1: Deck Construction & Setup
 * Rule 1.39: Draft Site Requirement
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * If a player drafts a card that requires a site in play, the player must also choose a starting site at that time (according to the rules for choosing a starting site).
 */

import { describe, test, expect } from 'vitest';
import {
  makePlayDeck, pool, draftInstId, siteDeckInstId, runActions,
  PLAYER_1, PLAYER_2, RIVENDELL, Alignment,
  createGame,
} from '../../test-helpers.js';
import { computeLegalActions } from '../../../index.js';
import type { GameConfig, CardDefinitionId } from '../../../index.js';

// wh-75 = Hidden Haven, a Stage resource that names a starting site (a Ruins &
// Lairs). as-142 = Worthy Hills, an eligible Ruins & Lairs from the FW's own
// site deck. tw-123 = Balin, a low-mind hero character the FW may freely draft.
const HIDDEN_HAVEN = 'wh-75' as CardDefinitionId;
const WORTHY_HILLS = 'as-142' as CardDefinitionId;
const BALIN = 'tw-123' as CardDefinitionId;
const ARAGORN = 'tw-120' as CardDefinitionId;

function makeConfig(): GameConfig {
  return {
    players: [
      {
        id: PLAYER_1,
        name: 'Alice',
        alignment: Alignment.FallenWizard,
        draftPool: [HIDDEN_HAVEN, BALIN],
        playDeck: makePlayDeck(),
        siteDeck: [WORTHY_HILLS],
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
}

describe('Rule 1.39 — Draft Site Requirement', () => {
  test('drafting a card that requires a site blocks stopping until a site is chosen', () => {
    let state = createGame(makeConfig(), pool);
    const hhInst = draftInstId(state, 0, HIDDEN_HAVEN);
    state = runActions(state, [
      { type: 'draft-pick', player: PLAYER_1, characterInstanceId: hhInst },
      { type: 'draft-pick', player: PLAYER_2, characterInstanceId: draftInstId(state, 1, ARAGORN) },
    ]);

    // The drafted card names a site, so the player cannot stop drafting until
    // they choose one — the only viable action is the site pairing itself.
    const beforePairing = computeLegalActions(state, PLAYER_1).filter(a => a.viable);
    expect(beforePairing.find(a => a.action.type === 'draft-stop')?.viable ?? false).toBe(false);
    expect(beforePairing.some(a => a.action.type === 'select-stage-resource-site')).toBe(true);

    // Choosing the site satisfies the requirement — the player may now continue
    // drafting or stop normally.
    state = runActions(state, [{
      type: 'select-stage-resource-site', player: PLAYER_1,
      stageResourceInstanceId: hhInst, siteInstanceId: siteDeckInstId(state, 0, WORTHY_HILLS),
    }]);
    const afterPairing = computeLegalActions(state, PLAYER_1).filter(a => a.viable);
    expect(afterPairing.some(a => a.action.type === 'draft-pick')).toBe(true);
  });
});
