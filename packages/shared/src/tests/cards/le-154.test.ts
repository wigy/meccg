/**
 * @module le-154.test
 *
 * Card test: Stinker (le-154)
 * Type: minion-resource-ally
 * Alignment: ringwraith
 * Stats: prowess 2, body 9, mind 4, MP 2.
 * Unique. Playable at Goblin-gate or Moria. Manifestation of Gollum and My
 * Precious.
 *
 * Card text:
 *   "If his company's size is less than three, tap Stinker to cancel one
 *    attack against his company keyed to Wilderness [{w}] or Shadow-land
 *    [{s}]. You may tap Stinker if he is at the same non-Darkhaven site as
 *    The One Ring; then both Stinker and The One Ring are discarded."
 *
 * Engine Support:
 * | # | Feature                                              | Status          | Notes                                                    |
 * |---|------------------------------------------------------|-----------------|----------------------------------------------------------|
 * | 1 | Grant-action: discard Stinker + The One Ring          | IMPLEMENTED     | grant-action `stinker-discard-with-ring` (cost: discard)  |
 * | 2 | Gate on bearer at non-haven ("non-Darkhaven")        | IMPLEMENTED     | `bearer.atHaven` context variable                        |
 * | 3 | Gate on The One Ring at the same site                | IMPLEMENTED     | `site.hasOneRing` — name-matched across both players      |
 * | 4 | Discard ring even when held by opposing hero player  | IMPLEMENTED     | `discard-named-card-from-company` scans all co-located    |
 * | 5 | Combat cancel-attack when company size < 3 (W/S key)  | NOT IMPLEMENTED | requires in-play tap-ally-cancel-attack during combat     |
 *
 * Playable: PARTIALLY (ring-discard works; combat cancel-attack lacks engine
 *   support for tapping an in-play ally to cancel an attack).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachAllyToChar, attachItemToChar,
  viableActions, dispatch,
  findCharInstanceId,
  expectInDiscardPile,
  PLAYER_1, PLAYER_2,
  ARAGORN,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, ActivateGrantedAction } from '../../index.js';

const STINKER = 'le-154' as CardDefinitionId;
const THE_ONE_RING = 'tw-347' as CardDefinitionId;

// Minion host character for attaching Stinker
const HORSEMAN_IN_THE_NIGHT = 'le-16' as CardDefinitionId;

// Sites (name-matched across alignments)
const MORIA_MINION = 'le-392' as CardDefinitionId;   // shadow-hold (name "Moria")
const MORIA_HERO = 'tw-413' as CardDefinitionId;     // shadow-hold (name "Moria")
const GOBLIN_GATE_MINION = 'le-378' as CardDefinitionId; // shadow-hold (name "Goblin-gate")
const DOL_GULDUR = 'le-367' as CardDefinitionId;     // haven (minion "Darkhaven")
const MINAS_TIRITH = 'tw-407' as CardDefinitionId;

describe('Stinker (le-154)', () => {
  beforeEach(() => resetMint());

  test('grant-action NOT offered when The One Ring is not at the same site', () => {
    // Stinker at Moria, no One Ring anywhere → ability should not fire.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const actions = viableActions(withStinker, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(0);
  });

  test('grant-action NOT offered at a Darkhaven even when The One Ring is there', () => {
    // Both companies are at Dol Guldur (minion haven). Although The One Ring
    // is co-located, the "non-Darkhaven" clause blocks the ability.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: DOL_GULDUR, characters: [HORSEMAN_IN_THE_NIGHT] }],
          hand: [],
          siteDeck: [MORIA_MINION],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: DOL_GULDUR, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const withRing = attachItemToChar(withStinker, HAZARD_PLAYER, ARAGORN, THE_ONE_RING);
    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(0);
  });

  test('grant-action offered when Stinker and The One Ring are at the same non-Darkhaven site', () => {
    // Stinker at minion-Moria; hero Aragorn at hero-Moria with The One Ring.
    // Name-match should recognize the sites as co-located.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA_HERO, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const withRing = attachItemToChar(withStinker, HAZARD_PLAYER, ARAGORN, THE_ONE_RING);
    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);
  });

  test('grant-action offered when Stinker and The One Ring are at Goblin-gate', () => {
    // Both at Goblin-gate (a shadow-hold, not a haven). Ring carried by the
    // same minion player's own character — still triggers (rules don't
    // restrict the owner of the ring).
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: GOBLIN_GATE_MINION,
            characters: [HORSEMAN_IN_THE_NIGHT],
          }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    // The One Ring on the host character itself (unusual but permitted as fixture).
    const withRing = attachItemToChar(withStinker, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, THE_ONE_RING);
    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);
  });

  test('activating the grant-action discards Stinker and The One Ring held by opposing player', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MORIA_MINION, characters: [HORSEMAN_IN_THE_NIGHT] }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MORIA_HERO, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const withRing = attachItemToChar(withStinker, HAZARD_PLAYER, ARAGORN, THE_ONE_RING);

    const hostId = findCharInstanceId(withRing, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT);
    const aragornId = findCharInstanceId(withRing, HAZARD_PLAYER, ARAGORN);

    // Capture Stinker / Ring instance IDs before dispatch so we can assert on
    // where the specific instances end up.
    const stinkerInstId = withRing.players[0].characters[hostId as string].allies[0].instanceId;
    const ringInstId = withRing.players[1].characters[aragornId as string].items[0].instanceId;

    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);

    const next = dispatch(withRing, actions[0].action);

    // Stinker is no longer attached and sits in the minion player's discard.
    expect(next.players[0].characters[hostId as string].allies).toHaveLength(0);
    expectInDiscardPile(next, RESOURCE_PLAYER, stinkerInstId);

    // The One Ring is no longer on Aragorn and sits in the hero player's discard.
    expect(next.players[1].characters[aragornId as string].items).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, ringInstId);
  });

  test('activating the grant-action discards the ring held by the bearer\'s own company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MORIA_MINION,
            characters: [HORSEMAN_IN_THE_NIGHT],
          }],
          hand: [],
          siteDeck: [DOL_GULDUR],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: MINAS_TIRITH, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
        },
      ],
    });

    const withStinker = attachAllyToChar(base, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, STINKER);
    const withRing = attachItemToChar(withStinker, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT, THE_ONE_RING);

    const hostId = findCharInstanceId(withRing, RESOURCE_PLAYER, HORSEMAN_IN_THE_NIGHT);
    const stinkerInstId = withRing.players[0].characters[hostId as string].allies[0].instanceId;
    const ringInstId = withRing.players[0].characters[hostId as string].items
      .find(i => i.definitionId === THE_ONE_RING)!.instanceId;

    const actions = viableActions(withRing, PLAYER_1, 'activate-granted-action')
      .filter(ea => (ea.action as ActivateGrantedAction).actionId === 'stinker-discard-with-ring');
    expect(actions.length).toBe(1);

    const next = dispatch(withRing, actions[0].action);

    // Both cards end up in the minion player's own discard pile.
    const host = next.players[0].characters[hostId as string];
    expect(host.allies).toHaveLength(0);
    expect(host.items.some(i => i.instanceId === ringInstId)).toBe(false);
    expectInDiscardPile(next, RESOURCE_PLAYER, stinkerInstId);
    expectInDiscardPile(next, RESOURCE_PLAYER, ringInstId);
  });
});
