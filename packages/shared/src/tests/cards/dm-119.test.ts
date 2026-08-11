/**
 * @module dm-119.test
 *
 * Card test: Barrow-blade (dm-119)
 * Type: hero-resource-event (permanent), alignment: wizard
 *
 * Text:
 *   "Tap the bearer of a Dagger of Westernesse during the site phase at a
 *    Ruins & Lairs [{R}] and play this with the Dagger. Dagger receives +1
 *    prowess (+3 versus Undead and Nazgûl). Cannot be duplicated on a given
 *    Dagger."
 *
 * Modeling (see step-7 report):
 *  - `play-target` `target: "item"`, filter `{ target.name: "Dagger of
 *    Westernesse" }` — a NEW generic primitive: a permanent event played "with"
 *    an item, attached to it via `CardInPlay.attachedToItem`. Its effects flow
 *    to the item's bearer (collected in `collectCharacterEffects`).
 *  - `play-condition` `requires: "site-type"`, `siteTypes: ["ruins-and-lairs"]`
 *    — playable only at a Ruins & Lairs during the site phase.
 *  - `play-flag: tap-bearer-on-play` — taps the character bearing the targeted
 *    item as the play cost (so an untapped bearer is required).
 *  - two `stat-modifier` prowess effects: +1 always, +2 more when the enemy is
 *    Undead or Nazgûl (net +3 versus those, +1 otherwise).
 *  - `duplication-limit` `scope: "item"` — one Barrow-blade per Dagger.
 *
 * Every test drives the reducer / legal-action computation — no assertion
 * reads a card-JSON field back against itself.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, buildSitePhaseState, makeMHState, resetMint,
  dispatch, viableActions,
  findCharInstanceId, findItemInstanceId,
  getCharacter, playPermanentEventAndResolve, playCreatureHazardAndResolve,
  addP1CardsInPlay, mint, actionAs, handCardId, companyIdAt,
} from '../test-helpers.js';
import {
  ARAGORN, DAGGER_OF_WESTERNESSE, GLAMDRING, BARROW_WIGHT, BERT_BURAT,
  BARROW_DOWNS, MINAS_TIRITH, MORIA,
  Phase, RegionType, SiteType, CardStatus, computeLegalActions,
} from '../../index.js';
import type { CardDefinitionId, ResolveStrikeAction } from '../../index.js';

const BARROW_BLADE = 'dm-119' as CardDefinitionId;

// ── Playability (site phase, Ruins & Lairs, on the Dagger) ────────────────────

describe('Barrow-blade (dm-119)', () => {
  beforeEach(() => resetMint());

  test('offered on the Dagger of Westernesse at a Ruins & Lairs, carrying that item as target', () => {
    const state = buildSitePhaseState({
      site: BARROW_DOWNS,
      characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }],
      hand: [BARROW_BLADE],
    });
    const daggerId = findItemInstanceId(state, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');

    expect(actions.length).toBe(1);
    expect((actions[0].action as { targetItemInstanceId?: unknown }).targetItemInstanceId).toBe(daggerId);
  });

  test('not offered at a non-Ruins&Lairs site (free-hold)', () => {
    const state = buildSitePhaseState({
      site: MINAS_TIRITH, // free-hold
      characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }],
      hand: [BARROW_BLADE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('not offered when the character bears no Dagger of Westernesse', () => {
    const state = buildSitePhaseState({
      site: BARROW_DOWNS,
      characters: [{ defId: ARAGORN, items: [GLAMDRING] }], // a different weapon
      hand: [BARROW_BLADE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('not offered when the Dagger-bearer is already tapped (cannot pay the tap cost)', () => {
    const state = buildSitePhaseState({
      site: BARROW_DOWNS,
      characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE], status: CardStatus.Tapped }],
      hand: [BARROW_BLADE],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('not offered during the movement/hazard phase, even with no Dagger anywhere in play (rule 2.1.1 does not bypass its site-phase item-target timing)', () => {
    let state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MORIA, characters: [{ defId: ARAGORN }] }],
          hand: [BARROW_BLADE],
          siteDeck: [MINAS_TIRITH],
        },
        {
          id: PLAYER_2,
          companies: [{ site: MORIA, characters: [] }],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
      ],
    });
    state = { ...state, phaseState: makeMHState() };
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Play resolution: attach to the item, tap the bearer, +1 prowess ─────────

  test('playing it attaches to the Dagger, taps the bearer, and raises prowess by 1', () => {
    const base = buildSitePhaseState({
      site: BARROW_DOWNS,
      characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }],
      hand: [BARROW_BLADE],
    });
    const daggerId = findItemInstanceId(base, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    const cardId = base.players[0].hand.find(c => c.definitionId === BARROW_BLADE)!.instanceId;

    const beforeProwess = getCharacter(base, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess;
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, undefined, {
      targetItemInstanceId: daggerId,
    });

    // Attached to the item (lives in cardsInPlay bound via attachedToItem).
    const attached = after.players[0].cardsInPlay.find(
      c => c.definitionId === BARROW_BLADE && c.attachedToItem === daggerId,
    );
    expect(attached).toBeDefined();

    // Bearer tapped as the play cost.
    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).status).toBe(CardStatus.Tapped);

    // +1 prowess flows to the bearer.
    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).effectiveStats.prowess).toBe(beforeProwess + 1);
  });

  // ── Corruption: Barrow-blade adds 1 CP to the Dagger's bearer ───────────────

  test('adds 1 corruption point to the bearer once attached', () => {
    const base = buildSitePhaseState({
      site: BARROW_DOWNS,
      characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }],
      hand: [BARROW_BLADE],
    });
    const daggerId = findItemInstanceId(base, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    const cardId = base.players[0].hand.find(c => c.definitionId === BARROW_BLADE)!.instanceId;

    const beforeCp = getCharacter(base, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints;
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, undefined, {
      targetItemInstanceId: daggerId,
    });

    expect(getCharacter(after, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(beforeCp + 1);
  });

  // ── Duplication: one Barrow-blade per Dagger ────────────────────────────────

  test('cannot be duplicated on a Dagger that already carries a Barrow-blade', () => {
    const base = buildSitePhaseState({
      site: BARROW_DOWNS,
      characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }],
      hand: [BARROW_BLADE],
    });
    const daggerId = findItemInstanceId(base, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);

    // Control: with no copy attached yet, the play IS offered.
    expect(viableActions(base, PLAYER_1, 'play-permanent-event').length).toBe(1);

    // Attach one copy to the Dagger; the second (in hand) is no longer offered
    // on the same Dagger even though the bearer is still untapped here.
    const withCopy = addP1CardsInPlay(base, [{
      instanceId: mint(),
      definitionId: BARROW_BLADE,
      status: CardStatus.Untapped,
      attachedToItem: daggerId,
    }]);
    expect(viableActions(withCopy, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── Combat: +3 versus Undead / Nazgûl, +1 versus everything else ────────────

  test('combat prowess: +3 versus Undead, +1 versus other races', () => {
    // Aragorn base prowess 6 → 7 with the Dagger (+1, max 8) → 8 with Barrow-blade
    // (+1 base). Against a prowess-12 single-strike creature (tapped, no support):
    //   need = max(2, creatureProwess - charProwess + 1)
    //   Dagger only (prowess 7):            12 - 7 + 1 = 6   (both races)
    //   +Barrow-blade vs Undead (prowess 10): 12 - 10 + 1 = 3 (+3 total → drop 3)
    //   +Barrow-blade vs Troll  (prowess 8):  12 - 8  + 1 = 5 (+1 total → drop 1)
    // Barrow-wight (undead) and "Bert" (troll) both have prowess 12 and 1 strike.
    const scenarios = [
      { creature: BARROW_WIGHT, withBarrowBlade: false, expectedNeed: 6 },
      { creature: BARROW_WIGHT, withBarrowBlade: true, expectedNeed: 3 },
      { creature: BERT_BURAT, withBarrowBlade: false, expectedNeed: 6 },
      { creature: BERT_BURAT, withBarrowBlade: true, expectedNeed: 5 },
    ];

    for (const sc of scenarios) {
      let state = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        recompute: true,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: MORIA, characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }] }],
            hand: [],
            siteDeck: [MINAS_TIRITH],
          },
          {
            id: PLAYER_2,
            companies: [{ site: MORIA, characters: [] }],
            hand: [sc.creature],
            siteDeck: [MINAS_TIRITH],
          },
        ],
      });
      state = {
        ...state,
        phaseState: makeMHState({
          resolvedSitePath: [RegionType.Shadow],
          resolvedSitePathNames: ['Southern Mirkwood'],
          destinationSiteType: SiteType.ShadowHold,
          destinationSiteName: 'Moria',
        }),
      };

      if (sc.withBarrowBlade) {
        const daggerId = findItemInstanceId(state, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
        state = addP1CardsInPlay(state, [{
          instanceId: mint(),
          definitionId: BARROW_BLADE,
          status: CardStatus.Untapped,
          attachedToItem: daggerId,
        }]);
      }

      const creatureId = handCardId(state, HAZARD_PLAYER);
      const companyId = companyIdAt(state, RESOURCE_PLAYER);
      const afterCombat = playCreatureHazardAndResolve(
        state, PLAYER_2, creatureId, companyId,
        { method: 'region-type' as const, value: 'shadow' },
      );

      const aragornId = findCharInstanceId(afterCombat, RESOURCE_PLAYER, ARAGORN);
      const assigned = dispatch(afterCombat, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId });
      const passed = dispatch(assigned, { type: 'pass', player: PLAYER_1 });

      const tap = computeLegalActions(passed, PLAYER_1)
        .filter(a => a.viable && a.action.type === 'resolve-strike')
        .find(a => actionAs<ResolveStrikeAction>(a.action).tapToFight);
      expect(tap, `${sc.creature as string} withBarrowBlade=${sc.withBarrowBlade}`).toBeDefined();
      expect(
        actionAs<ResolveStrikeAction>(tap!.action).need,
        `${sc.creature as string} withBarrowBlade=${sc.withBarrowBlade}`,
      ).toBe(sc.expectedNeed);
    }
  });

  // ── Marshalling points: yields 1 Item-MP once attached ──────────────────────

  test('yields 1 item marshalling point once attached to the Dagger', () => {
    const base = buildSitePhaseState({
      site: BARROW_DOWNS,
      characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }],
      hand: [BARROW_BLADE],
    });
    const daggerId = findItemInstanceId(base, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    const beforeItemMp = base.players[RESOURCE_PLAYER].marshallingPoints.item;

    const cardId = base.players[0].hand.find(c => c.definitionId === BARROW_BLADE)!.instanceId;
    const after = playPermanentEventAndResolve(base, PLAYER_1, cardId, undefined, {
      targetItemInstanceId: daggerId,
    });

    expect(after.players[RESOURCE_PLAYER].marshallingPoints.item).toBe(beforeItemMp + 1);
  });

  // ── Orphan cleanup: discarded when its host Dagger leaves play ───────────────

  test('discarded from play once its host Dagger leaves play', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: BARROW_DOWNS, characters: [{ defId: ARAGORN, items: [DAGGER_OF_WESTERNESSE] }] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: MINAS_TIRITH, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const daggerId = findItemInstanceId(base, RESOURCE_PLAYER, DAGGER_OF_WESTERNESSE);
    const withBlade = addP1CardsInPlay(base, [{
      instanceId: mint(),
      definitionId: BARROW_BLADE,
      status: CardStatus.Untapped,
      attachedToItem: daggerId,
    }]);

    // Control: while the Dagger is borne, a reducer pass keeps Barrow-blade in play.
    const stillThere = dispatch(withBlade, { type: 'pass', player: PLAYER_1 });
    expect(stillThere.players[0].cardsInPlay.some(c => c.definitionId === BARROW_BLADE)).toBe(true);

    // Remove the Dagger from Aragorn (as if discarded) — the host item is gone.
    const aragornId = findCharInstanceId(withBlade, RESOURCE_PLAYER, ARAGORN);
    const daggerInstance = withBlade.players[0].characters[aragornId].items.find(i => i.instanceId === daggerId)!;
    const orphaned = {
      ...withBlade,
      players: [
        {
          ...withBlade.players[0],
          characters: {
            ...withBlade.players[0].characters,
            [aragornId as string]: {
              ...withBlade.players[0].characters[aragornId],
              items: withBlade.players[0].characters[aragornId].items.filter(i => i.instanceId !== daggerId),
            },
          },
          discardPile: [...withBlade.players[0].discardPile, { instanceId: daggerInstance.instanceId, definitionId: daggerInstance.definitionId }],
        },
        withBlade.players[1],
      ] as typeof withBlade.players,
    };

    // Any reduce triggers the post-action orphan sweep.
    const swept = dispatch(orphaned, { type: 'pass', player: PLAYER_1 });
    expect(swept.players[0].cardsInPlay.some(c => c.definitionId === BARROW_BLADE)).toBe(false);
    expect(swept.players[0].discardPile.some(c => c.definitionId === BARROW_BLADE)).toBe(true);
  });
});
