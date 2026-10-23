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
 * | 3 | One or two characters in that company may   | `tap-take-item` `count: 2` from deck / discard / sideboard,   |
 * |   | each tap to take control of a matching item | filter: minion minor, non-unique, non-hoard, weapon/armor/    |
 * |   |                                             | shield/helmet                                                 |
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

/** Minion orc characters (le-18, le-25). */
const LAGDUF = 'le-18' as CardDefinitionId;
const MUZGASH = 'le-25' as CardDefinitionId;

/** Ruins & Lairs (le-351), Border-hold (le-363), Free-hold (le-372), Shadow-hold (le-394), Darkhaven (le-359). */
const BANDIT_LAIR = 'le-351' as CardDefinitionId;
const DALE = 'le-363' as CardDefinitionId;
const EDORAS = 'le-372' as CardDefinitionId;
const MOUNT_GRAM = 'le-394' as CardDefinitionId;
const CARN_DUM = 'le-359' as CardDefinitionId;

/** Qualifying item: non-unique, non-hoard minor shield (le-300). */
const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId;

describe('Swag (le-236)', () => {
  beforeEach(() => resetMint());

  test.each([
    ['Ruins & Lairs', BANDIT_LAIR],
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
      alignment: Alignment.Ringwraith, site: BANDIT_LAIR,
      characters: [LAGDUF], hand: [SWAG], sideboard: [BLACK_HIDE_SHIELD],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT playable at a tapped Shadow-hold', () => {
    const state = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: MOUNT_GRAM, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF], hand: [SWAG], sideboard: [BLACK_HIDE_SHIELD],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
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
          companies: [{ site: CARN_DUM, characters: [LAGDUF] }, { site: BANDIT_LAIR, characters: [MUZGASH] }],
          hand: [SWAG], siteDeck: [MOUNT_GRAM], sideboard: [BLACK_HIDE_SHIELD],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('a character taps to take a matching item; after passing the card is discarded', () => {
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
