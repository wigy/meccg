/**
 * @module le-236.test
 *
 * Card test: Swag (le-236)
 * Type: minion-resource-event (short, ringwraith alignment), MP 0.
 *
 * Text: "Playable on a company at a tapped Ruins & Lairs [{R}], Border-hold
 * [{B}], or Free-hold [{F}]. During the site phase, one or two characters in
 * that company may each tap to take control of a non-unique, non-hoard minor
 * item of the following type: weapon, armor, shield, or helmet. You may take
 * these items from your play deck (reshuffle if used), discard pile, and/or
 * sideboard."
 *
 * Effects & engine support (same mechanism as Old Cache le-213):
 * | # | Rule                                        | Mechanism                                                     |
 * |---|---------------------------------------------|---------------------------------------------------------------|
 * | 1 | Site phase, at a Ruins & Lairs /            | `play-window` `phase: "site"`, `siteTypes: [ruins-and-lairs,  |
 * |   | Border-hold / Free-hold                     | border-hold, free-hold]`                                      |
 * | 2 | …that is tapped                             | `play-flag: tapped-site-only`                                 |
 * | 3 | One or two characters in that company may   | `tap-take-item` `count: 2`, sources deck / discard-pile /     |
 * |   | each tap to take control of a matching item | sideboard; `filter`: minion-resource-item, minor, non-unique, |
 * |   |                                             | not hoard, keyword weapon/armor/shield/helmet                 |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  LORIEN, MINAS_TIRITH, LEGOLAS,
  buildSitePhaseState, buildTestState, resetMint,
  viableActions, dispatch, findCharInstanceId, expectInDiscardPile,
  CardStatus, Phase,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, TapTakeItemAction } from '../../index.js';

const SWAG = 'le-236' as CardDefinitionId;

/** Minion orc characters (le-18, le-25, le-12). */
const LAGDUF = 'le-18' as CardDefinitionId;
const MUZGASH = 'le-25' as CardDefinitionId;
const GRISHNAKH = 'le-12' as CardDefinitionId;

/** Ruins & Lairs (le-417 Zarak Dûm), Border-hold (le-363 Dale), Free-hold (le-372 Edoras), Dark-hold (le-352 Barad-dûr), Darkhaven (le-359 Carn Dûm), Shadow-hold (le-394 Mount Gram). */
const ZARAK_DUM = 'le-417' as CardDefinitionId;
const DALE = 'le-363' as CardDefinitionId;
const EDORAS = 'le-372' as CardDefinitionId;
const BARAD_DUR = 'le-352' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;
const MOUNT_GRAM = 'le-394' as CardDefinitionId;

/** Qualifying items: non-unique, non-hoard minor shield (le-300) / weapon (le-342). */
const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId;
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;
/** Non-qualifying: minor item of no listed type (le-310). */
const FOUL_SMELLING_PASTE = 'le-310' as CardDefinitionId;
/** Non-qualifying: major armor (le-301). */
const BLACK_MAIL_COAT = 'le-301' as CardDefinitionId;

