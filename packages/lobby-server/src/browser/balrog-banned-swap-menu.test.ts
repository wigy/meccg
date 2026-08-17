/**
 * @module balrog-banned-swap-menu.test
 *
 * CoE 1.8.2 (rule 1.36): a card a Balrog opponent has made unplayable may be
 * removed from the game at any time to bring one sideboard card of any type
 * into the play deck. The engine offers one `swap-banned-vs-balrog` action per
 * sideboard card, so the hand renderer cannot dispatch a click straight
 * through — it opens a menu whose submenu names each sideboard card.
 *
 * The card stays dimmed (it genuinely has no play), so the on-guard option,
 * when a slot is open, must survive alongside the trade: the same card may
 * still be bluffed face-down instead of traded away.
 */

import './test-dom-bootstrap.js'; // must precede the render-hand import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, GameAction, PlayerId } from '@meccg/shared';
import { balrogSwapMenuItems } from './render-hand.js';
import { setCachedInstanceLookup } from './render-text-format.js';

const pool = loadCardPool();

const PLAYER = 'p0' as PlayerId;
const BANNED = 'p0-3' as CardInstanceId; // The Black Council (wh-41) in hand
const SIDEBOARD_A = 'p0-40' as CardInstanceId; // Galadriel — a resource
const SIDEBOARD_B = 'p0-41' as CardInstanceId; // Orc-guard — a hazard

const swapActions: GameAction[] = [
  { type: 'swap-banned-vs-balrog', player: PLAYER, cardInstanceId: BANNED, sideboardCardInstanceId: SIDEBOARD_A },
  { type: 'swap-banned-vs-balrog', player: PLAYER, cardInstanceId: BANNED, sideboardCardInstanceId: SIDEBOARD_B },
] as GameAction[];

const onGuardAction: GameAction = {
  type: 'place-on-guard',
  player: PLAYER,
  cardInstanceId: BANNED,
} as GameAction;

describe('a Balrog-banned hand card offers the sideboard trade', () => {
  test('the submenu names every sideboard card the trade may take', () => {
    setCachedInstanceLookup((id: CardInstanceId): CardDefinitionId | undefined =>
      id === SIDEBOARD_A ? ('tw-153' as CardDefinitionId)
        : id === SIDEBOARD_B ? ('tw-072' as CardDefinitionId)
          : undefined);
    const dispatched: GameAction[] = [];

    const items = balrogSwapMenuItems(swapActions, a => dispatched.push(a), undefined, pool);

    expect(items).toHaveLength(1);
    expect(items[0].label).toMatch(/sideboard card/);
    expect(items[0].children?.map(c => c.label)).toEqual([
      pool['tw-153' as CardDefinitionId].name,
      pool['tw-072' as CardDefinitionId].name,
    ]);

    items[0].children?.[1].onClick?.();
    expect(dispatched).toEqual([swapActions[1]]);
  });

  test('an open on-guard slot is offered alongside the trade', () => {
    setCachedInstanceLookup(() => undefined);
    const dispatched: GameAction[] = [];

    const items = balrogSwapMenuItems(swapActions, a => dispatched.push(a), onGuardAction, pool);

    expect(items.map(i => i.label)).toContain('Place on-guard');
    items.find(i => i.label === 'Place on-guard')?.onClick?.();
    expect(dispatched).toEqual([onGuardAction]);
  });
});
