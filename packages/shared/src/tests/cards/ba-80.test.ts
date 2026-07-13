/**
 * @module ba-80.test
 *
 * Card test: A Few Recruits (ba-80)
 * Type: minion-resource-faction (orc, NON-unique, 1 MP, influence # 9, Balrog specific)
 *
 * "Balrog specific. Playable at a tapped or untapped non-Dragon's lair:
 *  Dark-hold [{D}], Shadow-hold [{S}], or Ruins & Lairs [{R}] — the site cannot
 *  be an Under-deeps site or surface site thereof — if the influence check is
 *  greater than 8. Modifications: The Balrog (+3), leader (+2)."
 *
 * Key rules modelled:
 * - `playableAt: [{ any: true, when: … }]` — any site that is a Dark-hold,
 *   Shadow-hold, or Ruins & Lairs, is NOT an Under-deeps site (`under-deeps`
 *   keyword), is NOT the surface site of one (`site.isUnderDeepsSurface`), and
 *   is NOT a Dragon's lair (`site.lairOf` absent). The `isUnderDeepsSurface`
 *   and `lairOf` context paths are supplied by `siteMatchesEntry` (site.ts).
 * - `play-flag: playable-at-tapped-site` — the influence attempt is offered even
 *   when the company's current site is already tapped ("tapped or untapped"),
 *   overriding the default "factions require an untapped site" rule (CoE 2.V.3).
 * - `influenceNumber: 9` — "greater than 8" means the modified roll must be ≥ 9
 *   (engine compares `total >= influenceNumber`). `need = 9 - modifier`.
 * - `check-modifier +3 when bearer is "The Balrog"` and `+2 when the influencer
 *   is a leader` (`bearer.keywords` includes `"leader"`) — the printed
 *   Modifications, resolved into the computed `need`.
 * - `unique: false` — multiple copies may be in play; the duplicate gate must
 *   not fire.
 *
 * Engine Support:
 * | # | Feature                                                      | Status      |
 * |---|--------------------------------------------------------------|-------------|
 * | 1 | Playable at Dark-hold / Shadow-hold / Ruins & Lairs          | IMPLEMENTED |
 * | 2 | Influence # 9 (greater than 8)                               | IMPLEMENTED |
 * | 3 | Playable at an ALREADY-TAPPED matching site (play-flag)      | IMPLEMENTED |
 * | 4 | NOT playable at an Under-deeps site                          | IMPLEMENTED |
 * | 5 | NOT playable at a surface site of an Under-deeps site        | IMPLEMENTED |
 * | 6 | NOT playable at a Dragon's lair                              | IMPLEMENTED |
 * | 7 | NOT playable at a non-matching site type                     | IMPLEMENTED |
 * | 8 | Modification: The Balrog (+3)                                | IMPLEMENTED |
 * | 9 | Modification: leader (+2)                                    | IMPLEMENTED |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2,
  firstFactionInfluenceAttempt,
  makeSitePhase, setCompanySiteStatus,
} from '../test-helpers.js';
import type { CardDefinitionId } from '../../index.js';

const A_FEW_RECRUITS = 'ba-80' as CardDefinitionId;

const THE_BALROG = 'ba-3' as CardDefinitionId;  // avatar, DI 6, keyword "spawn" (NOT a leader)
const AZOG = 'ba-2' as CardDefinitionId;         // leader, DI 1
const LAGDUF = 'le-18' as CardDefinitionId;      // uruk-hai (NOT a leader), DI 0

const CIRITH_GORGOR = 'le-361' as CardDefinitionId;  // dark-hold, not surface, not lair
const DEAD_MARSHES = 'le-364' as CardDefinitionId;   // shadow-hold, not surface, not lair
const ETTENMOORS = 'le-373' as CardDefinitionId;     // ruins-and-lairs, not surface, not lair
const EASTERLING_CAMP = 'le-371' as CardDefinitionId; // border-hold — wrong type

const UNDER_GROTTOS = 'as-166' as CardDefinitionId;  // ruins-and-lairs AND under-deeps
const GOBLIN_GATE = 'le-378' as CardDefinitionId;    // shadow-hold — surface site of an Under-deeps site
const LONELY_MOUNTAIN = 'tw-428' as CardDefinitionId; // ruins-and-lairs Dragon's lair (lairOf tw-90)

const DOL_GULDUR = 'le-367' as CardDefinitionId;     // minion haven (site-deck filler)
const MINAS_MORGUL = 'le-390' as CardDefinitionId;   // minion haven

/** Build a site-phase state with a single-character company at `site`. */
function stateAt(site: CardDefinitionId, character: CardDefinitionId) {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site, characters: [character] }], hand: [A_FEW_RECRUITS], siteDeck: [DOL_GULDUR] },
      { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [LAGDUF] }], hand: [], siteDeck: [DOL_GULDUR] },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

