/**
 * @module legal-actions/organization
 *
 * Legal actions during the organization phase. The active player can
 * reorganize companies, recruit characters, transfer items, and plan
 * movement for the upcoming movement/hazard phase.
 *
 * For play-character actions, every character card in the active player's
 * hand is evaluated against the CoE rules. A candidate action is generated
 * for each possible (site, controlledBy) combination. Non-viable candidates
 * carry a human-readable reason so the client can show why a character
 * cannot be played.
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  CardInstanceId,
  CharacterCard,
  HeroResourceEventCard,
  OrganizationPhaseState,
  GameAction,
} from '../../index.js';
import { isCharacterCard } from '../../index.js';
import { logDetail, logHeading } from './log.js';
import { resolveDef, collectCharacterEffects, resolveStatModifiers } from '../effects/index.js';
import type { ResolverContext } from '../effects/index.js';
import { resolveInstanceId } from '../../types/state.js';
import { isRegressive } from '../reverse-actions.js';
import { playCharacterActions } from './organization-characters.js';
import { playPermanentEventActions, playShortEventActions } from './organization-events.js';
import {
  planMovementActions,
  moveToInfluenceActions,
  transferItemActions,
  splitCompanyActions,
  moveToCompanyActions,
  mergeCompaniesActions,
} from './organization-companies.js';
import { fetchFromSideboardActions } from './organization-sideboard.js';

/**
 * Computes the available (unused) direct influence for a character in play,
 * optionally factoring in conditional DI bonuses against a specific target.
 *
 * A character's DI is their effectiveStats.directInfluence minus the sum
 * of mind values of all their followers. When a target character is specified,
 * conditional DI bonuses (e.g. Glorfindel's "+1 DI against Elves") are
 * resolved using an `influence-check` context.
 *
 * @param state - The full game state.
 * @param controllerInstanceId - The controlling character's instance ID.
 * @param player - The player who owns the controller.
 * @param targetDef - Optional target character definition for conditional DI resolution.
 */
export function availableDI(
  state: GameState,
  controllerInstanceId: CardInstanceId,
  player: { readonly characters: Readonly<Record<string, import('../../index.js').CharacterInPlay>> },
  targetDef?: CharacterCard,
): number {
  const controller = player.characters[controllerInstanceId as string];
  if (!controller) return 0;

  let usedDI = 0;
  for (const followerId of controller.followers) {
    const followerChar = player.characters[followerId as string];
    if (!followerChar) continue;
    const followerDef = resolveDef(state, followerChar.instanceId);
    if (isCharacterCard(followerDef) && followerDef.mind !== null) {
      usedDI += followerDef.mind;
    }
  }

  let baseDI = controller.effectiveStats.directInfluence;

  // When checking DI for a specific target, resolve conditional DI bonuses
  // (e.g. Glorfindel II "+1 DI against Elves" uses reason: "influence-check")
  if (targetDef) {
    const ctrlDef = resolveDef(state, controller.instanceId);
    if (ctrlDef && isCharacterCard(ctrlDef)) {
      const resolverCtx: ResolverContext = {
        reason: 'influence-check',
        bearer: {
          race: ctrlDef.race,
          skills: ctrlDef.skills,
          baseProwess: ctrlDef.prowess,
          baseBody: ctrlDef.body,
          baseDirectInfluence: ctrlDef.directInfluence,
          name: ctrlDef.name,
        },
        target: {
          name: targetDef.name,
          race: targetDef.race,
        },
      };
      const charEffects = collectCharacterEffects(state, controller, resolverCtx);
      const conditionalDI = resolveStatModifiers(charEffects, 'direct-influence', 0, resolverCtx);
      if (conditionalDI !== 0) {
        logDetail(`  DI bonus from influence-check effects: ${conditionalDI >= 0 ? '+' : ''}${conditionalDI} against ${targetDef.name} (${targetDef.race})`);
      }
      baseDI += conditionalDI;
    }
  }

  return baseDI - usedDI;
}

/**
 * Computes all legal actions during the organization phase.
 *
 * Returns {@link EvaluatedAction} items so that non-viable play-character
 * candidates carry a human-readable reason for the client to display.
 */
