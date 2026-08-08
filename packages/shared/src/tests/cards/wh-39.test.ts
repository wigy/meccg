/**
 * @module wh-39.test
 *
 * Card test: Wild Horses (wh-39)
 * Type: hero-resource-faction (wizard, non-unique, 1 MP, influence # 12, Animal)
 *
 * Card text: "Playable at any tapped or untapped non-Haven site in Rohan,
 * Khand, Dorwinion, Horse Plains, Southern Rhovanion, or Harondor if the
 * influence check is greater than 11. Standard Modifications: Men with home
 * sites in the regions listed above (+3). Tap this faction to allow any
 * company with one of the regions listed above in its site path to move up
 * to 1 additional region."
 *
 * Effects:
 *   1. `playableAt` — a `PlayableAtAny` entry (`{ any: true, when }`): any site
 *      whose type is not haven and whose named region is one of the six
 *      listed. Influence # 12 gives the "greater than 11" threshold.
 *   2. play-flag "playable-at-tapped-site" — the influence attempt may be made
 *      at a tapped qualifying site.
 *   3. check-modifier influence +3 when the influencing character is a Man
 *      whose home site(s) lie in one of the six listed regions
 *      (`bearer.race` + NEW `bearer.homesiteRegions`, resolved by
 *      `characterHomeSiteRegions`).
 *   4. grant-action "wild-horses-extra-region", cost `{ tap: "self" }`,
 *      `targets: { scope: "player-companies", movingThroughRegionNames }`
 *      (NEW target-enumeration field, sibling of `movingThroughRegionType`),
 *      apply `increment-company-extra-region-distance`. The bearer-less
 *      faction rides `bareCardGrantActions` (organization.ts, now
 *      generalized to tap-cost + per-company targets) →
 *      `handleInPlayCardGrantAction` (grant-action-apply.ts, now generalized
 *      to resolve the target company from `action.targetCompanyId` when there
 *      is no bearer).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  makeSitePhase, makeMHState, setCompanySiteStatus,
  firstFactionInfluenceAttempt, viableActions, dispatch, companyIdAt,
} from '../test-helpers.js';
import type { CompanySetup } from '../test-helpers.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, GameState,
  InfluenceAttemptAction, ActivateGrantedAction, MovementHazardPhaseState,
} from '../../index.js';

const WILD_HORSES = 'wh-39' as CardDefinitionId;

/** Man, homesite Edoras (Rohan) — qualifies for the +3 standard modification. */
const THEODEN = 'tw-182' as CardDefinitionId;
/** Man, homesite Lake-town (Northern Rhovanion — NOT one of the six listed regions). */
const BARD_BOWMAN = 'tw-124' as CardDefinitionId;
/** Elf — negative race control (not a Man, regardless of home region). */
const LEGOLAS = 'tw-168' as CardDefinitionId;
/** Filler character for the idle opponent company. */
const ARAGORN = 'tw-120' as CardDefinitionId;

const EDORAS = 'tw-394' as CardDefinitionId;      // free-hold, Rohan — qualifies
const RIVENDELL = 'tw-421' as CardDefinitionId;   // haven — excluded (site type)
const MORIA = 'tw-413' as CardDefinitionId;       // shadow-hold, Redhorn Gate — excluded (region)
const LORIEN = 'tw-408' as CardDefinitionId;      // opponent haven
/** Southern Rhovanion — exactly 5 regions from Edoras (Rohan) by the shortest
 *  real region-graph path, i.e. unreachable within the base max region
 *  distance (4) but reachable with Wild Horses' +1. */
const BUHR_WIDU = 'td-173' as CardDefinitionId;

const ACTION_ID = 'wild-horses-extra-region';

// ── Rules 1–2: playability ──────────────────────────────────────────────

