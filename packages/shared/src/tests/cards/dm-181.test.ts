/**
 * @module dm-181.test
 *
 * Card test: Baugúr (dm-181)
 * Type: minion-character (agent, Ringwraith alignment)
 *
 * Text: "Unique. Half-orc. Agent. Leader. Discard on a body check result of 8.
 *  +2 direct influence against Orcs and Orc factions. Agent only: Cannot move
 *  to Free-holds [{F}] and Border-holds [{B}]."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 *   race orc, keywords ["agent", "half-orc", "leader"], prowess 4, body 8,
 *   mind 4, directInfluence 1, marshallingPoints 1, skills warrior, homesite
 *   "Isengard", discardBodyCheck [8]. Unique.
 *
 * Engine support table:
 * | # | Rule (card text)                                       | Status      | Notes                                              |
 * |---|--------------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | "Half-orc." → does NOT make its company overt          | OK          | isHalfOrc skips covert (CRF-22); NSN cancel window |
 * | 2 | "Half-orc." → may not take trophies                    | OK          | trophy-offer excludes Half-orc (CoE 3.IV.1.1)      |
 * | 3 | "Agent." / "Leader."                                   | OK          | agent keyword + leader-control eligibility          |
 * | 4 | "Discard on a body check result of 8."                 | OK          | discardBodyCheck [8]; combat body check             |
 * | 5 | "+2 direct influence against Orcs ..."                 | OK          | stat-modifier, influence-check, target.race=orc     |
 * | 6 | "... and Orc factions."                                | OK          | stat-modifier, faction-influence-check, race=orc    |
 * | 7 | "Agent only: Cannot move to Free-holds / Border-holds" | OK          | agent-move-restriction effect (agent-move filter)   |
 *
 * Playable: YES
 *
 * Rules exercised:
 * 1. A company whose only character is the (Half-orc) Baugúr is COVERT — Not
 *    Slay Needlessly can cancel an attack against it. Control: a plain Orc
 *    (Gorbag) makes the company overt, so NSN cannot cancel (only modifies).
 * 2. The Half-orc that defeats a creature is NOT offered it as a trophy.
 *    Control: a plain Orc (Gorbag) IS offered the trophy.
 * 3. discardBodyCheck [8]: a body-check roll of exactly 8 discards Baugúr (not
 *    eliminated); a roll of 9 (> body 8) eliminates him.
 * 4. +2 DI vs Orcs lets Baugúr (base DI 1) control an Orc (mind 3) as a
 *    follower; the bonus does NOT apply to a Troll (mind 3) → cannot control.
 * 5. +2 DI vs Orc factions reduces the influence `need` for Orcs of Udûn.
 * 6. "leader": Baugúr (Orc leader) is offered the place-under-control variant
 *    when influencing Orcs of Udûn (le-282).
 * 7. Agent move restriction: Baugúr-as-agent cannot move to a free-hold
 *    (Edoras) or border-hold (Dunharrow), but can move to a ruins-and-lairs
 *    (Isengard).
 *
 * Fixtures:
 *   BAUGUR (dm-181)            — minion Half-orc agent leader, body 8, discardBodyCheck [8]
 *   GORBAG (le-11)             — plain minion Orc, body 9 (overt/trophy control)
 *   ORC_TRACKER (le-34)        — plain minion Orc, mind 3, home "Any Dark-hold" (DI follower target)
 *   TROLL_LOUT (le-44)         — plain minion Troll, mind 3, home "Any Dark-hold" (non-Orc control)
 *   ORCS_OF_UDUN (le-282)      — Orc faction with leader-control, at Cirith Gorgor
 *   NSN (le-212)               — Not Slay Needlessly (cancels vs covert)
 *   ELF_LORD (le-69)           — "elves" creature (NSN cancel-window target)
 *   ORC_GUARD (tw-072)         — creature with killMarshallingPoints 1 (trophy source)
 *   CIRITH_GORGOR (le-361)     — dark-hold (Orcs of Udûn's only playable site)
 *   CARN_DUM (le-359)          — minion ruins-and-lairs (combat company site)
 *   AMON_HEN (le-349)          — minion ruins-and-lairs, Rohan (agent start site)
 *   EDORAS (le-372)            — minion free-hold, Rohan (restricted destination)
 *   DUNHARROW (le-369)         — minion border-hold, Rohan (restricted destination)
 *   ISENGARD (le-384)          — minion ruins-and-lairs, Gap of Isen (allowed destination)
 *   MINAS_MORGUL (le-390)      — minion haven (site-deck filler / opponent site)
 *   DOL_GULDUR (le-367)        — minion haven (opponent site)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, resetMint,
  findCharInstanceId, companyIdAt, dispatch, viableActions,
  viablePlayCharacterActions, firstFactionInfluenceAttempt,
  makeBodyCheckCombat, makeShadowMHState, makeMHState, makeSitePhase, setCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER, CardStatus,
} from '../test-helpers.js';
import { Phase, Alignment, ZERO_EFFECTIVE_STATS } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, CompanyId, GameState, CombatState,
  CancelAttackAction, InfluenceAttemptAction, AgentInPlay, CharacterInPlay, SiteInPlay,
} from '../../index.js';

const BAUGUR = 'dm-181' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;        // plain Orc, body 9
const ORC_TRACKER = 'le-34' as CardDefinitionId;   // plain Orc, mind 3, "Any Dark-hold"
const TROLL_LOUT = 'le-44' as CardDefinitionId;    // plain Troll, mind 3, "Any Dark-hold"
const ORCS_OF_UDUN = 'le-282' as CardDefinitionId; // Orc faction, leader-control, at Cirith Gorgor
const NSN = 'le-212' as CardDefinitionId;          // Not Slay Needlessly
const ELF_LORD = 'le-69' as CardDefinitionId;      // "elves" creature
const ORC_GUARD = 'tw-072' as CardDefinitionId;    // creature, killMarshallingPoints 1

const CIRITH_GORGOR = 'le-361' as CardDefinitionId; // dark-hold
const CARN_DUM = 'le-359' as CardDefinitionId;     // ruins-and-lairs
const AMON_HEN = 'le-349' as CardDefinitionId;     // ruins-and-lairs, Rohan
const EDORAS = 'le-372' as CardDefinitionId;       // free-hold, Rohan
const DUNHARROW = 'le-369' as CardDefinitionId;    // border-hold, Rohan
const ISENGARD = 'le-384' as CardDefinitionId;     // ruins-and-lairs, Gap of Isen
const MINAS_MORGUL = 'le-390' as CardDefinitionId; // minion haven
const DOL_GULDUR = 'le-367' as CardDefinitionId;   // minion haven

describe('Baugúr (dm-181)', () => {
  beforeEach(() => resetMint());

  // ── Rule 1: "Half-orc." — does NOT make its company overt ──────────────────

  test('Half-orc company stays covert — Not Slay Needlessly can cancel the attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [BAUGUR] }], hand: [NSN], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const creatureInstanceId = 'creature-elves-1' as CardInstanceId;
    const hazardPlayer = {
      ...base.players[HAZARD_PLAYER],
      cardsInPlay: [
        ...base.players[HAZARD_PLAYER].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: ELF_LORD, status: CardStatus.Untapped },
      ],
    };
    const state: GameState = {
      ...base,
      players: [base.players[RESOURCE_PLAYER], hazardPlayer] as unknown as typeof base.players,
      phaseState: makeMHState(),
      combat: {
        attackSource: { type: 'creature', instanceId: creatureInstanceId },
        companyId: companyIdAt(base, RESOURCE_PLAYER),
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 15,
        creatureBody: null,
        creatureRace: 'elves',
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: 'defender',
        bodyCheckTarget: null,
        detainment: false,
      },
    };

    const nsnInstanceId = base.players[RESOURCE_PLAYER].hand[0].instanceId;
    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions).toHaveLength(1);
  });

  test('Control: a plain Orc in the company makes it overt — NSN cannot cancel (only modifies)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [GORBAG] }], hand: [NSN], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const creatureInstanceId = 'creature-elves-1' as CardInstanceId;
    const hazardPlayer = {
      ...base.players[HAZARD_PLAYER],
      cardsInPlay: [
        ...base.players[HAZARD_PLAYER].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: ELF_LORD, status: CardStatus.Untapped },
      ],
    };
    const state: GameState = {
      ...base,
      players: [base.players[RESOURCE_PLAYER], hazardPlayer] as unknown as typeof base.players,
      phaseState: makeMHState(),
      combat: {
        attackSource: { type: 'creature', instanceId: creatureInstanceId },
        companyId: companyIdAt(base, RESOURCE_PLAYER),
        defendingPlayerId: PLAYER_1,
        attackingPlayerId: PLAYER_2,
        strikesTotal: 1,
        strikeProwess: 15,
        creatureBody: null,
        creatureRace: 'elves',
        strikeAssignments: [],
        currentStrikeIndex: 0,
        phase: 'assign-strikes',
        assignmentPhase: 'defender',
        bodyCheckTarget: null,
        detainment: false,
      },
    };

    const nsnInstanceId = base.players[RESOURCE_PLAYER].hand[0].instanceId;
    const cancelActions = viableActions(state, PLAYER_1, 'cancel-attack')
      .filter(a => 'cardInstanceId' in a.action && (a.action as CancelAttackAction).cardInstanceId === nsnInstanceId);
    expect(cancelActions).toHaveLength(0);
    const modifyActions = viableActions(state, PLAYER_1, 'modify-attack');
    expect(modifyActions.length).toBeGreaterThanOrEqual(1);
  });

  // ── Rule 2: "Half-orc." — may NOT take trophies (CoE 3.IV.1.1) ─────────────

  test('Half-orc that defeats a creature is NOT offered it as a trophy — combat finalizes', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [BAUGUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const halfOrcId = findCharInstanceId(base, RESOURCE_PLAYER, BAUGUR);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const creatureInstanceId = 'creature-orcguard-1' as CardInstanceId;
    const hazardPlayer = {
      ...base.players[HAZARD_PLAYER],
      cardsInPlay: [
        ...base.players[HAZARD_PLAYER].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: ORC_GUARD, status: CardStatus.Untapped },
      ],
    };
    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: creatureInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 8,
      creatureBody: 5,
      creatureRace: 'orc',
      strikeAssignments: [{ characterId: halfOrcId, excessStrikes: 0, resolved: true, result: 'success' }],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'creature',
      detainment: false,
    };
    const state: GameState = {
      ...base,
      players: [base.players[RESOURCE_PLAYER], hazardPlayer] as unknown as typeof base.players,
      phaseState: makeShadowMHState(),
      combat,
      cheatRollTotal: 12, // 12 > creatureBody 5 → creature defeated
    };

    const [bodyCheckAction] = viableActions(state, PLAYER_2, 'body-check-roll');
    const after = dispatch(state, bodyCheckAction.action);

    // No trophy offer for a Half-orc — combat resolves straight through.
    expect(after.combat).toBeNull();
  });

  test('Control: a plain Orc that defeats the same creature IS offered the trophy', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const orcId = findCharInstanceId(base, RESOURCE_PLAYER, GORBAG);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const creatureInstanceId = 'creature-orcguard-1' as CardInstanceId;
    const hazardPlayer = {
      ...base.players[HAZARD_PLAYER],
      cardsInPlay: [
        ...base.players[HAZARD_PLAYER].cardsInPlay,
        { instanceId: creatureInstanceId, definitionId: ORC_GUARD, status: CardStatus.Untapped },
      ],
    };
    const combat: CombatState = {
      attackSource: { type: 'creature', instanceId: creatureInstanceId },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 8,
      creatureBody: 5,
      creatureRace: 'orc',
      strikeAssignments: [{ characterId: orcId, excessStrikes: 0, resolved: true, result: 'success' }],
      currentStrikeIndex: 0,
      phase: 'body-check',
      assignmentPhase: 'done',
      bodyCheckTarget: 'creature',
      detainment: false,
    };
    const state: GameState = {
      ...base,
      players: [base.players[RESOURCE_PLAYER], hazardPlayer] as unknown as typeof base.players,
      phaseState: makeShadowMHState(),
      combat,
      cheatRollTotal: 12,
    };

    const [bodyCheckAction] = viableActions(state, PLAYER_2, 'body-check-roll');
    const after = dispatch(state, bodyCheckAction.action);

    expect(after.combat?.phase).toBe('trophy-offer');
    expect(after.combat?.trophyEligibleCharacters).toContain(orcId);
  });

  // ── Rule 4: "Discard on a body check result of 8." (discardBodyCheck [8]) ───

  test('Body check roll of exactly 8 discards Baugúr (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [BAUGUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const baugurId = findCharInstanceId(state, RESOURCE_PLAYER, BAUGUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BAUGUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: baugurId }),
      cheatRollTotal: 8,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === baugurId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === baugurId)).toBe(false);
  });

  test('Body check roll above 8 (9) eliminates Baugúr', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [BAUGUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const baugurId = findCharInstanceId(state, RESOURCE_PLAYER, BAUGUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, BAUGUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: baugurId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === baugurId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === baugurId)).toBe(false);
  });

  // ── Rule 5: "+2 direct influence against Orcs" (influence-check) ────────────

  test('+2 DI vs Orcs lets Baugúr (base DI 1) control an Orc (mind 3) as a follower', () => {
    // Baugúr base DI = 1. Orc Tracker is an orc with mind 3. Baugúr's company
    // is at a haven (Minas Morgul) so a DI-follower play is available.
    // Without the +2 DI bonus against Orcs: avail DI 1 < mind 3 → cannot control.
    // With the bonus: avail DI 3 >= mind 3 → can control as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [BAUGUR] }],
          hand: [ORC_TRACKER],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [CIRITH_GORGOR] },
      ],
    });

    const baugurId = findCharInstanceId(state, RESOURCE_PLAYER, BAUGUR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const orcUnderBaugur = actions.filter(a => a.controlledBy === baugurId);
    expect(orcUnderBaugur.length).toBeGreaterThanOrEqual(1);
  });

  test('+2 DI bonus does NOT apply to a non-Orc (Troll, mind 3) — cannot control', () => {
    // Troll Lout is a troll (NOT an orc) with mind 3. Baugúr's +2 DI bonus is
    // race-gated (orc only), so avail DI stays at 1 < mind 3 → Baugúr cannot
    // take the Troll as a follower. (Mirror of the Orc test: same haven, same
    // mind — only the target's race differs.)
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [BAUGUR] }],
          hand: [TROLL_LOUT],
          siteDeck: [DOL_GULDUR],
        },
        { id: PLAYER_2, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [CIRITH_GORGOR] },
      ],
    });

    const baugurId = findCharInstanceId(state, RESOURCE_PLAYER, BAUGUR);
    const actions = viablePlayCharacterActions(state, PLAYER_1);

    const trollUnderBaugur = actions.filter(a => a.controlledBy === baugurId);
    expect(trollUnderBaugur).toHaveLength(0);
  });

  // ── Rule 6: "+2 direct influence against Orc factions" (faction-influence) ──

  test('+2 DI vs Orc factions reduces the influence need for Orcs of Udûn', () => {
    // Orcs of Udûn: influenceNumber 9, playable at Cirith Gorgor.
    // Baugúr base DI 1 + 2 (vs orc factions) = 3 → need = 9 - 3 = 6.
    // (Without the bonus the need would be 9 - 1 = 8.)
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CIRITH_GORGOR, characters: [BAUGUR] }], hand: [ORCS_OF_UDUN], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };

    const factionInstanceId = state.players[0].hand[0].instanceId;
    const attempt = firstFactionInfluenceAttempt(state, factionInstanceId);
    expect(attempt).toBeDefined();
    expect(attempt!.need).toBe(6);
  });

  // ── Rule 3: "Leader." — eligible for leader-control of Orc factions ────────

  test('Leader: Baugúr is offered the place-under-control variant for Orcs of Udûn', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CIRITH_GORGOR, characters: [BAUGUR] }], hand: [ORCS_OF_UDUN], siteDeck: [DOL_GULDUR] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [GORBAG] }], hand: [], siteDeck: [DOL_GULDUR] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionInstanceId = state.players[0].hand[0].instanceId;

    const controlVariants = viableActions(state, PLAYER_1, 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.factionInstanceId === factionInstanceId && a.placeUnderLeaderControl === true);
    expect(controlVariants).toHaveLength(1);
  });

  // ── Rule 7: "Agent only: Cannot move to Free-holds and Border-holds" ───────

  test('Agent move excludes free-hold (Edoras) and border-hold (Dunharrow) but allows ruins-and-lairs (Isengard)', () => {
    // Baugúr-as-agent starts at Amon Hen (ruins-and-lairs, Rohan). Edoras
    // (free-hold) and Dunharrow (border-hold) are in Rohan; Isengard
    // (ruins-and-lairs, Gap of Isen) is within agent movement range → all
    // reachable. The restriction must drop the free-hold and border-hold
    // while keeping the ruins-and-lairs.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: CARN_DUM, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const amonHenStackSite: SiteInPlay = {
      instanceId: 'baugur-start-amonhen' as CardInstanceId,
      definitionId: AMON_HEN,
      status: CardStatus.Untapped,
    };
    const agentChar: CharacterInPlay = {
      instanceId: 'baugur-agent-char' as CardInstanceId,
      definitionId: BAUGUR,
      status: CardStatus.Untapped,
      items: [], allies: [], hazards: [], followers: [],
      controlledBy: 'general',
      effectiveStats: ZERO_EFFECTIVE_STATS,
    };
    const agent: AgentInPlay = {
      id: 'agent-1-0' as CompanyId,
      character: agentChar,
      revealed: true,
      siteStack: [amonHenStackSite],
      remainingActions: 1,
      inPlayAtTurnStart: true,
      attackedThisSitePhase: false,
      discardAtEndOfTurn: false,
    };

    const edorasId = 'dest-edoras' as CardInstanceId;
    const dunharrowId = 'dest-dunharrow' as CardInstanceId;
    const isengardId = 'dest-isengard' as CardInstanceId;
    const withAgent: GameState = {
      ...base,
      players: [
        base.players[0],
        {
          ...base.players[1],
          agents: [agent],
          siteDeck: [
            { instanceId: edorasId, definitionId: EDORAS },
            { instanceId: dunharrowId, definitionId: DUNHARROW },
            { instanceId: isengardId, definitionId: ISENGARD },
          ],
        },
      ] as unknown as typeof base.players,
      phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }),
    };

    const moveActions = viableActions(withAgent, PLAYER_2, 'agent-move');
    const destIds = moveActions.map(a => (a.action as { destinationSiteInstanceId: CardInstanceId }).destinationSiteInstanceId);

    // Free-hold and border-hold destinations are forbidden by the card text.
    expect(destIds).not.toContain(edorasId);
    expect(destIds).not.toContain(dunharrowId);
    // The ruins-and-lairs destination remains legal — proves the filter is
    // site-type-specific, not a blanket "nothing reachable".
    expect(destIds).toContain(isengardId);
  });
});
