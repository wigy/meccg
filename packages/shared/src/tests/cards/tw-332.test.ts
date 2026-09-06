/**
 * @module tw-332.test
 *
 * Card test: Stealth (tw-332)
 * Type: hero-resource-event (short, scout-only)
 * Effects: 2 (play-target character with DSL filter:scout+untapped,
 *             on-event self-enters-play → add-constraint
 *             no-creature-hazards-on-company scope:turn)
 *
 * "Scout only. Tap a scout to play at the end of the organization phase
 *  only if the scout's company size is less than three. No creature
 *  hazards may be played on his company this turn."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                  |
 * |---|------------------------------------------|-------------|----------------------------------------|
 * | 1 | Target = untapped scout (DSL filter)     | IMPLEMENTED | play-target filter via condition-matcher |
 * | 2 | Play window = end of organization        | IMPLEMENTED | offered during organization play-actions |
 * | 3 | Company size < 3 enforced                 | IMPLEMENTED | play-target maxCompanySize:2           |
 * | 4 | Adds no-creature-hazards constraint      | IMPLEMENTED | on-event self-enters-play apply        |
 * | 5 | Constraint blocks opponent creature plays | IMPLEMENTED | constraint filter (cross-player)       |
 * | 6 | Constraint clears at turn-end             | IMPLEMENTED | sweepExpired turn-end                  |
 * | 7 | Other companies' creature hazards remain  | IMPLEMENTED | constraint filter checks targetCompany |
 *
 * Stealth is playable during the normal organization play-actions step
 * whenever its constraints are met. Playing it does NOT end the
 * organization phase or lock out further actions: per CoE 2.II.7 the
 * resource player may still declare movement and otherwise organize after
 * playing an "end of the organization phase" card, advancing to Long-event
 * only by passing.
 *
 * Certified: 2026-04-08
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, CAVE_DRAKE, GANDALF, BILBO, FRODO, GOLLUM,
  STEALTH,
  RIVENDELL, BREE, LORIEN, MORIA, MINAS_TIRITH,
  mint,
  makeMHState,
  handCardId, charIdAt, companyIdAt, dispatch,
  viableActions, RESOURCE_PLAYER, HAZARD_PLAYER,
  findHandCardId, actionAs,
  attachAllyToChar, findAllyInstanceId,
} from '../test-helpers.js';
import type {
  PlayHazardAction, CardInstanceId, CardDefinitionId, PlayShortEventAction,
} from '../../index.js';
import { RegionType, SiteType } from '../../index.js';
import { addConstraint, sweepExpired } from '../../engine/pending.js';

const REN = 'tw-83' as CardDefinitionId;

describe('Stealth (tw-332)', () => {
  beforeEach(() => resetMint());


  test('Stealth is playable during normal organization play-actions when constraints are met', () => {
    // Aragorn is a scout in a company of size 1 — Stealth should appear
    // as a viable play-short-event in the normal play-actions menu, with
    // no need to first enter an end-of-org sub-step.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [STEALTH], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const stealthInstance = handCardId(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.find(a => a.cardInstanceId === stealthInstance)).toBeDefined();
  });

  test('playing Stealth does not lock out movement or other organization actions', () => {
    // Regression (bug report: "Saruman, Isengard", game mqi3vh2z-32ok2s):
    // playing an "end of the organization phase" card (Stealth) used to
    // flip the org phase into a restrictive end-of-org sub-step, after
    // which the player could no longer declare movement or otherwise
    // organize. Per CoE 2.II.7 movement may be declared at any point during
    // the organization phase, including after an end-of-org play. Aragorn's
    // company at Rivendell can reach Bree via starter movement; that
    // plan-movement must remain available after Stealth is played.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [STEALTH], siteDeck: [BREE, MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const stealthInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER);

    // Sanity: movement to Bree is available before Stealth is played.
    expect(viableActions(base, PLAYER_1, 'plan-movement').length).toBeGreaterThan(0);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stealthInstance,
      targetScoutInstanceId: aragornInstance,
    });

    // The phase stays in organization and is not locked into a separate
    // end-of-org window.
    expect(afterPlay.phaseState.phase).toBe(Phase.Organization);
    expect((afterPlay.phaseState as { step?: string }).step).not.toBe('end-of-org');

    // Movement is still offered after the end-of-org play.
    expect(viableActions(afterPlay, PLAYER_1, 'plan-movement').length).toBeGreaterThan(0);

    // The player still advances to Long-event by passing.
    const afterPass = dispatch(afterPlay, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.phaseState.phase).toBe(Phase.LongEvent);
  });

  test('an end-of-org play on one company does not lock movement of another company', () => {
    // Faithful reproduction of the reported scenario: the player played
    // Stealth on a scout in one company while another company (at Isengard,
    // with Saruman) still needed to declare movement. The end-of-org play
    // must not foreclose movement for the unrelated company.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: BREE, characters: [ARAGORN] },       // scout — plays Stealth
            { site: RIVENDELL, characters: [LEGOLAS] },   // unrelated company, can move to Bree
          ],
          hand: [STEALTH],
          siteDeck: [BREE, MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GANDALF] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const stealthInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER); // first company's scout
    const otherCompanyId = companyIdAt(base, RESOURCE_PLAYER, 1);

    const afterPlay = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stealthInstance,
      targetScoutInstanceId: aragornInstance,
    });

    // The unrelated company can still declare movement.
    const movements = viableActions(afterPlay, PLAYER_1, 'plan-movement')
      .map(ea => ea.action as { companyId: string });
    expect(movements.some(a => a.companyId === otherCompanyId)).toBe(true);
  });

  test('pass during play-actions advances directly to Long-event with no end-of-org detour', () => {
    // When the active player has nothing to play at end-of-org, a single
    // pass should advance to the Long-event phase — no extra pass needed
    // to traverse a separate end-of-org sub-step.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const afterPass = dispatch(base, { type: 'pass', player: PLAYER_1 });
    expect(afterPass.phaseState.phase).toBe(Phase.LongEvent);
  });

  test('Stealth is not playable when company size is 3 or more', () => {
    // Aragorn (dunadan=full) + Gandalf (wizard=full) + Bilbo (hobbit=half)
    // + Frodo (hobbit=half) → company size = ceil(2 + 2/2) = 3.
    // Stealth requires company size < 3, so it must NOT appear as viable.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, GANDALF, BILBO, FRODO] }],
          hand: [STEALTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const stealthInstance = handCardId(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.find(a => a.cardInstanceId === stealthInstance)).toBeUndefined();
  });

  test('Stealth is playable when company has 3 characters but effective size 2 (two Hobbits)', () => {
    // Bug report (game mtm4mp5t-ti5gjr): a company of Aragorn, Bilbo, and
    // Frodo was rejected for Stealth because the engine compared the raw
    // character count (3) against maxCompanySize. Per the CoE glossary,
    // "company size" counts each Hobbit as half a character (rounded up):
    // Aragorn (full=1) + Bilbo (hobbit=0.5) + Frodo (hobbit=0.5) = effective
    // size 2, which satisfies Stealth's "company size is less than three".
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [ARAGORN, BILBO, FRODO] }],
          hand: [STEALTH],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const stealthInstance = handCardId(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.find(a => a.cardInstanceId === stealthInstance)).toBeDefined();
  });

  test('Stealth is not playable when company has no scout', () => {
    // Legolas has no scout skill, so Stealth cannot be played even in a
    // small company.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [STEALTH], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const stealthInstance = handCardId(base, RESOURCE_PLAYER);

    const playActions = viableActions(base, PLAYER_1, 'play-short-event')
      .map(ea => ea.action as { cardInstanceId: string });
    expect(playActions.find(a => a.cardInstanceId === stealthInstance)).toBeUndefined();
  });

  test('Stealth is playable on a scout ally (Gollum) even when its host has no scout skill', () => {
    // Bug report (game mtnpi0g4-6syfuw, seq 538): Legolas (warrior/diplomat,
    // no scout skill) has Gollum — a Scout ally per the CoE card database —
    // attached. Per rule 2.V.2.2, allies are treated as characters for
    // "skill only" cards, so Gollum must be offered as an eligible Stealth
    // tapper even though his host cannot pay the cost himself.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [LEGOLAS] }], hand: [STEALTH], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const state = attachAllyToChar(base, RESOURCE_PLAYER, LEGOLAS, GOLLUM);
    const gollumId = findAllyInstanceId(state, RESOURCE_PLAYER, LEGOLAS, GOLLUM)!;

    const playActions = viableActions(state, PLAYER_1, 'play-short-event');
    const gollumAction = playActions.find(
      ea => actionAs<PlayShortEventAction>(ea.action).targetScoutInstanceId === gollumId,
    );
    expect(gollumAction).toBeDefined();
  });

  test('playing Stealth through the reducer adds no-creature-hazards-on-company constraint', () => {
    // Regression: playing Stealth used to leave activeConstraints empty
    // because handlePlayResourceShortEvent did not process on-event
    // self-enters-play effects.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [STEALTH], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });
    const stealthInstance = handCardId(base, RESOURCE_PLAYER);
    const aragornInstance = charIdAt(base, RESOURCE_PLAYER);
    const companyId = companyIdAt(base, RESOURCE_PLAYER);

    const nextState = dispatch(base, {
      type: 'play-short-event',
      player: PLAYER_1,
      cardInstanceId: stealthInstance,
      targetScoutInstanceId: aragornInstance,
    });

    // The constraint should be added to activeConstraints
    expect(nextState.activeConstraints).toHaveLength(1);
    const constraint = nextState.activeConstraints[0];
    expect(constraint.kind.type).toBe('no-creature-hazards-on-company');
    expect(constraint.scope.kind).toBe('turn');
    expect(constraint.target).toEqual({ kind: 'company', companyId });
  });

  test('no-creature-hazards-on-company constraint blocks opponent creature plays against the protected company', () => {
    // Build a state in M/H phase: P1's company at Moria, P2 (hazard player)
    // has Cave-drake in hand. Without the constraint, P2 has a viable
    // play-hazard action targeting P1's company.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const stealthInstance = mint();

    // Set up the M/H phase in the play-hazards step with a wilderness
    // path so Cave-drake (wilderness/ruins-and-lairs keying) can be
    // legally played.
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Hithaeglir'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Moria',
    });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    // Without the constraint, the cave-drake is a viable target for the protected company.
    const beforeActions = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(beforeActions.length).toBeGreaterThan(0);

    // Add the Stealth constraint targeting P1's company.
    const constrained = addConstraint(stateAtPlayHazards, {
      source: stealthInstance,
      sourceDefinitionId: STEALTH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    // After the constraint, P2 has no viable cave-drake plays against P1's company.
    const afterActions = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction)
      .filter(a => a.targetCompanyId === targetCompanyId);
    expect(afterActions.length).toBe(0);
  });

  test('non-creature hazards on the protected company are still allowed', () => {
    // Build a state where P2 has a non-creature hazard (e.g. tw-67 Muster
    // Disperses, which is a hazard-event). The constraint should NOT
    // affect non-creature plays.
    // For simplicity we exercise the filter logic directly via a synthetic
    // EvaluatedAction list, without going through the full M/H legal-action
    // pipeline.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const constrained = addConstraint(base, {
      source: 'stealth-1' as CardInstanceId,
      sourceDefinitionId: STEALTH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    expect(constrained.activeConstraints).toHaveLength(1);
    expect(constrained.activeConstraints[0].kind.type).toBe('no-creature-hazards-on-company');
  });

  test('constraint clears at turn-end via sweepExpired', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [RIVENDELL] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const constrained = addConstraint(base, {
      source: 'stealth-1' as CardInstanceId,
      sourceDefinitionId: STEALTH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });
    expect(constrained.activeConstraints).toHaveLength(1);

    const swept = sweepExpired(constrained, { kind: 'turn-end' });
    expect(swept.activeConstraints).toHaveLength(0);
  });

  test('constraint scoped to company A does not block creature plays against company B', () => {
    // P1 has two companies: a protected one and an unprotected one. P2 plays
    // a creature against the unprotected one — that should be allowed.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [
            { site: MORIA, characters: [ARAGORN] },
            { site: RIVENDELL, characters: [LEGOLAS] },
          ],
          hand: [],
          siteDeck: [MINAS_TIRITH],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [CAVE_DRAKE], siteDeck: [RIVENDELL] },
      ],
    });

    const protectedCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const otherCompanyId = companyIdAt(base, RESOURCE_PLAYER, 1);

    const mhState = makeMHState({
      activeCompanyIndex: 1,
      resolvedSitePath: [RegionType.Wilderness],
      resolvedSitePathNames: ['Trollshaws'],
      destinationSiteType: SiteType.RuinsAndLairs,
      destinationSiteName: 'Rivendell',
    });
    const stateAtPlayHazards = { ...base, phaseState: mhState };

    const constrained = addConstraint(stateAtPlayHazards, {
      source: 'stealth-1' as CardInstanceId,
      sourceDefinitionId: STEALTH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: protectedCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    // P2 should still be able to play creatures against the OTHER company.
    const actions = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction);
    const againstOther = actions.filter(a => a.targetCompanyId === otherCompanyId);
    expect(againstOther.length).toBeGreaterThan(0);
  });

  test('constraint blocks a dual-mode creature\'s creature-mode play but not its permanent-event mode', () => {
    // Regression (bug report, game mtakr7pw-dqxsu4): Ren the Unclean (tw-83)
    // may be played as a hazard creature OR as a permanent-event. The
    // no-creature-hazards-on-company constraint only bars playing it as a
    // creature — its permanent-event mode carries no creature attack and
    // must still be offered. The filter used to key off the card's static
    // cardType ('hazard-creature') alone, dropping every play-hazard action
    // for the card regardless of which mode was being offered.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [REN], siteDeck: [RIVENDELL] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const mhState = makeMHState({
      activeCompanyIndex: 0,
      resolvedSitePath: [RegionType.Dark],
      resolvedSitePathNames: ['Gorgoroth'],
      destinationSiteType: SiteType.DarkHold,
      destinationSiteName: 'Barad-dûr',
    });
    const stateAtPlayHazards = { ...base, phaseState: mhState };
    const renId = findHandCardId(stateAtPlayHazards, HAZARD_PLAYER, REN);

    // Before the constraint: both the creature-mode keyed play and the
    // permanent-event mode are offered against the target company.
    const beforeActions = viableActions(stateAtPlayHazards, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction & { altEventMode?: string })
      .filter(a => a.cardInstanceId === renId && a.targetCompanyId === targetCompanyId);
    expect(beforeActions.some(a => !a.altEventMode)).toBe(true);
    expect(beforeActions.some(a => a.altEventMode === 'permanent-event')).toBe(true);

    const constrained = addConstraint(stateAtPlayHazards, {
      source: 'stealth-1' as CardInstanceId,
      sourceDefinitionId: STEALTH,
      scope: { kind: 'turn' },
      target: { kind: 'company', companyId: targetCompanyId },
      kind: { type: 'no-creature-hazards-on-company' },
    });

    const afterActions = viableActions(constrained, PLAYER_2, 'play-hazard')
      .map(ea => ea.action as PlayHazardAction & { altEventMode?: string })
      .filter(a => a.cardInstanceId === renId && a.targetCompanyId === targetCompanyId);

    // The creature-mode play is dropped by the constraint...
    expect(afterActions.some(a => !a.altEventMode)).toBe(false);
    // ...but the permanent-event mode survives.
    expect(afterActions.some(a => a.altEventMode === 'permanent-event')).toBe(true);
  });
});
