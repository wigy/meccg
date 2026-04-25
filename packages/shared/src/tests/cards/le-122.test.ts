/**
 * @module le-122.test
 *
 * Card test: Lure of Expedience (le-122)
 * Type: hazard-event (permanent, character-targeting)
 * Effects: 5 (play-target character filter non-ringwraith/non-wizard/non-hobbit,
 *             duplication-limit scope:character max:1,
 *             stat-modifier corruption-points +2,
 *             on-event character-gains-item force-check corruption,
 *             grant-action remove-self-on-roll cost:tap-bearer threshold:6)
 *
 * "Corruption. Playable on a non-Ringwraith, non-Wizard, non-Hobbit character.
 *  Target character receives 2 corruption points and makes a corruption check
 *  each time a character in his company gains an item (including a ring special
 *  item). During his organization phase, the character may tap to attempt to
 *  remove this card. Make a roll—if the result is greater than 5, discard this
 *  card. Cannot be duplicated on a given character."
 *
 * Engine Support:
 * | # | Feature                                  | Status      | Notes                                          |
 * |---|------------------------------------------|-------------|------------------------------------------------|
 * | 1 | Play from hand targeting character        | IMPLEMENTED | play-hazard with targetCharacterId             |
 * | 2 | Filter: non-ringwraith/wizard/hobbit      | IMPLEMENTED | play-target filter with $not $in               |
 * | 3 | +2 corruption points while attached       | IMPLEMENTED | stat-modifier corruption-points +2             |
 * | 4 | Corruption check on any company item gain | IMPLEMENTED | on-event character-gains-item force-check      |
 * | 5 | Tap to attempt removal (roll>5)           | IMPLEMENTED | grant-action remove-self-on-roll threshold 6   |
 * | 6 | Cannot be duplicated on a character       | IMPLEMENTED | duplication-limit scope:character max:1        |
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase,
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, GIMLI, BILBO, ELROND, GANDALF,
  RIVENDELL, LORIEN, MORIA, MINAS_TIRITH,
  viableActions, CardStatus, dispatch, expectCharStatus, expectInDiscardPile,
  buildSitePhaseState, handCardId, companyIdAt, findCharInstanceId,
  attachHazardToChar, getCharacter, getHazardsOn,
  charIdAt, makeMHState,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  DAGGER_OF_WESTERNESSE,
} from '../test-helpers.js';
import type {
  ActivateGrantedAction,
  CardDefinitionId,
  PlayHazardAction,
} from '../../index.js';
import { computeLegalActions } from '../../engine/legal-actions/index.js';
import { recomputeDerived } from '../../engine/recompute-derived.js';

const LURE_OF_EXPEDIENCE = 'le-122' as CardDefinitionId;

// Minion fixtures for race-filter tests.
const GORBAG = 'le-11' as CardDefinitionId;           // minion-character, orc
const ADUNAPHEL = 'le-50' as CardDefinitionId;        // minion-character, ringwraith
const DOL_GULDUR = 'le-367' as CardDefinitionId;      // minion-site, haven
const MINAS_MORGUL = 'le-390' as CardDefinitionId;    // minion-site, haven
const ETTENMOORS_MINION = 'le-373' as CardDefinitionId; // minion-site, ruins-and-lairs

describe('Lure of Expedience (le-122)', () => {
  beforeEach(() => resetMint());

  // ── Effect: +2 corruption points while attached ───────────────────────────

  test('attached card adds 2 corruption points to the bearer', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    expect(getCharacter(base, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(0);

    const withCard = recomputeDerived(attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_EXPEDIENCE));
    expect(getCharacter(withCard, RESOURCE_PLAYER, ARAGORN).effectiveStats.corruptionPoints).toBe(2);
  });

  // ── Effect: play-target filter ─────────────────────────────────────────────

  test('can be played on non-wizard, non-ringwraith, non-hobbit characters (Aragorn/Legolas/Elrond eligible)', () => {
    // Company: Aragorn (man), Legolas (elf), Elrond (elf), Bilbo (hobbit), Gandalf (wizard)
    // Only Aragorn, Legolas, Elrond are eligible targets.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS, BILBO, ELROND, GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [GIMLI] }], hand: [LURE_OF_EXPEDIENCE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const targets = new Set(
      computeLegalActions(stateAtPlayHazards, PLAYER_2)
        .filter(ea => ea.viable && ea.action.type === 'play-hazard')
        .map(ea => (ea.action as PlayHazardAction).targetCharacterId),
    );

    expect(targets).toEqual(new Set([
      findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN),
      findCharInstanceId(base, RESOURCE_PLAYER, LEGOLAS),
      findCharInstanceId(base, RESOURCE_PLAYER, ELROND),
    ]));
  });

  test('cannot be played on a hobbit (Bilbo)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [BILBO] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LURE_OF_EXPEDIENCE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  test('cannot be played on a wizard (Gandalf)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [GANDALF] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LURE_OF_EXPEDIENCE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  test('cannot be played on a ringwraith (Adûnaphel)', () => {
    // Swap roles — PLAYER_2 is the active resource player (ringwraiths);
    // PLAYER_1 is the hazard player trying to play Lure of Expedience.
    const base = buildTestState({
      activePlayer: PLAYER_2,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: DOL_GULDUR, characters: [GORBAG] }], hand: [LURE_OF_EXPEDIENCE], siteDeck: [ETTENMOORS_MINION] },
        { id: PLAYER_2, companies: [{ site: MINAS_MORGUL, characters: [ADUNAPHEL] }], hand: [], siteDeck: [ETTENMOORS_MINION] },
      ],
    });

    const stateAtPlayHazards = { ...base, phaseState: makeMHState({ activeCompanyIndex: 0 }) };
    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_1)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  // ── Effect: duplication-limit ─────────────────────────────────────────────

  test('cannot be duplicated on the same character', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LURE_OF_EXPEDIENCE], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withOne = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_EXPEDIENCE);
    const stateAtPlayHazards = { ...withOne, phaseState: makeMHState({ activeCompanyIndex: 0 }) };

    const playActions = computeLegalActions(stateAtPlayHazards, PLAYER_2)
      .filter(ea => ea.viable && ea.action.type === 'play-hazard');
    expect(playActions).toHaveLength(0);
  });

  // ── Effect: character-gains-item corruption check ─────────────────────────

  test('enqueues a corruption check for bearer when a company member gains an item', () => {
    // Aragorn (bearer of hazard) is in company with Legolas.
    // When Legolas gains a dagger → Aragorn must make a corruption check.
    const base = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN, LEGOLAS],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const withHazard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_EXPEDIENCE);
    const daggerId = handCardId(withHazard, RESOURCE_PLAYER);
    const legolasId = findCharInstanceId(withHazard, RESOURCE_PLAYER, LEGOLAS);
    const compId = companyIdAt(withHazard, RESOURCE_PLAYER);

    const afterPlay = dispatch(withHazard, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: daggerId,
      companyId: compId,
      attachToCharacterId: legolasId,
    });

    const pending = afterPlay.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type === 'corruption-check') {
      // The corruption check targets the bearer (Aragorn), not the item gainer (Legolas)
      expect(pending[0].kind.characterId).toBe(charIdAt(withHazard, RESOURCE_PLAYER));
      expect(pending[0].kind.reason).toContain('Lure of Expedience');
    }
  });

  test('enqueues a corruption check for bearer when the bearer itself gains an item', () => {
    // Aragorn (bearer of hazard) gains an item → Aragorn makes a corruption check.
    const base = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const withHazard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_EXPEDIENCE);
    const daggerId = handCardId(withHazard, RESOURCE_PLAYER);
    const aragornId = findCharInstanceId(withHazard, RESOURCE_PLAYER, ARAGORN);
    const compId = companyIdAt(withHazard, RESOURCE_PLAYER);

    const afterPlay = dispatch(withHazard, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: daggerId,
      companyId: compId,
      attachToCharacterId: aragornId,
    });

    const pending = afterPlay.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(1);
    if (pending[0].kind.type === 'corruption-check') {
      expect(pending[0].kind.characterId).toBe(aragornId);
      expect(pending[0].kind.reason).toContain('Lure of Expedience');
    }
  });

  test('no corruption check on item gain when hazard is not attached', () => {
    const base = buildSitePhaseState({
      site: MORIA,
      characters: [ARAGORN],
      hand: [DAGGER_OF_WESTERNESSE],
    });

    const daggerId = handCardId(base, RESOURCE_PLAYER);
    const aragornId = findCharInstanceId(base, RESOURCE_PLAYER, ARAGORN);
    const compId = companyIdAt(base, RESOURCE_PLAYER);

    const afterPlay = dispatch(base, {
      type: 'play-hero-resource',
      player: PLAYER_1,
      cardInstanceId: daggerId,
      companyId: compId,
      attachToCharacterId: aragornId,
    });

    const pending = afterPlay.pendingResolutions.filter(
      r => r.actor === PLAYER_1 && r.kind.type === 'corruption-check',
    );
    expect(pending).toHaveLength(0);
  });

  // ── Effect: tap bearer to attempt removal (roll > 5) ─────────────────────

  test('untapped bearer in Organization can activate remove-self-on-roll (rollThreshold 6)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_EXPEDIENCE);
    const actions = viableActions(withCard, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(1);

    const action = actions[0].action as ActivateGrantedAction;
    expect(action.actionId).toBe('remove-self-on-roll');
    expect(action.rollThreshold).toBe(6);
    expect(action.characterId).toBe(charIdAt(withCard, RESOURCE_PLAYER));
  });

  test.each([
    { label: 'successful removal roll (>5) discards the card', roll: 6, expectedHazards: 0 },
    { label: 'failed removal roll (<=5) keeps the card attached', roll: 5, expectedHazards: 1 },
  ])('$label; bearer taps either way', ({ roll, expectedHazards }) => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_EXPEDIENCE);
    const cheated = { ...withCard, cheatRollTotal: roll };
    const actions = viableActions(cheated, PLAYER_1, 'activate-granted-action');
    const next = dispatch(cheated, actions[0].action);

    expectCharStatus(next, RESOURCE_PLAYER, ARAGORN, CardStatus.Tapped);
    expect(getHazardsOn(next, RESOURCE_PLAYER, ARAGORN)).toHaveLength(expectedHazards);
    if (expectedHazards === 0) {
      expectInDiscardPile(next, HAZARD_PLAYER, LURE_OF_EXPEDIENCE);
    } else {
      expect(getHazardsOn(next, RESOURCE_PLAYER, ARAGORN)[0].definitionId).toBe(LURE_OF_EXPEDIENCE);
    }
  });

  test('tapped bearer cannot activate remove-self-on-roll', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      players: [
        { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [MORIA] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [], siteDeck: [MINAS_TIRITH] },
      ],
    });

    const withCard = attachHazardToChar(base, RESOURCE_PLAYER, ARAGORN, LURE_OF_EXPEDIENCE);
    const aragornId = findCharInstanceId(withCard, RESOURCE_PLAYER, ARAGORN);
    const tapped: typeof withCard = {
      ...withCard,
      players: [
        {
          ...withCard.players[0],
          characters: {
            ...withCard.players[0].characters,
            [aragornId as string]: {
              ...withCard.players[0].characters[aragornId as string],
              status: CardStatus.Tapped,
            },
          },
        },
        withCard.players[1],
      ] as typeof withCard.players,
    };

    const actions = viableActions(tapped, PLAYER_1, 'activate-granted-action');
    expect(actions).toHaveLength(0);
  });
});
