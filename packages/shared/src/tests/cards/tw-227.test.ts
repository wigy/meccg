/**
 * @module tw-227.test
 *
 * Card test: Ent-draughts (tw-227)
 * Type: hero-resource-item (special), alignment wizard, non-unique. MP 0,
 * corruption points 0. Structural `prowessModifier: 1`.
 *
 * "Only playable at Wellinghall in addition to an ally or faction that has
 *  been successfully played at Wellinghall this turn. +1 to prowess. This
 *  item may not be stolen, transferred, or stored. Cannot be duplicated on a
 *  given character."
 *
 * Effects & engine support:
 * | # | Rule                                              | Mechanism                                                        |
 * |---|----------------------------------------------------|------------------------------------------------------------------|
 * | 1 | Only playable at Wellinghall                      | `item-play-site` `sites: ["Wellinghall"]`, `allowTapped: true`   |
 * |   |                                                    | (the qualifying ally/faction play normally taps the site itself, |
 * |   |                                                    | so this item must tolerate a tapped site — "in addition to")     |
 * | 2 | …in addition to an ally or faction successfully    | `play-condition` `requires: "active-company"`,                   |
 * |   | played at Wellinghall this turn                    | `condition: { "company.allyOrFactionPlayedAtSite": true }` —     |
 * |   |                                                    | `SitePhaseState.allyOrFactionPlayedAtSite`, set in                |
 * |   |                                                    | `handleSitePlayHeroResource` (ally) and the influence-attempt     |
 * |   |                                                    | success branch (faction) in `reducer-site.ts`                     |
 * | 3 | +1 to prowess                                      | structural `prowessModifier: 1` (no competing `stat-modifier`     |
 * |   |                                                    | effect, so the legacy field applies per `recompute-derived.ts`)  |
 * | 4 | May not be transferred                             | `play-flag: "no-transfer"` — `transferItemActions` skips it,     |
 * |   |                                                    | `handleTransferItem` rejects it as a reducer-level backstop       |
 * | 5 | May not be stored                                  | `play-flag: "no-store"` — `storeItemActions` skips it,           |
 * |   |                                                    | `handleStoreItem` rejects it as a reducer-level backstop          |
 * | 6 | Cannot be duplicated on a given character          | `duplication-limit` `scope: "character"`, `max: 1`               |
 *
 * "May not be stolen" has no engine counterpart to gate: no card or mechanic
 * in this codebase moves an item from one player's control to another's
 * without the owning player's consent (item transfer/storage are the only
 * ways an item changes hands, and both are already blocked above), so the
 * rule is vacuously satisfied by the absence of any such mechanism.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, BILBO, LEGOLAS, WELLINGHALL, LORIEN, RIVENDELL, MINAS_TIRITH,
  buildSitePhaseState, buildTestState, resetMint,
  viableActions, viableActionsForHandCard,
  findCharInstanceId,
  getCharacter, attachItemToChar,
  dispatch, pool,
} from '../test-helpers.js';
import type {
  CardDefinitionId, GameState, SitePhaseState,
  PlayHeroResourceAction, TransferItemAction, StoreItemAction,
  CharacterCard,
} from '../../index.js';
import { Phase } from '../../index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { resolveInfluenceAttemptRoll } from '../../engine/reducer-site.js';

const ENT_DRAUGHTS = 'tw-227' as CardDefinitionId;
/** Ally playable at Wellinghall (tw-307), no bearer-race restriction. */
const QUICKBEAM = 'tw-307' as CardDefinitionId;
/** Unique hero faction playable at Wellinghall (tw-228), influence# 10. */
const ENTS_OF_FANGORN = 'tw-228' as CardDefinitionId;
/** Ordinary transferable/storable major item, for contrast. */
const GLAMDRING = 'tw-244' as CardDefinitionId;

