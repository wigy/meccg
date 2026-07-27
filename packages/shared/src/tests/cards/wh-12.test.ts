/**
 * @module wh-12.test
 *
 * Card test: Uglúk (wh-12)
 * Type: minion-character
 *
 * "Unique. Uruk-hai. Leader. Discard on a body check result of 9.
 *  +3 direct influence against Orcs and Orc factions."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 *   race: orc, keywords: ["leader", "uruk-hai"], body 9, prowess 5, mind 5,
 *   DI 0, skills warrior/ranger, discardBodyCheck [9]. Unique.
 *   Homesite "Isengard". MP 2 (character).
 *
 * Engine Support:
 * | # | Rule (card text)                        | Status | Notes                                               |
 * |---|-----------------------------------------|--------|-----------------------------------------------------|
 * | 1 | "Unique."                               | OK     | unique: true; deck-construction / duplication limit |
 * | 2 | "Uruk-hai."                             | DATA   | classification keyword, no standalone gate (wh-6)   |
 * | 3 | "Leader." → one leader per non-haven    | OK     | wouldViolateLeaderRestriction (rule 3.26,           |
 * |   |   company                               |        | organization-companies.ts)                          |
 * | 4 | "Discard on a body check result of 9."  | OK     | discardBodyCheck [9]; combat body check (rule 8.31) |
 * | 5 | "+3 DI against Orcs"                    | OK     | stat-modifier, when reason influence-check +        |
 * |   |                                         |        | target.race orc (availableDI, organization.ts)      |
 * | 6 | "+3 DI against Orc factions"            | OK     | stat-modifier, when reason faction-influence-check  |
 * |   |                                         |        | + faction.race orc (legal-actions/site.ts)          |
 *
 * Playable: YES
 *
 * Fixture alignment: minion-character (ringwraith), so all fixtures are minion
 * cards (LE) per the project's minion-fixture rule.
 *
 * Fixtures:
 *   UGLUK (wh-12)              — subject: minion Orc Uruk-hai leader, body 9, DI 0
 *   GORBAG (le-11)             — second minion Orc leader (leader-restriction control)
 *   GRISHNAKH (le-12)          — minion orc, mind 3, non-leader (DI target / merge control)
 *   OSTISEN (le-36)            — minion man, mind 2, no effects (DI negative control)
 *   GOBLINS_OF_GOBLIN_GATE (le-265) — minion orc faction, influence# 9
 *   GOBLIN_GATE (le-378)       — shadow-hold where that faction is playable
 *   CARN_DUM (le-359)          — minion ruins-and-lairs (combat company site)
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
  makeBodyCheckCombat, makeShadowMHState, setCharStatus,
  RESOURCE_PLAYER, CardStatus,
} from '../test-helpers.js';
import { computeLegalActions, Phase, Alignment } from '../../index.js';
import type {
  CardDefinitionId, GameState, CompanyId,
  InfluenceAttemptAction, MergeCompaniesAction,
} from '../../index.js';

const UGLUK = 'wh-12' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;      // second Orc leader
const GRISHNAKH = 'le-12' as CardDefinitionId;   // orc, mind 3, non-leader
const OSTISEN = 'le-36' as CardDefinitionId;     // man, mind 2, no effects

const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc faction, influence# 9
const GOBLIN_GATE = 'le-378' as CardDefinitionId;            // shadow-hold

const CARN_DUM = 'le-359' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Uglúk (wh-12)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (the conditional DI bonus must not inflate base stats) ──────

  test('base effective DI is 0 (conditional +3 does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [UGLUK] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, UGLUK).effectiveStats.directInfluence).toBe(0);
  });

  // ─── Rule: "Leader." — one leader per company at a non-haven (rule 3.26) ────

  test('merge with a second leader company is blocked at a non-haven site', () => {
    // Uglúk and Gorbag are both leaders. Two single-character companies at the
    // same non-haven site (Moria) may not merge — that would put two leaders
    // into one company.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: MORIA_MINION, characters: [UGLUK] },
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
    // leader (Uglúk) would result, so the merge is offered.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: MORIA_MINION, characters: [UGLUK] },
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

  // ─── Rule: "Discard on a body check result of 9." (discardBodyCheck [9]) ────

  test('body check roll of exactly 9 discards Uglúk (not eliminated)', () => {
    // Uglúk's body is 9, so a roll of 9 would normally be a pass. The printed
    // discard number overrides that: he is discarded to the discard pile.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [UGLUK] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const uglukId = findCharInstanceId(state, RESOURCE_PLAYER, UGLUK);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, UGLUK, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: uglukId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === uglukId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === uglukId)).toBe(false);
  });

  test('body check roll above 9 eliminates Uglúk', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [UGLUK] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const uglukId = findCharInstanceId(state, RESOURCE_PLAYER, UGLUK);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, UGLUK, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: uglukId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === uglukId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === uglukId)).toBe(false);
  });

  test('body check roll below the discard number leaves Uglúk in play', () => {
    // Roll 8 is neither the discard number (9) nor above his body (9) — he
    // survives the body check wounded.
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [UGLUK] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const uglukId = findCharInstanceId(state, RESOURCE_PLAYER, UGLUK);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, UGLUK, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: uglukId }),
      cheatRollTotal: 8,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === uglukId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === uglukId)).toBe(false);
  });

  // ─── Rule: "+3 DI against Orcs" (influence-check, character control) ────────

  test('+3 DI vs Orcs lets Uglúk control Grishnákh (orc, mind 3) as a follower', () => {
    // Uglúk base DI = 0. Grishnákh is an Orc of mind 3.
    // Without the +3: DI 0 < mind 3 → cannot control.
    // With +3 vs Orcs: DI 0 + 3 = 3 >= mind 3 → controllable under Uglúk's DI.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [UGLUK] }],
          hand: [GRISHNAKH],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const uglukId = findCharInstanceId(state, RESOURCE_PLAYER, UGLUK);
    const underUgluk = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.controlledBy === uglukId);

    expect(underUgluk.length).toBeGreaterThanOrEqual(1);
  });

  test('+3 DI bonus does NOT apply to a non-Orc character', () => {
    // Ostisen is race "man" with mind 2. The +3 DI bonus is race-gated (orc
    // only), so Uglúk's DI stays at 0 < mind 2 → he cannot take Ostisen as a
    // follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [UGLUK] }],
          hand: [OSTISEN],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const uglukId = findCharInstanceId(state, RESOURCE_PLAYER, UGLUK);
    const underUgluk = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.controlledBy === uglukId);

    expect(underUgluk).toHaveLength(0);
  });

  // ─── Rule: "+3 DI against Orc factions" (faction-influence-check) ───────────

  test('+3 DI vs Orc factions reduces the influence need against Goblins of Goblin-gate', () => {
    // Uglúk (base DI 0) influences Goblins of Goblin-gate (orc faction, inf# 9)
    // at Goblin-gate. need = influenceNumber(9) - DI(0) - orcFactionBonus(3) = 6.
    const state = buildMinionSitePhaseState({
      characters: [UGLUK],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const uglukId = findCharInstanceId(state, RESOURCE_PLAYER, UGLUK);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const uglukAttempt = influenceActions.find(a => a.influencingCharacterId === uglukId);
    expect(uglukAttempt).toBeDefined();
    expect(uglukAttempt!.need).toBe(6);
  });
});
