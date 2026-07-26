/**
 * @module ba-46.test
 *
 * Card test: Great Troll (ba-46)
 * Type: minion-resource-ally, alignment ringwraith, non-unique.
 * Marshalling Points: 1 (ally). Prowess 6 / Body 8. Troll. Balrog specific.
 *
 * Card text: "Balrog specific. Playable at a non-Darkhaven Under-deeps site and
 * only by The Balrog. Troll. Its controlling character's company is overt. Even
 * if tapped or wounded, you may assign a strike to this ally as though it were
 * untapped."
 *
 * Rule coverage:
 *
 * | # | Rule                                                          | Mechanism                                                              |
 * |---|---------------------------------------------------------------|------------------------------------------------------------------------|
 * | 0 | Balrog specific / only by The Balrog                          | `balrog-specific` keyword (deck construction) — no play-time gate       |
 * | 1 | Playable at a non-Darkhaven Under-deeps site                  | playableAt `any` + `when` (site.keywords $includes under-deeps + site.siteType $ne haven) |
 * | 1b| NOT playable at a Darkhaven Under-deeps site (The Under-gates) | the `site.siteType $ne haven` clause                                   |
 * | 1c| NOT playable at a non-Under-deeps site                        | the `site.keywords $includes under-deeps` clause                       |
 * | 1d| Site must be untapped (no "tapped or untapped" in text)       | no `playable-at-tapped-site` flag                                       |
 * | 2 | Controlling character's company is overt                      | `company-overt` effect (isCovertCompany reads ally defs)               |
 * | 3 | Assignable a strike even if tapped or wounded                  | `assign-strike-when-tapped` effect (defender-phase ally offer)         |
 * | 3b| Does NOT force strikes onto it first (unlike strike-shield)    | controlling character still assignable while the ally is unassigned    |
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  Alignment, CardStatus,
  buildTestState, buildMinionSitePhaseState, resetMint,
  attachAllyToChar, findCharInstanceId, companyIdAt,
  viableActions, viableActionsForHandCard, makeShadowMHState,
  RESOURCE_PLAYER, PLAYER_1, PLAYER_2, Phase,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId, PlayerState } from '../../index.js';
import { isCovertCompany } from '../../engine/reducer-utils.js';

const GREAT_TROLL = 'ba-46' as CardDefinitionId;
const CAVE_TROLL = 'ba-35' as CardDefinitionId;   // Under-deeps Troll ally WITHOUT assign-strike-when-tapped
const LUITPRAND = 'le-23' as CardDefinitionId;    // minion character, race man → covert on its own

// Under-deeps sites (Balrog set).
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId;  // dark-hold, under-deeps
const UNDER_LEAS = 'ba-102' as CardDefinitionId;      // shadow-hold, under-deeps
const UNDER_GATES = 'ba-100' as CardDefinitionId;     // haven (Darkhaven), under-deeps
const ETTENMOORS = 'le-373' as CardDefinitionId;      // ruins-and-lairs, NOT under-deeps

/** Build a minion combat in the defender assign-strikes phase with the ally already in the company. */
const troop = {
  attackSource: { type: 'creature' as const, instanceId: 'fake-orc' as CardInstanceId },
  attackingPlayerId: PLAYER_2,
  defendingPlayerId: PLAYER_1,
  strikesTotal: 2,
  strikeProwess: 5,
  creatureBody: null,
  creatureRace: 'orc',
  currentStrikeIndex: 0,
  phase: 'assign-strikes' as const,
  assignmentPhase: 'defender' as const,
  bodyCheckTarget: null,
  detainment: false,
};

