/**
 * @module render-instructions.test
 *
 * Regression test for bug report 8093610d9e502973 (game ms6enliw-o6qeah, seq
 * 669): "No UI for rolling." *Muster Disperses* (tw-67) enqueues a generic
 * `dice-check` pending resolution, whose only legal action is
 * `resolve-dice-check`. {@link renderPassButton}'s whitelist of pass-like
 * action types omitted `resolve-dice-check`, so neither the roll button nor
 * the "Waiting…" indicator appeared — the player had no way to trigger the
 * roll. `resolve-dice-check` is now whitelisted with a "Roll" label, matching
 * the other generic roll actions (`roll-initiative`, `corruption-check`, …).
 *
 * Uses the hand-rolled DOM stub pattern of `company-attachments-render.test.ts`
 * (the package runs vitest in the default node environment, with no jsdom).
 */

import './test-dom-bootstrap.js'; // must precede the render-instructions import (load-time window access)
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { Phase } from '@meccg/shared';
import type { PlayerView, EvaluatedAction } from '@meccg/shared';
import { renderPassButton } from './render-instructions.js';

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
  constructor(tagName: string) { this.tagName = tagName; }
  appendChild(child: StubEl): StubEl { this.children.push(child); return child; }
}

let passBtn: StubEl;
let waitingEl: StubEl;

