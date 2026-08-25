/**
 * @module td-144.test
 *
 * Card test: Pledge of Conduct (td-144)
 * Type: hero-resource-event (short)
 * Alignment: wizard
 *
 * Text:
 *   "Diplomat only. A character facing a corruption check in the diplomat's
 *    company may automatically transfer one item he bears to another
 *    character in his company. The item must be transferrable, and the new
 *    bearer must be able to bear it."
 *
 * Effects:
 *   1. play-target: character, filter: company.containsDiplomat
 *   2. play-option "transfer-item": when pending.corruptionCheckTargetsMe,
 *      apply transfer-item-free (moves one borne item to a company mate with
 *      NO follow-up corruption check for the transfer itself — unlike the
 *      ordinary organization-phase transfer-item action, CoE 2.II.5)
 *
 * `reactiveCorruptionCheckPlays` (legal-actions/pending.ts) enumerates one
 * `play-short-event` action per (item borne by the checking character, other
 * company member) pair — the item and destination are picked as part of
 * playing the card, mirroring transferItemActions' per-triple enumeration
 * for the ordinary transfer.
 *
 * Engine support table:
 * | # | Rule                                                                 | Status      |
 * |---|-----------------------------------------------------------------------|-------------|
 * | 1 | Playable only reactively, while a company member faces a CC          | IMPLEMENTED |
 * | 2 | Only offered when the company contains a Diplomat                    | IMPLEMENTED |
 * | 3 | Only the checked character's own items may be moved                  | IMPLEMENTED |
 * | 4 | Destination is any other character in the same company               | IMPLEMENTED |
 * | 5 | The transfer is "automatic" — no corruption check for the move itself | IMPLEMENTED |
 *
 * Playable: YES
 *
 * Fixtures:
 *   GIMLI (tw-159)                 - hero dwarf, warrior/diplomat
 *   ARAGORN (tw-120)                - hero man, warrior/scout/ranger, no diplomat
 *   BILBO (tw-131)                  - hero hobbit, scout/sage, no diplomat
 *   DAGGER_OF_WESTERNESSE (tw-206)  - hero minor item, transferable
 *   RIVENDELL (tw-421)              - hero haven
 *   LORIEN (tw-408), MORIA (tw-413), MINAS_TIRITH (tw-412) - filler sites
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, viableFor, findCharInstanceId, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, BILBO, GIMLI,
  DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  RESOURCE_PLAYER,
  expectInDiscardPile, dispatch,
} from '../test-helpers.js';
import type { CardDefinitionId, PlayShortEventAction, FreeCouncilPhaseState } from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { enqueueResolution } from '../../engine/pending.js';
import { reduce } from '../../index.js';

const PLEDGE_OF_CONDUCT = 'td-144' as CardDefinitionId;
/** Hero major item, CP 2, transferable — makes a roll of 2 fail the check. */
const SWORD_OF_GONDOLIN = 'tw-336' as CardDefinitionId;

