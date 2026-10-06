/**
 * @module withdraw-support-ui.test
 *
 * Feature: "a chance to change our minds when supporting" — after tapping a
 * character, ally or item to support a strike or corruption check, the
 * player may untap it again before the roll. The engine offers this as the
 * human-only `withdraw-support` meta-action; `renderWithdrawSupport` must
 * surface every offered withdrawal as a banner button and as a clickable
 * "↶" badge on the supporter's card, each sending exactly that action.
 *
 * Runs against a hand-rolled DOM stub (the package runs vitest in the
 * default node environment, with no jsdom), as tap-preview.test.ts does.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import type { CardInstanceId, GameAction, PlayerId, PlayerView } from '@meccg/shared';
import { renderWithdrawSupport } from './withdraw-support.js';

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  parentElement: StubEl | null = null;
  dataset: Record<string, string> = {};
  textContent = '';
  title = '';
  className = '';
  private classes = new Set<string>();
  private listeners: ((e: { stopPropagation: () => void }) => void)[] = [];
  classList = {
    add: (c: string) => { this.classes.add(c); },
    remove: (c: string) => { this.classes.delete(c); },
    contains: (c: string) => this.classes.has(c),
  };
  constructor(tagName = 'DIV') { this.tagName = tagName; }
  set innerHTML(_v: string) { this.children = []; }
  appendChild(child: StubEl): StubEl {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  addEventListener(_type: string, fn: (e: { stopPropagation: () => void }) => void): void { this.listeners.push(fn); }
  click(): void { for (const fn of this.listeners) fn({ stopPropagation: () => undefined }); }
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
  matches(selector: string): boolean {
    return selector.split(',').map(s => s.trim()).some(sel => {
      if (sel.startsWith('.')) return this.classes.has(sel.slice(1)) || this.className === sel.slice(1);
      const attr = /^\[data-([\w-]+)="([^"]*)"\]$/.exec(sel);
      if (attr) {
        const key = attr[1].replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
        return this.dataset[key] === attr[2];
      }
      return false;
    });
  }
  querySelectorAll(selector: string): StubEl[] {
    return this.children.flatMap(c => c.all()).filter(el => el.matches(selector));
  }
  querySelector(selector: string): StubEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  closest(selector: string): StubEl | null {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
}

const PLAYER = 'p1' as PlayerId;
const ARAGORN = 'p1-5' as CardInstanceId;
const PHIAL = 'p1-9' as CardInstanceId;

let body: StubEl;
let banner: StubEl;
let wrap: StubEl;
const g = globalThis as unknown as { document?: unknown };

beforeEach(() => {
  body = new StubEl();
  banner = body.appendChild(new StubEl());
  banner.classList.add('hidden');
  // Combat overlay column: col[data-combat-char-id] > wrap > img.
  const col = body.appendChild(new StubEl());
  col.dataset.combatCharId = ARAGORN as string;
  wrap = col.appendChild(new StubEl());
  wrap.classList.add('character-card-wrap');
  wrap.appendChild(new StubEl('IMG'));
  g.document = {
    getElementById: (id: string) => (id === 'withdraw-support-banner' ? banner : null),
    createElement: (tag: string) => new StubEl(tag.toUpperCase()),
    querySelectorAll: (sel: string) => body.querySelectorAll(sel),
  };
});

afterEach(() => { delete g.document; });

/** A view offering withdrawal of the given supporters. */
const viewWith = (ids: CardInstanceId[]) => ({
  legalActions: [
    { action: { type: 'pass', player: PLAYER }, viable: true },
    ...ids.map(id => ({ action: { type: 'withdraw-support', player: PLAYER, supportSourceId: id }, viable: true })),
  ],
}) as unknown as PlayerView;

describe('renderWithdrawSupport', () => {
  test('banner lists one button per withdrawable support, each sending its action', () => {
    const sent: GameAction[] = [];
    renderWithdrawSupport(viewWith([ARAGORN, PHIAL]), id => (id === ARAGORN ? 'Aragorn II' : 'Phial of Galadriel'), a => sent.push(a));

    expect(banner.classList.contains('hidden')).toBe(false);
    const buttons = banner.children.filter(c => c.tagName === 'BUTTON');
    expect(buttons.map(b => b.textContent)).toEqual(['↶ Aragorn II', '↶ Phial of Galadriel']);
    buttons[1].click();
    expect(sent).toEqual([{ type: 'withdraw-support', player: PLAYER, supportSourceId: PHIAL }]);
  });

  test('the tapped supporter card gets a clickable badge', () => {
    const sent: GameAction[] = [];
    renderWithdrawSupport(viewWith([ARAGORN]), () => 'Aragorn II', a => sent.push(a));

    const badge = wrap.querySelector('.withdraw-support-badge');
    expect(badge).not.toBeNull();
    badge!.click();
    expect(sent).toEqual([{ type: 'withdraw-support', player: PLAYER, supportSourceId: ARAGORN }]);
  });

  test('nothing is shown when no withdrawal is offered', () => {
    renderWithdrawSupport(viewWith([]), () => '', () => undefined);
    expect(banner.classList.contains('hidden')).toBe(true);
    expect(body.querySelector('.withdraw-support-badge')).toBeNull();
  });
});
