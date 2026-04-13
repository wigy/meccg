/**
 * @module format-actions
 *
 * Human-readable descriptions for game actions and company naming.
 * Converts GameAction objects into text strings that explain what each
 * action does, resolving card IDs to names where possible.
 */

import type { CardDefinition } from './types/cards.js';
import { isCharacterCard } from './types/cards.js';
import type { Company, CharacterInPlay } from './types/state.js';
import type { GameAction } from './types/actions.js';
import type { CardInstanceId, CardDefinitionId, CompanyId } from './types/common.js';
import { UNKNOWN_CARD, UNKNOWN_SITE } from './card-ids.js';
import { formatCardName } from './format-cards.js';
import type { InstanceLookup } from './format-helpers.js';

// ---- Company naming ----

/**
 * Determine the title character for a company.
 *
 * The title character is chosen by:
 * 1. An avatar (mind === null) is always the title character.
 * 2. Otherwise, highest mind, then MP, then prowess, then alphabetical name.
 */
export function getTitleCharacter(
  characters: readonly { toString(): string }[],
  charMap: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): CharacterInPlay | undefined {
  // Avatar is always the title character if present
  for (const charInstId of characters) {
    const char = charMap[charInstId as string];
    if (!char) continue;
    const def = cardPool[char.definitionId as string];
    if (def && isCharacterCard(def) && def.mind === null) {
      return char;
    }
  }

  let titleChar: CharacterInPlay | undefined;
  let bestMind = -Infinity;
  let bestMP = -Infinity;
  let bestProwess = -Infinity;
  let bestName = '';

  for (const charInstId of characters) {
    const char = charMap[charInstId as string];
    if (!char) continue;
    const def = cardPool[char.definitionId as string];
    if (!def || !isCharacterCard(def)) continue;

    const mind = def.mind ?? 0;
    const mp = def.marshallingPoints;
    const prowess = char.effectiveStats.prowess;
    const name = def.name;

    if (
      mind > bestMind ||
      (mind === bestMind && mp > bestMP) ||
      (mind === bestMind && mp === bestMP && prowess > bestProwess) ||
      (mind === bestMind && mp === bestMP && prowess === bestProwess && name < bestName)
    ) {
      titleChar = char;
      bestMind = mind;
      bestMP = mp;
      bestProwess = prowess;
      bestName = name;
    }
  }
  return titleChar;
}

/**
 * Build a mapping from CompanyId to human-readable company name (e.g. "Aragorn's company")
 * using the lead character's name. Pass the result to {@link describeAction}.
 */
export function buildCompanyNames(
  companies: readonly Company[],
  characters: Readonly<Record<string, CharacterInPlay>>,
  cardPool: Readonly<Record<string, CardDefinition>>,
): Readonly<Record<string, string>> {
  const names: Record<string, string> = {};
  for (const company of companies) {
    if (company.characters.length === 0) {
      names[company.id as string] = `empty company`;
      continue;
    }
    const titleChar = getTitleCharacter(company.characters, characters, cardPool);
    if (titleChar) {
      const def = cardPool[titleChar.definitionId as string];
      names[company.id as string] = def ? `${def.name}'s company` : `company`;
    } else {
      names[company.id as string] = `company`;
    }
  }
  return names;
}

// ---- Action description ----

/**
 * Returns a human-readable description of a game action, resolving card
 * definition IDs to colored names where possible.
 *
 * @param instanceLookup - Optional map from instance ID to definition ID,
 *   used to resolve instance IDs to colored card names. Without it, instance
 *   IDs are shown as raw `{id}`. Matches the shape of
 *   {@link PlayerView.visibleInstances}.
 */
