/**
 * @module wizards-test-ring-choice.test
 *
 * Regression test for bug report 3e42ddb1e89ecb46 (game mtcx93pk-1pf831, seq
 * 518): with two gold rings on the same wizard, playing Wizard's Test (tw-365)
 * offered "Play on Gandalf" twice with no way to tell which ring each button
 * tests. The engine's legal actions were already correct — one
 * `play-short-event` action per gold ring, each carrying a distinct
 * `targetGoldRingInstanceId` — but `showShortEventTargetMenu`'s label builder
 * only read `targetCharacterId`, so both actions rendered identically.
 *
 * `buildShortEventTargetChoices` now appends the ring's name to the label
 * whenever `targetGoldRingInstanceId` is present.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardDefinition, CardDefinitionId, CardInstanceId, GameAction, PlayerView } from '@meccg/shared';
import { buildShortEventTargetChoices } from './render-hand.js';

const WIZARDS_TEST = 'p1-8' as CardInstanceId;
const GANDALF = 'p1-2' as CardInstanceId;
const FAIR_GOLD_RING = 'p1-25' as CardInstanceId;
const PRECIOUS_GOLD_RING = 'p1-5' as CardInstanceId;

const DEFS: Record<CardInstanceId, CardDefinitionId> = {
  [GANDALF]: 'tw-156' as CardDefinitionId,
  [FAIR_GOLD_RING]: 'tw-231' as CardDefinitionId,
  [PRECIOUS_GOLD_RING]: 'tw-306' as CardDefinitionId,
};

const cardPool: Readonly<Record<string, CardDefinition>> = {
  'tw-156': { name: 'Gandalf' } as CardDefinition,
  'tw-231': { name: 'Fair Gold Ring' } as CardDefinition,
  'tw-306': { name: 'Precious Gold Ring' } as CardDefinition,
};

const lookup = (id: CardInstanceId): CardDefinitionId | undefined => DEFS[id];

const view = {
  self: { id: 'p1' },
  opponent: { name: 'Opponent' },
  chain: undefined,
} as unknown as PlayerView;

/** One play-short-event action per gold ring borne by the target wizard's company. */
const ringTestActions: GameAction[] = [FAIR_GOLD_RING, PRECIOUS_GOLD_RING].map(targetGoldRingInstanceId => ({
  type: 'play-short-event',
  player: 'p1',
  cardInstanceId: WIZARDS_TEST,
  targetCharacterId: GANDALF,
  targetGoldRingInstanceId,
})) as GameAction[];

describe('Wizard\'s Test ring choice is disambiguated by ring name', () => {
  test('each gold ring gets its own distinctly labelled choice', () => {
    const choices = buildShortEventTargetChoices(ringTestActions, lookup, cardPool, view);

    expect(choices).toHaveLength(2);
    const labels = choices.map(c => c.label);
    expect(new Set(labels).size).toBe(2);
    expect(labels).toContain('Play on Gandalf (Fair Gold Ring)');
    expect(labels).toContain('Play on Gandalf (Precious Gold Ring)');
  });

  test('a single target character with no ring choice keeps the plain label', () => {
    const plainAction: GameAction = {
      type: 'play-short-event',
      player: 'p1',
      cardInstanceId: 'p1-9' as CardInstanceId,
      targetCharacterId: GANDALF,
    } as GameAction;

    const choices = buildShortEventTargetChoices([plainAction], lookup, cardPool, view);

    expect(choices).toHaveLength(1);
    expect(choices[0].label).toBe('Play on Gandalf');
  });
});
