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
import type { PlayerView, EvaluatedAction, CardInstanceId, CardDefinitionId } from '@meccg/shared';
import { renderPassButton } from './render-instructions.js';
import { appState } from './app-state.js';

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
});

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
  appState.lastInstanceLookup = () => undefined;
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

/**
 * Regression test for bug report 4a124a06991d909f (game ms9n2c5y-pfdcdr, seq
 * 532): "Game state is frozen — there is no further action available" right
 * after playing Wizard's Test (tw-365) via Saruman to test Bilbo's Precious
 * Gold Ring. Wizard's Test makes two rolls and offers the player a choice
 * between the totals (`choose-gold-ring-test-roll`, one action per distinct
 * rolled total). That action type was entirely absent from
 * {@link renderPassButton}'s pass-like whitelist, so once both rolls were in,
 * `passEval` found nothing, the roll button hid, and (since viable actions
 * did exist) the "Waiting…" indicator was suppressed too — no control on
 * screen let the player make the choice. Unlike the single-roll cases above,
 * `choose-gold-ring-test-roll` has no safe "default" pick (picking one would
 * silently choose the ring's fate for the player), so it renders one button
 * per option instead of joining the generic whitelist.
 */
const chooseGoldRingTestRoll = (rollTotal: number, explanation: string): EvaluatedAction => ({
  action: {
    type: 'choose-gold-ring-test-roll',
    player: 'p1',
    goldRingInstanceId: 'p1-5',
    rollTotal,
    explanation,
  },
  viable: true,
} as EvaluatedAction);

describe('renderPassButton — choose-gold-ring-test-roll (Wizard\'s Test)', () => {
  test('renders one button per rolled total instead of hiding the panel', () => {
    renderPassButton(
      viewWith([
        chooseGoldRingTestRoll(9, 'Precious Gold Ring tests as lesser-ring, dwarven-ring on a 9'),
        chooseGoldRingTestRoll(12, 'Precious Gold Ring tests as lesser-ring, dwarven-ring, the-one-ring on a 12'),
      ]),
      () => { /* no-op */ },
    );

    expect(passBtn.classList.contains('hidden')).toBe(true);
    expect(waitingEl.classList.contains('hidden')).toBe(true);
    expect(tierInPhasePass.children).toHaveLength(2);
    expect(tierInPhasePass.children.map(c => c.textContent)).toEqual(['Use 9', 'Use 12']);
  });

  test('clicking a choice button sends that total\'s action', () => {
    let sent: unknown = null;
    const nine = chooseGoldRingTestRoll(9, 'Precious Gold Ring tests as lesser-ring, dwarven-ring on a 9');
    const twelve = chooseGoldRingTestRoll(12, 'Precious Gold Ring tests as lesser-ring, dwarven-ring, the-one-ring on a 12');
    renderPassButton(viewWith([nine, twelve]), action => { sent = action; });

    tierInPhasePass.children[1].onclick?.();

    expect(sent).toEqual(twelve.action);
  });
});

/**
 * Regression test for bug report 20c3ed62a7350c6a (game msaihfe9-oo2tc3, seq
 * 1344): "Program freeze again. Should ask for play or discard and then show
 * creatures to fight." Playing The Great Hunt (wh-91) enqueues a
 * `great-hunt-source` pending resolution offering two viable
 * `choose-great-hunt-source` actions (reveal from the opponent's play deck or
 * discard pile). Neither action type was in {@link renderPassButton}'s
 * pass-like whitelist, so once the choice was pending, the roll/pass button
 * hid and (since viable actions did exist) the "Waiting…" indicator was
 * suppressed too — no control on screen let the player pick a pile, the same
 * class of bug as `choose-gold-ring-test-roll` above. There is no safe
 * default pile to pick silently, so it renders one button per offered pile
 * instead of joining the generic whitelist.
 */
