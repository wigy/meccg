/**
 * @module dm-28.test
 *
 * Card test: Lobelia Sackville-Baggins (dm-28)
 * Type: hazard-event (short) — Manifestation of Mistress Lobelia (dm-178). Agent.
 * Card DB (DM-28): unique, body 9, prowess 0, mind 3, DI 1, race "Hazard Agent",
 *   skills Scout, homesite Bag End / Bree, +1 kill MP.
 *
 * Card text:
 *   "Unique. Manifestation of Mistress Lobelia. Agent. +3 direct influence
 *    against Hobbits and Hobbit factions. May not move to any site other than
 *    Bree, Old Forest, The White Towers, or a site in The Shire."
 *
 * ── NOT CERTIFIED — engine gap (regression anchor) ─────────────────────────
 *
 * Lobelia is a `hazard-event` card that plays as an Agent. The engine deploys
 * agents ONLY from character cards carrying the `agent` keyword: the
 * `play-agent-hazard` legal-action generator filters candidates through
 * `isCharacterCard(def)` (see `legal-actions/movement-hazard.ts`
 * `playAgentHazardActions`). A short hazard-event has no prowess/body/mind for
 * agent combat and can never become an `AgentInPlay`.
 *
 * The other rules on the card are equally unreachable while deployment is
 * impossible:
 *   - "Manifestation of Mistress Lobelia" — the manifestation system is
 *     character-`manifestId` only and cannot span an event (dm-28) and a
 *     resource card (Mistress Lobelia, dm-178).
 *   - "+3 direct influence against Hobbits and Hobbit factions" — an agent DI
 *     modifier that is inert because the agent never enters play.
 *   - "May not move to any site other than Bree, Old Forest, The White
 *     Towers, or a site in The Shire" — there is no primitive for
 *     site-restricted agent movement.
 *
 * This is the identical engine-wide blocker as My Precious (dm-29). None of the
 * missing subsystems has a DSL effect type, so the card carries `effects: []`
 * and is NOT certified.
 *
 * This test is a regression anchor: it asserts that a real agent CHARACTER is
 * offered for `play-agent-hazard` in a given state, while the Lobelia EVENT in
 * the same hand is NOT — pinning down the event→agent deployment gap. Revisit
 * (and replace with positive coverage of deployment, the +3 DI modifier, and
 * the movement restriction) when event-based / Manifestation agent deployment
 * lands in the engine.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import {
  buildTestState, resetMint, makeMHState, viableActions,
  PLAYER_1, PLAYER_2, HAZARD_PLAYER,
} from '../test-helpers.js';
import {
  ARAGORN, LEGOLAS, BREE, LORIEN, RIVENDELL, MINAS_TIRITH,
} from '../../index.js';
import type { CardDefinitionId } from '../../index.js';
import { Phase } from '../../index.js';

/** Lobelia Sackville-Baggins — the hazard-event manifestation-agent under test. */
const LOBELIA = 'dm-28' as CardDefinitionId;
/** Bill Ferny — a genuine agent *character* card, used as the positive control. */
const BILL_FERNY = 'dm-3' as CardDefinitionId;

describe('Lobelia Sackville-Baggins (dm-28) — NOT CERTIFIED (event-based agent unsupported)', () => {
  beforeEach(() => resetMint());

  test('engine offers play-agent-hazard for a real agent character but NOT for the Lobelia event', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        // Hazard player holds a genuine agent character (Bill Ferny) and the
        // Lobelia event side by side.
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [BILL_FERNY, LOBELIA], siteDeck: [RIVENDELL] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }) };

    // Map each play-agent-hazard action back to the definition it would deploy.
    const handByInstance = new Map<string, CardDefinitionId>(
      withMH.players[HAZARD_PLAYER].hand.map((c) => [c.instanceId as string, c.definitionId]),
    );
    const deployedDefs = viableActions(withMH, PLAYER_2, 'play-agent-hazard')
      .map((a) => handByInstance.get((a.action as { agentCardInstanceId: string }).agentCardInstanceId))
      .filter((d): d is CardDefinitionId => d !== undefined);

    // The character form IS deployable...
    expect(deployedDefs).toContain(BILL_FERNY);
    // ...but the event form is NOT (no event→agent deployment path).
    expect(deployedDefs).not.toContain(LOBELIA);
  });

  test('the Lobelia event is not surfaced as any viable agent-deployment action', () => {
    const state = buildTestState({
      activePlayer: PLAYER_1,
      phase: Phase.MovementHazard,
      players: [
        { id: PLAYER_1, companies: [{ site: BREE, characters: [ARAGORN] }], hand: [], siteDeck: [MINAS_TIRITH] },
        { id: PLAYER_2, companies: [{ site: LORIEN, characters: [LEGOLAS] }], hand: [LOBELIA], siteDeck: [RIVENDELL] },
      ],
    });
    const withMH = { ...state, phaseState: makeMHState({ hazardLimitAtReveal: 4, hazardsPlayedThisCompany: 0 }) };

    // With only the event in hand there is no agent to deploy at all.
    expect(viableActions(withMH, PLAYER_2, 'play-agent-hazard')).toHaveLength(0);
  });
});
