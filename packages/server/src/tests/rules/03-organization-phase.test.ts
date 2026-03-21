/**
 * @module 03-organization-phase.test
 *
 * Tests for CoE Rules Section 2.II: Organization Phase.
 *
 * Rule references from docs/coe-rules.txt lines 184-271.
 */

import { describe, test } from 'vitest';

// ─── 2.II.1-2: Playing Characters ────────────────────────────────────────────

describe('2.II Playing/discarding characters', () => {
  test.todo('[2.II.1] resource player may declare organizing to play/discard one character and/or set company composition');
  test.todo('[2.II.2] resource player may play or discard one character per turn while organizing');
  test.todo('[2.II.2.1] avatar characters can only play at home site or specific havens');
  test.todo('[2.II.2.1.1] first avatar played is revealed; cannot play different avatar afterward');
  test.todo('[2.II.2.2] non-avatar characters play at home site or havens');
  test.todo('[2.II.2.2] if avatar in play, can only play character at avatar site or under direct influence');
  test.todo('[2.II.2.2.1] play under general influence into new/existing company');
  test.todo('[2.II.2.2.1] play under direct influence as follower of general-influence character');
  test.todo('[2.II.2.2.2] non-follower mind subtracts from general influence; follower mind from direct influence');
  test.todo('[2.II.2.2.3] follower removed from DI outside org phase must relocate during next org or discard');
  test.todo('[2.II.2.3] playing character at site without existing company requires site from location deck');
  test.todo('[2.II.2.4] can only discard non-avatar character at haven or home site');
});

// ─── 2.II.3: Company Composition ─────────────────────────────────────────────

describe('2.II Company composition', () => {
  test.todo('[2.II.3.1] haven companies unlimited size; non-haven max 7 characters');
  test.todo('[2.II.3.1.1] hobbits and orc scouts count as half character toward company size');
  test.todo('[2.II.3.1.2] dunedain/dwarves/elves/hobbits cannot be with orcs/trolls unless at haven');
  test.todo('[2.II.3.1.3] company can only contain one leader unless at haven');
  test.todo('[2.II.3.2] move non-avatar character to direct influence control in same company');
  test.todo('[2.II.3.3] move character to general influence if total mind does not exceed max');
  test.todo('[2.II.3.4] move character under general influence between companies at same site');
  test.todo('[2.II.3.5] join companies at same site');
  test.todo('[2.II.3.5.1] when companies join, effects affecting either apply to both');
  test.todo('[2.II.3.5.2] joining at haven: return all but one haven site, transfer cards');
  test.todo('[2.II.3.6] split company at same site; resulting companies cannot rejoin same phase');
  test.todo('[2.II.3.6] all but one split company must declare movement');
  test.todo('[2.II.3.6.1] resource player designates original/new company on split');
  test.todo('[2.II.3.6.2] splitting at haven allows placing additional untapped haven copy');
});

// ─── 2.II.4-5: Storing and Transferring Items ────────────────────────────────

describe('2.II Storing and transferring items', () => {
  test.todo('[2.II.4] store item at haven requires corruption check');
  test.todo('[2.II.4.1] successful corruption check: item goes to marshalling point pile');
  test.todo('[2.II.4.2] stored cards lose bearer bonuses');
  test.todo('[2.II.5] transfer item between characters at same site requires corruption check');
});

// ─── 2.II.6: Sideboard Access ────────────────────────────────────────────────

describe('2.II Sideboard access', () => {
  test.todo('[2.II.6] tap avatar to access sideboard: bring 5 resources/chars to discard or 1 to deck');
});

// ─── 2.II.7: Declaring Movement ──────────────────────────────────────────────

describe('2.II Declaring movement', () => {
  test.todo('[2.II.7] declare movement by placing face-down site card from location deck');
  test.todo('[2.II.7.1] two companies cannot move from same origin to same destination');
  test.todo('[2.II.7.i] starter movement: current site listed as nearest haven on new site or vice versa');
  test.todo('[2.II.7.ii] region movement: new site within 4 consecutive regions, no repeats');
  test.todo('[2.II.7.iii] under-deeps movement: adjacent sites listed on cards');
  test.todo('[2.II.7.iv] special movement: effects allowing circumvention of normal rules');
});

// ─── 2.II.8: Influence Check at End ──────────────────────────────────────────

describe('2.II End of organization', () => {
  test.todo('[2.II.8] if non-follower mind exceeds general influence, discard characters until at/below max');
  test.todo('[2.II.8] newly-played characters returned to hand first');
});
