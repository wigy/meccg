/**
 * @module move-to-influence-blocked.test
 *
 * Feature (from a report on game mv6u14rg-vjyt2o): Gimli carried Wizard's
 * Myrmidon ("may only be controlled by general influence or a Fallen-wizard")
 * and controlled a follower, so the engine correctly refused to move him
 * under Glóin's direct influence. The browser used to show only allowed moves,
 * so Gimli simply was not clickable and nothing said why — correct behaviour
 * looked like a bug.
 *
 * The engine now reports refused move-to-influence pairs as non-viable
 * entries with a reason. This test checks that a character whose only
 * influence moves are blocked stays clickable, and that the action tooltip
 * lists each blocked move as a disabled button carrying the reason, which
 * sends nothing when clicked.
 *
 * Uses the hand-rolled DOM stub from character-self-granted-action-click.test.ts
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the company-block import (load-time window access)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadCardPool, CardStatus } from '@meccg/shared';
import type {
  PlayerView,
  Company,
  CharacterInPlay,
  CardDefinitionId,
  CardInstanceId,
  PlayerId,
  MoveToInfluenceAction,
  EvaluatedAction,
} from '@meccg/shared';
import { renderCompanyBlock } from './company-block.js';
import { getMoveToInfluenceActions, getBlockedMoveToInfluenceActions } from './company-actions.js';
import { setCachedInstanceLookup } from './company-view-state.js';

const pool = loadCardPool();

const GIMLI = 'tw-159' as CardDefinitionId;
const GLOIN = 'tw-160' as CardDefinitionId;

const PLAYER = 'p1' as PlayerId;
const GIMLI_INST = 'p1-10' as CardInstanceId;
const GLOIN_INST = 'p1-11' as CardInstanceId;

const COMPANY_ID = 'company-p1-0';

const REASON = 'Gimli may only be controlled by general influence or a Fallen-wizard (Wizard’s Myrmidon)';

// --- Minimal DOM stub, extended with body/querySelector/getBoundingClientRect
// so showTooltipMenu can run. -------------------------------------------------

class StubEl {
  tagName: string;
  children: StubEl[] = [];
  className = '';
  alt = '';
  src = '';
  textContent = '';
  title = '';
  disabled = false;
  dataset: Record<string, string> = {};
  style: Record<string, unknown> & { setProperty: () => void } = { setProperty: () => { /* no-op */ } };
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    contains: (c: string) => this.classList.classes.has(c),
  };
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  addEventListener(type: string, handler: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(handler);
  }
  click(): void {
    for (const h of this.listeners.click ?? []) h({ stopPropagation: () => { /* no-op */ }, currentTarget: this, target: this });
  }
  getBoundingClientRect(): { top: number; left: number; right: number; bottom: number; width: number; height: number } {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }
  get childElementCount(): number { return this.children.length; }
  set innerHTML(v: string) { if (v === '') this.children = []; }
  get innerHTML(): string { return ''; }
  /** Depth-first collect self + every descendant. */
  all(): StubEl[] { return [this, ...this.children.flatMap(c => c.all())]; }
}

let bodyStub: StubEl;

