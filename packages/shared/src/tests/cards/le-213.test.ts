/**
 * @module le-213.test
 *
 * Card test: Old Cache (le-213)
 * Type: minion-resource-event (short, ringwraith alignment), MP 0.
 *
 * Text: "Playable during the site phase on a company at a tapped Dark-hold
 * [{D}], Shadow-hold [{S}], or Ruins & Lairs [{R}]. During the site phase,
 * one or two characters in that company may each tap to take control of a
 * non-unique, non-hoard minor item of the following type: weapon, armor,
 * shield, or helmet. You may take these items from your play deck (reshuffle
 * if used), discard pile, and/or sideboard."
 *
 * Effects & engine support:
 * | # | Rule                                        | Mechanism                                                     |
 * |---|---------------------------------------------|---------------------------------------------------------------|
 * | 1 | Site phase, at a Dark-hold / Shadow-hold /  | `play-window` `phase: "site"`, `siteTypes: [dark-hold,        |
 * |   | Ruins & Lairs                               | shadow-hold, ruins-and-lairs]`                                |
 * | 2 | …that is tapped                             | `play-flag: tapped-site-only` (short-event gate in            |
 * |   |                                             | `playResourceShortEventActions`)                              |
 * | 3 | One or two characters in that company may   | `tap-take-item` `count: 2` — `card-effect` sub-flow bound to  |
 * |   | each tap to take control of a matching item | the playing company; each `tap-take-item` pick taps one       |
 * |   | from play deck (reshuffle) / discard /      | untapped member and attaches the item to him; `pass` stops    |
 * |   | sideboard                                   | early. `filter`: minion-resource-item, minor, non-unique,     |
 * |   |                                             | not hoard, keyword weapon/armor/shield/helmet                 |
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  HAZARD_PLAYER,
  LORIEN, MINAS_TIRITH, LEGOLAS,
  buildSitePhaseState, buildTestState, resetMint,
  viableActions, dispatch, findCharInstanceId, expectInDiscardPile,
  CardStatus, Phase,
} from '../test-helpers.js';
import { reduce } from '../../engine/reducer.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, TapTakeItemAction } from '../../index.js';

const OLD_CACHE = 'le-213' as CardDefinitionId;

/** Minion orc characters (le-18, le-25, le-12). */
const LAGDUF = 'le-18' as CardDefinitionId;
const MUZGASH = 'le-25' as CardDefinitionId;
const GRISHNAKH = 'le-12' as CardDefinitionId;

/** Shadow-hold (le-394), Dark-hold (le-361), Ruins & Lairs (le-351), Border-hold (le-363). */
const MOUNT_GRAM = 'le-394' as CardDefinitionId;
const CIRITH_GORGOR = 'le-361' as CardDefinitionId;
const BANDIT_LAIR = 'le-351' as CardDefinitionId;
const DALE = 'le-363' as CardDefinitionId;

/** Qualifying items: non-unique, non-hoard minor shield (le-300) / weapon (le-342). */
const BLACK_HIDE_SHIELD = 'le-300' as CardDefinitionId;
const SAW_TOOTHED_BLADE = 'le-342' as CardDefinitionId;
/** Non-qualifying: minor item of no listed type (le-310). */
const FOUL_SMELLING_PASTE = 'le-310' as CardDefinitionId;
/** Non-qualifying: hoard minor item (as-129). */
const OLD_TREASURE = 'as-129' as CardDefinitionId;
/** Non-qualifying: major armor (le-301). */
const BLACK_MAIL_COAT = 'le-301' as CardDefinitionId;
/** Non-qualifying: unique major helmet (le-313). */
const HIGH_HELM = 'le-313' as CardDefinitionId;

