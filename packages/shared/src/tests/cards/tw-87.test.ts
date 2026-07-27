/**
 * @module tw-87.test
 *
 * Card test: Siege (tw-87)
 * Type: hazard-event (permanent), non-unique, Neutral
 *
 * Card text:
 *   "Playable on a Border-hold [{B}] or Free-hold [{F}] site. A company at this
 *    site must face an Orc attack of three strikes at 7 prowess at the beginning
 *    of its site phase. At the end of its organization phase, a company at a
 *    site with Siege on it must make a roll and subtract one from the result for
 *    every non-scout character it contains. If this result is less than 5, the
 *    company may not move this turn. Discard when the site card is discarded or
 *    when the site card is returned to the location deck. Cannot be duplicated
 *    on a given site."
 *
 * The French printing adds the clarification the English leaves implicit: "La
 * compagnie doit affronter l'attaque du Siège avant de choisir si elle explore
 * le site" — the company faces the siege attack *before* it decides whether to
 * enter the site, so doing nothing there does not avoid it.
 *
 * Effects (data):
 *   - play-target site, filter `siteType $in [border-hold, free-hold]` — the
 *     M/H site-targeting hazard path binds the card to the target company's
 *     destination site (`CardInPlay.attachedToSite`).
 *   - duplication-limit scope:site max:1 ("Cannot be duplicated on a given site")
 *   - site-phase-start-attack (Orcs, 3 strikes, 7 prowess) — sequenced through
 *     the new `siege-attacks` site sub-step, inserted between `select-company`
 *     and `enter-or-skip`, with a `siege-attack` attack source. Not an
 *     automatic-attack: no auto-attack modifier, duplicate constraint or
 *     home-site tap-to-cancel applies, and it is never detainment.
 *   - company-movement-roll (threshold 5, penalty 1 per non-scout) — at the end
 *     of the controller's organization phase each company at the besieged site
 *     enqueues a generic `dice-check`; on failure the `lock-company-movement`
 *     verb cancels the declared destination (returning the site card to the
 *     location deck) and installs a turn-scoped `company-cannot-move`.
 *
 * "Discard when the site card is discarded or returned to the location deck" is
 * the shared site-attached orphan sweep (`discardOrphanedSiteAttachedEvents`),
 * which now also treats a company's *declared destination* as occupied so a
 * hazard played on a site the company is still moving to survives until it
 * arrives (or is turned back).
 *
 * Engine support:
 * | # | Rule                                                          | Status |
 * |---|---------------------------------------------------------------|--------|
 * | 1 | Playable on a Border-hold                                      | OK     |
 * | 2 | Playable on a Free-hold                                        | OK     |
 * | 3 | NOT playable on another site type                              | OK     |
 * | 4 | Bound to the target site when it resolves                      | OK     |
 * | 5 | Orcs 3/7 attack faced at the beginning of the site phase        | OK     |
 * | 6 | ... before the enter-or-skip decision (skipping cannot avoid it)| OK     |
 * | 7 | The attack wounds (not detainment) and is not an auto-attack    | OK     |
 * | 8 | End-of-organization roll enqueued for a besieged company        | OK     |
 * | 9 | Roll modified by -1 per non-scout character                     | OK     |
 * |10 | Result < 5 → company may not move this turn                     | OK     |
 * |11 | Result >= 5 → the declared movement stands                      | OK     |
 * |12 | Discarded when the bound site leaves play                       | OK     |
 * |13 | Cannot be duplicated on a given site                            | OK     |
 *
 * Player-index convention: the besieged hero company is P1 / RESOURCE_PLAYER;
 * the Neutral hazard permanent-event belongs to P2 / HAZARD_PLAYER.
 *
 * Playable: YES. Certified: 2026-07-27.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, buildSitePhaseState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  ARAGORN, LEGOLAS, GIMLI,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH, BREE, EDORAS,
  makeMHState, viableActions, viableFor, dispatch, resolveChain, continueAutoAttackCombat,
  phaseStateAs,
} from '../test-helpers.js';
import { resolveInstanceId } from '../../types/state.js';
import { discardOrphanedSiteAttachedEvents } from '../../engine/reducer-utils.js';
import type {
  CardDefinitionId, CardInPlay, CardInstanceId, CompanyId, GameState,
  PlayHazardAction, SitePhaseState,
} from '../../index.js';

const SIEGE = 'tw-87' as CardDefinitionId;

/** A Siege already in play (the hazard player's) besieging `siteDefId`. */
const siegeOnSite = (siteDefId: CardDefinitionId, instanceId = 'siege-1'): CardInPlay => ({
  instanceId: instanceId as CardInstanceId,
  definitionId: SIEGE,
  status: CardStatus.Untapped,
  attachedToSite: siteDefId,
});