describe('Great Troll (ba-46)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playability keying ───────────────────────────────────────────

  test('playable at a non-Darkhaven Under-deeps site (Under-galleries, dark-hold)', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [LUITPRAND], hand: [GREAT_TROLL] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, GREAT_TROLL).length).toBeGreaterThanOrEqual(1);
  });

  test('playable at another non-Darkhaven Under-deeps site of a different type (Under-leas, shadow-hold)', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_LEAS, characters: [LUITPRAND], hand: [GREAT_TROLL] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, GREAT_TROLL).length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a Darkhaven Under-deeps site (The Under-gates, haven)', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GATES, characters: [LUITPRAND], hand: [GREAT_TROLL] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, GREAT_TROLL)).toHaveLength(0);
  });

  test('NOT playable at a non-Under-deeps site (Ettenmoors)', () => {
    const state = buildMinionSitePhaseState({ site: ETTENMOORS, characters: [LUITPRAND], hand: [GREAT_TROLL] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, GREAT_TROLL)).toHaveLength(0);
  });

  test('NOT playable at a TAPPED Under-deeps site (no "tapped or untapped" clause)', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [LUITPRAND], hand: [GREAT_TROLL], siteStatus: CardStatus.Tapped });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, GREAT_TROLL)).toHaveLength(0);
  });

  // ─── Rule 2: controlling character's company is overt ─────────────────────

  test('a Man-only company bearing the Great Troll ally is OVERT', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, GREAT_TROLL);
    const company = withAlly.players[RESOURCE_PLAYER].companies[0];
    expect(isCovertCompany(company, withAlly.players[RESOURCE_PLAYER], withAlly)).toBe(false);
  });

  test('the same Man-only company WITHOUT the ally is covert (control)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [], hand: [], siteDeck: [] },
      ],
    });
    const company = base.players[RESOURCE_PLAYER].companies[0];
    expect(isCovertCompany(company, base.players[RESOURCE_PLAYER], base)).toBe(true);
  });

  // ─── Rule 3: assignable a strike even if tapped or wounded ─────────────────

  test('an UNTAPPED Great Troll is an assignable strike target (baseline)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const luitId = findCharInstanceId(base, RESOURCE_PLAYER, LUITPRAND);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, GREAT_TROLL);
    const trollId = withAlly.players[RESOURCE_PLAYER].characters[luitId].allies[0].instanceId;

    const combatState = { ...withAlly, combat: { ...troop, companyId, strikeAssignments: [] }, phaseState: makeShadowMHState() };
    const actions = viableActions(combatState, PLAYER_1, 'assign-strike');
    expect(actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === trollId)).toBeDefined();
  });

  test('a TAPPED Great Troll is still an assignable strike target (assign-strike-when-tapped)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const luitId = findCharInstanceId(base, RESOURCE_PLAYER, LUITPRAND);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, GREAT_TROLL);
    const trollId = withAlly.players[RESOURCE_PLAYER].characters[luitId].allies[0].instanceId;

    const tapped = {
      ...withAlly,
      players: withAlly.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        characters: {
          ...p.characters,
          [luitId as string]: {
            ...p.characters[luitId],
            allies: p.characters[luitId].allies.map(a => a.instanceId === trollId ? { ...a, status: CardStatus.Tapped } : a),
          },
        },
      }) as unknown as readonly [PlayerState, PlayerState],
    };

    const combatState = { ...tapped, combat: { ...troop, companyId, strikeAssignments: [] }, phaseState: makeShadowMHState() };
    const actions = viableActions(combatState, PLAYER_1, 'assign-strike');
    expect(actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === trollId)).toBeDefined();
  });

  test('a WOUNDED (inverted) Great Troll is still an assignable strike target', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const luitId = findCharInstanceId(base, RESOURCE_PLAYER, LUITPRAND);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, GREAT_TROLL);
    const trollId = withAlly.players[RESOURCE_PLAYER].characters[luitId].allies[0].instanceId;

    const wounded = {
      ...withAlly,
      players: withAlly.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        characters: {
          ...p.characters,
          [luitId as string]: {
            ...p.characters[luitId],
            allies: p.characters[luitId].allies.map(a => a.instanceId === trollId ? { ...a, status: CardStatus.Inverted } : a),
          },
        },
      }) as unknown as readonly [PlayerState, PlayerState],
    };

    const combatState = { ...wounded, combat: { ...troop, companyId, strikeAssignments: [] }, phaseState: makeShadowMHState() };
    const actions = viableActions(combatState, PLAYER_1, 'assign-strike');
    expect(actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === trollId)).toBeDefined();
  });

  test('negative control: a TAPPED ordinary ally (Cave Troll, no effect) is NOT an assignable strike target', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const luitId = findCharInstanceId(base, RESOURCE_PLAYER, LUITPRAND);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, CAVE_TROLL);
    const caveId = withAlly.players[RESOURCE_PLAYER].characters[luitId].allies[0].instanceId;

    const tapped = {
      ...withAlly,
      players: withAlly.players.map((p, i) => i !== RESOURCE_PLAYER ? p : {
        ...p,
        characters: {
          ...p.characters,
          [luitId as string]: {
            ...p.characters[luitId],
            allies: p.characters[luitId].allies.map(a => a.instanceId === caveId ? { ...a, status: CardStatus.Tapped } : a),
          },
        },
      }) as unknown as readonly [PlayerState, PlayerState],
    };

    const combatState = { ...tapped, combat: { ...troop, companyId, strikeAssignments: [] }, phaseState: makeShadowMHState() };
    const actions = viableActions(combatState, PLAYER_1, 'assign-strike');
    expect(actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === caveId)).toBeUndefined();
  });

  test('the Great Troll does NOT force strikes onto it first (controlling character still assignable)', () => {
    const base = buildTestState({
      phase: Phase.MovementHazard,
      activePlayer: PLAYER_1,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: UNDER_GALLERIES, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const luitId = findCharInstanceId(base, RESOURCE_PLAYER, LUITPRAND);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, GREAT_TROLL);

    const combatState = { ...withAlly, combat: { ...troop, companyId, strikeAssignments: [] }, phaseState: makeShadowMHState() };
    const actions = viableActions(combatState, PLAYER_1, 'assign-strike');
    // Unlike Noble Hound's strike-shield, the controlling character remains a
    // legal strike target even though the Great Troll has no strike yet.
    expect(actions.find(a => (a.action as { characterId?: CardInstanceId }).characterId === luitId)).toBeDefined();
  });
});
