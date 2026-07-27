/**
 * @module ba-47.test
 *
 * Card test: Nasty Slimy Thing (ba-47)
 * Type: minion-resource-ally (alignment ringwraith; Balrog-specific). Unique.
 * Stats: prowess 4, body 9, 1 MP (ally). Spawn.
 *
 * Card text:
 *   "Unique. Balrog specific. Spawn. Playable at a non-Darkhaven Under-deeps
 *    site. Its controlling character's company is overt. Tap to cancel a Drake
 *    attack against his company. Discard this ally if its company moves using
 *    region or starter movement."
 *
 * Effects:
 *   1. company-overt — controlling character's company is overt
 *   2. cancel-attack (cost tap:self, when enemy.race ∈ {drake}) — tap the ally
 *      in the defending company to cancel a Drake attack against it
 *   3. on-event: bearer-company-moves (when movementType ∈ {region, starter})
 *      → self-discard
 *   + playableAt: any non-Darkhaven Under-deeps site (site.keywords ⊇ under-deeps
 *     AND site.siteType ≠ haven)
 *   + unique: true, keywords: [balrog-specific, spawn]
 *
 * | # | Rule                                                       | Mechanism                                                    |
 * |---|------------------------------------------------------------|--------------------------------------------------------------|
 * | 0 | Unique / Balrog specific / Spawn                           | unique:true + `balrog-specific`/`spawn` keywords (no gate)   |
 * | 1 | Playable at a non-Darkhaven Under-deeps site               | playableAt `any`+`when` (under-deeps keyword, non-haven)     |
 * | 1b| NOT playable at a Darkhaven Under-deeps site               | the `site.siteType $ne haven` clause                         |
 * | 1c| NOT playable at a non-Under-deeps site                     | the `site.keywords $includes under-deeps` clause            |
 * | 2 | Controlling character's company is overt                  | `company-overt` effect (isCovertCompany reads ally defs)    |
 * | 3 | Tap the ally to cancel a Drake attack against his company | `cancel-attack` (tap:self, when enemy.race ∈ {drake})       |
 * | 3b| Does NOT cancel a non-Drake attack                        | the `when: enemy.race ∈ {drake}` gate                       |
 * | 3c| Tapped ally cannot cancel                                 | untapped requirement in cancelAttackActions                 |
 * | 4 | Discard if company moves via region/starter movement      | `bearer-company-moves` self-discard gated on movementType   |
 * | 4b| NOT discarded on Under-deeps movement                     | movementType gate excludes non-region/starter moves         |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  resetMint, buildTestState, buildMinionSitePhaseState,
  attachAllyToChar, getCharacter, findCharInstanceId, companyIdAt,
  viableActions, viableActionsForHandCard, makeShadowMHState, makeMHState,
  dispatch, Alignment, Phase, CardStatus,
} from '../test-helpers.js';
import { MovementType, Race } from '../../types/common.js';
import { isCovertCompany } from '../../engine/reducer-utils.js';
import { endCompanyMH } from '../../engine/mh-hazard-play.js';
import type { CardDefinitionId, CardInstanceId, GameState } from '../../index.js';
import type { CombatState } from '../../types/state-combat.js';

const NASTY_SLIMY_THING = 'ba-47' as CardDefinitionId;

// Under-deeps sites (Balrog set).
const UNDER_GALLERIES = 'ba-99' as CardDefinitionId;  // dark-hold, under-deeps
const UNDER_LEAS = 'ba-102' as CardDefinitionId;      // shadow-hold, under-deeps
const UNDER_GATES = 'ba-100' as CardDefinitionId;     // haven (Darkhaven), under-deeps
const ETTENMOORS = 'le-373' as CardDefinitionId;      // ruins-and-lairs, NOT under-deeps
const SULFUR_DEEPS = 'ba-97' as CardDefinitionId;     // under-deeps (a plain destination)

// A minion Man character (covert on its own — so `company-overt` is observable).
const LUITPRAND = 'le-23' as CardDefinitionId;

/** Base combat template: a single attack against P1's company in the defender window. */
const troop = {
  attackSource: { type: 'creature' as const, instanceId: 'fake-attacker' as CardInstanceId },
  attackingPlayerId: PLAYER_2,
  defendingPlayerId: PLAYER_1,
  strikesTotal: 2,
  strikeProwess: 13,
  creatureBody: null,
  currentStrikeIndex: 0,
  strikeAssignments: [] as CombatState['strikeAssignments'],
  phase: 'assign-strikes' as const,
  assignmentPhase: 'defender' as const,
  bodyCheckTarget: null,
  detainment: false,
};

