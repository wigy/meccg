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
  ResourceEventCard,
  OrganizationPhaseState,
  GameAction,
  PlayerState,
} from '../../index.js';
import { isCharacterCard, isResourceEventCard, CardStatus } from '../../index.js';
import type { PlayTargetEffect, PlayOptionEffect, Condition } from '../../types/effects.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { logDetail, logHeading } from './log.js';
import { resolveDef, collectCharacterEffects, resolveStatModifiers } from '../effects/index.js';
import { buildInPlayNames } from '../recompute-derived.js';
import { findPlayerAvatar } from '../reducer-utils.js';
import type { ResolverContext } from '../effects/index.js';
import { resolveInstanceId } from '../../types/state.js';
import { isRegressive } from '../reverse-actions.js';
import { playCharacterActions } from './organization-characters.js';
import { playPermanentEventActions, playShortEventActions } from './organization-events.js';
import {
  planMovementActions,
  moveToInfluenceActions,
  transferItemActions,
  storeItemActions,
  splitCompanyActions,
  moveToCompanyActions,
  mergeCompaniesActions,
} from './organization-companies.js';
import { fetchFromSideboardActions } from './organization-sideboard.js';

/**
 * Grant-action IDs that may be activated during any phase of the resource
 * player's turn per rule 2.1.1 (e.g. Cram's "Discard to untap bearer").
 */
