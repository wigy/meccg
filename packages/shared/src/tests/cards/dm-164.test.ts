/**
 * @module dm-164.test
 *
 * Card test: The Windlord Found Me (dm-164)
 * Type: hero-resource-event (permanent), 3 misc MPs
 * Effects:
 *   play-target (site: dark-hold, shadow-hold, or Isengard by name),
 *   play-target (character attachment),
 *   storable-at (haven, 3 MP),
 *   duplication-limit (player, max 1),
 *   trigger-attack-on-play (Orc, 4 strikes, 9 prowess),
 *   fetch-wizard-on-store
 *
 * Card text: "Playable at an untapped Isengard, Shadow-hold, or Dark-hold during
 * the site phase. Tap the site. The company faces an Orc attack (4 strikes with
 * 9 prowess). Afterwards, a character may tap and place this card under him. If
 * you do not place this card with a character after the attack, discard it. That
 * character may not untap until after this card is stored in a Haven during the
 * organization phase. When this card is stored, and if your Wizard is not already
 * in play, you may search your play deck or discard pile for a Wizard and play him
 * at that Haven. Cannot be duplicated by a given player."
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  RESOURCE_PLAYER,
  HAZARD_PLAYER,
  CardStatus,
  ARAGORN, LEGOLAS, GIMLI, THEODEN, FARAMIR,
  MORIA, RIVENDELL, LORIEN, ISENGARD, BANDIT_LAIR,
  GANDALF, SARUMAN,
  buildSitePhaseState, resetMint,
  viableActions,
  attachItemToChar,
  playPermanentEventAndResolve,
  buildTestState, makePlayDeck,
  mint, addToPile,
  findCharInstanceId, runCardTriggeredAttackCombat,
  dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayPermanentEventAction, PlayWizardFromSearchAction, SelectCardBearerAction } from '../../index.js';
import { Phase } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const WINDLORD = 'dm-164' as CardDefinitionId;
const CARN_DUM_TW = 'tw-380' as CardDefinitionId;

describe('dm-164 The Windlord Found Me', () => {
  beforeEach(() => resetMint());

  // ── Site filter: dark-hold ──

  test('IS playable at untapped dark-hold (Carn Dum tw-380)', () => {
    const state = buildSitePhaseState({
      site: CARN_DUM_TW,
      hand: [WINDLORD],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Site filter: shadow-hold ──

  test('IS playable at untapped shadow-hold (Moria)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [WINDLORD],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Site filter: Isengard by name (ruins-and-lairs) ──

  test('IS playable at untapped Isengard (ruins-and-lairs, matched by name)', () => {
    const state = buildSitePhaseState({
      site: ISENGARD,
      hand: [WINDLORD],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });

  // ── Site filter: does NOT require tapped site ──

  test('NOT playable at a tapped site (Windlord requires untapped)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      siteStatus: CardStatus.Tapped,
      hand: [WINDLORD],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Site filter: wrong site type ──

  test('NOT playable at a ruins-and-lairs that is not Isengard (Bandit Lair)', () => {
    const state = buildSitePhaseState({
      site: BANDIT_LAIR,
      hand: [WINDLORD],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── No pre-selected bearer (post-attack selection) ──

  test('play action has no targetCharacterId (bearer selected post-attack)', () => {
    // Bearer is chosen after the triggered attack resolves, not at play time.
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [WINDLORD],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const act = actions[0].action as PlayPermanentEventAction;
    expect(act.targetCharacterId).toBeUndefined();
  });

  // ── Orc attack fires on play ──

  test('company faces Orc attack (4 strikes, prowess 9) when Windlord is played', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [WINDLORD],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);

    expect(afterPlay.combat).not.toBeNull();
    expect(afterPlay.combat!.strikesTotal).toBe(4);
    expect(afterPlay.combat!.strikeProwess).toBe(9);
    expect(afterPlay.combat!.creatureRace).toBe('orc');
  });

  // ── Discard if all tapped after attack ──

  test('Windlord is discarded if no characters are untapped after the Orc attack', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [WINDLORD],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.combat).not.toBeNull();

    // Single-character company — Aragorn fights alone; bodyRoll:1 wounds without eliminating,
    // leaving him tapped with no untapped survivors → Windlord is discarded
    const afterCombat = runCardTriggeredAttackCombat(afterPlay, [{ characterDefId: ARAGORN, roll: 1, bodyRoll: 1 }]);

    // Card is discarded from cardsInPlay (was never in Aragorn's items)
    expect(afterCombat.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === WINDLORD)).toBe(true);
    expect(afterCombat.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === WINDLORD)).toBe(false);
  });

  // ── Bearer-cannot-untap constraint ──

  test('bearer cannot untap while Windlord is attached', () => {
    // Five-character company: Aragorn, Gimli, Theoden, and Faramir each absorb
    // one of the four strikes; Legolas stays untapped and is selected as bearer.
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [WINDLORD],
      characters: [ARAGORN, GIMLI, LEGOLAS, THEODEN, FARAMIR],
    });

    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);

    // Play: one action, no pre-selected bearer
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const action = actions[0].action as PlayPermanentEventAction;

    const afterPlay = playPermanentEventAndResolve(state, PLAYER_1, action.cardInstanceId);
    expect(afterPlay.combat).not.toBeNull();

    // Aragorn, Gimli, Theoden, Faramir each take 1 strike; Legolas stays untapped
    const afterCombat = runCardTriggeredAttackCombat(afterPlay, [
      { characterDefId: ARAGORN, roll: 1, bodyRoll: 1 },
      { characterDefId: GIMLI, roll: 1, bodyRoll: 1 },
      { characterDefId: THEODEN, roll: 1, bodyRoll: 1 },
      { characterDefId: FARAMIR, roll: 1, bodyRoll: 1 },
    ]);

    // Post-combat: select-card-bearer offered; Legolas is the only untapped character
    expect(afterCombat.combat).toBeNull();
    const bearerActions = viableActions(afterCombat, PLAYER_1, 'select-card-bearer');
    const legolasAction = bearerActions.find(
      ea => (ea.action as SelectCardBearerAction).characterId === legolasId,
    );
    expect(legolasAction).toBeDefined();

    // Select Legolas as bearer
    const afterBearerSelect = dispatch(afterCombat, legolasAction!.action);

    const legolasChar = afterBearerSelect.players[RESOURCE_PLAYER].characters[legolasId as string];
    expect(legolasChar.status).toBe(CardStatus.Tapped);
    expect(legolasChar.items.some(i => i.definitionId === WINDLORD)).toBe(true);
    const constraint = afterBearerSelect.activeConstraints.find(
      c => c.kind.type === 'bearer-cannot-untap'
        && c.target.kind === 'character'
        && c.target.characterId === legolasId,
    );
    expect(constraint).toBeDefined();
  });

  // ── Storable at Haven ──

  test('Windlord can be stored at a Haven during organization', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [WINDLORD] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(1);
  });

  // ── 3 MPs when stored ──

  test('3 misc marshalling points awarded when Windlord is stored', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const stored = addToPile(
      base, RESOURCE_PLAYER, 'outOfPlayPile',
      { instanceId: mint(), definitionId: WINDLORD },
    );
    const state = recomputeDerived(stored);
    const mp = state.players[RESOURCE_PLAYER].marshallingPoints;
    expect(mp.misc).toBe(3);
  });

  // ── Wizard-search window opens on store when no Wizard in play ──

  test('wizard-search-on-store window opens after storing when Wizard not in play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [WINDLORD] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [GANDALF, ...makePlayDeck()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(1);
    const storeAction = storeActions[0].action;

    // Dispatch store-item
    const afterStore = dispatch(state, storeAction);

    // First resolution is corruption-check; pass it
    const ccAction = viableActions(afterStore, PLAYER_1, 'corruption-check')[0]?.action;
    expect(ccAction).toBeDefined();
    const afterCC = dispatch({ ...afterStore, cheatRollTotal: 12 }, ccAction);

    // Now wizard-search actions should be available
    const wizardActions = viableActions(afterCC, PLAYER_1, 'play-wizard-from-search');
    const skipActions = viableActions(afterCC, PLAYER_1, 'skip-wizard-search');
    expect(wizardActions.length).toBeGreaterThan(0);
    expect(skipActions.length).toBe(1);

    // The wizard action should reference Gandalf
    const playGandalf = wizardActions.find(ea =>
      (ea.action as PlayWizardFromSearchAction).wizardDefinitionId === GANDALF,
    );
    expect(playGandalf).toBeDefined();
    expect((playGandalf!.action as PlayWizardFromSearchAction).source).toBe('play-deck');
  });

  // ── Wizard-search does NOT open when Wizard already in play ──

  test('no wizard-search window when Wizard is already in play', () => {
    // Gandalf is in the company — wizard already in play
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GANDALF, { defId: ARAGORN, items: [WINDLORD] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions.length).toBe(1);
    const storeAction = storeActions[0].action;

    const afterStore = dispatch(state, storeAction);
    const ccAction = viableActions(afterStore, PLAYER_1, 'corruption-check')[0]?.action;
    expect(ccAction).toBeDefined();
    const afterCC = dispatch({ ...afterStore, cheatRollTotal: 12 }, ccAction);

    // No wizard-search window should open
    const wizardActions = viableActions(afterCC, PLAYER_1, 'play-wizard-from-search');
    const skipActions = viableActions(afterCC, PLAYER_1, 'skip-wizard-search');
    expect(wizardActions.length).toBe(0);
    expect(skipActions.length).toBe(0);
    expect(afterCC.pendingResolutions).toHaveLength(0);
  });

  // ── play-wizard-from-search brings wizard into company (from play deck) ──

  test('play-wizard-from-search (play-deck) adds Gandalf to the storing company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [WINDLORD] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [GANDALF, ...makePlayDeck()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const storeAction = viableActions(state, PLAYER_1, 'store-item')[0].action;
    const afterStore = dispatch(state, storeAction);
    const ccAction = viableActions(afterStore, PLAYER_1, 'corruption-check')[0].action;
    const afterCC = dispatch({ ...afterStore, cheatRollTotal: 12 }, ccAction);

    // Play Gandalf from deck
    const playGandalfAction = viableActions(afterCC, PLAYER_1, 'play-wizard-from-search')
      .find(ea => (ea.action as PlayWizardFromSearchAction).wizardDefinitionId === GANDALF)!
      .action;
    const afterWizard = dispatch(afterCC, playGandalfAction);

    // Gandalf should now be in the company at Rivendell
    const gandalfId = findCharInstanceId(afterWizard, RESOURCE_PLAYER, GANDALF);
    expect(gandalfId).toBeDefined();
    expect(afterWizard.players[RESOURCE_PLAYER].characters[gandalfId as string]).toBeDefined();

    // Gandalf should NOT be in the play deck anymore
    expect(afterWizard.players[RESOURCE_PLAYER].playDeck.some(c => c.definitionId === GANDALF)).toBe(false);

    // No pending wizard-search resolution remains
    expect(afterWizard.pendingResolutions).toHaveLength(0);
  });

  // ── play-wizard-from-search from discard pile ──

  test('play-wizard-from-search (discard-pile) retrieves Saruman from discard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [WINDLORD] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
          discardPile: [SARUMAN],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const storeAction = viableActions(state, PLAYER_1, 'store-item')[0].action;
    const afterStore = dispatch(state, storeAction);
    const ccAction = viableActions(afterStore, PLAYER_1, 'corruption-check')[0].action;
    const afterCC = dispatch({ ...afterStore, cheatRollTotal: 12 }, ccAction);

    const sarumanAction = viableActions(afterCC, PLAYER_1, 'play-wizard-from-search')
      .find(ea => {
        const a = ea.action as PlayWizardFromSearchAction;
        return a.wizardDefinitionId === SARUMAN && a.source === 'discard-pile';
      })!;
    expect(sarumanAction).toBeDefined();

    const afterWizard = dispatch(afterCC, sarumanAction.action);
    const sarumanId = findCharInstanceId(afterWizard, RESOURCE_PLAYER, SARUMAN);
    expect(sarumanId).toBeDefined();
    expect(afterWizard.players[RESOURCE_PLAYER].discardPile.some(c => c.definitionId === SARUMAN)).toBe(false);
    expect(afterWizard.pendingResolutions).toHaveLength(0);
  });

  // ── skip-wizard-search closes the window ──

  test('skip-wizard-search closes the window without placing a Wizard', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [WINDLORD] }] }],
          hand: [],
          siteDeck: [MORIA],
          playDeck: [GANDALF, ...makePlayDeck()],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MORIA] },
      ],
    });

    const storeAction = viableActions(state, PLAYER_1, 'store-item')[0].action;
    const afterStore = dispatch(state, storeAction);
    const ccAction = viableActions(afterStore, PLAYER_1, 'corruption-check')[0].action;
    const afterCC = dispatch({ ...afterStore, cheatRollTotal: 12 }, ccAction);

    const skipAction = viableActions(afterCC, PLAYER_1, 'skip-wizard-search')[0].action;
    const afterSkip = dispatch(afterCC, skipAction);

    // No wizard in play, resolution cleared
    expect(afterSkip.pendingResolutions).toHaveLength(0);
    expect(Object.keys(afterSkip.players[RESOURCE_PLAYER].characters)).toHaveLength(1); // only Aragorn
  });

  // ── Duplication limit: same player cannot hold two copies ──

  test('NOT playable when the same player already holds a copy on a character', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      hand: [WINDLORD],
    });
    const stateWithCopy = attachItemToChar(state, RESOURCE_PLAYER, ARAGORN, WINDLORD);
    const actions = viableActions(stateWithCopy, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(0);
  });

  // ── Different players can each hold a copy ──

  test('IS playable if the other player already holds a copy (different player scope)', () => {
    // Build proper site-phase state for Player 1 at Moria, then attach Windlord to Player 2's Legolas
    const base = buildSitePhaseState({
      site: MORIA,
      hand: [WINDLORD],
    });
    const stateWithP2Copy = attachItemToChar(base, HAZARD_PLAYER, LEGOLAS, WINDLORD);
    const actions = viableActions(stateWithP2Copy, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBeGreaterThan(0);
  });
});