const chooseGreatHuntSource = (source: 'deck' | 'discard'): EvaluatedAction => ({
  action: {
    type: 'choose-great-hunt-source',
    player: 'p1',
    source,
  },
  viable: true,
} as EvaluatedAction);

describe('renderPassButton — choose-great-hunt-source (The Great Hunt)', () => {
  test('renders one button per offered pile instead of hiding the panel', () => {
    renderPassButton(
      viewWith([chooseGreatHuntSource('deck'), chooseGreatHuntSource('discard')]),
      () => { /* no-op */ },
    );

    expect(passBtn.classList.contains('hidden')).toBe(true);
    expect(waitingEl.classList.contains('hidden')).toBe(true);
    expect(tierInPhasePass.children).toHaveLength(2);
    expect(tierInPhasePass.children.map(c => c.textContent)).toEqual(['Reveal Play Deck', 'Reveal Discard Pile']);
  });

  test('clicking a choice button sends that pile\'s action', () => {
    let sent: unknown = null;
    const deck = chooseGreatHuntSource('deck');
    const discard = chooseGreatHuntSource('discard');
    renderPassButton(viewWith([deck, discard]), action => { sent = action; });

    tierInPhasePass.children[1].onclick?.();

    expect(sent).toEqual(discard.action);
  });
});

/**
 * Regression test for bug report 648f4980dacb0e76 (game mt2ppg50-l6cytw, seq
 * 428): "Im stuck after named a creature." Playing The Hunt (dm-143) enqueues
 * a `hunt-target-choice` pending resolution offering one viable
 * `choose-hunt-target` action per hazard creature found in the opponent's
 * play deck/discard pile. `choose-hunt-target` was not in
 * {@link renderPassButton}'s pass-like whitelist and had no dedicated
 * branch, so once the choice was pending, the pass button hid and (since
 * viable actions did exist) the "Waiting…" indicator was suppressed too — no
 * control on screen let the player name a creature, the same class of bug as
 * `choose-great-hunt-source` above. There is no safe default creature to name
 * silently, so it renders one button per candidate instead of joining the
 * generic whitelist.
 */
const chooseHuntTarget = (creatureInstanceId: CardInstanceId, definitionId: CardDefinitionId): EvaluatedAction => ({
  action: {
    type: 'choose-hunt-target',
    player: 'p1',
    creatureInstanceId,
    definitionId,
  },
  viable: true,
} as EvaluatedAction);

describe('renderPassButton — choose-hunt-target (The Hunt)', () => {
  // le-77 (Hobgoblins) and tw-078 (Orc-watch) are real hazard-creature card
  // ids — the button label is resolved from `cardPool` by the definitionId
  // the action itself carries, no instance lookup needed.
  const hobgoblins = chooseHuntTarget('p2-35' as CardInstanceId, 'le-77' as CardDefinitionId);
  const orcWatch = chooseHuntTarget('p2-46' as CardInstanceId, 'tw-078' as CardDefinitionId);

  test('renders one button per named candidate instead of hiding the panel', () => {
    renderPassButton(viewWith([hobgoblins, orcWatch]), () => { /* no-op */ });

    expect(passBtn.classList.contains('hidden')).toBe(true);
    expect(waitingEl.classList.contains('hidden')).toBe(true);
    expect(tierInPhasePass.children).toHaveLength(2);
    expect(tierInPhasePass.children.map(c => c.textContent)).toEqual(['Name Hobgoblins', 'Name Orc-watch']);
  });

  test('clicking a choice button sends that creature\'s action', () => {
    let sent: unknown = null;
    renderPassButton(viewWith([hobgoblins, orcWatch]), action => { sent = action; });

    tierInPhasePass.children[1].onclick?.();

    expect(sent).toEqual(orcWatch.action);
  });
});

/**
 * Regression test for bug report underlying feature request "change 'pass'
 * button name and place": Movement/Hazard's `draw-cards` and `play-hazards`
 * steps are two separate engine steps with independent pass semantics, but
 * both used to render an identical "Continue"/"Pass" button in the identical
 * screen position — the player could not tell a new step had begun. The
 * label logic now lives in {@link module:pass-button-label} and is
 * step-aware; this locks in that the two steps never render the same text.
 */
