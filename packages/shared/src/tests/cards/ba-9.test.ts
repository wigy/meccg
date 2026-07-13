/**
 * @module ba-9.test
 *
 * Card test: Umagaur (ba-9)
 * Type: minion-character (balrog-specific, Ringwraith alignment)
 *
 * Text: "Unique. Balrog specific. Leader. Manifestation of Umagaur the Pale.
 *  Discard on a body check result of 9. +2 direct influence against Trolls,
 *  Orcs, Troll factions, and Orc factions. +3 direct influence against Balrog
 *  specific characters."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology
 * rule): race troll, keywords ["leader", "balrog-specific"], prowess 7,
 * body 9, mind 9, directInfluence 2, marshallingPoints 3, skills
 * warrior/diplomat/sage, homesite "Moria, The Under-gates", discardBodyCheck
 * [9]. Unique.
 *
 * Engine support table:
 * | # | Rule (card text)                                          | Status | Notes                                                     |
 * |---|-----------------------------------------------------------|--------|-------------------------------------------------------------|
 * | 1 | "Unique."                                                 | OK     | unique: true                                                 |
 * | 2 | "Balrog specific."                                        | OK     | keywords includes "balrog-specific" (deck-construction marker; no play-time gate, per ba-45/ba-46 precedent) |
 * | 3 | "Leader."                                                 | OK     | keywords includes "leader" (generic structural keyword)      |
 * | 4 | "Manifestation of Umagaur the Pale."                      | OK     | Umagaur the Pale (dm-112) is a hazard CREATURE — never persists in a character/ally/agent in-play zone, so g.man.1 has no reachable conflict with the ba-9 character. Matches the certified sibling ba-5 (Manifestation of Bûthrakaur the Green dm-105), which likewise carries no manifestId. |
 * | 5 | "Discard on a body check result of 9."                    | OK     | discardBodyCheck [9]; combat body check                      |
 * | 6 | "+2 direct influence against Trolls..."                   | OK     | stat-modifier, influence-check, target.race=troll             |
 * | 7 | "...Orcs..."                                              | OK     | stat-modifier, influence-check, target.race=orc               |
 * | 8 | "...Troll factions..."                                    | OK     | stat-modifier, faction-influence-check, faction.race=troll     |
 * | 9 | "...and Orc factions."                                    | OK     | stat-modifier, faction-influence-check, faction.race=orc       |
 * |10 | "+3 direct influence against Balrog specific characters." | OK     | stat-modifier, influence-check, target.keywords $includes "balrog-specific" |
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. discardBodyCheck [9]: a body-check roll of exactly 9 discards Umagaur
 *    (not eliminated); a roll of 10 (> body 9) eliminates him.
 * 2. +2 DI vs Trolls/Orcs lets Umagaur (base DI 2) control a Troll or Orc
 *    (mind 3) as a follower — base 2 alone is insufficient (2 < 3); the bonus
 *    does NOT apply to a Man of the same mind (le-8 Dorelas, mind 3).
 * 3. +2 DI vs Orc factions reduces the influence `need` for an Orc faction.
 * 4. +3 DI vs balrog-specific characters STACKS with the race bonus: with an
 *    existing follower already consuming 3 DI, Umagaur can still take on a
 *    second, balrog-specific Troll follower (mind 3) — his effective DI for
 *    that target is 2 (base) + 2 (troll) + 3 (specific) = 7 — but cannot take
 *    a plain (non-balrog-specific) Troll of the same mind, which only reaches
 *    2 + 2 = 4 (and 4 − 3 already spent < 3).
 *
 * Fixtures:
 *   UMAGAUR (ba-9)             — subject under test (troll, balrog-specific Leader, base DI 2)
 *   ORC_TRACKER (le-34)        — plain minion Orc, mind 3, home "Any Dark-hold" (DI follower target / pre-existing follower)
 *   TROLL_LOUT (le-44)         — plain minion Troll, mind 3, home "Any Dark-hold" (non-balrog-specific control target)
 *   HILL_TROLL (ba-7)          — balrog-specific minion Troll, mind 3 (stacking control target)
 *   DORELAS (le-8)             — minion Man, mind 3 (non-Orc/Troll control target, isolates race gate)
 *   GORBAG (le-11)             — plain minion Orc, body 9 (opponent company placeholder)
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

const UMAGAUR = 'ba-9' as CardDefinitionId;
const ORC_TRACKER = 'le-34' as CardDefinitionId;               // plain Orc, mind 3
const TROLL_LOUT = 'le-44' as CardDefinitionId;                // plain Troll, mind 3
const HILL_TROLL = 'ba-7' as CardDefinitionId;                 // balrog-specific Troll, mind 3
const DORELAS = 'le-8' as CardDefinitionId;                    // Man, mind 3
const GORBAG = 'le-11' as CardDefinitionId;                    // plain Orc, body 9
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;   // Orc faction, influence# 9

const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // minion shadow-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven

describe('Umagaur (ba-9)', () => {
  beforeEach(() => resetMint());

  // ── Rule: "Discard on a body check result of 9." (discardBodyCheck [9]) ────

  test('Body check roll of exactly 9 discards Umagaur (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [UMAGAUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const umagaurId = findCharInstanceId(state, RESOURCE_PLAYER, UMAGAUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, UMAGAUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: umagaurId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === umagaurId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === umagaurId)).toBe(false);
  });

  test('Body check roll above 9 (10) eliminates Umagaur', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [UMAGAUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const umagaurId = findCharInstanceId(state, RESOURCE_PLAYER, UMAGAUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, UMAGAUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: umagaurId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === umagaurId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === umagaurId)).toBe(false);
  });

  // ── Rule: "+2 direct influence against Trolls, Orcs..." (influence-check) ──

  test('+2 DI vs Orcs lets Umagaur (base DI 2) control an Orc (mind 3) as a follower', () => {
    // Umagaur base DI = 2 < Orc Tracker mind 3 → base alone cannot control.
    // With the +2 DI bonus against Orcs: avail DI 4 >= mind 3 → can control.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [UMAGAUR] }],
          hand: [ORC_TRACKER],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const umagaurId = findCharInstanceId(state, RESOURCE_PLAYER, UMAGAUR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const orcUnderUmagaur = actions.filter(a => a.controlledBy === umagaurId);
    expect(orcUnderUmagaur.length).toBeGreaterThanOrEqual(1);
  });

  test('+2 DI vs Trolls lets Umagaur (base DI 2) control a Troll (mind 3) as a follower', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [UMAGAUR] }],
          hand: [TROLL_LOUT],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const umagaurId = findCharInstanceId(state, RESOURCE_PLAYER, UMAGAUR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const trollUnderUmagaur = actions.filter(a => a.controlledBy === umagaurId);
    expect(trollUnderUmagaur.length).toBeGreaterThanOrEqual(1);
  });

  test('+2 DI bonus does NOT apply to a non-Orc/non-Troll (Man, mind 3) — cannot control', () => {
    // Dorelas: Man, mind 3, same mind as the controllable Orc/Troll above, so
    // this isolates the race gate. Umagaur base DI 2 < 3 and no race bonus →
    // cannot control.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [UMAGAUR] }],
          hand: [DORELAS],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const umagaurId = findCharInstanceId(state, RESOURCE_PLAYER, UMAGAUR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const manUnderUmagaur = actions.filter(a => a.controlledBy === umagaurId);
    expect(manUnderUmagaur).toHaveLength(0);
  });

  // ── Rule: "...Orc factions." (faction-influence-check) ─────────────────────

  test('+2 DI vs Orc factions reduces the influence need for Goblins of Goblin-gate', () => {
    // Goblins of Goblin-gate: influenceNumber 9, playable at Goblin-gate.
    // Umagaur base DI 2 + 2 (vs orc factions) = 4 → need = 9 - 4 = 5.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: GOBLIN_GATE, characters: [UMAGAUR] }], hand: [GOBLINS_OF_GOBLIN_GATE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt: InfluenceAttemptAction | undefined = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(5);
  });

  // ── Rule: "+3 direct influence against Balrog specific characters." ────────
  // Stacks with the race bonus: an existing follower already consumes 3 DI,
  // so only a target that is BOTH troll AND balrog-specific (2 + 2 + 3 = 7)
  // leaves enough room; a plain (non-balrog-specific) troll of the same mind
  // (2 + 2 = 4) does not.

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
              UMAGAUR,
              { defId: ORC_TRACKER, followerOf: 0 },
            ],
          }],
          hand: [HILL_TROLL, TROLL_LOUT],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const umagaurId = findCharInstanceId(state, RESOURCE_PLAYER, UMAGAUR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    // Existing follower (Orc Tracker, mind 3) already consumes 3 DI. Umagaur's
    // effective DI for a plain troll is 2 + 2 = 4 (remaining 1 < 3), but for a
    // balrog-specific troll it is 2 + 2 + 3 = 7 (remaining 4 >= 3).
    const hillTrollId = state.players[0].hand.find(c => c.definitionId === HILL_TROLL)!.instanceId;
    const hillTrollUnderUmagaur = actions.filter(
      a => a.controlledBy === umagaurId && a.characterInstanceId === hillTrollId,
    );
    expect(hillTrollUnderUmagaur.length).toBeGreaterThanOrEqual(1);

    // Troll Lout (plain troll, same mind) only gets the +2 race bonus, which
    // is spent down to 1 by the existing follower — cannot be controlled.
    const trollLoutId = state.players[0].hand.find(c => c.definitionId === TROLL_LOUT)!.instanceId;
    const trollLoutUnderUmagaur = actions.filter(
      a => a.controlledBy === umagaurId && a.characterInstanceId === trollLoutId,
    );
    expect(trollLoutUnderUmagaur).toHaveLength(0);
  });
});
