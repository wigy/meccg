/**
 * @module legal-actions/site
 *
 * Legal actions during the site phase. Each company resolves its site
 * phase sequentially: the resource player selects which company goes
 * next, decides whether to enter the site, faces automatic attacks
 * and on-guard/agent attacks, then may play resources.
 *
 * CoE rules section 2.V (lines 340–393).
 */

import type { GameState, PlayerId, GameAction, EvaluatedAction, SitePhaseState, HeroItemCard, HeroResourceEventCard, SiteCard, PlayableAtEntry, FactionCard, DenyItemSiteRule, ItemPlaySiteEffect } from '../../index.js';
import { getPlayerIndex, isSiteCard, isItemCard, isAllyCard, isFactionCard, isCharacterCard, isAvatarCharacter, CardStatus, matchesCondition, GENERAL_INFLUENCE } from '../../index.js';
import { resolveInstanceId } from '../../types/state.js';
import { collectCharacterEffects, collectCompanyAllyEffects, resolveCheckModifier, resolveStatModifiers, normalizeCreatureRace } from '../effects/index.js';
import type { ResolverContext } from '../effects/index.js';
import { logDetail, logHeading } from './log.js';
import { availableDI, grantedActionActivations, ANY_PHASE_ONLY, playResourceShortEventActions } from './organization.js';
import { getActiveAutoAttacks } from '../manifestations.js';
import { buildControllerInPlayNames, buildFactionPlayableAt } from '../recompute-derived.js';

/**
 * Check whether a site satisfies a {@link PlayableAtEntry}.
 * Matches by exact site name (`site`) or by site type (`siteType`),
 * plus an optional `when` condition evaluated against a site context
 * exposing `site.name`, `site.siteType`, and `site.autoAttack.race`
 * (the array of normalized races across the site's automatic-attacks,
 * e.g. `["wolf", "troll"]`). Enables DSL entries like
 * `{ "siteType": "ruins-and-lairs", "when": { "site.autoAttack.race": "wolf" } }`.
 */
function siteMatchesEntry(siteDef: SiteCard, entry: PlayableAtEntry): boolean {
  const baseMatches = 'site' in entry
    ? siteDef.name === entry.site
    : siteDef.siteType === entry.siteType;
  if (!baseMatches) return false;
  if (!entry.when) return true;
  const autoAttackRaces = siteDef.automaticAttacks.map(a => normalizeCreatureRace(a.creatureType));
  const ctx: Record<string, unknown> = {
    site: {
      name: siteDef.name,
      siteType: siteDef.siteType,
      autoAttack: { race: autoAttackRaces },
    },
  };
  return matchesCondition(entry.when, ctx);
}

/** Wrap plain GameActions as viable EvaluatedActions. */
function viable(actions: GameAction[]): EvaluatedAction[] {
  return actions.map(action => ({ action, viable: true }));
}

/**
 * Compute legal actions for the site phase.
 *
 * Dispatches to the appropriate sub-step handler based on the current
 * site phase step.
 */
export function siteActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const isActive = state.activePlayer === playerId;
  const siteState = state.phaseState as SitePhaseState;

  logHeading(`Site phase (step: ${siteState.step}): player is ${isActive ? 'active (resource)' : 'non-active (hazard)'}`);

  // Wound corruption checks (Barrow-downs et al.) are now produced and
  // consumed via the unified pending-resolution system; the
  // resolution short-circuit in `legal-actions/index.ts` handles them
  // before this function is reached.

  if (siteState.step === 'select-company') {
    return viable(selectCompanyActions(state, playerId, siteState));
  }

  if (siteState.step === 'enter-or-skip') {
    return viable(enterOrSkipActions(state, playerId, siteState));
  }

  if (siteState.step === 'reveal-on-guard-attacks') {
    return viable(revealOnGuardAttacksActions(state, playerId, siteState));
  }

  if (siteState.step === 'automatic-attacks') {
    return viable(automaticAttacksActions(state, playerId));
  }

  if (siteState.step === 'declare-agent-attack') {
    return viable(declareAgentAttackActions(state, playerId));
  }

  if (siteState.step === 'resolve-attacks') {
    return viable(resolveAttacksActions(state, playerId));
  }

  if (siteState.step === 'play-resources') {
    // Opponent-influence-defend and on-guard-window are now produced
    // via the unified pending-resolution dispatcher in
    // `legal-actions/index.ts` before this function is reached.
    return playResourcesActions(state, playerId, siteState);
  }

  // TODO: play-minor-item

  if (!isActive) {
    logDetail(`Not active player, no site actions`);
    return [];
  }

  return viable([{ type: 'pass', player: playerId }]);
}

/**
 * Generate select-company actions for the site phase.
 *
 * The resource player picks which unhandled company resolves its site
 * phase next. Companies returned to their site of origin during M/H
 * are automatically skipped (CoE line 336). If only one company
 * remains, it is still offered as a choice for explicitness.
 */
function selectCompanyActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during select-company step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const handledSet = new Set(siteState.handledCompanyIds);

  const actions: GameAction[] = [];
  for (const company of player.companies) {
    if (handledSet.has(company.id)) {
      logDetail(`Company ${company.id} already handled — skipping`);
      continue;
    }
    logDetail(`Company ${company.id} not yet handled — offering select-company`);
    actions.push({ type: 'select-company', player: playerId, companyId: company.id });
  }

  logDetail(`${actions.length} unhandled company(ies) available for selection`);
  return actions;
}

