/**
 * @module dm-95.test
 *
 * Card test: Troll-purse (dm-95)
 * Type: hazard-event (permanent)
 *
 * Card text:
 *   "Playable on a site with an Orc or Troll automatic-attack. When any item is
 *    played at this site, the company must face all automatic-attacks of the
 *    site again with the attack's prowess modified by +3. Any successful strike
 *    does not harm the character, but rather the character is taken prisoner at
 *    the site. The rescue-attack equals all automatic-attacks of the site at the
 *    time of rescue."
 *
 * Effects:
 *   1. play-target { target: "site" } — attaches to the targeted site
 *   2. site-item-trap { prowessBonus: 3 }
 *
 * | # | Rule                                                  | Status | Notes                                          |
 * |---|-------------------------------------------------------|--------|------------------------------------------------|
 * | 1 | Playable on a site with an Orc/Troll automatic-attack | OK     | legal-actions/movement-hazard.ts site filter   |
 * | 2 | Item played at site → re-face all auto-attacks +3     | OK     | maybeTriggerSiteItemTrap → troll-purse-attacks |
 * | 3 | Successful strike → prisoner at the site (no wound)   | OK     | resolveStrike trollPursePrisoner → applyTakePrisonerAtSite |
 * | 4 | Rescue-attack = site's automatic-attacks at rescue   | OK     | HazardHost.rescueSiteCard = the bound site     |
 *
 * Test site: The Under-grottos (dm-39), a hero ruins-and-lairs site with an
 * Orcs (4 strikes / 7 prowess) automatic-attack. A hero company there faces a
 * wounding (non-detainment) Orc attack, so a re-faced strike can take prisoner.
 *
 * Playable: YES
 * CERTIFIED
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI, DAGGER_OF_WESTERNESSE,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  buildTestState, buildSitePhaseState, resetMint, dispatch, viableActions,
  makeMHState, findCharInstanceId, companyIdAt,
  Phase,
} from '../test-helpers.js';
import { CardStatus, Race } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import type {
  CardInPlay, CardInstanceId, CardDefinitionId, CombatState, ConstraintId,
  PlayHazardAction, PlayHeroResourceAction, RescuePrisonerAction, SitePhaseState, HazardHost, ActiveConstraint,
} from '../../index.js';

const TROLL_PURSE = 'dm-95' as CardDefinitionId;
const THE_UNDER_GROTTOS = 'dm-39' as CardDefinitionId; // Orcs 4 strikes / 7 prowess

/** A Troll-purse in play bound to the given site definition (opponent's card). */
const trollPurseOnSite = (siteDefId: CardDefinitionId): CardInPlay => ({
  instanceId: 'troll-purse-1' as CardInstanceId,
  definitionId: TROLL_PURSE,
  status: CardStatus.Untapped,
  attachedToSite: siteDefId,
});

const trollPursePlayActions = (state: ReturnType<typeof buildTestState>) =>
  viableActions(state, PLAYER_2, 'play-hazard').filter(ea =>
    resolveInstanceId(state, (ea.action as PlayHazardAction).cardInstanceId) === TROLL_PURSE);