export function describeAction(
  action: GameAction,
  cardPool: Readonly<Record<string, CardDefinition>>,
  instanceLookup?: Readonly<Record<string, CardDefinitionId>> | InstanceLookup,
  companyNames?: Readonly<Record<string, string>>,
): string {
  const defName = (id: CardDefinitionId) => {
    const def = cardPool[id as string];
    return def ? formatCardName(def) : `${id}`;
  };
  const instName = (id: CardInstanceId) => {
    if (instanceLookup) {
      const defId = typeof instanceLookup === 'function'
        ? instanceLookup(id)
        : instanceLookup[id as string];
      if (defId === UNKNOWN_CARD) return 'a card';
      if (defId === UNKNOWN_SITE) return 'a site';
      if (defId) return defName(defId);
    }
    return 'a card';
  };
  const compName = (id: CompanyId) => companyNames?.[id as string] ?? `${id}`;

  switch (action.type) {
    case 'draft-pick':
      return `Draft ${instName(action.characterInstanceId)}`;
    case 'draft-stop':
      return 'Stop drafting and keep current selections';
    case 'assign-starting-item':
      return `Assign item ${defName(action.itemDefId)} to ${instName(action.characterInstanceId)}`;
    case 'add-character-to-deck':
      return `Add ${instName(action.characterInstanceId)} to play deck`;
    case 'shuffle-play-deck':
      return 'Shuffle play deck';
    case 'select-starting-site':
      return `Select ${instName(action.siteInstanceId)} as starting site`;
    case 'place-character': {
      const companyNum = action.companyId.endsWith('-0') ? 'first' : 'second';
      return `Move ${instName(action.characterInstanceId)} to ${companyNum} company`;
    }
    case 'roll-initiative':
      return 'Roll 2d6 for initiative';
    case 'untap':
      return 'Untap all cards';
    case 'play-character':
      return `Play character ${instName(action.characterInstanceId)} at site ${instName(action.atSite)}`;
    case 'split-company':
      return `Split ${instName(action.characterId)} from ${compName(action.sourceCompanyId)}`;
    case 'move-to-company':
      return `Move ${instName(action.characterInstanceId)} to ${compName(action.targetCompanyId)}`;
    case 'merge-companies':
      return `Merge ${compName(action.sourceCompanyId)} into ${compName(action.targetCompanyId)}`;
    case 'transfer-item':
      return `Transfer item ${instName(action.itemInstanceId)} from ${instName(action.fromCharacterId)} to ${instName(action.toCharacterId)}`;
    case 'move-to-influence':
      return action.controlledBy === 'general'
        ? `Move ${instName(action.characterInstanceId)} to general influence`
        : `Move ${instName(action.characterInstanceId)} under direct influence of ${instName(action.controlledBy)}`;
    case 'plan-movement':
      return `Move ${compName(action.companyId)} to ${instName(action.destinationSite)}`;
    case 'cancel-movement':
      return `Cancel movement for ${compName(action.companyId)}`;
    case 'play-permanent-event':
      return `Play permanent event ${instName(action.cardInstanceId)}`;
    case 'play-short-event': {
      if (action.targetInstanceId) {
        return `Play ${instName(action.cardInstanceId)} to cancel ${instName(action.targetInstanceId)}`;
      }
      const onChar = action.targetScoutInstanceId
        ? ` on ${instName(action.targetScoutInstanceId)}`
        : '';
      const discardTag = action.discardTargetInstanceId
        ? `, discard ${instName(action.discardTargetInstanceId)}`
        : '';
      return `Play short-event ${instName(action.cardInstanceId)}${onChar}${discardTag}`;
    }
    case 'play-hazard': {
      const target = action.targetCharacterId
        ? `on ${instName(action.targetCharacterId)}`
        : `against ${compName(action.targetCompanyId)}`;
      const base = `Play hazard ${instName(action.cardInstanceId)} ${target}`;
      if (action.keyedBy) return `${base} (keyed by ${action.keyedBy.method}: ${action.keyedBy.value})`;
      return base;
    }
    case 'assign-strike': {
      const tapTag = action.tapped ? ' [tapped]' : '';
      return action.excess
        ? `Assign excess strike to ${instName(action.characterId)}${tapTag} (-1 prowess)`
        : `Assign strike to ${instName(action.characterId)}${tapTag}`;
    }
    case 'resolve-strike':
      return action.tapToFight ? 'Resolve strike (tap to fight)' : 'Resolve strike (stay untapped, -3 prowess)';
    case 'support-strike':
      return `Tap ${instName(action.supportingCharacterId)} to support ${instName(action.targetCharacterId)} (+1 prowess)`;
    case 'choose-strike-order': {
      const charLabel = action.characterId ? ` on ${instName(action.characterId)}` : '';
      const tapLabel = action.tapped ? ' [tapped]' : '';
      return `Resolve strike ${action.strikeIndex + 1}${charLabel}${tapLabel}`;
    }
    case 'body-check-roll':
      return 'Roll body check';
    case 'play-hero-resource':
      return action.attachToCharacterId
        ? `Play ${instName(action.cardInstanceId)} on ${instName(action.attachToCharacterId)}`
        : `Play resource ${instName(action.cardInstanceId)} at ${compName(action.companyId)}`;
    case 'influence-attempt':
      return `Influence faction ${instName(action.factionInstanceId)} with ${instName(action.influencingCharacterId)}`;
    case 'opponent-influence-attempt':
      return action.revealedCardInstanceId
        ? `Influence opponent's ${instName(action.targetInstanceId)} with ${instName(action.influencingCharacterId)} (reveal ${instName(action.revealedCardInstanceId)})`
        : `Influence opponent's ${instName(action.targetInstanceId)} with ${instName(action.influencingCharacterId)}`;
    case 'opponent-influence-defend':
      return `Roll defense against influence attempt`;
    case 'play-minor-item':
      return `Play minor item ${instName(action.cardInstanceId)} on ${instName(action.attachToCharacterId)}`;
    case 'corruption-check': {
      const mod = action.corruptionModifier;
      const modStr = mod !== 0 ? `, modifier ${mod >= 0 ? '+' : ''}${mod}` : '';
      return `Corruption check for ${instName(action.characterId)} (CP ${action.corruptionPoints}${modStr})`;
    }
    case 'draw-cards':
      return `Draw ${action.count} card${action.count !== 1 ? 's' : ''}`;
    case 'discard-card':
      return `Discard ${instName(action.cardInstanceId)}`;
    case 'pass':
      return 'Pass (end your actions this phase)';
    case 'call-free-council':
      return 'Call the Free Council (trigger endgame)';
    case 'play-long-event':
      return `Play long-event ${instName(action.cardInstanceId)}`;
    case 'exchange-sideboard':
      return `Exchange ${instName(action.discardCardInstanceId)} (discard) ↔ ${instName(action.sideboardCardInstanceId)} (sideboard)`;
    case 'start-sideboard-to-deck':
      return 'Tap avatar: fetch 1 card from sideboard to play deck';
    case 'start-sideboard-to-discard':
      return 'Tap avatar: fetch up to 5 cards from sideboard to discard';
    case 'fetch-from-sideboard':
      return `Fetch ${instName(action.sideboardCardInstanceId)} from sideboard`;
    case 'start-hazard-sideboard-to-deck':
      return 'Fetch 1 hazard from sideboard to play deck';
    case 'start-hazard-sideboard-to-discard':
      return 'Fetch up to 5 hazards from sideboard to discard';
    case 'fetch-hazard-from-sideboard':
      return `Fetch ${instName(action.sideboardCardInstanceId)} from sideboard`;
    case 'not-playable':
      return `${instName(action.cardInstanceId)} cannot be played`;
    case 'select-company':
      return `Select ${compName(action.companyId)}`;
    case 'declare-path': {
      if (action.regionPath && action.regionPath.length > 2) {
        const middle = action.regionPath.slice(1, -1).map(id => {
          const def = cardPool[id as string];
          return def?.name ?? `${id}`;
        });
        return `Declare region movement via ${middle.join(' and ')}`;
      }
      return `Declare ${action.movementType} movement`;
    }
    case 'order-effects':
      return `Order ${action.effectOrder.length} ongoing effect(s)`;
    case 'enter-site':
      return `Enter site with ${compName(action.companyId)}`;
    case 'place-on-guard':
      return `Place on-guard card ${instName(action.cardInstanceId)}`;
    case 'reveal-on-guard': {
      const target = action.targetCharacterId ? ` on ${instName(action.targetCharacterId)}` : '';
      return `Reveal on-guard card ${instName(action.cardInstanceId)}${target}`;
    }
    case 'declare-agent-attack':
      return `Declare agent attack ${instName(action.agentInstanceId)}`;
    case 'pass-chain-priority':
      return `Pass chain priority`;
    case 'order-passives':
      return `Order ${action.order.length} passive condition(s)`;
    case 'deck-exhaust':
      return `Exhaust deck (reshuffle discard)`;
    case 'fetch-from-pile':
      return `Fetch ${instName(action.cardInstanceId)} from ${action.source}`;
    case 'finished':
      return `Finished`;
    case 'activate-granted-action':
      return `Activate ${action.actionId} on ${instName(action.sourceCardId)} (${instName(action.characterId)} taps)`;
    case 'faction-influence-roll':
      return `Roll influence: ${action.explanation}`;
    case 'cancel-attack':
      return action.scoutInstanceId
        ? `Cancel attack: play ${instName(action.cardInstanceId)}, tap ${instName(action.scoutInstanceId)}`
        : `Cancel attack: play ${instName(action.cardInstanceId)}`;
    case 'halve-strikes':
      return `Halve strikes: play ${instName(action.cardInstanceId)}`;
    case 'cancel-by-tap':
      return `Cancel attack by tapping ${instName(action.characterId)}`;
    case 'salvage-item':
      return `Salvage ${instName(action.itemInstanceId)} to ${instName(action.recipientCharacterId)}`;
    case 'support-corruption-check':
      return `Tap ${instName(action.supportingCharacterId)} for CC support (+1)`;
    default: {
      const _exhaustive: never = action;
      return `Unknown action`;
    }
  }
}
