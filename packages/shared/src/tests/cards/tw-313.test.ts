/**
 * @module tw-313.test
 *
 * Card test: Red Book of Westmarch (tw-313)
 * Type: hero-resource-item (special)
 * Effects: 4 (item-play-site, two stat-modifier direct-influence, storable-at)
 *
 * "Unique. Only playable at Bag End. +2 to direct influence against a
 *  Hobbit character or faction. 1 marshalling point if stored at a
 *  Haven [{H}]."
 *
 * Engine Support:
 * | # | Feature                                       | Status      | Notes                                             |
 * |---|-----------------------------------------------|-------------|---------------------------------------------------|
 * | 1 | Playable only at Bag End                      | IMPLEMENTED | item-play-site restricts to the site by name      |
 * | 2 | +2 DI vs Hobbit character (influence-check)   | IMPLEMENTED | stat-modifier resolves via availableDI            |
 * | 3 | +2 DI vs Hobbit faction (faction-influence)   | IMPLEMENTED | stat-modifier resolves in faction-influence-check |
 * | 4 | Storable at any Haven                         | IMPLEMENTED | storable-at siteTypes match site.siteType         |
 * | 5 | 1 MP override when stored                     | IMPLEMENTED | storable-at marshallingPoints override            |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  pool, PLAYER_1, PLAYER_2,
  Phase,
  ARAGORN, BILBO, FRODO, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE,
  buildTestState, buildSitePhaseState, resetMint,
  viableActions, dispatch,
  findCharInstanceId, attachItemToChar,
  RESOURCE_PLAYER,
} from '../test-helpers.js';
import type {
  CardDefinitionId, CharacterCard, StoreItemAction,
} from '../../index.js';
import { computeLegalActions, BAG_END } from '../../index.js';
import { availableDI } from '../../engine/legal-actions/organization.js';
import {
  collectCharacterEffects,
  resolveStatModifiers,
  type ResolverContext,
} from '../../engine/effects/index.js';

const RED_BOOK = 'tw-313' as CardDefinitionId;

describe('Red Book of Westmarch (tw-313)', () => {
  beforeEach(() => resetMint());

  // ─── Effect 1: item-play-site (only playable at Bag End) ────────────────

  test('playable at Bag End during site phase', () => {
    const state = buildSitePhaseState({
      site: BAG_END,
      characters: [BILBO],
      hand: [RED_BOOK],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);
  });

  test('Red Book play goes onto a character at Bag End (non-hobbit bearer allowed)', () => {
    const state = buildSitePhaseState({
      site: BAG_END,
      characters: [ARAGORN],
      hand: [RED_BOOK],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(1);

    const next = dispatch(state, plays[0].action);
    const aragorn = Object.values(next.players[0].characters)[0];
    const attached = aragorn.items.find(i => i.definitionId === RED_BOOK);
    expect(attached).toBeDefined();
  });

  test('NOT playable at Rivendell (haven, not Bag End)', () => {
    const state = buildSitePhaseState({
      site: RIVENDELL,
      characters: [BILBO],
      hand: [RED_BOOK],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at Bree (free-hold, not Bag End)', () => {
    const state = buildSitePhaseState({
      site: BREE,
      characters: [BILBO],
      hand: [RED_BOOK],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  test('NOT playable at Moria (shadow-hold, not Bag End)', () => {
    const state = buildSitePhaseState({
      site: MORIA,
      characters: [BILBO],
      hand: [RED_BOOK],
    });
    const plays = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(plays).toHaveLength(0);
  });

  // ─── Effect 2: +2 direct-influence against a Hobbit character ───────────

  test('+2 DI bonus applies when influencing a Hobbit (Bilbo) with Red Book attached', () => {
    // Aragorn II base DI 3; Red Book grants +2 vs hobbit targets → effective 5.
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RED_BOOK);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboDef = pool[BILBO as string] as CharacterCard;
    expect(bilboDef.race).toBe('hobbit');

    const di = availableDI(state, aragornId, state.players[0], bilboDef);
    expect(di).toBe(3 + 2);
  });

  test('+2 DI bonus also applies against Frodo (keyed on race, not name)', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RED_BOOK);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const frodoDef = pool[FRODO as string] as CharacterCard;
    expect(frodoDef.race).toBe('hobbit');

    const di = availableDI(state, aragornId, state.players[0], frodoDef);
    expect(di).toBe(3 + 2);
  });

  test('+2 DI bonus does NOT apply against a non-Hobbit target (Legolas, elf)', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RED_BOOK);

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const legolasDef = pool[LEGOLAS as string] as CharacterCard;
    expect(legolasDef.race).not.toBe('hobbit');

    const di = availableDI(state, aragornId, state.players[0], legolasDef);
    expect(di).toBe(3);
  });

  test('without Red Book attached, there is no DI bonus against Hobbits', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilboDef = pool[BILBO as string] as CharacterCard;

    const di = availableDI(state, aragornId, state.players[0], bilboDef);
    expect(di).toBe(3);
  });

  // ─── Effect 3: +2 direct-influence against a Hobbit faction ─────────────

  test('+2 DI bonus fires in a faction-influence-check context with faction.race = "hobbit"', () => {
    // No Hobbit faction exists in the current card pool, so we drive the
    // resolver directly with a synthesized faction-influence-check context
    // matching what `site.ts` / `pending.ts` build for real influence plays.
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RED_BOOK);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const aragornChar = state.players[0].characters[aragornId as string];

    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    const ctx: ResolverContext = {
      reason: 'faction-influence-check',
      bearer: {
        race: aragornDef.race,
        skills: aragornDef.skills,
        baseProwess: aragornDef.prowess,
        baseBody: aragornDef.body,
        baseDirectInfluence: aragornDef.directInfluence,
        name: aragornDef.name,
      },
      faction: { name: 'Hobbits', race: 'hobbit', playableAt: ['Bag End'] },
    };

    const effects = collectCharacterEffects(state, aragornChar, ctx);
    const bonus = resolveStatModifiers(effects, 'direct-influence', 0, ctx);
    expect(bonus).toBe(2);
  });

  test('DI bonus does NOT fire against non-Hobbit factions (faction.race = "man")', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = attachItemToChar(base, RESOURCE_PLAYER, ARAGORN, RED_BOOK);
    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const aragornChar = state.players[0].characters[aragornId as string];

    const aragornDef = pool[ARAGORN as string] as CharacterCard;
    const ctx: ResolverContext = {
      reason: 'faction-influence-check',
      bearer: {
        race: aragornDef.race,
        skills: aragornDef.skills,
        baseProwess: aragornDef.prowess,
        baseBody: aragornDef.body,
        baseDirectInfluence: aragornDef.directInfluence,
        name: aragornDef.name,
      },
      faction: { name: 'Riders of Rohan', race: 'man', playableAt: ['Edoras'] },
    };

    const effects = collectCharacterEffects(state, aragornChar, ctx);
    const bonus = resolveStatModifiers(effects, 'direct-influence', 0, ctx);
    expect(bonus).toBe(0);
  });

  // ─── Effect 4 & 5: storable-at any Haven, 1 MP override ─────────────────

  test('store-item action is viable when the bearer is at a Haven (Rivendell)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
    const store = storeActions[0].action as StoreItemAction;
    expect(store.itemInstanceId).toBeDefined();
  });

  test('store-item action is viable at a different Haven (Lórien) — siteTypes match any haven', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: LORIEN, characters: [{ defId: BILBO, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const storeActions = viableActions(state, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
  });

  test('store-item action is NOT viable at Bag End (free-hold, not a haven)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [{ defId: BILBO, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const storeActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item');
    expect(storeActions).toHaveLength(0);
  });

  test('store-item action is NOT viable at Minas Tirith (free-hold, not a haven)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: MINAS_TIRITH, characters: [{ defId: BILBO, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const storeActions = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'store-item');
    expect(storeActions).toHaveLength(0);
  });

  test('dispatching store-item moves Red Book to the out-of-play pile and triggers a corruption check', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const storeActions = viableActions(base, PLAYER_1, 'store-item');
    expect(storeActions).toHaveLength(1);
    const afterStore = dispatch(base, storeActions[0].action);

    // Item removed from bearer
    const bilbo = Object.values(afterStore.players[0].characters)[0];
    expect(bilbo.items).toHaveLength(0);

    // Item added to out-of-play pile
    expect(afterStore.players[0].outOfPlayPile).toHaveLength(1);
    expect(afterStore.players[0].outOfPlayPile[0].definitionId).toBe(RED_BOOK);

    // Storing enqueues a corruption check on the bearer
    const cc = afterStore.pendingResolutions.find(r => r.kind.type === 'corruption-check');
    expect(cc).toBeDefined();
  });

  test('stored Red Book earns 1 MP (override from storable-at marshallingPoints)', () => {
    const base = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Base MP is 0: held on character earns nothing
    expect(base.players[0].marshallingPoints.item).toBe(0);

    const storeActions = viableActions(base, PLAYER_1, 'store-item');
    const afterStore = dispatch(base, storeActions[0].action);

    // After storing: 1 MP from stored item (override)
    expect(afterStore.players[0].marshallingPoints.item).toBe(1);
  });

  test('Red Book on character earns 0 MP (base)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: BAG_END, characters: [{ defId: BILBO, items: [RED_BOOK] }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    expect(state.players[0].marshallingPoints.item).toBe(0);
  });
});
