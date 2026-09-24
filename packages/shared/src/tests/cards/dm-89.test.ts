/**
 * @module dm-89.test
 *
 * Card test: Shadow out of the Dark (dm-89)
 * Type: hazard-event — permanent-event, non-unique
 * Effects: 2
 *   1. play-target — target: agent, filter: revealed AND (race ringwraith OR
 *      skills includes shadow-magic)
 *   2. agent-tap-grant-creature-keying — creatureFilter: race undead,
 *      excludeSiteTypes: [free-hold, haven], flag: "undead-keying-unlocked",
 *      hazardLimitExempt: true
 *
 * Card text: "Playable on a face-up agent who can use shadow-magic. If agent
 *  is revealed and not in a Free-hold [{F}] or Haven [{H}], he can tap to
 *  allow any Undead hazard creatures to be played at his site this turn. Any
 *  Undead hazard creatures so played do not count against the hazard limit.
 *  Cannot be played if your opponent is a minion player."
 *
 * Engine support:
 *  - `play-target: "agent"` gained an optional `filter` (movement-hazard.ts's
 *    agent-targeting branch), evaluated per candidate agent against
 *    `{ target: { name, race, skills, keywords, revealed } }` — `revealed`
 *    comes from the `AgentInPlay` instance, the rest from its card
 *    definition. The minion-opponent restriction is structural (shared by
 *    every `play-target: "agent"` card).
 *  - New `agent-tap-grant-creature-keying` effect (attached to the targeted
 *    agent via `attachedToAgentId`) grants a new agent tap ability — not an
 *    agent action (rule 4.1's option list is closed), so it doesn't consume
 *    `remainingActions` or a hazard slot. Offered
 *    (`agentTapGrantCreatureKeyingActions`) only while the agent is revealed,
 *    untapped, and its current site's effective type is not in
 *    `excludeSiteTypes`.
 *  - The tap (`handleAgentTapGrantCreatureKeying`, mh-agents.ts) installs a
 *    turn-scoped `site-flag` constraint ("undead-keying-unlocked", target:
 *    the hazard player) bound to the agent's current site's definition id.
 *  - `grantsCreatureKeying` (movement-hazard.ts) now also collects
 *    `agent-tap-grant-creature-keying` effects from `cardsInPlay` as a
 *    `site-flag`-kind grant: active only for the effect's own controller,
 *    and only once a matching `site-flag` constraint is active for a site
 *    with the *same name* as the target company's effective site (the
 *    agent's alignment-specific site card and the target company's
 *    opposite-alignment card for "the same" named location are different
 *    `CardDefinitionId`s, so the two sides are matched by name — mirroring
 *    `agentCurrentSiteName` / `companyTargetSiteName` elsewhere in the same
 *    module). A match both bypasses the creature's native `keyedTo` and (via
 *    `hazardLimitExempt`) exempts the play from the hazard limit, exactly
 *    like an in-play `grant-creature-keying` grant (Umagaur the Pale dm-112).
 *
 * The `race: "ringwraith"` half of the play-target filter mirrors the CoE
 * rule that a Ringwraith always counts as a shadow-magic user (see
 * `companyShadowMagicUsers` in reducer-utils.ts) but is not independently
 * exercised below: no agent-keyword card in the current pool has race
 * `ringwraith`, so there is no real fixture to drive that branch through
 * `computeLegalActions`.
 *
 * Playable: YES
 * Certified: 2026-09-24
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  PLAYER_1, PLAYER_2,
  ARAGORN,
  RIVENDELL,
  BARROW_WIGHT, CAVE_DRAKE,
  buildTestState, resetMint, mint, makeMHState, makeAgent,
  viableActions, viableActionsForHandCard, dispatch,
  findHandCardId, companyIdAt, phaseStateAs, resolveChain,
  assertEveryInstanceReachable,
  RESOURCE_PLAYER, HAZARD_PLAYER,
} from '../test-helpers.js';
import { Phase, CardStatus, Alignment, Race, SiteType } from '../../index.js';
import type {
  GameState, CardDefinitionId, CardInstanceId, CompanyId, AgentInPlay, CardInPlay,
  PlayHazardAction, MovementHazardPhaseState,
} from '../../index.js';

const SHADOW_OUT_OF_THE_DARK = 'dm-89' as CardDefinitionId;

// Minion agents (keyword "agent"):
const TALADHAN = 'dm-25' as CardDefinitionId; // shadow-magic skill; homesite: Sarn Goriwing, Dol Guldur
const ANARIN = 'dm-1' as CardDefinitionId;    // scout/diplomat — no shadow-magic

// Minion sites for the agent (le-*) and their same-named hero counterparts
// for the target company (tw-*) — two different CardDefinitionIds for "the
// same" real-world location, exactly the case the site-flag's name-based
// match is built for.
const CAMETH_BRIN_MINION = 'le-358' as CardDefinitionId; // border-hold
const CAMETH_BRIN_HERO = 'tw-379' as CardDefinitionId;   // border-hold
const RIVENDELL_MINION = 'as-160' as CardDefinitionId;   // free-hold — excluded site

const AGENT_ID = 'agent-dm89-taladhan' as CompanyId;
const ATTACHED_CARD_ID = 'dm89-on-taladhan' as CardInstanceId;

/** A revealed, untapped Taladhan agent at `site` (default: Cameth Brin, minion copy). */
const taladhanAgent = (opts?: {
  revealed?: boolean;
  status?: CardStatus;
  site?: CardDefinitionId;
  noSite?: boolean;
}): AgentInPlay => {
  const base = makeAgent(TALADHAN, { revealed: opts?.revealed ?? true });
  return {
    ...base,
    id: AGENT_ID,
    character: { ...base.character, status: opts?.status ?? CardStatus.Untapped },
    siteStack: opts?.noSite
      ? []
      : [{ instanceId: mint(), definitionId: opts?.site ?? CAMETH_BRIN_MINION, status: CardStatus.Untapped }],
  };
};