/**
 * Generate enter-or-skip actions for the current company.
 *
 * The resource player decides whether to enter the site (facing attacks
 * and potentially playing resources) or do nothing (pass), which ends
 * that company's site phase immediately (CoE lines 341–343).
 */
function enterOrSkipActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during enter-or-skip step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];

  logDetail(`Company ${company.id}: offering enter-site and pass (do nothing)`);
  return [
    { type: 'enter-site', player: playerId, companyId: company.id },
    { type: 'pass', player: playerId },
  ];
}

/**
 * Reveal-on-guard-attacks step (CoE Step 1, line 345).
 *
 * The hazard player (non-active) may reveal on-guard creatures keyed
 * to the company's current site, or pass. If there are no on-guard
 * cards or no eligible creatures, only pass is offered.
 */
function revealOnGuardAttacksActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): GameAction[] {
  const isActive = state.activePlayer === playerId;

  // Only the hazard player (non-active) reveals on-guard cards
  if (isActive) {
    logDetail(`Active player waits during reveal-on-guard-attacks step`);
    return [];
  }

  const activeIndex = getPlayerIndex(state, state.activePlayer!);
  const resourcePlayer = state.players[activeIndex];
  const company = resourcePlayer.companies[siteState.activeCompanyIndex];

  const unrevealedCards = company ? company.onGuardCards.filter(og => !og.revealed) : [];
  if (!company || unrevealedCards.length === 0) {
    logDetail(`No unrevealed on-guard cards — pass to advance`);
    return [{ type: 'pass', player: playerId }];
  }

  // Look up the site definition for keying and auto-attack checks
  const siteDef = company.currentSite
    ? state.cardPool[company.currentSite.definitionId as string]
    : undefined;

  // Rule 2.V.i: creature reveals only allowed if the site has automatic-attacks
  const hasAutoAttacks = siteDef && isSiteCard(siteDef)
    && getActiveAutoAttacks(state, siteDef).length > 0;

  const actions: GameAction[] = [];

  for (const ogCard of company.onGuardCards) {
    if (ogCard.revealed) continue;
    const def = state.cardPool[ogCard.definitionId as string];
    if (!def) continue;

    if (def.cardType === 'hazard-creature') {
      if (!hasAutoAttacks) continue;

      // Check creature keying against the site
      if (siteDef && isSiteCard(siteDef)) {
        let keyable = false;
        for (const key of def.keyedTo) {
          if (key.siteTypes && key.siteTypes.includes(siteDef.siteType)) {
            logDetail(`On-guard creature "${def.name}" keyable by site-type: ${siteDef.siteType}`);
            keyable = true;
            break;
          }
          if (key.regionTypes && key.regionTypes.some(rt => siteDef.sitePath.includes(rt))) {
            logDetail(`On-guard creature "${def.name}" keyable by region-type in site path`);
            keyable = true;
            break;
          }
        }
        if (!keyable) {
          logDetail(`On-guard creature "${def.name}" not keyable to ${siteDef.name}`);
          continue;
        }
      }

      actions.push({
        type: 'reveal-on-guard',
        player: playerId,
        cardInstanceId: ogCard.instanceId,
      });
    } else if (def.cardType === 'hazard-event' && hasAutoAttacks) {
      // Rule 2.V.i: hazard events that affect automatic-attacks can be revealed here
      const affectsAutoAttacks = 'effects' in def && def.effects?.some(
        e => e.type === 'stat-modifier' && (e.target === 'all-automatic-attacks' || e.target === 'all-attacks'),
      );
      if (affectsAutoAttacks) {
        logDetail(`On-guard event "${def.name}" affects automatic-attacks — eligible for reveal`);
        actions.push({
          type: 'reveal-on-guard',
          player: playerId,
          cardInstanceId: ogCard.instanceId,
        });
      }
    }
  }

  if (actions.length > 0) {
    logDetail(`Reveal on-guard: ${actions.length} card(s) eligible for reveal`);
  } else {
    logDetail(`No eligible on-guard cards to reveal`);
  }

  // Always offer pass
  actions.push({ type: 'pass', player: playerId });
  return actions;
}

/**
 * Stub: automatic-attacks step (CoE Step 2, line 350).
 *
 * Each automatic attack listed on the site card triggers combat.
 * For now, only active player can pass.
 */
function automaticAttacksActions(
  state: GameState,
  playerId: PlayerId,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during automatic-attacks step`);
    return [];
  }
  logDetail(`Automatic attacks — pass to advance`);
  return [{ type: 'pass', player: playerId }];
}

// woundCorruptionCheckActions removed: wound corruption checks are
// now produced via the unified pending-resolution system. See
// `legal-actions/pending.ts` (corruptionCheckActions) and
// `engine/pending-reducers.ts` (applyCorruptionCheckResolution).

/**
 * Stub: declare-agent-attack step (CoE Step 3, line 358).
 *
 * The hazard player may declare an agent at the site will attack.
 * For now, only active player can pass.
 */
function declareAgentAttackActions(
  state: GameState,
  playerId: PlayerId,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during declare-agent-attack step`);
    return [];
  }
  logDetail(`Declare agent attack — pass to advance`);
  return [{ type: 'pass', player: playerId }];
}

/**
 * Stub: resolve-attacks step (CoE Step 4, line 361).
 *
 * On-guard creature and agent attacks are resolved in resource player's
 * chosen order. For now, only active player can pass.
 */
