/**
 * @module combat-discard-item-panel.test
 *
 * Regression test for bug report c7b46bf01b2a5a64 (game mvfak3e5-qgguwa, seq
 * 587): "cannot remove item after the attack". Thief (tw-102) struck Pallando
 * successfully and the engine entered the `discard-item-from-company` combat
 * sub-phase, offering a `discard-item-from-company` action for Orcrist — but
 * the combat arena (which hides the company view during combat) rendered no
 * click target for that action, so the defender had no way to discard.
 */

import './test-dom-bootstrap.js';
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCardPool } from '@meccg/shared';
import type { CardDefinitionId, CardInstanceId, CombatState, DiscardItemFromCompanyAction, PlayerId } from '@meccg/shared';
import { renderDiscardItemPanel } from './combat-discard-item-panel.js';

const pool = loadCardPool();

const ORCRIST_INST = 'p2-20' as CardInstanceId;

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  textContent = '';
  dataset: Record<string, string> = {};
  style: Record<string, unknown> = {};
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners.click ?? []) h({ stopPropagation: () => { /* no-op */ } });
  }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

beforeEach(() => {
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const combat = {
  phase: 'discard-item-from-company',
  defendingPlayerId: 'p2',
  attackingPlayerId: 'p1',
  strikeEffect: 'discard-item',
  discardItemOptions: [
    { instanceId: ORCRIST_INST, definitionId: 'tw-295' as CardDefinitionId, status: 'untapped' },
  ],
} as unknown as CombatState;

const discardOrcrist: DiscardItemFromCompanyAction = {
  type: 'discard-item-from-company',
  player: 'p2' as PlayerId,
  itemInstanceId: ORCRIST_INST,
};

describe('Thief forced item discard in the combat arena', () => {
  test('renders the offered item and clicking it dispatches the discard', () => {
    const onAction = vi.fn();
    const panel = renderDiscardItemPanel(combat, pool, [discardOrcrist], onAction) as unknown as StubEl;

    const img = panel.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (ORCRIST_INST as string));
    expect(img).toBeDefined();

    img!.click();
    expect(onAction).toHaveBeenCalledWith(discardOrcrist);
  });

  test('items without a viable discard action are not clickable', () => {
    const panel = renderDiscardItemPanel(combat, pool, [], vi.fn()) as unknown as StubEl;
    expect(panel.all().some(e => e.tagName === 'img')).toBe(false);
  });
});