/** An M/H state with P1 moving from Rivendell to `destination`, Siege in P2's hand. */
const movingTo = (destination: CardDefinitionId, hazardHand: CardDefinitionId[] = [SIEGE]): GameState => {
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: destination }], hand: [], siteDeck: [destination] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: hazardHand, siteDeck: [MINAS_TIRITH] },
    ],
  });
  return { ...state, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };
};

/** Every Siege play-hazard action (viable or not) offered to the hazard player. */
const siegePlays = (state: GameState) =>
  viableFor(state, PLAYER_2).filter(ea =>
    ea.action.type === 'play-hazard'
    && resolveInstanceId(state, (ea.action).cardInstanceId) === SIEGE);

/** A site-phase state at `site` with `chars`, besieged by the hazard player's Siege. */
const besiegedSitePhase = (site: CardDefinitionId, chars: CardDefinitionId[] = [ARAGORN]): GameState => {
  const base = buildSitePhaseState({ site, characters: chars });
  const withSiege = {
    ...base,
    players: base.players.map((p, i) =>
      (i === HAZARD_PLAYER ? { ...p, cardsInPlay: [siegeOnSite(site)] } : p)) as unknown as typeof base.players,
  };
  // Rewind the site phase to its first step so the company's site phase begins
  // properly (buildSitePhaseState drops the caller straight into play-resources).
  return {
    ...withSiege,
    phaseState: {
      ...(withSiege.phaseState),
      step: 'select-company' as const,
      siteEntered: false,
    },
  };
};

/**
 * An organization-phase state: P1's company sits at `site` with `chars` and has
 * declared movement to Moria; the hazard player's Siege besieges `site` when
 * `besieged` is set.
 */
const orgPhaseAt = (opts: {
  site: CardDefinitionId;
  chars?: CardDefinitionId[];
  besieged?: boolean;
}): GameState => {
  const chars = opts.chars ?? [ARAGORN];
  const state = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.Organization,
    players: [
      { id: PLAYER_1, companies: [{ site: opts.site, characters: chars, destinationSite: MORIA }], hand: [], siteDeck: [MORIA] },
      { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
    ],
  });
  if (opts.besieged === false) return state;
  return {
    ...state,
    players: state.players.map((p, i) =>
      (i === HAZARD_PLAYER ? { ...p, cardsInPlay: [siegeOnSite(opts.site)] } : p)) as unknown as typeof state.players,
  };
};

/** Pass the organization phase as the active player, ending it. */
const endOrgPhase = (state: GameState): GameState =>
  dispatch(state, { type: 'pass', player: PLAYER_1 });

