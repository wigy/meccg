/**
 * @module tw-253.test
 *
 * Card test: Halfling Strength (tw-253)
 * Type: hero-resource-event (short)
 * Effects: play-target character (filter: hobbit) + three play-option DSL effects
 *
 * "Hobbit only. The Hobbit may untap or he may move from wounded status
 *  to well and untapped during his organization phase or he may receive
 *  a +4 modification to one corruption check."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                   |
 * |---|------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Target = hobbit (DSL filter)             | IMPLEMENTED | play-target filter target.race hobbit   |
 * | 2 | Option: untap tapped hobbit              | IMPLEMENTED | play-option apply:set-character-status  |
 * | 3 | Option: heal wounded hobbit              | IMPLEMENTED | play-option apply:set-character-status  |
 * | 4 | Option: +4 corruption check boost        | IMPLEMENTED | play-option apply:add-constraint        |
 * | 5 | Boost gated by target.corruptionPoints>0 | IMPLEMENTED | DSL when on target.corruptionPoints     |
 * | 6 | Corruption boost consumed after check    | IMPLEMENTED | constraint cleared in pending-reducers  |
 * | 7 | Not playable without hobbits             | IMPLEMENTED | no eligible targets → not-playable      |
 * | 8 | Not playable on non-hobbits              | IMPLEMENTED | DSL filter excludes non-hobbits         |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO, FRODO, HALFLING_STRENGTH, PRECIOUS_GOLD_RING,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  pool, CardStatus,
} from '../test-helpers.js';
import type {
  HeroResourceEventCard,
  CardInstanceId,
  PlayShortEventAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { addConstraint, enqueueResolution } from '../../engine/pending.js';

describe('Halfling Strength (tw-253)', () => {
  beforeEach(() => resetMint());

  test('card definition declares hobbit filter and three play-option effects', () => {
    const def = pool[HALFLING_STRENGTH as string] as HeroResourceEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-resource-event');
    expect(def.eventType).toBe('short');

    const playTarget = def.effects?.find(e => e.type === 'play-target');
    expect(playTarget).toBeDefined();
    expect(playTarget?.target).toBe('character');
    expect((playTarget as { filter?: unknown }).filter)
      .toEqual({ 'target.race': 'hobbit' });

    const options = (def.effects ?? []).filter(e => e.type === 'play-option');
    expect(options.map(o => (o as { id: string }).id).sort())
      .toEqual(['corruption-check-boost', 'heal', 'untap']);
  });

  test('generates untap and corruption-check-boost actions for a tapped hobbit carrying CP', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, status: CardStatus.Tapped, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const modes = actions.map(a => a.optionId);
    expect(modes).toContain('untap');
    expect(modes).toContain('corruption-check-boost');
    expect(modes).not.toContain('heal');
  });

  test('generates heal and corruption-check-boost actions for a wounded hobbit carrying CP', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, status: CardStatus.Inverted, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const modes = actions.map(a => a.optionId);
    expect(modes).toContain('heal');
    expect(modes).toContain('corruption-check-boost');
    expect(modes).not.toContain('untap');
  });

  test('generates only corruption-check-boost for an untapped hobbit carrying CP', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions).toHaveLength(1);
    expect(actions[0].optionId).toBe('corruption-check-boost');
  });

  test('corruption-check-boost is not playable on a hobbit with zero corruption points (cards-without-effect rule)', () => {
    // Bilbo is untapped, well, and carrying nothing. No upcoming corruption
    // check would be affected by the +4, so per CoE "cannot play cards
    // without effect" the boost option must not appear — and since the
    // other two options require tapped/wounded status, the card itself
    // cannot be played at all.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [BILBO] }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(playActions).toHaveLength(0);

    const hsInstanceId = base.players[0].hand[0].instanceId;
    const notPlayable = computeLegalActions(base, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === hsInstanceId);
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('not playable when player has no hobbits', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const playActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(playActions).toHaveLength(0);

    const notPlayable = computeLegalActions(base, PLAYER_1)
      .filter(ea => !ea.viable && ea.action.type === 'not-playable'
        && (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId === base.players[0].hand[0].instanceId);
    expect(notPlayable.length).toBeGreaterThan(0);
  });

  test('generates actions for multiple hobbits honoring per-hobbit CP state', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              // Bilbo untapped + no items (CP 0): zero options
              BILBO,
              // Frodo tapped + gold ring (CP 1): untap + corruption-check-boost
              { defId: FRODO, status: CardStatus.Tapped, items: [PRECIOUS_GOLD_RING] },
            ],
          }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const frodoId = base.players[0].companies[0].characters[1];
    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions).toHaveLength(2);
    for (const a of actions) {
      expect(a.targetCharacterId).toBe(frodoId);
    }
    const modes = actions.map(a => a.optionId).sort();
    expect(modes).toEqual(['corruption-check-boost', 'untap']);
  });

  test('playing untap mode untaps the hobbit and discards the card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, status: CardStatus.Tapped }] }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = base.players[0].companies[0].characters[0];
    const hsInstance = base.players[0].hand[0].instanceId;

    const result = reduce(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      optionId: 'untap',
    });

    expect(result.error).toBeUndefined();
    expect(result.state.players[0].characters[bilboId as string].status).toBe(CardStatus.Untapped);
    expect(result.state.players[0].hand).toHaveLength(0);
    expect(result.state.players[0].discardPile.some(c => c.instanceId === hsInstance)).toBe(true);
  });

  test('playing heal mode heals wounded hobbit to untapped and discards the card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, status: CardStatus.Inverted }] }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = base.players[0].companies[0].characters[0];
    const hsInstance = base.players[0].hand[0].instanceId;

    const result = reduce(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      optionId: 'heal',
    });

    expect(result.error).toBeUndefined();
    expect(result.state.players[0].characters[bilboId as string].status).toBe(CardStatus.Untapped);
    expect(result.state.players[0].hand).toHaveLength(0);
    expect(result.state.players[0].discardPile.some(c => c.instanceId === hsInstance)).toBe(true);
  });

  test('playing corruption-check-boost adds active constraint and discards the card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [{ defId: BILBO, items: [PRECIOUS_GOLD_RING] }] }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = base.players[0].companies[0].characters[0];
    const hsInstance = base.players[0].hand[0].instanceId;

    const result = reduce(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      optionId: 'corruption-check-boost',
    });

    expect(result.error).toBeUndefined();
    expect(result.state.activeConstraints).toHaveLength(1);
    const constraint = result.state.activeConstraints[0];
    expect(constraint.kind.type).toBe('check-modifier');
    if (constraint.kind.type === 'check-modifier') {
      expect(constraint.kind.check).toBe('corruption');
      expect(constraint.kind.value).toBe(4);
    }
    expect(constraint.target).toEqual({ kind: 'character', characterId: bilboId });
    expect(constraint.scope.kind).toBe('until-cleared');
    expect(result.state.players[0].hand).toHaveLength(0);
    expect(result.state.players[0].discardPile.some(c => c.instanceId === hsInstance)).toBe(true);
  });

  test('corruption-check-boost adds +4 to corruption check modifier', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [BILBO] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = base.players[0].companies[0].characters[0];

    const boosted = addConstraint(base, {
      source: 'hs-1' as CardInstanceId,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: bilboId },
      kind: { type: 'check-modifier', check: 'corruption', value: 4 },
    });

    const withCheck = enqueueResolution(boosted, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: {
        type: 'corruption-check',
        characterId: bilboId,
        modifier: 0,
        reason: 'test',
        possessions: [],
        transferredItemId: null,
      },
    });

    const checkActions = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(checkActions).toHaveLength(1);
    const checkAction = checkActions[0].action as { corruptionModifier: number };
    // Bilbo has corruptionModifier: 4, plus +4 from constraint = 8
    expect(checkAction.corruptionModifier).toBe(4 + 4);
  });

  test('corruption-check-boost constraint is consumed after corruption check resolves', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [BILBO] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const bilboId = base.players[0].companies[0].characters[0];

    const boosted = addConstraint(base, {
      source: 'hs-1' as CardInstanceId,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: bilboId },
      kind: { type: 'check-modifier', check: 'corruption', value: 4 },
    });

    const withCheck = enqueueResolution(boosted, {
      source: null,
      actor: PLAYER_1,
      scope: { kind: 'phase', phase: Phase.Organization },
      kind: {
        type: 'corruption-check',
        characterId: bilboId,
        modifier: 0,
        reason: 'test',
        possessions: [],
        transferredItemId: null,
      },
    });

    // Force a high roll so the check passes
    const stateWithCheat = { ...withCheck, cheatRollTotal: 12 };

    const checkActions = computeLegalActions(stateWithCheat, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(checkActions).toHaveLength(1);

    const result = reduce(stateWithCheat, checkActions[0].action);
    expect(result.error).toBeUndefined();
    expect(result.state.activeConstraints.filter(c => c.kind.type === 'check-modifier')).toHaveLength(0);
  });
});
