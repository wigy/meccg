import type { GameAction, PlayerId, CardInstanceId, CardDefinitionId, CompanyId } from '@meccg/shared';

/**
 * Parse a text command into a GameAction.
 * Player ID is injected automatically.
 *
 * Supported formats:
 *   draft-pick <defId>
 *   draft-stop
 *   pass
 *   play-character <instId> <siteInstId>
 *   plan-movement <companyId> <siteInstId>
 *   play-hazard <instId> <companyId>
 *   play-hero-resource <instId> <companyId>
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
