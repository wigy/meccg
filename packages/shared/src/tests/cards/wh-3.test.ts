/**
 * @module wh-3.test
 *
 * Card test: Euog (Ulzog) (wh-3)
 * Type: minion-character (Ringwraith alignment)
 *
 * "Unique. Half-orc. Leader. Discard on a body check result of 9.
 *  +2 direct influence against Orcs and Orc factions."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 *   race: orc, keywords: ["half-orc", "leader"], body 9, prowess 5, mind 5,
 *   DI 1, skills warrior/diplomat, discardBodyCheck [9]. Unique.
 *   Homesite "Any Dark-hold". MP 2 (character).
 *
 * Engine Support:
 * | # | Rule (card text)                        | Status | Notes                                               |
 * |---|-----------------------------------------|--------|-----------------------------------------------------|
 * | 1 | "Half-orc." → does NOT make company     | OK     | isCovertCompany skips Half-orc (CRF-22 ruling);     |
 * |   |   overt                                 |        | exercised via Not Slay Needlessly (covert cancel)   |
 * | 2 | "Half-orc." → cannot take trophies      | OK     | trophy-offer excludes Half-orc (CoE 3.IV.1.1)       |
 * | 3 | "Leader." → one leader per non-haven    | OK     | wouldViolateLeaderRestriction (rule 3.26,           |
 * |   |   company                               |        | organization-companies.ts)                          |
 * | 4 | "Discard on a body check result of 9."  | OK     | discardBodyCheck [9]; combat body check (rule 8.31) |
 * | 5 | "+2 DI against Orcs"                    | OK     | stat-modifier, when reason influence-check +        |
 * |   |                                         |        | target.race orc (availableDI, organization.ts)      |
 * | 6 | "+2 DI against Orc factions"            | OK     | stat-modifier, when reason faction-influence-check  |
 * |   |                                         |        | + faction.race orc (legal-actions/site.ts)          |
 *
 * Playable: YES
 *
 * "Unique" is enforced by deck construction; warrior/diplomat skills are base
 * stats handled by the engine. Those are documented here, not asserted
 * against the JSON.
 *
 * Fixtures:
 *   EUOG (wh-3)                — minion Half-orc leader, body 9, DI 1, discardBodyCheck [9]
 *   GORBAG (le-11)             — plain minion Orc leader (Uruk-hai), body 9 (overt/trophy/leader control)
 *   GRISHNAKH (le-12)          — minion orc, mind 3, non-leader (DI target / merge control)
 *   OSTISEN (le-36)            — minion man, mind 2, no effects (DI negative control)
 *   NSN (le-212)               — Not Slay Needlessly: cancels vs covert, -2 prowess vs overt
 *   ELF_LORD (le-69)           — "elf" creature (NSN cancel-window target)
 *   ORC_GUARD (tw-072)         — creature with killMarshallingPoints 1 (trophy source)
 *   GOBLINS_OF_GOBLIN_GATE (le-265) — minion orc faction, influence# 9
 *   GOBLIN_GATE (le-378)       — shadow-hold where the faction is playable
 *   CARN_DUM (le-359)          — minion ruins-and-lairs (company site)
 *   MORIA_MINION (le-392)      — minion shadow-hold (non-haven — leader rule applies)
 *   MINAS_MORGUL (le-390)      — minion haven (org-phase company site / siteDeck filler)
 *   DOL_GULDUR (le-367)        — minion haven (opponent site)
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  buildTestState, buildMinionSitePhaseState, resetMint,
  findCharInstanceId, companyIdAt, dispatch, viableActions,
  viablePlayCharacterActions, getCharacter,
  makeBodyCheckCombat, makeShadowMHState, makeMHState, setCharStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER, CardStatus,
} from '../test-helpers.js';
import { computeLegalActions, Phase, Alignment, Race } from '../../index.js';
import type {
  CardDefinitionId, CardInstanceId, GameState, CombatState, CompanyId,
  CancelAttackAction, InfluenceAttemptAction, MergeCompaniesAction,
} from '../../index.js';

const EUOG = 'wh-3' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;      // plain Orc leader (overt/trophy/leader control)
const GRISHNAKH = 'le-12' as CardDefinitionId;   // orc, mind 3, non-leader
const OSTISEN = 'le-36' as CardDefinitionId;     // man, mind 2, no effects
const NSN = 'le-212' as CardDefinitionId;        // Not Slay Needlessly
const ELF_LORD = 'le-69' as CardDefinitionId;    // "elf" creature
const ORC_GUARD = 'tw-072' as CardDefinitionId;  // creature, killMarshallingPoints 1

const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc faction, influence# 9
const GOBLIN_GATE = 'le-378' as CardDefinitionId;            // shadow-hold

const CARN_DUM = 'le-359' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Euog (Ulzog) (wh-3)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional DI bonuses do not inflate base stats) ──────────

  test('base effective DI is 1 (conditional +2 does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [EUOG] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, EUOG).effectiveStats.directInfluence).toBe(1);
  });

  // ─── Rule 1: "Half-orc." — does NOT make its company overt ──────────────────
  // Not Slay Needlessly can only cancel an attack against a COVERT company.

  test('Half-orc company stays covert — Not Slay Needlessly can cancel the attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [EUOG] }], hand: [NSN], siteDeck: [MINAS_MORGUL] },
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
        creatureRace: Race.Elf,
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
        creatureRace: Race.Elf,
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

  // ─── Rule 2: "Half-orc." — may NOT take trophies (CoE 3.IV.1.1) ─────────────

  test('Half-orc that defeats a creature is NOT offered it as a trophy — combat finalizes', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [EUOG] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const euogId = findCharInstanceId(base, RESOURCE_PLAYER, EUOG);
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
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: euogId, excessStrikes: 0, resolved: true, result: 'success' }],
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

    const [bodyCheckAction] = viableActions(state, PLAYER_1, 'body-check-roll');
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
      creatureRace: Race.Orc,
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

    const [bodyCheckAction] = viableActions(state, PLAYER_1, 'body-check-roll');
    const after = dispatch(state, bodyCheckAction.action);

    expect(after.combat?.phase).toBe('trophy-offer');
    expect(after.combat?.trophyEligibleCharacters).toContain(orcId);
  });

  // ─── Rule 3: "Leader." — one leader per company at a non-haven (rule 3.26) ──

  test('merge with a second leader company is blocked at a non-haven site', () => {
    // Euog and Gorbag are both leaders. Two single-character companies at the
    // same non-haven site (Moria) may not merge — two leaders in one company.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: MORIA_MINION, characters: [EUOG] },
            { site: MORIA_MINION, characters: [GORBAG] },
          ],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    // Share the same site instance between both companies (required for merge).
    const sharedSite = built.players[0].companies[0].currentSite!;
    const state: GameState = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, currentSite: sharedSite, siteCardOwned: false } : c,
          ),
        },
        built.players[1],
      ] as typeof built.players,
    };

    const mergeActions = viableActions(state, PLAYER_1, 'merge-companies');
    expect(mergeActions).toHaveLength(0);
  });

  test('Control: merge with a non-leader company is viable at the same site', () => {
    // Same shape, but the second company holds Grishnákh (non-leader): only one
    // leader (Euog) would result, so the merge is offered.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: MORIA_MINION, characters: [EUOG] },
            { site: MORIA_MINION, characters: [GRISHNAKH] },
          ],
          hand: [],
          siteDeck: [MINAS_MORGUL],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });
    const sharedSite = built.players[0].companies[0].currentSite!;
    const state: GameState = {
      ...built,
      players: [
        {
          ...built.players[0],
          companies: built.players[0].companies.map((c, i) =>
            i === 1 ? { ...c, currentSite: sharedSite, siteCardOwned: false } : c,
          ),
        },
        built.players[1],
      ] as typeof built.players,
    };

    const company0Id = companyIdAt(state, RESOURCE_PLAYER);
    const mergeActions = viableActions(state, PLAYER_1, 'merge-companies') as { action: MergeCompaniesAction }[];
    const company1Id = `company-${PLAYER_1 as string}-1` as CompanyId;
    const leaderMerge = mergeActions.find(
      ea => ea.action.sourceCompanyId === company1Id && ea.action.targetCompanyId === company0Id,
    );
    expect(leaderMerge).toBeDefined();
  });

  // ─── Rule 4: "Discard on a body check result of 9." (discardBodyCheck [9]) ──

  test('body check roll of exactly 9 discards Euog (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [EUOG] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const euogId = findCharInstanceId(state, RESOURCE_PLAYER, EUOG);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, EUOG, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: euogId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === euogId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === euogId)).toBe(false);
  });

  test('body check roll above 9 eliminates Euog', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [EUOG] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const euogId = findCharInstanceId(state, RESOURCE_PLAYER, EUOG);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, EUOG, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: euogId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === euogId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === euogId)).toBe(false);
  });

  // ─── Rule 5: "+2 DI against Orcs" (influence-check, character control) ──────

  test('+2 DI vs Orcs lets Euog control Grishnákh (orc, mind 3) as a follower', () => {
    // Euog base DI = 1. Grishnákh is an Orc of mind 3.
    // Without the +2: DI 1 < mind 3 → cannot control.
    // With +2 vs Orcs: DI 1 + 2 = 3 >= mind 3 → controllable under Euog's DI.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [EUOG] }],
          hand: [GRISHNAKH],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const euogId = findCharInstanceId(state, RESOURCE_PLAYER, EUOG);
    const underEuog = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.controlledBy === euogId);

    expect(underEuog.length).toBeGreaterThanOrEqual(1);
  });

  test('+2 DI bonus does NOT apply to a non-Orc character', () => {
    // Ostisen is race "man" with mind 2. The +2 DI bonus is race-gated (orc
    // only), so Euog's DI stays at 1 < mind 2 → cannot take him as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [EUOG] }],
          hand: [OSTISEN],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const euogId = findCharInstanceId(state, RESOURCE_PLAYER, EUOG);
    const underEuog = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.controlledBy === euogId);

    expect(underEuog).toHaveLength(0);
  });

  // ─── Rule 6: "+2 DI against Orc factions" (faction-influence-check) ─────────

  test('+2 DI vs Orc factions reduces the influence need against Goblins of Goblin-gate', () => {
    // Euog (base DI 1) influences Goblins of Goblin-gate (orc faction, inf# 9)
    // at Goblin-gate. need = influenceNumber(9) - DI(1) - orcFactionBonus(2) = 6.
    const state = buildMinionSitePhaseState({
      characters: [EUOG],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const euogId = findCharInstanceId(state, RESOURCE_PLAYER, EUOG);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const euogAttempt = influenceActions.find(a => a.influencingCharacterId === euogId);
    expect(euogAttempt).toBeDefined();
    expect(euogAttempt!.need).toBe(6);
  });
});
