/**
 * @module le-332.test
 *
 * Card test: Palantír of Elostirion (le-332)
 * Type: minion-resource-item (special, palantír), alignment ringwraith, unique.
 * Marshalling Points: 3. Corruption Points: 3.
 *
 * "Unique. Palantír. Playable at The White Towers. Discard if the bearer
 *  moves. If the bearer is a sage: your hand size increases by one and the
 *  bearer is able to use this Palantír this turn if he taps. With its bearer
 *  able to use a Palantír, tap Palantír of Elostirion to draw a card. Bearer
 *  then makes a corruption check. This item does not give MPs to a
 *  Fallen-wizard regardless of other cards in play."
 *
 * Effects & engine support:
 * | # | Rule                                          | Mechanism                                                        |
 * |---|-----------------------------------------------|------------------------------------------------------------------|
 * | 1 | Playable at The White Towers                  | item-play-site sites=["The White Towers"] (minion copy: le-412)  |
 * | 2 | Discard if the bearer moves                   | on-event bearer-company-moves → move self to discard             |
 * | 3 | Sage bearer: hand size +1                     | hand-size-modifier value 1, when bearer.skills $includes sage     |
 * | 4 | Sage bearer taps → may use *this* Palantír    | grant-action palantir-elostirion-focus, cost { tap: "bearer" },  |
 * |   |   this turn                                   |   apply add-constraint can-use-palantir (turn, target bearer)    |
 * | 5 | Bearer able to use a Palantír: tap to draw     | grant-action palantir-draw-card, cost { tap: "self" },           |
 * |   |                                               |   when bearer.canUsePalantir, apply draw-cards count 1           |
 * | 6 | Bearer then makes a corruption check           | enqueue-corruption-check in the same sequence apply               |
 * | 7 | No MPs to a Fallen-wizard, regardless of      | fw-mp-none — checked before the §4 clamp, its `fw-item-mp-full`  |
 * |   |   other cards in play                         |   exemptions, and every MP override/pin                          |
 *
 * The `can-use-palantir` constraint is keyed to the card instance that placed
 * it, so focusing this Palantír never enables a *different* Palantír the same
 * character bears ("able to use **this** Palantír").
 *
 * Fixtures are minion (LE) throughout: Layos (le-19) is a minion sage with no
 * native Palantír ability (so he must tap to focus), Calendal (le-4) is a
 * minion sage who "may tap to use a Palantír he bears" (`can-use-palantir`
 * play-flag), and Luitprand (le-23) is a minion non-sage.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  Phase, CardStatus, Alignment,
  CardDefinitionId,
  buildTestState, buildMinionSitePhaseState, resetMint,
  viableActions, dispatch, makePlayDeck, makeMHState,
  findCharInstanceId, getCharacter,
} from '../test-helpers.js';
import type { ActivateGrantedAction, GameState } from '../../index.js';
import { HAND_SIZE } from '../../constants.js';
import { resolveHandSize } from '../../engine/effects/index.js';

const PALANTIR_ELOSTIRION = 'le-332' as CardDefinitionId;
const PALANTIR_ORTHANC    = 'le-334' as CardDefinitionId; // second Palantír (fetch-discard ability)
const LAYOS               = 'le-19'  as CardDefinitionId; // minion sage, no Palantír ability
const CALENDAL            = 'le-4'   as CardDefinitionId; // minion sage, may tap to use a Palantír
const LUITPRAND           = 'le-23'  as CardDefinitionId; // minion scout, not a sage
const WHITE_TOWERS        = 'le-412' as CardDefinitionId; // minion ruins-and-lairs, Arthedain
const DOL_GULDUR          = 'le-367' as CardDefinitionId; // minion dark-hold
const MINAS_MORGUL        = 'le-390' as CardDefinitionId; // minion darkhaven
const SARUMAN_FW          = 'wh-9'   as CardDefinitionId; // FW avatar with fw-item-mp-full
const ARAGORN             = 'tw-11'  as CardDefinitionId; // hero character (FW company filler)
const LEGOLAS             = 'tw-104' as CardDefinitionId;
const RIVENDELL           = 'tw-419' as CardDefinitionId;
const LORIEN              = 'tw-406' as CardDefinitionId;
const ISENGARD            = 'tw-403' as CardDefinitionId;

/** Minion organization-phase state with `bearer` holding the given items. */
function buildOrgState(opts: {
  bearer?: CardDefinitionId;
  items?: CardDefinitionId[];
  discardPile?: CardDefinitionId[];
}): GameState {
  return buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    recompute: true,
    players: [
      {
        id: PLAYER_1,
        alignment: Alignment.Ringwraith,
        companies: [{
          site: DOL_GULDUR,
          characters: [{ defId: opts.bearer ?? LAYOS, items: opts.items ?? [PALANTIR_ELOSTIRION] }],
        }],
        hand: [],
        siteDeck: [MINAS_MORGUL],
        playDeck: makePlayDeck(),
        discardPile: opts.discardPile ?? [MINAS_MORGUL],
      },
      { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [] }], hand: [], siteDeck: [DOL_GULDUR] },
    ],
  });
}

