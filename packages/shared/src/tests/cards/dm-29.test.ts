/**
 * @module dm-29
 *
 * Card: My Precious (dm-29)
 * Type: hazard-event (short), Unique
 * Effects: [] (none of its rules map to a supported DSL effect type)
 *
 * Text:
 *   "Unique. Manifestation of Gollum. Agent. If face-up, may take an extra
 *    agent action (not counting against the hazard limit) each time he
 *    normally takes an agent action. If he attacks successfully against a
 *    company with a ring, he and a ring (attacker's choice) are discarded.
 *    If My Precious attacks and fails but is not defeated, the defender may
 *    tap a character in the target company to play Gollum (My Precious is
 *    discarded). Any player whose character eliminates My Precious receives
 *    -1 kill MPs."
 *
 * ── NOT CERTIFIED ─────────────────────────────────────────────────────────
 * Every substantive rule on this card requires engine support that does not
 * exist. My Precious is a short *hazard-event* that plays as a Gollum
 * *Manifestation* which functions as an *Agent* — a form the engine has no
 * deployment path for. The missing subsystems are:
 *
 *   1. Event-based agent deployment. `play-agent-hazard` only deploys a
 *      *character* card carrying the `agent` keyword + a homesite (it calls
 *      `isCharacterCard(agentDef)` and matches the location deck against the
 *      character's homesite names). A short hazard-event cannot become an
 *      `AgentInPlay`; an event definition has no prowess/body/mind for agent
 *      combat. See `handlePlayAgentHazard` in `engine/mh-hazard-play.ts` and
 *      the `play-agent-hazard` emitter in `legal-actions/movement-hazard.ts`
 *      (which requires `def.keywords?.includes('agent')`).
 *   2. Cross-form Manifestation-of-Gollum gating. The manifestation system
 *      (`engine/manifestations.ts`, `manifestId`) works on *character* cards
 *      only; here the manifestations span an event (My Precious), and the
 *      allies Gollum (tw-246) / Stinker (le-154).
 *   3. A face-up-gated, self-only extra agent action. `extra-agent-actions`
 *      is a *global, unconditional* environment applied to every agent from
 *      `cardsInPlay`; there is no per-agent, face-up-conditional variant.
 *   4. A successful-attack trigger discarding the attacking agent and one ring
 *      (attacker's choice) from the defending company.
 *   5. A failed-but-not-defeated-attack, defender-reactive play: tap a
 *      character to bring Gollum (tw-246) into play and discard My Precious.
 *   6. A kill-MP modifier (−1 kill MPs to the eliminating player). No
 *      `kill-mp-modifier` effect type exists in the effect-type union.
 *
 * There are no valid DSL effect types for any of these, so `effects` stays
 * `[]`. This test documents the shape above and pins the concrete current
 * limitation with a real, engine-driven assertion (below), so it fails loudly
 * and needs revisiting once event-based agent deployment lands.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, viableActions,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
  ARAGORN, LEGOLAS,
  MORIA, LORIEN, RIVENDELL,
} from '../test-helpers.js';
import type { CardDefinitionId, CardInstanceId } from '../../index.js';
import { Phase } from '../../index.js';

const MY_PRECIOUS = 'dm-29' as CardDefinitionId; // hazard-event, "Agent" in text
const ANARIN = 'dm-1' as CardDefinitionId; // real agent character (homesite: Moria)

/** Definition id backing a play-agent-hazard action's agent instance. */
function defOfAgentAction(
  handCards: readonly { instanceId: CardInstanceId; definitionId: CardDefinitionId }[],
  agentCardInstanceId: CardInstanceId,
): CardDefinitionId | undefined {
  return handCards.find(c => c.instanceId === agentCardInstanceId)?.definitionId;
}

describe('My Precious (dm-29) — NOT CERTIFIED: no event-based agent deployment', () => {
  beforeEach(() => resetMint());

  test('the engine cannot play My Precious as an agent hazard (only true agent characters are offered)', () => {
    // Hazard player (P2) holds both a real agent character (Anarin, dm-1) and
    // My Precious (dm-29). During the M/H play-hazards step the engine should
    // offer to play the real agent as a hazard, but NOT the hazard-event —
    // there is no path to deploy an event as an agent.
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: MORIA, characters: [ARAGORN] }], hand: [], siteDeck: [] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [ANARIN, MY_PRECIOUS], siteDeck: [RIVENDELL] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }) };

    const hand = withMH.players[HAZARD_PLAYER].hand;
    const actions = viableActions(withMH, PLAYER_2, 'play-agent-hazard')
      .map(a => a.action)
      .filter((a): a is Extract<typeof a, { agentCardInstanceId: CardInstanceId }> => 'agentCardInstanceId' in a);

    const offeredDefs = actions.map(a => defOfAgentAction(hand, a.agentCardInstanceId));

    // Positive control: the real agent character IS offered.
    expect(offeredDefs).toContain(ANARIN);

    // The gap: My Precious (a hazard-event) is NOT deployable as an agent.
    expect(offeredDefs).not.toContain(MY_PRECIOUS);
  });
});