export function organizationActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  if (state.activePlayer !== playerId) {
    logDetail(`Not active player (active: ${state.activePlayer as string ?? 'null'}), no actions`);
    return [];
  }

  const orgState = state.phaseState as OrganizationPhaseState;

  // When a corruption check is pending (after item transfer), only that check is legal
  if (orgState.pendingCorruptionCheck !== null) {
    const charId = orgState.pendingCorruptionCheck.characterId;
    const transferredItemId = orgState.pendingCorruptionCheck.transferredItemId;
    const char = player.characters[charId as string];
    if (char) {
      const charDef = resolveDef(state, char.instanceId);
      const charName = isCharacterCard(charDef) ? charDef.name : '?';

      // Include CP from the transferred item (already moved to target character)
      const transferredDefId = resolveInstanceId(state, transferredItemId);
      const transferredDef = transferredDefId ? state.cardPool[transferredDefId as string] : undefined;
      const transferredCp = transferredDef && 'corruptionPoints' in transferredDef
        ? (transferredDef as { corruptionPoints: number }).corruptionPoints : 0;
      const cp = char.effectiveStats.corruptionPoints + transferredCp;

      const modifier = isCharacterCard(charDef) ? charDef.corruptionModifier : 0;

      // Include the transferred item in possessions (it's on the target but belongs to this check)
      const possessions: CardInstanceId[] = [
        transferredItemId,
        ...char.items.map(i => i.instanceId),
        ...char.allies.map(a => a.instanceId),
        ...char.hazards.map(h => h.instanceId),
      ];
      const ccNeed = cp + 1 - modifier;
      const ccParts = [`CP ${cp}`];
      if (modifier !== 0) ccParts.push(`modifier ${modifier >= 0 ? '+' : ''}${modifier}`);
      logDetail(`Pending corruption check for ${charName} (CP ${cp} incl. transferred item, modifier ${modifier >= 0 ? '+' : ''}${modifier}, ${possessions.length} possession(s)) after item transfer`);
      return [{
        action: {
          type: 'corruption-check',
          player: playerId,
          characterId: charId,
          corruptionPoints: cp,
          corruptionModifier: modifier,
          possessions,
          need: ccNeed,
          explanation: `Need roll > ${cp - modifier} (${ccParts.join(', ')})`,
        },
        viable: true,
      }];
    }
  }

  // When sideboard sub-flow is active, only fetch actions (+ pass for discard) are legal
  if (orgState.sideboardFetchDestination !== null) {
    logHeading(`Sideboard sub-flow active (destination: ${orgState.sideboardFetchDestination})`);
    return fetchFromSideboardActions(state, playerId);
  }

  const actions: EvaluatedAction[] = [];

  // Cancel movement for companies with planned destinations
  for (const company of player.companies) {
    if (company.destinationSite !== null) {
      logDetail(`Company ${company.id as string} has planned movement → can cancel`);
      const candidate: GameAction = {
        type: 'cancel-movement',
        player: playerId,
        companyId: company.id,
      };
      const regress = isRegressive(candidate, state.reverseActions);
      actions.push({
        action: { ...candidate, ...(regress ? { regress: true } : {}) } as GameAction,
        viable: true,
      });
    }
  }

  logDetail(`Organization: ${player.companies.length} company/companies, ${Object.keys(player.characters).length} character(s) in play`);

  // Play-character actions for each character card in hand
  const characterActions = playCharacterActions(state, playerId);
  actions.push(...characterActions);

  // Collect instance IDs that already have a play-character evaluation
  const evaluatedInstances = new Set(
    characterActions.map(ea =>
      (ea.action as { characterInstanceId: CardInstanceId }).characterInstanceId as string,
    ),
  );

  // Play permanent-event resource cards from hand
  const permanentEventActions = playPermanentEventActions(state, playerId);
  actions.push(...permanentEventActions);
  const permanentEventInstances = new Set(
    permanentEventActions.map(ea =>
      (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId as string,
    ),
  );

  // Play short-event cards as resource (e.g. Twilight cancels an environment)
  const shortEventActions = playShortEventActions(state, playerId);
  actions.push(...shortEventActions);
  const shortEventInstances = new Set(
    shortEventActions.map(ea =>
      (ea.action as { cardInstanceId: CardInstanceId }).cardInstanceId as string,
    ),
  );

  // Play resource short-events from hand (e.g. Smoke Rings)
  const resourceShortEventInstances = new Set<string>();
  for (const handCard of player.hand) {
    const def = state.cardPool[handCard.definitionId as string] as HeroResourceEventCard | undefined;
    if (!def || def.cardType !== 'hero-resource-event' || def.eventType !== 'short') continue;
    if (evaluatedInstances.has(handCard.instanceId as string)) continue;
    resourceShortEventInstances.add(handCard.instanceId as string);
    logDetail(`Resource short-event playable: ${def.name} (${handCard.instanceId as string})`);
    actions.push({
      action: { type: 'play-short-event', player: playerId, cardInstanceId: handCard.instanceId },
      viable: true,
    });
  }

  // Mark remaining hand cards as not playable during organization
  for (const handCard of player.hand) {
    if (evaluatedInstances.has(handCard.instanceId as string)) continue;
    if (permanentEventInstances.has(handCard.instanceId as string)) continue;
    if (shortEventInstances.has(handCard.instanceId as string)) continue;
    if (resourceShortEventInstances.has(handCard.instanceId as string)) continue;
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId: handCard.instanceId },
      viable: false,
      reason: 'Not playable during the organization',
    });
  }

  // Move-to-influence actions (reassign characters between GI and DI)
  actions.push(...moveToInfluenceActions(state, playerId));

  // Plan-movement actions for each company
  actions.push(...planMovementActions(state, playerId));

  // Transfer-item actions (move items between characters at the same site)
  actions.push(...transferItemActions(state, playerId));

  // Split-company actions (move GI character + followers to a new company)
  actions.push(...splitCompanyActions(state, playerId));

  // Move-to-company actions (move GI character + followers to an existing company at same site)
  actions.push(...moveToCompanyActions(state, playerId));

  // Merge-companies actions (join entire company into another at same site)
  actions.push(...mergeCompaniesActions(state, playerId));

  // Fetch-from-sideboard actions (tap avatar to bring cards from sideboard)
  actions.push(...fetchFromSideboardActions(state, playerId));

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  return actions;
}