describe('A Few Recruits (ba-80)', () => {
  beforeEach(() => resetMint());

  test('influence-able at an untapped Dark-hold; need = 9 - DI(0)', () => {
    // Lagduf (DI 0, non-leader) at Cirith Gorgor (dark-hold). need = 9.
    const state = stateAt(CIRITH_GORGOR, LAGDUF);
    const factionId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('influence-able at an untapped Shadow-hold', () => {
    const state = stateAt(DEAD_MARSHES, LAGDUF);
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('influence-able at an untapped Ruins & Lairs', () => {
    const state = stateAt(ETTENMOORS, LAGDUF);
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('playable at an ALREADY-TAPPED matching site (tapped or untapped)', () => {
    const base = stateAt(CIRITH_GORGOR, LAGDUF);
    const state = { ...setCompanySiteStatus(base, 0, 0, CardStatus.Tapped), phaseState: makeSitePhase() };
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  test('NOT playable at an Under-deeps site (even a Ruins & Lairs one)', () => {
    // The Under-grottos is a ruins-and-lairs but carries the `under-deeps` keyword.
    const state = stateAt(UNDER_GROTTOS, LAGDUF);
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeUndefined();
  });

  test('NOT playable at a surface site of an Under-deeps site', () => {
    // Goblin-gate is a shadow-hold and the roll-0 surface entrance of The Under-grottos.
    const state = stateAt(GOBLIN_GATE, LAGDUF);
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeUndefined();
  });

  test('NOT playable at a Dragon\'s lair', () => {
    // The Lonely Mountain is a Ruins & Lairs whose `lairOf` marks it a Dragon's lair.
    const state = stateAt(LONELY_MOUNTAIN, LAGDUF);
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeUndefined();
  });

  test('NOT playable at a non-matching site type (Border-hold)', () => {
    const state = stateAt(EASTERLING_CAMP, LAGDUF);
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeUndefined();
  });

  test('Modification: The Balrog (+3) applies as a check bonus', () => {
    // The Balrog (DI 6, keyword "spawn", no faction-DI effects of his own) +
    // the "+3" Modification (a check-modifier, reported as "check bonus +3") →
    // need = 9 - 6 - 3 = 0. Isolated from DI: the +3 shows up as a check bonus.
    const state = stateAt(CIRITH_GORGOR, THE_BALROG);
    const attempt = firstFactionInfluenceAttempt(state, state.players[0].hand[0].instanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.explanation).toContain('check bonus +3');
    expect(attempt!.need).toBe(0);
  });

  test('Modification: a leader (+2) applies as a check bonus; a non-leader gets no check bonus', () => {
    // Azog is a leader. The "+2" leader Modification is a check-modifier gated on
    // the influencer's `leader` keyword; it is reported as "check bonus +2",
    // separate from Azog's own "+3 DI vs Orc factions" (reported as a DI bonus).
    // need = 9 - DI(1) - own DI(3) - leader check(2) = 3.
    const leaderState = stateAt(CIRITH_GORGOR, AZOG);
    const leaderAttempt = firstFactionInfluenceAttempt(leaderState, leaderState.players[0].hand[0].instanceId);
    expect(leaderAttempt).toBeDefined();
    expect(leaderAttempt!.explanation).toContain('check bonus +2');
    expect(leaderAttempt!.need).toBe(3);

    // Lagduf (DI 0, uruk-hai — NOT a leader, no effects): no leader Modification,
    // so no "check bonus" at all → need = 9.
    const nonLeaderState = stateAt(CIRITH_GORGOR, LAGDUF);
    const nonLeaderAttempt = firstFactionInfluenceAttempt(nonLeaderState, nonLeaderState.players[0].hand[0].instanceId);
    expect(nonLeaderAttempt).toBeDefined();
    expect(nonLeaderAttempt!.explanation).not.toContain('check bonus');
    expect(nonLeaderAttempt!.need).toBe(9);
  });
});
