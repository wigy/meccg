/**
 * @module dm-68.test
 *
 * Card test: Inner Cunning (dm-68)
 * Type: hazard-event — dual permanent-event / short-event, non-unique
 * Effects: 2
 *   1. agent-reveal-site-override — homeSiteTypes: [shadow-hold, dark-hold]
 *   2. fetch-agent-to-hand — homeSiteTypes: [shadow-hold, dark-hold]
 *
 * Card text: "As a permanent-event, playable on a face-down agent who was
 *  brought into play this turn. When the agent is revealed, and if his home
 *  site is a Shadow-hold [{S}] or a Dark-hold [{D}], the site where he came
 *  into play (which is not represented by a card) may legally be any Shadow-hold
 *  [{S}] or a Dark-hold [{D}]. Discard when the agent is revealed.
 *  Alternatively, as a short-event, take any agent who has a home site that is a
 *  Shadow-hold [{S}] or Dark-hold [{D}] from your play deck into your hand
 *  (reveal it to your opponent and reshuffle your play deck). Cannot be played
 *  if your opponent is a minion player."
 *
 * Engine support:
 *  - Mode 1 (agent-reveal-site-override): a hazard permanent-event played on
 *    one of the hazard player's own face-down agents (brought into play this
 *    turn = not yet in play at turn start). It enters cardsInPlay bound to the
 *    agent via CardInPlay.attachedToAgentId. While attached — and if the agent's
 *    printed home site is one of the override types — revealAgentActions
 *    broadens the reveal-site choice from the agent's printed home-site name to
 *    ANY location-deck site of those types. On reveal (the agent is no longer
 *    face-down) the orphaned-agent-attached-event sweep discards the card.
 *  - Mode 2 (fetch-agent-to-hand): a hazard short-event. On chain resolution it
 *    enqueues a fetch-to-deck pending effect (source: play deck, to: hand,
 *    shuffle, revealToOpponent) restricted to agents whose printed home site is
 *    of one of the types. The hazard player picks a matching agent via
 *    fetch-from-pile; the deck is reshuffled and the agent is revealed.
 *  - Both modes: guarded by the minion-opponent restriction (isMinionOrBalrog).
 *
 * The Shadow-hold / Dark-hold classification is keyed off the agent's own
 * alignment map: a minion agent's Dol Guldur is a minion *haven* (so Inner
 * Cunning does not apply), while its Moria is a minion *shadow-hold* (it does).
 *
 * Playable: YES
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN, LEGOLAS, CAVE_DRAKE,
  RIVENDELL, LORIEN, MINAS_TIRITH,
  buildTestState, resetMint, makeMHState, makeAgent,
  viableActions, viableFor, dispatch, resolveChain,
  findHandCardId, assertEveryInstanceReachable,
  RESOURCE_PLAYER, HAZARD_PLAYER,
  Alignment,
} from '../test-helpers.js';
import { Phase } from '../../index.js';
import type {
  GameState, CardDefinitionId, CardInstanceId, CompanyId, AgentInPlay, PlayHazardAction,
} from '../../index.js';

const INNER_CUNNING = 'dm-68' as CardDefinitionId;
// Minion agents (keyword "agent") and their printed home sites:
const ANARIN = 'dm-1' as CardDefinitionId;          // home: Moria (minion shadow-hold)
const THE_GRIMBURGOTH = 'dm-15' as CardDefinitionId; // home: Dol Guldur (minion HAVEN — no match)
// Minion sites:
const MORIA_MINION = 'le-392' as CardDefinitionId;       // shadow-hold (Anarin's home)
const MOUNT_GRAM = 'le-394' as CardDefinitionId;         // shadow-hold
const SARN_GORIWING = 'le-401' as CardDefinitionId;      // shadow-hold
const DOL_GULDUR_MINION = 'le-367' as CardDefinitionId;  // haven

const AGENT_ID = 'agent-inner-cunning-0' as CompanyId;

/** A face-down Anarin agent brought into play this turn (not yet in play at turn start). */
const faceDownAnarinThisTurn = (): AgentInPlay => ({
  ...makeAgent(ANARIN, { revealed: false }),
  id: AGENT_ID,
  inPlayAtTurnStart: false,
  remainingActions: 0,
});

/**
 * Build an M/H state: PLAYER_1 (resource, hero by default) is active; PLAYER_2
 * (hazard, minion) holds Inner Cunning. Caller supplies the hazard player's
 * agents, location deck, and play deck.
 */
