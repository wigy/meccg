/**
 * @module reforging-granted-action-menu.test
 *
 * Regression test for bug report 3bcd1275c546ace7 (game muadixyi-h7t6yh, seq
 * 368, turn 8 organization phase): "Button to click to pick tapping sage and
 * item recipient are only labelled with the name of the sage, meaning you
 * can't tell which individual is being given the item."
 *
 * Reforging (tw-314) offers one `activate-granted-action` per (acting sage,
 * fetched item, recipient) candidate — `storedCardGrantActions` in
 * organization.ts iterates every untapped sage at a Haven in the company, and
 * for each, every qualifying discard-pile item × every company member. With
 * several eligible sages this varies over *three* dimensions at once, unlike
 * The Forge-master (wh-117) where only one bearer can ever tap.
 *
 * `showInPlayGrantedActionMenu` — the menu used for bearer-less stored cards
 * browsed from the marshalling-point pile — rendered every candidate as a
 * plain `openCardGridModal` image grid keyed only by the fetched item's
 * instance, so entries that differed only in acting sage or recipient looked
 * identical and were indistinguishable. Fixed by routing groups that carry a
 * `recipientCharacterId` through the named `buildGrantedActionMenuItems` menu
 * instead, and by having that menu append the acting sage's name whenever it
 * varies within an item's recipient list.
 */

import './test-dom-bootstrap.js'; // must precede the company-modals import (load-time window access)
import { describe, test, expect } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { ActivateGrantedAction, CardDefinitionId, CardInstanceId, PlayerId } from '@meccg/shared';
import { buildGrantedActionMenuItems, showInPlayGrantedActionMenu } from './company-modals.js';
import { setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const REFORGING = 'p1-16' as CardInstanceId; // tw-314, source card (stored at a Haven)
const SAGE_A = 'p1-183' as CardInstanceId; // td-94 Thráin II
const SAGE_B = 'p1-2' as CardInstanceId; // tw-175 Pallando
const SWORD = 'p1-19' as CardInstanceId; // td-161 Valiant Sword
const HAUBERK = 'p1-23' as CardInstanceId; // tw-254 Hauberk of Bright Mail
const RECIPIENT_A = 'p1-183' as CardInstanceId; // Thráin II may also be his own recipient
const RECIPIENT_B = 'p1-9' as CardInstanceId; // tw-185 Vôteli

const DEF_BY_INSTANCE: Readonly<Record<string, CardDefinitionId>> = {
  [SAGE_A]: 'td-94' as CardDefinitionId,
  [SAGE_B]: 'tw-175' as CardDefinitionId,
  [SWORD]: 'td-161' as CardDefinitionId,
  [HAUBERK]: 'tw-254' as CardDefinitionId,
  [RECIPIENT_B]: 'tw-185' as CardDefinitionId,
};

const resolveName = (id: CardInstanceId): string | undefined => {
  const defId = DEF_BY_INSTANCE[id as string];
  return defId ? pool[defId as string]?.name : undefined;
};

/** One `activate-granted-action` per (acting sage, item, recipient) candidate, as emitted by storedCardGrantActions. */
const reforgingAction = (
  characterId: CardInstanceId,
  targetCardId: CardInstanceId,
  recipientCharacterId: CardInstanceId,
): ActivateGrantedAction => ({
  type: 'activate-granted-action',
  player: 'p1' as PlayerId,
  characterId,
  sourceCardId: REFORGING,
  sourceCardDefinitionId: 'tw-314' as CardDefinitionId,
  actionId: 'reforging-retrieve-item',
  rollThreshold: 0,
  targetCardId,
  recipientCharacterId,
});

const actions: ActivateGrantedAction[] = [
  reforgingAction(SAGE_A, SWORD, RECIPIENT_A),
  reforgingAction(SAGE_A, SWORD, RECIPIENT_B),
  reforgingAction(SAGE_B, SWORD, RECIPIENT_A),
  reforgingAction(SAGE_B, SWORD, RECIPIENT_B),
  reforgingAction(SAGE_A, HAUBERK, RECIPIENT_A),
  reforgingAction(SAGE_B, HAUBERK, RECIPIENT_B),
];

describe('Reforging grant-action menu labels (bug 3bcd1275c546ace7)', () => {
  test('each recipient entry also names the acting sage when more than one sage is eligible', () => {
    const items = buildGrantedActionMenuItems(actions, () => {}, resolveName);

    const swordEntry = items.find(i => i.label.includes('Valiant Sword'));
    expect(swordEntry).toBeDefined();
    const swordLabels = swordEntry?.children?.map(c => c.label) ?? [];
    expect(swordLabels).toContain('to Thráin II (Thráin II taps)');
    expect(swordLabels).toContain('to Vôteli (Thráin II taps)');
    expect(swordLabels).toContain('to Thráin II (Pallando taps)');
    expect(swordLabels).toContain('to Vôteli (Pallando taps)');
    // Every label is distinct — no two entries look the same.
    expect(new Set(swordLabels).size).toBe(swordLabels.length);
  });

  test('picking a fully-disambiguated entry dispatches the matching (sage, item, recipient) action', () => {
    const dispatched: ActivateGrantedAction[] = [];
    const items = buildGrantedActionMenuItems(actions, a => dispatched.push(a as ActivateGrantedAction), resolveName);

    const swordEntry = items.find(i => i.label.includes('Valiant Sword'));
    const entry = swordEntry?.children?.find(c => c.label === 'to Vôteli (Pallando taps)');
    entry?.onClick?.();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].characterId).toBe(SAGE_B);
    expect(dispatched[0].recipientCharacterId).toBe(RECIPIENT_B);
  });

  test('a single-sage source (The Forge-master shape) is unaffected: no "taps" suffix added', () => {
    const singleSageActions = [
      reforgingAction(SAGE_A, SWORD, RECIPIENT_A),
      reforgingAction(SAGE_A, SWORD, RECIPIENT_B),
      reforgingAction(SAGE_A, HAUBERK, RECIPIENT_A),
      reforgingAction(SAGE_A, HAUBERK, RECIPIENT_B),
    ];
    const items = buildGrantedActionMenuItems(singleSageActions, () => {}, resolveName);
    const swordEntry = items.find(i => i.label.includes('Valiant Sword'));
    const swordLabels = swordEntry?.children?.map(c => c.label) ?? [];
    expect(swordLabels).toContain('to Thráin II');
    expect(swordLabels).toContain('to Vôteli');
  });
});

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  style: Record<string, unknown> = {};
  textContent = '';
  listeners: Record<string, ((e: unknown) => void)[]> = {};

  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners.click ?? []) h({ stopPropagation: () => { /* no-op */ } });
  }
  getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number } {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  remove(): void { /* no-op */ }
  querySelector(selector: string): StubEl | null {
    return this.children.find(c => `.${c.className.split(' ')[0]}` === selector) ?? null;
  }
}