describe('Siege (tw-87)', () => {
  beforeEach(() => resetMint());

  // ---- Rules 1–3: "Playable on a Border-hold or Free-hold site" -------------

  test('playable on a Border-hold destination, bound to that site', () => {
    const plays = siegePlays(movingTo(BREE));
    expect(plays).toHaveLength(1);
    expect((plays[0].action as PlayHazardAction).targetSiteDefinitionId).toBe(BREE);
  });

  test('playable on a Free-hold destination, bound to that site', () => {
    const plays = siegePlays(movingTo(EDORAS));
    expect(plays).toHaveLength(1);
    expect((plays[0].action as PlayHazardAction).targetSiteDefinitionId).toBe(EDORAS);
  });

  test('not playable on a site that is neither a Border-hold nor a Free-hold', () => {
    // Moria is a ruins-and-lairs; Rivendell is a haven.
    expect(siegePlays(movingTo(MORIA))).toHaveLength(0);
    expect(siegePlays(movingTo(RIVENDELL))).toHaveLength(0);
  });

  // ---- Rule 4: the resolved card besieges the target site -------------------

  test('resolving the play binds the card to the target site and keeps it in play', () => {
    const state = movingTo(BREE);
    const play = siegePlays(state)[0].action as PlayHazardAction;
    const after = resolveChain(dispatch(state, play));

    const inPlay = after.players[HAZARD_PLAYER].cardsInPlay
      .find(c => c.definitionId === SIEGE);
    expect(inPlay).toBeDefined();
    expect(inPlay!.attachedToSite).toBe(BREE);
    // Not swept as an orphan even though the company has not arrived yet — the
    // declared destination counts as occupied for site attachments.
    expect(discardOrphanedSiteAttachedEvents(after)
      .players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SIEGE)).toBe(true);
  });

  // ---- Rules 5–7: the site-phase-start Orc attack ---------------------------

  test('selecting the besieged company initiates an Orcs 3/7 attack before enter-or-skip', () => {
    const state = besiegedSitePhase(BREE);
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const after = dispatch(state, { type: 'select-company', player: PLAYER_1, companyId });

    expect(phaseStateAs<SitePhaseState>(after).step).toBe('siege-attacks');
    expect(after.combat).not.toBeNull();
    expect(after.combat!.attackSource.type).toBe('siege-attack');
    expect(after.combat!.creatureRace).toBe('orc');
    expect(after.combat!.strikesTotal).toBe(3);
    expect(after.combat!.strikeProwess).toBe(7);
    expect(after.combat!.companyId).toBe(companyId);
    // A wounding attack, not detainment — Bree is a Border-hold and the
    // defending company is hero, but the siege attack is not a site
    // automatic-attack keyed to the site type.
    expect(after.combat!.detainment).toBe(false);
  });

  test('without a Siege the same company goes straight to enter-or-skip with no combat', () => {
    const base = buildSitePhaseState({ site: BREE });
    const state: GameState = {
      ...base,
      phaseState: { ...(base.phaseState), step: 'select-company' as const, siteEntered: false },
    };
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const after = dispatch(state, { type: 'select-company', player: PLAYER_1, companyId });

    expect(phaseStateAs<SitePhaseState>(after).step).toBe('enter-or-skip');
    expect(after.combat).toBeNull();
  });

  test('after the siege attack the company reaches enter-or-skip and may still do nothing', () => {
    const state = besiegedSitePhase(BREE);
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const selected = dispatch(state, { type: 'select-company', player: PLAYER_1, companyId });

    // Drop the resolved combat (the outcome is irrelevant here) and pass the
    // siege step, exactly as the reducer does when the combat finalizes.
    const afterCombat: GameState = { ...selected, combat: null };
    const done = dispatch(afterCombat, { type: 'pass', player: PLAYER_1 });

    expect(phaseStateAs<SitePhaseState>(done).step).toBe('enter-or-skip');
    expect(phaseStateAs<SitePhaseState>(done).siegeAttacks).toBeUndefined();
    expect(done.combat).toBeNull();
    // The company may now decline to enter — it has already faced the siege.
    expect(viableActions(done, PLAYER_1, 'pass')).toHaveLength(1);
    const skipped = dispatch(done, { type: 'pass', player: PLAYER_1 });
    // It was the only company, so doing nothing finishes the whole site phase.
    expect(skipped.phaseState.phase).toBe(Phase.EndOfTurn);
  });

  test('resolving the siege combat for real returns to enter-or-skip, Siege still in play', () => {
    const state = besiegedSitePhase(BREE, [ARAGORN, LEGOLAS, GIMLI]);
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const selected = dispatch(state, { type: 'select-company', player: PLAYER_1, companyId });
    expect(selected.combat!.strikesTotal).toBe(3);

    // Each of the three characters takes one of the three strikes and wins its
    // roll outright (no body on the attack, so a win defeats the strike).
    const fought = continueAutoAttackCombat(selected, [
      { characterDefId: ARAGORN, roll: 12 },
      { characterDefId: LEGOLAS, roll: 12 },
      { characterDefId: GIMLI, roll: 12 },
    ], PLAYER_1, PLAYER_2);
    expect(fought.error).toBeUndefined();
    expect(fought.state.combat).toBeNull();

    // Back at the siege step with the single siege attack already faced;
    // passing advances to the normal enter-or-skip decision.
    expect(phaseStateAs<SitePhaseState>(fought.state).step).toBe('siege-attacks');
    const done = dispatch(fought.state, { type: 'pass', player: PLAYER_1 });
    expect(phaseStateAs<SitePhaseState>(done).step).toBe('enter-or-skip');

    // Defeating the siege attack does not remove the card — only the bound site
    // leaving play discards it.
    expect(done.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SIEGE)).toBe(true);
    expect(done.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === SIEGE)).toBe(false);
  });

  test('the siege step only offers pass — the attack cannot be skipped past', () => {
    const state = besiegedSitePhase(BREE);
    const companyId = state.players[RESOURCE_PLAYER].companies[0].id;
    const selected = dispatch(state, { type: 'select-company', player: PLAYER_1, companyId });
    const afterCombat: GameState = { ...selected, combat: null };

    // No enter-site action is available while the siege step is active.
    expect(viableActions(afterCombat, PLAYER_1, 'enter-site')).toHaveLength(0);
    expect(viableActions(afterCombat, PLAYER_1, 'pass')).toHaveLength(1);
  });

  // ---- Rules 8–11: the end-of-organization-phase movement roll ---------------

  test('ending the organization phase enqueues the roll for a besieged company only', () => {
    const besieged = endOrgPhase(orgPhaseAt({ site: BREE }));
    const rolls = besieged.pendingResolutions.filter(r => r.kind.type === 'dice-check');
    expect(rolls).toHaveLength(1);
    expect(rolls[0].actor).toBe(PLAYER_1);
    const kind = rolls[0].kind as Extract<typeof rolls[0]['kind'], { type: 'dice-check' }>;
    expect(kind.threshold).toBe(5);
    expect(kind.comparison).toBe('gte');
    expect(kind.targetCompanyId).toBe(besieged.players[RESOURCE_PLAYER].companies[0].id);
    expect(viableActions(besieged, PLAYER_1, 'resolve-dice-check')).toHaveLength(1);

    // Control: the same company at an unbesieged site rolls nothing.
    const free = endOrgPhase(orgPhaseAt({ site: BREE, besieged: false }));
    expect(free.pendingResolutions.filter(r => r.kind.type === 'dice-check')).toHaveLength(0);
  });

  test('the roll is modified by -1 for each non-scout character in the company', () => {
    // Aragorn is a scout; Legolas and Gimli are not → -2.
    const mixed = endOrgPhase(orgPhaseAt({ site: BREE, chars: [ARAGORN, LEGOLAS, GIMLI] }));
    const mixedKind = mixed.pendingResolutions[0].kind as Extract<typeof mixed.pendingResolutions[0]['kind'], { type: 'dice-check' }>;
    expect(mixedKind.modifiers).toEqual([{ kind: 'constant', value: -2 }]);

    // An all-scout company takes no penalty at all.
    const scouts = endOrgPhase(orgPhaseAt({ site: BREE, chars: [ARAGORN] }));
    const scoutKind = scouts.pendingResolutions[0].kind as Extract<typeof scouts.pendingResolutions[0]['kind'], { type: 'dice-check' }>;
    expect(scoutKind.modifiers).toEqual([{ kind: 'constant', value: 0 }]);
  });

  test('a result below 5 locks the company stationary and returns its destination to the site deck', () => {
    const rolling = endOrgPhase(orgPhaseAt({ site: BREE, chars: [ARAGORN, LEGOLAS] }));
    const companyId: CompanyId = rolling.players[RESOURCE_PLAYER].companies[0].id;
    expect(rolling.players[RESOURCE_PLAYER].companies[0].destinationSite).not.toBeNull();

    // Legolas is the only non-scout → -1. Rolled 5 → 5 - 1 = 4 < 5 → fail.
    const resolved = dispatch(
      { ...rolling, cheatRollTotal: 5 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );

    expect(resolved.players[RESOURCE_PLAYER].companies[0].destinationSite).toBeNull();
    expect(resolved.players[RESOURCE_PLAYER].siteDeck.some(
      c => c.definitionId === MORIA)).toBe(true);
    const locks = resolved.activeConstraints.filter(c => c.kind.type === 'company-cannot-move');
    expect(locks).toHaveLength(1);
    expect(locks[0].target.kind === 'company' && locks[0].target.companyId).toBe(companyId);
    expect(locks[0].scope.kind).toBe('turn');
  });

  test('a result of 5 or more leaves the declared movement intact', () => {
    const rolling = endOrgPhase(orgPhaseAt({ site: BREE, chars: [ARAGORN, LEGOLAS] }));
    const destinationId = rolling.players[RESOURCE_PLAYER].companies[0].destinationSite!.instanceId;

    // Rolled 6 → 6 - 1 = 5 >= 5 → pass.
    const resolved = dispatch(
      { ...rolling, cheatRollTotal: 6 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );

    expect(resolved.players[RESOURCE_PLAYER].companies[0].destinationSite?.instanceId).toBe(destinationId);
    expect(resolved.activeConstraints.filter(c => c.kind.type === 'company-cannot-move')).toHaveLength(0);
  });

  test('a locked company may not declare movement again that turn', () => {
    const rolling = endOrgPhase(orgPhaseAt({ site: BREE, chars: [ARAGORN, LEGOLAS] }));
    const companyId: CompanyId = rolling.players[RESOURCE_PLAYER].companies[0].id;
    const failed = dispatch(
      { ...rolling, cheatRollTotal: 5 },
      { type: 'resolve-dice-check', player: PLAYER_1, explanation: '' },
    );

    // Back in an organization phase, the lock bars a fresh declaration.
    const backInOrg: GameState = { ...failed, phaseState: { phase: Phase.Organization, sideboardFetchDestination: null, sideboardFetchedThisTurn: 0 } as GameState['phaseState'] };
    const planActions = viableActions(backInOrg, PLAYER_1, 'plan-movement')
      .filter(ea => (ea.action as { companyId: CompanyId }).companyId === companyId);
    expect(planActions).toHaveLength(0);
  });

  // ---- Rule 12: "Discard when the site card is discarded or returned" -------

  test('the Siege is discarded once no company occupies or targets the bound site', () => {
    const held = besiegedSitePhase(BREE);
    // While the company is at Bree the Siege stays in play.
    expect(discardOrphanedSiteAttachedEvents(held)
      .players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SIEGE)).toBe(true);

    // Move the company away (the site card goes back to the location deck).
    const left: GameState = {
      ...held,
      players: held.players.map((p, i) => (i === RESOURCE_PLAYER
        ? { ...p, companies: p.companies.map(c => ({ ...c, currentSite: null })) }
        : p)) as unknown as typeof held.players,
    };
    const swept = discardOrphanedSiteAttachedEvents(left);
    expect(swept.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === SIEGE)).toBe(false);
    expect(swept.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === SIEGE)).toBe(true);
  });

  // ---- Rule 13: "Cannot be duplicated on a given site" ----------------------

  test('a second Siege cannot be played on a site that already has one', () => {
    const base = movingTo(BREE);
    const withSiege: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === HAZARD_PLAYER
        ? { ...p, cardsInPlay: [siegeOnSite(BREE)] }
        : p)) as unknown as typeof base.players,
    };
    expect(siegePlays(withSiege)).toHaveLength(0);

    // Control: the copy is still playable against a different hold.
    const other = movingTo(EDORAS);
    const elsewhere: GameState = {
      ...other,
      players: other.players.map((p, i) => (i === HAZARD_PLAYER
        ? { ...p, cardsInPlay: [siegeOnSite(BREE)] }
        : p)) as unknown as typeof other.players,
    };
    expect(siegePlays(elsewhere)).toHaveLength(1);
  });
});