export const ANY_PHASE_GRANT_ACTIONS: ReadonlySet<string> = new Set(['untap-bearer']);

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
  // to the Long-event phase. This step is entered implicitly when the
  // active player plays an end-of-org card during normal play-actions
  // (see reducer-organization.ts) — once entered, the player can chain
  // additional end-of-org plays but no further normal organization
  // actions.
  if (orgState.step === 'end-of-org') {
    logHeading(`Organization: end-of-org window — only end-of-org plays + pass are legal`);
    const endActions: EvaluatedAction[] = [];
    for (const handCard of player.hand) {
      const def = state.cardPool[handCard.definitionId as string];
      if (!def || def.cardType !== 'hero-resource-event') continue;
      if (!isEndOfOrgPlay(def)) continue;
      const eligibility = endOfOrgEligibility(state, player, def);
      if (!eligibility.eligible) {
        logDetail(`End-of-org: ${def.name} (${handCard.instanceId as string}) — ${eligibility.reason}`);
        continue;
      }
      logDetail(`End-of-org: ${def.name} (${handCard.instanceId as string}) is a registered end-of-org play`);
      endActions.push({
        action: { type: 'play-short-event', player: playerId, cardInstanceId: handCard.instanceId },
        viable: true,
      });
    }
    endActions.push(...grantedActionActivations(state, playerId));
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

  // Play resource short-events from hand (e.g. Smoke Rings, Stealth,
  // Marvels Told). Per CoE 2.1.1, resource short-events are playable during
  // any phase of the active player's turn unless a rule or effect restricts
  // them. The helper skips hand cards whose play-window restricts them to
  // a different phase, and cards already evaluated as characters.
  const resourceShortEventEvaluated = playResourceShortEventActions(
    state, playerId, evaluatedInstances, 'organization',
  );
  actions.push(...resourceShortEventEvaluated);
  const resourceShortEventInstances = new Set(
    resourceShortEventEvaluated
      .map(ea => (ea.action as { cardInstanceId?: CardInstanceId }).cardInstanceId as string | undefined)
      .filter((id): id is string => typeof id === 'string'),
  );

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

  // Store-item actions (store items at matching sites)
  actions.push(...storeItemActions(state, playerId));

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
 * - `untap-bearer` — discard an item to untap its bearer. Bearer must be
 *   tapped.
 * - `extra-region-movement` — discard an item during organization to grant
 *   the bearer's company +1 max region distance for movement this turn.
 */
export function grantedActionActivations(state: GameState, playerId: PlayerId, allowedActionIds?: ReadonlySet<string>): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];

  for (const [charIdStr, char] of Object.entries(player.characters)) {
    const charId = charIdStr as unknown as CardInstanceId;

    // Collect grant-action effects from hazards attached to this character
    for (const hazard of char.hazards) {
      const grantActions = extractGrantActions(state, hazard.definitionId);
      for (const effect of grantActions) {
        const hazardDef = state.cardPool[hazard.definitionId as string];
        const isCorruptionRemoval = effect.action === 'remove-self-on-roll'
          && hazardDef?.cardType === 'hazard-corruption';
        // METD §7 / rule 10.08: once a no-tap removal attempt has been
        // made on this character+corruption-card pair, no further
        // attempts (tap or no-tap) are allowed for the rest of the turn.
        const removalLocked = isCorruptionRemoval && state.activeConstraints.some(c =>
          c.kind.type === 'corruption-removal-locked'
          && c.kind.characterId === charId
          && c.kind.corruptionInstanceId === hazard.instanceId,
        );
        if (removalLocked) {
          const charDef = state.cardPool[char.definitionId as string];
          logDetail(`Grant-action ${effect.action} on ${hazardDef?.name ?? '?'}: ${charDef?.name ?? '?'} corruption-removal locked this turn`);
          continue;
        }

        // Check cost: if tap is "bearer", character must be untapped
        if (effect.cost.tap === 'bearer' && char.status !== CardStatus.Untapped) {
          const charDef = state.cardPool[char.definitionId as string];
          logDetail(`Grant-action ${effect.action} on ${hazardDef?.name ?? '?'}: ${charDef?.name ?? '?'} is tapped, cannot activate`);
          // Fall through to consider the no-tap variant below — the
          // character being tapped doesn't block it.
        } else if (effect.when) {
          const charDefForCtx = state.cardPool[char.definitionId as string];
          const charDefCard = charDefForCtx && isCharacterCard(charDefForCtx) ? charDefForCtx : undefined;
          const company = player.companies.find(c => c.characters.includes(charId));
          const ctx = buildGrantActionContext(state, char, charDefCard, company, player);
          if (!matchesCondition(effect.when, ctx)) {
            logDetail(`Grant-action ${effect.action}: when condition failed on ${charDefCard?.name ?? '?'}`);
            // Skip the standard variant below; do still consider no-tap.
          }
        }

        // Standard tap-and-roll variant — emitted only if the bearer
        // is untapped (cost.tap=bearer satisfied).
        if (!(effect.cost.tap === 'bearer' && char.status !== CardStatus.Untapped)) {
          const charDef = state.cardPool[char.definitionId as string];
          logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can tap to activate (source: ${hazardDef?.name ?? '?'})`);
          actions.push({
            action: {
              type: 'activate-granted-action',
              player: playerId,
              characterId: charId,
              sourceCardId: hazard.instanceId,
              sourceCardDefinitionId: hazard.definitionId,
              actionId: effect.action,
              rollThreshold: rollThresholdFor(effect),
            },
            viable: true,
          });
        }

        // METD §7 / rule 10.08: also offer the no-tap variant for
        // corruption-removal grant actions. Available regardless of
        // bearer's tap state; first use locks subsequent attempts.
        if (isCorruptionRemoval) {
          const charDef = state.cardPool[char.definitionId as string];
          logDetail(`Grant-action ${effect.action}-no-tap available: ${charDef?.name ?? '?'} may roll without tapping at -3 (source: ${hazardDef?.name ?? '?'})`);
          actions.push({
            action: {
              type: 'activate-granted-action',
              player: playerId,
              characterId: charId,
              sourceCardId: hazard.instanceId,
              sourceCardDefinitionId: hazard.definitionId,
              actionId: effect.action,
              rollThreshold: rollThresholdFor(effect),
              noTap: true,
            },
            viable: true,
          });
        }
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
                  rollThreshold: rollThresholdFor(effect),
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
              rollThreshold: rollThresholdFor(effect),
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
        const charDefForCtx = state.cardPool[char.definitionId as string];
        const charDefCard = charDefForCtx && isCharacterCard(charDefForCtx) ? charDefForCtx : undefined;
        const company = player.companies.find(c => c.characters.includes(charId));
        if (effect.when) {
          const ctx = buildGrantActionContext(state, char, charDefCard, company, player);
          if (!matchesCondition(effect.when, ctx)) {
            const def = state.cardPool[ally.definitionId as string];
            logDetail(`Grant-action ${effect.action}: when condition failed on ${charDefCard?.name ?? '?'} (source ${def?.name ?? '?'})`);
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
            rollThreshold: rollThresholdFor(effect),
          },
          viable: true,
        });
      }
    }

    // Scan items attached to this character for grant-action effects
    for (const item of char.items) {
      const grantActions = extractGrantActions(state, item.definitionId);
      for (const effect of grantActions) {
        if (effect.cost.tap === 'self' && item.status !== CardStatus.Untapped) {
          const def = state.cardPool[item.definitionId as string];
          logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: item is tapped, cannot activate`);
          continue;
        }
        if (effect.cost.tap === 'bearer' && char.status !== CardStatus.Untapped) {
          const def = state.cardPool[item.definitionId as string];
          logDetail(`Grant-action ${effect.action} on ${def?.name ?? '?'}: bearer ${charDef?.name ?? '?'} is tapped, cannot activate`);
          continue;
        }

        const charDefForCtx = state.cardPool[char.definitionId as string];
        const charDefCard = charDefForCtx && isCharacterCard(charDefForCtx) ? charDefForCtx : undefined;
        const company = player.companies.find(c => c.characters.includes(charId));
        if (effect.when) {
          const ctx = buildGrantActionContext(state, char, charDefCard, company, player);
          if (!matchesCondition(effect.when, ctx)) {
            const def = state.cardPool[item.definitionId as string];
            logDetail(`Grant-action ${effect.action}: when condition failed on ${charDefCard?.name ?? '?'} (source ${def?.name ?? '?'})`);
            continue;
          }
        }

        const def = state.cardPool[item.definitionId as string];
        const costLabel = effect.cost.tap === 'self' ? 'tap' : 'discard';
        logDetail(`Grant-action ${effect.action} available: ${charDef?.name ?? '?'} can ${costLabel} ${def?.name ?? '?'} to activate`);

        actions.push({
          action: {
            type: 'activate-granted-action',
            player: playerId,
            characterId: charId,
            sourceCardId: item.instanceId,
            sourceCardDefinitionId: item.definitionId,
            actionId: effect.action,
            rollThreshold: rollThresholdFor(effect),
          },
          viable: true,
        });
      }
    }
  }

  if (allowedActionIds) {
    return actions.filter(a => allowedActionIds.has((a.action as { actionId?: string }).actionId ?? ''));
  }
  return actions;
}

