/**
 * @module ba-17.test
 *
 * Card test: Diminish and Depart (ba-17)
 * Type: hazard-event (permanent, character-targeting)
 * Effects: 5
 *   - play-target character, filter target.race in {elf, hobbit, wizard}
 *   - duplication-limit scope:company max:1
 *   - stat-modifier mind +1, target:company, when bearer.race in {elf, hobbit}
 *   - stat-modifier direct-influence -1, target:company, when bearer.race wizard
 *   - grant-action remove-self-at-haven, cost:tap-bearer, when bearer.atHaven,
 *     apply move self -> discard
 *
 * "Playable on an Elf, Hobbit, or Wizard. All Elves and Hobbits in the target's
 *  company have +1 mind, and a Wizard in the company has -1 direct influence.
 *  Tap target character at a Haven [{H}] during the organization phase to
 *  discard this card. Cannot be duplicated in a given company."
 *
 * Engine Support:
 * | # | Feature                                     | Status      | Notes                                          |
 * |---|---------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Play targeting an Elf/Hobbit/Wizard (M/H)   | IMPLEMENTED | play-hazard with targetCharacterId + race filter|
 * | 2 | +1 mind to every Elf/Hobbit in the company  | IMPLEMENTED | stat-modifier mind target:company (incl. bearer)|
 * | 3 | -1 direct influence to a Wizard in company  | IMPLEMENTED | stat-modifier direct-influence target:company   |
 * | 4 | Non-Elf/Hobbit/Wizard members unaffected    | IMPLEMENTED | when bearer.race gates                          |
 * | 5 | Tap target at a Haven to discard (org phase)| IMPLEMENTED | grant-action remove-self-at-haven, when atHaven |
 * | 6 | Removal offered only at a Haven             | IMPLEMENTED | grant-action when bearer.atHaven gate           |
 * | 7 | Cannot be duplicated on a given company     | IMPLEMENTED | duplication-limit scope:company max:1           |
 *
 * Playable: YES
 * Certified: 2026-07-14
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, reduce,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, FRODO, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  makeMHState, handCardId, companyIdAt, findCharInstanceId,
  attachHazardToChar, getCharacter, getHazardsOn, dispatch,
  viableActions, CardStatus, expectCharStatus, expectInDiscardPile,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import type { PlayHazardAction, ActivateGrantedAction, CardDefinitionId } from '../../index.js';

const DIMINISH_AND_DEPART = 'ba-17' as CardDefinitionId;

describe('Diminish and Depart (ba-17)', () => {
  beforeEach(() => resetMint());

  test('raises the mind of every Elf and Hobbit in the company by one, including the bearer', () => {
    // Bearer Frodo (hobbit, mind 5); Legolas (elf, 6); Aragorn (Dúnadan, 9) and
    // Gandalf (Wizard, null mind) are unaffected.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, LEGOLAS, ARAGORN, GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Baseline: no mind modifier fires.
    expect(getCharacter(base, RESOURCE_PLAYER, FRODO).effectiveStats.mind).toBeUndefined();
    expect(getCharacter(base, RESOURCE_PLAYER, LEGOLAS).effectiveStats.mind).toBeUndefined();

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, FRODO, DIMINISH_AND_DEPART));

    // The bearer himself (a Hobbit) is boosted — unlike company-others cards.
    expect(getCharacter(withCard, RESOURCE_PLAYER, FRODO).effectiveStats.mind).toBe(6);
    // Every other Elf/Hobbit gains +1 mind too.
    expect(getCharacter(withCard, RESOURCE_PLAYER, LEGOLAS).effectiveStats.mind).toBe(7);
    // A non-Elf/Hobbit (Dúnadan) is never modified.
    expect(getCharacter(withCard, RESOURCE_PLAYER, ARAGORN).effectiveStats.mind).toBeUndefined();
    // A Wizard (null mind) is never modified.
    expect(getCharacter(withCard, RESOURCE_PLAYER, GANDALF).effectiveStats.mind).toBeUndefined();
  });

  test('increases the company general influence cost by one per affected Elf/Hobbit', () => {
    // Frodo (5) + Legolas (6) + Aragorn (9), all GI-controlled = 20 baseline.
    // Diminish on Frodo boosts Frodo→6 and Legolas→7 (Aragorn unchanged) → 22.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, LEGOLAS, ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(base.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(20);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, FRODO, DIMINISH_AND_DEPART));
    expect(withCard.players[RESOURCE_PLAYER].generalInfluenceUsed).toBe(22);
  });

  test('reduces a Wizard in the company by one direct influence', () => {
    // Card borne by the Hobbit Frodo; Gandalf (Wizard, 10 DI) shares the company.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Baseline: Gandalf's full direct influence.
    expect(getCharacter(base, RESOURCE_PLAYER, GANDALF).effectiveStats.directInfluence).toBe(10);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, FRODO, DIMINISH_AND_DEPART));

    // The Wizard loses one direct influence; the Hobbit bearer (not a Wizard) is
    // untouched in DI.
    expect(getCharacter(withCard, RESOURCE_PLAYER, GANDALF).effectiveStats.directInfluence).toBe(9);
    expect(getCharacter(withCard, RESOURCE_PLAYER, FRODO).effectiveStats.directInfluence).toBe(1);
  });

  test('offered as a viable hazard play only on an Elf, Hobbit, or Wizard', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, ARAGORN, GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [DIMINISH_AND_DEPART], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const viableTargets = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard')
      .map(ea => (ea.action as PlayHazardAction).targetCharacterId);

    // Frodo (Hobbit) and Gandalf (Wizard) are valid; Aragorn (Dúnadan) is not.
    expect(viableTargets).toHaveLength(2);
    expect(viableTargets).toContain(findCharInstanceId(base, RESOURCE_PLAYER, FRODO));
    expect(viableTargets).toContain(findCharInstanceId(base, RESOURCE_PLAYER, GANDALF));
    expect(viableTargets).not.toContain(findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN));
  });

  test('cannot be duplicated on a given company', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [DIMINISH_AND_DEPART], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // One copy already attached to Frodo blocks a second copy anywhere in the
    // company (Legolas, an Elf, would otherwise be a valid target).
    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, FRODO, DIMINISH_AND_DEPART);
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
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO, LEGOLAS] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [DIMINISH_AND_DEPART], siteDeck: [MINAS_TIRITH] },
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
    expect(frodoData.hazards[0].definitionId).toBe(DIMINISH_AND_DEPART);

    // Now attached: both the Hobbit bearer and the companion Elf gain +1 mind.
    expect(getCharacter(current, RESOURCE_PLAYER, FRODO).effectiveStats.mind).toBe(6);
    expect(getCharacter(current, RESOURCE_PLAYER, LEGOLAS).effectiveStats.mind).toBe(7);
  });

  test('target character may tap at a Haven during the organization phase to discard the card', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [FRODO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    // Hazard owned by the opponent so it returns to their discard pile.
    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, FRODO, DIMINISH_AND_DEPART, HAZARD_PLAYER);
    expect(getHazardsOn(withCard, RESOURCE_PLAYER, FRODO)).toHaveLength(1);

    const actions = viableActions(withCard, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(1);
    expect((actions[0].action as ActivateGrantedAction).actionId).toBe('remove-self-at-haven');

    const next = dispatch(withCard, actions[0].action);

    // The character taps and the card is discarded to its owner's pile.
    expectCharStatus(next, RESOURCE_PLAYER, FRODO, CardStatus.Tapped);
    expect(getHazardsOn(next, RESOURCE_PLAYER, FRODO)).toHaveLength(0);
    expectInDiscardPile(next, HAZARD_PLAYER, DIMINISH_AND_DEPART);
  });

  test('removal is not offered when the target character is not at a Haven', () => {
    // MORIA is a Ruins & Lairs (non-haven): the removal requires a Haven [{H}].
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [FRODO] }], hand: [], siteDeck: [RIVENDELL] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, FRODO, DIMINISH_AND_DEPART, HAZARD_PLAYER);

    const actions = viableActions(withCard, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(0);
    // The card stays attached.
    expect(getHazardsOn(withCard, RESOURCE_PLAYER, FRODO)).toHaveLength(1);
  });

  test('removal requires the target character to be untapped (tap is the cost)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [{ defId: FRODO, status: CardStatus.Tapped }] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, FRODO, DIMINISH_AND_DEPART, HAZARD_PLAYER);

    // A tapped bearer cannot pay the tap cost, so the removal is unavailable.
    const actions = viableActions(withCard, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(0);
  });
});
