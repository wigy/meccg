/**
 * @module as-2.test
 *
 * Card test: Mauhúr (as-2)
 * Type: minion-character (Ringwraith alignment)
 *
 * "Unique. Leader. Discard on a body check result of 9.
 *  +2 direct influence against Orcs and Orc factions."
 *
 * Card shape (documented here, NOT asserted — see CLAUDE.md no-tautology rule):
 *   race: orc, keywords: ["leader"], body 9, prowess 6, mind 5, DI 0,
 *   skills warrior, discardBodyCheck [9]. Unique. Homesite "Dol Guldur".
 *   MP 2 (character).
 *
 * Engine Support:
 * | # | Rule (card text)                        | Status | Notes                                               |
 * |---|-----------------------------------------|--------|-----------------------------------------------------|
 * | 1 | "Leader." → one leader per non-haven    | OK     | wouldViolateLeaderRestriction (rule 3.26,           |
 * |   |   company                               |        | organization-companies.ts)                          |
 * | 2 | "Discard on a body check result of 9."  | OK     | discardBodyCheck [9]; combat body check (rule 8.31, |
 * |   |                                         |        | combat-actions.ts) — 9 discards, 10+ eliminates     |
 * | 3 | "+2 DI against Orcs"                    | OK     | stat-modifier, when reason influence-check +        |
 * |   |                                         |        | target.race orc (availableDI, organization.ts)      |
 * | 4 | "+2 DI against Orc factions"            | OK     | stat-modifier, when reason faction-influence-check  |
 * |   |                                         |        | + faction.race orc (legal-actions/site.ts)          |
 *
 * Playable: YES
 *
 * "Unique" is enforced by deck construction; the warrior skill and the printed
 * prowess/body/mind are base stats handled by the engine. Those are documented
 * here, not asserted against the JSON.
 *
 * Fixtures:
 *   MAUHUR (as-2)              — minion Orc leader, body 9, DI 0, discardBodyCheck [9]
 *   GORBAG (le-11)             — second minion Orc leader (leader-restriction control)
 *   GRISHNAKH (le-12)          — minion orc, mind 3, non-leader (merge control)
 *   ORC_VETERAN (le-35)        — minion orc, mind 2 (follower under DI 0 + 2)
 *   OSTISEN (le-36)            — minion man, mind 2 (race-gate negative control)
 *   GOBLINS_OF_GOBLIN_GATE (le-265) — minion orc faction, influence# 9
 *   GOBLIN_GATE (le-378)       — shadow-hold where that faction is playable
 *   BLACK_TROLLS (le-262)      — minion troll faction, influence# 11 (negative control)
 *   CIRITH_GORGOR (le-361)     — dark-hold where Black Trolls are playable
 *   CARN_DUM (le-359)          — minion site (combat company site)
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

const MAUHUR = 'as-2' as CardDefinitionId;
const GORBAG = 'le-11' as CardDefinitionId;      // second Orc leader
const GRISHNAKH = 'le-12' as CardDefinitionId;   // orc, mind 3, non-leader
const ORC_VETERAN = 'le-35' as CardDefinitionId; // orc, mind 2
const OSTISEN = 'le-36' as CardDefinitionId;     // man, mind 2

const GOBLINS_OF_GOBLIN_GATE = 'le-265' as CardDefinitionId; // orc faction, influence# 9
const GOBLIN_GATE = 'le-378' as CardDefinitionId;            // shadow-hold
const BLACK_TROLLS = 'le-262' as CardDefinitionId;           // troll faction, influence# 11
const CIRITH_GORGOR = 'le-361' as CardDefinitionId;          // dark-hold

const CARN_DUM = 'le-359' as CardDefinitionId;
const MORIA_MINION = 'le-392' as CardDefinitionId;
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
const DOL_GULDUR = 'le-367' as CardDefinitionId;

describe('Mauhúr (as-2)', () => {
  beforeEach(() => resetMint());

  // ─── Base stats (conditional DI bonuses do not inflate base stats) ──────────

  test('base effective DI is 0 (conditional +2 does not inflate base stats)', () => {
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [MAUHUR] }], hand: [], siteDeck: [MORIA_MINION] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    expect(getCharacter(state, RESOURCE_PLAYER, MAUHUR).effectiveStats.directInfluence).toBe(0);
  });

  // ─── Rule 1: "Leader." — one leader per company at a non-haven (rule 3.26) ──

  test('merge with a second leader company is blocked at a non-haven site', () => {
    // Mauhúr and Gorbag are both leaders. Two single-character companies at the
    // same non-haven site (Moria) may not merge — that would put two leaders in
    // one company.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: MORIA_MINION, characters: [MAUHUR] },
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
    // leader (Mauhúr) would result, so the merge is offered.
    const built = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [
            { site: MORIA_MINION, characters: [MAUHUR] },
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
    const company1Id = `company-${PLAYER_1 as string}-1` as CompanyId;
    const mergeActions = viableActions(state, PLAYER_1, 'merge-companies') as { action: MergeCompaniesAction }[];
    const nonLeaderMerge = mergeActions.find(
      ea => ea.action.sourceCompanyId === company1Id && ea.action.targetCompanyId === company0Id,
    );
    expect(nonLeaderMerge).toBeDefined();
  });

  // ─── Rule 2: "Discard on a body check result of 9." (discardBodyCheck [9]) ──

  test('body check roll of exactly 9 discards Mauhúr (not eliminated)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [MAUHUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const mauhurId = findCharInstanceId(state, RESOURCE_PLAYER, MAUHUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, MAUHUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: mauhurId }),
      cheatRollTotal: 9,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === mauhurId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === mauhurId)).toBe(false);
  });

  test('body check roll above 9 eliminates Mauhúr', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [MAUHUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const mauhurId = findCharInstanceId(state, RESOURCE_PLAYER, MAUHUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, MAUHUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: mauhurId }),
      cheatRollTotal: 10,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === mauhurId)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === mauhurId)).toBe(false);
  });

  test('body check roll of 8 leaves Mauhúr in his company (only 9 discards)', () => {
    const state = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CARN_DUM, characters: [MAUHUR] }], hand: [], siteDeck: [MINAS_MORGUL] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: DOL_GULDUR, characters: ['tw-168' as CardDefinitionId] }], hand: [], siteDeck: [MINAS_MORGUL] },
      ],
    });

    const mauhurId = findCharInstanceId(state, RESOURCE_PLAYER, MAUHUR);
    const companyId = companyIdAt(state, RESOURCE_PLAYER);
    const woundedState = setCharStatus(state, RESOURCE_PLAYER, MAUHUR, CardStatus.Inverted);
    const readyState: GameState = {
      ...woundedState,
      phaseState: makeShadowMHState(),
      combat: makeBodyCheckCombat({ companyId, characterId: mauhurId }),
      cheatRollTotal: 8,
    };

    const [bodyCheckAction] = viableActions(readyState, PLAYER_2, 'body-check-roll');
    const after = dispatch(readyState, bodyCheckAction.action);

    expect(after.players[RESOURCE_PLAYER].companies[0].characters).toContain(mauhurId);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === mauhurId)).toBe(false);
    expect(after.players[RESOURCE_PLAYER].outOfPlayPile.some(c => c.instanceId === mauhurId)).toBe(false);
  });

  // ─── Rule 3: "+2 DI against Orcs" (influence-check, character control) ──────

  test('+2 DI vs Orcs lets Mauhúr control Orc Veteran (orc, mind 2) as a follower', () => {
    // Mauhúr base DI = 0. Orc Veteran is an Orc of mind 2.
    // Without the +2: DI 0 < mind 2 → cannot control.
    // With +2 vs Orcs: DI 0 + 2 = 2 >= mind 2 → controllable under Mauhúr's DI.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [MAUHUR] }],
          hand: [ORC_VETERAN],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [OSTISEN] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const mauhurId = findCharInstanceId(state, RESOURCE_PLAYER, MAUHUR);
    const underMauhur = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.controlledBy === mauhurId);

    expect(underMauhur.length).toBeGreaterThanOrEqual(1);
  });

  test('+2 DI bonus does NOT apply to a non-Orc character', () => {
    // Ostisen is race "man" with mind 2. The +2 DI bonus is race-gated (orc
    // only), so Mauhúr's DI stays at 0 < mind 2 → cannot take him as a follower.
    const state = buildTestState({
      phase: Phase.Organization,
      activePlayer: PLAYER_1,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [MAUHUR] }],
          hand: [OSTISEN],
          siteDeck: [MORIA_MINION],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: DOL_GULDUR, characters: [GRISHNAKH] }], hand: [], siteDeck: [MORIA_MINION] },
      ],
    });

    const mauhurId = findCharInstanceId(state, RESOURCE_PLAYER, MAUHUR);
    const underMauhur = viablePlayCharacterActions(state, PLAYER_1)
      .filter(a => a.controlledBy === mauhurId);

    expect(underMauhur).toHaveLength(0);
  });

  // ─── Rule 4: "+2 DI against Orc factions" (faction-influence-check) ─────────

  test('+2 DI vs Orc factions reduces the influence need against Goblins of Goblin-gate', () => {
    // Mauhúr (base DI 0) influences Goblins of Goblin-gate (orc faction, inf# 9)
    // at Goblin-gate. need = influenceNumber(9) - DI(0) - orcFactionBonus(2) = 7.
    const state = buildMinionSitePhaseState({
      characters: [MAUHUR],
      site: GOBLIN_GATE,
      hand: [GOBLINS_OF_GOBLIN_GATE],
    });

    const mauhurId = findCharInstanceId(state, RESOURCE_PLAYER, MAUHUR);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const mauhurAttempt = influenceActions.find(a => a.influencingCharacterId === mauhurId);
    expect(mauhurAttempt).toBeDefined();
    expect(mauhurAttempt!.need).toBe(7);
  });

  test('+2 DI bonus does NOT apply to a non-Orc faction', () => {
    // Black Trolls (troll faction, inf# 11) at Cirith Gorgor: the bonus is
    // race-gated, so need = influenceNumber(11) - DI(0) = 11 (no reduction).
    const state = buildMinionSitePhaseState({
      characters: [MAUHUR],
      site: CIRITH_GORGOR,
      hand: [BLACK_TROLLS],
    });

    const mauhurId = findCharInstanceId(state, RESOURCE_PLAYER, MAUHUR);
    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction);

    const mauhurAttempt = influenceActions.find(a => a.influencingCharacterId === mauhurId);
    expect(mauhurAttempt).toBeDefined();
    expect(mauhurAttempt!.need).toBe(11);
  });
});
