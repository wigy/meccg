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
import { isCharacterCard, CardStatus } from '../../index.js';
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

  // Pending corruption checks (transfer / wound / Lure) are now produced
  // and consumed via the unified pending-resolution system. The
  // resolution short-circuit in `legal-actions/index.ts` collapses the
  // menu to the corruption-check action before this function is reached,
  // so no per-phase short-circuit is needed here.

  // When sideboard sub-flow is active, only fetch actions (+ pass for discard) are legal
  if (orgState.sideboardFetchDestination !== null) {
    logHeading(`Sideboard sub-flow active (destination: ${orgState.sideboardFetchDestination})`);
    return fetchFromSideboardActions(state, playerId);
  }

  // End-of-organization play window: only short-events explicitly tagged as
  // end-of-org plays (e.g. Stealth) are legal here, plus `pass` to advance
  // to the Long-event phase. The active player has already taken their
  // normal organization actions.
  if (orgState.step === 'end-of-org') {
    logHeading(`Organization: end-of-org window — only end-of-org plays + pass are legal`);
    const endActions: EvaluatedAction[] = [];
    for (const handCard of player.hand) {
      const def = state.cardPool[handCard.definitionId as string];
      if (!def || def.cardType !== 'hero-resource-event') continue;
      const playWindow = def.effects?.find(
        e => e.type === 'play-window' && (e as { phase?: string; step?: string }).phase === 'organization' && (e as { phase?: string; step?: string }).step === 'end-of-org',
      );
      if (!playWindow) continue;
      logDetail(`End-of-org: ${def.name} (${handCard.instanceId as string}) is a registered end-of-org play`);
      endActions.push({
        action: { type: 'play-short-event', player: playerId, cardInstanceId: handCard.instanceId },
        viable: true,
      });
    }
    endActions.push({ action: { type: 'pass', player: playerId }, viable: true });
    return endActions;
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
    // Skip cards that declare a play-window restricting them to a
    // different sub-step (e.g. Stealth plays only at end-of-org).
    const playWindow = def.effects?.find(e => e.type === 'play-window') as { phase?: string; step?: string } | undefined;
    if (playWindow && (playWindow.phase !== 'organization' || playWindow.step !== 'play-actions')) {
      continue;
    }
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

  // Grant-action activations from attached hazards (e.g. Foolish Words removal)
  actions.push(...grantedActionActivations(state, playerId));

  actions.push({ action: { type: 'pass', player: playerId }, viable: true });
  return actions;
}

/**
 * Scans all characters owned by the player for `grant-action` effects
 * on their attached hazards, items, allies, and the character card itself.
 * Returns activate actions for each available granted ability whose
 * cost can be paid.
 *
 * Currently supports:
 * - `remove-self-on-roll` — character taps, rolls 2d6, on success the
 *   source card is discarded (e.g. Foolish Words).
 * - `test-gold-ring` — character taps to test a gold ring item in their
 *   company; rolls 2d6, gold ring is discarded (e.g. Gandalf).
 * - `gwaihir-special-movement` — discard the ally to grant the company
 *   special movement to any non-Shadow-land/Dark-domain/Under-deeps site.
 *   Requires company size ≤ 2.
 */