function resolveAttacksActions(
  state: GameState,
  playerId: PlayerId,
): GameAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during resolve-attacks step`);
    return [];
  }
  logDetail(`Resolve attacks — pass to advance`);
  return [{ type: 'pass', player: playerId }];
}

// onGuardRevealAtResourceActions removed: the on-guard reveal window
// is now produced via the unified pending-resolution dispatcher in
// `legal-actions/pending.ts:onGuardWindowActions`.

/**
 * Generate play-resources actions for the current company (CoE lines 362–374).
 *
 * After entering a site, the resource player may play resources. Each hand
 * card is evaluated for playability:
 * - Permanent resource events are playable (same rules as organization phase).
 * - Items (minor, major, greater) are playable if the site allows that subtype
 *   and there is an untapped character in the company to carry the item.
 * - All other cards are marked as not-playable with a reason.
 *
 * Pass is always available to end the company's site phase.
 */
function playResourcesActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
): EvaluatedAction[] {
  const isActive = state.activePlayer === playerId;
  if (!isActive) {
    logDetail(`Not active player — no actions during play-resources step`);
    return [];
  }

  const playerIndex = getPlayerIndex(state, playerId);
  const player = state.players[playerIndex];
  const company = player.companies[siteState.activeCompanyIndex];
  const actions: EvaluatedAction[] = [];

  // Look up the site's playable resource types
  const siteInstanceId = company.currentSite?.instanceId ?? null;
  const siteDefId = siteInstanceId ? resolveInstanceId(state, siteInstanceId) : undefined;
  const siteDef = siteDefId ? state.cardPool[siteDefId as string] : undefined;
  const playableTypes = siteDef && isSiteCard(siteDef) ? new Set(siteDef.playableResources) : new Set<string>();
  const siteName = siteDef?.name ?? 'unknown site';

  const siteIsTapped = company.currentSite?.status === CardStatus.Tapped;
  logDetail(`Site ${siteName}: playable resource types: ${[...playableTypes].join(', ') || 'none'}, tapped: ${siteIsTapped}`);

  // Find untapped characters in this company for item attachment
  const untappedCharacters = company.characters
    .map(cId => player.characters[cId as string])
    .filter(ch => ch !== undefined && ch.status === CardStatus.Untapped);

  logDetail(`Untapped characters in company: ${untappedCharacters.length}`);

  // Evaluate each hand card
  const evaluatedInstances = new Set<string>();

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = state.cardPool[handCard.definitionId as string];
    if (!def) continue;

    // Permanent resource events — playable like in organization phase
    if (def.cardType === 'hero-resource-event') {
      const eventDef: HeroResourceEventCard = def;
      if (eventDef.eventType === 'permanent') {
        evaluatedInstances.add(cardInstanceId as string);

        // Check uniqueness
        if (eventDef.unique) {
          const alreadyInPlay = state.players.some(p =>
            p.cardsInPlay.some(c => {
              const cDef = state.cardPool[c.definitionId as string];
              return cDef && cDef.name === eventDef.name;
            }),
          );
          if (alreadyInPlay) {
            logDetail(`Permanent event ${eventDef.name}: unique and already in play`);
            actions.push({
              action: { type: 'not-playable', player: playerId, cardInstanceId },
              viable: false,
              reason: `${eventDef.name} is unique and already in play`,
            });
            continue;
          }
        }

        // Check duplication-limit with scope "game": cannot play if a copy is already in play
        const dupLimit = eventDef.effects?.find((e): e is import('../../index.js').DuplicationLimitEffect => {
          if (e.type !== 'duplication-limit') return false;
          return e.scope === 'game';
        });
        if (dupLimit) {
          const copiesInPlay = state.players.reduce((count, p) =>
            count + p.cardsInPlay.filter(c => {
              const cDef = state.cardPool[c.definitionId as string];
              return cDef && cDef.name === eventDef.name;
            }).length, 0,
          );
          if (copiesInPlay >= dupLimit.max) {
            logDetail(`Permanent event ${eventDef.name}: cannot be duplicated (${copiesInPlay}/${dupLimit.max} in play)`);
            actions.push({
              action: { type: 'not-playable', player: playerId, cardInstanceId },
              viable: false,
              reason: `${eventDef.name} cannot be duplicated`,
            });
            continue;
          }
        }

        // Check play-target site filter
        const sitePlayTarget = eventDef.effects?.find(
          (e): e is import('../../index.js').PlayTargetEffect => e.type === 'play-target' && e.target === 'site',
        );
        if (sitePlayTarget?.filter && siteDef) {
          if (!matchesCondition(sitePlayTarget.filter, siteDef as unknown as Record<string, unknown>)) {
            logDetail(`Permanent event ${eventDef.name}: site filter excludes ${siteName}`);
            actions.push({
              action: { type: 'not-playable', player: playerId, cardInstanceId },
              viable: false,
              reason: `${eventDef.name}: site ${siteName} does not match play-target filter`,
            });
            continue;
          }
        }

        // Check play-target character filter (e.g. "Sage only")
        const charPlayTarget = eventDef.effects?.find(
          (e): e is import('../../index.js').PlayTargetEffect => e.type === 'play-target' && e.target === 'character',
        );
        if (charPlayTarget) {
          const eligibleCharIds: import('../../index.js').CardInstanceId[] = [];
          for (const charId of company.characters) {
            const ch = player.characters[charId as string];
            if (!ch) continue;
            const charDef = state.cardPool[ch.definitionId as string];
            if (!charDef || !isCharacterCard(charDef)) continue;
            const ctx: Record<string, unknown> = {
              target: {
                race: charDef.race,
                skills: charDef.skills,
                status: ch.status,
                name: charDef.name,
              },
            };
            if (!charPlayTarget.filter || matchesCondition(charPlayTarget.filter, ctx)) {
              eligibleCharIds.push(charId);
            }
          }
          if (eligibleCharIds.length === 0) {
            logDetail(`Permanent event ${eventDef.name}: no eligible character in company`);
            actions.push({
              action: { type: 'not-playable', player: playerId, cardInstanceId },
              viable: false,
              reason: `${eventDef.name}: no eligible character in company`,
            });
            continue;
          }
        }

        // Check play-condition: discard-named-card
        const discardCondition = eventDef.effects?.find(
          (e): e is import('../../index.js').PlayConditionEffect =>
            e.type === 'play-condition' && e.requires === 'discard-named-card',
        );
        const discardCandidates: { instanceId: import('../../index.js').CardInstanceId; source: string }[] = [];
        if (discardCondition && discardCondition.cardName) {
          const targetCardName = discardCondition.cardName;
          const sources = discardCondition.sources ?? ['character-items'];
          for (const source of sources) {
            if (source === 'character-items') {
              for (const charId of company.characters) {
                const ch = player.characters[charId as string];
                if (!ch) continue;
                for (const item of ch.items) {
                  const itemDef = state.cardPool[item.definitionId as string];
                  if (itemDef && itemDef.name === targetCardName) {
                    discardCandidates.push({ instanceId: item.instanceId, source: 'character-items' });
                  }
                }
              }
            } else if (source === 'out-of-play-pile') {
              for (const card of player.outOfPlayPile) {
                const cardDef = state.cardPool[card.definitionId as string];
                if (cardDef && cardDef.name === targetCardName) {
                  discardCandidates.push({ instanceId: card.instanceId, source: 'out-of-play-pile' });
                }
              }
            }
          }
          if (discardCandidates.length === 0) {
            logDetail(`Permanent event ${eventDef.name}: no ${targetCardName} available to discard`);
            actions.push({
              action: { type: 'not-playable', player: playerId, cardInstanceId },
              viable: false,
              reason: `${eventDef.name}: no ${targetCardName} available to discard`,
            });
            continue;
          }
        }

        // Generate actions — cross-product of discard candidates (or single if none)
        if (discardCandidates.length > 0) {
          for (const dc of discardCandidates) {
            logDetail(`Permanent event ${eventDef.name}: playable (discard ${dc.instanceId as string} from ${dc.source})`);
            actions.push({
              action: {
                type: 'play-permanent-event', player: playerId, cardInstanceId,
                ...(sitePlayTarget && siteDefId ? { targetSiteDefinitionId: siteDefId } : {}),
                discardCardInstanceId: dc.instanceId,
              },
              viable: true,
            });
          }
        } else {
          logDetail(`Permanent event ${eventDef.name}: playable at ${siteName}`);
          actions.push({
            action: {
              type: 'play-permanent-event', player: playerId, cardInstanceId,
              ...(sitePlayTarget && siteDefId ? { targetSiteDefinitionId: siteDefId } : {}),
            },
            viable: true,
          });
        }
        continue;
      }
    }

    // Items — check site is untapped, allows the subtype, and there's an untapped character
    if (isItemCard(def)) {
      const itemDef = def as HeroItemCard;
      evaluatedInstances.add(cardInstanceId as string);

      if (siteIsTapped) {
        logDetail(`Item ${itemDef.name}: site is already tapped`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${itemDef.name}: site is already tapped`,
        });
        continue;
      }

      const siteRestriction = itemDef.effects?.find(
        (e): e is ItemPlaySiteEffect => e.type === 'item-play-site',
      );
      if (siteRestriction) {
        const matchesSiteList = siteRestriction.sites
          ? siteRestriction.sites.includes(siteName)
          : false;
        const matchesFilter = siteRestriction.filter
          ? matchesCondition(
              siteRestriction.filter,
              { site: siteDef as unknown as Record<string, unknown> },
            )
          : false;
        // Either form satisfies; if both are absent the restriction is
        // empty and trivially fails (a malformed effect).
        const allowed = matchesSiteList || matchesFilter;
        if (!allowed) {
          const reason = siteRestriction.sites
            ? `only playable at ${siteRestriction.sites.join(', ')}`
            : `${itemDef.name}: site does not satisfy play restriction`;
          logDetail(`Item ${itemDef.name}: site ${siteName} does not satisfy play restriction`);
          actions.push({
            action: { type: 'not-playable', player: playerId, cardInstanceId },
            viable: false,
            reason: siteRestriction.sites ? `${itemDef.name}: ${reason}` : reason,
          });
          continue;
        }
      } else if (!playableTypes.has(itemDef.subtype)) {
        logDetail(`Item ${itemDef.name} (${itemDef.subtype}): not playable at ${siteName}`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${itemDef.name}: ${itemDef.subtype} items cannot be played at ${siteName}`,
        });
        continue;
      }

      const siteEffects = siteDef && isSiteCard(siteDef) ? siteDef.effects : undefined;
      const denyRules = siteEffects?.filter(
        (e): e is DenyItemSiteRule =>
          e.type === 'site-rule' && e.rule === 'deny-item',
      ) ?? [];
      const denied = denyRules.some(rule =>
        matchesCondition(rule.when, itemDef as unknown as Record<string, unknown>),
      );
      if (denied) {
        logDetail(`Item ${itemDef.name} (${itemDef.subtype}): denied at ${siteName} by site-rule deny-item`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${itemDef.name} cannot be played at ${siteName}`,
        });
        continue;
      }

      if (untappedCharacters.length === 0) {
        logDetail(`Item ${itemDef.name}: no untapped character to carry it`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${itemDef.name}: no untapped character in company`,
        });
        continue;
      }

      // Check uniqueness — only one copy of a unique item can be in play
      if (itemDef.unique) {
        const alreadyInPlay = state.players.some(p =>
          Object.values(p.characters).some(ch =>
            ch.items.some(item => {
              const iDef = state.cardPool[item.definitionId as string];
              return iDef && iDef.name === itemDef.name;
            }),
          ),
        );
        if (alreadyInPlay) {
          logDetail(`Item ${itemDef.name}: unique and already in play`);
          actions.push({
            action: { type: 'not-playable', player: playerId, cardInstanceId },
            viable: false,
            reason: `${itemDef.name} is unique and already in play`,
          });
          continue;
        }
      }

      // Check character-scoped duplication limit
      const charDupLimit = itemDef.effects?.find(
        (e): e is import('../../index.js').DuplicationLimitEffect =>
          e.type === 'duplication-limit' && e.scope === 'character',
      );

      // One action per untapped character that could carry the item
      for (const ch of untappedCharacters) {
        const charDef = state.cardPool[ch.definitionId as string];
        const charName = charDef?.name ?? ch.instanceId;

        // Check character-scoped duplication: count copies of this item already on the character
        if (charDupLimit) {
          const copiesOnChar = ch.items.filter(item => {
            const iDef = state.cardPool[item.definitionId as string];
            return iDef && iDef.name === itemDef.name;
          }).length;
          if (copiesOnChar >= charDupLimit.max) {
            logDetail(`Item ${itemDef.name}: cannot be duplicated on ${charName} (${copiesOnChar}/${charDupLimit.max})`);
            actions.push({
              action: { type: 'not-playable', player: playerId, cardInstanceId },
              viable: false,
              reason: `${itemDef.name}: cannot be duplicated on ${charName}`,
            });
            continue;
          }
        }

        logDetail(`Item ${itemDef.name}: playable on ${charName}`);
        actions.push({
          action: {
            type: 'play-hero-resource',
            player: playerId,
            cardInstanceId,
            companyId: company.id,
            attachToCharacterId: ch.instanceId,
          },
          viable: true,
        });
      }
      continue;
    }

    // Allies — check site is untapped, ally is playable at this site, and there's an untapped character
    if (isAllyCard(def)) {
      const allyDef = def;
      evaluatedInstances.add(cardInstanceId as string);

      if (siteIsTapped) {
        logDetail(`Ally ${allyDef.name}: site is already tapped`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${allyDef.name}: site is already tapped`,
        });
        continue;
      }

      // Check ally is playable at this site
      const siteDefForAlly = siteDef && isSiteCard(siteDef) ? siteDef : undefined;
      if (!siteDefForAlly || !allyDef.playableAt.some(entry => siteMatchesEntry(siteDefForAlly, entry))) {
        const allowedSites = allyDef.playableAt.map(e => 'site' in e ? e.site : e.siteType).join(', ');
        logDetail(`Ally ${allyDef.name}: not playable at ${siteName} (requires ${allowedSites})`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${allyDef.name}: not playable at ${siteName}`,
        });
        continue;
      }

      // Check uniqueness — only one copy of a unique ally can be in play
      if (allyDef.unique) {
        const alreadyInPlay = state.players.some(p =>
          Object.values(p.characters).some(ch =>
            ch.allies.some(a => {
              const aDef = state.cardPool[a.definitionId as string];
              return aDef && aDef.name === allyDef.name;
            }),
          ),
        );
        if (alreadyInPlay) {
          logDetail(`Ally ${allyDef.name}: unique and already in play`);
          actions.push({
            action: { type: 'not-playable', player: playerId, cardInstanceId },
            viable: false,
            reason: `${allyDef.name} is unique and already in play`,
          });
          continue;
        }
      }

      if (untappedCharacters.length === 0) {
        logDetail(`Ally ${allyDef.name}: no untapped character to control it`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${allyDef.name}: no untapped character in company`,
        });
        continue;
      }

      // One action per untapped character that could control the ally
      for (const ch of untappedCharacters) {
        const charDef = state.cardPool[ch.definitionId as string];
        const charName = charDef?.name ?? ch.instanceId;
        logDetail(`Ally ${allyDef.name}: playable under ${charName}`);
        actions.push({
          action: {
            type: 'play-hero-resource',
            player: playerId,
            cardInstanceId,
            companyId: company.id,
            attachToCharacterId: ch.instanceId,
          },
          viable: true,
        });
      }
      continue;
    }

    // Factions — check site is untapped, faction is playable at this site, and there's an untapped character
    if (isFactionCard(def)) {
      const factionDef: FactionCard = def;
      evaluatedInstances.add(cardInstanceId as string);

      if (siteIsTapped) {
        logDetail(`Faction ${factionDef.name}: site is already tapped`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${factionDef.name}: site is already tapped`,
        });
        continue;
      }

      // Check faction is playable at this site
      const siteDefForFaction = siteDef && isSiteCard(siteDef) ? siteDef : undefined;
      if (!siteDefForFaction || !factionDef.playableAt.some(entry => siteMatchesEntry(siteDefForFaction, entry))) {
        const allowedSites = factionDef.playableAt.map(e => 'site' in e ? e.site : e.siteType).join(', ');
        logDetail(`Faction ${factionDef.name}: not playable at ${siteName} (requires ${allowedSites})`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${factionDef.name}: not playable at ${siteName}`,
        });
        continue;
      }

      // Check uniqueness — only one copy of a unique faction can be in play
      const alreadyInPlay = state.players.some(p =>
        p.cardsInPlay.some(c => {
          const cDef = state.cardPool[c.definitionId as string];
          return cDef && cDef.name === factionDef.name;
        }),
      );
      if (alreadyInPlay) {
        logDetail(`Faction ${factionDef.name}: unique and already in play`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${factionDef.name} is unique and already in play`,
        });
        continue;
      }

      if (untappedCharacters.length === 0) {
        logDetail(`Faction ${factionDef.name}: no untapped character to attempt influence`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${factionDef.name}: no untapped character in company`,
        });
        continue;
      }

      // One action per untapped character that could attempt influence
      for (const ch of untappedCharacters) {
        const charDef = state.cardPool[ch.definitionId as string];
        const charName = charDef?.name ?? ch.instanceId;

        // Compute modifier for this character
        let infModifier = 0;
        const infParts: string[] = [`influence # ${factionDef.influenceNumber}`];
        if (charDef && isCharacterCard(charDef)) {
          infModifier += charDef.directInfluence;
          infParts.push(`DI ${charDef.directInfluence}`);

          // DSL effects
          const resolverCtx: ResolverContext = {
            reason: 'faction-influence-check',
            bearer: {
              race: charDef.race, skills: charDef.skills,
              baseProwess: charDef.prowess, baseBody: charDef.body,
              baseDirectInfluence: charDef.directInfluence, name: charDef.name,
            },
            faction: {
              name: factionDef.name,
              race: factionDef.race,
              playableAt: buildFactionPlayableAt(factionDef),
            },
            controller: { inPlay: buildControllerInPlayNames(state, playerId) },
          };
          const charEffects = collectCharacterEffects(state, ch, resolverCtx);
          charEffects.push(...collectCompanyAllyEffects(state, ch, resolverCtx));
          if (factionDef.effects) {
            for (const effect of factionDef.effects) {
              if (effect.when && !matchesCondition(effect.when, resolverCtx as unknown as Record<string, unknown>)) continue;
              charEffects.push({ effect, sourceDef: factionDef, sourceInstance: cardInstanceId });
            }
          }
          const dslMod = resolveCheckModifier(charEffects, 'influence');
          if (dslMod !== 0) {
            infModifier += dslMod;
            infParts.push(`check bonus ${dslMod >= 0 ? '+' : ''}${dslMod}`);
          }

          // Resolve stat-modifier effects on direct-influence (e.g. Glorfindel +1 DI vs elf factions)
          const dslDI = resolveStatModifiers(charEffects, 'direct-influence', 0, resolverCtx);
          if (dslDI !== 0) {
            infModifier += dslDI;
            infParts.push(`DI bonus ${dslDI >= 0 ? '+' : ''}${dslDI}`);
          }
        }
        const infNeed = factionDef.influenceNumber - infModifier;

        logDetail(`Faction ${factionDef.name}: influenceable by ${charName} (need ${infNeed})`);
        actions.push({
          action: {
            type: 'influence-attempt',
            player: playerId,
            factionInstanceId: cardInstanceId,
            influencingCharacterId: ch.instanceId,
            need: infNeed,
            explanation: `Need roll >= ${infNeed} (${infParts.join(', ')})`,
          },
          viable: true,
        });
      }
      continue;
    }

    // TODO: information
  }

  // Resource short-events (e.g. Marvels Told) — per CoE 2.1.1 the resource
  // player may play these during any phase of their turn unless a rule or
  // effect restricts them.
  const shortEventActions = playResourceShortEventActions(
    state, playerId, evaluatedInstances, 'site',
  );
  actions.push(...shortEventActions);
  for (const ea of shortEventActions) {
    const id = (ea.action as { cardInstanceId?: string }).cardInstanceId;
    if (typeof id === 'string') evaluatedInstances.add(id);
  }

  // Mark remaining hand cards as not playable
  for (const handCard of player.hand) {
    if (evaluatedInstances.has(handCard.instanceId as string)) continue;
    const def = state.cardPool[handCard.definitionId as string];
    const name = def?.name ?? 'card';
    actions.push({
      action: { type: 'not-playable', player: playerId, cardInstanceId: handCard.instanceId },
      viable: false,
      reason: `${name}: not playable during site phase`,
    });
  }

  // Rule 2.1.1: resource player may activate any-phase grant-actions (e.g. Cram untap-bearer)
  actions.push(...grantedActionActivations(state, playerId, ANY_PHASE_ONLY));

  // Opponent influence attempts (rule 10.10)
  const oppInfluence = opponentInfluenceActions(state, playerId, siteState, company, player, untappedCharacters);
  actions.push(...oppInfluence);

  // Pass to end this company's site phase
  actions.push({ action: { type: 'pass', player: playerId }, viable: true });

  return actions;
}

