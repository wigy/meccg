/**
 * @module draft-stop-empty-confirm.test
 *
 * Regression test for bug report 0b915a2afa9ff659 (game mugai8un-ar1rpa, seq
 * 2): "Unable to select and implement starting party. I can draft but then
 * the game starts... no characters placed." The game log shows the player's
 * very first action was `draft-stop`, six seconds into the game, with zero
 * characters drafted — the bottom-bar pass button (labeled "Done" for
 * `draft-stop`, see pass-button-label.ts) fires unconditionally on click, the
 * same as every other "Continue"/"Pass" button in the game. CoE 1.9 permits
 * stopping the draft with nothing drafted ("no longer wishes to reveal
 * characters"), so the engine correctly accepted it — but unlike an ordinary
 * phase-advance pass, this one forfeits the entire starting company for the
 * rest of the game with no way back. `renderPassButton` now asks for
 * confirmation before dispatching `draft-stop` while nothing has been
 * drafted yet, mirroring the existing confirm-before-dispatch pattern for
 * `concede` and `discard-character`.
 *
 * Uses the hand-rolled DOM stub from render-instructions.test.ts and the
 * `vi.mock('./dialog.js', ...)` pattern from discard-character-click.test.ts.
 */

import './test-dom-bootstrap.js'; // must precede the render-instructions import (load-time window access)
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { Phase } from '@meccg/shared';
import type { PlayerView, EvaluatedAction, DraftPlayerState, CardInstanceId, CardDefinitionId } from '@meccg/shared';

const { showConfirm } = vi.hoisted(() => ({ showConfirm: vi.fn() }));
vi.mock('./dialog.js', () => ({ showConfirm }));

// Vitest hoists the vi.mock call above to the top of the module (before this
// static import runs), so render-instructions picks up the mocked showConfirm.
import { renderPassButton } from './render-instructions.js';

let allCreated: StubEl[] = [];

class StubEl {
  tagName: string;
  textContent = '';
  onclick: (() => void) | null = null;
  parentElement: StubEl | null = null;
  children: StubEl[] = [];
  classList = {
    classes: new Set<string>(),
    add: (...cs: string[]) => { for (const c of cs) this.classList.classes.add(c); },
    remove: (...cs: string[]) => { for (const c of cs) this.classList.classes.delete(c); },
    toggle: (c: string, force?: boolean) => {
      const on = force ?? !this.classList.classes.has(c);
      if (on) this.classList.classes.add(c); else this.classList.classes.delete(c);
    },
    contains: (c: string) => this.classList.classes.has(c),
  };
  constructor(tagName: string) { this.tagName = tagName; allCreated.push(this); }
  set className(value: string) { this.classList.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className(): string { return [...this.classList.classes].join(' '); }
  appendChild(child: StubEl): StubEl { child.parentElement = this; this.children.push(child); return child; }
  remove(): void {
    allCreated = allCreated.filter(e => e !== this);
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(c => c !== this);
      this.parentElement = null;
    }
  }
}

let passBtn: StubEl;
let waitingEl: StubEl;
let tierInPhasePass: StubEl;
let tierSpecial: StubEl;

beforeEach(() => {
  allCreated = [];
  passBtn = new StubEl('button');
  waitingEl = new StubEl('div');
  tierInPhasePass = new StubEl('div');
  tierSpecial = new StubEl('div');
  const byId: Record<string, StubEl | null> = {
    'pass-btn': passBtn,
    'waiting-indicator': waitingEl,
    'tier-in-phase-pass': tierInPhasePass,
    'tier-special': tierSpecial,
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => (id in byId ? byId[id] : null),
    querySelectorAll: (selector: string) => {
      const cls = selector.replace(/^\./, '');
      return allCreated.filter(e => e.classList.contains(cls));
    },
  };
  showConfirm.mockReset();
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const draftStopEval: EvaluatedAction = {
  action: { type: 'draft-stop', player: 'p1' },
  viable: true,
} as EvaluatedAction;

const draftPickEval = (characterInstanceId: CardInstanceId): EvaluatedAction => ({
  action: { type: 'draft-pick', player: 'p1', characterInstanceId },
  viable: true,
} as EvaluatedAction);

const draftPlayerState = (drafted: CardDefinitionId[]): DraftPlayerState => ({
  pool: [],
  drafted: drafted.map((definitionId, i) => ({ instanceId: `p1-${i}` as CardInstanceId, definitionId })),
  draftedStageResources: [],
  currentPick: null,
  stopped: false,
  favourites: [],
} as unknown as DraftPlayerState);

const draftView = (drafted: CardDefinitionId[], legalActions: EvaluatedAction[]): PlayerView => ({
  phaseState: {
    phase: Phase.Setup,
    setupStep: {
      step: 'character-draft',
      round: 1,
      draftState: [draftPlayerState(drafted), draftPlayerState([])],
      setAside: [[], []],
    },
  },
  selfIndex: 0,
  legalActions,
  self: { id: 'p1' },
  activePlayer: null,
} as unknown as PlayerView);

describe('renderPassButton — draft-stop with zero drafted characters', () => {
  test('asks for confirmation before dispatching draft-stop', async () => {
    const onAction = vi.fn();
    showConfirm.mockResolvedValue(true);
    const view = draftView([], [draftStopEval, draftPickEval('p1-98' as CardInstanceId)]);

    renderPassButton(view, onAction);

    expect(passBtn.textContent).toBe('Done');
    passBtn.onclick?.();

    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();

    await Promise.resolve();
    expect(onAction).toHaveBeenCalledWith(draftStopEval.action);
  });

  test('declining the confirmation does not stop the draft', async () => {
    const onAction = vi.fn();
    showConfirm.mockResolvedValue(false);
    const view = draftView([], [draftStopEval, draftPickEval('p1-98' as CardInstanceId)]);

    renderPassButton(view, onAction);
    passBtn.onclick?.();

    await Promise.resolve();
    expect(onAction).not.toHaveBeenCalled();
  });

  test('stopping after at least one character is drafted needs no confirmation', () => {
    const onAction = vi.fn();
    const view = draftView(['tw-141' as CardDefinitionId], [draftStopEval]);

    renderPassButton(view, onAction);
    passBtn.onclick?.();

    expect(showConfirm).not.toHaveBeenCalled();
    expect(onAction).toHaveBeenCalledWith(draftStopEval.action);
  });
});
