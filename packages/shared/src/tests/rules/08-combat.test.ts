/**
 * @module 08-combat.test
 *
 * Tests for CoE Rules Section 3: Combat.
 *
 * Rule references from docs/coe-rules.md.
 */

import { describe, test } from 'vitest';

// ─── 3.i: Pre-Assignment Actions ─────────────────────────────────────────────

describe('3.i Pre-assignment actions', () => {
  test.todo('[3.i] either player may take actions prior to strike assignment');
  test.todo('[3.i] resource player may cancel attack or modify attack attributes');
  test.todo('[3.i] a company is considered to have faced an attack once combat initiates');
  test.todo('[3.i] attacks can only be modified by effects that specifically refer to attacks');
  test.todo('[3.i] cancel/affect attack action must be from character in company facing attack');
  test.todo('[3.i] attacks keyed by name cannot be canceled by effects referring only to type');
});

// ─── 3.ii-iii: Strike Assignment ─────────────────────────────────────────────

describe('3.ii-iii Strike assignment', () => {
  test.todo('[3.ii] defending player assigns strikes to untapped characters first');
  test.todo('[3.ii] each strike targets one character; each character one strike per attack');
  test.todo('[3.ii] defending player may defer assigning strikes');
  test.todo('[3.iii] opponent assigns remaining strikes to unassigned characters');
  test.todo('[3.iii] excess strikes cannot be canceled but need not be defeated');
  test.todo('[3.iii] excess strikes applied as -1 prowess modifiers during strike sequence');
});

// ─── 3.iv: Strike Sequences ─────────────────────────────────────────────────

describe('3.iv Strike sequences', () => {
  test.todo('[3.iv.1] attacking player may take hazard actions affecting strike resolution');
  test.todo('[3.iv.2] non-defending player allocates excess strikes as -1 prowess');
  test.todo('[3.iv.3] defending player may apply -3 prowess to keep character untapped');
  test.todo('[3.iv.4] untapped characters may tap for +1 prowess support');
  test.todo('[3.iv.5] defending player may play resources affecting strike resolution');
  test.todo('[3.iv.5] only one skill-resource per strike sequence');
  test.todo('[3.iv.5] a strike may be canceled up until the roll is made');
});

// ─── 3.iv.6-7: Strike Resolution ────────────────────────────────────────────

describe('3.iv.6-7 Strike resolution', () => {
  test.todo('[3.iv.6] roll 2d6 + character prowess vs strike prowess');
  test.todo('[3.iv.6] tapped character: -1 prowess');
  test.todo('[3.iv.6] wounded character: -2 prowess');
  test.todo('[3.iv.7] roll > strike: strike fails, character taps (unless -3 applied)');
  test.todo('[3.iv.7] roll > strike: body check against the strike');
  test.todo('[3.iv.7] roll < strike: strike succeeds, character wounded');
  test.todo('[3.iv.7] roll < strike: body check against the character');
  test.todo('[3.iv.7] roll = strike: ineffectual, character taps');
  test.todo('[3.iv.7] temporary prowess modifications only apply during that strike sequence');
});

// ─── 3.v: Resolve the Attack ─────────────────────────────────────────────────

describe('3.v Resolve the attack', () => {
  test.todo('[3.v] creature: all strikes defeated → creature to MP pile');
  test.todo('[3.v] creature: any strike not defeated → creature discarded');
  test.todo('[3.v] automatic-attacks: all strikes defeated → attack defeated');
  test.todo('[3.v] agent: each failed strike wounds agent, body check');
  test.todo('[HERO] creature with * MP: removed from play instead of MP pile');
});

// ─── 3.I: Body Checks ───────────────────────────────────────────────────────

describe('3.I Body checks', () => {
  test.todo('[3.I] opponent rolls 2d6, +1 if character already wounded');
  test.todo('[3.I] roll > body: character eliminated (removed from play)');
  test.todo('[3.I] failed body check: items may transfer to unwounded characters in company');
  test.todo('[3.I] failed body check: non-follower cards of eliminated character discarded');
  test.todo('[3.I] orc/troll: discarded instead of eliminated on failed body check');
});

// ─── 3.II: Detainment ───────────────────────────────────────────────────────

describe('3.II Detainment', () => {
  test.todo('[3.II] detainment: successful strike taps instead of wounds');
  test.todo('[3.II] detainment: no body checks at end of strike sequences');
  test.todo('[3.II] detainment creature: not worth MPs when defeated');
  test.todo('[MINION] attacks keyed to dark-domain/dark-hold/shadow-hold are detainment');
  test.todo('[MINION] orc/troll/undead/man attacks keyed to shadow-land are detainment');
});

// ─── 3.V: Company vs Company Combat ──────────────────────────────────────────

describe('3.V Company vs company combat', () => {
  test.todo('[3.V] CvCC: one strike per attacking company member');
  test.todo('[3.V] CvCC: defending player assigns to untapped, then attacker, then defender remaining');
  test.todo('[3.V.vii] CvCC: both attacker and defender roll 2d6 + prowess');
  test.todo('[3.V.viii] CvCC: defender roll > attacker: strike fails, attacker wounded + body check');
  test.todo('[3.V.viii] CvCC: defender roll < attacker: strike succeeds, defender wounded + body check');
  test.todo('[3.V.viii] CvCC: tie: ineffectual, both tapped');
  test.todo('[3.V] CvCC: cannot play hazards during CvCC');
  test.todo('[HERO] wizard company can only attack ringwraith/overt-FW/balrog company');
});