const drawCardsEval = (player: 'p1' = 'p1'): EvaluatedAction => ({
  action: { type: 'draw-cards', player, count: 1 },
  viable: true,
} as EvaluatedAction);

const passEval = (player: 'p1' = 'p1'): EvaluatedAction => ({
  action: { type: 'pass', player },
  viable: true,
} as EvaluatedAction);

const viewWithMH = (step: string, legalActions: EvaluatedAction[]): PlayerView =>
  ({
    phaseState: { phase: Phase.MovementHazard, step },
    legalActions,
    self: { id: 'p1' },
    activePlayer: 'p1',
  } as unknown as PlayerView);

/**
 * A play-hazards view with the fields {@link getHazardLimitLabel} (via
 * `pass-button-label.ts`) needs: `self`/`opponent`/`activeConstraints` plus
 * the hazard-limit phaseState fields. `hazardsPlayedThisCompany` defaults to
 * `0` so the remaining count equals `hazardLimitAtReveal` unless overridden.
 */
const playHazardsViewWith = (legalActions: EvaluatedAction[], hazardLimitAtReveal = 4, hazardsPlayedThisCompany = 0): PlayerView =>
  ({
    activePlayer: 'p2',
    self: { id: 'p1', companies: [] },
    opponent: { id: 'p2', companies: [{ id: 'company-p2-0' }] },
    activeConstraints: [],
    phaseState: {
      phase: Phase.MovementHazard,
      step: 'play-hazards',
      activeCompanyIndex: 0,
      hazardLimitAtReveal,
      preRevealHazardLimitConstraintIds: [],
      hazardsPlayedThisCompany,
    },
    legalActions,
  } as unknown as PlayerView);

