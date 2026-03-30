/**
 * @module 06-site-phase.test
 *
 * Tests for CoE Rules Section 2.V: Site Phase.
 *
 * Rule references from docs/coe-rules.md.
 */

import { describe, test } from 'vitest';

// ─── Entering Site ───────────────────────────────────────────────────────────

describe('2.V Entering a site', () => {
  test.todo('[2.V] company must declare entering site or site phase ends');
  test.todo('[2.V.i] reveal on-guard attacks: hazard player may reveal on-guard creatures keyed to site');
  test.todo('[2.V.ii] automatic-attacks resolve in listed order');
  test.todo('[2.V.ii.1] resource player can only take actions after successfully entering site');
  test.todo('[2.V.ii.2] automatic-attacks faced each turn company enters');
  test.todo('[2.V.ii.5] character at home site may tap to cancel automatic-attack');
  test.todo('[2.V.iii] after auto-attacks, hazard player may declare agent attack');
  test.todo('[2.V.iv] on-guard/agent attacks declared in resource player order');
});

// ─── Playing Resources ───────────────────────────────────────────────────────

describe('2.V Playing resources', () => {
  test.todo('[2.V.1] allies/factions/items play during site phase only, by untapped char at untapped site');
  test.todo('[2.V.1] tap character and site upon playing resource');
  test.todo('[2.V.1.1] resource only playable after facing auto/agent/on-guard attacks');
  test.todo('[2.V.2] playing ally: untapped char, site untapped, tap char, place ally, tap site');
  test.todo('[2.V.2.1] playing ally is not influence attempt; ally mind not subtracted from DI');
  test.todo('[2.V.2.2] allies not characters but treated as characters for combat and healing');
  test.todo('[2.V.2.3] if ally controlling character leaves play, ally immediately discarded');
  test.todo('[2.V.3] playing faction: reveal, tap char, influence check (2d6 + DI + modifiers)');
  test.todo('[2.V.3] faction: if roll > number, plays to MP pile and site taps; else discarded');
  test.todo('[2.V.4] playing item: untapped char, site untapped, tap char, place item, tap site');
  test.todo('[2.V.5] additional minor item: when resource taps site, may play one more minor item');
  test.todo('[2.V.5.1] at under-deeps site, any playable item may play instead of minor item');
});

// ─── On-Guard Cards ──────────────────────────────────────────────────────────

describe('2.V On-guard cards', () => {
  test.todo('[2.V.6] hazard player may reveal on-guard during site phase when company attempts tapping');
  test.todo('[2.V.6.1] on-guard revealed initiates separate chain before original chain resumes');
  test.todo('[2.V.6.5] on-guard cards only affect same company they were placed on');
  test.todo('[2.V.10] all remaining on-guard cards returned to hazard player hand when done');
});
