/**
 * @module pledge-of-conduct-transfer-choice.test
 *
 * Regression test for bug report c17f9b0031e78203 / 173367a642b7bc39 (game
 * mu9szs8t-6uu0uj, turn 15, free-council phase): Gamling held Pledge of
 * Conduct (td-144) while Bofur — bearing two items (Durin's Axe tw-212 and a
 * second item) — faced his corruption check alongside two other company
 * members (Thorin II, Nori). The engine correctly offered six
 * `play-short-event` transfer-item actions (2 items x 3 destinations), all
 * sharing the same `targetCharacterId` (Bofur, the checked character).
 *
 * `buildShortEventTargetChoices`'s label builder only read `targetCharacterId`,
 * so all six actions rendered as the identical "Play on Bofur" button with no
 * way to tell which item would go to whom — indistinguishable from a dead
 * card, which is exactly what was reported as "never highlighted or
 * clickable".
 *
 * The label now names the transferred item and its destination whenever
 * `transferItemInstanceId`/`transferToCharacterId` are present.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardDefinition, CardDefinitionId, CardInstanceId, GameAction, PlayerView } from '@meccg/shared';
import { buildShortEventTargetChoices } from './render-hand.js';

const PLEDGE_OF_CONDUCT = 'p2-35' as CardInstanceId;
const BOFUR = 'p2-136' as CardInstanceId;
const THORIN = 'p2-138' as CardInstanceId;
const GIMLI = 'p2-129' as CardInstanceId;
const NORI = 'p2-132' as CardInstanceId;
const DURINS_AXE = 'p2-9' as CardInstanceId;
const OTHER_ITEM = 'p2-134' as CardInstanceId;

const DEFS: Record<CardInstanceId, CardDefinitionId> = {
  [BOFUR]: 'tw-132' as CardDefinitionId,
  [THORIN]: 'tw-183' as CardDefinitionId,
  [GIMLI]: 'tw-159' as CardDefinitionId,
  [NORI]: 'tw-171' as CardDefinitionId,
  [DURINS_AXE]: 'tw-212' as CardDefinitionId,
  [OTHER_ITEM]: 'tw-327' as CardDefinitionId,
};

const cardPool: Readonly<Record<string, CardDefinition>> = {
  'tw-132': { name: 'Bofur' } as CardDefinition,
  'tw-183': { name: 'Thorin II' } as CardDefinition,
  'tw-159': { name: 'Gimli' } as CardDefinition,
  'tw-171': { name: 'Nori' } as CardDefinition,
  'tw-212': { name: 'Durin’s Axe' } as CardDefinition,
  'tw-327': { name: 'Second Item' } as CardDefinition,
};

const lookup = (id: CardInstanceId): CardDefinitionId | undefined => DEFS[id];

const view = {
  self: { id: 'p2' },
  opponent: { name: 'Opponent' },
  chain: undefined,
} as unknown as PlayerView;

/** One play-short-event action per (item, destination) pair, mirroring the engine's offer. */
const transferActions: GameAction[] = [DURINS_AXE, OTHER_ITEM].flatMap(transferItemInstanceId =>
  [THORIN, GIMLI, NORI].map(transferToCharacterId => ({
    type: 'play-short-event',
    player: 'p2',
    cardInstanceId: PLEDGE_OF_CONDUCT,
    targetCharacterId: BOFUR,
    optionId: 'transfer-item',
    transferItemInstanceId,
    transferToCharacterId,
  }))) as GameAction[];

describe('Pledge of Conduct transfer choice is disambiguated by item and destination', () => {
  test('each (item, destination) pair gets its own distinctly labelled choice', () => {
    const choices = buildShortEventTargetChoices(transferActions, lookup, cardPool, view);

    expect(choices).toHaveLength(6);
    const labels = choices.map(c => c.label);
    expect(new Set(labels).size).toBe(6);
    expect(labels).toContain('Transfer Durin’s Axe to Thorin II');
    expect(labels).toContain('Transfer Durin’s Axe to Gimli');
    expect(labels).toContain('Transfer Durin’s Axe to Nori');
    expect(labels).toContain('Transfer Second Item to Thorin II');
    expect(labels).toContain('Transfer Second Item to Gimli');
    expect(labels).toContain('Transfer Second Item to Nori');
  });
});