describe('showInPlayGrantedActionMenu routes multi-recipient stored-card abilities to the named menu', () => {
  test('opening the ability from the marshalling-point pile shows named entries, not a bare image grid', () => {
    setCachedInstanceLookup((id: CardInstanceId) => DEF_BY_INSTANCE[id as string]);

    const bodyStub = new StubEl('body');
    (globalThis as unknown as { document: unknown }).document = {
      createElement: (tag: string) => new StubEl(tag),
      querySelector: (selector: string) => bodyStub.querySelector(selector),
      body: bodyStub,
    };
    (globalThis as unknown as { window: unknown }).window = { innerWidth: 1024, innerHeight: 768 };

    const anchor = new StubEl('img') as unknown as HTMLElement;
    let dispatched: ActivateGrantedAction | undefined;
    showInPlayGrantedActionMenu(anchor, actions, pool, a => { dispatched = a as ActivateGrantedAction; });

    // `remove()` is a no-op in this stub, so old tooltips stay in `bodyStub.children`;
    // always take the most recently appended one.
    const lastTooltip = (): StubEl => {
      const matches = bodyStub.children.filter(c => c.className === 'char-action-tooltip');
      return matches[matches.length - 1];
    };

    // Top-level tooltip: one "Retrieve Item from Discard" entry.
    const topTooltip = lastTooltip();
    expect(topTooltip).toBeDefined();
    expect(topTooltip.children).toHaveLength(1);
    expect(topTooltip.children[0].textContent).toBe('Retrieve Item from Discard');

    // Clicking it must NOT open the bare `granted-target` image-grid modal (the
    // reported bug — every duplicate item image looked identical); it must build
    // the named item/recipient/actor menu instead.
    topTooltip.children[0].click();
    expect(bodyStub.children.find(c => c.className === 'granted-target-modal')).toBeUndefined();

    const namedTooltip = lastTooltip();
    expect(namedTooltip).not.toBe(topTooltip);
    const namedLabels = namedTooltip.children.map(c => c.textContent);
    expect(namedLabels.some(l => l.includes('Valiant Sword'))).toBe(true);
    expect(namedLabels.some(l => l.includes('Hauberk of Bright Mail'))).toBe(true);
    expect(dispatched).toBeUndefined(); // nothing fires until a fully-specific entry is chosen

    // Drill into the sword's recipient submenu and confirm every entry names both
    // the recipient and (since two sages are eligible) the acting sage.
    const swordEntry = namedTooltip.children.find(c => c.textContent.includes('Valiant Sword'));
    swordEntry!.click();
    const recipientTooltip = lastTooltip();
    const recipientLabels = recipientTooltip.children.map(c => c.textContent);
    expect(recipientLabels).toContain('to Thráin II (Thráin II taps)');
    expect(recipientLabels).toContain('to Vôteli (Pallando taps)');

    const chosen = recipientTooltip.children.find(c => c.textContent === 'to Vôteli (Pallando taps)');
    chosen!.click();
    expect(dispatched?.characterId).toBe(SAGE_B);
    expect(dispatched?.targetCardId).toBe(SWORD);
    expect(dispatched?.recipientCharacterId).toBe(RECIPIENT_B);
  });
});