describe('Old Cache (le-213)', () => {
  beforeEach(() => resetMint());

  // ── Rules 1–2: site phase, at a tapped Dark-hold / Shadow-hold / Ruins & Lairs ──

  test.each([
    ['Shadow-hold', MOUNT_GRAM],
    ['Dark-hold', CIRITH_GORGOR],
    ['Ruins & Lairs', BANDIT_LAIR],
  ])('playable on a company at a tapped %s', (_label, site) => {
    const state = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF], hand: [OLD_CACHE], sideboard: [BLACK_HIDE_SHIELD],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(1);
  });

  test('NOT playable at an untapped Shadow-hold', () => {
    const state = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: MOUNT_GRAM,
      characters: [LAGDUF], hand: [OLD_CACHE], sideboard: [BLACK_HIDE_SHIELD],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT playable at a tapped Border-hold', () => {
    const state = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: DALE, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF], hand: [OLD_CACHE], sideboard: [BLACK_HIDE_SHIELD],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT playable during the organization phase', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MOUNT_GRAM, characters: [LAGDUF] }], hand: [OLD_CACHE], siteDeck: [CIRITH_GORGOR], sideboard: [BLACK_HIDE_SHIELD] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT playable when no matching item is available anywhere', () => {
    const state = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: MOUNT_GRAM, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF], hand: [OLD_CACHE],
      playDeck: [FOUL_SMELLING_PASTE, BLACK_MAIL_COAT],
      discardPile: [OLD_TREASURE],
      sideboard: [HIGH_HELM],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  test('NOT playable when every character in the company is tapped', () => {
    const state = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: MOUNT_GRAM, siteStatus: CardStatus.Tapped,
      characters: [{ defId: LAGDUF, status: CardStatus.Tapped }], hand: [OLD_CACHE], sideboard: [BLACK_HIDE_SHIELD],
    });
    expect(viableActions(state, PLAYER_1, 'play-short-event')).toHaveLength(0);
  });

  // ── Rule 3: one or two characters each tap to take a matching item ──

  test('only matching items, from play deck / discard pile / sideboard, are offered to untapped company members', () => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: MOUNT_GRAM, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF, MUZGASH], hand: [OLD_CACHE],
      playDeck: [BLACK_HIDE_SHIELD, FOUL_SMELLING_PASTE, BLACK_MAIL_COAT],
      discardPile: [SAW_TOOTHED_BLADE, OLD_TREASURE],
      sideboard: [BLACK_HIDE_SHIELD, HIGH_HELM],
    });
    const state = dispatch(base, viableActions(base, PLAYER_1, 'play-short-event')[0].action);
    expect(state.chain).toBeNull();
    expect(state.pendingEffects).toHaveLength(1);
    expect(state.pendingEffects[0].effect.type).toBe('tap-take-item');

    const offered = viableActions(state, PLAYER_1, 'tap-take-item').map(a => a.action as TapTakeItemAction);
    const lagdufId = findCharInstanceId(state, RESOURCE_PLAYER, LAGDUF);
    const muzgashId = findCharInstanceId(state, RESOURCE_PLAYER, MUZGASH);
    const legolasId = findCharInstanceId(state, HAZARD_PLAYER, LEGOLAS);
    expect(new Set(offered.map(a => a.characterId))).toEqual(new Set([lagdufId, muzgashId]));
    expect(offered.some(a => a.characterId === legolasId)).toBe(false);
    // 3 qualifying cards (deck shield, discard blade, sideboard shield) × 2 characters.
    expect(offered).toHaveLength(6);
    const piles = [...state.players[0].playDeck, ...state.players[0].discardPile, ...state.players[0].sideboard];
    expect(new Set(offered.map(a => `${a.source}:${piles.find(c => c.instanceId === a.cardInstanceId)!.definitionId as string}`))).toEqual(new Set([
      `deck:${BLACK_HIDE_SHIELD as string}`,
      `discard-pile:${SAW_TOOTHED_BLADE as string}`,
      `sideboard:${BLACK_HIDE_SHIELD as string}`,
    ]));
    expect(viableActions(state, PLAYER_1, 'pass')).toHaveLength(1);
  });

  test('two characters each tap to take an item (play deck reshuffled, sideboard); then the card is discarded', () => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: MOUNT_GRAM, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF, MUZGASH, GRISHNAKH], hand: [OLD_CACHE],
      playDeck: [BLACK_HIDE_SHIELD, FOUL_SMELLING_PASTE, BLACK_MAIL_COAT, OLD_TREASURE],
      sideboard: [SAW_TOOTHED_BLADE],
    });
    const declared = dispatch(base, viableActions(base, PLAYER_1, 'play-short-event')[0].action);
    const lagdufId = findCharInstanceId(declared, RESOURCE_PLAYER, LAGDUF);
    const muzgashId = findCharInstanceId(declared, RESOURCE_PLAYER, MUZGASH);
    const grishId = findCharInstanceId(declared, RESOURCE_PLAYER, GRISHNAKH);

    // Pick 1: Lagduf takes the shield from the play deck — deck reshuffled.
    const first = viableActions(declared, PLAYER_1, 'tap-take-item')
      .map(a => a.action as TapTakeItemAction)
      .find(a => a.characterId === lagdufId && a.source === 'deck')!;
    expect(first).toBeDefined();
    const afterFirst = dispatch(declared, first);
    const lagduf = afterFirst.players[0].characters[lagdufId];
    expect(lagduf.status).toBe(CardStatus.Tapped);
    expect(lagduf.items.map(i => i.definitionId)).toEqual([BLACK_HIDE_SHIELD]);
    expect(lagduf.items[0].status).toBe(CardStatus.Untapped);
    expect(afterFirst.players[0].playDeck.map(c => c.definitionId)).not.toContain(BLACK_HIDE_SHIELD);
    expect(afterFirst.players[0].playDeck).toHaveLength(3);
    expect(afterFirst.rng).not.toEqual(declared.rng);
    // Sub-flow still open; Lagduf (now tapped) can no longer pick.
    expect(afterFirst.pendingEffects).toHaveLength(1);
    const secondPicks = viableActions(afterFirst, PLAYER_1, 'tap-take-item').map(a => a.action as TapTakeItemAction);
    expect(secondPicks.some(a => a.characterId === lagdufId)).toBe(false);

    // Pick 2: Muzgash takes the blade from the sideboard.
    const second = secondPicks.find(a => a.characterId === muzgashId && a.source === 'sideboard')!;
    expect(second).toBeDefined();
    const afterSecond = dispatch(afterFirst, second);
    expect(afterSecond.players[0].characters[muzgashId].status).toBe(CardStatus.Tapped);
    expect(afterSecond.players[0].characters[muzgashId].items.map(i => i.definitionId)).toEqual([SAW_TOOTHED_BLADE]);
    expect(afterSecond.players[0].sideboard).toHaveLength(0);

    // At most two characters: the sub-flow closed and Old Cache is discarded,
    // even though Grishnákh is still untapped.
    expect(afterSecond.pendingEffects).toHaveLength(0);
    expect(afterSecond.players[0].characters[grishId].status).toBe(CardStatus.Untapped);
    expect(viableActions(afterSecond, PLAYER_1, 'tap-take-item')).toHaveLength(0);
    expect(afterSecond.players[0].cardsInPlay.some(c => c.definitionId === OLD_CACHE)).toBe(false);
    expectInDiscardPile(afterSecond, RESOURCE_PLAYER, OLD_CACHE);
  });

  test('one character may take an item from the discard pile, then the player stops by passing', () => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: MOUNT_GRAM, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF, MUZGASH], hand: [OLD_CACHE],
      discardPile: [SAW_TOOTHED_BLADE], sideboard: [BLACK_HIDE_SHIELD],
    });
    const declared = dispatch(base, viableActions(base, PLAYER_1, 'play-short-event')[0].action);
    const lagdufId = findCharInstanceId(declared, RESOURCE_PLAYER, LAGDUF);
    const muzgashId = findCharInstanceId(declared, RESOURCE_PLAYER, MUZGASH);

    const pick = viableActions(declared, PLAYER_1, 'tap-take-item')
      .map(a => a.action as TapTakeItemAction)
      .find(a => a.characterId === lagdufId && a.source === 'discard-pile')!;
    const afterPick = dispatch(declared, pick);
    expect(afterPick.players[0].characters[lagdufId].items.map(i => i.definitionId)).toEqual([SAW_TOOTHED_BLADE]);
    expect(afterPick.players[0].discardPile.map(c => c.definitionId)).not.toContain(SAW_TOOTHED_BLADE);

    const afterPass = dispatch(afterPick, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.pendingEffects).toHaveLength(0);
    expect(afterPass.players[0].characters[muzgashId].status).toBe(CardStatus.Untapped);
    expect(afterPass.players[0].characters[muzgashId].items).toHaveLength(0);
    expect(afterPass.players[0].sideboard.map(c => c.definitionId)).toEqual([BLACK_HIDE_SHIELD]);
    expectInDiscardPile(afterPass, RESOURCE_PLAYER, OLD_CACHE);
  });

  test('a non-matching item cannot be taken even if dispatched directly', () => {
    const base = buildSitePhaseState({
      alignment: Alignment.Ringwraith, site: MOUNT_GRAM, siteStatus: CardStatus.Tapped,
      characters: [LAGDUF], hand: [OLD_CACHE], sideboard: [BLACK_HIDE_SHIELD, BLACK_MAIL_COAT],
    });
    const declared = dispatch(base, viableActions(base, PLAYER_1, 'play-short-event')[0].action);
    const lagdufId = findCharInstanceId(declared, RESOURCE_PLAYER, LAGDUF);
    const coat = declared.players[0].sideboard.find(c => c.definitionId === BLACK_MAIL_COAT)!;
    const result = reduce(declared, {
      type: 'tap-take-item', player: PLAYER_1, characterId: lagdufId, cardInstanceId: coat.instanceId, source: 'sideboard',
    });
    expect(result.error).toBeDefined();
    expect(result.state.players[0].characters[lagdufId].items).toHaveLength(0);
  });
});
