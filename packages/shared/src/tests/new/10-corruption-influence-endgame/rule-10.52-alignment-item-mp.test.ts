/**
 * @module rule-10.52-alignment-item-mp
 *
 * CoE Rules — Section 10: Corruption, Influence, Actions/Timing & Ending the Game
 * Rule 10.52: Alignment Item MP Values
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [HERO] For a Wizard player, minion items are worth half of the item's normal marshalling points (rounded up).
 * [MINION] For a Ringwraith player, hero items are worth half of the item's normal marshalling points (rounded up).
 * [FALLEN-WIZARD] For a Fallen-wizard player, non-Stage cards worth at least one marshalling point are only worth one marshalling point, unless that value is modified by a stage resource, Fallen-wizard avatar ability, or hazard.
 * [FALLEN-WIZARD] A Fallen-wizard player does not receive marshalling points for resources stored at non-Wizardhaven sites.
 * [FALLEN-WIZARD] A Fallen-wizard player may receive the extra faction marshalling points for a group of faction cards that may be played on a leader, but they receive only one extra faction point for the group of factions instead of two.
 * [BALROG] A Balrog player does not receive marshalling points for hero items played at that player's Darkhavens, and receives half of the normal marshalling points for other hero items (rounded up).
 */

import { describe, test } from 'vitest';

describe('Rule 10.52 — Alignment Item MP Values', () => {
  test.todo('Hero: minion items half MP; Minion: hero items half MP; FW: non-Stage 1+ MP cards worth only 1 MP; Balrog: hero items half MP');
});
