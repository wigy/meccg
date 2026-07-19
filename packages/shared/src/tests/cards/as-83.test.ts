/**
 * @module as-83.test
 *
 * Card test: Faithless Steward (as-83)
 * Type: minion-resource-event (permanent), 3 misc MP (conditional)
 *
 * "Playable on an agent character at a Darkhaven [{DH}] who has a Border-hold
 *  [{B}] or Free-hold [{F}] as a home site. If target character is unwounded and
 *  at one of his Border-hold [{B}] or Free-hold [{F}] home sites, no factions
 *  can be played at any version of that site and you receive this card's
 *  marshalling points. Cannot be duplicated on a given character."
 *
 * Effects:
 *   - play-target (character): agent keyword AND a Border-/Free-hold home site
 *       (via the new `target.homeSiteTypes` play-target context field).
 *   - play-condition (site-type: haven): the bearer's company must be at a
 *       Darkhaven when the card is played (a minion company at a haven).
 *   - agent-home-site-faction-lock (homeSiteTypes: border-hold, free-hold): the
 *       ongoing conditional effect. While the bearer is unwounded and standing
 *       at one of his Border-/Free-hold home sites, (a) no factions may be
 *       played at any version of that site (matched by printed name) and (b) the
 *       card's printed marshalling points are credited to its controller. Both
 *       switch off when the bearer is wounded or off its home site.
 *   - duplication-limit (character, max 1).
 *
 * The "agent character" here is a minion character carrying the `agent` keyword
 * played as a normal company character (rule 2.II.2.2.5), NOT an AgentInPlay
 * roaming hazard.
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, Phase, CardStatus,
  PLAYER_1, PLAYER_2, RESOURCE_PLAYER,
  findCharInstanceId, makeSitePhase, firstFactionInfluenceAttempt,
  viableActions,
} from '../test-helpers.js';
import { Alignment } from '../../index.js';
import type { CardDefinitionId, PlayPermanentEventAction } from '../../index.js';

const FAITHLESS_STEWARD = 'as-83' as CardDefinitionId; // this card
const BILL_FERNY = 'dm-3' as CardDefinitionId;         // agent, homes Bree + Cameth Brin (border-holds)
const ELWEN = 'dm-8' as CardDefinitionId;              // agent, homes Dol Amroth + Minas Tirith (free-holds)
const BADUILA = 'dm-2' as CardDefinitionId;            // agent, homes Goblin-gate + Mount Gundabad (no B/F)
const CALENDAL = 'le-4' as CardDefinitionId;           // NON-agent minion character (home Dol Guldur)
const LAGDUF = 'le-18' as CardDefinitionId;            // orc warrior, minion influencer filler

const HILLMEN = 'le-269' as CardDefinitionId;          // minion faction playable at Cameth Brin (influence 11)
const VARIAGS = 'le-292' as CardDefinitionId;          // minion faction playable at Variag Camp

const CAMETH_BRIN = 'le-358' as CardDefinitionId;      // Bill Ferny home; ringwraith border-hold
const VARIAG_CAMP = 'le-411' as CardDefinitionId;      // border-hold, NOT a Bill Ferny home site
const MINAS_MORGUL = 'le-390' as CardDefinitionId;     // ringwraith Darkhaven (haven), not a home site
const CARN_DUM = 'le-359' as CardDefinitionId;         // minion haven (site-deck filler)

describe('Faithless Steward (as-83)', () => {
  beforeEach(() => resetMint());

  // ── Play restriction: agent at a Darkhaven with a Border-/Free-hold home site ──

  test('playable on an agent with a Border-hold home site at a Darkhaven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [BILL_FERNY] }], hand: [FAITHLESS_STEWARD], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    expect(actions.length).toBe(1);
    const billId = findCharInstanceId(state, RESOURCE_PLAYER, BILL_FERNY);
    expect((actions[0].action as PlayPermanentEventAction).targetCharacterId).toBe(billId);
  });

  test('playable on an agent with a Free-hold home site (Elwen) at a Darkhaven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [ELWEN] }], hand: [FAITHLESS_STEWARD], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(1);
  });

  test('NOT playable on a non-agent character at a Darkhaven', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [CALENDAL] }], hand: [FAITHLESS_STEWARD], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable on an agent whose home sites are neither Border- nor Free-hold', () => {
    // Baduila's home sites (Goblin-gate, Mount Gundabad) are Ruins & Lairs /
    // Shadow-hold — no Border-hold or Free-hold home site.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: MINAS_MORGUL, characters: [BADUILA] }], hand: [FAITHLESS_STEWARD], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  test('NOT playable when the agent is not at a Darkhaven', () => {
    // Bill Ferny qualifies as a target, but his company is at a Border-hold
    // (Cameth Brin), not a Darkhaven [{DH}].
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        { id: PLAYER_1, alignment: Alignment.Ringwraith, companies: [{ site: CAMETH_BRIN, characters: [BILL_FERNY] }], hand: [FAITHLESS_STEWARD], siteDeck: [CARN_DUM] },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(viableActions(state, PLAYER_1, 'play-permanent-event').length).toBe(0);
  });

  // ── duplication-limit (character): one copy per agent ──

  test('cannot be duplicated on a given agent, but may be played on another eligible agent', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [{ defId: BILL_FERNY, items: [FAITHLESS_STEWARD] }, ELWEN] }],
          hand: [FAITHLESS_STEWARD], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const actions = viableActions(state, PLAYER_1, 'play-permanent-event');
    const billId = findCharInstanceId(state, RESOURCE_PLAYER, BILL_FERNY);
    const elwenId = findCharInstanceId(state, RESOURCE_PLAYER, ELWEN);
    // Bill Ferny already bears a copy → not offered again on him.
    expect(actions.some(a => (a.action as PlayPermanentEventAction).targetCharacterId === billId)).toBe(false);
    // Elwen (a second eligible agent) is still a valid target.
    expect(actions.some(a => (a.action as PlayPermanentEventAction).targetCharacterId === elwenId)).toBe(true);
  });

  // ── Ongoing faction lock: no factions at any version of the home site ──

  test('bars faction play at the home site while the unwounded agent is there', () => {
    // Bill Ferny (bearing Faithless Steward, unwounded) at Cameth Brin, his
    // Border-hold home site. Calendal is the untapped influencer, so the block
    // is not merely "no influencer available".
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: CAMETH_BRIN, characters: [{ defId: BILL_FERNY, items: [FAITHLESS_STEWARD] }, CALENDAL] }],
          hand: [HILLMEN], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeUndefined();
  });

  test('faction play is allowed at the home site without Faithless Steward (control)', () => {
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: CAMETH_BRIN, characters: [BILL_FERNY, CALENDAL] }],
          hand: [HILLMEN], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeDefined();
  });

  test('the lock switches off when the bearer is wounded', () => {
    // Bill Ferny wounded (inverted); Calendal is the untapped influencer.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: CAMETH_BRIN, characters: [{ defId: BILL_FERNY, items: [FAITHLESS_STEWARD], status: CardStatus.Inverted }, CALENDAL] }],
          hand: [HILLMEN], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeDefined();
  });

  test('the lock requires a HOME site, not merely a Border-hold', () => {
    // Bill Ferny (bearing Faithless Steward, unwounded) at Variag Camp — a
    // Border-hold that is NOT one of his home sites. Factions playable there
    // (Variags of Khand) are unaffected by the lock.
    const base = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [{ defId: BILL_FERNY, items: [FAITHLESS_STEWARD] }, CALENDAL] }],
          hand: [VARIAGS], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    const state = { ...base, phaseState: makeSitePhase() };
    const factionId = state.players[RESOURCE_PLAYER].hand[0].instanceId;
    expect(firstFactionInfluenceAttempt(state, factionId)).toBeDefined();
  });

  // ── Conditional marshalling points ──

  test('credits 3 misc marshalling points while the unwounded agent is at a Border-hold home site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: CAMETH_BRIN, characters: [{ defId: BILL_FERNY, items: [FAITHLESS_STEWARD] }] }],
          hand: [], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(3);
  });

  test('no marshalling points when the agent is at a Darkhaven (not a home site)', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Organization,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: MINAS_MORGUL, characters: [{ defId: BILL_FERNY, items: [FAITHLESS_STEWARD] }] }],
          hand: [], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  test('no marshalling points when the bearer is wounded at a home site', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: CAMETH_BRIN, characters: [{ defId: BILL_FERNY, items: [FAITHLESS_STEWARD], status: CardStatus.Inverted }] }],
          hand: [], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });

  test('no marshalling points at a non-home Border-hold', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.Site,
      recompute: true,
      players: [
        {
          id: PLAYER_1, alignment: Alignment.Ringwraith,
          companies: [{ site: VARIAG_CAMP, characters: [{ defId: BILL_FERNY, items: [FAITHLESS_STEWARD] }] }],
          hand: [], siteDeck: [CARN_DUM],
        },
        { id: PLAYER_2, companies: [{ site: CARN_DUM, characters: [LAGDUF] }], hand: [], siteDeck: [CARN_DUM] },
      ],
    });
    expect(state.players[RESOURCE_PLAYER].marshallingPoints.misc).toBe(0);
  });
});