beforeEach(() => {
  passBtn = new StubEl('button');
  waitingEl = new StubEl('div');
  const byId: Record<string, StubEl | null> = {
    'pass-btn': passBtn,
    'waiting-indicator': waitingEl,
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: (tag: string) => new StubEl(tag),
    getElementById: (id: string) => (id in byId ? byId[id] : null),
    querySelectorAll: () => [],
  };
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

const resolveDiceCheck: EvaluatedAction = {
  action: {
    type: 'resolve-dice-check',
    player: 'p1',
    explanation: 'Muster: Iron Hill Dwarves: roll +4 must be >= 11 (need roll >= 7)',
  },
  viable: true,
} as EvaluatedAction;

const viewWith = (legalActions: EvaluatedAction[]): PlayerView =>
  ({
    phaseState: { phase: Phase.MovementHazard, step: null },
    legalActions,
    self: { id: 'p1' },
    activePlayer: 'p1',
  } as unknown as PlayerView);

describe('renderPassButton', () => {
  test('shows a Roll button for a pending resolve-dice-check resolution', () => {
    renderPassButton(viewWith([resolveDiceCheck]), () => { /* no-op */ });

    expect(passBtn.classList.contains('hidden')).toBe(false);
    expect(passBtn.textContent).toBe('Roll');
    expect(waitingEl.classList.contains('hidden')).toBe(true);
  });

  test('clicking the button sends the resolve-dice-check action', () => {
    let sent: unknown = null;
    renderPassButton(viewWith([resolveDiceCheck]), action => { sent = action; });

    passBtn.onclick?.();

    expect(sent).toEqual(resolveDiceCheck.action);
  });
});

/**
 * Regression test for bug report 9bf99530666bb317 (game ms6gbt8d-5na91m, seq
 * 1300): "I must choose a character. Once selected, show Roll button." CoE
 * rule 10.3.i lets the player check their Free Council characters "in the
 * order of that player's choosing." {@link renderPassButton}'s pass-like
 * whitelist matched `corruption-check` unconditionally, so with several
 * unchecked characters it grabbed the first one returned by
 * `legalActions.find` and rendered it as a generic "Roll" button — silently
 * picking a character for the player instead of letting them click one
 * (see company-block.ts's per-character `corruptionCheckActions` map).
 * `corruption-check` is now only treated as a generic roll action when it is
 * the sole viable option.
 */
const corruptionCheckFor = (characterId: string): EvaluatedAction => ({
  action: {
    type: 'corruption-check',
    player: 'p1',
    characterId,
    corruptionPoints: 0,
    corruptionModifier: 0,
    possessions: [],
    need: 1,
    explanation: 'Need roll > 0 (CP 0)',
  },
  viable: true,
} as unknown as EvaluatedAction);

/**
 * Regression test for bug report 0fe157e9aff02fc3 (game ms7pnib4-ofnoo4):
 * "Flatter a Foe was very unintuitive -> no Roll-Button visible, rolling had
 * to be done by pressing Enter." *Flatter a Foe* (td-116) enqueues a
 * `flattery-attempt` pending resolution, whose only legal action is
 * `flattery-attempt`. {@link renderPassButton}'s whitelist of pass-like
 * action types omitted `flattery-attempt`, so neither the roll button nor the
 * "Waiting…" indicator appeared — the same class of bug as the
 * `resolve-dice-check` case above. `flattery-attempt` is now whitelisted with
 * a "Roll" label.
 */
const flatteryAttempt: EvaluatedAction = {
  action: {
    type: 'flattery-attempt',
    player: 'p1',
    characterInstanceId: 'p1-2',
    need: 8,
    explanation: 'Radagast flattery vs orc: threshold 12, unused DI 3, +2 diplomat, → need roll >= 8',
  },
  viable: true,
} as EvaluatedAction;

describe('renderPassButton — flattery-attempt (Flatter a Foe)', () => {
  test('shows a Roll button for a pending flattery-attempt resolution', () => {
    renderPassButton(viewWith([flatteryAttempt]), () => { /* no-op */ });

    expect(passBtn.classList.contains('hidden')).toBe(false);
    expect(passBtn.textContent).toBe('Roll');
    expect(waitingEl.classList.contains('hidden')).toBe(true);
  });

  test('clicking the button sends the flattery-attempt action', () => {
    let sent: unknown = null;
    renderPassButton(viewWith([flatteryAttempt]), action => { sent = action; });

    passBtn.onclick?.();

    expect(sent).toEqual(flatteryAttempt.action);
  });
});

/**
 * Regression test for bug report 168edbd3d46e42b1 (game msagrd6b-wruu03, seq
 * 582): "Stays stuck in resolving. Doesn't resolve. Can't make roll." *Seized
 * by Terror* (dm-88) enqueues a `seized-by-terror-roll` pending resolution,
 * whose only legal action is `seized-by-terror-roll`. {@link renderPassButton}'s
 * whitelist of pass-like action types omitted `seized-by-terror-roll` — the
 * same class of bug as the `resolve-dice-check` and `flattery-attempt` cases
 * above. `seized-by-terror-roll` is now whitelisted with a "Roll" label.
 */
const seizedByTerrorRoll: EvaluatedAction = {
  action: {
    type: 'seized-by-terror-roll',
    player: 'p1',
    targetCharacterId: 'p1-105',
    need: 10,
    explanation: 'Bofur resists Seized by Terror: need roll >= 10 (threshold 12, mind 2)',
  },
  viable: true,
} as EvaluatedAction;

describe('renderPassButton — seized-by-terror-roll (Seized by Terror)', () => {
  test('shows a Roll button for a pending seized-by-terror-roll resolution', () => {
    renderPassButton(viewWith([seizedByTerrorRoll]), () => { /* no-op */ });

    expect(passBtn.classList.contains('hidden')).toBe(false);
    expect(passBtn.textContent).toBe('Roll');
    expect(waitingEl.classList.contains('hidden')).toBe(true);
  });

  test('clicking the button sends the seized-by-terror-roll action', () => {
    let sent: unknown = null;
    renderPassButton(viewWith([seizedByTerrorRoll]), action => { sent = action; });

    passBtn.onclick?.();

    expect(sent).toEqual(seizedByTerrorRoll.action);
  });
});

/**
 * Regression test for bug report bc01c91f52d48674 (game msaaty2h-tgt6iw, seq
 * 477): "AI hangst on Gandalf Ring test." Gandalf's (tw-156) granted
 * `test-gold-ring` action enqueues a `gold-ring-test` pending resolution
 * (CoE rule 6.2), whose only legal action is `gold-ring-test-roll`.
 * {@link renderPassButton}'s whitelist of pass-like action types omitted
 * `gold-ring-test-roll`, so neither the roll button nor the "Waiting…"
 * indicator appeared — the same class of bug as `resolve-dice-check` and
 * `flattery-attempt` above. `gold-ring-test-roll` is now whitelisted with a
 * "Roll" label.
 */
const goldRingTestRoll: EvaluatedAction = {
  action: {
    type: 'gold-ring-test-roll',
    player: 'p1',
    goldRingInstanceId: 'p1-5',
    rollModifier: 0,
    explanation: 'Gold-ring auto-test for Beautiful Gold Ring: 2d6 +0',
  },
  viable: true,
} as EvaluatedAction;

describe('renderPassButton — gold-ring-test-roll (Gandalf test-gold-ring)', () => {
  test('shows a Roll button for a pending gold-ring-test-roll resolution', () => {
    renderPassButton(viewWith([goldRingTestRoll]), () => { /* no-op */ });

    expect(passBtn.classList.contains('hidden')).toBe(false);
    expect(passBtn.textContent).toBe('Roll');
    expect(waitingEl.classList.contains('hidden')).toBe(true);
  });

  test('clicking the button sends the gold-ring-test-roll action', () => {
    let sent: unknown = null;
    renderPassButton(viewWith([goldRingTestRoll]), action => { sent = action; });

    passBtn.onclick?.();

    expect(sent).toEqual(goldRingTestRoll.action);
  });
});

describe('renderPassButton — Free Council corruption-check declare step', () => {
  test('hides the bottom button when several characters are eligible, letting the player pick one', () => {
    renderPassButton(
      viewWith([corruptionCheckFor('p1-4'), corruptionCheckFor('p1-106')]),
      () => { /* no-op */ },
    );

    expect(passBtn.classList.contains('hidden')).toBe(true);
    expect(waitingEl.classList.contains('hidden')).toBe(true);
  });

  test('shows a Roll button when only one character remains to be checked', () => {
    let sent: unknown = null;
    const onlyCheck = corruptionCheckFor('p1-4');
    renderPassButton(viewWith([onlyCheck]), action => { sent = action; });

    expect(passBtn.classList.contains('hidden')).toBe(false);
    expect(passBtn.textContent).toBe('Roll');

    passBtn.onclick?.();
    expect(sent).toEqual(onlyCheck.action);
  });
});
