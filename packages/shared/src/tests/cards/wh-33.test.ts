/**
 * @module wh-33.test
 *
 * Card test: Noble Steed (wh-33)
 * Type: hero-resource-ally
 * Stats: prowess 0, body 8, mind 1, MP 1 (ally). Not unique. Alignment: wizard.
 *
 * Card text:
 *   "Playable at any tapped or untapped non-Haven site in Rohan, Southern
 *    Rhovanion, Khand, Dorwinion, Horse Plains, or Harondor. If each character
 *    in a company controls a Noble Steed (or Bill the Pony or Shadowfax), the
 *    company may move up to two additional regions. Tap to cancel a strike (not
 *    from an automatic-attack) against its bearer or itself."
 *
 * Engine Support:
 * | # | Feature                                               | Status      | Notes                                              |
 * |---|-------------------------------------------------------|-------------|----------------------------------------------------|
 * | 1 | Playable at non-haven sites in 6 named regions        | IMPLEMENTED | playableAt with PlayableAtRegion entries           |
 * | 2 | Playable at already-tapped sites                      | IMPLEMENTED | play-flag: playable-at-tapped-site                 |
 * | 3 | +2 movement when ALL characters control a steed       | IMPLEMENTED | passive-movement-bonus effect, collectPassiveMovementBonus |
 * | 4 | Tap to cancel a strike (not from auto-attack)         | IMPLEMENTED | cancel-strike on ally, extended combat.ts + reducer |
 * | 5 | Tap to cancel a strike against itself (ally target)   | IMPLEMENTED | ally-as-target scan added to resolveStrikeActions    |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  attachAllyToChar,
  viableActions,
  findCharInstanceId,
  makeSitePhase,
  makeMHState,
  makeCancelWindowCombat,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, MOUNT_DOOM, EDORAS,
  CardStatus,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  dispatch,
  actionAs,
} from '../test-helpers.js';
import { computeLegalActions } from '../../index.js';
import type { CardDefinitionId, CardInstanceId, CancelStrikeAction, MovementHazardPhaseState } from '../../index.js';

const NOBLE_STEED = 'wh-33' as CardDefinitionId;
// Iron Hill Dwarf-hold (tw-403): Iron Hills region, nearest haven Lórien
// From Edoras (Rohan) to Iron Hills: region distance = 6 (edges=5, regDist=6)
// Not reachable without steed (max=4), reachable with steed for all (max=6)
const IRON_HILL_DWARF_HOLD = 'tw-403' as CardDefinitionId;

describe('Noble Steed (wh-33)', () => {
  beforeEach(() => resetMint());

  // ─── Rule 1: playable at non-haven sites in 6 named regions ─────────────────

  test('Noble Steed IS playable at Edoras (Rohan)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [ARAGORN] }], hand: [NOBLE_STEED], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const steedInstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === steedInstId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Noble Steed IS playable at a tapped site in Rohan', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: EDORAS, characters: [ARAGORN] }], hand: [NOBLE_STEED], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    // Tap the current site
    const withTappedSite = {
      ...base,
      players: [
        {
          ...base.players[RESOURCE_PLAYER],
          companies: base.players[RESOURCE_PLAYER].companies.map((c, i) =>
            i === 0 && c.currentSite
              ? { ...c, currentSite: { ...c.currentSite, status: CardStatus.Tapped } }
              : c
          ),
        },
        base.players[HAZARD_PLAYER],
      ] as typeof base.players,
    };
    const state = { ...withTappedSite, phaseState: makeSitePhase() };
    const steedInstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === steedInstId);
    expect(playActions.length).toBeGreaterThanOrEqual(1);
  });

  test('Noble Steed is NOT playable at Rivendell (haven)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [NOBLE_STEED], siteDeck: [EDORAS] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const steedInstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === steedInstId);
    expect(playActions).toHaveLength(0);
  });

  test('Noble Steed is NOT playable at Moria (not in the 6 named regions)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [NOBLE_STEED], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const steedInstId = state.players[RESOURCE_PLAYER].hand[0].instanceId;

    const playActions = viableActions(state, PLAYER_1, 'play-hero-resource')
      .filter(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId === steedInstId);
    expect(playActions).toHaveLength(0);
  });

  // ─── Rule 3: +2 region movement when all characters control a qualifying steed ─

  test('+2 movement bonus when ALL characters have Noble Steed — distant site becomes reachable', () => {
    // Edoras (Rohan) to Iron Hills: regDist=6, exceeds base max=4, but within steed max=6
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: EDORAS, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [IRON_HILL_DWARF_HOLD, MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withAragornSteed = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_STEED);
    const withBothSteeds = attachAllyToChar(withAragornSteed, RESOURCE_PLAYER, LEGOLAS, NOBLE_STEED);

    const moveActions = viableActions(withBothSteeds, PLAYER_1, 'plan-movement');
    const destDefIds = moveActions.map(ea => {
      const destInstId = (ea.action as { destinationSite?: CardInstanceId }).destinationSite;
      const destCard = withBothSteeds.players[RESOURCE_PLAYER].siteDeck.find(
        c => c.instanceId === destInstId,
      );
      return destCard?.definitionId;
    });

    expect(destDefIds).toContain(IRON_HILL_DWARF_HOLD);
  });

  test('no movement bonus when only SOME characters have Noble Steed', () => {
    // Only Aragorn has a steed — Legolas does not → bonus does not apply
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: EDORAS, characters: [ARAGORN, LEGOLAS] }],
          hand: [],
          siteDeck: [IRON_HILL_DWARF_HOLD, MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withAragornSteed = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_STEED);

    const moveActions = viableActions(withAragornSteed, PLAYER_1, 'plan-movement');
    const destDefIds = moveActions.map(ea => {
      const destInstId = (ea.action as { destinationSite?: CardInstanceId }).destinationSite;
      const destCard = withAragornSteed.players[RESOURCE_PLAYER].siteDeck.find(
        c => c.instanceId === destInstId,
      );
      return destCard?.definitionId;
    });

    expect(destDefIds).not.toContain(IRON_HILL_DWARF_HOLD);
  });

  test('no movement bonus when no character has Noble Steed', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: EDORAS, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [IRON_HILL_DWARF_HOLD, MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });

    const moveActions = viableActions(state, PLAYER_1, 'plan-movement');
    const destDefIds = moveActions.map(ea => {
      const destInstId = (ea.action as { destinationSite?: CardInstanceId }).destinationSite;
      const destCard = state.players[RESOURCE_PLAYER].siteDeck.find(
        c => c.instanceId === destInstId,
      );
      return destCard?.definitionId;
    });

    expect(destDefIds).not.toContain(IRON_HILL_DWARF_HOLD);
  });

  test('movement-hazard phase honors the bonus too: declare-path reaches a destination beyond the base max region distance', () => {
    // Regression: organization-phase plan-movement offered Iron Hill Dwarf-hold
    // as reachable (regDist=6, within the steed-boosted max), but the M/H
    // phase's select-company step computed maxRegionDistance from base +
    // extraRegionDistance only — never adding the passive-movement-bonus. That
    // left the company's declared destination unreachable at reveal-new-site,
    // so rule 5.04 silently negated the move and reverted the company to its
    // origin site (bug report: "the game lets me choose the site but brings me
    // back to the original site").
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: EDORAS, characters: [ARAGORN, LEGOLAS], destinationSite: IRON_HILL_DWARF_HOLD }],
          hand: [],
          siteDeck: [],
        },
        { id: PLAYER_2, companies: [{ site: RIVENDELL, characters: [] }], hand: [], siteDeck: [] },
      ],
    });
    const withAragornSteed = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_STEED);
    const withBothSteeds = attachAllyToChar(withAragornSteed, RESOURCE_PLAYER, LEGOLAS, NOBLE_STEED);
    const companyId = withBothSteeds.players[RESOURCE_PLAYER].companies[0].id;
    const ready = { ...withBothSteeds, phaseState: makeMHState({ step: 'select-company' }) };

    const afterSelect = dispatch(ready, { type: 'select-company', player: PLAYER_1, companyId });
    const phaseState = afterSelect.phaseState as MovementHazardPhaseState;

    // Base 4 + steed bonus 2 = 6.
    expect(phaseState.maxRegionDistance).toBe(6);

    const declarePathActions = viableActions(afterSelect, PLAYER_1, 'declare-path');
    expect(declarePathActions.length).toBeGreaterThanOrEqual(1);

    const afterDeclare = dispatch(afterSelect, declarePathActions[0].action);
    const company = afterDeclare.players[RESOURCE_PLAYER].companies[0];
    expect(company.destinationSite?.definitionId).toBe(IRON_HILL_DWARF_HOLD);
  });

  // ─── Rule 4: tap to cancel a strike (not from an automatic-attack) ───────────

  test('Noble Steed can tap to cancel a creature strike against its bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withSteed = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_STEED);
    // Use a direct creature-source combat (not automatic-attack)
    const withCombat = makeCancelWindowCombat(withSteed, {
      attackSourceType: 'creature',
      strikesTotal: 1,
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const steedInstId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(steedInstId).toBeDefined();

    // Assign the single strike to Aragorn — with 1 strike and 1 character the engine
    // auto-selects strike order and advances directly to resolve-strike
    const r2 = dispatch(withCombat, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, tapped: false });
    expect(r2.combat!.phase).toBe('resolve-strike');

    // Noble Steed should offer cancel-strike for Aragorn's strike (creature attack)
    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelActions = defActions.filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancelActions.length).toBeGreaterThanOrEqual(1);

    const cancelAction = cancelActions.find(
      a => actionAs<CancelStrikeAction>(a.action).cancellerInstanceId === steedInstId,
    );
    expect(cancelAction).toBeDefined();
    expect(actionAs<CancelStrikeAction>(cancelAction!.action).targetCharacterId).toBe(aragornId);

    // Execute cancel-strike — with a single strike the cancel ends combat entirely
    const r3 = dispatch(r2, cancelAction!.action);

    // Noble Steed should now be tapped
    expect(r3.players[RESOURCE_PLAYER].characters[aragornId].allies[0].status).toBe(CardStatus.Tapped);
    // Combat is over (single strike was canceled)
    expect(r3.combat).toBeNull();
  });

  test('Noble Steed can tap to cancel a creature strike against itself (ally as strike target)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withSteed = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_STEED);
    const withCombat = makeCancelWindowCombat(withSteed, {
      attackSourceType: 'creature',
      strikesTotal: 1,
    });

    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const steedInstId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    expect(steedInstId).toBeDefined();

    // Defending player assigns the single strike directly to Noble Steed (ally as target)
    const r2 = dispatch(withCombat, { type: 'assign-strike', player: PLAYER_1, characterId: steedInstId, tapped: false });
    expect(r2.combat!.phase).toBe('resolve-strike');

    // Noble Steed should offer cancel-strike for itself (strike against itself)
    const defActions = computeLegalActions(r2, PLAYER_1);
    const cancelActions = defActions.filter(a => a.viable && a.action.type === 'cancel-strike');
    expect(cancelActions.length).toBeGreaterThanOrEqual(1);

    const cancelAction = cancelActions.find(
      a => actionAs<CancelStrikeAction>(a.action).cancellerInstanceId === steedInstId,
    );
    expect(cancelAction).toBeDefined();
    expect(actionAs<CancelStrikeAction>(cancelAction!.action).targetCharacterId).toBe(steedInstId);

    // Execute cancel-strike — combat ends (single strike canceled)
    const r3 = dispatch(r2, cancelAction!.action);
    expect(r3.combat).toBeNull();
  });

  test('Noble Steed cannot cancel a strike from an automatic-attack', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MOUNT_DOOM] },
      ],
    });
    const withSteed = attachAllyToChar(base, RESOURCE_PLAYER, ARAGORN, NOBLE_STEED);
    const withCombat = makeCancelWindowCombat(withSteed, {
      attackSourceType: 'automatic-attack',
      strikesTotal: 1,
    });

    // Assign the single strike to Aragorn — auto-advances to resolve-strike
    const aragornId = findCharInstanceId(withCombat, RESOURCE_PLAYER, ARAGORN);
    const steedInstId = withCombat.players[RESOURCE_PLAYER].characters[aragornId]?.allies[0]?.instanceId;
    const r2 = dispatch(withCombat, { type: 'assign-strike', player: PLAYER_1, characterId: aragornId, tapped: false });
    expect(r2.combat!.phase).toBe('resolve-strike');

    // Noble Steed should NOT offer cancel-strike for an automatic-attack
    const defActions = computeLegalActions(r2, PLAYER_1);
    const steedCancelActions = defActions.filter(
      a => a.viable && a.action.type === 'cancel-strike'
        && actionAs<CancelStrikeAction>(a.action).cancellerInstanceId === steedInstId,
    );
    expect(steedCancelActions.length).toBe(0);
  });
});
