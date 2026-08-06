/**
 * @module legal-actions/organization-events
 *
 * Event card play actions during the organization phase. Evaluates permanent
 * resource events (played directly to the table) and short events with
 * special play-as-resource effects (e.g. Twilight cancelling environments).
 */

import type {
  GameState,
  PlayerId,
  EvaluatedAction,
  CardInstanceId,
  CardDefinitionId,
  HeroResourceEventCard,
  MinionResourceEventCard,
  HazardEventCard,
  PlayTargetEffect,
} from '../../index.js';
import type { ConvertCreatureToAllyEffect } from '../../types/effects.js';
import { matchesCondition } from '../../effects/condition-matcher.js';
import { hasPlayFlag } from '../../effects/play-flags.js';
import { isCharacterCard, isAvatarCharacter, isSiteCard, isFactionCard } from '../../types/cards.js';
import { CardStatus, Race } from '../../types/common.js';
import { Phase } from '../../types/state-phases.js';
import { getEffectiveSkills } from '../effects/index.js';
import { buildSiteFilterContext } from '../effective.js';
import { logDetail } from './log.js';
import { notPlayable } from './action-builders.js';
import { cardName, isSiteProtectedForPlayer, playerById, defById, countCopiesInPlay, countCopiesInPlayTargetedForDiscard, countCopiesDeclaredInChain, countPlayerHeldCopies, countAttachedInCompany, countCompanyBoundCopies, countPermanentEventCopiesAtSite, countPermanentEventCopiesDeclaredInChainAtSite, countFactionAttachedCopies, defNamesOf, itemKeywordsOf, itemSubtypesOf, getCardEffects, isCardNameInPlayOrCharacters, isCardNameInPlayForPlayer, isCovertCompany, factionSiegeEligibleSites, findDuplicationLimitEffect, findPlayConditionEffect, findPlayConditionEffects, findFallenWizardAvatarName, keywordDiscardCandidates, matchesCompanyContextCondition, isCompanyAtSite, isCompanyEventPlayProhibited, characterHomeSiteTypes, findPlayerAvatar, regionTypeCounts, activePlayerDeckSize } from '../reducer-utils.js';
import { wizardSpecificName } from '../fallen-wizard-specific.js';
import { buildPlayerStateContext } from './organization.js';
import { buildFactionPlayableRegions } from '../recompute-derived.js';
import { isSetAsideCard, cardTargetsSetAside } from '../set-aside.js';
import { findEnvironmentTargets } from '../environment-targets.js';

/**
 * The combined count of a player's supporters for Girdle of Radagast (wh-110):
 * every ally in play (an ally borne by any of the player's characters) plus
 * every **unique faction** in play that can be played at a site in the anchor
 * Wizardhaven's region or an adjacent region. The parenthetical region
 * restriction on the card applies only to the factions, so allies always count.
 */
function girdleSupporterCount(
  state: GameState,
  player: import('../../index.js').PlayerState,
  siteDef: import('../../index.js').SiteCard,
): number {
  // Allies in play — allies attach to characters (CharacterInPlay.allies).
  let count = 0;
  for (const ch of Object.values(player.characters)) {
    count += ch.allies.length;
  }

  // Region set: the Wizardhaven's region plus its adjacent regions.
  const regionSet = new Set<string>();
  const anchorRegion = siteDef.region;
  if (anchorRegion) {
    regionSet.add(anchorRegion);
    for (const cardDef of Object.values(state.cardPool)) {
      const rc = cardDef as { cardType?: string; name?: string; adjacentRegions?: readonly string[] };
      if (rc.cardType === 'region' && rc.name === anchorRegion) {
        for (const adj of rc.adjacentRegions ?? []) regionSet.add(adj);
        break;
      }
    }
  }

  // Unique factions in play playable at a site in the region set.
  for (const c of player.cardsInPlay) {
    const def = defById(state, c.definitionId);
    if (!def || !isFactionCard(def) || !def.unique) continue;
    const playableRegions = buildFactionPlayableRegions(state, def);
    if (playableRegions.some(r => regionSet.has(r))) count++;
  }
  return count;
}

/**
 * Whether `company` contains an Orc or Troll character (MEWH §9). Half-orcs
 * carry `race: Orc`, so they are included.
 */
function companyHasOrcOrTroll(
  state: GameState,
  company: import('../../index.js').PlayerState['companies'][number],
  player: import('../../index.js').PlayerState,
): boolean {
  return company.characters.some(cId => {
    const ch = player.characters[cId];
    if (!ch) return false;
    const def = defById(state, ch.definitionId);
    return !!def && 'race' in def
      && ((def as { race: Race }).race === Race.Orc || (def as { race: Race }).race === Race.Troll);
  });
}

/**
 * Evaluates permanent-event resource cards in hand for play during organization.
 * Permanent resource events can be played directly to the table without a site.
 * Unique permanent events cannot be played if one with the same name is already in play.
 */