/** Hero player holding Wild Horses in hand at `site`, in the site phase. */
function handState(site: CardDefinitionId, chars: CardDefinitionId[] = [THEODEN]): GameState {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Site,
    recompute: true,
    players: [
      { id: PLAYER_1, companies: [{ site, characters: chars }], hand: [WILD_HORSES], siteDeck: [RIVENDELL] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
    ],
  });
  return { ...base, phaseState: makeSitePhase() };
}

/** The influence-attempt for a specific influencing character against the faction. */
function attemptBy(state: GameState, factionId: CardInstanceId, charId: CardInstanceId): InfluenceAttemptAction | undefined {
  return viableActions(state, PLAYER_1, 'influence-attempt')
    .map(a => a.action as InfluenceAttemptAction)
    .find(a => a.factionInstanceId === factionId && a.influencingCharacterId === charId);
}

describe('Wild Horses (wh-39)', () => {
  beforeEach(() => resetMint());

  test('influence-attempt is legal at a non-Haven site in a listed region (Edoras, Rohan)', () => {
    const state = handState(EDORAS);
    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeDefined();
  });

  test('NOT playable at a Haven, even one in a listed region', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [THEODEN] }], hand: [WILD_HORSES], siteDeck: [EDORAS] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  test('NOT playable at a non-Haven site outside the listed regions (Moria, Redhorn Gate)', () => {
    const state = handState(MORIA);
    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  test('playable at a TAPPED qualifying site (playable-at-tapped-site)', () => {
    const base = handState(EDORAS);
    const state = setCompanySiteStatus(base, RESOURCE_PLAYER, 0, CardStatus.Tapped);
    const factionId = state.players[0].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeDefined();
  });

  // ── Rule 3 (Standard Modification): Men with home sites in a listed region (+3) ──

  test('a Man with a home site in a listed region gets +3 (need = 12 - DI - 3)', () => {
    const state = handState(EDORAS, [THEODEN]);
    const factionId = state.players[0].hand[0].instanceId;
    const theodenId = state.players[0].companies[0].characters[0];
    // Théoden: influence # 12, DI 3, +3 home-region bonus → need 6.
    expect(attemptBy(state, factionId, theodenId)!.need).toBe(6);
  });

  test('a Man WITHOUT a home site in a listed region gets no bonus (need = 12 - DI)', () => {
    const state = handState(EDORAS, [BARD_BOWMAN]);
    const factionId = state.players[0].hand[0].instanceId;
    const bardId = state.players[0].companies[0].characters[0];
    // Bard Bowman: influence # 12, DI 0, no bonus (Lake-town is in Northern
    // Rhovanion, not one of the six listed regions) → need 12.
    expect(attemptBy(state, factionId, bardId)!.need).toBe(12);
  });

  test('a non-Man character gets no bonus regardless of home region (need = 12 - DI)', () => {
    const state = handState(EDORAS, [LEGOLAS]);
    const factionId = state.players[0].hand[0].instanceId;
    const legolasId = state.players[0].companies[0].characters[0];
    // Legolas: influence # 12, DI 2, no bonus (not a Man) → need 10.
    expect(attemptBy(state, factionId, legolasId)!.need).toBe(10);
  });

  // ── Rule 4: tap to grant +1 region distance to a company moving through a listed region ──

  /** Hero player with Wild Horses already in play as a controlled faction. */
  function orgStateWithFaction(
    companies: CompanySetup[],
    wildHorsesStatus: CardStatus = CardStatus.Untapped,
  ): GameState {
    const wildHorses: CardInPlay = {
      instanceId: 'wild-horses-inplay' as CardInstanceId, definitionId: WILD_HORSES, status: wildHorsesStatus,
    };
    return buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies, hand: [], siteDeck: [RIVENDELL], cardsInPlay: [wildHorses] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });
  }

  function wildHorsesGrants(state: GameState): ActivateGrantedAction[] {
    return viableActions(state, PLAYER_1, 'activate-granted-action')
      .map(ea => ea.action as ActivateGrantedAction)
      .filter(a => a.actionId === ACTION_ID);
  }

  test('offered only for a company already moving through one of the listed regions', () => {
    const state = orgStateWithFaction([
      { site: EDORAS, characters: [ARAGORN] },                              // stationary — excluded
      { site: EDORAS, characters: [THEODEN], destinationSite: EDORAS },     // Rohan ✓
      { site: EDORAS, characters: [LEGOLAS], destinationSite: MORIA },      // Redhorn Gate ✗
    ]);
    const grants = wildHorsesGrants(state);
    expect(grants.map(g => g.targetCompanyId)).toEqual([companyIdAt(state, RESOURCE_PLAYER, 1)]);
  });

  test('not offered when Wild Horses is already tapped', () => {
    const state = orgStateWithFaction(
      [{ site: EDORAS, characters: [THEODEN], destinationSite: EDORAS }],
      CardStatus.Tapped,
    );
    expect(wildHorsesGrants(state).length).toBe(0);
  });

  test('activating taps Wild Horses and sets the target company\'s extraRegionDistance to 1', () => {
    const state = orgStateWithFaction([
      { site: EDORAS, characters: [THEODEN], destinationSite: EDORAS },
    ]);
    const companyId = companyIdAt(state, RESOURCE_PLAYER, 0);

    const after = dispatch(state, wildHorsesGrants(state)[0]);

    const wh = after.players[RESOURCE_PLAYER].cardsInPlay.find(c => c.definitionId === WILD_HORSES);
    expect(wh?.status).toBe(CardStatus.Tapped);
    const company = after.players[RESOURCE_PLAYER].companies.find(c => c.id === companyId);
    expect(company?.extraRegionDistance).toBe(1);
  });

  test('activating a second time is no longer offered (Wild Horses just tapped itself)', () => {
    const state = orgStateWithFaction([
      { site: EDORAS, characters: [THEODEN], destinationSite: EDORAS },
    ]);
    const after = dispatch(state, wildHorsesGrants(state)[0]);
    expect(wildHorsesGrants(after).length).toBe(0);
  });

  // ── Rule 4, end-to-end: the +1 actually makes an otherwise-unreachable
  // destination legal at the movement/hazard phase's select-company step ──

  test('without the bonus, a 5-region destination is unreachable (maxRegionDistance 4, no legal path)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [THEODEN], destinationSite: BUHR_WIDU }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const companyId = base.players[RESOURCE_PLAYER].companies[0].id;
    const ready = { ...base, phaseState: makeMHState({ step: 'select-company' }) };

    const afterSelect = dispatch(ready, { type: 'select-company', player: PLAYER_1, companyId });
    const phaseState = afterSelect.phaseState as MovementHazardPhaseState;

    expect(phaseState.maxRegionDistance).toBe(4);
    expect(viableActions(afterSelect, PLAYER_1, 'declare-path').length).toBe(0);
  });

  test('with the bonus (extraRegionDistance 1), the same 5-region destination becomes reachable', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [THEODEN], destinationSite: BUHR_WIDU }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    // Wild Horses was tapped during the preceding organization phase.
    const withBonus: GameState = {
      ...base,
      players: [
        { ...base.players[0], companies: [{ ...base.players[0].companies[0], extraRegionDistance: 1 }] },
        base.players[1],
      ],
    };
    const companyId = withBonus.players[RESOURCE_PLAYER].companies[0].id;
    const ready = { ...withBonus, phaseState: makeMHState({ step: 'select-company' }) };

    const afterSelect = dispatch(ready, { type: 'select-company', player: PLAYER_1, companyId });
    const phaseState = afterSelect.phaseState as MovementHazardPhaseState;

    expect(phaseState.maxRegionDistance).toBe(5);
    expect(viableActions(afterSelect, PLAYER_1, 'declare-path').length).toBeGreaterThanOrEqual(1);
  });
});
