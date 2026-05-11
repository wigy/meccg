/**
 * @module state-agents
 *
 * Agent-in-play state types for the MECCG engine.
 *
 * Agents are special characters that the hazard player can play as free-roaming
 * hazards. Each agent acts like its own virtual company: it has a site, moves
 * around the map, and can attack companies that enter its site. Unlike regular
 * company characters, agents live in `PlayerState.agents`, not
 * `PlayerState.characters`, so influence accounting and follower machinery do
 * not apply to them.
 *
 * See the implementation plan at `specs/2026-04-22-agents-plan.md` and
 * CoE rules §4 for full agent rules.
 */

import type { CompanyId, CardInstanceId } from './common.js';
import type { CharacterInPlay, SiteInPlay } from './state-cards.js';

/**
 * A projected view of one of the opponent's agents, with hidden information
 * redacted.
 *
 * When the agent is face-down, the resource player cannot see the agent's
 * identity (character definition) or the exact sites in its stack — only
 * that there is a face-down agent with a certain number of accumulated sites.
 */
export interface OpponentAgentView {
  /** The agent's virtual-company id (reuses CompanyId so SelectCompanyAction can target it). */
  readonly id: CompanyId;
  /**
   * The agent character's instance ID. Hidden when the agent is face-down
   * (the resource player sees only the card-back).
   */
  readonly characterInstanceId: CardInstanceId | null;
  /** Whether the agent is revealed (face-up). When false, character identity is hidden. */
  readonly revealed: boolean;
  /**
   * Number of sites in the agent's stack. Visible to both players; lets the
   * resource player gauge how far the agent has traveled while face-down.
   */
  readonly siteStackSize: number;
  /** Whether the agent has no remaining actions this turn (derived from `remainingActions === 0`). */
  readonly actedThisTurn: boolean;
}

/**
 * Full in-play state of one agent hazard owned by a player.
 *
 * Agents are played face-down from hand as hazards. They move around the map
 * accumulating a stack of face-down sites. When revealed, only the top site
 * (the current position) is kept; the rest are returned to the site discard.
 *
 * An agent's virtual-company id is a real CompanyId so that the existing
 * `select-company` action can point to it without a discriminator.
 */
export interface AgentInPlay {
  /**
   * Identity of this agent as a virtual company.
   * Reuses CompanyId so SelectCompanyAction can target it without a new action type.
   */
  readonly id: CompanyId;
  /** The agent character instance. Not stored in player.characters to avoid GI/follower accounting. */
  readonly character: CharacterInPlay;
  /** Whether the agent is face-up (revealed) or face-down. */
  readonly revealed: boolean;
  /**
   * Stack of sites the agent has been placed at or moved through, oldest first.
   *
   * - Face-up: exactly one entry — the agent's current revealed site.
   * - Face-down: one or more entries; only the last (top) is the current site.
   *
   * Entries are SiteInPlay so their definitionId survives even while the
   * resource player's view treats them as "not in play" (rule 4.2.1).
   */
  readonly siteStack: readonly SiteInPlay[];
  /**
   * How many agent actions this agent may still take this turn.
   * Set to 0 when the agent is first played (cannot act the turn it enters play).
   * Reset each untap to `1 + extraAgentActions` where `extraAgentActions` is the
   * total from `extra-agent-actions` effects in play (e.g. Great Need or Purpose).
   * Decremented by 1 each time the agent takes an action. Gate: `> 0`.
   */
  readonly remainingActions: number;
  /**
   * True if the agent was already in play at the start of the current turn.
   * An agent freshly played this turn cannot take an agent action (rule 4.1).
   * Flipped to true during the untap reducer at the top of each turn.
   */
  readonly inPlayAtTurnStart: boolean;
  /**
   * True if the agent has already initiated an attack this site phase.
   * Agents may attack at most once per site phase (rule 2.V.iii.1).
   * Reset at the start of each site phase.
   */
  readonly attackedThisSitePhase: boolean;
  /**
   * True if the agent was revealed without a matching home site in the hazard
   * player's site deck (rule 9.04). Such agents are discarded at the end of
   * the turn — at the top of the untap phase before other reset logic.
   */
  readonly discardAtEndOfTurn: boolean;
}