export function playPermanentEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const rawDef = state.cardPool[handCard.definitionId] as HeroResourceEventCard | MinionResourceEventCard | HazardEventCard | undefined;

    // Great Secrets Buried There (dm-63): "you may play this card as a
    // resource on yourself … you and your opponent reverse roles." A
    // permanent hazard-event with `playable-as-resource` never targets a
    // character/site/company, so it is handled as its own minimal branch —
    // the generic hero/minion-resource-event logic below assumes that
    // cardType and would mis-cast this card's definition.
    if (
      rawDef
      && rawDef.cardType === 'hazard-event'
      && rawDef.eventType === 'permanent'
      && hasPlayFlag(rawDef, 'playable-as-resource')
    ) {
      const deckSizeCond = findPlayConditionEffect(rawDef, 'active-player-deck-size');
      if (deckSizeCond?.minDeckSize !== undefined) {
        const deckSize = activePlayerDeckSize(state);
        if (deckSize < deckSizeCond.minDeckSize) {
          logDetail(`${rawDef.name}: playable as a resource only with at least ${deckSizeCond.minDeckSize} cards in play deck (have ${deckSize})`);
          actions.push(notPlayable(playerId, cardInstanceId, `${rawDef.name}: requires at least ${deckSizeCond.minDeckSize} cards in your play deck`));
          continue;
        }
      }
      logDetail(`${rawDef.name}: playable as a resource on yourself`);
      actions.push({
        action: { type: 'play-permanent-event', player: playerId, cardInstanceId },
        viable: true,
      });
      continue;
    }

    const def = rawDef as HeroResourceEventCard | MinionResourceEventCard | undefined;
    if (!def || (def.cardType !== 'hero-resource-event' && def.cardType !== 'minion-resource-event') || def.eventType !== 'permanent') continue;

    // Rule 5.F1 [FALLEN-WIZARD]: Stage resource permanent-events can only be
    // played during the organization phase. The exceptions are cards that
    // declare their own timing in their text (e.g. "Playable during the site
    // phase") — those target a site and are handled by the site-target branch
    // below. Stage permanent-events that target a character or have no target
    // (e.g. Wizard's Myrmidon wh-84) must not be offered during the
    // movement/hazard phase, where this function is also consulted under the
    // general "any phase" allowance of rule 2.1.1.
    // A permanent-event that declares its own `play-window` is offered only in
    // that window. No News of Our Riding (le-211) declares the after-attack
    // combat window (`phase: "combat"`, `step: "after-attack"`) and is offered
    // solely by the `post-attack-play-offer` resolution — never here, in any
    // phase this emitter is consulted for.
    const playWindow = getCardEffects(def).find(
      (e): e is import('../../types/effects.js').PlayWindowEffect => e.type === 'play-window',
    );
    if (playWindow && playWindow.phase !== state.phaseState.phase) {
      logDetail(`Permanent event ${def.name}: play-window restricts it to the ${playWindow.phase} phase (current ${state.phaseState.phase})`);
      continue;
    }

    // A `convert-creature-to-ally` effect (Ready to His Will le-220, Memories
    // of Old Torture ba-67) is a combat-only mechanism: it is playable solely
    // during the defending player's assign-strikes window against an eligible
    // creature attack, and is offered exclusively by
    // `legal-actions/combat.ts`'s `convertCreatureToAllyActions`. There is no
    // "any time" mode for such a card, so it must never reach the generic
    // fallback below (which would offer it as an unconditionally playable
    // permanent event with no target, in any phase, even with no attack in
    // progress).
    const convertCreatureToAlly = getCardEffects(def).find(
      (e): e is ConvertCreatureToAllyEffect => e.type === 'convert-creature-to-ally',
    );
    if (convertCreatureToAlly) {
      logDetail(`Permanent event ${def.name}: convert-creature-to-ally is combat-only — not offered here`);
      continue;
    }

    const isStageResource = (def as { alignment?: string }).alignment === 'stage';
    if (isStageResource && state.phaseState.phase !== Phase.Organization) {
      logDetail(`Stage permanent-event ${def.name}: only playable during the organization phase (current phase ${state.phaseState.phase})`);
      continue;
    }

    // A permanent-event carrying an `active-company` play-condition declares its
    // own site-phase timing (Delver's Harvest wh-65: "Playable during the site
    // phase if one of your companies enters the Deep Mines site."). Such a card
    // is offered only by the site-phase play path (legal-actions/site.ts),
    // never here — even during the organization phase.
    if (findPlayConditionEffect(def, 'active-company')) {
      logDetail(`Permanent event ${def.name}: site-phase timing (active-company play-condition) — not offered in this phase`);
      continue;
    }

    // play-condition: phase — the card's text names the phase(s) it may be
    // played in ("Playable on a leader during the organization phase" — No More
    // Nonsense le-210). Without this gate a permanent event is offered in the
    // organization phase, the M/H phase (rule 2.1.1) and the site phase alike.
    const phaseCondition = findPlayConditionEffect(def, 'phase');
    if (phaseCondition?.phases && !phaseCondition.phases.includes(state.phaseState.phase)) {
      logDetail(`Permanent event ${def.name}: playable only during [${phaseCondition.phases.join(', ')}] (current phase ${state.phaseState.phase})`);
      continue;
    }

    // Check uniqueness: unique permanent events can't be played if already in play
    if (def.unique) {
      const alreadyInPlay = countCopiesInPlay(state, def.name) > 0;
      if (alreadyInPlay) {
        logDetail(`Permanent event ${def.name}: unique and already in play`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} is unique and already in play`));
        continue;
      }
    }

    // Wizard-specific Stage resources (e.g. Truths of Doom wh-108 "Pallando
    // specific", The Forge-master wh-117 "Saruman specific") are bound to one
    // Fallen-wizard avatar (CoE 1.3.4). Per CoE 2.2.F2 they remain playable for
    // as long as that avatar has NOT been eliminated — the avatar need NOT be in
    // play, so the card can be played even before the Fallen-wizard is first
    // brought into play from the deck. `findFallenWizardAvatarName` resolves the
    // player's declared avatar whether it is in play or still in the
    // deck/hand/discard/sideboard, and returns undefined once it is eliminated.
    const requiredWizard = wizardSpecificName(def);
    if (requiredWizard) {
      const avatarName = findFallenWizardAvatarName(state, player);
      if (avatarName !== requiredWizard) {
        logDetail(`Permanent event ${def.name}: ${requiredWizard}-specific, but player's Fallen-wizard is ${avatarName ?? 'none / eliminated'}`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} is ${requiredWizard}-specific`));
        continue;
      }
    }

    // Check duplication-limit with scope "game": cannot play if a copy is already in play
    const dupLimit = findDuplicationLimitEffect(def, 'game');
    if (dupLimit) {
      // CRF 22 Annotation 11: an in-play copy that is currently being targeted
      // for discard by an unresolved chain entry (e.g. a Twilight canceling this
      // player's Gates of Morning) does not count — the replacement copy may be
      // played in response.
      const copiesInPlay = countCopiesInPlay(state, def.name)
        + countCopiesDeclaredInChain(state, def.name)
        - countCopiesInPlayTargetedForDiscard(state, def.name);
      if (copiesInPlay >= dupLimit.max) {
        logDetail(`Permanent event ${def.name}: cannot be duplicated (${copiesInPlay}/${dupLimit.max} in play)`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} cannot be duplicated`));
        continue;
      }
    }

    // Check duplication-limit with scope "player": each player independently limited
    const playerDupLimit = findDuplicationLimitEffect(def, 'player');
    if (playerDupLimit) {
      const copiesOwned = countPlayerHeldCopies(state, player, def.name);
      if (copiesOwned >= playerDupLimit.max) {
        logDetail(`Permanent event ${def.name}: player duplication limit reached (${copiesOwned}/${playerDupLimit.max})`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} cannot be duplicated by a given player`));
        continue;
      }
    }

    // play-condition: player-state — a generic DSL condition on the active
    // player's avatar/alignment/stage-point context. Used by Gatherer of
    // Loyalties (wh-70): "Playable if you have more than 3 stage points." and A
    // Strident Spawn (wh-61): "Playable if you are Pallando or Saruman and have
    // 6 or more stage points and a protected Wizardhaven."
    const playerStateCondition = findPlayConditionEffect(def, 'player-state');
    if (playerStateCondition?.condition) {
      const ctx = buildPlayerStateContext(state, player, playerId);
      if (!matchesCondition(playerStateCondition.condition, ctx)) {
        logDetail(`Permanent event ${def.name}: play-condition player-state not satisfied (stagePoints=${player.stagePoints})`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: play condition not met`));
        continue;
      }
    }

    // play-condition: card-in-play — one or more named cards must already be in
    // the **playing player's own** play area (attachment-aware: `cardsInPlay`,
    // his characters, and the items/hazards they bear, so a stage
    // permanent-event placed "on the avatar" counts). An opponent's copy never
    // satisfies "if <card> is in play" on a resource permanent-event, mirroring
    // the faction gate in `legal-actions/site.ts`. Every such condition is
    // checked, so a card may require several named cards at once. Used by
    // Oromë's Warders (wh-94): "Playable on Alatar if Join the Hunt is in play."
    const cardInPlayConditions = findPlayConditionEffects(def, 'card-in-play');
    let missingRequiredCard: string | undefined;
    for (const cond of cardInPlayConditions) {
      if (cond.cardName && !isCardNameInPlayForPlayer(state, player, cond.cardName)) {
        missingRequiredCard = cond.cardName;
        break;
      }
    }
    if (missingRequiredCard) {
      logDetail(`Permanent event ${def.name}: play-condition card-in-play requires ${missingRequiredCard} in play`);
      actions.push(notPlayable(playerId, cardInstanceId, `${def.name} requires ${missingRequiredCard} in play`));
      continue;
    }

    // Wizard's Trove (wh-85) family: `play-with-stored-card` /
    // `storage-site-transfer`. Such a card is only playable in one of its
    // combo modes — never as a bare permanent event — so the branch always
    // `continue`s. Stage timing (organization phase only) was enforced above.
    const playWithStored = getCardEffects(def).find(
      (e): e is import('../../types/effects.js').PlayWithStoredCardEffect => e.type === 'play-with-stored-card',
    );
    const storageTransfer = getCardEffects(def).find(
      (e): e is import('../../types/effects.js').StorageSiteTransferEffect => e.type === 'storage-site-transfer',
    );
    if (playWithStored || storageTransfer) {
      let anyMode = false;

      // Site matcher mirroring the site play-target context: the site
      // definition extended with `regionType` and `effectiveSiteType`, so
      // "one of your Wizardhavens [{H}]" filters match dynamically converted
      // sites (Hidden Haven wh-75 family) as well as printed havens.
      const siteMatchesFilter = (
        siteDefId: CardDefinitionId,
        filter: import('../../types/effects.js').Condition | undefined,
        siteInstanceId?: CardInstanceId,
      ): boolean => {
        const siteDef = defById(state, siteDefId);
        if (!siteDef || !isSiteCard(siteDef)) return false;
        if (!filter) return true;
        return matchesCondition(filter, buildSiteFilterContext(state, siteDef, siteInstanceId));
      };

      // Mode 1 — play-with-stored-card: the companion (e.g. The White Tree)
      // must be in hand, and the required card (e.g. Sapling of the White
      // Tree) must be stored (`storedAtSite`) at a filter-matching site.
      if (playWithStored) {
        const companion = player.hand.find(c => defById(state, c.definitionId)?.name === playWithStored.cardName);
        if (!companion) {
          logDetail(`Permanent event ${def.name}: companion "${playWithStored.cardName}" not in hand`);
        } else {
          for (const stored of player.killPile) {
            if (!stored.storedAtSite) continue;
            const storedDef = defById(state, stored.definitionId);
            if (storedDef?.name !== playWithStored.requiresStored) continue;
            if (!siteMatchesFilter(stored.storedAtSite, playWithStored.siteFilter)) {
              logDetail(`Permanent event ${def.name}: "${playWithStored.requiresStored}" is stored at ${stored.storedAtSite as string}, which does not match the site filter`);
              continue;
            }
            logDetail(`Permanent event ${def.name}: playable with "${playWithStored.cardName}" at ${stored.storedAtSite as string} — "${playWithStored.requiresStored}" is stored there`);
            anyMode = true;
            actions.push({
              action: {
                type: 'play-permanent-event',
                player: playerId,
                cardInstanceId,
                targetSiteDefinitionId: stored.storedAtSite,
                companionCardInstanceId: companion.instanceId,
              },
              viable: true,
            });
          }
        }
      }

      // Mode 2 — storage-site-transfer: one action per (item, bearer) pair in
      // a company at a filter-matching site, for items that score their own
      // declared MP from storage (`storable-at` with `marshallingPoints` —
      // the "marshalling point card" reading).
      if (storageTransfer) {
        for (const company of player.companies) {
          if (!company.currentSite) continue;
          const siteDefId = company.currentSite.definitionId;
          if (!siteMatchesFilter(siteDefId, storageTransfer.siteFilter, company.currentSite.instanceId)) continue;
          for (const charInstId of company.characters) {
            const char = player.characters[charInstId];
            if (!char) continue;
            for (const item of char.items) {
              const itemDef = defById(state, item.definitionId);
              if (!itemDef) continue;
              const storable = getCardEffects(itemDef).find(
                (e): e is import('../../types/effects.js').StorableAtEffect => e.type === 'storable-at',
              );
              if (!storable || storable.marshallingPoints === undefined) continue;
              logDetail(`Permanent event ${def.name}: storage transfer of ${itemDef.name} to ${siteDefId as string}`);
              anyMode = true;
              actions.push({
                action: {
                  type: 'play-permanent-event',
                  player: playerId,
                  cardInstanceId,
                  targetSiteDefinitionId: siteDefId,
                  storeItemInstanceId: item.instanceId,
                  storeCharacterId: charInstId,
                },
                viable: true,
              });
            }
          }
        }
      }

      if (!anyMode) {
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: no valid play mode (stored-card combo or storage transfer)`));
      }
      continue;
    }

    // play-target DSL: cards targeting a site.
    const sitePlayTarget = def.effects?.find(
      (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'site',
    );
    if (sitePlayTarget) {
      // Rule 5.F1 [FALLEN-WIZARD]: Stage resource permanent-events are played
      // during the organization phase only. A site-targeting Stage resource
      // (The Fortress of Isen wh-68, Fortress of the Towers wh-69, Guarded
      // Haven wh-74, Double-dealing wh-66, Saruman's Machinery wh-120) is
      // offered here against any of the player's companies whose current site
      // matches the play-target filter; playing it binds the card to that site.
      // Caverns Unchoked (ba-51) is a Balrog resource permanent-event that
      // likewise declares organization-phase-on-site timing (via its
      // `surface-region-adjacency` effect). Non-Stage site-targeting permanent
      // events without such a marker (e.g. hero events erratated "Playable
      // during the site phase") are handled by the site phase instead.
      const isCavernsUnchoked = def.effects?.some(e => e.type === 'surface-region-adjacency') ?? false;
      const orgPhaseSiteTiming = isStageResource || isCavernsUnchoked;

      // The White Tree (tw-348) is the sole card combining a site play-target
      // with a `discard-named-card` play-condition: "Sage only at Minas
      // Tirith. Playable only if you discard a Sapling of the White Tree…"
      // Unlike the site-tapping / attack-triggering events handled below (and
      // by legal-actions/site.ts), its text declares no site-phase timing, so
      // under rule 2.1.1 it is playable during any phase — it is evaluated
      // directly here rather than deferred to the site phase.
      const discardNamedCardCond = findPlayConditionEffect(def, 'discard-named-card');
      if (!orgPhaseSiteTiming && discardNamedCardCond?.cardName) {
        const targetCardName = discardNamedCardCond.cardName;
        const sources = discardNamedCardCond.sources ?? ['character-items'];
        const charPlayTarget = def.effects?.find(
          (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'character',
        );
        let anyPlayable = false;
        for (const company of player.companies) {
          if (!company.currentSite) continue;
          const siteDefId = company.currentSite.definitionId;
          const siteDef = defById(state, siteDefId);
          if (!siteDef || !isSiteCard(siteDef)) continue;
          if (sitePlayTarget.filter) {
            const matchTarget = buildSiteFilterContext(state, siteDef, company.currentSite.instanceId);
            if (!matchesCondition(sitePlayTarget.filter, matchTarget)) {
              logDetail(`Permanent event ${def.name}: site ${siteDef.name} does not match play-target filter`);
              continue;
            }
          }
          const charFilter = charPlayTarget?.filter;
          if (charFilter) {
            const hasEligibleChar = company.characters.some(charId => {
              const ch = player.characters[charId];
              const charDef = ch && defById(state, ch.definitionId);
              if (!ch || !charDef || !isCharacterCard(charDef)) return false;
              const ctx = { target: { skills: getEffectiveSkills(state, ch, charDef) } };
              return matchesCondition(charFilter, ctx);
            });
            if (!hasEligibleChar) {
              logDetail(`Permanent event ${def.name}: no eligible character at ${siteDef.name}`);
              continue;
            }
          }

          const discardCandidates: { instanceId: CardInstanceId; source: string }[] = [];
          for (const source of sources) {
            if (source === 'character-items') {
              for (const charId of company.characters) {
                const ch = player.characters[charId];
                if (!ch) continue;
                for (const item of ch.items) {
                  const itemDef = defById(state, item.definitionId);
                  if (itemDef && itemDef.name === targetCardName) {
                    discardCandidates.push({ instanceId: item.instanceId, source: 'character-items' });
                  }
                }
              }
            } else if (source === 'kill-pile') {
              for (const card of player.killPile) {
                const cardDef = defById(state, card.definitionId);
                if (cardDef && cardDef.name === targetCardName) {
                  discardCandidates.push({ instanceId: card.instanceId, source: 'kill-pile' });
                }
              }
            }
          }
          if (discardCandidates.length === 0) {
            logDetail(`Permanent event ${def.name}: no ${targetCardName} available to discard at ${siteDef.name}`);
            continue;
          }
          anyPlayable = true;
          for (const dc of discardCandidates) {
            logDetail(`Permanent event ${def.name}: playable at ${siteDef.name} (discard ${dc.instanceId as string} from ${dc.source})`);
            actions.push({
              action: {
                type: 'play-permanent-event', player: playerId, cardInstanceId,
                targetSiteDefinitionId: siteDefId,
                discardCardInstanceId: dc.instanceId,
              },
              viable: true,
            });
          }
        }
        if (!anyPlayable) {
          actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: no eligible site/character or no ${targetCardName} to discard`));
        }
        continue;
      }

      // Return of the King (tw-316): "Only playable in Minas Tirith and only
      // if Denethor II is not in play." Like The White Tree above, its text
      // declares no site-phase timing and it has no tapping/attack/transform
      // mechanics tying it to the site's play-resources step, so under rule
      // 2.1.1 it is playable during any phase as soon as the company is at
      // the matching site — evaluated directly here rather than deferred to
      // the site phase (which would wrongly require `enter-site` first even
      // though the card never asked for that). "At the matching site" per
      // rule 2.IV.5 excludes a company that moved there this turn but hasn't
      // yet reached its own site phase (see `isCompanyAtSite`) — a company
      // is "en route", not at any site, for the rest of the movement/hazard
      // phase after its site card is revealed.
      const cardNotInPlayConds = findPlayConditionEffects(def, 'card-not-in-play');
      if (!orgPhaseSiteTiming && cardNotInPlayConds.length > 0) {
        const charPlayTarget = def.effects?.find(
          (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'character',
        );
        let blockedByCardInPlay = false;
        for (const cond of cardNotInPlayConds) {
          if (cond.cardName && isCardNameInPlayOrCharacters(state, cond.cardName)) {
            logDetail(`Permanent event ${def.name}: blocked because ${cond.cardName} is in play`);
            actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: cannot be played while ${cond.cardName} is in play`));
            blockedByCardInPlay = true;
            break;
          }
        }
        if (blockedByCardInPlay) continue;

        let anyPlayable = false;
        for (const company of player.companies) {
          if (!company.currentSite) continue;
          if (!isCompanyAtSite(state, company)) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} moved this turn and is not yet "at" its site (rule 2.IV.5)`);
            continue;
          }
          const siteDefId = company.currentSite.definitionId;
          const siteDef = defById(state, siteDefId);
          if (!siteDef || !isSiteCard(siteDef)) continue;
          if (sitePlayTarget.filter) {
            const matchTarget = buildSiteFilterContext(state, siteDef, company.currentSite.instanceId);
            if (!matchesCondition(sitePlayTarget.filter, matchTarget)) {
              logDetail(`Permanent event ${def.name}: site ${siteDef.name} does not match play-target filter`);
              continue;
            }
          }
          const charFilter = charPlayTarget?.filter;
          let targetCharacterId: CardInstanceId | undefined;
          if (charFilter) {
            const eligibleCharId = company.characters.find(charId => {
              const ch = player.characters[charId];
              const charDef = ch && defById(state, ch.definitionId);
              if (!ch || !charDef || !isCharacterCard(charDef)) return false;
              const ctx = { target: { name: charDef.name, skills: getEffectiveSkills(state, ch, charDef) } };
              return matchesCondition(charFilter, ctx);
            });
            if (!eligibleCharId) {
              logDetail(`Permanent event ${def.name}: no eligible character at ${siteDef.name}`);
              continue;
            }
            targetCharacterId = eligibleCharId;
          }
          anyPlayable = true;
          logDetail(`Permanent event ${def.name}: playable at ${siteDef.name}`);
          actions.push({
            action: {
              type: 'play-permanent-event', player: playerId, cardInstanceId,
              targetSiteDefinitionId: siteDefId,
              ...(targetCharacterId ? { targetCharacterId } : {}),
            },
            viable: true,
          });
        }
        if (!anyPlayable) {
          actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: no eligible site/character target`));
        }
        continue;
      }

      // Fireworks (dm-130): "Ritual. Playable on an untapped sage at a
      // tapped Border-hold [{B}] or Free-hold [{F}]." It is the sole card
      // combining a site play-target + character play-target with a
      // `roll-untap-site` effect. Its site-tapping siblings (Rescue
      // Prisoners tw-315, Andúril tw-192, Reforging tw-314, …) all print
      // "during the site phase" on their card text and are correctly
      // deferred to the site phase's play-resources step (legal-actions/
      // site.ts) below. Fireworks' text declares no such restriction, so
      // under rule 2.1.1 it is playable during any phase as long as the
      // sage is still untapped and the site is still tapped from an
      // earlier site phase — evaluated directly here, mirroring Return of
      // the King above.
      const rollUntapSiteEffect = def.effects?.find(e => e.type === 'roll-untap-site');
      if (!orgPhaseSiteTiming && rollUntapSiteEffect) {
        const charPlayTarget = def.effects?.find(
          (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'character',
        );
        let anyPlayable = false;
        for (const company of player.companies) {
          if (!company.currentSite) continue;
          const siteDefId = company.currentSite.definitionId;
          const siteDef = defById(state, siteDefId);
          if (!siteDef || !isSiteCard(siteDef)) continue;
          if (hasPlayFlag(def, 'tapped-site-only') && company.currentSite.status !== CardStatus.Tapped) {
            logDetail(`Permanent event ${def.name}: site ${siteDef.name} is not tapped`);
            continue;
          }
          if (sitePlayTarget.filter) {
            const matchTarget = buildSiteFilterContext(state, siteDef, company.currentSite.instanceId);
            if (!matchesCondition(sitePlayTarget.filter, matchTarget)) {
              logDetail(`Permanent event ${def.name}: site ${siteDef.name} does not match play-target filter`);
              continue;
            }
          }
          const charFilter = charPlayTarget?.filter;
          let targetCharacterId: CardInstanceId | undefined;
          if (charFilter) {
            const eligibleCharId = company.characters.find(charId => {
              const ch = player.characters[charId];
              const charDef = ch && defById(state, ch.definitionId);
              if (!ch || !charDef || !isCharacterCard(charDef)) return false;
              const ctx = { target: { name: charDef.name, skills: getEffectiveSkills(state, ch, charDef), status: ch.status } };
              return matchesCondition(charFilter, ctx);
            });
            if (!eligibleCharId) {
              logDetail(`Permanent event ${def.name}: no eligible character at ${siteDef.name}`);
              continue;
            }
            targetCharacterId = eligibleCharId;
          }
          anyPlayable = true;
          logDetail(`Permanent event ${def.name}: playable at ${siteDef.name} (any phase, current ${state.phaseState.phase})`);
          actions.push({
            action: {
              type: 'play-permanent-event', player: playerId, cardInstanceId,
              targetSiteDefinitionId: siteDefId,
              ...(targetCharacterId ? { targetCharacterId } : {}),
            },
            viable: true,
          });
        }
        if (!anyPlayable) {
          actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: no eligible site/character target`));
        }
        continue;
      }

      if (!orgPhaseSiteTiming) {
        logDetail(`Permanent event ${def.name}: requires a site target — only playable during the site phase`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} can only be played during the site phase`));
        continue;
      }
      // Caverns Unchoked (ba-51) is "Playable ... during the organization
      // phase." Stage resources are already blocked outside the organization
      // phase above; block the non-stage Caverns Unchoked here too so the
      // rule-2.1.1 "any phase" allowance does not offer it during movement/hazard.
      if (isCavernsUnchoked && state.phaseState.phase !== Phase.Organization) {
        logDetail(`Permanent event ${def.name}: only playable during the organization phase (current ${state.phaseState.phase})`);
        continue;
      }

      // play-condition: site-protected — the bound site must already carry a
      // `site-protected` constraint owned by this player (Saruman's Machinery
      // wh-120: "Playable on your protected Isengard or The White Towers").
      const siteProtectedCond = findPlayConditionEffect(def, 'site-protected');
      const supportersInRegionCond = findPlayConditionEffect(def, 'supporters-in-region');
      const siteDupLimit = findDuplicationLimitEffect(def, 'site');
      let anySite = false;
      for (const company of player.companies) {
        if (!company.currentSite) continue;
        const siteDefId = company.currentSite.definitionId;
        const siteDef = defById(state, siteDefId);
        if (!siteDef || !isSiteCard(siteDef)) continue;
        if (sitePlayTarget.filter) {
          // The shared site play-target context — the site definition plus its
          // region type, its *effective* type after any wizardhaven-conversion
          // / site-type-override, and the Wizardhaven / protected flags — so
          // filters like Hidden Haven's region gate or Guarded Haven's "your
          // Wizardhaven [{H}]" match dynamically converted sites.
          const matchTarget = buildSiteFilterContext(state, siteDef, company.currentSite.instanceId);
          if (!matchesCondition(sitePlayTarget.filter, matchTarget)) {
            logDetail(`Permanent event ${def.name}: site ${siteDef.name} does not match play-target filter`);
            continue;
          }
        }
        if (siteProtectedCond) {
          const protectedForPlayer = isSiteProtectedForPlayer(state, siteDefId, playerId);
          if (!protectedForPlayer) {
            logDetail(`Permanent event ${def.name}: site ${siteDef.name} is not protected for ${playerId as string}`);
            continue;
          }
        }
        if (siteDupLimit) {
          const copiesAtSite = countPermanentEventCopiesAtSite(state, def.name, siteDefId)
            + countPermanentEventCopiesDeclaredInChainAtSite(state, def.name, siteDefId);
          if (copiesAtSite >= siteDupLimit.max) {
            logDetail(`Permanent event ${def.name}: site duplication limit reached at ${siteDef.name}`);
            continue;
          }
        }
        // play-condition: supporters-in-region — Girdle of Radagast (wh-110):
        // "… 6 allies and/or unique factions in play (the factions must be
        // playable at sites in the Wizardhaven's region or adjacent regions)."
        if (supportersInRegionCond?.min !== undefined) {
          const supporters = girdleSupporterCount(state, player, siteDef);
          if (supporters < supportersInRegionCond.min) {
            logDetail(`Permanent event ${def.name}: only ${supporters} supporter(s) for ${siteDef.name} region, need ${supportersInRegionCond.min}`);
            continue;
          }
        }
        anySite = true;
        logDetail(`Permanent event ${def.name}: playable on site ${siteDef.name}`);
        actions.push({
          action: { type: 'play-permanent-event', player: playerId, cardInstanceId, targetSiteDefinitionId: siteDefId },
          viable: true,
        });
      }
      if (!anySite) {
        logDetail(`Permanent event ${def.name}: no company at a matching site`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} has no valid site target`));
      }
      continue;
    }

    // play-condition: card-not-in-play — blocked if any named card is in play.
    // A card may declare several such conditions (Bade to Rule le-167 forbids
    // both The Lidless Eye le-203 and its sibling Sauron ba-43), so every
    // card-not-in-play condition is checked, not just the first.
    const cardNotInPlayConditions = getCardEffects(def).filter(
      (e): e is import('../../types/effects.js').PlayConditionEffect =>
        e.type === 'play-condition' && e.requires === 'card-not-in-play' && !!e.cardName,
    );
    let blockedByCardInPlay = false;
    for (const cardNotInPlayCondition of cardNotInPlayConditions) {
      const blockerName = cardNotInPlayCondition.cardName!;
      if (isCardNameInPlayOrCharacters(state, blockerName)) {
        logDetail(`Permanent event ${def.name}: blocked because ${blockerName} is in play`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: cannot be played while ${blockerName} is in play`));
        blockedByCardInPlay = true;
        break;
      }
    }
    if (blockedByCardInPlay) continue;

    // play-target DSL: character-targeting permanent events get one action per qualifying character
    const playTarget = def.effects?.find(
      (e): e is PlayTargetEffect => e.type === 'play-target',
    );

    // Item-targeting permanent events (Barrow-blade dm-119: "play this with
    // the Dagger [of Westernesse]") declare their own site-phase timing and
    // are handled entirely by the site-phase path (legal-actions/site.ts),
    // which validates the site-type play-condition, taps the bearer, and
    // attaches the card to a specific item. Excluded here so rule 2.1.1's
    // "any phase" allowance does not let it fall through to the generic
    // untargeted fallback below and be offered without a site or item.
    if (playTarget?.target === 'item') {
      logDetail(`Permanent event ${def.name}: item-targeting — only playable during the site phase`);
      continue;
    }

    if (playTarget?.target === 'character') {
      const opposedRollEffect = def.effects?.find(
        (e): e is import('../../types/effects.js').OpposedRollEffect => e.type === 'opposed-roll',
      );
      const charDupLimit = findDuplicationLimitEffect(def, 'character');
      const companyDupLimit = findDuplicationLimitEffect(def, 'company');
      // play-condition: site-type — the character's company must be at one of the required site types
      const siteTypeCondition = findPlayConditionEffect(def, 'site-type');
      // play-condition: same-site-has-character-race — a company at the same site must have a character of the given race
      const sameSiteRaceCondition = findPlayConditionEffect(def, 'same-site-has-character-race');
      // play-condition: site-path — the character's own company must be the M/H phase's
      // currently-active *moving* company, and its resolved site path must satisfy the
      // condition (e.g. Herb-lore dm-136: "at least one Wilderness in his site path").
      // Combined with a `play-window { phase: "movement-hazard" }`, this realizes
      // "Playable on <character> while moving during his movement/hazard phase".
      const sitePathCondition = findPlayConditionEffect(def, 'site-path');
      // play-condition: company-context — a generic DSL condition on the target
      // character's company (To Fealty Sworn ba-33). During the organization
      // phase no faction has been played this site phase, so the
      // `playedUniqueHeroFactionAtFreeHold` flag is always false here — only the
      // "in the same company as <named card>" alternative can be satisfied.
      const companyContextCondition = findPlayConditionEffect(def, 'company-context');
      // The player's revealed avatar, so a `play-target` filter can express
      // "on your Ringwraith"/"on your Wizard" (While the Yellow Face Sleeps
      // le-255) as `target.isRevealedAvatar`. Ringwraith *followers* are
      // avatar-race characters too, but they are controlled by the revealed
      // avatar rather than being it — `findPlayerAvatar` returns only the
      // generally-controlled one, so followers never match.
      const revealedAvatarId = findPlayerAvatar(state, player)?.instanceId;
      let anyTarget = false;
      for (const company of player.companies) {
        if (companyContextCondition?.condition
          && !matchesCompanyContextCondition(state, player, company, companyContextCondition.condition, false)) {
          logDetail(`Permanent event ${def.name}: company ${company.id as string} does not satisfy company-context play-condition`);
          continue;
        }
        if (siteTypeCondition) {
          const siteDef = company.currentSite ? defById(state, company.currentSite.definitionId) : null;
          const companySiteType = siteDef && 'siteType' in siteDef ? (siteDef as { siteType: string }).siteType : null;
          if (!companySiteType || !siteTypeCondition.siteTypes?.includes(companySiteType)) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} not at required site type [${siteTypeCondition.siteTypes?.join(', ') ?? '?'}] (actual: ${companySiteType ?? 'none'})`);
            continue;
          }
        }
        if (sitePathCondition) {
          const mhPs = state.phaseState as import('../../types/state-phases.js').MovementHazardPhaseState;
          const isActiveMovingCompany = mhPs.phase === Phase.MovementHazard && mhPs.siteRevealed
            && player.companies[mhPs.activeCompanyIndex]?.id === company.id;
          if (!isActiveMovingCompany) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} is not the M/H phase's currently-moving company — site-path condition not evaluable`);
            continue;
          }
          const sitePathCtx = { sitePath: regionTypeCounts(mhPs.resolvedSitePath) };
          if (sitePathCondition.condition && !matchesCondition(sitePathCondition.condition, sitePathCtx)) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} site path does not satisfy site-path play-condition`);
            continue;
          }
        }
        if (sameSiteRaceCondition?.race) {
          const requiredRace = sameSiteRaceCondition.race;
          const companySiteId = company.currentSite?.definitionId;
          const racePresent = player.companies.some(otherCompany => {
            if (!companySiteId || otherCompany.currentSite?.definitionId !== companySiteId) return false;
            return otherCompany.characters.some(cId => {
              const ch = player.characters[cId];
              if (!ch) return false;
              const cDef = defById(state, ch.definitionId);
              return cDef && 'race' in cDef && (cDef as { race?: Race }).race === requiredRace;
            });
          });
          if (!racePresent) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} has no ${requiredRace} at the same site`);
            continue;
          }
        }
        if (companyDupLimit) {
          const copiesInCompany = countAttachedInCompany(state, player, company, def.name, 'items');
          if (copiesInCompany >= companyDupLimit.max) {
            logDetail(`Permanent event ${def.name}: company duplication limit reached (${copiesInCompany}/${companyDupLimit.max})`);
            continue;
          }
        }
        const companySkills = company.characters.flatMap(cId => {
          const ch = player.characters[cId];
          if (!ch) return [];
          const cDef = defById(state, ch.definitionId);
          return cDef && isCharacterCard(cDef) ? getEffectiveSkills(state, ch, cDef) : [];
        });
        // True if the company contains any character who can use shadow-magic:
        // ringwraiths can use it by default; others need the "shadow-magic" skill.
        const hasShadowMagicUser = company.characters.some(cId => {
          const ch = player.characters[cId];
          if (!ch) return false;
          const cDef = defById(state, ch.definitionId);
          if (!cDef || !isCharacterCard(cDef)) return false;
          if ((cDef as { race?: Race }).race === Race.Ringwraith) return true;
          return getEffectiveSkills(state, ch, cDef as { skills?: readonly string[] }).includes('shadow-magic');
        });
        for (const charId of company.characters) {
          const charData = player.characters[charId];
          if (!charData) continue;
          const charDef = defById(state, charData.definitionId);
          if (!charDef || !isCharacterCard(charDef)) continue;
          if (playTarget.filter) {
            const itemKeywords = itemKeywordsOf(state, charData.items);
            const itemNames = defNamesOf(state, charData.items);
            const ctx = {
              target: {
                race: charDef.race,
                status: charData.status,
                skills: getEffectiveSkills(state, charData, charDef),
                name: charDef.name,
                // Mind cost of the character (null for avatars). Lets a card
                // gate on the printed mind, e.g. Awaiting the Call (le-165)
                // "on a character with a mind of 6 or less".
                mind: charDef.mind,
                keywords: (charDef as { keywords?: readonly string[] }).keywords ?? [],
                itemKeywords,
                itemNames,
                isAvatar: isAvatarCharacter(charDef),
                isRevealedAvatar: revealedAvatarId === charId,
                // Printed site types of the character's home sites, so a filter
                // can gate on "who has a Border-hold or Free-hold as a home
                // site" (Faithless Steward as-83).
                homeSiteTypes: characterHomeSiteTypes(state, charDef),
              },
              company: { skills: companySkills, hasShadowMagicUser },
            };
            if (!matchesCondition(playTarget.filter, ctx)) continue;
          }
          if (charDupLimit) {
            const copiesOnChar = charData.items.filter(item => {
              const iDef = defById(state, item.definitionId);
              return iDef && iDef.name === def.name;
            }).length;
            if (copiesOnChar >= charDupLimit.max) {
              logDetail(`Permanent event ${def.name}: duplication limit on ${charDef.name}`);
              continue;
            }
          }
          // opposed-roll (No More Nonsense le-210): "Choose another character
          // in the company and do the same." The second roller is picked at
          // play time, so cross this target with every *other* character in its
          // company; a company with no other character offers no play at all.
          if (opposedRollEffect?.opponent === 'chosen-company-member') {
            const others = company.characters.filter(otherId => otherId !== charId && player.characters[otherId]);
            if (others.length === 0) {
              logDetail(`Permanent event ${def.name}: ${charDef.name} has no other character in his company to roll against`);
              continue;
            }
            for (const otherId of others) {
              anyTarget = true;
              logDetail(`Permanent event ${def.name}: playable on ${charDef.name} opposed by ${cardName(state, player.characters[otherId].definitionId)}`);
              actions.push({
                action: {
                  type: 'play-permanent-event', player: playerId, cardInstanceId,
                  targetCharacterId: charId, opposedCharacterId: otherId,
                },
                viable: true,
              });
            }
            continue;
          }
          anyTarget = true;
          logDetail(`Permanent event ${def.name}: playable on ${charDef.name}`);
          actions.push({
            action: { type: 'play-permanent-event', player: playerId, cardInstanceId, targetCharacterId: charId },
            viable: true,
          });
        }
      }
      if (!anyTarget) {
        // play-option { untargeted: true }: an alternative mode that needs no
        // character target at all when its `when` condition holds (Bade to
        // Rule le-167: "Alternatively, playable if your Ringwraith is not in
        // play."). Evaluated against the same player-state context as the
        // `player-state` play-condition above, since the option's `when`
        // describes the *player's* situation, not a specific target. The card
        // enters play bare in `cardsInPlay` and, for le-167, later attaches
        // itself via `on-event: avatar-enters-play`.
        const untargetedOption = def.effects?.find(
          (e): e is import('../../types/effects.js').PlayOptionEffect =>
            e.type === 'play-option' && e.untargeted === true,
        );
        const untargetedApplies = untargetedOption
          && (!untargetedOption.when || matchesCondition(untargetedOption.when, buildPlayerStateContext(state, player, playerId)));
        if (untargetedApplies) {
          logDetail(`Permanent event ${def.name}: no matching character target — untargeted play-option "${untargetedOption.id}" applies`);
          actions.push({
            action: { type: 'play-permanent-event', player: playerId, cardInstanceId },
            viable: true,
          });
        } else {
          logDetail(`Permanent event ${def.name}: no valid target`);
          actions.push(notPlayable(playerId, cardInstanceId, `${def.name} has no valid target`));
        }
      }
      continue;
    }

    // play-target DSL: company-targeting permanent events get one action per qualifying company
    if (playTarget?.target === 'company') {
      const companyDupLimit = findDuplicationLimitEffect(def, 'company');
      // MEWH §9: a Fallen-wizard may not play a hero resource permanent-event on
      // a company containing an Orc or Troll.
      const heroEventForFw = player.alignment === 'fallen-wizard'
        && (def as { alignment?: string }).alignment === 'wizard';
      let anyTarget = false;
      for (const company of player.companies) {
        if (!company.currentSite) continue;
        if (heroEventForFw && companyHasOrcOrTroll(state, company, player)) {
          logDetail(`Permanent event ${def.name}: hero resource cannot be played on company ${company.id as string} — contains an Orc/Troll (MEWH §9)`);
          continue;
        }
        // Stormcrow (td-73): "No such cards may be played on each Wizard's
        // company." A resource permanent-event played on the company as a whole
        // is barred from any company containing a prohibited race (a Wizard).
        if (isCompanyEventPlayProhibited(state, player, company)) {
          logDetail(`Permanent event ${def.name}: cannot be played on company ${company.id as string} — a Stormcrow-style effect prohibits company events there`);
          continue;
        }
        const siteDef = defById(state, company.currentSite.definitionId);
        if (!siteDef || !('siteType' in siteDef)) continue;
        const siteType = (siteDef as { siteType: string }).siteType;
        // Count members: characters + allies attached to all characters
        const allyCount = company.characters.reduce((sum, cId) => {
          const ch = player.characters[cId];
          return sum + (ch ? ch.allies.length : 0);
        }, 0);
        const memberCount = company.characters.length + allyCount;
        // Company duplication limit: check cardsInPlay bound to this company
        if (companyDupLimit) {
          const existingCopies = countCompanyBoundCopies(state, def.name, company.id);
          if (existingCopies >= companyDupLimit.max) {
            logDetail(`Permanent event ${def.name}: company duplication limit reached on ${company.id as string} (${existingCopies}/${companyDupLimit.max})`);
            continue;
          }
        }
        if (playTarget.filter) {
          const overt = !isCovertCompany(company, player, state);
          const orcCount = company.characters.reduce((n, cId) => {
            const ch = player.characters[cId];
            if (!ch) return n;
            const cDef = defById(state, ch.definitionId);
            return n + (cDef && 'race' in cDef && (cDef as { race: Race }).race === Race.Orc ? 1 : 0);
          }, 0);
          const hasRingwraith = company.characters.some(cId => {
            const ch = player.characters[cId];
            if (!ch) return false;
            const cDef = defById(state, ch.definitionId);
            return cDef && 'race' in cDef && (cDef as { race: Race }).race === Race.Ringwraith;
          });
          const ctx = { target: { siteType, memberCount, overt, orcCount, hasRingwraith } };
          if (!matchesCondition(playTarget.filter, ctx)) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} filter not met (siteType=${siteType}, memberCount=${memberCount}, overt=${String(overt)}, orcCount=${orcCount}, hasRingwraith=${String(hasRingwraith)})`);
            continue;
          }
        }
        // play-condition: discard-keyword-card — "Playable on a company if the
        // company discards (for no effect) a Stolen Knowledge card it
        // controls" (Pass the Doors of Dol Guldur dm-154). Emit one action per
        // discardable candidate so the player picks which card is spent; a
        // company controlling none cannot play the card at all.
        const keywordDiscardCond = findPlayConditionEffect(def, 'discard-keyword-card');
        if (keywordDiscardCond) {
          const candidates = keywordDiscardCandidates(state, player, company, keywordDiscardCond);
          if (candidates.length === 0) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} controls no "${keywordDiscardCond.cardKeyword ?? '?'}" card to discard`);
            continue;
          }
          anyTarget = true;
          for (const candidate of candidates) {
            logDetail(`Permanent event ${def.name}: playable on company ${company.id as string} by discarding ${candidate.name} (${candidate.source})`);
            actions.push({
              action: {
                type: 'play-permanent-event', player: playerId, cardInstanceId,
                targetCompanyId: company.id,
                discardCardInstanceId: candidate.instanceId,
              },
              viable: true,
            });
          }
          continue;
        }

        anyTarget = true;
        logDetail(`Permanent event ${def.name}: playable on company ${company.id as string} (siteType=${siteType}, memberCount=${memberCount})`);
        actions.push({
          action: { type: 'play-permanent-event', player: playerId, cardInstanceId, targetCompanyId: company.id },
          viable: true,
        });
      }
      if (!anyTarget) {
        logDetail(`Permanent event ${def.name}: no valid company target`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} requires a qualifying company`));
      }
      continue;
    }

    // play-target DSL: faction-targeting permanent events (Long Grievous Siege
    // ba-40) get one action per qualifying own in-play faction — crossed with
    // one eligible location-deck site per `faction-siege` effect (CRF: "There
    // must be an eligible borderhold for this card to be played").
    if (playTarget?.target === 'faction') {
      const factionDupLimit = findDuplicationLimitEffect(def, 'faction');
      const siege = def.effects?.find(
        (e): e is import('../../types/effects.js').FactionSiegeEffect => e.type === 'faction-siege',
      );
      let anyTarget = false;
      for (const cip of player.cardsInPlay) {
        if (isSetAsideCard(cip)) continue;
        const factionDef = defById(state, cip.definitionId);
        if (!factionDef || !isFactionCard(factionDef)) continue;
        if (playTarget.filter) {
          const ctx = {
            target: {
              name: factionDef.name,
              race: factionDef.race,
              unique: factionDef.unique,
            },
          };
          if (!matchesCondition(playTarget.filter, ctx)) {
            logDetail(`Permanent event ${def.name}: faction ${factionDef.name} does not match play-target filter`);
            continue;
          }
        }
        if (factionDupLimit) {
          const copiesOnFaction = countFactionAttachedCopies(state, def.name, cip.instanceId);
          if (copiesOnFaction >= factionDupLimit.max) {
            logDetail(`Permanent event ${def.name}: duplication limit on faction ${factionDef.name} (${copiesOnFaction}/${factionDupLimit.max})`);
            continue;
          }
        }
        if (siege) {
          const eligibleSites = factionSiegeEligibleSites(state, player, factionDef, siege);
          if (eligibleSites.length === 0) {
            logDetail(`Permanent event ${def.name}: no eligible ${siege.siteType} in location deck for faction ${factionDef.name}`);
            continue;
          }
          for (const siteInst of eligibleSites) {
            anyTarget = true;
            logDetail(`Permanent event ${def.name}: playable on faction ${factionDef.name}, besieging ${defById(state, siteInst.definitionId)?.name ?? '?'}`);
            actions.push({
              action: {
                type: 'play-permanent-event', player: playerId, cardInstanceId,
                targetFactionInstanceId: cip.instanceId,
                besiegedSiteInstanceId: siteInst.instanceId,
              },
              viable: true,
            });
          }
        } else {
          anyTarget = true;
          logDetail(`Permanent event ${def.name}: playable on faction ${factionDef.name}`);
          actions.push({
            action: { type: 'play-permanent-event', player: playerId, cardInstanceId, targetFactionInstanceId: cip.instanceId },
            viable: true,
          });
        }
      }
      if (!anyTarget) {
        logDetail(`Permanent event ${def.name}: no valid faction target`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} has no valid faction target`));
      }
      continue;
    }

    // play-target DSL: long-event-targeting permanent events (Echo of All Joy
    // td-110) get one action per qualifying own in-play resource long-event.
    // The chosen instance rides on `targetLongEventInstanceId` and the resolved
    // card is bound via `CardInPlay.attachedToLongEvent`.
    if (playTarget?.target === 'long-event') {
      let anyTarget = false;
      for (const cip of player.cardsInPlay) {
        if (isSetAsideCard(cip)) continue;
        const longEventDef = defById(state, cip.definitionId);
        if (!longEventDef || longEventDef.cardType !== 'hero-resource-event' || longEventDef.eventType !== 'long') continue;
        if (playTarget.filter) {
          const ctx = { target: { name: longEventDef.name } };
          if (!matchesCondition(playTarget.filter, ctx)) {
            logDetail(`Permanent event ${def.name}: long-event ${longEventDef.name} does not match play-target filter`);
            continue;
          }
        }
        anyTarget = true;
        logDetail(`Permanent event ${def.name}: playable on long-event ${longEventDef.name}`);
        actions.push({
          action: { type: 'play-permanent-event', player: playerId, cardInstanceId, targetLongEventInstanceId: cip.instanceId },
          viable: true,
        });
      }
      if (!anyTarget) {
        logDetail(`Permanent event ${def.name}: no valid long-event target`);
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name} has no valid long-event target`));
      }
      continue;
    }

    logDetail(`Permanent event ${def.name}: playable`);
    actions.push({
      action: { type: 'play-permanent-event', player: playerId, cardInstanceId },
      viable: true,
    });
  }

  return actions;
}

/**
 * Evaluates short-event cards with `playable-as-resource` in hand (e.g. Twilight).
 * These cancel and discard an environment card in play. One action is offered per
 * valid (card, target) pair. If no environment is in play the card is not playable.
 */
export function playShortEventActions(state: GameState, playerId: PlayerId): EvaluatedAction[] {
  const player = playerById(state, playerId)!;
  const actions: EvaluatedAction[] = [];

  for (const handCard of player.hand) {
    const cardInstanceId = handCard.instanceId;
    const def = state.cardPool[handCard.definitionId] as HazardEventCard | undefined;
    if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'short') continue;

    // Only cards with the playable-as-resource flag
    if (!hasPlayFlag(def, 'playable-as-resource')) continue;

    // Tookish Blood (tw-104) resource mode: "played as a resource card" on one
    // of the controller's own Hobbit characters, protecting it from discard /
    // return-to-hand for the rest of the turn. Offer one action per own
    // character matching the companion `play-target` filter (Hobbit).
    const protectEffect = getCardEffects(def).find(e => e.type === 'protect-from-removal');
    if (protectEffect) {
      const playTarget = getCardEffects(def).find(
        (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'character',
      );
      let anyTarget = false;
      for (const [charId, charData] of Object.entries(player.characters)) {
        const charDef = defById(state, charData.definitionId);
        if (!charDef || !isCharacterCard(charDef)) continue;
        if (playTarget?.filter) {
          const ctx = {
            target: {
              race: charDef.race,
              skills: charDef.skills,
              name: charDef.name,
              possessions: defNamesOf(state, charData.items),
              itemKeywords: itemKeywordsOf(state, charData.items),
              itemSubtypes: itemSubtypesOf(state, charData.items),
            },
          };
          if (!matchesCondition(playTarget.filter, ctx)) continue;
        }
        anyTarget = true;
        logDetail(`Resource short event ${def.name}: can protect ${charDef.name} from removal this turn`);
        actions.push({
          action: {
            type: 'play-short-event',
            player: playerId,
            cardInstanceId,
            targetCharacterId: charId as CardInstanceId,
          },
          viable: true,
        });
      }
      if (!anyTarget) {
        actions.push(notPlayable(playerId, cardInstanceId, `${def.name}: no eligible character to protect`));
      }
      continue;
    }

    // Find environment cards — in a player's cardsInPlay (permanent events
    // like Doors of Night / Gates of Morning), or declared earlier in the
    // same chain of effects.
    const envTargets = findEnvironmentTargets(state, { mayTargetSetAside: cardTargetsSetAside(def) });

    if (envTargets.length === 0) {
      logDetail(`Short event ${def.name}: no environment in play to cancel`);
      actions.push(notPlayable(playerId, cardInstanceId, 'No environment to cancel'));
      continue;
    }

    for (const target of envTargets) {
      const targetDef = state.cardPool[target.definitionId as CardDefinitionId];
      logDetail(`Short event ${def.name}: can cancel environment ${targetDef?.name ?? target.definitionId}`);
      actions.push({
        action: {
          type: 'play-short-event',
          player: playerId,
          cardInstanceId,
          targetInstanceId: target.instanceId,
        },
        viable: true,
      });
    }
  }

  return actions;
}
