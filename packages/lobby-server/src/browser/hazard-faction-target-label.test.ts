/**
 * @module hazard-faction-target-label.test
 *
 * Regression test for bug 1b282479ee49aefd (game mwcvi8b7-8v38d5, seq 709):
 * with two unique factions in play (Ice-orcs and Men of Dorwinion), clicking
 * Trouble on All Borders (as-40) in hand opened a menu of one `play-hazard`
 * choice per faction, but every choice was labelled just "Play hazard" — the
 * player could not tell which faction each option targeted. Faction-targeting
 * choices now name the faction, in both the hand menu and the action
 * description.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardInstanceId, CompanyId, PlayerId, PlayHazardAction } from '@meccg/shared';
import { describeAction } from '@meccg/shared';
import type { CardDefinition, CardDefinitionId } from '@meccg/shared';
import { hazardPlayLabel } from './render-hand.js';

const TROUBLE = 'p1-86' as CardInstanceId;
const ICE_ORCS = 'p1-22' as CardInstanceId;
const MEN_OF_DORWINION = 'p2-23' as CardInstanceId;

const pool = {
  'as-40': { id: 'as-40', name: 'Trouble on All Borders', cardType: 'hazard-event' },
  'le-270': { id: 'le-270', name: 'Ice-orcs', cardType: 'minion-resource-faction' },
  'tw-278': { id: 'tw-278', name: 'Men of Dorwinion', cardType: 'hero-resource-faction' },
} as unknown as Readonly<Record<string, CardDefinition>>;

const defs: Record<string, string> = { [TROUBLE]: 'as-40', [ICE_ORCS]: 'le-270', [MEN_OF_DORWINION]: 'tw-278' };
const lookup = (id: CardInstanceId) => defs[id as string] as CardDefinitionId | undefined;

const playOn = (factionId: CardInstanceId): PlayHazardAction => ({
  type: 'play-hazard',
  player: 'p1' as PlayerId,
  cardInstanceId: TROUBLE,
  targetCompanyId: 'company-p2-0' as CompanyId,
  targetFactionInstanceId: factionId,
});

describe('faction-targeting hazard choices name the target faction', () => {
  test('hand menu labels each faction choice with the faction name', () => {
    const labels = [ICE_ORCS, MEN_OF_DORWINION].map(id => hazardPlayLabel(playOn(id), lookup, {}, pool));
    expect(labels).toEqual(['Play on Ice-orcs', 'Play on Men of Dorwinion']);
  });

  test('action description names the faction instead of the company', () => {
    const desc = describeAction(playOn(MEN_OF_DORWINION), pool, lookup);
    expect(desc).toContain('Trouble on All Borders');
    expect(desc).toContain('Men of Dorwinion');
    expect(desc).not.toContain('against');
  });
});