describe('Pledge of Conduct (td-144)', () => {
  beforeEach(() => resetMint());

  test('transfer-item: offered during pending CC on the item-bearer in a diplomat company', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GIMLI, { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] }] }],
          hand: [PLEDGE_OF_CONDUCT],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const gimli = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const bilbo = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const dagger = state.players[RESOURCE_PLAYER].characters[bilbo].items[0].instanceId;

    const withCheck = enqueueResolution(state, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: bilbo, modifier: 0, reason: 'test', possessions: [], transferredItemId: null },
    });

    const offers = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'transfer-item');

    expect(offers).toHaveLength(1);
    expect(offers[0].targetCharacterId).toBe(bilbo);
    expect(offers[0].transferItemInstanceId).toBe(dagger);
    expect(offers[0].transferToCharacterId).toBe(gimli);
  });

  test('transfer-item: one action per destination when the company has more than one other member', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [GIMLI, ARAGORN, { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] }],
          }],
          hand: [PLEDGE_OF_CONDUCT],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const gimli = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const aragorn = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const bilbo = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);

    const withCheck = enqueueResolution(state, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: bilbo, modifier: 0, reason: 'test', possessions: [], transferredItemId: null },
    });

    const destinations = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'transfer-item')
      .map(a => a.transferToCharacterId)
      .sort();

    expect(destinations).toEqual([aragorn, gimli].sort());
  });

  test('transfer-item: NOT offered when the company has no Diplomat', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] }] }],
          hand: [PLEDGE_OF_CONDUCT],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const bilbo = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);

    const withCheck = enqueueResolution(state, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: bilbo, modifier: 0, reason: 'test', possessions: [], transferredItemId: null },
    });

    const offers = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'transfer-item');
    expect(offers).toHaveLength(0);
  });

  test('transfer-item: NOT offered when the checked character bears no items', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GIMLI, BILBO] }],
          hand: [PLEDGE_OF_CONDUCT],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const gimli = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);

    const withCheck = enqueueResolution(state, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: gimli, modifier: 0, reason: 'test', possessions: [], transferredItemId: null },
    });

    const offers = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'transfer-item');
    expect(offers).toHaveLength(0);
  });

  test('transfer-item: no pending CC -> nothing playable', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GIMLI, { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] }] }],
          hand: [PLEDGE_OF_CONDUCT],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const offers = computeLegalActions(state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'transfer-item');
    expect(offers).toHaveLength(0);
  });

  test('transfer-item: moves the item immediately with no follow-up corruption check, and discards the card', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GIMLI, { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] }] }],
          hand: [PLEDGE_OF_CONDUCT],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const gimli = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const bilbo = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const dagger = state.players[RESOURCE_PLAYER].characters[bilbo].items[0].instanceId;
    const cardInstance = state.players[RESOURCE_PLAYER].hand.find(c => c.definitionId === PLEDGE_OF_CONDUCT)!.instanceId;

    const withCheck = enqueueResolution(state, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: bilbo, modifier: 0, reason: 'test', possessions: [dagger], transferredItemId: null },
    });
    expect(withCheck.pendingResolutions).toHaveLength(1);

    const result = reduce(withCheck, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: cardInstance,
      targetCharacterId: bilbo,
      optionId: 'transfer-item',
      transferItemInstanceId: dagger,
      transferToCharacterId: gimli,
    });
    expect(result.error).toBeUndefined();
    const after = result.state;

    // The item moved to Gimli and off Bilbo.
    expect(after.players[RESOURCE_PLAYER].characters[gimli].items.some(i => i.instanceId === dagger)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].characters[bilbo].items.some(i => i.instanceId === dagger)).toBe(false);

    // No second corruption check was enqueued for the transfer itself — the
    // original pending check (still awaiting its roll) is the only one queued.
    expect(after.pendingResolutions).toHaveLength(1);
    expect(after.pendingResolutions[0].kind.type).toBe('corruption-check');
    if (after.pendingResolutions[0].kind.type === 'corruption-check') {
      expect(after.pendingResolutions[0].kind.characterId).toBe(bilbo);
    }

    // The spent card is discarded.
    expectInDiscardPile(after, RESOURCE_PLAYER, cardInstance);
  });

  test('transfer-item: the diplomat himself may be the checked character transferring to a companion', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: GIMLI, items: [DAGGER_OF_WESTERNESSE] }, BILBO] }],
          hand: [PLEDGE_OF_CONDUCT],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const gimli = findCharInstanceId(state, RESOURCE_PLAYER, GIMLI);
    const bilbo = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const dagger = state.players[RESOURCE_PLAYER].characters[gimli].items[0].instanceId;

    const withCheck = enqueueResolution(state, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: gimli, modifier: 0, reason: 'test', possessions: [dagger], transferredItemId: null },
    });

    const offers = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .filter(a => a.optionId === 'transfer-item');
    expect(offers).toHaveLength(1);
    expect(offers[0].targetCharacterId).toBe(gimli);
    expect(offers[0].transferItemInstanceId).toBe(dagger);
    expect(offers[0].transferToCharacterId).toBe(bilbo);
  });

  test('viableFor also surfaces the reactive transfer-item play', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GIMLI, { defId: BILBO, items: [DAGGER_OF_WESTERNESSE] }] }],
          hand: [PLEDGE_OF_CONDUCT],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const bilbo = findCharInstanceId(state, RESOURCE_PLAYER, BILBO);
    const withCheck = enqueueResolution(state, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: { type: 'corruption-check', characterId: bilbo, modifier: 0, reason: 'test', possessions: [], transferredItemId: null },
    });
    const offers = viableFor(withCheck, PLAYER_1)
      .filter(a => a.action.type === 'play-short-event')
      .map(a => a.action as PlayShortEventAction)
      .filter(a => a.optionId === 'transfer-item');
    expect(offers.length).toBeGreaterThan(0);
  });

  test('Free Council: an item transferred by Pledge of Conduct during the check is not discarded with the failing character (regression)', () => {
    // Regression: the Free Council window froze the checked character's
    // possessions (and CP) into `phaseState.pendingCheck` at declare time.
    // Pledge of Conduct moved the item to a company mate, but the resolver
    // still discarded every frozen possession — the same CardInstance ended
    // up both on Gimli and in the discard pile, and the lowered CP never
    // reached the roll.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.FreeCouncil,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [GIMLI, { defId: ARAGORN, items: [SWORD_OF_GONDOLIN] }] }],
          hand: [PLEDGE_OF_CONDUCT],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [BILBO] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const gimli = findCharInstanceId(base, RESOURCE_PLAYER, GIMLI);
    const aragorn = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const sword = base.players[RESOURCE_PLAYER].characters[aragorn].items[0].instanceId;
    expect(base.players[RESOURCE_PLAYER].characters[aragorn].effectiveStats.corruptionPoints).toBe(2);

    const fcState: FreeCouncilPhaseState = {
      phase: Phase.FreeCouncil,
      tiebreaker: false,
      step: 'corruption-checks',
      currentPlayer: PLAYER_1,
      checkedCharacters: [],
      firstPlayerDone: false,
      pendingCheck: null,
    };
    const start = { ...base, phaseState: fcState };

    const declare = computeLegalActions(start, PLAYER_1)
      .find(ea => ea.viable && ea.action.type === 'corruption-check' && ea.action.characterId === aragorn);
    expect(declare).toBeDefined();
    const declared = dispatch(start, declare!.action);
    expect((declared.phaseState as FreeCouncilPhaseState).pendingCheck?.possessions).toContain(sword);

    const transfer = computeLegalActions(declared, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction)
      .find(a => a.optionId === 'transfer-item' && a.transferItemInstanceId === sword);
    expect(transfer).toBeDefined();
    const transferred = dispatch(declared, transfer!);
    expect(transferred.players[RESOURCE_PLAYER].characters[gimli].items.map(i => i.instanceId)).toContain(sword);

    // Aragorn now bears nothing (CP 0): a roll of 2 succeeds against the
    // live total. Against the frozen CP 2 it would have been a failure that
    // discarded him — and the sword along with him.
    const resolved = dispatch({ ...transferred, cheatRollTotal: 2 }, { type: 'pass', player: PLAYER_1 });
    const p = resolved.players[RESOURCE_PLAYER];
    expect(p.characters[aragorn]).toBeDefined();
    expect(p.characters[gimli].items.map(i => i.instanceId)).toContain(sword);
    expect(p.discardPile.map(c => c.instanceId)).not.toContain(sword);
    // Exactly one copy of the sword exists anywhere.
    const copies = [
      ...Object.values(p.characters).flatMap(c => c.items.map(i => i.instanceId)),
      ...p.discardPile.map(c => c.instanceId),
    ].filter(id => id === sword);
    expect(copies).toHaveLength(1);
  });
});
