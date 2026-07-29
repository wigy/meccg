/**
 * @module rule-3.06-minion-ringwraith-play
 *
 * CoE Rules — Section 3: Organization Phase
 * Rule 3.06: Minion Ringwraith Play Effects
 *
 * Source: docs/coe-rules.txt
 */

/*
 * RULING:
 *
 * [MINION] When a player plays a Ringwraith (either as their avatar or as a follower), any corresponding Nazgûl hazard manifestation in play is immediately discarded. In addition, if the Ringwraith was played as their avatar, any corresponding Ringwraith follower in play is immediately discarded.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { Alignment, CardStatus } from '../../../index.js';
import type { CardDefinitionId, CardInstanceId, CardInPlay } from '../../../index.js';
import {
  buildTestState, resetMint, reduce, makeMHState, viableActions,
  findCharInstanceId, findHandCardId, viablePlayCharacterActions,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER, HAZARD_PLAYER,
  Phase, ARAGORN, RIVENDELL,
} from '../../test-helpers.js';

// Each Ringwraith character is the manifestation of one Nazgûl hazard card, and
// the pair shares a `manifestId` chain (the hazard card's own id).
const ADUNAPHEL_RINGWRAITH = 'le-50' as CardDefinitionId; // "Manifestation of Adûnaphel"
const ADUNAPHEL_NAZGUL = 'tw-2' as CardDefinitionId;      // the Nazgûl hazard
const DWAR_NAZGUL = 'tw-31' as CardDefinitionId;          // Dwar of Waw — a different Nazgûl

// A Ringwraith avatar may be played at Minas Morgul (rule 3.05).
const MINAS_MORGUL = 'le-390' as CardDefinitionId;
// Orc Captain (le-31): an ordinary minion character, in no manifestation chain.
const ORC_CAPTAIN = 'le-31' as CardDefinitionId;

/** The Nazgûl hazard sitting in play as a permanent-event, as its text allows. */
function nazgulInPlay(defId: CardDefinitionId, instanceId: string): CardInPlay {
  return { instanceId: instanceId as CardInstanceId, definitionId: defId, status: CardStatus.Untapped };
}

describe('Rule 3.06 — Minion Ringwraith Play Effects', () => {
  beforeEach(() => resetMint());

  test('[MINION] playing a Ringwraith discards the hazard player\'s corresponding Nazgûl manifestation', () => {
    const nazgul = nazgulInPlay(ADUNAPHEL_NAZGUL, 'nazgul-1');
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [] }],
          hand: [ADUNAPHEL_RINGWRAITH],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
          cardsInPlay: [nazgul],
        },
      ],
    });

    const result = reduce(state, {
      type: 'play-character',
      player: PLAYER_1,
      characterInstanceId: findHandCardId(state, RESOURCE_PLAYER, ADUNAPHEL_RINGWRAITH),
      atSite: state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId,
      controlledBy: 'general',
    });

    expect(result.error).toBeUndefined();
    expect(findCharInstanceId(result.state, RESOURCE_PLAYER, ADUNAPHEL_RINGWRAITH)).toBeDefined();
    const hazardPlayer = result.state.players[HAZARD_PLAYER];
    expect(hazardPlayer.cardsInPlay.some(c => c.definitionId === ADUNAPHEL_NAZGUL)).toBe(false);
    expect(hazardPlayer.discardPile.some(c => c.instanceId === nazgul.instanceId)).toBe(true);
  });

  test('[MINION] a different Nazgûl stays in play — only the corresponding one is discarded', () => {
    const otherNazgul = nazgulInPlay(DWAR_NAZGUL, 'nazgul-2');
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [] }],
          hand: [ADUNAPHEL_RINGWRAITH],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
          cardsInPlay: [otherNazgul],
        },
      ],
    });

    const result = reduce(state, {
      type: 'play-character',
      player: PLAYER_1,
      characterInstanceId: findHandCardId(state, RESOURCE_PLAYER, ADUNAPHEL_RINGWRAITH),
      atSite: state.players[RESOURCE_PLAYER].companies[0].currentSite!.instanceId,
      controlledBy: 'general',
    });

    expect(result.error).toBeUndefined();
    expect(result.state.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === DWAR_NAZGUL)).toBe(true);
  });

  test('[MINION] the Nazgûl manifestation in play does not block playing the Ringwraith', () => {
    // Glossary g.man.1 normally bars a second manifestation of one entity from
    // entering play; this rule is the "unless it would leave play as the new
    // manifestation is played" carve-out, so the play stays legal.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [] }],
          hand: [ADUNAPHEL_RINGWRAITH],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [],
          siteDeck: [],
          cardsInPlay: [nazgulInPlay(ADUNAPHEL_NAZGUL, 'nazgul-3')],
        },
      ],
    });

    expect(viablePlayCharacterActions(state, PLAYER_1).length).toBeGreaterThan(0);
  });

  test('[MINION] the reverse is still barred — the Nazgûl cannot be played while the Ringwraith is in play', () => {
    const withRingwraith = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [ADUNAPHEL_RINGWRAITH] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ADUNAPHEL_NAZGUL],
          siteDeck: [],
        },
      ],
    });
    const ready = { ...withRingwraith, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    expect(viableActions(ready, PLAYER_2, 'play-hazard')).toHaveLength(0);

    // Control: with a different Ringwraith holding the site, the same hazard is
    // playable — so the block above comes from the manifestation chain.
    const withoutRingwraith = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      recompute: true,
      players: [
        {
          id: PLAYER_1,
          alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [ORC_CAPTAIN] }],
          hand: [],
          siteDeck: [],
        },
        {
          id: PLAYER_2,
          alignment: Alignment.Wizard,
          companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
          hand: [ADUNAPHEL_NAZGUL],
          siteDeck: [],
        },
      ],
    });
    const readyControl = { ...withoutRingwraith, phaseState: makeMHState({ hazardsPlayedThisCompany: 0, hazardLimitAtReveal: 4 }) };

    expect(viableActions(readyControl, PLAYER_2, 'play-hazard').length).toBeGreaterThan(0);
  });

  // The second sentence — an avatar play also discarding a *Ringwraith
  // follower* of the same person — needs the same unique card in play twice:
  // once as one player's follower and once as the other player's avatar, which
  // only arises in a minion-vs-minion game. The discard itself is out of reach
  // of the mechanism used above: the `move` DSL's `in-play` zone resolves
  // `cardsInPlay`, character-attached hazards and items (reducer-move.ts), never
  // characters, so a character-to-discard sweep would need a new zone plus a
  // rule for the follower's controller losing the direct influence it was held
  // with (rule 3.13). No card in the pool exercises it either — the clause is a
  // bare rule, not printed on any Ringwraith.
  test.todo('[MINION] playing a Ringwraith as an avatar discards the corresponding Ringwraith follower in play');
});
