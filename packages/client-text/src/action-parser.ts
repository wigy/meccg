/**
 * @module action-parser
 *
 * Translates human-typed text commands into strongly-typed {@link GameAction}
 * objects that the server's reducer can process.
 *
 * This is the console client's input layer — it splits a raw line of text
 * on whitespace, matches the first token against known action types, and
 * assembles the remaining tokens into the action's payload fields. The
 * player ID is always injected by the caller (the console client), not
 * typed by the user.
 *
 * If the input does not match any known command format, `null` is returned
 * so the caller can display a help message.
 */

import type { GameAction, PlayerId, CardInstanceId, CardDefinitionId, CompanyId } from '@meccg/shared';

/**
 * Parses a single line of user input into a {@link GameAction}.
 *
 * Supported command formats:
 * | Command                                  | Description                                 |
 * |------------------------------------------|---------------------------------------------|
 * | `draft-pick <defId>`                     | Pick a character during the draft phase      |
 * | `draft-stop`                             | Stop drafting (keep current selections)      |
 * | `pass`                                   | Pass priority in the current phase           |
 * | `play-character <instId> <siteInstId>`   | Play a character at a site                   |
 * | `plan-movement <companyId> <siteInstId>` | Plan a company's movement to a destination   |
 * | `play-hazard <instId> <companyId>`       | Play a hazard against an opponent's company  |
 * | `play-hero-resource <instId> <companyId>`| Play a resource card on a company            |
 * | `discard-card <instId>`                  | Discard a card from hand                     |
 * | `call-free-council`                      | Trigger the Free Council endgame             |
 *
 * @param input - Raw text from the user's terminal (e.g. "draft-pick tw-120").
 * @param playerId - The authenticated player ID to inject into the action.
 * @returns A typed {@link GameAction} or `null` if the input is unrecognised.
 */
export function parseAction(input: string, playerId: PlayerId): GameAction | null {
  const parts = input.trim().split(/\s+/);
  if (parts.length === 0) return null;

  const type = parts[0];

  switch (type) {
    case 'draft-pick':
      if (parts.length < 2) return null;
      return { type: 'draft-pick', player: playerId, characterDefId: parts[1] as CardDefinitionId };

    case 'draft-stop':
      return { type: 'draft-stop', player: playerId };

    case 'pass':
      return { type: 'pass', player: playerId };

    case 'play-character':
      if (parts.length < 3) return null;
      return {
        type: 'play-character',
        player: playerId,
        characterInstanceId: parts[1] as CardInstanceId,
        atSite: parts[2] as CardInstanceId,
        controlledBy: 'general',
      };

    case 'plan-movement':
      if (parts.length < 3) return null;
      return {
        type: 'plan-movement',
        player: playerId,
        companyId: parts[1] as CompanyId,
        destinationSite: parts[2] as CardInstanceId,
        regionPath: [],
        movementType: (parts[3] as 'starter' | 'region') ?? 'starter',
      };

    case 'play-hazard':
      if (parts.length < 3) return null;
      return {
        type: 'play-hazard',
        player: playerId,
        cardInstanceId: parts[1] as CardInstanceId,
        targetCompanyId: parts[2] as CompanyId,
      };

    case 'play-hero-resource':
      if (parts.length < 3) return null;
      return {
        type: 'play-hero-resource',
        player: playerId,
        cardInstanceId: parts[1] as CardInstanceId,
        companyId: parts[2] as CompanyId,
      };

    case 'discard-card':
      if (parts.length < 2) return null;
      return { type: 'discard-card', player: playerId, cardInstanceId: parts[1] as CardInstanceId };

    case 'call-free-council':
      return { type: 'call-free-council', player: playerId };

    default:
      return null;
  }
}