/**
 * Generate legal actions for influencing an opponent's in-play characters
 * or allies at the same site.
 *
 * Guards (return empty if any fail):
 * - It is not the resource player's first turn
 * - The company has entered its site this turn
 * - No prior opponent interaction (influence or CvCC attack) this turn
 *
 * For each untapped character in the active company, checks opponent companies
 * at the same site for targetable characters and allies. Avatars and cards
 * controlled by avatars cannot be targeted.
 *
 * CoE rules 10.10–10.11.
 */
function opponentInfluenceActions(
  state: GameState,
  playerId: PlayerId,
  siteState: SitePhaseState,
  company: { readonly characters: readonly import('../../index.js').CardInstanceId[]; readonly currentSite: import('../../index.js').SiteInPlay | null },
  player: import('../../index.js').PlayerState,
  untappedCharacters: import('../../index.js').CharacterInPlay[],
): EvaluatedAction[] {
  const actions: EvaluatedAction[] = [];

  // Guard: must have entered the site
  if (!siteState.siteEntered) {
    logDetail(`Opponent influence: company hasn't entered site`);
    return [];
  }

  // Guard: not first turn
  if (state.turnNumber <= 2) {
    logDetail(`Opponent influence: first turn (turnNumber ${state.turnNumber}) — not allowed`);
    return [];
  }

  // Guard: no prior opponent interaction this turn
  if (siteState.opponentInteractionThisTurn !== null) {
    logDetail(`Opponent influence: already made ${siteState.opponentInteractionThisTurn} this turn`);
    return [];
  }

  // Guard: need untapped characters
  if (untappedCharacters.length === 0) {
    logDetail(`Opponent influence: no untapped characters`);
    return [];
  }

  // Find active company's site definition
  const siteInstanceId = company.currentSite?.instanceId ?? null;
  const siteDefId = siteInstanceId ? resolveInstanceId(state, siteInstanceId) : undefined;
  const siteDef = siteDefId ? state.cardPool[siteDefId as string] : undefined;
  if (!siteDef || !isSiteCard(siteDef)) return [];

  const playerIndex = getPlayerIndex(state, playerId);
  const opponentIndex = 1 - playerIndex;
  const opponent = state.players[opponentIndex];
  const opponentGI = GENERAL_INFLUENCE - opponent.generalInfluenceUsed;

  // Find opponent companies at the same site
  for (const oppCompany of opponent.companies) {
    if (!oppCompany.currentSite) continue;
    const oppSiteDefId = resolveInstanceId(state, oppCompany.currentSite.instanceId);
    const oppSiteDef = oppSiteDefId ? state.cardPool[oppSiteDefId as string] : undefined;
    if (!oppSiteDef || !isSiteCard(oppSiteDef) || oppSiteDef.name !== siteDef.name) continue;

    logDetail(`Opponent influence: opponent company at same site ${siteDef.name}`);

    // Check each opponent character at this site
    for (const oppCharId of oppCompany.characters) {
      const oppChar = opponent.characters[oppCharId as string];
      if (!oppChar) continue;
      const oppCharDef = state.cardPool[oppChar.definitionId as string];
      if (!oppCharDef || !isCharacterCard(oppCharDef)) continue;

      // Skip avatars
      if (isAvatarCharacter(oppCharDef)) {
        logDetail(`Opponent influence: ${oppCharDef.name} is avatar — skip`);
        continue;
      }

      // Skip characters controlled by avatar (follower of avatar)
      // controlledBy is 'general' or a CardInstanceId of the controlling character
      if (oppChar.controlledBy !== 'general') {
        const ctrlChar = opponent.characters[oppChar.controlledBy as string];
        if (ctrlChar) {
          const ctrlDef = state.cardPool[ctrlChar.definitionId as string];
          if (isAvatarCharacter(ctrlDef)) {
            logDetail(`Opponent influence: ${oppCharDef.name} controlled by avatar ${ctrlDef.name} — skip`);
            continue;
          }
        }
      }

      // Determine controller's unused DI (rule 10.12 step 5)
      // Only applies when the target is under direct influence (not GI)
      let controllerDI = 0;
      if (oppChar.controlledBy !== 'general') {
        controllerDI = availableDI(state, oppChar.controlledBy, opponent);
      }

      // Generate action per untapped influencer
      for (const ch of untappedCharacters) {
        const charDef = state.cardPool[ch.definitionId as string];
        if (!charDef || !isCharacterCard(charDef)) continue;

        const influencerDI = availableDI(state, ch.instanceId, player);
        const explanation = `Influencer DI: ${influencerDI}, opponent GI: ${opponentGI}, target mind: ${oppCharDef.mind}, controller DI: ${controllerDI}`;

        logDetail(`Opponent influence: ${charDef.name} can target ${oppCharDef.name} (${explanation})`);
        // Base action (no reveal)
        actions.push({
          action: {
            type: 'opponent-influence-attempt',
            player: playerId,
            influencingCharacterId: ch.instanceId,
            targetPlayer: opponent.id,
            targetInstanceId: oppCharId,
            targetKind: 'character',
            explanation,
          },
          viable: true,
        });

        // Identical card reveal variant (rule 10.11): same name, any alignment
        const identicalInHand = player.hand.find(h => {
          const hDef = state.cardPool[h.definitionId as string];
          return hDef && (isCharacterCard(hDef) || isAllyCard(hDef)) && hDef.name === oppCharDef.name;
        });
        if (identicalInHand) {
          const revealExplanation = `${explanation} (reveal identical → mind treated as 0)`;
          logDetail(`Opponent influence: ${charDef.name} can reveal identical ${oppCharDef.name} from hand`);
          actions.push({
            action: {
              type: 'opponent-influence-attempt',
              player: playerId,
              influencingCharacterId: ch.instanceId,
              targetPlayer: opponent.id,
              targetInstanceId: oppCharId,
              targetKind: 'character',
              revealedCardInstanceId: identicalInHand.instanceId,
              explanation: revealExplanation,
            },
            viable: true,
          });
        }
      }

      // Check allies on this character
      for (const allyInst of oppChar.allies) {
        const allyDef = state.cardPool[allyInst.definitionId as string];
        if (!allyDef || !isAllyCard(allyDef)) continue;

        const allyMind = allyDef.mind;

        // Controller DI for ally = DI of the character controlling it
        const allyControllerDI = availableDI(state, oppCharId, opponent);

        for (const ch of untappedCharacters) {
          const charDef = state.cardPool[ch.definitionId as string];
          if (!charDef || !isCharacterCard(charDef)) continue;

          const influencerDI = availableDI(state, ch.instanceId, player);
          const explanation = `Influencer DI: ${influencerDI}, opponent GI: ${opponentGI}, target mind: ${allyMind}, controller DI: ${allyControllerDI}`;

          logDetail(`Opponent influence: ${charDef.name} can target ally ${allyDef.name} (${explanation})`);
          // Base action (no reveal)
          actions.push({
            action: {
              type: 'opponent-influence-attempt',
              player: playerId,
              influencingCharacterId: ch.instanceId,
              targetPlayer: opponent.id,
              targetInstanceId: allyInst.instanceId,
              targetKind: 'ally',
              explanation,
            },
            viable: true,
          });

          // Identical card reveal variant
          const identicalAllyInHand = player.hand.find(h => {
            const hDef = state.cardPool[h.definitionId as string];
            return hDef && (isCharacterCard(hDef) || isAllyCard(hDef)) && hDef.name === allyDef.name;
          });
          if (identicalAllyInHand) {
            const revealExplanation = `${explanation} (reveal identical → mind treated as 0)`;
            logDetail(`Opponent influence: ${charDef.name} can reveal identical ${allyDef.name} from hand`);
            actions.push({
              action: {
                type: 'opponent-influence-attempt',
                player: playerId,
                influencingCharacterId: ch.instanceId,
                targetPlayer: opponent.id,
                targetInstanceId: allyInst.instanceId,
                targetKind: 'ally',
                revealedCardInstanceId: identicalAllyInHand.instanceId,
                explanation: revealExplanation,
              },
              viable: true,
            });
          }
        }
      }
    }
  }

  // Faction re-influence: target in-play factions of the opponent.
  // CoE rule 8.3 final list — "the value required for the influence check on
  // the faction that is already in play" serves as the comparison value.
  // The active company must be at a site where the faction is playable
  // (re-influence happens at the faction's home site). No controller DI
  // applies to factions (they're controlled by the player, not a character).
  for (const factionInPlay of opponent.cardsInPlay) {
    const factionDef = state.cardPool[factionInPlay.definitionId as string];
    if (!factionDef || !isFactionCard(factionDef)) continue;

    if (!factionDef.playableAt.some(entry => siteMatchesEntry(siteDef, entry))) {
      logDetail(`Opponent influence: ${factionDef.name} not playable at ${siteDef.name} — skip`);
      continue;
    }

    const targetValue = factionDef.inPlayInfluenceNumber ?? factionDef.influenceNumber;

    for (const ch of untappedCharacters) {
      const charDef = state.cardPool[ch.definitionId as string];
      if (!charDef || !isCharacterCard(charDef)) continue;

      const influencerDI = availableDI(state, ch.instanceId, player);
      const explanation = `Influencer DI: ${influencerDI}, opponent GI: ${opponentGI}, faction in-play influence #: ${targetValue}`;

      logDetail(`Opponent influence: ${charDef.name} can re-influence faction ${factionDef.name} (${explanation})`);
      actions.push({
        action: {
          type: 'opponent-influence-attempt',
          player: playerId,
          influencingCharacterId: ch.instanceId,
          targetPlayer: opponent.id,
          targetInstanceId: factionInPlay.instanceId,
          targetKind: 'faction',
          explanation,
        },
        viable: true,
      });

      // CoE rule 8.2: identical card reveal is allowed for factions too.
      const identicalFactionInHand = player.hand.find(h => {
        const hDef = state.cardPool[h.definitionId as string];
        return hDef && isFactionCard(hDef) && hDef.name === factionDef.name;
      });
      if (identicalFactionInHand) {
        const revealExplanation = `${explanation} (reveal identical → target treated as 0)`;
        logDetail(`Opponent influence: ${charDef.name} can reveal identical ${factionDef.name} from hand`);
        actions.push({
          action: {
            type: 'opponent-influence-attempt',
            player: playerId,
            influencingCharacterId: ch.instanceId,
            targetPlayer: opponent.id,
            targetInstanceId: factionInPlay.instanceId,
            targetKind: 'faction',
            revealedCardInstanceId: identicalFactionInHand.instanceId,
            explanation: revealExplanation,
          },
          viable: true,
        });
      }
    }
  }

  return actions;
}