/** Shadow out of the Dark, attached to the Taladhan agent above. */
const attachedCard = (): CardInPlay => ({
  instanceId: ATTACHED_CARD_ID,
  definitionId: SHADOW_OUT_OF_THE_DARK,
  status: CardStatus.Untapped,
  attachedToAgentId: AGENT_ID,
});

describe('Shadow out of the Dark (dm-89)', () => {
  beforeEach(() => resetMint());

  // ─── play-target: face-up agent who can use shadow-magic ───────────────

  describe('play-target filter', () => {
    const buildPlayTargetState = (opts: {
      resourceAlignment?: Alignment;
      agents: () => AgentInPlay[];
    }): GameState => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            alignment: opts.resourceAlignment ?? Alignment.Wizard,
            companies: [{ site: RIVENDELL, characters: [ARAGORN] }],
            hand: [],
            siteDeck: [],
          },
          {
            id: PLAYER_2,
            alignment: Alignment.Ringwraith,
            companies: [{ site: RIVENDELL, characters: [] }],
            hand: [SHADOW_OUT_OF_THE_DARK],
            siteDeck: [],
          },
        ],
      });
      return {
        ...base,
        phaseState: makeMHState(),
        players: [
          base.players[RESOURCE_PLAYER],
          { ...base.players[HAZARD_PLAYER], agents: opts.agents() },
        ] as typeof base.players,
      };
    };

    test('is offered only on a face-up agent who can use shadow-magic', () => {
      const faceDown = { ...makeAgent(TALADHAN, { revealed: false }), id: 'agent-td-fd' as CompanyId };
      const faceUpNoMagic = { ...makeAgent(ANARIN, { revealed: true }), id: 'agent-an-fu' as CompanyId };
      const eligible = taladhanAgent({ revealed: true });
      const state = buildPlayTargetState({ agents: () => [eligible, faceDown, faceUpNoMagic] });

      const cardId = findHandCardId(state, HAZARD_PLAYER, SHADOW_OUT_OF_THE_DARK);
      const plays = viableActions(state, PLAYER_2, 'play-hazard').filter(a =>
        (a.action as PlayHazardAction).cardInstanceId === cardId,
      );
      const targeted = plays.map(a => (a.action as PlayHazardAction).targetAgentId);
      expect(targeted).toEqual([AGENT_ID]);
    });

    test('is not offered when the hazard player has no agents in play', () => {
      const state = buildPlayTargetState({ agents: () => [] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, SHADOW_OUT_OF_THE_DARK);
      const plays = viableActions(state, PLAYER_2, 'play-hazard').filter(a =>
        (a.action as PlayHazardAction).cardInstanceId === cardId,
      );
      expect(plays).toHaveLength(0);
    });

    test('is not playable when the opponent is a minion player', () => {
      const state = buildPlayTargetState({
        resourceAlignment: Alignment.Ringwraith,
        agents: () => [taladhanAgent({ revealed: true })],
      });
      const cardId = findHandCardId(state, HAZARD_PLAYER, SHADOW_OUT_OF_THE_DARK);
      const plays = viableActions(state, PLAYER_2, 'play-hazard').filter(a =>
        (a.action as PlayHazardAction).cardInstanceId === cardId,
      );
      expect(plays).toHaveLength(0);
    });

    test('resolving it attaches the card to the targeted agent via attachedToAgentId', () => {
      const state = buildPlayTargetState({ agents: () => [taladhanAgent({ revealed: true })] });
      const cardId = findHandCardId(state, HAZARD_PLAYER, SHADOW_OUT_OF_THE_DARK);
      const play = viableActions(state, PLAYER_2, 'play-hazard').find(a =>
        (a.action as PlayHazardAction).cardInstanceId === cardId
        && (a.action as PlayHazardAction).targetAgentId === AGENT_ID,
      );
      expect(play).toBeDefined();
      const after = resolveChain(dispatch(state, play!.action));

      const inPlay = after.players[HAZARD_PLAYER].cardsInPlay.find(c => c.definitionId === SHADOW_OUT_OF_THE_DARK);
      expect(inPlay).toBeDefined();
      expect(inPlay!.attachedToAgentId).toBe(AGENT_ID);
      assertEveryInstanceReachable(after);
    });
  });

  // ─── agent-tap-grant-creature-keying: when the tap is offered ──────────

  describe('agent-tap-grant-creature-keying legal-action gating', () => {
    const buildTapState = (opts?: {
      agentStatus?: CardStatus;
      agentRevealed?: boolean;
      agentSite?: CardDefinitionId;
      includeAttachedCard?: boolean;
    }): GameState => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          { id: PLAYER_1, companies: [{ site: RIVENDELL, characters: [ARAGORN] }], hand: [], siteDeck: [] },
          {
            id: PLAYER_2,
            alignment: Alignment.Ringwraith,
            companies: [{ site: RIVENDELL, characters: [] }],
            hand: [],
            siteDeck: [],
            cardsInPlay: opts?.includeAttachedCard === false ? [] : [attachedCard()],
          },
        ],
      });
      return {
        ...base,
        phaseState: makeMHState(),
        players: [
          base.players[RESOURCE_PLAYER],
          {
            ...base.players[HAZARD_PLAYER],
            agents: [taladhanAgent({
              revealed: opts?.agentRevealed,
              status: opts?.agentStatus,
              site: opts?.agentSite,
            })],
          },
        ] as typeof base.players,
      };
    };

    test('offered when the agent is revealed, untapped, and at a non-Free-hold/Haven site', () => {
      const state = buildTapState();
      expect(viableActions(state, PLAYER_2, 'agent-tap-grant-creature-keying')).toHaveLength(1);
    });

    test('not offered when the agent is tapped', () => {
      const state = buildTapState({ agentStatus: CardStatus.Tapped });
      expect(viableActions(state, PLAYER_2, 'agent-tap-grant-creature-keying')).toHaveLength(0);
    });

    test('not offered when the agent is face-down', () => {
      const state = buildTapState({ agentRevealed: false });
      expect(viableActions(state, PLAYER_2, 'agent-tap-grant-creature-keying')).toHaveLength(0);
    });

    test('not offered at a Free-hold site', () => {
      const state = buildTapState({ agentSite: RIVENDELL_MINION });
      expect(viableActions(state, PLAYER_2, 'agent-tap-grant-creature-keying')).toHaveLength(0);
    });

    test('not offered without the attached permanent event', () => {
      const state = buildTapState({ includeAttachedCard: false });
      expect(viableActions(state, PLAYER_2, 'agent-tap-grant-creature-keying')).toHaveLength(0);
    });

    // ─── Reducer: tapping ─────────────────────────────────────────────────

    test('tapping taps the agent, costs neither an agent action nor a hazard slot, and installs a turn-scoped site-flag constraint', () => {
      const state = buildTapState();
      const actions = viableActions(state, PLAYER_2, 'agent-tap-grant-creature-keying');
      expect(actions).toHaveLength(1);
      const after = dispatch(state, actions[0].action);

      const agent = after.players[HAZARD_PLAYER].agents.find(a => a.id === AGENT_ID)!;
      expect(agent.character.status).toBe(CardStatus.Tapped);
      expect(agent.remainingActions).toBe(1); // unchanged — not an agent action

      const ps = phaseStateAs<MovementHazardPhaseState>(after);
      expect(ps.hazardsPlayedThisCompany).toBe(0); // unchanged — not against the hazard limit

      expect(after.activeConstraints).toHaveLength(1);
      const [constraint] = after.activeConstraints;
      expect(constraint.kind).toEqual({
        type: 'site-flag',
        flag: 'undead-keying-unlocked',
        siteDefinitionId: CAMETH_BRIN_MINION,
      });
      expect(constraint.target).toEqual({ kind: 'player', playerId: PLAYER_2 });
      expect(constraint.scope).toEqual({ kind: 'turn' });
      assertEveryInstanceReachable(after);
    });
  });

  // ─── Downstream effect: Undead creature keying + hazard-limit exemption ─

  describe('creature-keying grant at the agent\'s site', () => {
    const buildDownstreamState = (opts?: {
      hazardsPlayedThisCompany?: number;
      hazardLimitAtReveal?: number;
    }): GameState => {
      const base = buildTestState({
        activePlayer: PLAYER_1,
        phase: Phase.MovementHazard,
        players: [
          {
            id: PLAYER_1,
            companies: [{ site: RIVENDELL, characters: [ARAGORN], destinationSite: CAMETH_BRIN_HERO }],
            hand: [],
            siteDeck: [],
          },
          {
            id: PLAYER_2,
            alignment: Alignment.Ringwraith,
            companies: [{ site: RIVENDELL, characters: [] }],
            hand: [BARROW_WIGHT, CAVE_DRAKE],
            siteDeck: [],
            cardsInPlay: [attachedCard()],
          },
        ],
      });
      return {
        ...base,
        phaseState: makeMHState({
          destinationSiteName: 'Cameth Brin',
          destinationSiteType: SiteType.BorderHold,
          hazardsPlayedThisCompany: opts?.hazardsPlayedThisCompany ?? 0,
          hazardLimitAtReveal: opts?.hazardLimitAtReveal ?? 4,
        }),
        players: [
          base.players[RESOURCE_PLAYER],
          { ...base.players[HAZARD_PLAYER], agents: [taladhanAgent()] },
        ] as typeof base.players,
      };
    };

    test('Barrow-wight (Undead) is not keyable at Cameth Brin (border-hold) before the agent taps', () => {
      const state = buildDownstreamState();
      expect(viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, BARROW_WIGHT)).toHaveLength(0);
    });

    test('after the agent taps, Barrow-wight becomes playable via keying-bypass and is flagged hazard-limit-exempt', () => {
      let state = buildDownstreamState({ hazardsPlayedThisCompany: 4, hazardLimitAtReveal: 4 }); // limit already reached
      const tapActions = viableActions(state, PLAYER_2, 'agent-tap-grant-creature-keying');
      expect(tapActions).toHaveLength(1);
      state = dispatch(state, tapActions[0].action);

      const plays = viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, BARROW_WIGHT);
      expect(plays.length).toBeGreaterThan(0);
      expect((plays[0].action as PlayHazardAction).keyedBy).toMatchObject({
        method: 'keying-bypass',
        value: Race.Undead,
        hazardLimitExempt: true,
      });
    });

    test('Cave-drake (Dragon) does not benefit from the grant even after the agent taps', () => {
      let state = buildDownstreamState();
      const tapActions = viableActions(state, PLAYER_2, 'agent-tap-grant-creature-keying');
      state = dispatch(state, tapActions[0].action);

      expect(viableActionsForHandCard(state, PLAYER_2, 'play-hazard', HAZARD_PLAYER, CAVE_DRAKE)).toHaveLength(0);
    });

    test('playing Barrow-wight through the grant does not increment hazardsPlayedThisCompany even at the hazard limit', () => {
      let state = buildDownstreamState({ hazardsPlayedThisCompany: 4, hazardLimitAtReveal: 4 });
      const tapActions = viableActions(state, PLAYER_2, 'agent-tap-grant-creature-keying');
      state = dispatch(state, tapActions[0].action);

      const companyId = companyIdAt(state, RESOURCE_PLAYER);
      const wightId = findHandCardId(state, HAZARD_PLAYER, BARROW_WIGHT);
      const after = dispatch(state, {
        type: 'play-hazard',
        player: PLAYER_2,
        cardInstanceId: wightId,
        targetCompanyId: companyId,
        keyedBy: { method: 'keying-bypass', value: Race.Undead, hazardLimitExempt: true },
      });

      const ps = phaseStateAs<MovementHazardPhaseState>(after);
      expect(ps.hazardsPlayedThisCompany).toBe(4); // unchanged — exempt

      const resolved = resolveChain(after);
      expect(resolved.combat).not.toBeNull();
      assertEveryInstanceReachable(resolved);
    });
  });
});