beforeEach(() => {
  bodyStub = new StubEl('body');
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: () => null,
    querySelector: () => null,
    body: bodyStub,
  };
  (globalThis as unknown as { window: unknown }).window = { innerWidth: 1024, innerHeight: 768 };
  setCachedInstanceLookup((id: CardInstanceId) =>
    id === GIMLI_INST ? GIMLI : id === GLOIN_INST ? GLOIN : undefined);
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

// --- View fixtures ----------------------------------------------------------

const character = (instanceId: CardInstanceId, definitionId: CardDefinitionId): CharacterInPlay => ({
  instanceId,
  definitionId,
  status: CardStatus.Untapped,
  items: [],
  allies: [],
  hazards: [],
  followers: [],
  controlledBy: 'general',
  effectiveStats: { prowess: 5, body: 8, directInfluence: 2, corruptionPoints: 0 },
} as unknown as CharacterInPlay);

const company = {
  id: COMPANY_ID,
  characters: [GLOIN_INST, GIMLI_INST],
  currentSite: null,
  siteCardOwned: true,
  destinationSite: null,
  movementPath: [],
  onGuardCards: [],
  moved: false,
} as unknown as Company;

const gimliUnderGloin: MoveToInfluenceAction = {
  type: 'move-to-influence',
  player: PLAYER,
  characterInstanceId: GIMLI_INST,
  controlledBy: GLOIN_INST,
};

function boardView(legalActions: EvaluatedAction[]): PlayerView {
  return {
    self: {
      id: 'p1',
      companies: [company],
      characters: {
        [GIMLI_INST as string]: character(GIMLI_INST, GIMLI),
        [GLOIN_INST as string]: character(GLOIN_INST, GLOIN),
      },
      cardsInPlay: [],
    },
    opponent: { id: 'p2', companies: [], characters: {}, cardsInPlay: [] },
    activePlayer: 'p1',
    phaseState: { phase: 'organization' },
    legalActions,
  } as unknown as PlayerView;
}

const findImg = (block: StubEl, instId: CardInstanceId): StubEl | undefined =>
  block.all().find(e => e.tagName === 'img' && e.dataset.instanceId === (instId as string));

describe('blocked move-to-influence reasons in the company view', () => {
  test('a character with only blocked moves is clickable and the menu shows the reason', () => {
    const onAction = vi.fn();
    const view = boardView([{ action: gimliUnderGloin, viable: false, reason: REASON }]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      influenceActions: getMoveToInfluenceActions(view),
      blockedInfluenceActions: getBlockedMoveToInfluenceActions(view),
    }) as unknown as StubEl;

    const img = findImg(block, GIMLI_INST);
    expect(img).toBeDefined();
    // Clickable, but without the "action available" glow.
    expect(img!.listeners.click?.length ?? 0).toBeGreaterThan(0);
    expect(img!.classList.contains('company-card--influence-source')).toBe(false);

    img!.click();

    const tooltip = bodyStub.all().find(e => e.className === 'char-action-tooltip');
    expect(tooltip).toBeDefined();
    const buttons = tooltip!.children.filter(c => c.tagName === 'button');
    expect(buttons).toHaveLength(1);
    const btn = buttons[0];
    expect(btn.className).toContain('char-action-tooltip__btn--disabled');
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe(REASON);
    expect(btn.textContent).toBe('Move under DI of Glóin');
    expect(btn.children.some(c => c.className === 'char-action-tooltip__reason' && c.textContent === REASON)).toBe(true);

    // Clicking the disabled entry sends nothing.
    btn.click();
    expect(onAction).not.toHaveBeenCalled();
  });

  test('allowed moves stay clickable menu entries next to blocked ones', () => {
    const onAction = vi.fn();
    const toGI: MoveToInfluenceAction = { ...gimliUnderGloin, controlledBy: 'general' };
    const view = boardView([
      { action: toGI, viable: true },
      { action: gimliUnderGloin, viable: false, reason: REASON },
    ]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction,
      influenceActions: getMoveToInfluenceActions(view),
      blockedInfluenceActions: getBlockedMoveToInfluenceActions(view),
    }) as unknown as StubEl;

    findImg(block, GIMLI_INST)!.click();

    const tooltip = bodyStub.all().find(e => e.className === 'char-action-tooltip');
    const buttons = tooltip!.children.filter(c => c.tagName === 'button');
    expect(buttons.map(b => b.disabled)).toEqual([false, true]);

    buttons[0].click();
    expect(onAction).toHaveBeenCalledWith(toGI);
  });

  test('without any move-to-influence entry the character is not clickable', () => {
    const view = boardView([]);
    const block = renderCompanyBlock(company, view.self.characters, view, pool, 'self', {
      onAction: vi.fn(),
      influenceActions: getMoveToInfluenceActions(view),
      blockedInfluenceActions: getBlockedMoveToInfluenceActions(view),
    }) as unknown as StubEl;

    expect(findImg(block, GIMLI_INST)!.listeners.click ?? []).toHaveLength(0);
  });
});
