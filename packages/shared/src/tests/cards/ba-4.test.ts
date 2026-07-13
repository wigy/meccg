/**
 * @module ba-4.test
 *
 * Card test: Bolg (ba-4)
 * Type: minion-character (balrog alignment, balrog-specific)
 *
 * Text: "Unique. Balrog specific. Leader. Discard on a body check result of 9.
 *  +3 direct influence against Orcs and Orc factions. +2 direct influence
 *  against Balrog specific characters."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology
 * rule): race orc, keywords ["leader", "balrog-specific"], prowess 7, body 9,
 * mind 7, directInfluence 0, marshallingPoints 2, skills warrior/ranger,
 * homesite "Moria", discardBodyCheck [9]. Unique.
 *
 * Engine support table:
 * | # | Rule (card text)                                          | Status | Notes                                                        |
 * |---|-----------------------------------------------------------|--------|--------------------------------------------------------------|
 * | 1 | "Unique."                                                 | OK     | unique: true                                                  |
 * | 2 | "Balrog specific."                                        | OK     | keywords includes "balrog-specific" (deck-construction marker) |
 * | 3 | "Leader."                                                 | OK     | keywords includes "leader" (generic structural keyword)       |
 * | 4 | "Discard on a body check result of 9."                    | OK     | discardBodyCheck [9]; combat body check                        |
 * | 5 | "+3 direct influence against Orcs..."                     | OK     | stat-modifier, influence-check, target.race=orc                |
 * | 6 | "...and Orc factions."                                    | OK     | stat-modifier, faction-influence-check, faction.race=orc        |
 * | 7 | "+2 direct influence against Balrog specific characters." | OK     | stat-modifier, influence-check, target.keywords $includes "balrog-specific" (added by this certification) |
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. discardBodyCheck [9]: a body-check roll of exactly 9 discards Bolg (not
 *    eliminated); a roll of 10 (> body 9) eliminates him.
 * 2. +3 DI vs Orcs lets Bolg (base DI 0) control an Orc (mind 3) as a follower;
 *    the bonus does NOT apply to a Troll (Bolg, unlike Bûthrakaur, has no Troll
 *    bonus) nor a Man.
 * 3. +3 DI vs Orc factions reduces the influence `need` for an Orc faction.
 * 4. +2 DI vs balrog-specific characters STACKS with the +3 Orc race bonus:
 *    with an existing Orc follower already consuming 3 DI, Bolg can still take
 *    a second, balrog-specific Orc follower (mind 2) — because the extra +2
 *    brings his effective DI vs that target to 5 (3 race + 2 specific) — but
 *    cannot take a plain (non-balrog-specific) Orc of the same mind, which only
 *    gets the +3 race bonus (all consumed by the existing follower).
 *
 * Fixtures:
 *   BOLG (ba-4)                — subject under test (orc, balrog-specific Leader)
 *   ORC_TRACKER (le-34)        — plain minion Orc, mind 3, "Any Dark-hold" (control target / pre-existing follower)
 *   ORC_VETERAN (le-35)        — plain minion Orc, mind 2, "Any Dark-hold" (non-balrog-specific control target)
 *   CROOK_LEGGED_ORC (ba-6)    — balrog-specific minion Orc, mind 2 (stacking control target)
 *   TROLL_LOUT (le-44)         — plain minion Troll, mind 3 (no Bolg race bonus → uncontrollable)
 *   HORSEMAN_IN_THE_NIGHT (le-16) — Man, mind 4 (non-Orc control target)
 *   GORBAG (le-11)             — plain minion Orc (opponent company placeholder)
 *   GOBLINS_OF_GOBLIN_GATE (le-265) — Orc faction, influence# 9
 *   GOBLIN_GATE (le-378)       — minion shadow-hold (Goblins of Goblin-gate's site)
 *   MINAS_MORGUL (le-390)      — minion haven
 *   DOL_GULDUR (le-367)        — minion haven
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  findCharInstanceId, companyIdAt, dispatch, viableActions,
  viablePlayCharacterActions, firstFactionInfluenceAttempt,
  makeBodyCheckCombat, makeShadowMHState, makeSitePhase, setCharStatus,
  RESOURCE_PLAYER, CardStatus,
} from '../test-helpers.js';
import { Phase, Alignment } from '../../index.js';
import type {
  CardDefinitionId, GameState, InfluenceAttemptAction,
} from '../../index.js';

const BOLG = 'ba-4' as CardDefinitionId;
const ORC_TRACKER = 'le-34' as CardDefinitionId;               // plain Orc, mind 3, "Any Dark-hold"
const ORC_VETERAN = 'le-35' as CardDefinitionId;               // plain Orc, mind 2, "Any Dark-hold"
const CROOK_LEGGED_ORC = 'ba-6' as CardDefinitionId;           // balrog-specific Orc, mind 2
const TROLL_LOUT = 'le-44' as CardDefinitionId;                // plain Troll, mind 3
const HORSEMAN_IN_THE_NIGHT = 'le-16' as CardDefinitionId;     // Man, mind 4
const GORBAG = 'le-11' as CardDefinitionId;                    // plain Orc
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;   // Orc faction, influence# 9

const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // minion shadow-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven

describe('Bolg (ba-4)', () => {
  beforeEach(() => resetMint());

  // ── Rule: "Discard on a body check result of 9." (discardBodyCheck [9]) ────

  test('Body check roll of exactly 9 discards Bolg (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [BOLG] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const bolgId = findCharInstanceId(state, RESOURCE_PLAYER, BOLG);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BOLG, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: bolgId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === bolgId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === bolgId)).toBe(false);
  });

  test('Body check roll above 9 (10) eliminates Bolg', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [BOLG] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const bolgId = findCharInstanceId(state, RESOURCE_PLAYER, BOLG);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BOLG, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: bolgId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === bolgId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === bolgId)).toBe(false);
  });

  // ── Rule: "+3 direct influence against Orcs..." (influence-check) ──────────

  test('+3 DI vs Orcs lets Bolg (base DI 0) control an Orc (mind 3) as a follower', () => {
    // Bolg base DI = 0. Orc Tracker is an orc with mind 3.
    // Without the +3 DI bonus against Orcs: avail DI 0 < mind 3 → cannot control.
    // With the bonus: avail DI 3 >= mind 3 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [BOLG] }],
          hand: [ORC_TRACKER],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const bolgId = findCharInstanceId(state, RESOURCE_PLAYER, BOLG);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const orcUnderBolg = actions.filter(a => a.controlledBy === bolgId);
    expect(orcUnderBolg.length).toBeGreaterThanOrEqual(1);
  });

  test('+3 DI bonus does NOT apply to a Troll (mind 3) — Bolg has no Troll bonus', () => {
    // Unlike Bûthrakaur, Bolg's race bonus is Orc-only. A Troll (mind 3) gets
    // no bonus → avail DI 0 < 3 → cannot control.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [BOLG] }],
          hand: [TROLL_LOUT],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const bolgId = findCharInstanceId(state, RESOURCE_PLAYER, BOLG);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const trollUnderBolg = actions.filter(a => a.controlledBy === bolgId);
    expect(trollUnderBolg).toHaveLength(0);
  });

  test('+3 DI bonus does NOT apply to a Man (mind 4) — cannot control', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [BOLG] }],
          hand: [HORSEMAN_IN_THE_NIGHT],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const bolgId = findCharInstanceId(state, RESOURCE_PLAYER, BOLG);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const manUnderBolg = actions.filter(a => a.controlledBy === bolgId);
    expect(manUnderBolg).toHaveLength(0);
  });

  // ── Rule: "...and Orc factions." (faction-influence-check) ─────────────────

  test('+3 DI vs Orc factions reduces the influence need for Goblins of Goblin-gate', () => {
    // Goblins of Goblin-gate: influenceNumber 9, playable at Goblin-gate.
    // Bolg base DI 0 + 3 (vs orc factions) = 3 → need = 9 - 3 = 6.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: GOBLIN_GATE, characters: [BOLG] }], hand: [GOBLINS_OF_GOBLIN_GATE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt: InfluenceAttemptAction | undefined = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  // ── Rule: "+2 direct influence against Balrog specific characters." ────────
  // Stacks with the +3 Orc race bonus: an existing Orc follower already consumes
  // the +3 race bonus, so only a target that is BOTH orc AND balrog-specific
  // (total +5) leaves enough room for a mind-2 follower; a plain (non-balrog-
  // specific) Orc of the same mind (only +3) does not.

  test('balrog-specific bonus stacks with the race bonus to control a second follower', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{
            site: MINAS_MORGUL,
            characters: [
              BOLG,
              { defId: ORC_TRACKER, followerOf: 0 },
            ],
          }],
          hand: [CROOK_LEGGED_ORC, ORC_VETERAN],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const bolgId = findCharInstanceId(state, RESOURCE_PLAYER, BOLG);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    // Existing follower (Orc Tracker, mind 3) already consumes all of the
    // +3 race-only bonus. Crook-legged Orc (balrog-specific, mind 2) needs the
    // extra +2 stacked bonus to be controllable as a second follower (5-3=2>=2).
    const crookLeggedOrcId = state.players[0].hand.find(c => c.definitionId === CROOK_LEGGED_ORC)!.instanceId;
    const crookUnderBolg = actions.filter(
      a => a.controlledBy === bolgId && a.characterInstanceId === crookLeggedOrcId,
    );
    expect(crookUnderBolg.length).toBeGreaterThanOrEqual(1);

    // Orc Veteran (plain orc, mind 2) only gets the +3 race bonus, which is
    // already spent on the existing follower (3-3=0 < 2) — cannot be controlled.
    const orcVeteranId = state.players[0].hand.find(c => c.definitionId === ORC_VETERAN)!.instanceId;
    const veteranUnderBolg = actions.filter(
      a => a.controlledBy === bolgId && a.characterInstanceId === orcVeteranId,
    );
    expect(veteranUnderBolg).toHaveLength(0);
  });
});