const buildState = (opts: {
  resourceAlignment?: Alignment;
  // A thunk so the agent's instance is minted AFTER buildTestState (which
  // resets the mint counter), avoiding an instance-id collision.
  agents?: () => AgentInPlay[];
  hazardSiteDeck?: CardDefinitionId[];
  hazardPlayDeck?: CardDefinitionId[];
}): GameState => {
  const base = buildTestState({
    activePlayer: PLAYER_1,
    phase: Phase.MovementHazard,
    players: [
      {
        id: PLAYER_1,
        alignment: opts.resourceAlignment ?? Alignment.Wizard,
        companies: [{ site: RIVENDELL, characters: [ARAGORN, LEGOLAS] }],
        hand: [],
        siteDeck: [MINAS_TIRITH],
      },
      {
        id: PLAYER_2,
        alignment: Alignment.Ringwraith,
        companies: [{ site: LORIEN, characters: [] }],
        hand: [INNER_CUNNING],
        playDeck: opts.hazardPlayDeck ?? [],
        siteDeck: opts.hazardSiteDeck ?? [],
      },
    ],
  });
  const withMH: GameState = { ...base, phaseState: makeMHState() };
  if (!opts.agents) return withMH;
  return {
    ...withMH,
    players: [
      withMH.players[RESOURCE_PLAYER],
      { ...withMH.players[HAZARD_PLAYER], agents: opts.agents() },
    ] as typeof withMH.players,
  };
};

/** Map each reveal-agent action's homeSiteInstanceId back to its site definition id. */
const revealSiteDefs = (state: GameState): (CardDefinitionId | undefined)[] =>
  viableActions(state, PLAYER_2, 'reveal-agent').map(a => {
    const inst = (a.action as { homeSiteInstanceId?: CardInstanceId }).homeSiteInstanceId;
    return state.players[HAZARD_PLAYER].siteDeck.find(s => s.instanceId === inst)?.definitionId;
  });

/** Play Inner Cunning as mode 1 (permanent-event) on the face-down agent, resolving the chain. */
const playMode1 = (state: GameState): GameState => {
  const cardId = findHandCardId(state, HAZARD_PLAYER, INNER_CUNNING);
  const play = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
    const act = a.action as PlayHazardAction;
    return act.cardInstanceId === cardId && act.altEventMode === 'permanent-event' && act.targetAgentId === AGENT_ID;
  });
  expect(play).toBeDefined();
  return resolveChain(dispatch(state, play!.action));
};