/** All viable `activate-granted-action` actions carrying the given action id. */
function grantActions(state: GameState, actionId: string): ActivateGrantedAction[] {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === actionId);
}

describe('Palantír of Elostirion (le-332)', () => {
  beforeEach(() => resetMint());

  // ── Effect 1: item-play-site (The White Towers) ──

  test('playable at The White Towers during the minion site phase', () => {
    const state = buildMinionSitePhaseState({
      site: WHITE_TOWERS,
      characters: [LAYOS],
      hand: [PALANTIR_ELOSTIRION],
    });

    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(1);
  });

  test('reducer attaches the item to the bearer at The White Towers', () => {
    const state = buildMinionSitePhaseState({
      site: WHITE_TOWERS,
      characters: [LAYOS],
      hand: [PALANTIR_ELOSTIRION],
    });

    const play = viableActions(state, PLAYER_1, 'play-hero-resource')[0];
    const next = dispatch(state, play.action);

    const char = Object.values(next.players[0].characters)[0];
    expect(char.items.some(i => i.definitionId === PALANTIR_ELOSTIRION)).toBe(true);
    expect(next.players[0].hand.some(c => c.definitionId === PALANTIR_ELOSTIRION)).toBe(false);
  });

  test('NOT playable at another minion site (Dol Guldur)', () => {
    const state = buildMinionSitePhaseState({
      site: DOL_GULDUR,
      characters: [LAYOS],
      hand: [PALANTIR_ELOSTIRION],
    });

    expect(viableActions(state, PLAYER_1, 'play-hero-resource').length).toBe(0);
  });

  // ── Effect 2: discard if the bearer moves ──

  test('discarded when the bearer’s company moves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: LAYOS, items: [PALANTIR_ELOSTIRION] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const dest = base.players[0].siteDeck[0];
    const withDest: GameState = {
      ...base,
      players: [
        {
          ...base.players[0],
          companies: [{
            ...base.players[0].companies[0],
            destinationSite: { instanceId: dest.instanceId, definitionId: dest.definitionId, status: CardStatus.Untapped },
          }],
        },
        base.players[1],
      ] as typeof base.players,
      phaseState: makeMHState({ activeCompanyIndex: 0 }),
    };

    const layosId = findCharInstanceId(withDest, RESOURCE_PLAYER, LAYOS);
    expect(getCharacter(withDest, RESOURCE_PLAYER, LAYOS).items.length).toBe(1);

    const afterMove = dispatch(dispatch(withDest, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterMove.players[0].characters[layosId].items.some(i => i.definitionId === PALANTIR_ELOSTIRION)).toBe(false);
    expect(afterMove.players[0].discardPile.some(c => c.definitionId === PALANTIR_ELOSTIRION)).toBe(true);
  });

  test('NOT discarded when the company stays put', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [{ defId: LAYOS, items: [PALANTIR_ELOSTIRION] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
          playDeck: makePlayDeck(),
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const stateAtMH: GameState = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const layosId = findCharInstanceId(stateAtMH, RESOURCE_PLAYER, LAYOS);
    const afterPasses = dispatch(dispatch(stateAtMH, { type: 'pass', player: PLAYER_1 }), { type: 'pass', player: PLAYER_2 });

    expect(afterPasses.players[0].characters[layosId].items.some(i => i.definitionId === PALANTIR_ELOSTIRION)).toBe(true);
  });

  // ── Effect 3: sage bearer increases hand size by one ──

  test('hand size is one higher while a sage bears the Palantír', () => {
    const state = buildOrgState({ bearer: LAYOS });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE + 1);
    // The opponent, who bears nothing, keeps the base hand size.
    expect(resolveHandSize(state, 1)).toBe(HAND_SIZE);
  });

  test('hand size is unchanged while a non-sage bears the Palantír', () => {
    const state = buildOrgState({ bearer: LUITPRAND });

    expect(resolveHandSize(state, RESOURCE_PLAYER)).toBe(HAND_SIZE);
  });

  // ── Effect 4: sage taps to become able to use this Palantír ──

  test('a sage bearer may tap to focus the Palantír', () => {
    const state = buildOrgState({ bearer: LAYOS });

    expect(grantActions(state, 'palantir-elostirion-focus').length).toBe(1);
  });

  test('a non-sage bearer may NOT tap to focus the Palantír', () => {
    const state = buildOrgState({ bearer: LUITPRAND });

    expect(grantActions(state, 'palantir-elostirion-focus').length).toBe(0);
  });

  test('focusing taps the bearer and makes him able to use this Palantír', () => {
    const state = buildOrgState({ bearer: LAYOS });
    const layosId = findCharInstanceId(state, RESOURCE_PLAYER, LAYOS);

    const after = dispatch(state, grantActions(state, 'palantir-elostirion-focus')[0]);

    expect(after.players[0].characters[layosId].status).toBe(CardStatus.Tapped);
    const constraint = after.activeConstraints.find(c => c.kind.type === 'can-use-palantir');
    expect(constraint).toBeDefined();
    expect(constraint!.target).toEqual({ kind: 'character', characterId: layosId });
    // The item itself stays untapped — only the bearer paid.
    expect(after.players[0].characters[layosId].items[0].status).toBe(CardStatus.Untapped);
  });

  // ── Effect 5/6: tap the Palantír to draw a card, then corruption check ──

  test('draw ability is NOT offered before a plain sage focuses the Palantír', () => {
    const state = buildOrgState({ bearer: LAYOS });

    expect(grantActions(state, 'palantir-draw-card').length).toBe(0);
  });

  test('draw ability IS offered once the sage has focused the Palantír', () => {
    const state = buildOrgState({ bearer: LAYOS });
    const afterFocus = dispatch(state, grantActions(state, 'palantir-elostirion-focus')[0]);

    expect(grantActions(afterFocus, 'palantir-draw-card').length).toBe(1);
  });

  test('draw ability is offered immediately to a bearer who can already use a Palantír', () => {
    const state = buildOrgState({ bearer: CALENDAL });

    expect(grantActions(state, 'palantir-draw-card').length).toBe(1);
  });

  test('draw ability is NOT offered to a non-sage who cannot use a Palantír', () => {
    const state = buildOrgState({ bearer: LUITPRAND });

    expect(grantActions(state, 'palantir-draw-card').length).toBe(0);
  });

  test('draw ability is NOT offered while the Palantír is tapped', () => {
    const state = buildOrgState({ bearer: CALENDAL });
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, CALENDAL);
    const char = state.players[0].characters[charId];
    const tapped: GameState = {
      ...state,
      players: [
        {
          ...state.players[0],
          characters: {
            ...state.players[0].characters,
            [charId as string]: { ...char, items: [{ ...char.items[0], status: CardStatus.Tapped }] },
          },
        },
        state.players[1],
      ] as typeof state.players,
    };

    expect(grantActions(tapped, 'palantir-draw-card').length).toBe(0);
  });

  test('tapping the Palantír draws one card and enqueues the bearer’s corruption check', () => {
    const state = buildOrgState({ bearer: CALENDAL });
    const charId = findCharInstanceId(state, RESOURCE_PLAYER, CALENDAL);
    const handBefore = state.players[0].hand.length;
    const deckBefore = state.players[0].playDeck;
    const topCard = deckBefore[0];

    const after = dispatch(state, grantActions(state, 'palantir-draw-card')[0]);

    // Top card of the play deck moved into hand.
    expect(after.players[0].hand.length).toBe(handBefore + 1);
    expect(after.players[0].hand.some(c => c.instanceId === topCard.instanceId)).toBe(true);
    expect(after.players[0].playDeck.length).toBe(deckBefore.length - 1);

    // The item paid the cost; the bearer did not tap.
    expect(after.players[0].characters[charId].items[0].status).toBe(CardStatus.Tapped);
    expect(after.players[0].characters[charId].status).toBe(CardStatus.Untapped);

    // Bearer's corruption check is pending.
    const pending = after.pendingResolutions.filter(r => r.actor === PLAYER_1);
    expect(pending.length).toBe(1);
    expect(pending[0].kind.type).toBe('corruption-check');
  });

  test('drawing stops at deck exhaustion instead of inventing a card', () => {
    const state = buildOrgState({ bearer: CALENDAL });
    const emptyDeck: GameState = {
      ...state,
      players: [{ ...state.players[0], playDeck: [] }, state.players[1]] as typeof state.players,
    };
    const handBefore = emptyDeck.players[0].hand.length;

    const after = dispatch(emptyDeck, grantActions(emptyDeck, 'palantir-draw-card')[0]);

    expect(after.players[0].hand.length).toBe(handBefore);
    expect(after.players[0].playDeck.length).toBe(0);
    // The tap and the corruption check still happened.
    const charId = findCharInstanceId(after, RESOURCE_PLAYER, CALENDAL);
    expect(after.players[0].characters[charId].items[0].status).toBe(CardStatus.Tapped);
    expect(after.pendingResolutions.filter(r => r.kind.type === 'corruption-check').length).toBe(1);
  });

  test('focusing enables only THIS Palantír, not another one the bearer holds', () => {
    const state = buildOrgState({ bearer: LAYOS, items: [PALANTIR_ELOSTIRION, PALANTIR_ORTHANC] });
    // Neither Palantír is usable yet.
    expect(grantActions(state, 'palantir-draw-card').length).toBe(0);
    expect(grantActions(state, 'palantir-fetch-discard').length).toBe(0);

    const afterFocus = dispatch(state, grantActions(state, 'palantir-elostirion-focus')[0]);

    // Elostirion's own ability is now available; Orthanc's is not.
    expect(grantActions(afterFocus, 'palantir-draw-card').length).toBe(1);
    expect(grantActions(afterFocus, 'palantir-fetch-discard').length).toBe(0);
  });

  test('control: a bearer able to use any Palantír can use both of them', () => {
    // Same two-Palantír fixture, but the bearer's own `can-use-palantir` flag
    // is not card-scoped — so Orthanc's ability is offered here, proving the
    // previous test's negative is about the constraint's scope, not the fixture.
    const state = buildOrgState({ bearer: CALENDAL, items: [PALANTIR_ELOSTIRION, PALANTIR_ORTHANC] });

    expect(grantActions(state, 'palantir-draw-card').length).toBe(1);
    expect(grantActions(state, 'palantir-fetch-discard').length).toBe(1);
  });

  // ── Effect 7: no marshalling points to a Fallen-wizard ──

  test('a Ringwraith player scores the printed 3 item MP', () => {
    const state = buildOrgState({ bearer: LAYOS });

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(3);
  });

  test('a Fallen-wizard scores no MP for it, even with Saruman in play', () => {
    // Saruman's `fw-item-mp-full` would otherwise exempt this (non-weapon)
    // item from the MEWH §4 clamp and score its full 3 MP.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [SARUMAN_FW, { defId: ARAGORN, items: [PALANTIR_ELOSTIRION] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(0);
  });

  test('a Fallen-wizard without Saruman scores no MP for it either (not even the §4 flat 1)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.FallenWizard,
          companies: [{ site: ISENGARD, characters: [{ defId: ARAGORN, items: [PALANTIR_ELOSTIRION] }] }],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [LORIEN] },
      ],
    });

    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(0);
  });
});