/** Force the active company's "ally or faction played at this site" window open. */
function openAllyOrFactionWindow(state: GameState): GameState {
  const siteState = state.phaseState as SitePhaseState;
  return { ...state, phaseState: { ...siteState, allyOrFactionPlayedAtSite: true } };
}

describe('Ent-draughts (tw-227)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1 + 2: site restriction + "in addition to" play-condition ──

  test('NOT playable at Wellinghall before any ally/faction has been played this turn', () => {
    const state = buildSitePhaseState({ site: WELLINGHALL, characters: [ARAGORN], hand: [ENT_DRAUGHTS] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, ENT_DRAUGHTS)).toHaveLength(0);
  });

  test('playable at Wellinghall once the ally-or-faction window is open', () => {
    const base = buildSitePhaseState({ site: WELLINGHALL, characters: [ARAGORN], hand: [ENT_DRAUGHTS] });
    const state = openAllyOrFactionWindow(base);
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, ENT_DRAUGHTS)).toHaveLength(1);
  });

  test('NOT playable at a different Haven even with the window open (site restriction still applies)', () => {
    const base = buildSitePhaseState({ site: LORIEN, characters: [ARAGORN], hand: [ENT_DRAUGHTS] });
    const state = openAllyOrFactionWindow(base);
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, ENT_DRAUGHTS)).toHaveLength(0);
  });

  // ── Rule 2: real ally flow opens the window (and the tapped site is tolerated) ──

  test('playing Quickbeam (ally) at Wellinghall opens the window for Ent-draughts, despite tapping the site', () => {
    const state = buildSitePhaseState({
      site: WELLINGHALL,
      characters: [ARAGORN, BILBO],
      hand: [QUICKBEAM, ENT_DRAUGHTS],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);

    // Not playable yet.
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, ENT_DRAUGHTS)).toHaveLength(0);

    const quickbeamAction = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, QUICKBEAM)
      .find(ea => (ea.action as PlayHeroResourceAction).attachToCharacterId === aragornId)!.action;
    const afterAlly = dispatch(state, quickbeamAction);

    // Quickbeam's bearer and the site both tapped.
    expect(getCharacter(afterAlly, RESOURCE_PLAYER, ARAGORN).status).toBe('tapped');
    expect(afterAlly.players[RESOURCE_PLAYER].companies[0].currentSite?.status).toBe('tapped');
    expect((afterAlly.phaseState as SitePhaseState).allyOrFactionPlayedAtSite).toBe(true);

    // Ent-draughts is now playable on the other (still untapped) character,
    // despite the site being tapped — `allowTapped` on its item-play-site effect.
    const entActions = viableActionsForHandCard(afterAlly, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, ENT_DRAUGHTS);
    expect(entActions).toHaveLength(1);
    const bilboId = findCharInstanceId(afterAlly, RESOURCE_PLAYER, BILBO);
    expect((entActions[0].action as PlayHeroResourceAction).attachToCharacterId).toBe(bilboId);

    const afterItem = dispatch(afterAlly, entActions[0].action);
    expect(getCharacter(afterItem, RESOURCE_PLAYER, BILBO).items.map(i => i.definitionId)).toEqual([ENT_DRAUGHTS]);
  });

  // ── Rule 2: real faction flow also opens the window ──

  test('a successful faction influence attempt at Wellinghall opens the window', () => {
    const base = buildSitePhaseState({ site: WELLINGHALL, characters: [ARAGORN], hand: [ENTS_OF_FANGORN] });
    const factionCard = base.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === ENTS_OF_FANGORN)!;
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    const result = resolveInfluenceAttemptRoll(
      { ...base, cheatRollTotal: 12 }, // 12 >= influence# 10 → success
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: aragornId } },
    );

    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === ENTS_OF_FANGORN)).toBe(true);
    expect((result.state.phaseState as SitePhaseState).allyOrFactionPlayedAtSite).toBe(true);
  });

  test('a failed faction influence attempt does NOT open the window', () => {
    const base = buildSitePhaseState({ site: WELLINGHALL, characters: [ARAGORN], hand: [ENTS_OF_FANGORN] });
    const factionCard = base.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === ENTS_OF_FANGORN)!;
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);

    const result = resolveInfluenceAttemptRoll(
      { ...base, cheatRollTotal: 2 }, // 2 < influence# 10 → failure
      { card: factionCard, declaredBy: PLAYER_1, payload: { type: 'influence-attempt', influencingCharacterId: aragornId } },
    );

    expect(result.state.players[RESOURCE_PLAYER].cardsInPlay.some(c => c.definitionId === ENTS_OF_FANGORN)).toBe(false);
    expect((result.state.phaseState as SitePhaseState).allyOrFactionPlayedAtSite).toBeFalsy();
  });

  // ── Rule 3: +1 prowess (structural prowessModifier field) ──

  test('grants +1 prowess to the bearer', () => {
    const base = buildSitePhaseState({ site: WELLINGHALL, characters: [ARAGORN], hand: [] });
    const state = recomputeDerived(attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, ENT_DRAUGHTS));
    const baseProwess = (pool[ARAGORN as string] as CharacterCard).prowess;
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(baseProwess + 1);
  });

  // ── Rule 4: may not be transferred ──

  test('is NOT offered by transfer-item, unlike an ordinary item on the same character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO] }], hand: [], siteDeck: [WELLINGHALL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGlamdring = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, GLAMDRING);
    const state = recomputeDerived(attachItemToChar(withGlamdring, RESOURCE_PLAYER, ARAGORN, ENT_DRAUGHTS));

    const glamdringId = state.players[RESOURCE_PLAYER].characters[findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN)]
      .items.find(i => i.definitionId === GLAMDRING)!.instanceId;
    const entId = state.players[RESOURCE_PLAYER].characters[findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN)]
      .items.find(i => i.definitionId === ENT_DRAUGHTS)!.instanceId;

    const transfers = viableActions(state, PLAYER_1, 'transfer-item').map(ea => ea.action as TransferItemAction);
    expect(transfers.some(a => a.itemInstanceId === glamdringId)).toBe(true);
    expect(transfers.some(a => a.itemInstanceId === entId)).toBe(false);
  });

  // ── Rule 5: may not be stored ──

  test('is NOT offered by store-item, unlike an ordinary item on the same character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [WELLINGHALL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withGlamdring = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, GLAMDRING);
    const state = recomputeDerived(attachItemToChar(withGlamdring, RESOURCE_PLAYER, ARAGORN, ENT_DRAUGHTS));

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const glamdringId = state.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === GLAMDRING)!.instanceId;
    const entId = state.players[RESOURCE_PLAYER].characters[aragornId].items.find(i => i.definitionId === ENT_DRAUGHTS)!.instanceId;

    const stores = viableActions(state, PLAYER_1, 'store-item').map(ea => ea.action as StoreItemAction);
    expect(stores.some(a => a.itemInstanceId === glamdringId)).toBe(true);
    expect(stores.some(a => a.itemInstanceId === entId)).toBe(false);
  });

  // ── Rule 6: cannot be duplicated on a given character ──

  test('cannot be duplicated on a character already bearing one, but may be played on another', () => {
    const base = buildSitePhaseState({
      site: WELLINGHALL,
      characters: [ARAGORN, BILBO],
      hand: [ENT_DRAUGHTS],
    });
    const withFirst = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, ENT_DRAUGHTS);
    const state = openAllyOrFactionWindow(withFirst);

    const actions = viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, ENT_DRAUGHTS);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboId = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);

    expect(actions.some(a => (a.action as PlayHeroResourceAction).attachToCharacterId === aragornId)).toBe(false);
    expect(actions.some(a => (a.action as PlayHeroResourceAction).attachToCharacterId === bilboId)).toBe(true);
  });
});