describe('Inner Cunning (dm-68)', () => {
  beforeEach(() => resetMint());

  describe('mode 1 — permanent-event on a face-down agent (reveal-site override)', () => {
    test('a face-down agent brought into play this turn reveals only at its printed home site (baseline)', () => {
      const state = buildState({
        agents: () => [faceDownAnarinThisTurn()],
        hazardSiteDeck: [MORIA_MINION, MOUNT_GRAM, SARN_GORIWING],
      });
      // Without Inner Cunning attached: only the printed home (Moria) is offered.
      expect(new Set(revealSiteDefs(state))).toEqual(new Set([MORIA_MINION]));
    });

    test('is playable on the face-down agent (permanent-event mode)', () => {
      const state = buildState({ agents: () => [faceDownAnarinThisTurn()], hazardSiteDeck: [MORIA_MINION] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, INNER_CUNNING);
      const play = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'permanent-event';
      });
      expect(play).toBeDefined();
      expect((play!.action as PlayHazardAction).targetAgentId).toBe(AGENT_ID);
    });

    test('once attached, the agent may be revealed at ANY Shadow-hold/Dark-hold in the location deck', () => {
      const state = buildState({
        agents: () => [faceDownAnarinThisTurn()],
        hazardSiteDeck: [MORIA_MINION, MOUNT_GRAM, SARN_GORIWING],
      });
      const after = playMode1(state);

      // Inner Cunning is in play, bound to the agent.
      const inPlay = after.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === INNER_CUNNING);
      expect(inPlay).toBeDefined();
      expect(inPlay!.attachedToAgentId).toBe(AGENT_ID);

      // Reveal choices are broadened to all three shadow-holds.
      expect(new Set(revealSiteDefs(after))).toEqual(new Set([MORIA_MINION, MOUNT_GRAM, SARN_GORIWING]));
    });

    test('the broadening does not apply when the agent\'s home site is not a Shadow-hold/Dark-hold', () => {
      // The Grimburgoth's home is Dol Guldur, a minion HAVEN — not a shadow/dark-hold.
      const state = buildState({
        agents: () => [{
          ...makeAgent(THE_GRIMBURGOTH, { revealed: false }),
          id: AGENT_ID, inPlayAtTurnStart: false, remainingActions: 0,
        }],
        hazardSiteDeck: [DOL_GULDUR_MINION, MOUNT_GRAM, SARN_GORIWING],
      });
      const after = playMode1(state);
      // Only the printed home (Dol Guldur) is a legal reveal site — no broadening.
      expect(new Set(revealSiteDefs(after))).toEqual(new Set([DOL_GULDUR_MINION]));
    });

    test('revealing the agent discards Inner Cunning ("Discard when the agent is revealed")', () => {
      const state = buildState({
        agents: () => [faceDownAnarinThisTurn()],
        hazardSiteDeck: [MORIA_MINION, MOUNT_GRAM, SARN_GORIWING],
      });
      const after = playMode1(state);

      // Reveal at Mount Gram — a site only legal because of the override.
      const reveal = viableActions(after, PLAYER_2, 'reveal-agent').find(a => {
        const inst = (a.action as { homeSiteInstanceId?: CardInstanceId }).homeSiteInstanceId;
        return after.players[HAZARD_PLAYER].siteDeck.find(s => s.instanceId === inst)?.definitionId === MOUNT_GRAM;
      });
      expect(reveal).toBeDefined();
      const revealed = dispatch(after, reveal!.action);

      const agent = revealed.players[HAZARD_PLAYER].agents[0];
      expect(agent.revealed).toBe(true);
      expect(agent.siteStack[agent.siteStack.length - 1].definitionId).toBe(MOUNT_GRAM);

      // Inner Cunning is no longer in play — it was discarded on reveal.
      expect(revealed.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === INNER_CUNNING)).toBe(false);
      expect(revealed.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === INNER_CUNNING)).toBe(true);
      assertEveryInstanceReachable(revealed);
    });

    test('not offered on an agent that was already in play at the start of the turn', () => {
      const state = buildState({
        agents: () => [{ ...makeAgent(ANARIN, { revealed: false }), id: AGENT_ID, inPlayAtTurnStart: true }],
        hazardSiteDeck: [MORIA_MINION],
      });
      const cardId = findHandCardId(state, HAZARD_PLAYER, INNER_CUNNING);
      const perm = viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'permanent-event';
      });
      expect(perm).toHaveLength(0);
    });

    test('not offered on a revealed (face-up) agent', () => {
      const state = buildState({
        agents: () => [{ ...makeAgent(ANARIN, { revealed: true }), id: AGENT_ID, inPlayAtTurnStart: false }],
        hazardSiteDeck: [MORIA_MINION],
      });
      const cardId = findHandCardId(state, HAZARD_PLAYER, INNER_CUNNING);
      const perm = viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'permanent-event';
      });
      expect(perm).toHaveLength(0);
    });
  });

  describe('mode 2 — short-event tutor', () => {
    test('offered as a short-event when a matching agent is in the play deck', () => {
      const state = buildState({ hazardPlayDeck: [ANARIN, CAVE_DRAKE] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, INNER_CUNNING);
      const short = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'short-event';
      });
      expect(short).toBeDefined();
    });

    test('short-event mode is non-viable when no matching agent is in the deck', () => {
      // The Grimburgoth (Dol Guldur = minion haven) does not qualify.
      const state = buildState({ hazardPlayDeck: [THE_GRIMBURGOTH, CAVE_DRAKE] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, INNER_CUNNING);
      const short = viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'short-event' && a.viable;
      });
      expect(short).toHaveLength(0);
    });

    test('resolving it lets the hazard player fetch only a matching agent from the play deck', () => {
      const state = buildState({ hazardPlayDeck: [ANARIN, THE_GRIMBURGOTH, CAVE_DRAKE] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, INNER_CUNNING);
      const short = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'short-event';
      });
      const resolved = resolveChain(dispatch(state, short!.action));

      // A pending fetch is queued for the hazard player (the non-active player).
      expect(resolved.pendingEffects).toHaveLength(1);
      expect(resolved.pendingEffects[0].actor).toBe(PLAYER_2);
      // The resource player must wait.
      expect(viableFor(resolved, PLAYER_1)).toHaveLength(0);

      // Only Anarin (Moria = minion shadow-hold) is a legal fetch target.
      const fetches = viableActions(resolved, PLAYER_2, 'fetch-from-pile');
      const fetchDefs = fetches.map(a => {
        const inst = (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId;
        return resolved.players[HAZARD_PLAYER].playDeck.find(c => c.instanceId === inst)?.definitionId;
      });
      expect(fetchDefs).toContain(ANARIN);
      expect(fetchDefs).not.toContain(THE_GRIMBURGOTH);
      expect(fetchDefs).not.toContain(CAVE_DRAKE);
    });

    test('fetching takes the agent to hand, reveals it to the opponent, and reshuffles the deck', () => {
      const state = buildState({ hazardPlayDeck: [ANARIN, THE_GRIMBURGOTH, CAVE_DRAKE] });
      const anarinId = state.players[HAZARD_PLAYER].playDeck.find(c => c.definitionId === ANARIN)!.instanceId;
      const cardId = findHandCardId(state, HAZARD_PLAYER, INNER_CUNNING);
      const short = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'short-event';
      });
      let s = resolveChain(dispatch(state, short!.action));

      const fetch = viableActions(s, PLAYER_2, 'fetch-from-pile').find(a =>
        (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId === anarinId,
      );
      expect(fetch).toBeDefined();
      s = dispatch(s, fetch!.action);

      const hazard = s.players[HAZARD_PLAYER];
      // Anarin is now in hand and revealed to the opponent.
      expect(hazard.hand.some(c => c.instanceId === anarinId)).toBe(true);
      expect(s.revealedInstances[anarinId]).toBe(ANARIN);
      // The two non-fetched cards remain in the (reshuffled) deck; none disappeared.
      expect(hazard.playDeck.map(c => c.definitionId).sort()).toEqual([CAVE_DRAKE, THE_GRIMBURGOTH].sort());
      // The spent event is in the discard pile.
      expect(hazard.discardPile.some(c => c.definitionId === INNER_CUNNING)).toBe(true);
      expect(hazard.hand.some(c => c.definitionId === INNER_CUNNING)).toBe(false);
      assertEveryInstanceReachable(s);
    });

    test('the hazard player may decline the fetch (pass), leaving the deck intact', () => {
      const state = buildState({ hazardPlayDeck: [ANARIN, CAVE_DRAKE] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, INNER_CUNNING);
      const short = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'short-event';
      });
      let s = resolveChain(dispatch(state, short!.action));
      s = dispatch(s, { type: 'pass', player: PLAYER_2 });

      const hazard = s.players[HAZARD_PLAYER];
      expect(s.pendingEffects).toHaveLength(0);
      // Nothing fetched; both cards remain in the deck.
      expect(hazard.playDeck.map(c => c.definitionId).sort()).toEqual([ANARIN, CAVE_DRAKE].sort());
      expect(hazard.discardPile.some(c => c.definitionId === INNER_CUNNING)).toBe(true);
      assertEveryInstanceReachable(s);
    });
  });

  describe('minion-opponent restriction (both modes)', () => {
    test('mode 1 is not playable when the opponent is a minion player', () => {
      const state = buildState({
        resourceAlignment: Alignment.Ringwraith,
        agents: () => [faceDownAnarinThisTurn()],
        hazardSiteDeck: [MORIA_MINION],
      });
      const cardId = findHandCardId(state, HAZARD_PLAYER, INNER_CUNNING);
      const viable = viableActions(state, PLAYER_2, 'play-hazard').filter(a =>
        (a.action as PlayHazardAction).cardInstanceId === cardId && a.viable,
      );
      expect(viable).toHaveLength(0);
    });

    test('mode 2 is not playable when the opponent is a minion player', () => {
      const state = buildState({
        resourceAlignment: Alignment.Ringwraith,
        hazardPlayDeck: [ANARIN],
      });
      const cardId = findHandCardId(state, HAZARD_PLAYER, INNER_CUNNING);
      const viable = viableActions(state, PLAYER_2, 'play-hazard').filter(a =>
        (a.action as PlayHazardAction).cardInstanceId === cardId && a.viable,
      );
      expect(viable).toHaveLength(0);
    });
  });
});