describe('Swag (le-236)', () => {
  beforeEach(() => resetMint());

  test.each([
    ['Ruins & Lairs', ZARAK_DUM],
    ['Border-hold', DALE],
    ['Free-hold', EDORAS],
  ])('playable on a company at a tapped %s', (_label, site) => {
    const state = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF], hand: [SWAG], sideboard: [BLACK_HIDE_SHIELD],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(1);
  });

  test('NOT playable at an untapped Ruins & Lairs', () => {
    const state = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: ZARAK_DUM,
      characters: [LAGDUF], hand: [SWAG], sideboard: [BLACK_HIDE_SHIELD],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT playable at a tapped Dark-hold', () => {
    const state = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: BARAD_DUR, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF], hand: [SWAG], sideboard: [BLACK_HIDE_SHIELD],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('two characters each tap to take a matching item at a tapped Zarak Dûm; then Swag is discarded', () => {
    // Bug report (game mvj4blbj-kkinem, seq 2066): Swag played at a tapped
    // Zarak Dûm went straight to the discard pile without letting any
    // character take an item (the card had no effects defined).
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: ZARAK_DUM, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF, MUZGASH, GRISHNAKH], hand: [SWAG],
      playDeck: [BLACK_HIDE_SHIELD, FOUL_SMELLING_PASTE, BLACK_MAIL_COAT],
      discardPile: [SAW_TOOTHED_BLADE],
    });
    const declared = dispatch(base, viableActions(base, PLAYER_1, 'play-short-event')[0].action);
    expect(declared.pendingEffects).toHaveLength(1);
    expect(declared.pendingEffects[0].effect.type).toBe('tap-take-item');

    const lagdufId = findCharInstanceId(declared, RESOURCE_PLAYER, LAGDUF);
    const muzgashId = findCharInstanceId(declared, RESOURCE_PLAYER, MUZGASH);
    const grishId = findCharInstanceId(declared, RESOURCE_PLAYER, GRISHNAKH);

    const offered = viableActions(declared, PLAYER_1, 'tap-take-item').map(a => a.action as TapTakeItemAction);
    // 2 qualifying cards (deck shield, discard blade) × 3 characters.
    expect(offered).toHaveLength(6);

    const first = offered.find(a => a.characterId === lagdufId && a.source === 'deck')!;
    const afterFirst = dispatch(declared, first);
    expect(afterFirst.players[0].characters[lagdufId].status).toBe(CardStatus.Tapped);
    expect(afterFirst.players[0].characters[lagdufId].items.map(i => i.definitionId)).toEqual([BLACK_HIDE_SHIELD]);

    const second = viableActions(afterFirst, PLAYER_1, 'tap-take-item')
      .map(a => a.action as TapTakeItemAction)
      .find(a => a.characterId === muzgashId && a.source === 'discard-pile')!;
    const afterSecond = dispatch(afterFirst, second);
    expect(afterSecond.players[0].characters[muzgashId].items.map(i => i.definitionId)).toEqual([SAW_TOOTHED_BLADE]);

    expect(afterSecond.pendingEffects).toHaveLength(0);
    expect(afterSecond.players[0].characters[grishId].status).toBe(CardStatus.Untapped);
    expectInDiscardPile(afterSecond, RESOURCE_PLAYER, SWAG);
  });

  test('NOT playable during the organization phase at a Darkhaven and an untapped Ruins & Lairs', () => {
    // Bug report (game mvj4blbj-kkinem, seq 1939): with companies at Carn Dûm
    // and an untapped Ruins & Lairs, Swag was offered as a viable no-op
    // short-event in the organization phase because its card data had no effects.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: CARN_DUM, characters: [LAGDUF] }, { site: ZARAK_DUM, characters: [MUZGASH] }],
          hand: [SWAG], siteDeck: [MOUNT_GRAM], sideboard: [BLACK_HIDE_SHIELD],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('a character taps to take a matching item from the sideboard; after passing the card is discarded', () => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: DALE, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF], hand: [SWAG], sideboard: [BLACK_HIDE_SHIELD],
    });
    const declared = dispatch(base, viableActions(base, PLAYER_1, 'play-short-event')[0].action);
    const lagdufId = findCharInstanceId(declared, RESOURCE_PLAYER, LAGDUF);
    const pick = viableActions(declared, PLAYER_1, 'tap-take-item')
      .map(a => a.action as TapTakeItemAction)
      .find(a => a.characterId === lagdufId && a.source === 'sideboard')!;
    expect(pick).toBeDefined();
    const after = dispatch(declared, pick);
    expect(after.players[0].characters[lagdufId].status).toBe(CardStatus.Tapped);
    expect(after.players[0].characters[lagdufId].items.map(i => i.definitionId)).toEqual([BLACK_HIDE_SHIELD]);
    const done = dispatch(after, { type: 'pass', player: PLAYER_1 });
    expect(done.pendingEffects).toHaveLength(0);
    expectInDiscardPile(done, RESOURCE_PLAYER, SWAG);
  });
});
