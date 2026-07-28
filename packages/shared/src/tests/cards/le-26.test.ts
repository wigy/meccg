/**
 * @module le-26.test
 *
 * Card test: Náin (le-26)
 * Type: minion-character (ringwraith alignment), unique
 *
 * Card text:
 *   "Unique. +1 direct influence against Dwarves and Dwarf factions.
 *    +1 prowess against Orcs and Elves."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 *   race dwarf, skills warrior/sage, prowess 3, body 7, mind 3,
 *   directInfluence 1, marshallingPoints 1, homesite "Dol Guldur". Unique.
 *
 * Engine support table (all mechanics pre-existing — no engine change needed):
 * | # | Rule (card text)                        | Status      | Notes                                                     |
 * |---|-----------------------------------------|-------------|-----------------------------------------------------------|
 * | 1 | "+1 direct influence against Dwarves"   | IMPLEMENTED | stat-modifier DI, reason influence-check, target.race     |
 * | 2 | "…and Dwarf factions"                   | IMPLEMENTED | stat-modifier DI, reason faction-influence-check          |
 * | 3 | "…against Dwarves and Dwarf factions"   | IMPLEMENTED | stat-modifier DI, reason opponent-influence-check (steal) |
 * | 4 | "+1 prowess against Orcs"               | IMPLEMENTED | stat-modifier prowess, reason combat, enemy.race=orc      |
 * | 5 | "+1 prowess against Elves"              | IMPLEMENTED | stat-modifier prowess, reason combat, enemy.race=elf      |
 *
 * Playable: YES
 *
 * Notes on scope:
 *   "+1 direct influence against Dwarves and Dwarf factions" reaches three
 *   distinct engine paths, all exercised below:
 *     - influence-check         — controlling a dwarf character as a follower
 *                                 (`availableDI`, organization phase).
 *     - faction-influence-check — playing a dwarf faction from hand during the
 *                                 site phase (the influence-attempt `need`).
 *     - opponent-influence-check — seizing an opponent's dwarf character or
 *                                 dwarf faction (rule 8.1); the target context
 *                                 carries the race for both kinds.
 *   The prowess clause rides the existing `enemy.race` combat context (the
 *   Gulla le-13 / Wûluag as-6 precedent) — "Elves" is a live attack race for a
 *   minion company (the Elves automatic-attacks at Lórien as-155, Rivendell
 *   as-160, Thranduil's Halls le-408, …).
 *
 * Rules exercised:
 *   1. +1 DI vs Dwarves raises Náin's available DI against a dwarf follower
 *      target (Bróin) from 1 to 2; a non-dwarf of the same alignment
 *      (Orc Chieftain) leaves it at the printed 1.
 *   2. The bonus is conditional — it does not inflate Náin's effective DI stat.
 *   3. +1 DI vs Dwarf factions lowers the influence need for Petty-dwarves
 *      (dwarf faction, influence# 12 → need 10); a non-dwarf faction
 *      (Snaga-hai, influence# 10) only gets the printed DI 1 → need 9.
 *   4. +1 DI vs Dwarves on an opponent-influence attempt against an opponent's
 *      dwarf character (influencerDI 2) but not a non-dwarf one (1).
 *   5. +1 DI vs Dwarf factions on an opponent-influence attempt against an
 *      opponent's dwarf faction (2) but not a non-dwarf faction (1).
 *   6. +1 prowess vs Orcs and vs Elves in combat; no bonus vs other races.
 *   7. End-to-end strike: vs an Orc attack of prowess 7 a roll of 3 ties
 *      (3 + prowess 4) and Náin merely taps; the same roll against a Man attack
 *      of prowess 7 (3 + prowess 3 = 6 < 7) wounds him.
 *
 * Fixtures (minion alignment throughout — Náin is a minion character):
 *   NAIN (le-26)            — minion dwarf, DI 1, prowess 3
 *   BROIN (le-3)            — minion dwarf, mind 3 (dwarf influence target)
 *   ORC_CHIEFTAIN (le-32)   — minion orc, mind 4 (non-dwarf mirror)
 *   PETTY_DWARVES (as-65)   — minion dwarf faction, influence# 12, at The Worthy Hills
 *   SNAGA_HAI (le-286)      — minion orc faction, influence# 10, at any shadow-hold
 *   WORTHY_HILLS (le-415)   — minion ruins-and-lairs (Petty-dwarves' site)
 *   MORIA_MINION (le-392)   — minion shadow-hold (Snaga-hai's site type)
 *   MINAS_MORGUL (le-390)   — minion haven
 *   DOL_GULDUR (le-367)     — minion haven (Náin's homesite, site-deck filler)
 *   BARAD_DUR (le-352)      — minion dark-hold (site-deck filler)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  buildTestState, buildSitePhaseState, resetMint,
  findCharInstanceId, firstFactionInfluenceAttempt, firstOpponentInfluenceAttempt,
  addCardInPlay, dispatchResult, getCharacter, pool, executeAction,
  companyIdAt, makeShadowMHState, makeSitePhase, CardStatus,
} from '../test-helpers.js';
import { availableDI } from '../../engine/legal-actions/organization.js';
import { computeCombatProwess } from '../../engine/recompute-derived.js';
import { Phase, Alignment, Race } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CharacterCard, CombatState, GameState,
} from '../../index.js';

const NAIN = 'le-26' as CardDefinitionId;          // minion dwarf, DI 1, prowess 3, mind 3
const BROIN = 'le-3' as CardDefinitionId;          // minion dwarf, mind 3
const ORC_CHIEFTAIN = 'le-32' as CardDefinitionId; // minion orc, mind 4

const PETTY_DWARVES = 'as-65' as CardDefinitionId; // minion dwarf faction, influence# 12
const SNAGA_HAI = 'le-286' as CardDefinitionId;    // minion orc faction, influence# 10

const WORTHY_HILLS = 'le-415' as CardDefinitionId; // minion ruins-and-lairs (Petty-dwarves)
const MORIA_MINION = 'le-392' as CardDefinitionId; // minion shadow-hold (Snaga-hai)
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven
const BARAD_DUR = 'le-352' as CardDefinitionId;    // minion dark-hold

describe('Náin (le-26)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: "+1 direct influence against Dwarves" — follower control ───────

  test('+1 DI vs Dwarves raises Náin\'s available DI against a dwarf (Bróin)', () => {
    // The follower-control influence check (reason: influence-check) resolves
    // Náin's conditional DI against the target's race. Printed DI is 1; against
    // a dwarf it becomes 2. With no target named, the bonus cannot fire.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [NAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const nainId = findCharInstanceId(state, RESOURCE_PLAYER, NAIN);
    const broinDef = pool[BROIN as string] as CharacterCard;
    expect(availableDI(state, nainId, state.players[RESOURCE_PLAYER], broinDef)).toBe(2);
    expect(availableDI(state, nainId, state.players[RESOURCE_PLAYER])).toBe(1);
  });

  test('+1 DI does NOT apply when controlling a non-dwarf (Orc Chieftain)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [NAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });

    const nainId = findCharInstanceId(state, RESOURCE_PLAYER, NAIN);
    const orcDef = pool[ORC_CHIEFTAIN as string] as CharacterCard;
    expect(availableDI(state, nainId, state.players[RESOURCE_PLAYER], orcDef)).toBe(1);
  });

  // ─── Rule 2: the bonus is conditional, not a base-stat change ───────────────

  test('the +1 DI bonus does not inflate Náin\'s effective direct influence', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [NAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [BARAD_DUR] },
      ],
    });
    expect(getCharacter(state, RESOURCE_PLAYER, NAIN).effectiveStats.directInfluence).toBe(1);
  });

  // ─── Rule 3: "+1 direct influence against … Dwarf factions" ─────────────────

  test('+1 DI vs Dwarf factions lowers the influence need for Petty-dwarves', () => {
    // Petty-dwarves (dwarf faction, influence# 12) at The Worthy Hills.
    // need = influence#(12) - baseDI(1) - diBonusVsDwarfFaction(1) = 10.
    const state = buildSitePhaseState({
      characters: [NAIN],
      site: WORTHY_HILLS,
      hand: [PETTY_DWARVES],
    });

    const nainId = findCharInstanceId(state, RESOURCE_PLAYER, NAIN);
    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.influencingCharacterId).toBe(nainId);
    expect(attempt!.need).toBe(10);
  });

  test('no +1 DI against a non-dwarf faction (Snaga-hai)', () => {
    // Snaga-hai (orc faction, influence# 10) at Moria (shadow-hold).
    // need = influence#(10) - baseDI(1) = 9 — the dwarf bonus does not fire.
    const state = buildSitePhaseState({
      characters: [NAIN],
      site: MORIA_MINION,
      hand: [SNAGA_HAI],
    });

    const factionInstanceId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);

    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(9);
  });

  // ─── Rule 4: the steal path — opponent's dwarf character ────────────────────

  test('+1 DI vs Dwarves applies to an opponent-influence attempt against a dwarf character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [NAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [BROIN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    const broinId = findCharInstanceId(state, HAZARD_PLAYER, BROIN);

    const attempt = firstOpponentInfluenceAttempt(state, broinId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('character');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Dwarf target → base DI 1 + 1 = 2.
    expect(pending.kind.attempt.influencerDI).toBe(2);
  });

  test('no +1 DI on an opponent-influence attempt against a non-dwarf character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [NAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    const orcId = findCharInstanceId(state, HAZARD_PLAYER, ORC_CHIEFTAIN);

    const attempt = firstOpponentInfluenceAttempt(state, orcId);
    expect(attempt).toBeDefined();

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Non-dwarf target → printed DI 1 only.
    expect(pending.kind.attempt.influencerDI).toBe(1);
  });

  // ─── Rule 5: the steal path — opponent's dwarf faction ──────────────────────

  test('+1 DI vs Dwarf factions applies to an opponent-influence attempt against a dwarf faction', () => {
    // Re-influencing an in-play faction requires the active company to be at a
    // site where the faction is playable — Petty-dwarves is playable at The
    // Worthy Hills, so both companies sit there.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: WORTHY_HILLS, characters: [NAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: WORTHY_HILLS, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    let state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    state = addCardInPlay(state, HAZARD_PLAYER, PETTY_DWARVES);
    const factionId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === PETTY_DWARVES)!.instanceId;

    const attempt = firstOpponentInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Dwarf faction target → base DI 1 + 1 = 2.
    expect(pending.kind.attempt.influencerDI).toBe(2);
  });

  test('no +1 DI on an opponent-influence attempt against a non-dwarf faction', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [NAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    let state: GameState = { ...base, turnNumber: 3, phaseState: makeSitePhase() };
    state = addCardInPlay(state, HAZARD_PLAYER, SNAGA_HAI);
    const factionId = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === SNAGA_HAI)!.instanceId;

    const attempt = firstOpponentInfluenceAttempt(state, factionId);
    expect(attempt).toBeDefined();
    expect(attempt!.targetKind).toBe('faction');

    const result = dispatchResult(state, attempt!);
    expect(result.error).toBeUndefined();
    const pending = result.state.pendingResolutions.find(r => r.kind.type === 'opponent-influence-defend');
    if (pending?.kind.type !== 'opponent-influence-defend') throw new Error('no opponent-influence-defend pending');
    // Non-dwarf faction → printed DI 1 only.
    expect(pending.kind.attempt.influencerDI).toBe(1);
  });

  // ─── Rule 6: "+1 prowess against Orcs and Elves" ────────────────────────────

  test('+1 prowess in combat against Orcs and Elves, none against other races', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [NAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const nainId = findCharInstanceId(state, RESOURCE_PLAYER, NAIN);
    const nain = state.players[RESOURCE_PLAYER].characters[nainId];
    const nainDef = pool[NAIN as string] as CharacterCard;

    expect(computeCombatProwess(state, nain, nainDef, Race.Orc)).toBe(nainDef.prowess + 1);
    expect(computeCombatProwess(state, nain, nainDef, Race.Elf)).toBe(nainDef.prowess + 1);

    expect(computeCombatProwess(state, nain, nainDef, Race.Man)).toBe(nainDef.prowess);
    expect(computeCombatProwess(state, nain, nainDef, Race.Dwarf)).toBe(nainDef.prowess);
    expect(computeCombatProwess(state, nain, nainDef, Race.Troll)).toBe(nainDef.prowess);
    expect(computeCombatProwess(state, nain, nainDef, Race.Undead)).toBe(nainDef.prowess);
  });

  // ─── Rule 7: the prowess bonus decides a real strike ────────────────────────

  test('vs an Orc attack of prowess 7 a roll of 3 ties (bonus applies) and Náin only taps', () => {
    // Prowess 3 + 1 (Orc) = 4; roll 3 → 3 + 4 = 7 = attack prowess 7 → tie,
    // ineffectual: Náin taps and is not wounded.
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [NAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const nainId = findCharInstanceId(base, RESOURCE_PLAYER, NAIN);
    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'le-26-test-orc' as CardInstanceId },
      companyId: companyIdAt(base, RESOURCE_PLAYER),
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 7,
      creatureBody: 6,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: nainId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };
    const ready: GameState = { ...base, phaseState: makeShadowMHState(), combat };

    const after = executeAction(ready, PLAYER_1, 'resolve-strike', 3, true);

    // A tie needs no body check, so the combat finalizes straight away and
    // Náin ends the strike merely tapped (not inverted/wounded).
    expect(after.combat?.bodyCheckTarget ?? null).toBeNull();
    expect(getCharacter(after, RESOURCE_PLAYER, NAIN).status).toBe(CardStatus.Tapped);
  });

  test('vs a Man attack of prowess 7 the same roll of 3 falls short and Náin is wounded', () => {
    // No bonus vs Men: prowess 3; roll 3 → 3 + 3 = 6 < 7 → the strike succeeds
    // and Náin is wounded (body check vs the character).
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MORIA_MINION, characters: [NAIN] }], hand: [], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: BARAD_DUR, characters: [ORC_CHIEFTAIN] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const nainId = findCharInstanceId(base, RESOURCE_PLAYER, NAIN);
    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: 'le-26-test-man' as CardInstanceId },
      companyId: companyIdAt(base, RESOURCE_PLAYER),
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 7,
      creatureBody: 6,
      creatureRace: Race.Man,
      strikeAssignments: [{ characterId: nainId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
    };
    const ready: GameState = { ...base, phaseState: makeShadowMHState(), combat };

    const after = executeAction(ready, PLAYER_1, 'resolve-strike', 3, true);

    expect(after.combat?.bodyCheckTarget).toBe('character');
    expect(getCharacter(after, RESOURCE_PLAYER, NAIN).status).toBe(CardStatus.Inverted);
  });
});
