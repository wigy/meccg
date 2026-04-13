/**
 * @module tw-253.test
 *
 * Card test: Halfling Strength (tw-253)
 * Type: hero-resource-event (short)
 * Effects: 1 (play-target own-hobbit)
 *
 * "Hobbit only. The Hobbit may untap or he may move from wounded status
 *  to well and untapped during his organization phase or he may receive
 *  a +4 modification to one corruption check."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                  |
 * |---|------------------------------------------|-------------|----------------------------------------|
 * | 1 | Play target = own hobbit                 | IMPLEMENTED | play-target target:"own-hobbit"        |
 * | 2 | Mode: untap tapped hobbit                | IMPLEMENTED | mode:"untap" in play-short-event       |
 * | 3 | Mode: heal wounded hobbit                | IMPLEMENTED | mode:"heal" in play-short-event        |
 * | 4 | Mode: +4 corruption check boost          | IMPLEMENTED | mode:"corruption-check-boost"          |
 * | 5 | Corruption boost consumed after check    | IMPLEMENTED | constraint cleared in pending-reducers  |
 * | 6 | Not playable without hobbits             | IMPLEMENTED | no actions generated                   |
 * | 7 | Not playable on non-hobbits              | IMPLEMENTED | race filter in ownHobbitActions         |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, BILBO, FRODO, HALFLING_STRENGTH,
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

  test('card definition has play-target own-hobbit effect', () => {
    const def = pool[HALFLING_STRENGTH as string] as HeroResourceEventCard;
    expect(def).toBeDefined();
    expect(def.cardType).toBe('hero-resource-event');
    expect(def.eventType).toBe('short');

    const playTarget = def.effects?.find(e => e.type === 'play-target');
    expect(playTarget).toBeDefined();
    expect(playTarget?.target).toBe('own-hobbit');
  });

  test('generates untap and corruption-check-boost actions for a tapped hobbit', () => {
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

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const modes = actions.map(a => a.mode);
    expect(modes).toContain('untap');
    expect(modes).toContain('corruption-check-boost');
    expect(modes).not.toContain('heal');
  });

  test('generates heal and corruption-check-boost actions for a wounded hobbit', () => {
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

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    const modes = actions.map(a => a.mode);
    expect(modes).toContain('heal');
    expect(modes).toContain('corruption-check-boost');
    expect(modes).not.toContain('untap');
  });

  test('generates only corruption-check-boost for an untapped hobbit', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
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

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    expect(actions).toHaveLength(1);
    expect(actions[0].mode).toBe('corruption-check-boost');
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

  test('generates actions for multiple hobbits', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [BILBO, { defId: FRODO, status: CardStatus.Tapped }] }],
          hand: [HALFLING_STRENGTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const actions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);

    // Bilbo (untapped): corruption-check-boost only
    // Frodo (tapped): untap + corruption-check-boost
    expect(actions).toHaveLength(3);
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
      mode: 'untap',
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
      mode: 'heal',
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

    const bilboId = base.players[0].companies[0].characters[0];
    const hsInstance = base.players[0].hand[0].instanceId;

    const result = reduce(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      mode: 'corruption-check-boost',
    });

    expect(result.error).toBeUndefined();
    expect(result.state.activeConstraints).toHaveLength(1);
    const constraint = result.state.activeConstraints[0];
    expect(constraint.kind.type).toBe('corruption-check-boost');
    if (constraint.kind.type === 'corruption-check-boost') {
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
      kind: { type: 'corruption-check-boost', value: 4 },
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
      kind: { type: 'corruption-check-boost', value: 4 },
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
    expect(result.state.activeConstraints.filter(c => c.kind.type === 'corruption-check-boost')).toHaveLength(0);
  });
});
