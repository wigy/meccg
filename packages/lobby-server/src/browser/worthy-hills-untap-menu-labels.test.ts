/**
 * @module worthy-hills-untap-menu-labels.test
 *
 * Regression test for bug report 7e7c3f9bfcd4e91a (game mtyrfxqd-lsjxi3, seq
 * 720): The Worthy Hills' (as-142) untap-site ability offers one
 * `activate-granted-action` per (sage, scout) pair — two sages (Bilbo,
 * Gandalf) each pairing with three other untapped scouts produced six
 * actions sharing the `untap-site` actionId. `buildGrantedActionMenuItems`
 * disambiguated same-actionId entries by the *acting* character's name only
 * (`action.characterId`, the sage), never looking at `secondCharacterId` (the
 * scout that pays the second half of the cost) — so the menu rendered three
 * indistinguishable "Bilbo" buttons and three indistinguishable "Gandalf"
 * buttons, with no way to tell which scout each button would tap.
 *
 * Fixed by naming both the acting character and the second character in the
 * label whenever `secondCharacterId` is present.
 */

import './test-dom-bootstrap.js'; // must precede the company-modals import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { ActivateGrantedAction, CardDefinitionId, CardInstanceId, PlayerId } from '@meccg/shared';
import { buildGrantedActionMenuItems } from './company-modals.js';

const pool = loadCardPool();

const SITE = 'p1-111' as CardInstanceId; // as-142, The Worthy Hills

const BILBO = 'p1-120' as CardInstanceId; // tw-131, sage + scout
const GANDALF = 'p1-0' as CardInstanceId; // tw-156, sage + scout
const ARAGORN = 'p1-119' as CardInstanceId; // tw-120, scout
const SAM = 'p1-125' as CardInstanceId; // tw-180, scout

const DEF_BY_INSTANCE: Readonly<Record<string, CardDefinitionId>> = {
  [BILBO]: 'tw-131' as CardDefinitionId,
  [GANDALF]: 'tw-156' as CardDefinitionId,
  [ARAGORN]: 'tw-120' as CardDefinitionId,
  [SAM]: 'tw-180' as CardDefinitionId,
};

const resolveName = (id: CardInstanceId): string | undefined => {
  const defId = DEF_BY_INSTANCE[id as string];
  return defId ? pool[defId as string]?.name : undefined;
};

/** One `activate-granted-action` per (sage, scout) candidate pair, as emitted by site.ts. */
const untapSiteAction = (sage: CardInstanceId, scout: CardInstanceId): ActivateGrantedAction => ({
  type: 'activate-granted-action',
  player: 'p1' as PlayerId,
  characterId: sage,
  sourceCardId: SITE,
  sourceCardDefinitionId: 'as-142' as CardDefinitionId,
  actionId: 'untap-site',
  rollThreshold: 0,
  secondCharacterId: scout,
});

const actions: ActivateGrantedAction[] = [
  untapSiteAction(BILBO, ARAGORN),
  untapSiteAction(BILBO, GANDALF),
  untapSiteAction(BILBO, SAM),
  untapSiteAction(GANDALF, ARAGORN),
  untapSiteAction(GANDALF, BILBO),
  untapSiteAction(GANDALF, SAM),
];

describe('The Worthy Hills untap-site menu labels (bug 7e7c3f9bfcd4e91a)', () => {
  test('every entry names both the sage and the scout, so no two labels collide', () => {
    const items = buildGrantedActionMenuItems(actions, () => { /* no-op */ }, resolveName);

    expect(items).toHaveLength(6);
    const labels = items.map(i => i.label);
    expect(new Set(labels).size).toBe(6);
    expect(labels).toContain('Untap Site — Bilbo + Aragorn II');
    expect(labels).toContain('Untap Site — Bilbo + Gandalf');
    expect(labels).toContain('Untap Site — Bilbo + Sam Gamgee');
    expect(labels).toContain('Untap Site — Gandalf + Aragorn II');
    expect(labels).toContain('Untap Site — Gandalf + Bilbo');
    expect(labels).toContain('Untap Site — Gandalf + Sam Gamgee');
  });

  test('picking an entry dispatches the matching (sage, scout) action', () => {
    const dispatched: ActivateGrantedAction[] = [];
    const items = buildGrantedActionMenuItems(actions, a => dispatched.push(a as ActivateGrantedAction), resolveName);

    const entry = items.find(i => i.label === 'Untap Site — Gandalf + Bilbo');
    entry?.onClick?.();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].characterId).toBe(GANDALF);
    expect(dispatched[0].secondCharacterId).toBe(BILBO);
  });
});
