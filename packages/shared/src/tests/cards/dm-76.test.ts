/**
 * @module dm-76.test
 *
 * Card test: Nobody's Friend (dm-76)
 * Type: hazard-event — dual permanent-event / short-event, non-unique
 * Effects: 2
 *   1. agent-reveal-site-override — homeSiteTypes: [border-hold, free-hold]
 *   2. fetch-agent-to-hand — homeSiteTypes: [border-hold, free-hold]
 *
 * Card text: "As a permanent-event, playable on a face-down agent who was
 *  brought into play this turn. When the agent is revealed, and if his home
 *  site is a Border-hold [{B}] or a Free-hold [{F}], the site where he came
 *  into play (which is not represented by a card) may legally be any
 *  Border-hold [{B}] or a Free-hold [{F}]. Discard when the agent is revealed.
 *  Alternatively, as a short-event, take any agent who has a home site that is
 *  a Free-hold [{F}] or Border-hold [{B}] from your play deck into your hand
 *  (reveal it to your opponent and reshuffle your play deck). Cannot be played
 *  if your opponent is a minion player."
 *
 * Engine support: the exact Border-hold/Free-hold sibling of Inner Cunning
 * (dm-68, certified), which established both primitives with Shadow-hold/
 * Dark-hold types. Both are fully data-driven via `homeSiteTypes`:
 *  - Mode 1 (agent-reveal-site-override): a hazard permanent-event played on
 *    one of the hazard player's own face-down agents (brought into play this
 *    turn = not yet in play at turn start). It enters cardsInPlay bound to the
 *    agent via CardInPlay.attachedToAgentId. While attached — and if the
 *    agent's printed home site is one of the override types — revealAgentActions
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
 * The Border-hold / Free-hold classification is keyed off the agent's own
 * alignment map: the Ringwraith agent Drór's Blue Mountain Dwarf-hold is a
 * minion *free-hold* (so Nobody's Friend applies), while Anarin's Moria is a
 * minion *shadow-hold* (it does not — that agent belongs to Inner Cunning).
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

const NOBODYS_FRIEND = 'dm-76' as CardDefinitionId;
// Minion agents (keyword "agent") and their printed home sites:
const DROR = 'dm-6' as CardDefinitionId;   // home: Blue Mountain Dwarf-hold (minion free-hold)
const ANARIN = 'dm-1' as CardDefinitionId; // home: Moria (minion SHADOW-HOLD — no match)
// Minion sites:
const BLUE_MOUNTAIN_DWARF_HOLD = 'le-355' as CardDefinitionId; // free-hold (Drór's home)
const EDORAS_MINION = 'le-372' as CardDefinitionId;            // free-hold
const DALE_MINION = 'le-363' as CardDefinitionId;              // border-hold
const MORIA_MINION = 'le-392' as CardDefinitionId;             // shadow-hold (Anarin's home)

const AGENT_ID = 'agent-nobodys-friend-0' as CompanyId;

/** A face-down Drór agent brought into play this turn (not yet in play at turn start). */
const faceDownDrorThisTurn = (): AgentInPlay => ({
  ...makeAgent(DROR, { revealed: false }),
  id: AGENT_ID,
  inPlayAtTurnStart: false,
  remainingActions: 0,
});

/**
 * Build an M/H state: PLAYER_1 (resource, hero by default) is active; PLAYER_2
 * (hazard, minion) holds Nobody's Friend. Caller supplies the hazard player's
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
        hand: [NOBODYS_FRIEND],
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

/** Play Nobody's Friend as mode 1 (permanent-event) on the face-down agent, resolving the chain. */
const playMode1 = (state: GameState): GameState => {
  const cardId = findHandCardId(state, HAZARD_PLAYER, NOBODYS_FRIEND);
  const play = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
    const act = a.action as PlayHazardAction;
    return act.cardInstanceId === cardId && act.altEventMode === 'permanent-event' && act.targetAgentId === AGENT_ID;
  });
  expect(play).toBeDefined();
  return resolveChain(dispatch(state, play!.action));
};

