/**
 * @module double-dealing-site-target.test
 *
 * Regression test for bug 438d0869daf6313a: clicking a site-targeting permanent
 * event (Double-dealing wh-66) in hand bound it to an arbitrary company instead
 * of the one the player had focused on the board. With a Fallen-wizard fielding
 * several companies, the engine offers one `play-permanent-event` action per
 * company at a matching site; the hand renderer used to take the first such
 * action, silently dropping the card on the wrong site. `findCardAction` now
 * defaults the target to the focused company's current site.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import type { CardDefinitionId, CardInstanceId, GameAction } from '@meccg/shared';
import { findCardAction } from './render-hand.js';

const DOUBLE_DEALING = 'wh-66' as CardDefinitionId;
const DD_INSTANCE = 'p1-9' as CardInstanceId;

// Three sites, one per company the Fallen-wizard fields.
const ETTENMOORS = 'le-373' as CardDefinitionId;   // first company in the list
const WH_56 = 'wh-56' as CardDefinitionId;
const WORTHY_HILLS = 'le-415' as CardDefinitionId;  // the focused company's site

const lookup = (id: CardInstanceId): CardDefinitionId | undefined =>
  (id === DD_INSTANCE ? DOUBLE_DEALING : undefined);

/** One play-permanent-event action per company at a matching site. */
const siteActions: GameAction[] = [ETTENMOORS, WH_56, WORTHY_HILLS].map(siteDef => ({
  type: 'play-permanent-event',
  player: 'p1',
  cardInstanceId: DD_INSTANCE,
  targetSiteDefinitionId: siteDef,
})) as GameAction[];

describe('Double-dealing site target defaults to the focused company', () => {
  test('targets the focused company\'s site, not the first company', () => {
    const action = findCardAction(DOUBLE_DEALING, siteActions, lookup, WORTHY_HILLS);
    expect(action).not.toBeNull();
    expect(action?.type).toBe('play-permanent-event');
    expect((action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(WORTHY_HILLS);
  });

  test('falls back to the first site when no company is focused', () => {
    const action = findCardAction(DOUBLE_DEALING, siteActions, lookup, undefined);
    expect((action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(ETTENMOORS);
  });

  test('falls back to the first site when the focused site has no action', () => {
    // Focused company sits somewhere with no matching action — keep a usable default.
    const action = findCardAction(DOUBLE_DEALING, siteActions, lookup, 'le-999' as CardDefinitionId);
    expect((action as { targetSiteDefinitionId?: CardDefinitionId }).targetSiteDefinitionId).toBe(ETTENMOORS);
  });
});
