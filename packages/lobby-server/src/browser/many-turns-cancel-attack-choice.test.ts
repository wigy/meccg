/**
 * @module many-turns-cancel-attack-choice.test
 *
 * Regression test for bug report bb8b600f9815b9bc (game muffdbb8-s64xuo,
 * seq 921): with Gates of Morning in play, Many Turns and Doublings (td-132)
 * was offered by the engine both as a `cancel-attack` against Lesser Spiders
 * and as `play-short-event` actions (decrease the hazard limit, one per
 * ranger). The hand renderer's `isShortEvent` branch took precedence over the
 * `isCancelAttack` branch, so clicking the card only offered the
 * hazard-limit targets and the attack could not be canceled.
 *
 * The short-event menu now lists the card's cancel-attack actions too, and
 * `buildShortEventTargetChoices` labels them.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardDefinition, CardDefinitionId, CardInstanceId, GameAction, PlayerView } from '@meccg/shared';
import { buildShortEventTargetChoices } from './render-hand.js';

const MANY_TURNS = 'p1-27' as CardInstanceId;
const ANBORN = 'p1-198' as CardInstanceId;

const DEFS: Record<CardInstanceId, CardDefinitionId> = {
  [ANBORN]: 'tw-118' as CardDefinitionId,
};

const cardPool: Readonly<Record<string, CardDefinition>> = {
  'tw-118': { name: 'Anborn' } as CardDefinition,
};

const lookup = (id: CardInstanceId): CardDefinitionId | undefined => DEFS[id];

const view = {
  self: { id: 'p1' },
  opponent: { name: 'Opponent' },
  chain: undefined,
} as unknown as PlayerView;

const cancelAttack: GameAction = {
  type: 'cancel-attack',
  player: 'p1',
  cardInstanceId: MANY_TURNS,
} as GameAction;

const decreaseHazardLimit: GameAction = {
  type: 'play-short-event',
  player: 'p1',
  cardInstanceId: MANY_TURNS,
  targetCharacterId: ANBORN,
  optionId: 'decrease-hazard-limit',
} as GameAction;

describe('Many Turns and Doublings offers cancel-attack alongside decreasing the hazard limit', () => {
  test('both the cancel-attack and the hazard-limit play are listed', () => {
    const choices = buildShortEventTargetChoices([cancelAttack, decreaseHazardLimit], lookup, cardPool, view);

    expect(choices.map(c => c.label)).toEqual(['Cancel attack', 'Play on Anborn']);
    expect(choices[0].action).toBe(cancelAttack);
    expect(choices[1].action).toBe(decreaseHazardLimit);
  });
});
