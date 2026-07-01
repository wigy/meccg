/**
 * @module ba-5.test
 *
 * Card test: Bûthrakaur (ba-5)
 * Type: minion-character (balrog-specific, Ringwraith alignment)
 *
 * Text: "Unique. Balrog specific. Leader. Manifestation of Bûthrakaur the
 *  Green. Discard on a body check result of 9. +3 direct influence against
 *  Trolls, Orcs, Troll factions, and Orc factions. +3 direct influence
 *  against Balrog specific characters."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology
 * rule): race troll, keywords ["leader", "balrog-specific"], prowess 8,
 * body 9, mind 9, directInfluence 0, marshallingPoints 3, skills
 * warrior/scout/ranger, homesite "Moria, The Under-gates", discardBodyCheck
 * [9]. Unique.
 *
 * Engine support table:
 * | # | Rule (card text)                                     | Status | Notes                                                     |
 * |---|-------------------------------------------------------|--------|-------------------------------------------------------------|
 * | 1 | "Unique."                                            | OK     | unique: true                                                 |
 * | 2 | "Balrog specific."                                   | OK     | keywords includes "balrog-specific" (data marker; deck-legality for avatar-specific cards is not enforced anywhere in this engine, matching every other "specific" card in the pool) |
 * | 3 | "Leader."                                            | OK     | keywords includes "leader" (generic structural keyword)      |
 * | 4 | "Discard on a body check result of 9."               | OK     | discardBodyCheck [9]; combat body check                      |
 * | 5 | "+3 direct influence against Trolls..."              | OK     | stat-modifier, influence-check, target.race=troll             |
 * | 6 | "...Orcs..."                                         | OK     | stat-modifier, influence-check, target.race=orc               |
 * | 7 | "...Troll factions..."                               | OK     | stat-modifier, faction-influence-check, faction.race=troll     |
 * | 8 | "...and Orc factions."                               | OK     | stat-modifier, faction-influence-check, faction.race=orc       |
 * | 9 | "+3 direct influence against Balrog specific characters." | OK | stat-modifier, influence-check, target.keywords $includes "balrog-specific" (new: target.keywords now exposed in availableDI's influence-check context, legal-actions/organization.ts) |
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. discardBodyCheck [9]: a body-check roll of exactly 9 discards Bûthrakaur
 *    (not eliminated); a roll of 10 (> body 9) eliminates him.
 * 2. +3 DI vs Trolls/Orcs lets Bûthrakaur (base DI 0) control a Troll or Orc
 *    (mind 3) as a follower; the bonus does NOT apply to a Man (mind 4).
 * 3. +3 DI vs Orc factions reduces the influence `need` for an Orc faction.
 * 4. +3 DI vs balrog-specific characters STACKS with the race bonus: with an
 *    existing follower already consuming 3 DI, Bûthrakaur can still take on
 *    a second, balrog-specific Troll follower (mind 3) — because the extra
 *    +3 brings his effective DI to 6 (3 race + 3 specific) — but cannot take
 *    a plain (non-balrog-specific) Troll of the same mind, which only gets
 *    the +3 race bonus.
 *
 * Fixtures:
 *   BUTHRAKAUR (ba-5)          — subject under test (troll, balrog-specific Leader)
 *   ORC_TRACKER (le-34)        — plain minion Orc, mind 3, home "Any Dark-hold" (DI follower target / pre-existing follower)
 *   TROLL_LOUT (le-44)         — plain minion Troll, mind 3, home "Any Dark-hold" (non-balrog-specific control target)
 *   HILL_TROLL (ba-7)          — balrog-specific minion Troll, mind 3 (stacking control target)
 *   HORSEMAN_IN_THE_NIGHT (le-16) — Man, mind 4 (non-Orc/Troll control target)
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

const BUTHRAKAUR = 'ba-5' as CardDefinitionId;
const ORC_TRACKER = 'le-34' as CardDefinitionId;               // plain Orc, mind 3, "Any Dark-hold"
const TROLL_LOUT = 'le-44' as CardDefinitionId;                // plain Troll, mind 3, "Any Dark-hold"
const HILL_TROLL = 'ba-7' as CardDefinitionId;                 // balrog-specific Troll, mind 3
const HORSEMAN_IN_THE_NIGHT = 'le-16' as CardDefinitionId;     // Man, mind 4
const GORBAG = 'le-11' as CardDefinitionId;                    // plain Orc, body 9
const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId;   // Orc faction, influence# 9

const GOBLIN_GATE = 'le-378' as CardDefinitionId;  // minion shadow-hold
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven

describe('Bûthrakaur (ba-5)', () => {
  beforeEach(() => resetMint());

  // ── Rule: "Discard on a body check result of 9." (discardBodyCheck [9]) ────

  test('Body check roll of exactly 9 discards Bûthrakaur (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [BUTHRAKAUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const buthrakaurId = findCharInstanceId(state, RESOURCE_PLAYER, BUTHRAKAUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BUTHRAKAUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: buthrakaurId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === buthrakaurId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === buthrakaurId)).toBe(false);
  });

  test('Body check roll above 9 (10) eliminates Bûthrakaur', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [BUTHRAKAUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: MINAS_MORGUL, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });

    const buthrakaurId = findCharInstanceId(state, RESOURCE_PLAYER, BUTHRAKAUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BUTHRAKAUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: buthrakaurId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === buthrakaurId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === buthrakaurId)).toBe(false);
  });

  // ── Rule: "+3 direct influence against Trolls, Orcs..." (influence-check) ──

  test('+3 DI vs Orcs lets Bûthrakaur (base DI 0) control an Orc (mind 3) as a follower', () => {
    // Bûthrakaur base DI = 0. Orc Tracker is an orc with mind 3.
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
          companies: [{ site: MINAS_MORGUL, characters: [BUTHRAKAUR] }],
          hand: [ORC_TRACKER],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const buthrakaurId = findCharInstanceId(state, RESOURCE_PLAYER, BUTHRAKAUR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const orcUnderButhrakaur = actions.filter(a => a.controlledBy === buthrakaurId);
    expect(orcUnderButhrakaur.length).toBeGreaterThanOrEqual(1);
  });

  test('+3 DI vs Trolls lets Bûthrakaur (base DI 0) control a Troll (mind 3) as a follower', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [BUTHRAKAUR] }],
          hand: [TROLL_LOUT],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const buthrakaurId = findCharInstanceId(state, RESOURCE_PLAYER, BUTHRAKAUR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const trollUnderButhrakaur = actions.filter(a => a.controlledBy === buthrakaurId);
    expect(trollUnderButhrakaur.length).toBeGreaterThanOrEqual(1);
  });

  test('+3 DI bonus does NOT apply to a non-Orc/non-Troll (Man, mind 4) — cannot control', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [BUTHRAKAUR] }],
          hand: [HORSEMAN_IN_THE_NIGHT],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const buthrakaurId = findCharInstanceId(state, RESOURCE_PLAYER, BUTHRAKAUR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const manUnderButhrakaur = actions.filter(a => a.controlledBy === buthrakaurId);
    expect(manUnderButhrakaur).toHaveLength(0);
  });

  // ── Rule: "...Orc factions." (faction-influence-check) ─────────────────────

  test('+3 DI vs Orc factions reduces the influence need for Goblins of Goblin-gate', () => {
    // Goblins of Goblin-gate: influenceNumber 9, playable at Goblin-gate.
    // Bûthrakaur base DI 0 + 3 (vs orc factions) = 3 → need = 9 - 3 = 6.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: GOBLIN_GATE, characters: [BUTHRAKAUR] }], hand: [GOBLINS_OF_GOBLIN_GATE], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt: InfluenceAttemptAction | undefined = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  // ── Rule: "+3 direct influence against Balrog specific characters." ────────
  // Stacks with the race bonus: an existing follower already consumes 3 DI,
  // so only a target that is BOTH troll AND balrog-specific (total +6) leaves
  // enough room; a plain (non-balrog-specific) troll of the same mind (only
  // +3) does not.

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
              BUTHRAKAUR,
              { defId: ORC_TRACKER, followerOf: 0 },
            ],
          }],
          hand: [HILL_TROLL, TROLL_LOUT],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [GOBLIN_GATE] },
      ],
    });

    const buthrakaurId = findCharInstanceId(state, RESOURCE_PLAYER, BUTHRAKAUR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    // Existing follower (Orc Tracker, mind 3) already consumes all of the
    // +3 race-only bonus. Hill-troll (balrog-specific) needs the extra +3
    // stacked bonus to be controllable as a second follower.
    const hillTrollId = state.players[0].hand.find(c => c.definitionId === HILL_TROLL)!.instanceId;
    const hillTrollUnderButhrakaur = actions.filter(
      a => a.controlledBy === buthrakaurId && a.characterInstanceId === hillTrollId,
    );
    expect(hillTrollUnderButhrakaur.length).toBeGreaterThanOrEqual(1);

    // Troll Lout (plain troll, same mind) only gets the +3 race bonus, which
    // is already spent on the existing follower — cannot be controlled.
    const trollLoutId = state.players[0].hand.find(c => c.definitionId === TROLL_LOUT)!.instanceId;
    const trollLoutUnderButhrakaur = actions.filter(
      a => a.controlledBy === buthrakaurId && a.characterInstanceId === trollLoutId,
    );
    expect(trollLoutUnderButhrakaur).toHaveLength(0);
  });
});
