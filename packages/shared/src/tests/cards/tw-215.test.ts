/**
 * @module tw-215.test
 *
 * Card test: Dwarven Ring of Drúin's Tribe (tw-215)
 * Type: hero-resource-item (special), unique
 *
 * "Unique. Dwarven Ring. Playable only with a gold ring and after a test
 *  indicates a Dwarven Ring. Values in parentheses and brackets apply to a
 *  Dwarf bearer. Tap a Dwarf bearer to search your play deck for a greater
 *  item playable at the bearer's site. Play this item immediately or
 *  discard; reshuffle the play deck. Bearer makes a corruption check
 *  modified by +2."
 *
 * Printed attributes (data/cards.json TW-215): corruption 3(5), marshalling
 * points 4(6), prowess +2(4), direct influence +2(7) — the parenthesised
 * value applying to a Dwarf bearer, matching the cycle-wide pattern already
 * certified on Dwarven Ring of Bávor's Tribe (tw-214) and Dwarven Ring of
 * Durin's Tribe (tw-216).
 *
 * Engine Support:
 * | # | Rule                                                 | Status      | Notes                                                     |
 * |---|-------------------------------------------------------|-------------|-------------------------------------------------------------|
 * | 1 | +2 prowess (Dwarf bearer +4)                          | IMPLEMENTED | stat-modifier, id/overrides, when bearer.race dwarf         |
 * | 2 | +2 direct influence (Dwarf bearer +7)                 | IMPLEMENTED | stat-modifier, id/overrides, when bearer.race dwarf         |
 * | 3 | 3 corruption points (Dwarf bearer 5)                  | IMPLEMENTED | stat-modifier corruption-points +2 when dwarf                |
 * | 4 | 4 marshalling points (Dwarf bearer 6)                 | IMPLEMENTED | mp-modifier +2 when bearer.race dwarf                        |
 * | 5 | Tap a Dwarf bearer to search play deck for a greater  | IMPLEMENTED | grant-action tw215-search-item, cost tap:bearer,             |
 * |   |   item playable at the bearer's site                  |             |   enqueue-pending-fetch (deck→hand, playableAtBearerSite)    |
 * | 6 | Play this item immediately or discard                 | IMPLEMENTED | mustPlayOrDiscard → play-or-discard-fetched-item pending      |
 * |   |                                                        |             |   resolution (blocks every other action until resolved)      |
 * | 7 | Reshuffle the play deck                                | IMPLEMENTED | fetchShuffle: true (existing fetch-to-deck primitive)        |
 * | 8 | Bearer makes a corruption check modified by +2         | IMPLEMENTED | postCorruptionCheck, deferred until the play-or-discard       |
 * |   |                                                        |             |   choice resolves                                             |
 *
 * Characters used:
 *   GIMLI   (tw-159): dwarf,   prowess 5, body 8
 *   ARAGORN (tw-120): dunadan, prowess 6, body 9
 *
 * Site used: MORIA (hero site, Shadow-hold) — playable resources include
 * minor/major/greater/gold-ring items, so The Mithril-coat (tw-345, subtype
 * "greater") is playable there.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  ARAGORN, GIMLI, LEGOLAS,
  MORIA, LORIEN, MINAS_TIRITH,
  THE_MITHRIL_COAT,
  pool,
  getCharacter, findCharInstanceId, findHandCardId,
  addCardToPlayDeck, attachItemToChar, expectInDiscardPile,
  viableActions, dispatch,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CharacterCard } from '../../index.js';
import type { ActivateGrantedAction } from '../../types/actions-organization.js';

const DWARVEN_RING = 'tw-215' as CardDefinitionId;

/** Build an organization-phase state with `bearer` holding the ring at Moria. */
function stateWithRing(bearer: CardDefinitionId) {
  return recomputeDerived(buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, companies: [{ site: MORIA, characters: [{ defId: bearer, items: [DWARVEN_RING] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  }));
}

/** Build a site-phase state at Moria with the ring already attached to `bearer`, plus `companion`. */
function siteStateWithRing(bearer: CardDefinitionId, companion: CardDefinitionId | null) {
  const base = buildSitePhaseState({
    site: MORIA,
    characters: companion ? [bearer, companion] : [bearer],
    hand: [],
  });
  return attachItemToChar(base, RESOURCE_PLAYER, bearer, DWARVEN_RING);
}

function ringGrants(state: ReturnType<typeof siteStateWithRing>) {
  return viableActions(state, PLAYER_1, 'activate-granted-action')
    .map(ea => ea.action as ActivateGrantedAction)
    .filter(a => a.actionId === 'tw215-search-item');
}

describe("Dwarven Ring of Drúin's Tribe (tw-215)", () => {
  beforeEach(() => resetMint());

  // ── Rule 1: Prowess +2 base, +4 for a Dwarf bearer ─────────────────────────

  test('non-dwarf bearer gets +2 prowess', () => {
    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    expect(aragornDef.race).not.toBe('dwarf');
    const state = stateWithRing(ARAGORN);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(aragornDef.prowess + 2);
  });

  test('dwarf bearer gets +4 prowess', () => {
    const gimliDef = pool[GIMLI as string] as CharacterCard;
    expect(gimliDef.race).toBe('dwarf');
    const state = stateWithRing(GIMLI);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.prowess).toBe(gimliDef.prowess + 4);
  });

  // ── Rule 2: Direct influence +2 base, +7 for a Dwarf bearer ────────────────

  test('non-dwarf bearer gets +2 direct influence', () => {
    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    const state = stateWithRing(ARAGORN);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.directInfluence).toBe(aragornDef.directInfluence + 2);
  });

  test('dwarf bearer gets +7 direct influence', () => {
    const gimliDef = pool[GIMLI as string] as CharacterCard;
    const state = stateWithRing(GIMLI);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.directInfluence).toBe(gimliDef.directInfluence + 7);
  });

  // ── Rule 3: Corruption points 3 base, 5 for a Dwarf bearer ─────────────────

  test('non-dwarf bearer has 3 corruption points from the ring', () => {
    const state = stateWithRing(ARAGORN);
    expect(getCharacter(state, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(3);
  });

  test('dwarf bearer has 5 corruption points from the ring', () => {
    const state = stateWithRing(GIMLI);
    expect(getCharacter(state, RESOURCE_PLAYER, GIMLI).effectiveStats.corruptionPoints).toBe(5);
  });

  // ── Rule 4: Marshalling points 4 base, 6 for a Dwarf bearer ────────────────

  test('non-dwarf bearer: item counts for 4 marshalling points', () => {
    const state = stateWithRing(ARAGORN);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(4);
  });

  test('dwarf bearer: item counts for 6 marshalling points', () => {
    const state = stateWithRing(GIMLI);
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(6);
  });

  // ── Rule 5: grant-action offered only for a Dwarf bearer ───────────────────

  test('search action is NOT offered when bearer is not a Dwarf', () => {
    const state = siteStateWithRing(ARAGORN, null);
    expect(ringGrants(state)).toHaveLength(0);
  });

  test('search action IS offered for a Dwarf bearer', () => {
    const state = siteStateWithRing(GIMLI, ARAGORN);
    const grants = ringGrants(state);
    expect(grants).toHaveLength(1);
    expect(grants[0].characterId).toBe(findCharInstanceId(state, RESOURCE_PLAYER, GIMLI));
  });

  // ── Rules 5–7: activating taps the bearer and enqueues a deck search ──────

  test('activating taps the bearer and enqueues a deck-only fetch to hand, playable at Moria, must-play-or-discard', () => {
    let state = siteStateWithRing(GIMLI, ARAGORN);
    state = addCardToPlayDeck(state, RESOURCE_PLAYER, THE_MITHRIL_COAT);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const grant = ringGrants(state)[0];

    const after = dispatch(state, grant);

    expect(after.players[RESOURCE_PLAYER].characters[gimliId].status).toBe(CardStatus.Tapped);
    expect(after.pendingEffects).toHaveLength(1);
    const effect = (after.pendingEffects[0] as {
      effect: { type: string; source: readonly string[]; to?: string; playableAtSite?: string; mustPlayOrDiscard?: boolean };
    }).effect;
    expect(effect.type).toBe('fetch-to-deck');
    expect(effect.source).toEqual(['deck']);
    expect(effect.to).toBe('hand');
    expect(effect.playableAtSite).toBe(MORIA);
    expect(effect.mustPlayOrDiscard).toBe(true);

    // Only the greater item (The Mithril-coat) matches — deck has nothing else.
    const fetchActions = computeLegalActions(after, PLAYER_1).filter(ea => ea.viable && ea.action.type === 'fetch-from-pile');
    expect(fetchActions).toHaveLength(1);
    const mithrilInstance = after.players[RESOURCE_PLAYER].playDeck.find(c => c.definitionId === THE_MITHRIL_COAT)!;
    expect((fetchActions[0].action as { cardInstanceId: string }).cardInstanceId).toBe(mithrilInstance.instanceId as unknown as string);
  });

  // ── Rule 6: found item must be played immediately or discarded ────────────

  function afterSearchFound(): ReturnType<typeof siteStateWithRing> {
    let state = siteStateWithRing(GIMLI, ARAGORN);
    state = addCardToPlayDeck(state, RESOURCE_PLAYER, THE_MITHRIL_COAT);
    const grant = ringGrants(state)[0];
    const afterActivate = dispatch(state, grant);
    const fetchAction = computeLegalActions(afterActivate, PLAYER_1)
      .find(ea => ea.viable && ea.action.type === 'fetch-from-pile')!.action;
    return dispatch(afterActivate, fetchAction);
  }

  test('the found item lands in hand and blocks every other action until played or discarded', () => {
    const after = afterSearchFound();
    expect(after.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === THE_MITHRIL_COAT)).toBe(true);

    // No immediate corruption check yet — it is deferred until the choice resolves.
    expect(after.pendingResolutions.some(r => r.kind.type === 'corruption-check')).toBe(false);
    const blocking = after.pendingResolutions.find(r => r.kind.type === 'play-or-discard-fetched-item');
    expect(blocking).toBeDefined();
    const mithrilId = findHandCardId(after, RESOURCE_PLAYER, THE_MITHRIL_COAT);
    if (blocking && blocking.kind.type === 'play-or-discard-fetched-item') {
      expect(blocking.kind.cardInstanceId).toBe(mithrilId);
    }

    // Every viable action is either playing or discarding that one card —
    // nothing else (including `pass`) is offered.
    const allViable = computeLegalActions(after, PLAYER_1).filter(ea => ea.viable);
    expect(allViable.length).toBeGreaterThan(0);
    for (const ea of allViable) {
      expect(['play-hero-resource', 'discard-card']).toContain(ea.action.type);
      expect((ea.action as { cardInstanceId?: unknown }).cardInstanceId).toBe(mithrilId);
    }
    expect(allViable.some(ea => ea.action.type === 'discard-card')).toBe(true);
    // Aragorn (untapped, unlike the tapped bearer) may receive the item.
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    expect(allViable.some(ea => ea.action.type === 'play-hero-resource'
      && (ea.action as { attachToCharacterId?: unknown }).attachToCharacterId === aragornId)).toBe(true);
  });

  test('playing the found item attaches it, clears the block, and enqueues the +2 corruption check on the bearer', () => {
    const after = afterSearchFound();
    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);
    const aragornId = findCharInstanceId(after, RESOURCE_PLAYER, ARAGORN);
    const mithrilId = findHandCardId(after, RESOURCE_PLAYER, THE_MITHRIL_COAT);
    const playAction = computeLegalActions(after, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'play-hero-resource'
        && (ea.action as { cardInstanceId?: unknown }).cardInstanceId === mithrilId
        && (ea.action as { attachToCharacterId?: unknown }).attachToCharacterId === aragornId,
    )!.action;

    const afterPlay = dispatch(after, playAction);

    expect(afterPlay.players[RESOURCE_PLAYER].characters[aragornId].items
      .some(i => i.definitionId === THE_MITHRIL_COAT)).toBe(true);
    expect(afterPlay.pendingResolutions.some(r => r.kind.type === 'play-or-discard-fetched-item')).toBe(false);

    const cc = afterPlay.pendingResolutions.find(r => r.kind.type === 'corruption-check');
    expect(cc).toBeDefined();
    if (cc && cc.kind.type === 'corruption-check') {
      expect(cc.kind.characterId).toBe(gimliId);
      expect(cc.kind.modifier).toBe(2);
    }
  });

  test('discarding the found item instead of playing it clears the block and still enqueues the +2 corruption check', () => {
    const after = afterSearchFound();
    const gimliId = findCharInstanceId(after, RESOURCE_PLAYER, GIMLI);
    const mithrilId = findHandCardId(after, RESOURCE_PLAYER, THE_MITHRIL_COAT);
    const discardAction = computeLegalActions(after, PLAYER_1).find(
      ea => ea.viable && ea.action.type === 'discard-card'
        && (ea.action as { cardInstanceId?: unknown }).cardInstanceId === mithrilId,
    )!.action;

    const afterDiscard = dispatch(after, discardAction);

    expect(afterDiscard.players[RESOURCE_PLAYER].hand.some(c => c.definitionId === THE_MITHRIL_COAT)).toBe(false);
    expectInDiscardPile(afterDiscard, RESOURCE_PLAYER, THE_MITHRIL_COAT);
    expect(afterDiscard.pendingResolutions.some(r => r.kind.type === 'play-or-discard-fetched-item')).toBe(false);

    const cc = afterDiscard.pendingResolutions.find(r => r.kind.type === 'corruption-check');
    expect(cc).toBeDefined();
    if (cc && cc.kind.type === 'corruption-check') {
      expect(cc.kind.characterId).toBe(gimliId);
      expect(cc.kind.modifier).toBe(2);
    }
  });

  // ── Rule 7: reshuffle happens even when the search comes up empty ─────────

  test('an empty search still reshuffles and fires the corruption check immediately, with no blocking resolution', () => {
    const state = siteStateWithRing(GIMLI, ARAGORN);
    const gimliId = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const grant = ringGrants(state)[0];
    const afterActivate = dispatch(state, grant);

    // No greater item in the deck — only `pass` is offered to skip the search.
    const legalDuringSearch = computeLegalActions(afterActivate, PLAYER_1).filter(ea => ea.viable);
    expect(legalDuringSearch.every(ea => ea.action.type === 'pass')).toBe(true);
    const passAction = legalDuringSearch.find(ea => ea.action.type === 'pass')!.action;

    const afterPass = dispatch(afterActivate, passAction);

    expect(afterPass.pendingResolutions.some(r => r.kind.type === 'play-or-discard-fetched-item')).toBe(false);
    const cc = afterPass.pendingResolutions.find(r => r.kind.type === 'corruption-check');
    expect(cc).toBeDefined();
    if (cc && cc.kind.type === 'corruption-check') {
      expect(cc.kind.characterId).toBe(gimliId);
      expect(cc.kind.modifier).toBe(2);
    }
  });

  // ── Playability ─────────────────────────────────────────────────────────

  test('cannot be played as an ordinary item at a site (special subtype, gold-ring only)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [GIMLI],
      hand: [DWARVEN_RING],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays.filter(a => (a.action as { cardInstanceId?: string }).cardInstanceId
      === state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === DWARVEN_RING)?.instanceId)).toHaveLength(0);
  });
});
