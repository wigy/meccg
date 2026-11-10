/**
 * @module dm-170.test
 *
 * Card test: Gems of Arda (dm-170)
 * Type: hero-resource-item (Special Item), non-unique, 3 item MP, 3 CP.
 *
 * Card text: "Playable at The Gem-deeps. If you have a stored Vein of Arda,
 * playable at any Under-deeps site. During any organization phase in which
 * you store Gems of Arda, you may immediately tap a character in the same
 * company and play a non-special item with him from your hand or discard
 * pile. This item must be identical to an item that your opponent has
 * already stored. Your opponent's stored item is discarded, and you may
 * never store the item you played."
 *
 * Rule coverage:
 *
 * | # | Rule                                                        | Mechanism                                                    |
 * |---|-------------------------------------------------------------|--------------------------------------------------------------|
 * | 1 | Playable at The Gem-deeps                                   | item-play-site `sites`                                       |
 * | 2 | With a stored Vein of Arda, playable at any Under-deeps site | item-play-site `filter` on `player.storedNames`              |
 * | 3 | On storing (org phase): tap a company character, play an item from hand/discard | play-item-on-store → store-item-play-offer |
 * | 4 | Item must be non-special                                    | `itemFilter` `$not subtype special`                          |
 * | 5 | Item must be identical to an opponent-stored item           | `matchOpponentStored`                                        |
 * | 6 | Opponent's stored item is discarded                         | `matchOpponentStored` resolution                             |
 * | 7 | The played item may never be stored                         | `playedItemNoStore` → `ItemInPlay.neverStorable`             |
 *
 * Gems of Arda itself is storable at any Haven (CoE 2.II.4). A failed store
 * check (the card is discarded, never stored) raises no offer.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  CardStatus, Phase,
  ARAGORN, GIMLI, LEGOLAS,
  MORIA, RIVENDELL, LORIEN,
  buildSitePhaseState, buildTestState, makePlayDeck, resetMint,
  viableActions, dispatch, reduce, addToPile, mint,
  findCharInstanceId,
} from '../test-helpers.js';
import { DAGGER_OF_WESTERNESSE, HAUBERK_OF_BRIGHT_MAIL, PALANTIR_OF_ORTHANC } from '../../card-ids.js';
import type { CardDefinitionId, PlayStoreItemOfferAction } from '../../index.js';

const GEMS_OF_ARDA = 'dm-170' as CardDefinitionId;
const VEIN_OF_ARDA = 'dm-162' as CardDefinitionId;
const GEM_DEEPS = 'dm-30' as CardDefinitionId;     // hero version, ruins-and-lairs, under-deeps
const UNDER_VAULTS = 'dm-41' as CardDefinitionId;  // ruins-and-lairs, under-deeps

describe('Gems of Arda (dm-170)', () => {
  beforeEach(() => resetMint());

  // ─── Rules 1–2: site playability ─────────────────────────────────────────

  test('playable at The Gem-deeps', () => {
    const state = buildSitePhaseState({ site: GEM_DEEPS, characters: [ARAGORN], hand: [GEMS_OF_ARDA] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('NOT playable at another Under-deeps site without a stored Vein of Arda', () => {
    const state = buildSitePhaseState({ site: UNDER_VAULTS, characters: [ARAGORN], hand: [GEMS_OF_ARDA] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('playable at any Under-deeps site once Vein of Arda is stored', () => {
    const base = buildSitePhaseState({ site: UNDER_VAULTS, characters: [ARAGORN], hand: [GEMS_OF_ARDA] });
    const state = addToPile(base, RESOURCE_PLAYER, 'killPile', { instanceId: mint(), definitionId: VEIN_OF_ARDA });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('an opponent-stored Vein of Arda does not open the Under-deeps sites', () => {
    const base = buildSitePhaseState({ site: UNDER_VAULTS, characters: [ARAGORN], hand: [GEMS_OF_ARDA] });
    const state = addToPile(base, HAZARD_PLAYER, 'killPile', { instanceId: mint(), definitionId: VEIN_OF_ARDA });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('a stored Vein of Arda does not open non-Under-deeps sites (Moria)', () => {
    const base = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [GEMS_OF_ARDA] });
    const state = addToPile(base, RESOURCE_PLAYER, 'killPile', { instanceId: mint(), definitionId: VEIN_OF_ARDA });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ─── Rules 3–7: the store follow-up ──────────────────────────────────────

  test('storing Gems of Arda lets a company character tap to play the opponent-stored item from hand; the opponent copy is discarded and the item may never be stored', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GEMS_OF_ARDA] }, GIMLI] },
            { site: RIVENDELL, characters: [LEGOLAS] },
          ],
          hand: [DAGGER_OF_WESTERNESSE],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const opponentDaggerId = mint();
    const state = addToPile(base, HAZARD_PLAYER, 'killPile', { instanceId: opponentDaggerId, definitionId: DAGGER_OF_WESTERNESSE });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const legolasId = findCharInstanceId(state, RESOURCE_PLAYER, LEGOLAS);
    const gemsId = state.players[RESOURCE_PLAYER].characters[aragornId].items[0].instanceId;
    const daggerId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const store = viableActions(state, PLAYER_1, 'store-item')
      .find(ea => (ea.action as { itemInstanceId?: string }).itemInstanceId === gemsId)!;
    expect(store).toBeDefined();
    const afterStore = dispatch(state, store.action);
    const cc = viableActions(afterStore, PLAYER_1, 'corruption-check')[0].action;
    const afterCheck = dispatch({ ...afterStore, cheatRollTotal: 12 }, cc);

    // Gems of Arda is stored and the offer is open.
    expect(afterCheck.players[RESOURCE_PLAYER].killPile.some(c => c.instanceId === gemsId)).toBe(true);
    expect(afterCheck.pendingResolutions[0]?.kind.type).toBe('store-item-play-offer');
    expect(viableActions(afterCheck, PLAYER_1, 'pass')).toHaveLength(1);
    const offers = viableActions(afterCheck, PLAYER_1, 'play-store-item-offer')
      .map(ea => ea.action as PlayStoreItemOfferAction);
    // Either untapped character of the storing company — never one in another company.
    expect(offers.map(o => o.characterId).sort()).toEqual([aragornId, gimliId].sort());
    expect(offers.some(o => o.characterId === legolasId)).toBe(false);
    expect(offers.every(o => o.cardInstanceId === daggerId && o.source === 'hand'
      && o.opponentStoredInstanceId === opponentDaggerId)).toBe(true);

    const play = offers.find(o => o.characterId === gimliId)!;
    const afterPlay = dispatch(afterCheck, play);
    const gimli = afterPlay.players[RESOURCE_PLAYER].characters[gimliId];
    expect(gimli.status).toBe(CardStatus.Tapped);
    expect(gimli.items.find(i => i.instanceId === daggerId)?.neverStorable).toBe(true);
    expect(afterPlay.players[RESOURCE_PLAYER].hand.some(c => c.instanceId === daggerId)).toBe(false);
    expect(afterPlay.players[HAZARD_PLAYER].killPile.some(c => c.instanceId === opponentDaggerId)).toBe(false);
    expect(afterPlay.players[HAZARD_PLAYER].discardPile.some(c => c.instanceId === opponentDaggerId)).toBe(true);
    expect(afterPlay.pendingResolutions).toHaveLength(0);

    // "You may never store the item you played" — even at a Haven.
    const daggerStores = viableActions(afterPlay, PLAYER_1, 'store-item')
      .filter(ea => (ea.action as { itemInstanceId?: string }).itemInstanceId === daggerId);
    expect(daggerStores).toHaveLength(0);
    const forced = reduce(afterPlay, { type: 'store-item', player: PLAYER_1, itemInstanceId: daggerId, characterId: gimliId });
    expect(forced.error).toBeDefined();
  });

  test('the item may come from the discard pile', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GEMS_OF_ARDA] }] }],
          hand: [],
          discardPile: [HAUBERK_OF_BRIGHT_MAIL],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const state = addToPile(base, HAZARD_PLAYER, 'killPile', { instanceId: mint(), definitionId: HAUBERK_OF_BRIGHT_MAIL });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const hauberkId = state.players[RESOURCE_PLAYER].discardPile[0].instanceId;

    const afterStore = dispatch(state, viableActions(state, PLAYER_1, 'store-item')[0].action);
    const cc = viableActions(afterStore, PLAYER_1, 'corruption-check')[0].action;
    const afterCheck = dispatch({ ...afterStore, cheatRollTotal: 12 }, cc);

    const offers = viableActions(afterCheck, PLAYER_1, 'play-store-item-offer')
      .map(ea => ea.action as PlayStoreItemOfferAction);
    expect(offers).toHaveLength(1);
    expect(offers[0].source).toBe('discard-pile');
    const afterPlay = dispatch(afterCheck, offers[0]);
    expect(afterPlay.players[RESOURCE_PLAYER].characters[aragornId].items.some(i => i.instanceId === hauberkId)).toBe(true);
    expect(afterPlay.players[RESOURCE_PLAYER].characters[aragornId].status).toBe(CardStatus.Tapped);
    expect(afterPlay.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === hauberkId)).toBe(false);
  });

  test('no item is offered unless the opponent has stored an identical item', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GEMS_OF_ARDA] }] }],
          hand: [DAGGER_OF_WESTERNESSE],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    // Opponent stored a different item; I stored a Dagger myself (doesn't count).
    const s1 = addToPile(base, HAZARD_PLAYER, 'killPile', { instanceId: mint(), definitionId: HAUBERK_OF_BRIGHT_MAIL });
    const state = addToPile(s1, RESOURCE_PLAYER, 'killPile', { instanceId: mint(), definitionId: DAGGER_OF_WESTERNESSE });
    const gemsStore = viableActions(state, PLAYER_1, 'store-item')[0].action;
    const afterStore = dispatch(state, gemsStore);
    const cc = viableActions(afterStore, PLAYER_1, 'corruption-check')[0].action;
    const afterCheck = dispatch({ ...afterStore, cheatRollTotal: 12 }, cc);

    expect(afterCheck.pendingResolutions[0]?.kind.type).toBe('store-item-play-offer');
    expect(viableActions(afterCheck, PLAYER_1, 'play-store-item-offer')).toHaveLength(0);
    const afterPass = dispatch(afterCheck, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.pendingResolutions).toHaveLength(0);
    expect(afterPass.players[RESOURCE_PLAYER].hand).toHaveLength(1);
  });

  test('special items are never offered, even when the opponent stored one', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GEMS_OF_ARDA] }] }],
          hand: [PALANTIR_OF_ORTHANC],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const state = addToPile(base, HAZARD_PLAYER, 'killPile', { instanceId: mint(), definitionId: GEMS_OF_ARDA });
    const s2 = addToPile(state, HAZARD_PLAYER, 'killPile', { instanceId: mint(), definitionId: PALANTIR_OF_ORTHANC });
    const afterStore = dispatch(s2, viableActions(s2, PLAYER_1, 'store-item')[0].action);
    const cc = viableActions(afterStore, PLAYER_1, 'corruption-check')[0].action;
    const afterCheck = dispatch({ ...afterStore, cheatRollTotal: 12 }, cc);

    expect(afterCheck.pendingResolutions[0]?.kind.type).toBe('store-item-play-offer');
    expect(viableActions(afterCheck, PLAYER_1, 'play-store-item-offer')).toHaveLength(0);
  });

  test('a failed store check raises no offer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: ARAGORN, items: [GEMS_OF_ARDA] }, GIMLI] }],
          hand: [DAGGER_OF_WESTERNESSE],
          siteDeck: [MORIA],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MORIA] },
      ],
    });
    const state = addToPile(base, HAZARD_PLAYER, 'killPile', { instanceId: mint(), definitionId: DAGGER_OF_WESTERNESSE });
    const afterStore = dispatch(state, viableActions(state, PLAYER_1, 'store-item')[0].action);
    const cc = viableActions(afterStore, PLAYER_1, 'corruption-check')[0].action;
    const afterCheck = dispatch({ ...afterStore, cheatRollTotal: 2 }, cc);

    expect(afterCheck.pendingResolutions.some(r => r.kind.type === 'store-item-play-offer')).toBe(false);
    expect(viableActions(afterCheck, PLAYER_1, 'play-store-item-offer')).toHaveLength(0);
  });
});