describe('renderPassButton — Movement/Hazard draw-cards vs play-hazards labels', () => {
  test('draw-cards step renders "Draw" and a distinctly-labeled secondary pass button', () => {
    renderPassButton(viewWithMH('draw-cards', [drawCardsEval(), passEval()]), () => { /* no-op */ });

    expect(passBtn.textContent).toBe('Draw');
    expect(tierInPhasePass.children).toHaveLength(1);
    expect(tierInPhasePass.children[0].textContent).toBe('Pass Draw');
  });

  test('play-hazards step renders "Pass Hazards" on the primary button', () => {
    renderPassButton(playHazardsViewWith([passEval()]), () => { /* no-op */ });

    expect(passBtn.textContent).toBe('Pass Hazards');
  });

  test('draw-cards and play-hazards never render the same primary button text', () => {
    renderPassButton(viewWithMH('draw-cards', [drawCardsEval(), passEval()]), () => { /* no-op */ });
    const drawLabel = passBtn.textContent;

    renderPassButton(playHazardsViewWith([passEval()]), () => { /* no-op */ });
    const hazardsLabel = passBtn.textContent;

    expect(drawLabel).not.toBe(hazardsLabel);
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

/**
 * Regression test for bug report f46b56f4617e1f74 (game msd25yx4-jzz7ze, seq
 * 147): "Just played join the Hunt and then nothing can be done anymore."
 * Alatar (Fallen-wizard avatar, wh-1) entering play mid-game drops the
 * player's general-influence pool from the default 20 to his printed 17,
 * putting four already-recruited characters over the limit (CoE 2.II.8 /
 * 2.II.2.1.F2) and enqueuing an `influence-overflow-discard` resolution with
 * one viable action per removable character. That action type was entirely
 * absent from {@link renderPassButton}'s pass-like whitelist — the same class
 * of bug as `choose-gold-ring-test-roll`/`choose-great-hunt-source` above:
 * with several removal candidates and no safe default to auto-pick, the roll
 * button hid and (since viable actions did exist) the "Waiting…" indicator
 * was suppressed too, leaving no control on screen at all. It now renders one
 * "Remove <character>" button per candidate.
 */
const influenceOverflowDiscard = (characterInstanceId: string): EvaluatedAction => ({
  action: {
    type: 'influence-overflow-discard',
    player: 'p1',
    characterInstanceId,
  },
  viable: true,
} as EvaluatedAction);

const lookupOf = (map: Record<string, string>) =>
  ((id: CardInstanceId) => map[id as string] as CardDefinitionId | undefined);

describe('renderPassButton — influence-overflow-discard (CoE 3.47 general-influence overflow)', () => {
  test('renders one Remove button per candidate character instead of hiding the panel', () => {
    appState.lastInstanceLookup = lookupOf({ 'p1-99': 'dm-17', 'p1-105': 'le-1' });

    renderPassButton(
      viewWith([influenceOverflowDiscard('p1-99'), influenceOverflowDiscard('p1-105')]),
      () => { /* no-op */ },
    );

    expect(passBtn.classList.contains('hidden')).toBe(true);
    expect(waitingEl.classList.contains('hidden')).toBe(true);
    expect(tierInPhasePass.children).toHaveLength(2);
    expect(tierInPhasePass.children.map(c => c.textContent)).toEqual(['Remove Ivic', 'Remove Asternak']);
  });

  test('clicking a candidate button sends that character\'s discard action', () => {
    let sent: unknown = null;
    appState.lastInstanceLookup = lookupOf({ 'p1-99': 'dm-17' });
    const onlyCandidate = influenceOverflowDiscard('p1-99');

    renderPassButton(viewWith([onlyCandidate]), action => { sent = action; });

    tierInPhasePass.children[0].onclick?.();

    expect(sent).toEqual(onlyCandidate.action);
  });

  /**
   * Regression test for bug report 1f3685826a5c1f2c (game msgd0dft-euql7p,
   * seq 638): "The msg Remove Erkenbrand didnt go away for the whole turn."
   * The `influence-overflow-discard-btn` created above is appended to
   * `#visual-panel` but was missing from the stale-button cleanup preamble at
   * the top of {@link renderPassButton} (which removes `.hazard-sb-btn`,
   * `.gold-ring-choice-btn`, `.great-hunt-choice-btn`, …). Once the resolution
   * was resolved (here, by the character actually being discarded), the
   * "Remove <character>" button had no matching class in the cleanup list and
   * was never removed from the DOM, leaving it visible for the rest of the
   * turn even though clicking it no longer did anything relevant.
   */
  test('removes a stale "Remove <character>" button once the resolution is gone', () => {
    appState.lastInstanceLookup = lookupOf({ 'p1-108': 'tw-148' }); // Erkenbrand

    renderPassButton(viewWith([influenceOverflowDiscard('p1-108')]), () => { /* no-op */ });
    expect(tierInPhasePass.children.map(c => c.textContent)).toEqual(['Remove Erkenbrand']);

    renderPassButton(viewWith([passEval()]), () => { /* no-op */ });

    expect(tierInPhasePass.children.map(c => c.textContent)).not.toContain('Remove Erkenbrand');
  });
});

/**
 * Regression tests for the multi-target CvCC attack buttons. With several
 * opponent companies at the site (one `declare-company-attack` per target),
 * the buttons were created with only the shared `enter-site-btn` class — no
 * id and no dedicated class — so the stale-button cleanup preamble at the top
 * of {@link renderPassButton} never matched them: every state re-render
 * appended a fresh set, and once the step ended the buttons stayed on screen
 * for the rest of the game, dispatching a stale `declare-company-attack` if
 * clicked. They were also indistinguishable — every button was labeled just
 * "Attack", with no way to tell which company it targets. They now carry the
 * `cvcc-attack-btn` cleanup class and the target company's name.
 */
const declareAttack = (targetCompanyId: string): EvaluatedAction => ({
  action: {
    type: 'declare-company-attack',
    player: 'p1',
    attackingCompanyId: 'company-p1-0',
    targetCompanyId,
  },
  viable: true,
} as EvaluatedAction);

const cvccViewWith = (legalActions: EvaluatedAction[]): PlayerView =>
  ({
    phaseState: { phase: Phase.Site, step: 'declare-company-attack' },
    legalActions,
    self: { id: 'p1', companies: [] },
    opponent: {
      id: 'p2',
      companies: [
        { id: 'company-p2-0', characters: ['p2-1'] },
        { id: 'company-p2-1', characters: ['p2-2'] },
      ],
      characters: {
        'p2-1': { instanceId: 'p2-1', definitionId: 'tw-148', effectiveStats: { prowess: 4 } }, // Erkenbrand
        'p2-2': { instanceId: 'p2-2', definitionId: 'tw-159', effectiveStats: { prowess: 5 } }, // Gimli
      },
    },
    activePlayer: 'p1',
  } as unknown as PlayerView);

describe('renderPassButton — multi-target CvCC attack buttons', () => {
  test('labels each Attack button with its target company and dispatches that target', () => {
    let sent: unknown = null;
    renderPassButton(
      cvccViewWith([passEval(), declareAttack('company-p2-0'), declareAttack('company-p2-1')]),
      action => { sent = action; },
    );

    const labels = tierInPhasePass.children.map(c => c.textContent);
    expect(labels).toContain("Attack Erkenbrand's company");
    expect(labels).toContain("Attack Gimli's company");

    const gimliBtn = tierInPhasePass.children.find(c => c.textContent === "Attack Gimli's company");
    gimliBtn?.onclick?.();
    expect(sent).toEqual(declareAttack('company-p2-1').action);
  });

  test('does not accumulate duplicate Attack buttons across re-renders', () => {
    const view = cvccViewWith([passEval(), declareAttack('company-p2-0'), declareAttack('company-p2-1')]);

    renderPassButton(view, () => { /* no-op */ });
    renderPassButton(view, () => { /* no-op */ });

    const attackButtons = tierInPhasePass.children.filter(c => c.textContent.startsWith('Attack'));
    expect(attackButtons).toHaveLength(2);
  });

  test('removes the Attack buttons once the step is over', () => {
    renderPassButton(
      cvccViewWith([passEval(), declareAttack('company-p2-0'), declareAttack('company-p2-1')]),
      () => { /* no-op */ },
    );

    renderPassButton(viewWith([passEval()]), () => { /* no-op */ });

    expect(tierInPhasePass.children.filter(c => c.textContent.startsWith('Attack'))).toHaveLength(0);
  });
});

/**
 * Regression test for bug report fee86d3b1b398160 (game mt90y8eu-u0ndem, seq
 * 52): "Game froze after opponent successfully played Call of Home on my
 * Círdan. No option to move game state forward." Call of Home (tw-18)
 * returning a character with an item enqueues a `transfer-returned-item`
 * resolution — one "give item to mate" action per company-mate plus a
 * decline. That action type was entirely absent from
 * {@link renderPassButton}'s pass-like whitelist and had no fallback branch,
 * so (like `influence-overflow-discard` above) the button hid and the
 * "Waiting…" indicator was suppressed too, even though three viable actions
 * existed. It now renders one "Give <item> to <character>" button per mate
 * plus a "Leave Discarded" button.
 */
const transferReturnedItem = (targetCharacterId?: string): EvaluatedAction => ({
  action: {
    type: 'transfer-returned-item',
    player: 'p1',
    itemInstanceId: targetCharacterId ? 'p1-182' : undefined,
    targetCharacterId,
  },
  viable: true,
} as EvaluatedAction);

describe('renderPassButton — transfer-returned-item (Call of Home / Pilfer Anything Unwatched)', () => {
  test('renders one Give button per company-mate plus a Leave Discarded button', () => {
    appState.lastInstanceLookup = lookupOf({ 'p1-182': 'tw-259', 'p1-184': 'tw-134', 'p1-188': 'tw-131' });

    renderPassButton(
      viewWith([transferReturnedItem('p1-184'), transferReturnedItem('p1-188'), transferReturnedItem()]),
      () => { /* no-op */ },
    );

    expect(passBtn.classList.contains('hidden')).toBe(true);
    expect(waitingEl.classList.contains('hidden')).toBe(true);
    expect(tierInPhasePass.children.map(c => c.textContent)).toEqual([
      'Give Horn of Anor to Boromir II',
      'Give Horn of Anor to Bilbo',
      'Leave Discarded',
    ]);
  });

  test('clicking a Give button sends that item/mate transfer action', () => {
    let sent: unknown = null;
    appState.lastInstanceLookup = lookupOf({ 'p1-182': 'tw-259', 'p1-184': 'tw-134' });
    const giveToMate = transferReturnedItem('p1-184');

    renderPassButton(viewWith([giveToMate, transferReturnedItem()]), action => { sent = action; });

    tierInPhasePass.children[0].onclick?.();

    expect(sent).toEqual(giveToMate.action);
  });

  test('clicking Leave Discarded sends the decline action', () => {
    let sent: unknown = null;
    appState.lastInstanceLookup = lookupOf({ 'p1-182': 'tw-259', 'p1-184': 'tw-134' });
    const decline = transferReturnedItem();

    renderPassButton(viewWith([transferReturnedItem('p1-184'), decline]), action => { sent = action; });

    tierInPhasePass.children[1].onclick?.();

    expect(sent).toEqual(decline.action);
  });
});

/**
 * Regression tests for the three-tier action-button layout (feature request
 * "changing tight buttons"): buttons that end the phase, resolve an in-phase
 * decision, or activate a card-granted ability now render into three
 * always-present containers (`#tier-end-of-phase`, `#tier-in-phase-pass`,
 * `#tier-special`) instead of being appended in whatever order their branch
 * happened to run — so a given screen slot always holds the same kind of
 * action from one turn to the next. This locks in that `activate-granted-action`
 * (e.g. Carambor-style taps) surfaces a top-tier button in addition to the
 * existing portrait-click affordance, and that it is cleaned up once no
 * longer viable, mirroring the existing per-tier cleanup tests above.
 */
const activateGrantedAction = (actionId: string, characterId: string): EvaluatedAction => ({
  action: {
    type: 'activate-granted-action',
    player: 'p1',
    characterId,
    sourceCardId: characterId,
    sourceCardDefinitionId: 'tw-1',
    actionId,
    rollThreshold: 6,
  },
  viable: true,
} as unknown as EvaluatedAction);

describe('renderPassButton — top-tier special actions (activate-granted-action)', () => {
  test('renders a Special button in the top tier alongside a normal bottom-tier pass button', () => {
    renderPassButton(viewWith([passEval(), activateGrantedAction('untap-bearer', 'p1-4')]), () => { /* no-op */ });

    expect(passBtn.classList.contains('hidden')).toBe(false);
    expect(tierSpecial.children).toHaveLength(1);
    expect(tierSpecial.children[0].textContent).toBe('Special ▾');
    expect(tierSpecial.children[0].classList.contains('special-action-btn')).toBe(true);
  });

  test('does not render a Special button when no granted action is viable', () => {
    renderPassButton(viewWith([passEval()]), () => { /* no-op */ });

    expect(tierSpecial.children).toHaveLength(0);
  });

  test('removes a stale Special button once the granted action is gone', () => {
    renderPassButton(viewWith([passEval(), activateGrantedAction('untap-bearer', 'p1-4')]), () => { /* no-op */ });
    expect(tierSpecial.children).toHaveLength(1);

    renderPassButton(viewWith([passEval()]), () => { /* no-op */ });

    expect(tierSpecial.children).toHaveLength(0);
  });
});
