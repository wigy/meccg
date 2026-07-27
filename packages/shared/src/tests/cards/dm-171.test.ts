/**
 * @module dm-171.test
 *
 * Card test: Leaf Brooch (dm-171)
 * Type: hero-resource-item (special), alignment wizard, non-unique.
 * Marshalling Points: 0. Corruption Points: 1.
 *
 * "Only playable at Lórien. If a non-special item must be discarded from the
 *  company of Leaf Brooch's bearer (according to any hazard or resource
 *  effect), you may discard Leaf Brooch instead to fulfill this requirement."
 *
 * Effects & engine support:
 * | # | Rule                                             | Mechanism                                                    |
 * |---|--------------------------------------------------|--------------------------------------------------------------|
 * | 1 | Only playable at Lórien                          | `item-play-site` `sites: ["Lórien"]`                         |
 * | 2 | A non-special item the bearer's company must      | `discard-substitute` `scope: "company"`, filter               |
 * |   | discard may be swapped for the brooch            | `{ subtype: { $ne: "special" } }`, resolved through the       |
 * |   |                                                  | `discard-substitute-offer` pending resolution                 |
 *
 * The substitution is a replacement effect, so it is exercised through the
 * forced-discard paths the card text names — discards demanded by a hazard or
 * resource effect:
 *
 * - Brigands (tw-17) `discard-one-company-item` — one item leaves the company;
 * - "Bert" (tw-016) after "William" — every non-special item is stripped off a
 *   wounded character at once;
 * - the gold-ring test (Rule 9.21), where CRF 22 rules that the *gold ring's*
 *   bearer still receives the special ring item, not the brooch's bearer.
 *
 * A requirement phrased as "discard one item of the defender's choice" needs no
 * replacement machinery of its own — the brooch is itself an item in the
 * company, so naming it already fulfils the requirement. What the card adds is
 * the ability to keep an item the effect (or the opponent) has already singled
 * out.
 *
 * Playable: YES.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, LEGOLAS,
  GLAMDRING, DAGGER_OF_WESTERNESSE,
  BERT_BURAT, WILLIAM_WULUAG,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, buildSitePhaseState, resetMint,
  makeBorderMHState, makeMHState,
  playCreatureHazardAndResolve, runCreatureCombat,
  handCardId, companyIdAt, executeAction, dispatch,
  viableActions, findCharInstanceId, findItemInstanceId,
  getCharacter, expectCharItemCount, expectInDiscardPile, expectNotInDiscardPile,
  attachItemToChar, enqueueGoldRingTest,
} from '../test-helpers.js';
import { Phase, RegionType, SiteType } from '../../index.js';
import type { CardDefinitionId, CardInstanceId } from '../../index.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const LEAF_BROOCH = 'dm-171' as CardDefinitionId;
/** Special hero item (also a Lórien card) — proves the non-special filter. */
const EARTH_OF_GALADRIELS_ORCHARD = 'tw-221' as CardDefinitionId;
const PRECIOUS_GOLD_RING = 'tw-306' as CardDefinitionId;
const BRIGANDS = 'tw-17' as CardDefinitionId;
const BORDER_KEYING = { method: 'region-type' as const, value: 'border' };
const WILDERNESS_KEYING = { method: 'region-type' as const, value: 'wilderness' };
const SHADOW_KEYING = { method: 'region-type' as const, value: 'shadow' };
/** Wilderness → Shadow path into Moria, so both Trolls can be keyed in one M/H phase. */
const TROLL_PATH = {
  resolvedSitePath: [RegionType.Wilderness, RegionType.Shadow],
  resolvedSitePathNames: ['Rhudaur', 'Imlad Morgul'],
  destinationSiteType: SiteType.ShadowHold,
  destinationSiteName: 'Moria',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Leaf Brooch (dm-171)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: only playable at Lórien ──

  test('playable at Lórien during the site phase', () => {
    const state = buildSitePhaseState({ site: LORIEN, characters: [ARAGORN], hand: [LEAF_BROOCH] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(1);
  });

  test('playing it at Lórien attaches the brooch to the bearer', () => {
    const state = buildSitePhaseState({ site: LORIEN, characters: [ARAGORN], hand: [LEAF_BROOCH] });
    const after = dispatch(state, viableActions(state, PLAYER_1, 'play-hero-resource')[0].action);
    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).items.map(i => i.definitionId)).toEqual([LEAF_BROOCH]);
  });

  test('NOT playable at Rivendell (a different Haven)', () => {
    const state = buildSitePhaseState({ site: RIVENDELL, characters: [ARAGORN], hand: [LEAF_BROOCH] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  test('NOT playable at Moria', () => {
    const state = buildSitePhaseState({ site: MORIA, characters: [ARAGORN], hand: [LEAF_BROOCH] });
    expect(viableActions(state, PLAYER_1, 'play-hero-resource')).toHaveLength(0);
  });

  // ── Rule 2: substituting for a forced discard (Brigands, tw-17) ──

  test('Brigands: naming a non-special item offers the Leaf Brooch substitution', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, LEAF_BROOCH] }, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };
    let s = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), BORDER_KEYING,
    );
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);   // Aragorn wounded
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);  // survives the body check
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);  // Bilbo defeats his strike

    const glamdringId = findItemInstanceId(s, RESOURCE_PLAYER, GLAMDRING);
    const afterChoice = dispatch(s, viableActions(s, PLAYER_1, 'discard-item-from-company')
      .find(a => (a.action as { itemInstanceId: CardInstanceId }).itemInstanceId === glamdringId)!.action);

    // Nothing discarded yet — the substitution offer owns the discard.
    expect(afterChoice.pendingResolutions.map(r => r.kind.type)).toContain('discard-substitute-offer');
    expectNotInDiscardPile(afterChoice, RESOURCE_PLAYER, GLAMDRING);

    // One "save Glamdring" action plus the decline.
    const offers = viableActions(afterChoice, PLAYER_1, 'use-discard-substitute');
    expect(offers).toHaveLength(2);
    expect(offers.filter(a => (a.action as { itemInstanceId?: CardInstanceId }).itemInstanceId === glamdringId)).toHaveLength(1);
    expect(offers.filter(a => (a.action as { itemInstanceId?: CardInstanceId }).itemInstanceId === undefined)).toHaveLength(1);
  });

  test('using the substitution discards Leaf Brooch and keeps the named item', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, LEAF_BROOCH] }, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };
    let s = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), BORDER_KEYING,
    );
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    const glamdringId = findItemInstanceId(s, RESOURCE_PLAYER, GLAMDRING);
    s = dispatch(s, viableActions(s, PLAYER_1, 'discard-item-from-company')
      .find(a => (a.action as { itemInstanceId: CardInstanceId }).itemInstanceId === glamdringId)!.action);
    const after = dispatch(s, viableActions(s, PLAYER_1, 'use-discard-substitute')
      .find(a => (a.action as { itemInstanceId?: CardInstanceId }).itemInstanceId === glamdringId)!.action);

    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).items.map(i => i.definitionId)).toEqual([GLAMDRING]);
    expectInDiscardPile(after, RESOURCE_PLAYER, LEAF_BROOCH);
    expectNotInDiscardPile(after, RESOURCE_PLAYER, GLAMDRING);
    expect(after.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('declining the substitution discards the named item and keeps Leaf Brooch', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [GLAMDRING, LEAF_BROOCH] }, BILBO] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };
    let s = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), BORDER_KEYING,
    );
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    const glamdringId = findItemInstanceId(s, RESOURCE_PLAYER, GLAMDRING);
    s = dispatch(s, viableActions(s, PLAYER_1, 'discard-item-from-company')
      .find(a => (a.action as { itemInstanceId: CardInstanceId }).itemInstanceId === glamdringId)!.action);
    const after = dispatch(s, viableActions(s, PLAYER_1, 'use-discard-substitute')
      .find(a => (a.action as { itemInstanceId?: CardInstanceId }).itemInstanceId === undefined)!.action);

    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).items.map(i => i.definitionId)).toEqual([LEAF_BROOCH]);
    expectInDiscardPile(after, RESOURCE_PLAYER, GLAMDRING);
    expectNotInDiscardPile(after, RESOURCE_PLAYER, LEAF_BROOCH);
    expect(after.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('the brooch protects the whole company, not only its own bearer', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [{ defId: ARAGORN, items: [GLAMDRING] }, { defId: BILBO, items: [LEAF_BROOCH] }],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };
    let s = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), BORDER_KEYING,
    );
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    const glamdringId = findItemInstanceId(s, RESOURCE_PLAYER, GLAMDRING);
    s = dispatch(s, viableActions(s, PLAYER_1, 'discard-item-from-company')
      .find(a => (a.action as { itemInstanceId: CardInstanceId }).itemInstanceId === glamdringId)!.action);
    const after = dispatch(s, viableActions(s, PLAYER_1, 'use-discard-substitute')
      .find(a => (a.action as { itemInstanceId?: CardInstanceId }).itemInstanceId === glamdringId)!.action);

    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).items.map(i => i.definitionId)).toEqual([GLAMDRING]);
    expectCharItemCount(after, RESOURCE_PLAYER, BILBO, 0);
    expectInDiscardPile(after, RESOURCE_PLAYER, LEAF_BROOCH);
  });

  test('no substitution is offered when the doomed item is itself special', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [{ defId: ARAGORN, items: [EARTH_OF_GALADRIELS_ORCHARD, LEAF_BROOCH] }, BILBO],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BRIGANDS], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeBorderMHState() };
    let s = playCreatureHazardAndResolve(
      ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER), companyIdAt(ready, RESOURCE_PLAYER), BORDER_KEYING,
    );
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'assign-strike');
    s = executeAction(s, PLAYER_1, 'choose-strike-order');
    s = executeAction(s, PLAYER_1, 'resolve-strike', 2);
    s = executeAction(s, PLAYER_2, 'body-check-roll', 2);
    s = executeAction(s, PLAYER_1, 'resolve-strike', 12);

    const earthId = findItemInstanceId(s, RESOURCE_PLAYER, EARTH_OF_GALADRIELS_ORCHARD);
    const after = dispatch(s, viableActions(s, PLAYER_1, 'discard-item-from-company')
      .find(a => (a.action as { itemInstanceId: CardInstanceId }).itemInstanceId === earthId)!.action);

    // The special item is discarded outright — no offer, the brooch is untouched.
    expect(after.pendingResolutions.map(r => r.kind.type)).not.toContain('discard-substitute-offer');
    expect(viableActions(after, PLAYER_1, 'use-discard-substitute')).toHaveLength(0);
    expectInDiscardPile(after, RESOURCE_PLAYER, EARTH_OF_GALADRIELS_ORCHARD);
    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).items.map(i => i.definitionId)).toEqual([LEAF_BROOCH]);
  });

  // ── Rule 2: substituting into a multi-item strip ("Bert" tw-016 after "William") ──

  test('Bert strips every non-special item: the brooch saves exactly one of them', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE, LEAF_BROOCH] }],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILLIAM_WULUAG, BERT_BURAT], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState(TROLL_PATH) };
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterWilliam = runCreatureCombat(
      playCreatureHazardAndResolve(ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER, 0), companyId, WILDERNESS_KEYING),
      ARAGORN, 12, null,
    );
    const wounded = runCreatureCombat(
      playCreatureHazardAndResolve(afterWilliam, PLAYER_2, handCardId(afterWilliam, HAZARD_PLAYER, 0), companyId, SHADOW_KEYING),
      ARAGORN, 2, 5,
    );

    // Both non-special items are still borne — the strip is deferred to the offer.
    expectCharItemCount(wounded, RESOURCE_PLAYER, ARAGORN, 3);
    // Save Glamdring, save the Dagger, or decline.
    expect(viableActions(wounded, PLAYER_1, 'use-discard-substitute')).toHaveLength(3);

    const glamdringId = findItemInstanceId(wounded, RESOURCE_PLAYER, GLAMDRING);
    const after = dispatch(wounded, viableActions(wounded, PLAYER_1, 'use-discard-substitute')
      .find(a => (a.action as { itemInstanceId?: CardInstanceId }).itemInstanceId === glamdringId)!.action);

    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).items.map(i => i.definitionId)).toEqual([GLAMDRING]);
    expectInDiscardPile(after, RESOURCE_PLAYER, LEAF_BROOCH);
    expectInDiscardPile(after, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    expect(after.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  test('two Leaf Brooches save two items from the same strip', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: MORIA,
            characters: [{ defId: ARAGORN, items: [GLAMDRING, DAGGER_OF_WESTERNESSE, LEAF_BROOCH, LEAF_BROOCH] }],
          }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [WILLIAM_WULUAG, BERT_BURAT], siteDeck: [RIVENDELL] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState(TROLL_PATH) };
    const companyId = companyIdAt(ready, RESOURCE_PLAYER);

    const afterWilliam = runCreatureCombat(
      playCreatureHazardAndResolve(ready, PLAYER_2, handCardId(ready, HAZARD_PLAYER, 0), companyId, WILDERNESS_KEYING),
      ARAGORN, 12, null,
    );
    let s = runCreatureCombat(
      playCreatureHazardAndResolve(afterWilliam, PLAYER_2, handCardId(afterWilliam, HAZARD_PLAYER, 0), companyId, SHADOW_KEYING),
      ARAGORN, 2, 5,
    );

    const glamdringId = findItemInstanceId(s, RESOURCE_PLAYER, GLAMDRING);
    s = dispatch(s, viableActions(s, PLAYER_1, 'use-discard-substitute')
      .find(a => (a.action as { itemInstanceId?: CardInstanceId }).itemInstanceId === glamdringId)!.action);

    // The second brooch keeps the offer alive for the remaining Dagger.
    expect(s.pendingResolutions.map(r => r.kind.type)).toContain('discard-substitute-offer');
    const daggerId = findItemInstanceId(s, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    const after = dispatch(s, viableActions(s, PLAYER_1, 'use-discard-substitute')
      .find(a => (a.action as { itemInstanceId?: CardInstanceId }).itemInstanceId === daggerId)!.action);

    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).items.map(i => i.definitionId).sort())
      .toEqual([DAGGER_OF_WESTERNESSE, GLAMDRING].sort());
    expect(after.players[RESOURCE_PLAYER].discardPile.filter(c => c.definitionId === LEAF_BROOCH)).toHaveLength(2);
    expect(after.pendingResolutions.filter(r => r.actor === PLAYER_1)).toHaveLength(0);
  });

  // ── Rule 2: the gold-ring test discard (Rule 9.21 / CRF 22) ──

  test('gold-ring test: the brooch may be discarded instead of the tested ring', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, { defId: BILBO, items: [LEAF_BROOCH] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const pending = enqueueGoldRingTest(
      withRing, PLAYER_1,
      findItemInstanceId(withRing, RESOURCE_PLAYER, PRECIOUS_GOLD_RING),
      findCharInstanceId(withRing, RESOURCE_PLAYER, ARAGORN),
    );
    const ringId = findItemInstanceId(withRing, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);

    let s = dispatch({ ...pending, cheatRollTotal: 7 }, viableActions(pending, PLAYER_1, 'gold-ring-test-roll')[0].action);
    // The ring is still borne while the ring-play offer is answered.
    expectCharItemCount(s, RESOURCE_PLAYER, ARAGORN, 1);
    s = dispatch(s, viableActions(s, PLAYER_1, 'pass')[0].action); // decline the replacement ring

    const after = dispatch(s, viableActions(s, PLAYER_1, 'use-discard-substitute')
      .find(a => (a.action as { itemInstanceId?: CardInstanceId }).itemInstanceId === ringId)!.action);

    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).items.map(i => i.definitionId)).toEqual([PRECIOUS_GOLD_RING]);
    expectCharItemCount(after, RESOURCE_PLAYER, BILBO, 0);
    expectInDiscardPile(after, RESOURCE_PLAYER, LEAF_BROOCH);
    expectNotInDiscardPile(after, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
  });

  test('gold-ring test: declining the substitution discards the ring as normal', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, { defId: BILBO, items: [LEAF_BROOCH] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const pending = enqueueGoldRingTest(
      withRing, PLAYER_1,
      findItemInstanceId(withRing, RESOURCE_PLAYER, PRECIOUS_GOLD_RING),
      findCharInstanceId(withRing, RESOURCE_PLAYER, ARAGORN),
    );

    let s = dispatch({ ...pending, cheatRollTotal: 7 }, viableActions(pending, PLAYER_1, 'gold-ring-test-roll')[0].action);
    s = dispatch(s, viableActions(s, PLAYER_1, 'pass')[0].action);
    const after = dispatch(s, viableActions(s, PLAYER_1, 'use-discard-substitute')
      .find(a => (a.action as { itemInstanceId?: CardInstanceId }).itemInstanceId === undefined)!.action);

    expectCharItemCount(after, RESOURCE_PLAYER, ARAGORN, 0);
    expect(getCharacter(after, RESOURCE_PLAYER, BILBO).items.map(i => i.definitionId)).toEqual([LEAF_BROOCH]);
    expectInDiscardPile(after, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
    expectNotInDiscardPile(after, RESOURCE_PLAYER, LEAF_BROOCH);
  });

  test('gold-ring test: with no brooch in the company the ring is discarded outright', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const withRing = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, PRECIOUS_GOLD_RING);
    const pending = enqueueGoldRingTest(
      withRing, PLAYER_1,
      findItemInstanceId(withRing, RESOURCE_PLAYER, PRECIOUS_GOLD_RING),
      findCharInstanceId(withRing, RESOURCE_PLAYER, ARAGORN),
    );
    const s = dispatch({ ...pending, cheatRollTotal: 7 }, viableActions(pending, PLAYER_1, 'gold-ring-test-roll')[0].action);

    expectInDiscardPile(s, RESOURCE_PLAYER, PRECIOUS_GOLD_RING);
    expect(s.pendingResolutions.map(r => r.kind.type)).not.toContain('discard-substitute-offer');
  });
});