function grantedActionActivations(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];

  for (const [charIdStr, char] of Object.entries(player.characters)) {
    const charId = charIdStr as unknown as CardInstanceId;

    // Collect grant-action effects from hazards attached to this character
    for (const hazard of char.hazards) {
      const grantActions = extractGrantActions(state, hazard.definitionId);
      for (const effect of grantActions) {
        // Check cost: if tap is "bearer", character must be untapped
        if (effect.cost.tap === 'bearer' && char.status !== CardStatus.Untapped) {
          const charDef = state.cardPool[char.definitionId as string];
          const def = state.cardPool[hazard.definitionId as string];
          logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: ${charDef?.name ?? '?'} is tapped, cannot activate`);
          continue;
        }

        const charDef = state.cardPool[char.definitionId as string];
        const def = state.cardPool[hazard.definitionId as string];
        logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can tap to activate (source: ${def?.name ?? '?'})`);

        actions.push({
          action: {
            type: 'activate-granted-action',
            player: playerId,
            characterId: charId,
            sourceCardId: hazard.instanceId,
            sourceCardDefinitionId: hazard.definitionId,
            actionId: effect.action,
            rollThreshold: effect.rollThreshold ?? 0,
          },
          viable: true,
        });
      }
    }

    // Collect grant-action effects from the character card itself
    const charDef = state.cardPool[char.definitionId as string];
    if (charDef && 'effects' in charDef) {
      const charEffects = (charDef as { effects?: readonly import('../../types/effects.js').CardEffect[] }).effects;
      if (charEffects) {
        for (const effect of charEffects) {
          if (effect.type !== 'grant-action') continue;

          // Check cost: if tap is "self", the character must be untapped
          if (effect.cost.tap === 'self' && char.status !== CardStatus.Untapped) {
            logDetail(`Grant-action ${effect.action} on ${charDef.name}: character is tapped, cannot activate`);
            continue;
          }

          // For test-gold-ring: generate one action per gold ring in the company
          if (effect.action === 'test-gold-ring') {
            const goldRings = findGoldRingsInCompany(state, player, charId);
            if (goldRings.length === 0) {
              logDetail(`Grant-action test-gold-ring on ${charDef.name}: no gold ring items in company`);
              continue;
            }
            for (const ring of goldRings) {
              const ringDef = state.cardPool[ring.definitionId as string];
              logDetail(`Grant-action test-gold-ring available: ${charDef.name} can tap to test ${ringDef?.name ?? '?'}`);
              actions.push({
                action: {
                  type: 'activate-granted-action',
                  player: playerId,
                  characterId: charId,
                  sourceCardId: char.instanceId,
                  sourceCardDefinitionId: char.definitionId,
                  actionId: effect.action,
                  rollThreshold: effect.rollThreshold ?? 0,
                  targetCardId: ring.instanceId,
                },
                viable: true,
              });
            }
            continue;
          }

          // Generic character grant-action (future use)
          logDetail(`Grant-action ${effect.action} available: ${charDef.name} can activate`);
          actions.push({
            action: {
              type: 'activate-granted-action',
              player: playerId,
              characterId: charId,
              sourceCardId: char.instanceId,
              sourceCardDefinitionId: char.definitionId,
              actionId: effect.action,
              rollThreshold: effect.rollThreshold ?? 0,
            },
            viable: true,
          });
        }
      }
    }

    // Scan allies attached to this character for grant-action effects
    for (const ally of char.allies) {
      const grantActions = extractGrantActions(state, ally.definitionId);
      for (const effect of grantActions) {
        // Action-specific checks
        if (effect.action === 'gwaihir-special-movement') {
          // Gwaihir: company size must be ≤ 2
          const company = player.companies.find(c => c.characters.includes(charId));
          if (!company) continue;
          const companySize = computeCompanySize(state, company);
          if (companySize > 2) {
            const def = state.cardPool[ally.definitionId as string];
            logDetail(`Grant-action ${effect.action}: company size ${companySize} > 2, cannot activate ${def?.name ?? '?'}`);
            continue;
          }
          // Company must not already have planned movement or special movement
          if (company.destinationSite !== null || company.specialMovement) {
            const def = state.cardPool[ally.definitionId as string];
            logDetail(`Grant-action ${effect.action}: company already has movement planned, cannot activate ${def?.name ?? '?'}`);
            continue;
          }
        }

        const charDef = state.cardPool[char.definitionId as string];
        const def = state.cardPool[ally.definitionId as string];
        logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can discard ${def?.name ?? '?'} to activate`);

        actions.push({
          action: {
            type: 'activate-granted-action',
            player: playerId,
            characterId: charId,
            sourceCardId: ally.instanceId,
            sourceCardDefinitionId: ally.definitionId,
            actionId: effect.action,
            rollThreshold: effect.rollThreshold ?? 0,
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}

/**
 * Finds all gold ring items held by any character in the same company
 * as the given character.
 *
 * Returns an array of `{ instanceId, definitionId }` for each gold ring found.
 */
function findGoldRingsInCompany(
  state: GameState,
  player: { readonly companies: readonly import('../../index.js').Company[]; readonly characters: { readonly [key: string]: import('../../index.js').CharacterInPlay } },
  charId: CardInstanceId,
): readonly { instanceId: CardInstanceId; definitionId: import('../../index.js').CardDefinitionId }[] {
  // Find the company containing this character
  const company = player.companies.find(c => c.characters.includes(charId));
  if (!company) return [];

  const goldRings: { instanceId: CardInstanceId; definitionId: import('../../index.js').CardDefinitionId }[] = [];

  // Scan all characters in the company for gold ring items
  for (const compCharId of company.characters) {
    const compChar = player.characters[compCharId as string];
    if (!compChar) continue;
    for (const item of compChar.items) {
      const itemDef = state.cardPool[item.definitionId as string];
      if (itemDef && 'subtype' in itemDef && (itemDef as { subtype: string }).subtype === 'gold-ring') {
        goldRings.push({ instanceId: item.instanceId, definitionId: item.definitionId });
      }
    }
  }

  return goldRings;
}

/**
 * Extracts grant-action effects from a card definition.
 */
function extractGrantActions(state: GameState, definitionId: import('../../index.js').CardDefinitionId) {
  const def = state.cardPool[definitionId as string];
  if (!def || !('effects' in def)) return [];
  const effects = (def as { effects?: readonly import('../../types/effects.js').CardEffect[] }).effects;
  if (!effects) return [];
  return effects.filter(
    (e): e is import('../../types/effects.js').GrantActionEffect => e.type === 'grant-action',
  );
}

/**
 * Compute effective company size for grant-action checks.
 * Hobbits and orc scouts each count as half (rounded up for total).
 */
function computeCompanySize(state: GameState, company: import('../../index.js').Company): number {
  let halfCount = 0;
  let fullCount = 0;
  for (const charInstId of company.characters) {
    const defId = resolveInstanceId(state, charInstId);
    if (!defId) { fullCount++; continue; }
    const def = state.cardPool[defId as string];
    if (!def || !isCharacterCard(def)) { fullCount++; continue; }
    if (def.race === 'hobbit') {
      halfCount++;
    } else {
      fullCount++;
    }
  }
  return Math.ceil(fullCount + halfCount / 2);
}