describe("Nobody's Friend (dm-76)", () => {
  beforeEach(() => resetMint());

  describe('mode 1 — permanent-event on a face-down agent (reveal-site override)', () => {
    test('a face-down agent brought into play this turn reveals only at its printed home site (baseline)', () => {
      const state = buildState({
        agents: () => [faceDownDrorThisTurn()],
        hazardSiteDeck: [BLUE_MOUNTAIN_DWARF_HOLD, EDORAS_MINION, DALE_MINION],
      });
      // Without Nobody's Friend attached: only the printed home is offered.
      expect(new Set(revealSiteDefs(state))).toEqual(new Set([BLUE_MOUNTAIN_DWARF_HOLD]));
    });

    test('is playable on the face-down agent (permanent-event mode)', () => {
      const state = buildState({ agents: () => [faceDownDrorThisTurn()], hazardSiteDeck: [BLUE_MOUNTAIN_DWARF_HOLD] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, NOBODYS_FRIEND);
      const play = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'permanent-event';
      });
      expect(play).toBeDefined();
      expect((play!.action as PlayHazardAction).targetAgentId).toBe(AGENT_ID);
    });

    test('once attached, the agent may be revealed at ANY Border-hold/Free-hold in the location deck', () => {
      const state = buildState({
        agents: () => [faceDownDrorThisTurn()],
        hazardSiteDeck: [BLUE_MOUNTAIN_DWARF_HOLD, EDORAS_MINION, DALE_MINION],
      });
      const after = playMode1(state);

      // Nobody's Friend is in play, bound to the agent.
      const inPlay = after.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === NOBODYS_FRIEND);
      expect(inPlay).toBeDefined();
      expect(inPlay!.attachedToAgentId).toBe(AGENT_ID);

      // Reveal choices are broadened to both free-holds and the border-hold.
      expect(new Set(revealSiteDefs(after))).toEqual(new Set([BLUE_MOUNTAIN_DWARF_HOLD, EDORAS_MINION, DALE_MINION]));
    });

    test('the broadening does not apply when the agent\'s home site is not a Border-hold/Free-hold', () => {
      // Anarin's home is Moria, a minion SHADOW-HOLD — not a border/free-hold.
      const state = buildState({
        agents: () => [{
          ...makeAgent(ANARIN, { revealed: false }),
          id: AGENT_ID, inPlayAtTurnStart: false, remainingActions: 0,
        }],
        hazardSiteDeck: [MORIA_MINION, EDORAS_MINION, DALE_MINION],
      });
      const after = playMode1(state);
      // Only the printed home (Moria) is a legal reveal site — no broadening.
      expect(new Set(revealSiteDefs(after))).toEqual(new Set([MORIA_MINION]));
    });

    test('revealing the agent discards Nobody\'s Friend ("Discard when the agent is revealed")', () => {
      const state = buildState({
        agents: () => [faceDownDrorThisTurn()],
        hazardSiteDeck: [BLUE_MOUNTAIN_DWARF_HOLD, EDORAS_MINION, DALE_MINION],
      });
      const after = playMode1(state);

      // Reveal at Dale — a site only legal because of the override.
      const reveal = viableActions(after, PLAYER_2, 'reveal-agent').find(a => {
        const inst = (a.action as { homeSiteInstanceId?: CardInstanceId }).homeSiteInstanceId;
        return after.players[HAZARD_PLAYER].siteDeck.find(s => s.instanceId === inst)?.definitionId === DALE_MINION;
      });
      expect(reveal).toBeDefined();
      const revealed = dispatch(after, reveal!.action);

      const agent = revealed.players[HAZARD_PLAYER].agents[0];
      expect(agent.revealed).toBe(true);
      expect(agent.siteStack[agent.siteStack.length - 1].definitionId).toBe(DALE_MINION);

      // Nobody's Friend is no longer in play — it was discarded on reveal.
      expect(revealed.players[HAZARD_PLAYER].cardsInPlay.some(c => c.definitionId === NOBODYS_FRIEND)).toBe(false);
      expect(revealed.players[HAZARD_PLAYER].discardPile.some(c => c.definitionId === NOBODYS_FRIEND)).toBe(true);
      assertEveryInstanceReachable(revealed);
    });

    test('not offered on an agent that was already in play at the start of the turn', () => {
      const state = buildState({
        agents: () => [{ ...makeAgent(DROR, { revealed: false }), id: AGENT_ID, inPlayAtTurnStart: true }],
        hazardSiteDeck: [BLUE_MOUNTAIN_DWARF_HOLD],
      });
      const cardId = findHandCardId(state, HAZARD_PLAYER, NOBODYS_FRIEND);
      const perm = viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'permanent-event';
      });
      expect(perm).toHaveLength(0);
    });

    test('not offered on a revealed (face-up) agent', () => {
      const state = buildState({
        agents: () => [{ ...makeAgent(DROR, { revealed: true }), id: AGENT_ID, inPlayAtTurnStart: false }],
        hazardSiteDeck: [BLUE_MOUNTAIN_DWARF_HOLD],
      });
      const cardId = findHandCardId(state, HAZARD_PLAYER, NOBODYS_FRIEND);
      const perm = viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'permanent-event';
      });
      expect(perm).toHaveLength(0);
    });
  });

  describe('mode 2 — short-event tutor', () => {
    test('offered as a short-event when a matching agent is in the play deck', () => {
      const state = buildState({ hazardPlayDeck: [DROR, CAVE_DRAKE] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, NOBODYS_FRIEND);
      const short = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'short-event';
      });
      expect(short).toBeDefined();
    });

    test('short-event mode is non-viable when no matching agent is in the deck', () => {
      // Anarin (Moria = minion shadow-hold) does not qualify.
      const state = buildState({ hazardPlayDeck: [ANARIN, CAVE_DRAKE] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, NOBODYS_FRIEND);
      const short = viableActions(state, PLAYER_2, 'play-hazard').filter(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'short-event' && a.viable;
      });
      expect(short).toHaveLength(0);
    });

    test('resolving it lets the hazard player fetch only a matching agent from the play deck', () => {
      const state = buildState({ hazardPlayDeck: [DROR, ANARIN, CAVE_DRAKE] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, NOBODYS_FRIEND);
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

      // Only Drór (Blue Mountain Dwarf-hold = minion free-hold) is a legal fetch target.
      const fetches = viableActions(resolved, PLAYER_2, 'fetch-from-pile');
      const fetchDefs = fetches.map(a => {
        const inst = (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId;
        return resolved.players[HAZARD_PLAYER].playDeck.find(c => c.instanceId === inst)?.definitionId;
      });
      expect(fetchDefs).toContain(DROR);
      expect(fetchDefs).not.toContain(ANARIN);
      expect(fetchDefs).not.toContain(CAVE_DRAKE);
    });

    test('fetching takes the agent to hand, reveals it to the opponent, and reshuffles the deck', () => {
      const state = buildState({ hazardPlayDeck: [DROR, ANARIN, CAVE_DRAKE] });
      const drorId = state.players[HAZARD_PLAYER].playDeck.find(c => c.definitionId === DROR)!.instanceId;
      const cardId = findHandCardId(state, HAZARD_PLAYER, NOBODYS_FRIEND);
      const short = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'short-event';
      });
      let s = resolveChain(dispatch(state, short!.action));

      const fetch = viableActions(s, PLAYER_2, 'fetch-from-pile').find(a =>
        (a.action as { cardInstanceId: CardInstanceId }).cardInstanceId === drorId,
      );
      expect(fetch).toBeDefined();
      s = dispatch(s, fetch!.action);

      const hazard = s.players[HAZARD_PLAYER];
      // Drór is now in hand and revealed to the opponent.
      expect(hazard.hand.some(c => c.instanceId === drorId)).toBe(true);
      expect(s.revealedInstances[drorId]).toBe(DROR);
      // The two non-fetched cards remain in the (reshuffled) deck; none disappeared.
      expect(hazard.playDeck.map(c => c.definitionId).sort()).toEqual([ANARIN, CAVE_DRAKE].sort());
      // The spent event is in the discard pile.
      expect(hazard.discardPile.some(c => c.definitionId === NOBODYS_FRIEND)).toBe(true);
      expect(hazard.hand.some(c => c.definitionId === NOBODYS_FRIEND)).toBe(false);
      assertEveryInstanceReachable(s);
    });

    test('the hazard player may decline the fetch (pass), leaving the deck intact', () => {
      const state = buildState({ hazardPlayDeck: [DROR, CAVE_DRAKE] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, NOBODYS_FRIEND);
      const short = viableActions(state, PLAYER_2, 'play-hazard').find(a => {
        const act = a.action as PlayHazardAction;
        return act.cardInstanceId === cardId && act.altEventMode === 'short-event';
      });
      let s = resolveChain(dispatch(state, short!.action));
      s = dispatch(s, { type: 'pass', player: PLAYER_2 });

      const hazard = s.players[HAZARD_PLAYER];
      expect(s.pendingEffects).toHaveLength(0);
      // Nothing fetched; both cards remain in the deck.
      expect(hazard.playDeck.map(c => c.definitionId).sort()).toEqual([CAVE_DRAKE, DROR].sort());
      expect(hazard.discardPile.some(c => c.definitionId === NOBODYS_FRIEND)).toBe(true);
      assertEveryInstanceReachable(s);
    });
  });

  describe('minion-opponent restriction (both modes)', () => {
    test('mode 1 is not playable when the opponent is a minion player', () => {
      const state = buildState({
        resourceAlignment: Alignment.Ringwraith,
        agents: () => [faceDownDrorThisTurn()],
        hazardSiteDeck: [BLUE_MOUNTAIN_DWARF_HOLD],
      });
      const cardId = findHandCardId(state, HAZARD_PLAYER, NOBODYS_FRIEND);
      const viable = viableActions(state, PLAYER_2, 'play-hazard').filter(a =>
        (a.action as PlayHazardAction).cardInstanceId === cardId && a.viable,
      );
      expect(viable).toHaveLength(0);
    });

    test('mode 2 is not playable when the opponent is a minion player', () => {
      const state = buildState({
        resourceAlignment: Alignment.Ringwraith,
        hazardPlayDeck: [DROR],
      });
      const cardId = findHandCardId(state, HAZARD_PLAYER, NOBODYS_FRIEND);
      const viable = viableActions(state, PLAYER_2, 'play-hazard').filter(a =>
        (a.action as PlayHazardAction).cardInstanceId === cardId && a.viable,
      );
      expect(viable).toHaveLength(0);
    });
  });
});