/** Build an M/H state where P1's company (Luitprand + the ally) faces `creatureRace`. */
function buildCancelState(creatureRace: Race): { state: GameState; allyInst: CardInstanceId } {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    recompute: true,
    players: [
      { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND] }], hand: [], siteDeck: [SULFUR_DEEPS] },
      { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: SULFUR_DEEPS, characters: [] }], hand: [], siteDeck: [UNDER_GALLERIES] },
    ],
  });
  const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, NASTY_SLIMY_THING);
  const allyInst = getCharacter(withAlly, RESOURCE_PLAYER, LUITPRAND).allies[0].instanceId;
  const companyId = companyIdAt(withAlly, RESOURCE_PLAYER);
  const combat: CombatState = { ...troop, companyId, creatureRace };
  return { state: { ...withAlly, phaseState: makeShadowMHState(), combat }, allyInst };
}

describe('Nasty Slimy Thing (ba-47)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playability keying ───────────────────────────────────────────

  test('playable at a non-Darkhaven Under-deeps site (Under-galleries, dark-hold)', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GALLERIES, characters: [LUITPRAND], hand: [NASTY_SLIMY_THING] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, NASTY_SLIMY_THING).length).toBeGreaterThanOrEqual(1);
  });

  test('playable at another non-Darkhaven Under-deeps site of a different type (Under-leas, shadow-hold)', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_LEAS, characters: [LUITPRAND], hand: [NASTY_SLIMY_THING] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, NASTY_SLIMY_THING).length).toBeGreaterThanOrEqual(1);
  });

  test('NOT playable at a Darkhaven Under-deeps site (The Under-gates, haven)', () => {
    const state = buildMinionSitePhaseState({ site: UNDER_GATES, characters: [LUITPRAND], hand: [NASTY_SLIMY_THING] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, NASTY_SLIMY_THING)).toHaveLength(0);
  });

  test('NOT playable at a non-Under-deeps site (Ettenmoors)', () => {
    const state = buildMinionSitePhaseState({ site: ETTENMOORS, characters: [LUITPRAND], hand: [NASTY_SLIMY_THING] });
    expect(viableActionsForHandCard(state, PLAYER_1, 'play-hero-resource', RESOURCE_PLAYER, NASTY_SLIMY_THING)).toHaveLength(0);
  });

  // ─── Rule 2: controlling character's company is overt ─────────────────────

  test('a Man-only company bearing the ally is OVERT (covert without it — control)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Balrog, companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND] }], hand: [], siteDeck: [SULFUR_DEEPS] },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [], hand: [], siteDeck: [] },
      ],
    });
    // Control: without the ally an all-Man company is covert.
    expect(isCovertCompany(base.players[RESOURCE_PLAYER].companies[0], base.players[RESOURCE_PLAYER], base)).toBe(true);

    const withAlly = attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, NASTY_SLIMY_THING);
    const company = withAlly.players[RESOURCE_PLAYER].companies[0];
    expect(isCovertCompany(company, withAlly.players[RESOURCE_PLAYER], withAlly)).toBe(false);
  });

  // ─── Rule 3: tap the ally to cancel a Drake attack ────────────────────────

  test('the ally offers a cancel-attack action against a Drake attack', () => {
    const { state, allyInst } = buildCancelState(Race.Drake);
    const cancels = viableActions(state, PLAYER_1, 'cancel-attack')
      .filter(a => a.action.type === 'cancel-attack' && a.action.cardInstanceId === allyInst);
    expect(cancels).toHaveLength(1);
  });

  test('tapping the ally cancels the Drake attack and taps the ally', () => {
    const { state, allyInst } = buildCancelState(Race.Drake);
    const cancel = viableActions(state, PLAYER_1, 'cancel-attack')
      .find(a => a.action.type === 'cancel-attack' && a.action.cardInstanceId === allyInst);
    expect(cancel).toBeDefined();

    const after = dispatch(state, cancel!.action);
    expect(after.combat).toBeNull();
    expect(getCharacter(after, RESOURCE_PLAYER, LUITPRAND).allies[0].status).toBe(CardStatus.Tapped);
  });

  test('does NOT offer a cancel against a non-Drake (Orc) attack', () => {
    const { state, allyInst } = buildCancelState(Race.Orc);
    const cancels = viableActions(state, PLAYER_1, 'cancel-attack')
      .filter(a => a.action.type === 'cancel-attack' && a.action.cardInstanceId === allyInst);
    expect(cancels).toHaveLength(0);
  });

  test('an already-tapped ally cannot cancel a Drake attack', () => {
    const { state, allyInst } = buildCancelState(Race.Drake);
    // Tap the ally in place.
    const luitId = findCharInstanceId(state, RESOURCE_PLAYER, LUITPRAND);
    const p1 = state.players[RESOURCE_PLAYER];
    const p1Tapped = {
      ...p1,
      characters: {
        ...p1.characters,
        [luitId]: {
          ...p1.characters[luitId],
          allies: p1.characters[luitId].allies.map(a =>
            a.instanceId === allyInst ? { ...a, status: CardStatus.Tapped } : a),
        },
      },
    };
    const tapped: GameState = {
      ...state,
      players: [p1Tapped, state.players[HAZARD_PLAYER]],
    };
    const cancels = viableActions(tapped, PLAYER_1, 'cancel-attack')
      .filter(a => a.action.type === 'cancel-attack' && a.action.cardInstanceId === allyInst);
    expect(cancels).toHaveLength(0);
  });

  // ─── Rule 4: discard on region/starter movement, not Under-deeps ──────────

  /** Build an M/H state where the ally-bearing company is completing a move. */
  function buildMovingCompany(): GameState {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Balrog,
          companies: [{ site: UNDER_GALLERIES, characters: [LUITPRAND], destinationSite: SULFUR_DEEPS }],
          hand: [], siteDeck: [], playDeck: [],
        },
        { id: PLAYER_2, alignment: Alignment.Ringwraith, companies: [{ site: SULFUR_DEEPS, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    return attachAllyToChar(base, RESOURCE_PLAYER, LUITPRAND, NASTY_SLIMY_THING);
  }

  test.each([MovementType.Region, MovementType.Starter])(
    'the ally is discarded when its company moves using %s movement',
    (movementType) => {
      const state = buildMovingCompany();
      const allyInst = getCharacter(state, RESOURCE_PLAYER, LUITPRAND).allies[0].instanceId;

      const result = endCompanyMH(state, makeMHState({ movementType, activeCompanyIndex: 0 }));
      const after = result.state;

      expect(getCharacter(after, RESOURCE_PLAYER, LUITPRAND).allies).toHaveLength(0);
      expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === allyInst)).toBe(true);
    },
  );

  test('the ally is NOT discarded when its company moves using Under-deeps movement', () => {
    const state = buildMovingCompany();
    const allyInst = getCharacter(state, RESOURCE_PLAYER, LUITPRAND).allies[0].instanceId;

    const result = endCompanyMH(state, makeMHState({ movementType: MovementType.UnderDeeps, activeCompanyIndex: 0 }));
    const after = result.state;

    const allies = getCharacter(after, RESOURCE_PLAYER, LUITPRAND).allies;
    expect(allies.some(a => a.instanceId === allyInst)).toBe(true);
    expect(after.players[RESOURCE_PLAYER].discardPile.some(c => c.instanceId === allyInst)).toBe(false);
  });
});
