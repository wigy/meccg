/**
 * @module tap-take-item-buttons.test
 *
 * Regression test for bug report d43809ad260bf4fa (game mw1105wx-bfxx58, seq
 * 2756): "was not allowed to play items as expected". After Old Cache (le-213)
 * resolved, the engine offered `tap-take-item` for two characters, but the
 * visual view rendered no control for that action type. Only the Pass button
 * was usable, and it discarded the event with nothing taken.
 *
 * Uses the hand-rolled DOM stub + vi.mock pattern of the sibling tests (the
 * package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-instructions import (load-time window access)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { Phase } from '@meccg/shared';
import type { PlayerView, EvaluatedAction, CardInstanceId, CardDefinitionId, GameAction } from '@meccg/shared';
import type { TooltipMenuItem } from './tooltip-menu.js';

const { showTooltipMenu } = vi.hoisted(() => ({ showTooltipMenu: vi.fn() }));
vi.mock('./tooltip-menu.js', async importOriginal => ({
  ...await importOriginal<typeof import('./tooltip-menu.js')>(),
  showTooltipMenu,
}));

// Vitest hoists the vi.mock call above the static imports below.
import { renderPassButton } from './render-instructions.js';
import { passButtonLabel } from './pass-button-label.js';
import { appState, cardPool } from './app-state.js';

class StubEl {
  textContent = '';
  className = '';
  onclick: (() => void) | null = null;
  children: StubEl[] = [];
  classList = { add: () => undefined, remove: () => undefined, toggle: () => undefined, contains: () => false };
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
  remove(): void { /* tiers start empty in these tests */ }
}

const SAW_TOOTHED_BLADE = 'le-342';
const LIEUTENANT = 'le-20';
const OTHER_CHARACTER = 'le-38';
const DEFS: Record<string, string> = {
  'p1-17': SAW_TOOTHED_BLADE,
  'p1-18': SAW_TOOTHED_BLADE,
  'p1-245': LIEUTENANT,
  'p1-7': OTHER_CHARACTER,
};

const take = (characterId: string, cardInstanceId = 'p1-17', source = 'deck'): EvaluatedAction => ({
  action: { type: 'tap-take-item', player: 'p1', characterId, cardInstanceId, source },
  viable: true,
} as unknown as EvaluatedAction);

const pass: EvaluatedAction = { action: { type: 'pass', player: 'p1' }, viable: true } as EvaluatedAction;

const viewWith = (legalActions: EvaluatedAction[]): PlayerView => ({
  phaseState: { phase: Phase.Site, step: 'play-resources' },
  legalActions,
  pendingEffects: [{ type: 'card-effect', cardInstanceId: 'p1-235', effect: { type: 'tap-take-item' } }],
  self: { id: 'p1' },
  activePlayer: 'p1',
} as unknown as PlayerView);

let tier: StubEl;
let passBtn: StubEl;

beforeEach(() => {
  showTooltipMenu.mockReset();
  tier = new StubEl();
  passBtn = new StubEl();
  const byId: Record<string, StubEl> = {
    'pass-btn': passBtn,
    'waiting-indicator': new StubEl(),
    'tier-in-phase-pass': tier,
    'tier-special': new StubEl(),
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => new StubEl(),
    getElementById: (id: string) => byId[id] ?? null,
    querySelectorAll: () => [],
  };
  appState.lastInstanceLookup = (id: CardInstanceId) => DEFS[id as string] as CardDefinitionId | undefined;
  const pool = cardPool as Record<string, unknown>;
  pool[SAW_TOOTHED_BLADE] = { name: 'Saw-toothed Blade' };
  pool[LIEUTENANT] = { name: 'Lieutenant of Angmar' };
  pool[OTHER_CHARACTER] = { name: 'Other Character' };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
  appState.lastInstanceLookup = () => undefined;
});

describe('tap-take-item buttons (Old Cache le-213)', () => {
  test('offers the item alongside Pass, as seen at seq 2756', () => {
    renderPassButton(viewWith([take('p1-245'), take('p1-7'), pass]), () => undefined);

    expect(tier.children.map(b => b.textContent)).toEqual(['Take Saw-toothed Blade (play deck)']);
    expect(passBtn.textContent).toBe('Done Taking Items');
  });

  test('a lone eligible character takes the item directly', () => {
    const sent: GameAction[] = [];
    const only = take('p1-245');
    renderPassButton(viewWith([only, pass]), a => sent.push(a));

    tier.children[0].onclick?.();

    expect(sent).toEqual([only.action]);
    expect(showTooltipMenu).not.toHaveBeenCalled();
  });

  test('several eligible characters are chosen from a menu naming them', () => {
    const sent: GameAction[] = [];
    const first = take('p1-245');
    const second = take('p1-7');
    renderPassButton(viewWith([first, second, pass]), a => sent.push(a));

    tier.children[0].onclick?.();

    expect(sent).toEqual([]);
    const items = showTooltipMenu.mock.calls[0][1] as TooltipMenuItem[];
    expect(items.map(i => i.label)).toEqual(['Lieutenant of Angmar taps', 'Other Character taps']);
    items[1].onClick?.();
    expect(sent).toEqual([second.action]);
  });

  test('copies in one pile share a button; the same item in another pile gets its own', () => {
    renderPassButton(viewWith([
      take('p1-245', 'p1-17', 'deck'),
      take('p1-245', 'p1-18', 'deck'),
      take('p1-245', 'p1-18', 'sideboard'),
      pass,
    ]), () => undefined);

    expect(tier.children.map(b => b.textContent)).toEqual([
      'Take Saw-toothed Blade (play deck)',
      'Take Saw-toothed Blade (sideboard)',
    ]);
  });

  test('Pass keeps its ordinary label outside the sub-flow', () => {
    const view = { ...viewWith([pass]), pendingEffects: [] } as unknown as PlayerView;
    expect(passButtonLabel(pass.action, view)).toBe('Pass Resources');
  });
});
