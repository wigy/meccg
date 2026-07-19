/**
 * @module le-138.test
 *
 * Card test: So You've Come Back (le-138)
 * Type: hazard-event (permanent, character-targeting)
 * Effects: 4
 *   - play-target character, filter target.mind <= 5
 *   - duplication-limit scope:company max:1
 *   - stat-modifier mind +1, target:company-others (excludes bearer, followers,
 *     Ringwraiths, Wizards via when on bearer.race / bearer.isFollower)
 *   - on-event organization-phase-start self-discard when company.characterCount
 *     === 1 AND bearer.atHaven
 *
 * "Playable on a character of 5 mind or less. The mind of each other
 *  non-follower, non-Ringwraith, non-Wizard character in his company increases
 *  by one. Discard this card during the organization phase if target character
 *  is in a company by himself and at a Haven/Darkhaven [{H}]. Cannot be
 *  duplicated on a given company."
 *
 * Engine Support:
 * | # | Feature                                   | Status      | Notes                                          |
 * |---|-------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Play targeting character (M/H phase)       | IMPLEMENTED | play-hazard with targetCharacterId             |
 * | 2 | Filter: mind 5 or less                     | IMPLEMENTED | play-target filter target.mind $lte 5          |
 * | 3 | +1 mind to each OTHER company member        | IMPLEMENTED | stat-modifier mind target:company-others       |
 * | 4 | Excludes followers / Ringwraiths / Wizards  | IMPLEMENTED | when bearer.isFollower / bearer.race gates      |
 * | 5 | Raises the company's general influence cost | IMPLEMENTED | effective mind flows to generalInfluenceUsed    |
 * | 6 | Discard at org-phase-start (solo at haven)  | IMPLEMENTED | on-event organization-phase-start self-discard  |
 * | 7 | Cannot be duplicated on a given company     | IMPLEMENTED | duplication-limit scope:company max:1           |
 *
 * Playable: YES
 * Certified: 2026-07-09
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce, runActions,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  makeMHState, handCardId, companyIdAt, findCharInstanceId,
  attachHazardToChar, getCharacter, getHazardsOn, dispatch,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type { PlayHazardAction, CardDefinitionId } from '../../index.js';

const SO_YOUVE_COME_BACK = 'le-138' as CardDefinitionId;

describe("So You've Come Back (le-138)", () => {
  beforeEach(() => resetMint());

  test('raises the mind of each other non-follower character in the company by one', () => {
    // Bearer Frodo (mind 5); companions Aragorn (9) and Legolas (6). Gandalf is
    // a Wizard (mind null) and is unaffected.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, ARAGORN, LEGOLAS, GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Baseline: no mind modifier fires, so effectiveStats.mind is unset.
    expect(getCharacter(base, RESOURCE_PLAYER, ARAGORN).effectiveStats.mind).toBeUndefined();
    expect(getCharacter(base, RESOURCE_PLAYER, LEGOLAS).effectiveStats.mind).toBeUndefined();

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, FRODO, SO_YOUVE_COME_BACK));

    // Each OTHER non-follower character gains +1 mind.
    expect(getCharacter(withCard, RESOURCE_PLAYER, ARAGORN).effectiveStats.mind).toBe(10);
    expect(getCharacter(withCard, RESOURCE_PLAYER, LEGOLAS).effectiveStats.mind).toBe(7);
    // The bearer himself is excluded ("each OTHER character").
    expect(getCharacter(withCard, RESOURCE_PLAYER, FRODO).effectiveStats.mind).toBeUndefined();
    // A Wizard (null mind) is never modified.
    expect(getCharacter(withCard, RESOURCE_PLAYER, GANDALF).effectiveStats.mind).toBeUndefined();
  });

  test('does not raise a follower\'s mind', () => {
    // Gimli is a follower of Aragorn (index 1); Aragorn is a normal
    // GI-controlled character. Frodo bears the card.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          companies: [{ site: RIVENDELL, characters: [FRODO, ARAGORN, { defId: GIMLI, followerOf: 1 }] }],
          hand: [],
          siteDeck: [MORIA],
        },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, FRODO, SO_YOUVE_COME_BACK));

    // Non-follower Aragorn gets +1; follower Gimli is excluded.
    expect(getCharacter(withCard, RESOURCE_PLAYER, ARAGORN).effectiveStats.mind).toBe(10);
    expect(getCharacter(withCard, RESOURCE_PLAYER, GIMLI).effectiveStats.mind).toBeUndefined();
  });

  test('increases the company general influence cost by one per affected companion', () => {
    // All three GI-controlled: base cost = 5 + 9 + 6 = 20. After le-138 on
    // Frodo, Aragorn→10 and Legolas→7 (Frodo unchanged) → 5 + 10 + 7 = 22.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, ARAGORN, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(base.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(20);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, FRODO, SO_YOUVE_COME_BACK));
    expect(withCard.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(22);
  });

  test('offered as a viable hazard play only on a character of 5 mind or less', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SO_YOUVE_COME_BACK], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viablePlays = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => ea.action as PlayHazardAction);

    // Frodo (mind 5) is a valid target; Aragorn (mind 9) is not.
    expect(viablePlays).toHaveLength(1);
    expect(viablePlays[0].targetCharacterId).toBe(findCharInstanceId(base, RESOURCE_PLAYER, FRODO));
  });

  test('cannot be duplicated on a given company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SO_YOUVE_COME_BACK], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // One copy already attached to Frodo. Legolas (mind 6) would otherwise be an
    // invalid target anyway, but the company-scope limit blocks the whole company.
    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, FRODO, SO_YOUVE_COME_BACK);
    const stateAtPlayHazards = { ...withOne, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const viablePlays = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(viablePlays).toHaveLength(0);
  });

  test('playing from hand attaches to the target character via chain resolution', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [SO_YOUVE_COME_BACK], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const targetCompanyId = companyIdAt(base, RESOURCE_PLAYER);
    const cardInstance = handCardId(base, HAZARD_PLAYER);
    const frodoId = findCharInstanceId(base, RESOURCE_PLAYER, FRODO);

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const afterPlay = dispatch(stateAtPlayHazards, {
      type: 'play-hazard',
      player: PLAYER_2,
      cardInstanceId: cardInstance,
      targetCompanyId,
      targetCharacterId: frodoId,
    });
    expect(afterPlay.chain).not.toBeNull();

    let current = afterPlay;
    for (let i = 0; i < 10 && current.chain !== null; i++) {
      const r = reduce(current, { type: 'pass-chain-priority', player: current.chain.priority });
      if (r.error) break;
      current = r.state;
    }
    expect(current.chain).toBeNull();

    const frodoData = current.players[RESOURCE_PLAYER].characters[frodoId];
    expect(frodoData.hazards).toHaveLength(1);
    expect(frodoData.hazards[0].definitionId).toBe(SO_YOUVE_COME_BACK);

    // Now that it's attached, Aragorn's mind is raised.
    expect(getCharacter(current, RESOURCE_PLAYER, ARAGORN).effectiveStats.mind).toBe(10);
  });

  test('discarded at organization-phase-start when the bearer is alone at a Haven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Hazard owned by the opponent (HAZARD_PLAYER) so it returns to their pile.
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, FRODO, SO_YOUVE_COME_BACK, HAZARD_PLAYER);
    expect(getHazardsOn(withCard, RESOURCE_PLAYER, FRODO)).toHaveLength(1);

    const afterOrg = runActions(withCard, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(getHazardsOn(afterOrg, RESOURCE_PLAYER, FRODO)).toHaveLength(0);
    expect(afterOrg.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === SO_YOUVE_COME_BACK)).toBe(true);
  });

  test('not discarded at org-phase-start when the bearer has company at the Haven', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, FRODO, SO_YOUVE_COME_BACK, HAZARD_PLAYER);

    const afterOrg = runActions(withCard, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(getHazardsOn(afterOrg, RESOURCE_PLAYER, FRODO)).toHaveLength(1);
    expect(afterOrg.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === SO_YOUVE_COME_BACK)).toBe(false);
  });

  test('not discarded at org-phase-start when the bearer is alone but not at a Haven', () => {
    // MORIA is a Ruins & Lairs (non-haven): the discard condition requires a Haven.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Untap,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [FRODO] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, FRODO, SO_YOUVE_COME_BACK, HAZARD_PLAYER);

    const afterOrg = runActions(withCard, [
      { type: 'untap', player: PLAYER_1 },
      { type: 'pass', player: PLAYER_2 },
    ]);

    expect(afterOrg.phaseState.phase).toBe(Phase.Organization);
    expect(getHazardsOn(afterOrg, RESOURCE_PLAYER, FRODO)).toHaveLength(1);
    expect(afterOrg.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === SO_YOUVE_COME_BACK)).toBe(false);
  });
});
