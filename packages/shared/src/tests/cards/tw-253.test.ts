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
 * The untap / heal options are normal organization-phase plays gated on
 * the hobbit's status. The `corruption-check-boost` option is a reactive
 * play available only while a corruption-check resolution is pending for
 * the targeted hobbit (per CoE "cannot play cards without effect" —
 * without a check to modify, the boost would have no effect).
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                   |
 * |---|------------------------------------------|-------------|-----------------------------------------|
 * | 1 | Target = hobbit (DSL filter)             | IMPLEMENTED | play-target filter target.race hobbit   |
 * | 2 | Option: untap tapped hobbit              | IMPLEMENTED | play-option apply:set-character-status  |
 * | 3 | Option: heal wounded hobbit              | IMPLEMENTED | play-option apply:set-character-status  |
 * | 4 | Option: +4 corruption check boost        | IMPLEMENTED | play-option apply:add-constraint        |
 * | 5 | Boost only while facing a corruption cc  | IMPLEMENTED | when pending.corruptionCheckTargetsMe   |
 * | 6 | Boost scanned from hand during cc window | IMPLEMENTED | corruptionCheckActions hand scan        |
 * | 7 | Boost applied constraint hits the roll   | IMPLEMENTED | constraint feeds totalModifier          |
 * | 8 | Boost constraint consumed after roll     | IMPLEMENTED | constraint cleared in pending-reducers  |
 * | 9 | Not playable without hobbits             | IMPLEMENTED | no eligible targets → not-playable      |
 * |10 | Not playable on non-hobbits              | IMPLEMENTED | DSL filter excludes non-hobbits         |
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

  test('organization phase: tapped hobbit offers only the untap option', () => {
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

    expect(actions.map(a => a.optionId)).toEqual(['untap']);
  });

  test('organization phase: wounded hobbit offers only the heal option', () => {
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

    expect(actions.map(a => a.optionId)).toEqual(['heal']);
  });

  test('organization phase: healthy untapped hobbit offers no play options (card not playable)', () => {
    // No pending corruption check → boost has no effect. Hobbit is
    // untapped and well → neither untap nor heal has an effect.
    // Per CoE "cannot play cards without effect", the entire card is
    // not playable here.
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

  test('organization phase: only hobbits in a state that needs untap or heal are offered', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{
            site: RIVENDELL,
            characters: [
              // Bilbo untapped + well: no option applies → no action
              BILBO,
              // Frodo tapped: only untap option applies
              { defId: FRODO, status: CardStatus.Tapped },
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

    expect(actions).toHaveLength(1);
    expect(actions[0].targetCharacterId).toBe(frodoId);
    expect(actions[0].optionId).toBe('untap');
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

  test('corruption-check-boost is offered only while the targeted hobbit faces a pending corruption check', () => {
    // Halfling Strength in hand; Bilbo untapped and well. Without a
    // pending corruption check the card offers nothing.
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

    // No pending check → no play-short-event action.
    const noneActions = computeLegalActions(base, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event');
    expect(noneActions).toHaveLength(0);

    // Enqueue a pending corruption check on Bilbo. Now the reactive
    // boost play should appear alongside the mandatory roll.
    const withCheck = enqueueResolution(base, {
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

    const reactiveActions = computeLegalActions(withCheck, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-short-event')
      .map(ea => ea.action as PlayShortEventAction);
    expect(reactiveActions).toHaveLength(1);
    expect(reactiveActions[0].cardInstanceId).toBe(hsInstance);
    expect(reactiveActions[0].targetCharacterId).toBe(bilboId);
    expect(reactiveActions[0].optionId).toBe('corruption-check-boost');
  });

  test('playing corruption-check-boost during a pending check applies the constraint and keeps the check queued', () => {
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

    const withCheck = enqueueResolution(base, {
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

    const result = reduce(withCheck, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: hsInstance,
      targetCharacterId: bilboId,
      optionId: 'corruption-check-boost',
    });

    expect(result.error).toBeUndefined();
    // Constraint added.
    expect(result.state.activeConstraints).toHaveLength(1);
    const constraint = result.state.activeConstraints[0];
    expect(constraint.kind.type).toBe('check-modifier');
    if (constraint.kind.type === 'check-modifier') {
      expect(constraint.kind.check).toBe('corruption');
      expect(constraint.kind.value).toBe(4);
    }
    // Pending corruption check is still queued.
    expect(result.state.pendingResolutions).toHaveLength(1);
    expect(result.state.pendingResolutions[0].kind.type).toBe('corruption-check');
    // Card consumed from hand.
    expect(result.state.players[0].hand).toHaveLength(0);
    expect(result.state.players[0].discardPile.some(c => c.instanceId === hsInstance)).toBe(true);

    // The next legal corruption-check action now carries the boosted
    // modifier (Bilbo's base +4 plus the freshly-added +4 constraint).
    const nextCheckActions = computeLegalActions(result.state, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'corruption-check');
    expect(nextCheckActions).toHaveLength(1);
    const checkAction = nextCheckActions[0].action as { corruptionModifier: number };
    expect(checkAction.corruptionModifier).toBe(4 + 4);
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