/**
 * Builds the DSL context used to evaluate a grant-action effect's
 * {@link EffectBase.when} condition. Exposes `bearer` (the character
 * holding the source card) and `company` (the company that character
 * belongs to, with derived booleans for planned movement and extra
 * region distance).
 *
 * New grant-action preconditions should be expressed as DSL `when`
 * clauses against this context instead of hardcoded action-ID branches
 * in {@link grantedActionActivations}.
 */
function buildGrantActionContext(
  state: GameState,
  char: import('../../index.js').CharacterInPlay,
  charDef: import('../../index.js').CharacterCard | undefined,
  company: import('../../index.js').Company | undefined,
  player?: import('../../index.js').PlayerState,
): Record<string, unknown> {
  const statusStr = char.status === CardStatus.Untapped ? 'untapped'
    : char.status === CardStatus.Tapped ? 'tapped'
    : 'inverted';

  const canUsePalantir = charDef?.text?.includes('May tap to use a Palantír') ||
    char.items.some(item => {
      const itemDef = state.cardPool[item.definitionId as string];
      return itemDef && 'name' in itemDef && (itemDef as { name: string }).name === 'Align Palantír';
    });

  const bearer = {
    status: statusStr,
    name: charDef?.name ?? '',
    race: charDef?.race ?? '',
    skills: charDef?.skills ?? [],
    canUsePalantir: !!canUsePalantir,
  };
  const companyCtx = company ? {
    size: computeCompanySize(state, company),
    hasPlannedMovement: company.destinationSite !== null || !!company.specialMovement,
    hasExtraRegionDistance: !!company.extraRegionDistance,
  } : null;
  const playerCtx = player ? {
    playDeckSize: player.playDeck.length,
  } : null;
  return { bearer, company: companyCtx, player: playerCtx };
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
 * Resolve the effective 2d6 threshold for a roll-based granted action.
 * Cards migrated to the generic `apply: roll-then-apply` shape carry
 * the threshold on the apply; legacy cards still expose it as
 * `effect.rollThreshold`. Returns 0 for non-roll actions.
 */
function rollThresholdFor(effect: import('../../types/effects.js').GrantActionEffect): number {
  if (effect.rollThreshold !== undefined) return effect.rollThreshold;
  if (effect.apply?.type === 'roll-then-apply' && typeof effect.apply.threshold === 'number') {
    return effect.apply.threshold;
  }
  return 0;
}

/**
 * Returns true if the given resource event card declares itself as an
 * end-of-organization play (e.g. Stealth, with `play-window` phase
 * `organization`, step `end-of-org`).
 */
export function isEndOfOrgPlay(def: ResourceEventCard): boolean {
  const playWindow = def.effects?.find(
    e => e.type === 'play-window',
  ) as { phase?: string; step?: string } | undefined;
  return playWindow?.phase === 'organization' && playWindow.step === 'end-of-org';
}

/**
 * Result of an end-of-org play eligibility check. When `eligible` is
 * false, `reason` carries a UI-friendly explanation of why the card
 * cannot currently be played. When `eligible` is true and the card has
 * a `play-target` effect, `eligibleTargets` lists every valid target
 * (e.g. each untapped scout in a company under the size cap) so the
 * action emitter can produce one play action per target.
 */
interface EndOfOrgEligibility {
  readonly eligible: boolean;
  readonly reason: string;
  /** One entry per valid target character. Empty when the card has no play-target. */
  readonly eligibleTargets: readonly CardInstanceId[];
}

/**
 * Checks whether an end-of-org card's `play-target` constraints are
 * satisfied by the active player's current companies. Character targeting
 * is driven entirely by the card's DSL `filter` condition plus an
 * optional `maxCompanySize` — there are no per-card branches here.
 */
export function endOfOrgEligibility(
  state: GameState,
  player: PlayerState,
  def: ResourceEventCard,
): EndOfOrgEligibility {
  const playTarget: PlayTargetEffect | undefined = def.effects?.find(
    (e): e is PlayTargetEffect => e.type === 'play-target',
  );
  if (!playTarget) return { eligible: true, reason: '', eligibleTargets: [] };
  if (playTarget.target !== 'character' && playTarget.target !== 'company') {
    return { eligible: true, reason: '', eligibleTargets: [] };
  }

  // Company targeting: each untapped character across all companies is an
  // eligible "tapper". The constraint is placed on their company.
  if (playTarget.target === 'company') {
    const eligibleTargets: CardInstanceId[] = [];
    for (const company of player.companies) {
      for (const charInstId of company.characters) {
        const char = player.characters[charInstId as string];
        if (!char) continue;
        if (playTarget.cost?.tap === 'character' && char.status !== CardStatus.Untapped) continue;
        eligibleTargets.push(charInstId);
      }
    }
    if (eligibleTargets.length === 0) {
      return { eligible: false, reason: `${def.name} requires an untapped character in a company`, eligibleTargets: [] };
    }
    return { eligible: true, reason: '', eligibleTargets };
  }

  const eligibleTargets: CardInstanceId[] = [];
  let foundMatchingCharacter = false;
  for (const company of player.companies) {
    const matchesInCompany: CardInstanceId[] = [];
    for (const charInstId of company.characters) {
      const char = player.characters[charInstId as string];
      if (!char) continue;
      const charDef = state.cardPool[char.definitionId as string];
      if (!charDef || !isCharacterCard(charDef)) continue;
      if (playTarget.filter
          && !matchesCondition(playTarget.filter, buildTargetContext(state, char, player))) {
        continue;
      }
      matchesInCompany.push(charInstId);
    }
    if (matchesInCompany.length === 0) continue;
    foundMatchingCharacter = true;
    if (playTarget.maxCompanySize !== undefined) {
      const size = computeCompanySize(state, company);
      if (size > playTarget.maxCompanySize) continue;
    }
    eligibleTargets.push(...matchesInCompany);
  }
  if (eligibleTargets.length === 0) {
    if (!foundMatchingCharacter) {
      return { eligible: false, reason: `${def.name} requires a matching character`, eligibleTargets: [] };
    }
    return {
      eligible: false,
      reason: `${def.name} requires a company of size ≤ ${playTarget.maxCompanySize as number}`,
      eligibleTargets: [],
    };
  }
  return { eligible: true, reason: '', eligibleTargets };
}

/**
 * Returns the {@link PlayTargetEffect} for the given resource event card,
 * or undefined when the card does not declare one.
 */
export function getPlayTargetEffect(def: ResourceEventCard): PlayTargetEffect | undefined {
  return def.effects?.find((e): e is PlayTargetEffect => e.type === 'play-target');
}

/**
 * Collects all in-play card instance IDs across both players that match
 * the supplied `discard-in-play` filter. Searches both general in-play
 * cards ({@link PlayerState.cardsInPlay}, e.g. Eye of Sauron long-events,
 * non-attached permanent-events) and hazard cards attached to characters
 * (`character.hazards`, e.g. Foolish Words, Lure of the Senses). Without
 * the character-hazard pass, cards like Marvels Told would fail to
 * offer any attached hazard permanent-events as discard targets.
 */
export function collectDiscardInPlayTargets(
  state: GameState,
  filter: Condition,
): CardInstanceId[] {
  const targets: CardInstanceId[] = [];
  for (const p of state.players) {
    for (const c of p.cardsInPlay) {
      const cDef = state.cardPool[c.definitionId as string];
      if (cDef && matchesCondition(filter, cDef as unknown as Record<string, unknown>)) {
        targets.push(c.instanceId);
      }
    }
    for (const charId of Object.keys(p.characters)) {
      const char = p.characters[charId];
      for (const haz of char.hazards) {
        const hDef = state.cardPool[haz.definitionId as string];
        if (hDef && matchesCondition(filter, hDef as unknown as Record<string, unknown>)) {
          targets.push(haz.instanceId);
        }
      }
    }
  }
  return targets;
}

/**
 * Returns all {@link PlayOptionEffect}s declared on the given card.
 */
export function getPlayOptionEffects(def: ResourceEventCard): readonly PlayOptionEffect[] {
  return def.effects?.filter((e): e is PlayOptionEffect => e.type === 'play-option') ?? [];
}

/**
 * Maps a character's {@link CardStatus} to the string tokens used by
 * {@link PlayOptionEffect} `when` conditions.
 */
function statusToken(status: CardStatus): 'tapped' | 'untapped' | 'inverted' {
  switch (status) {
    case CardStatus.Tapped: return 'tapped';
    case CardStatus.Untapped: return 'untapped';
    case CardStatus.Inverted: return 'inverted';
  }
}

/**
 * Builds the matcher context used to evaluate a {@link PlayTargetEffect}'s
 * `filter` or a {@link PlayOptionEffect}'s `when` against a candidate
 * target character. The context exposes:
 *
 *  - `target.race`, `target.status`, `target.skills`, `target.name` —
 *    per-character attributes for filtering.
 *  - `target.inAvatarCompany` — `true` iff the character belongs to the
 *    same company as the player's avatar (wizard/ringwraith/etc.).
 *    Requires the `player` parameter to be passed.
 *  - `pending.corruptionCheckTargetsMe` — `true` iff a pending
 *    corruption-check resolution exists whose `characterId` matches
 *    the candidate. Enables reactive plays like Halfling Strength's
 *    `+4 corruption check boost` option to declare
 *    `when: { "pending.corruptionCheckTargetsMe": true }` and thereby
 *    satisfy the CoE "cannot play cards without effect" rule.
 *
 * Exported so legal-action computers in other windows (e.g. the
 * corruption-check pending-resolution window) can build the same
 * context shape when scanning a player's hand for reactive plays.
 */
export function buildPlayOptionContext(
  state: GameState,
  char: import('../../index.js').CharacterInPlay,
  player?: PlayerState,
): Record<string, unknown> {
  const def = state.cardPool[char.definitionId as string];
  if (!def || !isCharacterCard(def)) {
    return { target: {}, pending: { corruptionCheckTargetsMe: false } };
  }
  const corruptionCheckTargetsMe = state.pendingResolutions.some(
    r => r.kind.type === 'corruption-check' && r.kind.characterId === char.instanceId,
  );
  let inAvatarCompany = false;
  if (player) {
    const avatar = findPlayerAvatar(state, player);
    if (avatar) {
      const co = player.companies.find(c => c.characters.includes(avatar.instanceId));
      if (co && co.characters.includes(char.instanceId)) {
        inAvatarCompany = true;
      }
    }
  }
  return {
    target: {
      race: def.race,
      status: statusToken(char.status),
      skills: def.skills,
      name: def.name,
      mind: def.mind,
      inAvatarCompany,
    },
    pending: {
      corruptionCheckTargetsMe,
    },
    inPlay: buildInPlayNames(state),
  };
}

/** Legacy alias retained for call sites inside this module. */
function buildTargetContext(
  state: GameState,
  char: import('../../index.js').CharacterInPlay,
  player?: PlayerState,
): Record<string, unknown> {
  return buildPlayOptionContext(state, char, player);
}

/**
 * Enumerates candidate target character instance IDs for a
 * {@link PlayTargetEffect} with `target: "character"`. Applies the
 * optional DSL `filter` condition against each candidate's target
 * context — no per-card / per-keyword branches. Non-character targets
 * yield an empty list here; those are handled by dedicated play paths.
 *
 * When the play-target carries a tap cost (`cost.tap === 'character'`),
 * already-tapped characters are excluded — a tapped character cannot pay
 * the tap cost. Without this guard, cards like Marvels Told would be
 * offered with a tapped sage as the target.
 */
function eligiblePlayOptionTargets(
  state: GameState,
  player: PlayerState,
  playTarget: PlayTargetEffect,
): CardInstanceId[] {
  if (playTarget.target !== 'character') return [];
  const requiresUntapped = playTarget.cost?.tap === 'character';
  const out: CardInstanceId[] = [];
  for (const [charIdStr, char] of Object.entries(player.characters)) {
    const charDef = state.cardPool[char.definitionId as string];
    if (!charDef || !isCharacterCard(charDef)) continue;
    if (requiresUntapped && char.status !== CardStatus.Untapped) {
      logDetail(`Play-target rejects ${charDef.name} (${charIdStr}): status ${char.status} (tap cost requires untapped)`);
      continue;
    }
    if (playTarget.filter
        && !matchesCondition(playTarget.filter, buildTargetContext(state, char, player))) {
      continue;
    }
    out.push(charIdStr as unknown as CardInstanceId);
  }
  return out;
}

/**
 * Generates `play-short-event` actions for a card with {@link PlayOptionEffect}s.
 * One action per (target, option) pair whose `when` (if any) matches the
 * target context. The chosen option is carried on the action via
 * `optionId` so the reducer can dispatch generically via the option's
 * `apply` clause.
 */
function playOptionActionsForCard(
  state: GameState,
  player: PlayerState,
  playerId: PlayerId,
  cardInstanceId: CardInstanceId,
  def: { name: string },
  playTarget: PlayTargetEffect,
  options: readonly PlayOptionEffect[],
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];
  const hasTapCost = playTarget.cost?.tap === 'character';
  const targets = eligiblePlayOptionTargets(state, player, playTarget);
  for (const targetId of targets) {
    const char = player.characters[targetId as string];
    if (!char) continue;
    const charDef = state.cardPool[char.definitionId as string];
    const targetName = isCharacterCard(charDef) ? charDef.name : String(targetId);
    const ctx = buildTargetContext(state, char, player);
    for (const opt of options) {
      if (opt.when && !matchesCondition(opt.when, ctx)) {
        logDetail(`${def.name} on ${targetName}: option "${opt.id}" when-condition rejected`);
        continue;
      }
      logDetail(`${def.name} playable on ${targetName}: option "${opt.id}"`);
      actions.push({
        action: {
          type: 'play-short-event',
          player: playerId,
          cardInstanceId,
          targetCharacterId: targetId,
          optionId: opt.id,
          ...(hasTapCost ? { targetScoutInstanceId: targetId } : {}),
        },
        viable: true,
      });
    }
  }
  return actions;
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

/**
 * Evaluates hero-resource short-event cards in the active player's hand for
 * play in the given phase (CoE rule 2.1.1: resource short-events are legal
 * during any phase of the resource player's turn unless restricted by a
 * rule or effect).
 *
 * Skips cards already considered by an earlier pass (e.g. play-character
 * evaluation in organization) and cards whose `play-window` effect binds
 * them to a different phase. Emits `play-short-event` actions (one per
 * eligible target combination) and `not-playable` entries with a reason
 * for cards whose constraints cannot be satisfied.
 *
 * The returned actions all carry a `cardInstanceId` matching a hand card,
 * so callers can derive the evaluated set to skip duplicates in a final
 * catch-all loop.
 */
export function playResourceShortEventActions(
  state: GameState,
  playerId: PlayerId,
  alreadyEvaluated: ReadonlySet<string>,
  currentPhase: 'organization' | 'site',
): EvaluatedAction[] {
  const player = state.players.find(p => p.id === playerId);
  if (!player) return [];

  const actions: EvaluatedAction[] = [];
  const combatOnlyTypes = new Set(['cancel-attack', 'cancel-strike', 'halve-strikes', 'dodge-strike']);

  for (const handCard of player.hand) {
    const def = state.cardPool[handCard.definitionId as string];
    if (!isResourceEventCard(def) || def.eventType !== 'short') continue;
    if (alreadyEvaluated.has(handCard.instanceId as string)) continue;
    const playWindow = def.effects?.find(e => e.type === 'play-window') as { phase?: string; step?: string } | undefined;
    // Cards with a play-window restricting them to a different phase
    // are skipped — they'll be marked not-playable by the caller's
    // catch-all loop (or by fillNotPlayable in legal-actions/index.ts).
    if (playWindow && playWindow.phase !== currentPhase) continue;
    // End-of-org cards (e.g. Stealth) are playable during the normal
    // organization window: playing one implicitly transitions the engine
    // into the end-of-org sub-step (see reducer-organization.ts),
    // preventing any further normal org plays this turn. Mark them
    // not-playable with a reason if their play-target constraints aren't
    // met so the UI can explain why.
    if (playWindow?.step === 'end-of-org') {
      const eligibility = endOfOrgEligibility(state, player, def);
      if (!eligibility.eligible) {
        logDetail(`${def.name}: end-of-org card not eligible — ${eligibility.reason}`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId: handCard.instanceId },
          viable: false,
          reason: eligibility.reason,
        });
        continue;
      }

      // If the card has a play-target with a tap cost (e.g. Stealth taps a
      // scout), emit one play action per eligible target so the chosen
      // target can be tapped when the action is reduced. Otherwise emit
      // a single action with no target.
      const eoTarget = getPlayTargetEffect(def);
      if (eoTarget && eoTarget.cost?.tap === 'character' && eligibility.eligibleTargets.length > 0) {
        for (const targetId of eligibility.eligibleTargets) {
          logDetail(`Resource short-event playable (end-of-org, target ${targetId as string}): ${def.name} (${handCard.instanceId as string})`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId: handCard.instanceId,
              targetScoutInstanceId: targetId,
            },
            viable: true,
          });
        }
      } else {
        logDetail(`Resource short-event playable (end-of-org): ${def.name} (${handCard.instanceId as string})`);
        actions.push({
          action: { type: 'play-short-event', player: playerId, cardInstanceId: handCard.instanceId },
          viable: true,
        });
      }
      continue;
    }

    // Skip short events whose effects are only usable during combat
    // (e.g. Concealment's cancel-attack). These require an active attack.
    const hasEffects = def.effects && def.effects.length > 0;
    const allCombatOnly = hasEffects && def.effects.every(e => combatOnlyTypes.has(e.type));
    if (allCombatOnly) {
      logDetail(`${def.name}: combat-only short-event, not playable outside combat`);
      continue;
    }

    // Cards declaring `play-option` DSL effects (e.g. Halfling Strength):
    // enumerate (target, option) pairs, emitting one legal action per
    // combination whose option `when` matches the target's context.
    const playTarget = getPlayTargetEffect(def);
    const playOptions = getPlayOptionEffects(def);
    if (playOptions.length > 0 && playTarget) {
      const optionActions = playOptionActionsForCard(
        state, player, playerId, handCard.instanceId, def, playTarget, playOptions,
      );
      if (optionActions.length === 0) {
        logDetail(`${def.name}: no eligible ${playTarget.target} targets — not playable`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId: handCard.instanceId },
          viable: false,
          reason: `No eligible ${playTarget.target} to target`,
        });
      } else {
        actions.push(...optionActions);
      }
      continue;
    }

    // Collect eligible discard-in-play targets (e.g. Marvels Told forces
    // discard of a hazard non-environment permanent/long event). If the
    // card has a discard-in-play effect but no valid targets exist, it
    // cannot be played.
    const discardInPlay = def.effects?.find(e => e.type === 'discard-in-play');
    let discardTargetIds: CardInstanceId[] | null = null;
    if (discardInPlay) {
      discardTargetIds = collectDiscardInPlayTargets(state, discardInPlay.filter);
      if (discardTargetIds.length === 0) {
        logDetail(`${def.name}: no eligible discard-in-play target — not playable`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId: handCard.instanceId },
          viable: false,
          reason: `${def.name} has no valid target to discard`,
        });
        continue;
      }
    }

    // Emit one play action per eligible target combination. When the card
    // has a play-target with tap cost AND discard-in-play, emit the cross-
    // product of (tap target × discard target).
    const emitPlay = (tapTargetId: CardInstanceId | undefined) => {
      if (discardTargetIds) {
        for (const discardId of discardTargetIds) {
          logDetail(`Resource short-event playable (target ${String(tapTargetId)}, discard ${String(discardId)}): ${def.name}`);
          actions.push({
            action: {
              type: 'play-short-event',
              player: playerId,
              cardInstanceId: handCard.instanceId,
              ...(tapTargetId ? { targetScoutInstanceId: tapTargetId } : {}),
              discardTargetInstanceId: discardId,
            },
            viable: true,
          });
        }
      } else {
        logDetail(`Resource short-event playable${tapTargetId ? ` (target ${String(tapTargetId)})` : ''}: ${def.name}`);
        actions.push({
          action: {
            type: 'play-short-event',
            player: playerId,
            cardInstanceId: handCard.instanceId,
            ...(tapTargetId ? { targetScoutInstanceId: tapTargetId } : {}),
          },
          viable: true,
        });
      }
    };

    if (playTarget && playTarget.cost?.tap === 'character') {
      const tapTargets = eligiblePlayOptionTargets(state, player, playTarget);
      if (tapTargets.length === 0) {
        logDetail(`${def.name}: no eligible targets — not playable`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId: handCard.instanceId },
          viable: false,
          reason: `No eligible ${playTarget.target} to target`,
        });
      } else {
        for (const targetId of tapTargets) emitPlay(targetId);
      }
    } else {
      emitPlay(undefined);
    }
  }

  return actions;
}