describe('Troll-purse (dm-95)', () => {
  beforeEach(() => resetMint());

  // ---- Rule 1: playable on a site with an Orc/Troll automatic-attack ----

  test('playable on a destination site that has an Orc automatic-attack', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: THE_UNDER_GROTTOS }], hand: [], siteDeck: [THE_UNDER_GROTTOS] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TROLL_PURSE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
    const actions = trollPursePlayActions(ready);
    expect(actions.length).toBeGreaterThan(0);
    expect((actions[0].action as PlayHazardAction).targetSiteDefinitionId).toBe(THE_UNDER_GROTTOS);
  });

  test('not playable on a destination site with no Orc/Troll automatic-attack', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        // Rivendell is a haven — no automatic-attacks at all.
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN], destinationSite: RIVENDELL }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [TROLL_PURSE], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const ready = { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
    expect(trollPursePlayActions(ready)).toHaveLength(0);
  });

  // ---- Rule 2: item played at the site re-faces the auto-attacks (+3 prowess) ----

  test('playing an item at the site re-faces the auto-attack at +3 prowess, prisoner-flagged', () => {
    const base = buildSitePhaseState({ site: THE_UNDER_GROTTOS, hand: [DAGGER_OF_WESTERNESSE] });
    const siteInstanceId = base.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const host = trollPurseOnSite(THE_UNDER_GROTTOS);
    const state = {
      ...base,
      players: base.players.map((p, i) => (i === HAZARD_PLAYER ? { ...p, cardsInPlay: [host] } : p)) as unknown as typeof base.players,
    };

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    expect(playActions.length).toBeGreaterThan(0);
    const after = dispatch(state, playActions[0].action as PlayHeroResourceAction);

    // A re-face combat was initiated for the site's Orc auto-attack at +3.
    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('orc');
    expect(after.combat!.strikeProwess).toBe(10); // 7 printed + 3
    expect(after.combat!.attackSource.type).toBe('automatic-attack');
    expect(after.combat!.trollPursePrisoner).toEqual({ hostInstanceId: host.instanceId, siteInstanceId });

    const siteState = after.phaseState as SitePhaseState;
    expect(siteState.step).toBe('troll-purse-attacks');
    expect(siteState.trollPurseReface).toEqual({ hostInstanceId: host.instanceId, prowessBonus: 3, resolved: 1 });
  });

  test('playing an item at the site with no Troll-purse does NOT re-face (normal play)', () => {
    const state = buildSitePhaseState({ site: THE_UNDER_GROTTOS, hand: [DAGGER_OF_WESTERNESSE] });
    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource');
    const after = dispatch(state, playActions[0].action as PlayHeroResourceAction);
    expect(after.combat).toBeNull();
    expect((after.phaseState as SitePhaseState).step).toBe('play-resources');
  });

  // ---- Rule 2: after all re-faced attacks, control returns to play-resources ----

  test('after re-facing all auto-attacks, the step returns to play-resources', () => {
    const base = buildSitePhaseState({ site: THE_UNDER_GROTTOS });
    // dm-39 has a single printed auto-attack; simulate it already re-faced.
    const ready: typeof base = {
      ...base,
      combat: null,
      phaseState: {
        ...base.phaseState,
        step: 'troll-purse-attacks',
        trollPurseReface: { hostInstanceId: 'troll-purse-1' as CardInstanceId, prowessBonus: 3, resolved: 1 },
      } as SitePhaseState,
    };
    const after = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    const siteState = after.phaseState as SitePhaseState;
    expect(siteState.step).toBe('play-resources');
    expect(siteState.trollPurseReface).toBeUndefined();
  });

  // ---- Rule 3 & 4: a successful re-faced strike takes the character prisoner at the site ----

  test('a successful re-faced strike takes the character prisoner at the site (no wound)', () => {
    const base = buildSitePhaseState({ site: THE_UNDER_GROTTOS });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);
    const siteInstanceId = base.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const host = trollPurseOnSite(THE_UNDER_GROTTOS);

    const combat: CombatState = {
      attackSource: { type: 'automatic-attack', siteInstanceId, attackIndex: 0 },
      companyId,
      defendingPlayerId: PLAYER_1,
      attackingPlayerId: PLAYER_2,
      strikesTotal: 1,
      strikeProwess: 99, // creature guaranteed to win
      creatureBody: null,
      creatureRace: Race.Orc,
      strikeAssignments: [{ characterId: aragornId, excessStrikes: 0, resolved: false }],
      currentStrikeIndex: 0,
      phase: 'resolve-strike',
      assignmentPhase: 'done',
      bodyCheckTarget: null,
      detainment: false,
      trollPursePrisoner: { hostInstanceId: host.instanceId, siteInstanceId },
    };
    const state = {
      ...base,
      combat,
      cheatRollTotal: 2,
      players: base.players.map((p, i) => (i === HAZARD_PLAYER ? { ...p, cardsInPlay: [host] } : p)) as unknown as typeof base.players,
    };

    const resolveActions = viableActions(state, PLAYER_1, 'resolve-strike');
    const tapAction = resolveActions.find(a => (a.action as { tapToFight?: boolean }).tapToFight === true) ?? resolveActions[0];
    const result = dispatch(state, tapAction.action);

    // Not wounded — taken prisoner instead.
    expect(result.players[RESOURCE_PLAYER].characters[aragornId].status).not.toBe(CardStatus.Inverted);
    // Prisoner record created at the bound site.
    expect(result.hazardHosts).toHaveLength(1);
    expect(result.hazardHosts[0].prisoners).toContain(aragornId);
    expect(result.hazardHosts[0].rescueSiteCard.definitionId).toBe(THE_UNDER_GROTTOS);
    // character-is-prisoner constraint added, pointing at the Troll-purse.
    const prisonerConstraint = result.activeConstraints.find(
      c => c.target.kind === 'character' && c.target.characterId === aragornId && c.kind.type === 'character-is-prisoner',
    );
    expect(prisonerConstraint).toBeDefined();
    // The Troll-purse host stays in play (it is a persistent trap).
    expect(result.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === TROLL_PURSE)).toBe(true);
  });

  // ---- Persistence: a Troll-purse holding a prisoner is not orphan-discarded ----

  test('a Troll-purse holding a prisoner is not discarded when no company occupies the site', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        // Neither company is at The Under-grottos.
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const host = trollPurseOnSite(THE_UNDER_GROTTOS);
    const hazardHost: HazardHost = {
      hostCard: { instanceId: host.instanceId, definitionId: TROLL_PURSE },
      rescueSiteCard: { instanceId: 'site-x' as CardInstanceId, definitionId: THE_UNDER_GROTTOS },
      prisoners: [aragornId],
      ownedBy: PLAYER_2,
    };
    const withHost = {
      ...base,
      hazardHosts: [hazardHost],
      players: base.players.map((p, i) => (i === HAZARD_PLAYER ? { ...p, cardsInPlay: [host] } : p)) as unknown as typeof base.players,
    };

    const swept = discardOrphanedSiteAttachedEvents(withHost);
    // Still in play — exempt because it holds a prisoner.
    expect(swept.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === host.instanceId)).toBe(true);

    // Control: without prisoners, the same orphaned site-attached card IS discarded.
    const withoutPrisoners = { ...withHost, hazardHosts: [{ ...hazardHost, prisoners: [] }] };
    const sweptEmpty = discardOrphanedSiteAttachedEvents(withoutPrisoners);
    expect(sweptEmpty.players[HAZARD_PLAYER].cardsInPlay.some(c => c.instanceId === host.instanceId)).toBe(false);
  });

  // ---- Rule 4: prisoner rescue (rescue-attack = the site's automatic-attacks) ----

  /**
   * A site-phase state at The Under-grottos with a 2-character company where
   * Aragorn is held prisoner by a Troll-purse on the site and Gimli is free to
   * rescue. Returns the state plus the relevant ids.
   */
  const prisonerHeldState = () => {
    const base = buildSitePhaseState({ site: THE_UNDER_GROTTOS, characters: [ARAGORN, GIMLI] });
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const gimliId = findCharInstanceId(base, RESOURCE_PLAYER, GIMLI);
    const siteInstanceId = base.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId;
    const host = trollPurseOnSite(THE_UNDER_GROTTOS);
    const prisonerConstraint: ActiveConstraint = {
      id: 'c-prisoner-1' as ConstraintId,
      source: host.instanceId,
      sourceDefinitionId: TROLL_PURSE,
      scope: { kind: 'until-cleared' },
      target: { kind: 'character', characterId: aragornId },
      kind: { type: 'character-is-prisoner', hostInstanceId: host.instanceId },
    };
    const hazardHost: HazardHost = {
      hostCard: { instanceId: host.instanceId, definitionId: TROLL_PURSE },
      rescueSiteCard: { instanceId: siteInstanceId, definitionId: THE_UNDER_GROTTOS },
      prisoners: [aragornId],
      ownedBy: PLAYER_2,
    };
    const state = {
      ...base,
      activeConstraints: [...base.activeConstraints, prisonerConstraint],
      hazardHosts: [hazardHost],
      players: base.players.map((p, i) => (i === HAZARD_PLAYER ? { ...p, cardsInPlay: [host] } : p)) as unknown as typeof base.players,
    };
    return { state, aragornId, gimliId, host };
  };

  test('a company at the site holding its prisoner is offered a rescue-prisoner action', () => {
    const { state, host } = prisonerHeldState();
    const actions = viableActions(state, PLAYER_1, 'rescue-prisoner');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as RescuePrisonerAction).hostInstanceId).toBe(host.instanceId);
  });

  test('declaring a rescue faces the site auto-attack with the prisoner protected from strikes', () => {
    const { state, aragornId, host } = prisonerHeldState();
    const after = dispatch(state, { type: 'rescue-prisoner', player: PLAYER_1, hostInstanceId: host.instanceId });

    expect(after.combat).not.toBeNull();
    expect(after.combat!.creatureRace).toBe('orc');
    expect(after.combat!.strikeProwess).toBe(7); // rescue-attack = the site's auto-attack, no +3
    expect(after.combat!.trollPursePrisoner).toBeUndefined(); // normal wound semantics
    expect(after.combat!.protectedFromStrikeAssignment).toContain(aragornId);

    const siteState = after.phaseState as SitePhaseState;
    expect(siteState.step).toBe('rescue-attacks');
    expect(siteState.rescueInProgress).toEqual({ hostInstanceId: host.instanceId, resolved: 1 });
  });

  test('once the rescue-attack is faced, a company-mate taps and the prisoner is freed and the host removed', () => {
    const { state, aragornId, gimliId, host } = prisonerHeldState();
    // dm-39 has a single printed auto-attack; simulate it already faced.
    const ready = {
      ...state,
      combat: null,
      phaseState: {
        ...state.phaseState,
        step: 'rescue-attacks',
        rescueInProgress: { hostInstanceId: host.instanceId, resolved: 1 },
      } as SitePhaseState,
    };
    // Facing the attacks leads to the rule 8.36 tap that actually frees them.
    const faced = dispatch(ready, { type: 'pass', player: PLAYER_1 });
    expect((faced.phaseState as SitePhaseState).step).toBe('rescue-tap');
    const after = dispatch(faced, {
      type: 'rescue-prisoner', player: PLAYER_1, hostInstanceId: host.instanceId, characterInstanceId: gimliId,
    });

    // Prisoner constraint lifted.
    const stillPrisoner = after.activeConstraints.some(
      c => c.target.kind === 'character' && c.target.characterId === aragornId && c.kind.type === 'character-is-prisoner',
    );
    expect(stillPrisoner).toBe(false);
    // Host record dropped (no remaining prisoners).
    expect(after.hazardHosts).toHaveLength(0);
    expect((after.phaseState as SitePhaseState).step).toBe('play-resources');
    expect((after.phaseState as SitePhaseState).rescueInProgress).toBeUndefined();
  });
});
