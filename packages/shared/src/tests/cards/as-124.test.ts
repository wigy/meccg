/**
 * @module as-124.test
 *
 * Card test: Dwarven Ring of Thrár's Tribe (as-124)
 * Type: minion-resource-item (special)
 * Alignment: ringwraith
 *
 * "Unique. Dwarven Ring. Playable only with a gold ring and after a test
 *  indicates a Dwarven Ring. Values in parentheses apply to a Dwarf bearer.
 *  Tap a Dwarf bearer to search your play deck and/or your discard pile for
 *  any one or two minor items; place these items in your hand and reshuffle
 *  your play deck. Bearer then makes a corruption check modified by +2."
 *
 * corruptionPoints: 3 base (from card data); +2 for Dwarf bearer (stat-modifier)
 * keywords: ring, dwarven-ring — makes it a valid target for ring-play-offer
 *   after a gold ring test result indicates a Dwarven Ring (enforced by engine)
 *
 * Effects tested:
 * 1. stat-modifier corruption-points +2 when bearer.race === "dwarf": total 5 CP
 *    for Dwarf bearer, 3 CP for non-Dwarf bearer
 * 2. grant-action dwarven-ring-fetch (cost: tap bearer, when: bearer.race=dwarf):
 *    a. Offered during organization phase for an untapped Dwarf bearer
 *    b. Not offered when bearer is not a Dwarf
 *    c. Not offered when Dwarf bearer is tapped
 *    d. Activating taps bearer and enqueues fetch-to-deck with play-deck+discard
 *       source, hand destination, count=2
 *    e. Fetch offers minor items from play deck
 *    f. Fetch offers minor items from discard pile
 *    g. Fetch does NOT offer non-minor items (e.g. major items)
 *    h. After the last pick, corruption check modified by +2 is enqueued
 *    i. After passing (no pick), corruption check modified by +2 is enqueued
 *
 * Playable: YES
 * Certified: 2026-06-01
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  Phase, CardStatus,
  buildTestState, resetMint, recomputeDerived,
  viableActions, dispatch,
  getCharacter, attachItemToChar, findCharInstanceId,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type { ActivateGrantedAction, CardDefinitionId, GameState } from '../../index.js';
import { computeLegalActions, Alignment } from '../../index.js';

const DWARVEN_RING = 'as-124' as CardDefinitionId;

// Dwarf minion character (dm-6 Drór, race: dwarf)
const DROR = 'dm-6' as CardDefinitionId;
// Non-Dwarf minion character (as-4 Perchen, race: man)
const PERCHEN = 'as-4' as CardDefinitionId;

// Minion minor items for fetch tests
const OLD_TREASURE = 'as-129' as CardDefinitionId;
const JEWEL_OF_BELERIAND = 'as-70' as CardDefinitionId;

// Non-minor item (major) for filter test
const SABLE_SHIELD = 'le-341' as CardDefinitionId;

// Minion sites
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // minion haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // minion haven
const CARN_DUM = 'le-359' as CardDefinitionId;        // shadow-hold (for siteDeck)

describe('Dwarven Ring of Thrár\'s Tribe (as-124)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: stat-modifier — corruption-points +2 for Dwarf bearer ─────────

  test('corruption points are 3 for a non-Dwarf bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [DROR] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, PERCHEN, DWARVEN_RING));

    // Perchen is race:man — no +2 bonus. Base corruptionPoints = 3.
    expect(getCharacter(withRing, RESOURCE_PLAYER, PERCHEN).effectiveStats.corruptionPoints).toBe(3);
  });

  test('corruption points are 5 for a Dwarf bearer (+2 from stat-modifier)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DROR] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING));

    // Drór is race:dwarf — stat-modifier adds +2 CP. Total: 3 + 2 = 5.
    expect(getCharacter(withRing, RESOURCE_PLAYER, DROR).effectiveStats.corruptionPoints).toBe(5);
  });

  // ─── Effect 2: grant-action dwarven-ring-fetch ────────────────────────────────

  test('grant-action is offered during organization phase for untapped Dwarf bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DROR] }], hand: [], siteDeck: [CARN_DUM], discardPile: [OLD_TREASURE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'dwarven-ring-fetch',
    );
    expect(ringActions).toHaveLength(1);
  });

  test('grant-action is NOT offered when bearer is not a Dwarf', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM], discardPile: [OLD_TREASURE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [DROR] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, PERCHEN, DWARVEN_RING);

    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'dwarven-ring-fetch',
    );
    expect(ringActions).toHaveLength(0);
  });

  test('grant-action is NOT offered when Dwarf bearer is tapped', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: DROR, status: CardStatus.Tapped }] }],
          hand: [], siteDeck: [CARN_DUM], discardPile: [OLD_TREASURE],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringActions = actions.filter(
      ea => (ea.action as ActivateGrantedAction).actionId === 'dwarven-ring-fetch',
    );
    expect(ringActions).toHaveLength(0);
  });

  test('activating taps the Dwarf bearer and enqueues fetch-to-deck with correct params', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DROR] }], hand: [], siteDeck: [CARN_DUM], discardPile: [OLD_TREASURE] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activateActions = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringAction = activateActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'dwarven-ring-fetch',
    )!;
    const afterActivate: GameState = dispatch(withRing, ringAction.action);

    // Bearer should be tapped
    const drorId = findCharInstanceId(afterActivate, RESOURCE_PLAYER, DROR);
    expect(afterActivate.players[0].characters[drorId].status).toBe(CardStatus.Tapped);

    // Pending effect should be a fetch-to-deck
    expect(afterActivate.pendingEffects).toHaveLength(1);
    const pe = afterActivate.pendingEffects[0];
    expect(pe.type).toBe('card-effect');
    const effect = (pe as { effect: { type: string; source: readonly string[]; to?: string; count: number } }).effect;
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.source).toContain('play-deck');
    expect(effect.source).toContain('discard-pile');
    expect(effect.to).toBe('hand');
    expect(effect.count).toBe(2);
  });

  test('fetch offers minor items from play deck', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [DROR] }],
          hand: [], siteDeck: [CARN_DUM],
          playDeck: [OLD_TREASURE],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activateActions = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringAction = activateActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'dwarven-ring-fetch',
    )!;
    const afterActivate: GameState = dispatch(withRing, ringAction.action);

    const fetchActions = computeLegalActions(afterActivate, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');

    // Old Treasure (minor) in play deck should be offered
    const deckInstance = afterActivate.players[0].playDeck.find(c => c.definitionId === OLD_TREASURE)!;
    const offeredIds = fetchActions.map(ea => (ea.action as { cardInstanceId: string }).cardInstanceId);
    expect(offeredIds).toContain(deckInstance.instanceId as string);
  });

  test('fetch offers minor items from discard pile', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [DROR] }],
          hand: [], siteDeck: [CARN_DUM],
          discardPile: [JEWEL_OF_BELERIAND],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activateActions = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringAction = activateActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'dwarven-ring-fetch',
    )!;
    const afterActivate: GameState = dispatch(withRing, ringAction.action);

    const fetchActions = computeLegalActions(afterActivate, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');

    // Jewel of Beleriand (minor) in discard pile should be offered
    const discardInstance = afterActivate.players[0].discardPile.find(c => c.definitionId === JEWEL_OF_BELERIAND)!;
    const offeredIds = fetchActions.map(ea => (ea.action as { cardInstanceId: string }).cardInstanceId);
    expect(offeredIds).toContain(discardInstance.instanceId as string);
  });

  test('fetch does NOT offer non-minor items', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [DROR] }],
          hand: [], siteDeck: [CARN_DUM],
          discardPile: [OLD_TREASURE, SABLE_SHIELD],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activateActions = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringAction = activateActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'dwarven-ring-fetch',
    )!;
    const afterActivate: GameState = dispatch(withRing, ringAction.action);

    const fetchActions = computeLegalActions(afterActivate, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');

    // Sable Shield (major item) must NOT be offered
    const shieldInstance = afterActivate.players[0].discardPile.find(c => c.definitionId === SABLE_SHIELD)!;
    const offeredIds = fetchActions.map(ea => (ea.action as { cardInstanceId: string }).cardInstanceId);
    expect(offeredIds).not.toContain(shieldInstance.instanceId as string);

    // Old Treasure (minor) should still be offered
    const minorInstance = afterActivate.players[0].discardPile.find(c => c.definitionId === OLD_TREASURE)!;
    expect(offeredIds).toContain(minorInstance.instanceId as string);
  });

  test('fetching a minor item from discard places it in hand and enqueues +2 CC after last pick', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [DROR] }],
          hand: [], siteDeck: [CARN_DUM],
          discardPile: [OLD_TREASURE],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);
    const drorId = findCharInstanceId(withRing, RESOURCE_PLAYER, DROR);

    const activateActions = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringAction = activateActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'dwarven-ring-fetch',
    )!;
    const afterActivate: GameState = dispatch(withRing, ringAction.action);

    // First pick: take Old Treasure from discard pile
    const fetchActions1 = computeLegalActions(afterActivate, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions1.length).toBeGreaterThanOrEqual(1);

    const oldTreasureInst = afterActivate.players[0].discardPile.find(c => c.definitionId === OLD_TREASURE)!;
    const afterFetch1: GameState = dispatch(afterActivate,
      fetchActions1.find(ea => (ea.action as { cardInstanceId: string }).cardInstanceId === (oldTreasureInst.instanceId as string))!.action,
    );

    // Old Treasure should now be in hand
    expect(afterFetch1.players[0].hand.some(c => c.definitionId === OLD_TREASURE)).toBe(true);
    expect(afterFetch1.players[0].discardPile.some(c => c.definitionId === OLD_TREASURE)).toBe(false);

    // Second pick: pass (only one minor item was available)
    const fetchActions2 = computeLegalActions(afterFetch1, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    // No more minor items available, so only pass is offered
    const afterPass: GameState = dispatch(afterFetch1, { type: 'pass', player: PLAYER_1 });

    // After all picks, pending effects should be cleared
    expect(afterPass.pendingEffects).toHaveLength(0);

    // Corruption check modified by +2 should be enqueued for Drór
    const cc = afterPass.pendingResolutions.find(
      r => r.kind.type === 'corruption-check' && r.kind.characterId === drorId,
    );
    expect(cc).toBeDefined();
    expect((cc!.kind as { type: string; modifier: number }).modifier).toBe(2);

    void fetchActions2;
  });

  test('fetching a minor item from play deck places it in hand', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: DOL_GULDUR, characters: [DROR] }],
          hand: [], siteDeck: [CARN_DUM],
          playDeck: [OLD_TREASURE, CARN_DUM],
        },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);

    const activateActions = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringAction = activateActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'dwarven-ring-fetch',
    )!;
    const afterActivate: GameState = dispatch(withRing, ringAction.action);

    // Fetch Old Treasure from play deck
    const fetchActions = computeLegalActions(afterActivate, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    const deckInstance = afterActivate.players[0].playDeck.find(c => c.definitionId === OLD_TREASURE)!;
    const deckFetchAction = fetchActions.find(
      ea => (ea.action as { cardInstanceId: string }).cardInstanceId === (deckInstance.instanceId as string),
    )!;
    const afterFetch: GameState = dispatch(afterActivate, deckFetchAction.action);

    // Old Treasure goes to hand
    expect(afterFetch.players[0].hand.some(c => c.definitionId === OLD_TREASURE)).toBe(true);
    // It's removed from play deck
    expect(afterFetch.players[0].playDeck.some(c => c.definitionId === OLD_TREASURE)).toBe(false);
  });

  test('passing the fetch (no pick) enqueues corruption check modified by +2', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [DROR] }], hand: [], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [PERCHEN] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, DROR, DWARVEN_RING);
    const drorId = findCharInstanceId(withRing, RESOURCE_PLAYER, DROR);

    const activateActions = viableActions(withRing, PLAYER_1, 'activate-granted-action');
    const ringAction = activateActions.find(
      ea => (ea.action as ActivateGrantedAction).actionId === 'dwarven-ring-fetch',
    )!;
    const afterActivate: GameState = dispatch(withRing, ringAction.action);
    expect(afterActivate.pendingEffects).toHaveLength(1);

    // Pass without picking anything
    const afterPass: GameState = dispatch(afterActivate, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.pendingEffects).toHaveLength(0);

    // Corruption check modified by +2 should still be enqueued
    const cc = afterPass.pendingResolutions.find(
      r => r.kind.type === 'corruption-check' && r.kind.characterId === drorId,
    );
    expect(cc).toBeDefined();
    expect((cc!.kind as { type: string; modifier: number }).modifier).toBe(2);
  });
});
