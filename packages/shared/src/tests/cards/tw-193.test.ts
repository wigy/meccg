/**
 * @module tw-193.test
 *
 * Card test: Army of the Dead (tw-193)
 * Type: hero-resource-faction
 * Effects: 1
 *
 * "Unique. Playable at Vale of Erech. May only be played by Aragorn II on the
 *  same turn that he plays Paths of the Dead. May not be influenced by an
 *  opponent."
 *
 * Effects tested:
 * 1. `requiredInfluencerName: "Aragorn II"` — only Aragorn II is offered as an
 *    influencer, even when another untapped character is in the same company.
 * 2. play-condition `active-company` — the faction is not playable unless the
 *    company's `specialMovement` is `"paths-of-the-dead"` (set only while the
 *    company used the special movement granted by Paths of the Dead tw-302
 *    this turn; cleared at end of turn).
 * 3. `noOpponentInfluence: true` — once in play, the faction can never be
 *    targeted by an opponent's re-influence attempt (CoE rule 8.3's faction
 *    re-influence clause).
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, LORIEN,
  buildSitePhaseState, buildTestState, resetMint, dispatch, makeMHState,
  findCharInstanceId, findHandCardId, RESOURCE_PLAYER, HAZARD_PLAYER,
  addCardInPlay,
} from '../test-helpers.js';
import { computeLegalActions, Phase, Alignment, CardStatus } from '../../index.js';
import { MovementType } from '../../types/common.js';
import type { InfluenceAttemptAction, CardDefinitionId, SitePhaseState } from '../../index.js';

const ARMY_OF_THE_DEAD = 'tw-193' as CardDefinitionId;
const FORLONG = 'tw-151' as CardDefinitionId;
const VALE_OF_ERECH = 'tw-434' as CardDefinitionId;
const DUNHARROW = 'tw-389' as CardDefinitionId;

describe('Army of the Dead (tw-193)', () => {
  beforeEach(() => resetMint());

  test('only Aragorn II is offered as an influencer, even with another untapped character in the company', () => {
    const base = buildSitePhaseState({
      characters: [ARAGORN, FORLONG],
      site: VALE_OF_ERECH,
      hand: [ARMY_OF_THE_DEAD],
    });
    const state = {
      ...base,
      players: [
        { ...base.players[0], companies: [{ ...base.players[0].companies[0], specialMovement: 'paths-of-the-dead' as const }] },
        base.players[1],
      ] as typeof base.players,
    };

    const aragornId = findCharInstanceId(state, RESOURCE_PLAYER, ARAGORN);
    const forlongId = findCharInstanceId(state, RESOURCE_PLAYER, FORLONG);
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, ARMY_OF_THE_DEAD);

    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.factionInstanceId === cardInstance);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);
    expect(influenceActions.every(a => a.influencingCharacterId === aragornId)).toBe(true);
    expect(influenceActions.some(a => a.influencingCharacterId === forlongId)).toBe(false);
  });

  test('not playable when the company has not used Paths of the Dead special movement this turn', () => {
    const state = buildSitePhaseState({
      characters: [ARAGORN, FORLONG],
      site: VALE_OF_ERECH,
      hand: [ARMY_OF_THE_DEAD],
    });
    const cardInstance = findHandCardId(state, RESOURCE_PLAYER, ARMY_OF_THE_DEAD);

    const influenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.factionInstanceId === cardInstance);

    expect(influenceActions).toHaveLength(0);
  });

  test('specialMovement (and playability) survives the movement/hazard→site phase transition after Paths of the Dead', () => {
    // Bug report: a player who played Paths of the Dead this turn and moved
    // Aragorn II's company to Vale of Erech was refused Army of the Dead once
    // the site phase began — the M/H→Site transition was wiping
    // `company.specialMovement` before the site phase (where faction resources
    // are actually played) ever started.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, alignment: Alignment.Wizard, companies: [{ site: DUNHARROW, characters: [ARAGORN] }], hand: [ARMY_OF_THE_DEAD], siteDeck: [VALE_OF_ERECH] },
        { id: PLAYER_2, alignment: Alignment.Wizard, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [] },
      ],
    });

    const company = base.players[RESOURCE_PLAYER].companies[0];
    const dest = base.players[RESOURCE_PLAYER].siteDeck.find(c => c.definitionId === VALE_OF_ERECH)!;

    // Simulate Paths of the Dead already played this turn's organization
    // phase: the company is en route to Vale of Erech via special movement.
    const withMovement = {
      ...base,
      phaseState: makeMHState({
        activeCompanyIndex: 0,
        movementType: MovementType.Special,
        resolvedSitePath: [],
      }),
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: [{
            ...company,
            siteCardOwned: true,
            destinationSite: { instanceId: dest.instanceId, definitionId: dest.definitionId, status: CardStatus.Untapped },
            specialMovement: 'paths-of-the-dead' as const,
          }],
        },
        base.players[HAZARD_PLAYER],
      ] as typeof base.players,
    };

    // Complete the company's movement/hazard sub-phase (no hazards played) —
    // this drives the actual M/H→Site transition reducer code.
    const afterPass1 = dispatch(withMovement, { type: 'pass', player: PLAYER_1 });
    const inSitePhase = dispatch(afterPass1, { type: 'pass', player: PLAYER_2 });
    expect(inSitePhase.phaseState.phase).toBe(Phase.Site);

    const movedCompany = inSitePhase.players[RESOURCE_PLAYER].companies[0];
    expect(movedCompany.currentSite?.definitionId).toBe(VALE_OF_ERECH);
    expect(movedCompany.specialMovement).toBe('paths-of-the-dead');

    // Drive the company all the way to the play-resources step, exactly as
    // the reported game did: select it, enter the site, and pass through the
    // (empty) automatic-attack window.
    const afterSelect = dispatch(inSitePhase, { type: 'select-company', player: PLAYER_1, companyId: movedCompany.id });
    const afterEnter = dispatch(afterSelect, { type: 'enter-site', player: PLAYER_1, companyId: movedCompany.id });
    const afterAgentPass = dispatch(afterEnter, { type: 'pass', player: PLAYER_2 });
    const atPlayResources = dispatch(afterAgentPass, { type: 'pass', player: PLAYER_1 });
    expect((atPlayResources.phaseState as SitePhaseState).step).toBe('play-resources');

    const cardInstance = findHandCardId(atPlayResources, RESOURCE_PLAYER, ARMY_OF_THE_DEAD);
    const influenceActions = computeLegalActions(atPlayResources, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'influence-attempt')
      .map(a => a.action as InfluenceAttemptAction)
      .filter(a => a.factionInstanceId === cardInstance);

    expect(influenceActions.length).toBeGreaterThanOrEqual(1);
  });

  test('may not be influenced by an opponent once in play', () => {
    // PLAYER_1's company (with an untapped character) is at Vale of Erech —
    // the site where Army of the Dead is playable, so re-influence would
    // normally be offered there. PLAYER_2 owns the in-play faction.
    const base = buildSitePhaseState({
      characters: [ARAGORN],
      site: VALE_OF_ERECH,
    });
    // opponentInfluenceActions guards on turnNumber > 2 ("not first turn").
    const state = { ...addCardInPlay(base, HAZARD_PLAYER, ARMY_OF_THE_DEAD), turnNumber: 3 };

    const factionInPlay = state.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === ARMY_OF_THE_DEAD)!;

    const opponentInfluenceActions = computeLegalActions(state, PLAYER_1)
      .filter(a => a.viable && a.action.type === 'opponent-influence-attempt')
      .map(a => a.action as { targetKind?: string; targetInstanceId?: string })
      .filter(a => a.targetKind === 'faction' && a.targetInstanceId === factionInPlay.instanceId);

    expect(opponentInfluenceActions).toHaveLength(0);
  });
});
