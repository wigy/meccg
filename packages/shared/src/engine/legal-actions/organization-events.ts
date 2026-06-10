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
  HeroResourceEventCard,
  MinionResourceEventCard,
  HazardEventCard,
  PlayTargetEffect,
  DuplicationLimitEffect,
  PlayConditionEffect,
} from '../../index.js';
import { hasPlayFlag, matchesCondition, isCharacterCard, isAvatarCharacter, Race } from '../../index.js';
import { getItemGrantedSkills } from '../effects/index.js';
import { logDetail } from './log.js';
import { playerById, defById, countCopiesInPlay, defNamesOf, itemKeywordsOf, isCardNameInPlayOrCharacters, isCovertCompany } from '../reducer-utils.js';

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
    const def = state.cardPool[handCard.definitionId as string] as HeroResourceEventCard | MinionResourceEventCard | undefined;
    if (!def || (def.cardType !== 'hero-resource-event' && def.cardType !== 'minion-resource-event') || def.eventType !== 'permanent') continue;

    // Check uniqueness: unique permanent events can't be played if already in play
    if (def.unique) {
      const alreadyInPlay = countCopiesInPlay(state, def.name) > 0;
      if (alreadyInPlay) {
        logDetail(`Permanent event ${def.name}: unique and already in play`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name} is unique and already in play`,
        });
        continue;
      }
    }

    // Check duplication-limit with scope "game": cannot play if a copy is already in play
    const dupLimit = def.effects?.find((e): e is import('../../index.js').DuplicationLimitEffect => {
      if (e.type !== 'duplication-limit') return false;
      return e.scope === 'game';
    });
    if (dupLimit) {
      const copiesInPlay = countCopiesInPlay(state, def.name);
      if (copiesInPlay >= dupLimit.max) {
        logDetail(`Permanent event ${def.name}: cannot be duplicated (${copiesInPlay}/${dupLimit.max} in play)`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name} cannot be duplicated`,
        });
        continue;
      }
    }

    // Check duplication-limit with scope "player": each player independently limited
    const playerDupLimit = def.effects?.find(
      (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'player',
    );
    if (playerDupLimit) {
      let copiesOwned = player.cardsInPlay.filter(c => {
        const cDef = defById(state, c.definitionId);
        return cDef && cDef.name === def.name;
      }).length;
      for (const ch of Object.values(player.characters)) {
        copiesOwned += ch.items.filter(i => {
          const iDef = defById(state, i.definitionId);
          return iDef && iDef.name === def.name;
        }).length;
      }
      if (copiesOwned >= playerDupLimit.max) {
        logDetail(`Permanent event ${def.name}: player duplication limit reached (${copiesOwned}/${playerDupLimit.max})`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name} cannot be duplicated by a given player`,
        });
        continue;
      }
    }

    // play-target DSL: cards targeting a site can only be played during the site phase
    const sitePlayTarget = def.effects?.find(
      (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'site',
    );
    if (sitePlayTarget) {
      logDetail(`Permanent event ${def.name}: requires a site target — only playable during the site phase`);
      actions.push({
        action: { type: 'not-playable', player: playerId, cardInstanceId },
        viable: false,
        reason: `${def.name} can only be played during the site phase`,
      });
      continue;
    }

    // play-condition: card-not-in-play — blocked if named card is in play
    const cardNotInPlayCondition = def.effects?.find(
      (e): e is PlayConditionEffect => e.type === 'play-condition' && e.requires === 'card-not-in-play',
    );
    if (cardNotInPlayCondition?.cardName) {
      const blockerName = cardNotInPlayCondition.cardName;
      const blockerInPlay = isCardNameInPlayOrCharacters(state, blockerName);
      if (blockerInPlay) {
        logDetail(`Permanent event ${def.name}: blocked because ${blockerName} is in play`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name}: cannot be played while ${blockerName} is in play`,
        });
        continue;
      }
    }

    // play-target DSL: character-targeting permanent events get one action per qualifying character
    const playTarget = def.effects?.find(
      (e): e is PlayTargetEffect => e.type === 'play-target',
    );
    if (playTarget?.target === 'character') {
      const charDupLimit = def.effects?.find(
        (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'character',
      );
      const companyDupLimit = def.effects?.find(
        (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'company',
      );
      // play-condition: site-type — the character's company must be at one of the required site types
      const siteTypeCondition = def.effects?.find(
        (e): e is PlayConditionEffect => e.type === 'play-condition' && e.requires === 'site-type',
      );
      // play-condition: same-site-has-character-race — a company at the same site must have a character of the given race
      const sameSiteRaceCondition = def.effects?.find(
        (e): e is PlayConditionEffect => e.type === 'play-condition' && e.requires === 'same-site-has-character-race',
      );
      let anyTarget = false;
      for (const company of player.companies) {
        if (siteTypeCondition) {
          const siteDef = company.currentSite ? defById(state, company.currentSite.definitionId) : null;
          const companySiteType = siteDef && 'siteType' in siteDef ? (siteDef as { siteType: string }).siteType : null;
          if (!companySiteType || !siteTypeCondition.siteTypes?.includes(companySiteType)) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} not at required site type [${siteTypeCondition.siteTypes?.join(', ') ?? '?'}] (actual: ${companySiteType ?? 'none'})`);
            continue;
          }
        }
        if (sameSiteRaceCondition?.race) {
          const requiredRace = sameSiteRaceCondition.race;
          const companySiteId = company.currentSite?.definitionId;
          const racePresent = player.companies.some(otherCompany => {
            if (!companySiteId || otherCompany.currentSite?.definitionId !== companySiteId) return false;
            return otherCompany.characters.some(cId => {
              const ch = player.characters[cId as string];
              if (!ch) return false;
              const cDef = defById(state, ch.definitionId);
              return cDef && 'race' in cDef && (cDef as { race?: string }).race === requiredRace;
            });
          });
          if (!racePresent) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} has no ${requiredRace} at the same site`);
            continue;
          }
        }
        if (companyDupLimit) {
          const copiesInCompany = company.characters.reduce((count, cId) => {
            const ch = player.characters[cId as string];
            if (!ch) return count;
            return count + ch.items.filter(item => {
              const iDef = defById(state, item.definitionId);
              return iDef && iDef.name === def.name;
            }).length;
          }, 0);
          if (copiesInCompany >= companyDupLimit.max) {
            logDetail(`Permanent event ${def.name}: company duplication limit reached (${copiesInCompany}/${companyDupLimit.max})`);
            continue;
          }
        }
        const companySkills = company.characters.flatMap(cId => {
          const ch = player.characters[cId as string];
          if (!ch) return [];
          const cDef = defById(state, ch.definitionId);
          return cDef && isCharacterCard(cDef) ? [...cDef.skills, ...getItemGrantedSkills(state, ch)] : [];
        });
        // True if the company contains any character who can use shadow-magic:
        // ringwraiths can use it by default; others need the "shadow-magic" skill.
        const hasShadowMagicUser = company.characters.some(cId => {
          const ch = player.characters[cId as string];
          if (!ch) return false;
          const cDef = defById(state, ch.definitionId);
          if (!cDef || !isCharacterCard(cDef)) return false;
          if ((cDef as { race?: string }).race === 'ringwraith') return true;
          return [...(cDef as { skills?: readonly string[] }).skills ?? [], ...getItemGrantedSkills(state, ch)].includes('shadow-magic');
        });
        for (const charId of company.characters) {
          const charData = player.characters[charId as string];
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
                skills: [...charDef.skills, ...getItemGrantedSkills(state, charData)],
                name: charDef.name,
                keywords: (charDef as { keywords?: readonly string[] }).keywords ?? [],
                itemKeywords,
                itemNames,
                isAvatar: isAvatarCharacter(charDef),
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
          anyTarget = true;
          logDetail(`Permanent event ${def.name}: playable on ${charDef.name}`);
          actions.push({
            action: { type: 'play-permanent-event', player: playerId, cardInstanceId, targetCharacterId: charId },
            viable: true,
          });
        }
      }
      if (!anyTarget) {
        logDetail(`Permanent event ${def.name}: no valid target`);
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name} has no valid target`,
        });
      }
      continue;
    }

    // play-target DSL: company-targeting permanent events get one action per qualifying company
    if (playTarget?.target === 'company') {
      const companyDupLimit = def.effects?.find(
        (e): e is DuplicationLimitEffect => e.type === 'duplication-limit' && e.scope === 'company',
      );
      let anyTarget = false;
      for (const company of player.companies) {
        if (!company.currentSite) continue;
        const siteDef = defById(state, company.currentSite.definitionId);
        if (!siteDef || !('siteType' in siteDef)) continue;
        const siteType = (siteDef as { siteType: string }).siteType;
        // Count members: characters + allies attached to all characters
        const allyCount = company.characters.reduce((sum, cId) => {
          const ch = player.characters[cId as string];
          return sum + (ch ? ch.allies.length : 0);
        }, 0);
        const memberCount = company.characters.length + allyCount;
        // Company duplication limit: check cardsInPlay bound to this company
        if (companyDupLimit) {
          const existingCopies = state.players.reduce((count, p) =>
            count + p.cardsInPlay.filter(c => {
              const cDef = defById(state, c.definitionId);
              return cDef && cDef.name === def.name && (c.companyId as string | undefined) === (company.id as string);
            }).length, 0,
          );
          if (existingCopies >= companyDupLimit.max) {
            logDetail(`Permanent event ${def.name}: company duplication limit reached on ${company.id as string} (${existingCopies}/${companyDupLimit.max})`);
            continue;
          }
        }
        if (playTarget.filter) {
          const overt = !isCovertCompany(company, player, state);
          const orcCount = company.characters.reduce((n, cId) => {
            const ch = player.characters[cId as string];
            if (!ch) return n;
            const cDef = defById(state, ch.definitionId);
            return n + (cDef && 'race' in cDef && (cDef as { race: string }).race === Race.Orc ? 1 : 0);
          }, 0);
          const ctx = { target: { siteType, memberCount, overt, orcCount } };
          if (!matchesCondition(playTarget.filter, ctx)) {
            logDetail(`Permanent event ${def.name}: company ${company.id as string} filter not met (siteType=${siteType}, memberCount=${memberCount}, overt=${String(overt)}, orcCount=${orcCount})`);
            continue;
          }
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
        actions.push({
          action: { type: 'not-playable', player: playerId, cardInstanceId },
          viable: false,
          reason: `${def.name} requires a qualifying company`,
        });
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
    const def = state.cardPool[handCard.definitionId as string] as HazardEventCard | undefined;
    if (!def || def.cardType !== 'hazard-event' || def.eventType !== 'short') continue;

    // Only cards with the playable-as-resource flag
    if (!hasPlayFlag(def, 'playable-as-resource')) continue;

    // Find environment cards — in a player's cardsInPlay (permanent events
    // like Doors of Night / Gates of Morning), or declared earlier in the
    // same chain of effects.
    const isEnv = (defId: string): boolean => {
      const d = state.cardPool[defId];
      return !!d && 'keywords' in d
        && !!(d as { keywords?: readonly string[] }).keywords?.includes('environment');
    };
    const envTargets: { instanceId: CardInstanceId; definitionId: string }[] = [];
    for (const p of state.players) {
      for (const c of p.cardsInPlay) {
        if (isEnv(c.definitionId as string)) envTargets.push(c);
      }
    }
    // Chain entries: environments declared earlier in the same chain
    if (state.chain) {
      for (const entry of state.chain.entries) {
        if (entry.resolved || entry.negated) continue;
        if (!entry.card) continue;
        if (isEnv(entry.card.definitionId as string)) {
          envTargets.push({ instanceId: entry.card.instanceId, definitionId: entry.card.definitionId as string });
        }
      }
    }

    if (envTargets.length === 0) {
      logDetail(`Short event ${def.name}: no environment in play to cancel`);
      actions.push({
        action: { type: 'not-playable', player: playerId, cardInstanceId },
        viable: false,
        reason: 'No environment to cancel',
      });
      continue;
    }

    for (const target of envTargets) {
      const targetDef = state.cardPool[target.definitionId];
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
