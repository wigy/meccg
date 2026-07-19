/**
 * @module format-actions
 *
 * Human-readable descriptions for game actions and company naming.
 * Converts GameAction objects into text strings that explain what each
 * action does, resolving card IDs to names where possible.
 */

import type { CardDefinition } from './types/cards.js';
import { isAvatarCharacter, isCharacterCard } from './types/cards.js';
import type { Company, CharacterInPlay, GameState } from './types/state.js';
import type { GameAction } from './types/actions.js';
import type { CardInstanceId, CardDefinitionId, CompanyId, PlayerId } from './types/common.js';
import { UNKNOWN_CARD, UNKNOWN_SITE } from './card-ids.js';
import { formatCardName } from './format-cards.js';
import { formatSignedNumber } from './format-helpers.js';
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
    if (isAvatarCharacter(def)) {
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

// ---- Action-referenced card definitions ----

/**
 * Extract a map from CardInstanceId to CardDefinitionId for every card
 * instance referenced inside a GameAction whose identity has become
 * publicly known — i.e. is recorded in {@link GameState.revealedInstances}.
 *
 * An instance enters `revealedInstances` whenever it occupies a location
 * classified public to the opponent (cards in play, the chain, a company
 * site, a revealed on-guard slot, the post-draft `drafted` list, etc.).
 * Instances that have only ever lived in private locations (hands, play
 * decks, draft pools, face-down discards, unrevealed on-guard) are
 * omitted — the audience will see "a card" rather than the real name.
 *
 * The server pairs the broadcast lastAction with this map; the client
 * merges it with its per-view instance lookup so `describeAction` can
 * render public identities correctly. The acting player additionally
 * resolves their own private IDs through their view's lookup — e.g. a
 * character being shuffled into their face-down play deck is visible
 * to them but stays hidden from the opponent's toast, because the
 * instance was never in a public location.
 *
 * Fields that hold other string kinds (PlayerId, CompanyId, etc.) are
 * harmless: they will not be keys in `revealedInstances`.
 */
export function extractActionCardDefs(
  state: GameState,
  action: GameAction,
): Record<string, CardDefinitionId> {
  const defs: Record<string, CardDefinitionId> = {};
  const revealed = state.revealedInstances;
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      const def = revealed[value as CardInstanceId];
      if (def !== undefined) defs[value] = def;
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) visit(v);
      return;
    }
    if (value && typeof value === 'object') {
      for (const v of Object.values(value)) visit(v);
    }
  };
  // fetch-from-pile moves a card from a private pile (discard or sideboard)
  // into the private play deck. Even if the card was previously revealed
  // (e.g. played as a hazard earlier), broadcasting its identity here would
  // tell the opponent which specific card was chosen — private information.
  // Exclude cardInstanceId so the opponent's toast shows "Fetch a card from …".
  if (action.type === 'fetch-from-pile') {
    const { cardInstanceId: _excluded, ...rest } = action;
    visit(rest);
    return defs;
  }
  // exchange-sideboard swaps one card between discard pile and sideboard —
  // both are private locations (opponent sees neither). Even if either card
  // was previously revealed (e.g. played as a hazard), broadcasting its
  // identity would tell the opponent exactly which cards the player exchanged,
  // which is hidden information. Exclude both instance IDs.
  if (action.type === 'exchange-sideboard') {
    const { discardCardInstanceId: _d, sideboardCardInstanceId: _s, ...rest } = action;
    visit(rest);
    return defs;
  }
  // arrange-deck-top-card places a set-aside card face-down on top of the
  // acting player's own play deck "in any order you choose" (Revealed to all
  // Watchers, dm-85). Although the identities were made public a moment earlier
  // when the card revealed the player's hand (revealHand), the *ordering* the
  // player picks is private — the cards go face-down. Broadcasting which card
  // is placed at each step would leak the exact deck-top order to the opponent
  // and every spectator, defeating the face-down placement. Exclude the card
  // instance ID so the audience only sees "Place a card … on top of the play
  // deck"; the acting player still names their choices via the legal actions.
  if (action.type === 'arrange-deck-top-card') {
    const { cardInstanceId: _excluded, ...rest } = action;
    visit(rest);
    return defs;
  }
  visit(action);
  return defs;
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
  playerNames?: Readonly<Record<string, string>>,
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
  const compName = (id: CompanyId) => companyNames?.[id as string] ?? `a company`;
  // Resolve an internal player id (e.g. "p1") to a display name. Legal-action
  // and toast text must never surface raw player codes; fall back to a neutral
  // word rather than leaking the id when no name map is supplied.
  const playerName = (id: PlayerId) => playerNames?.[id as string] ?? `the player`;

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
    case 'select-stage-resource-site':
      return `Pair ${instName(action.stageResourceInstanceId)} with site ${instName(action.siteInstanceId)}`;
    case 'place-character': {
      const companyNum = action.companyId.endsWith('-0') ? 'first' : 'second';
      return `Move ${instName(action.characterInstanceId)} to ${companyNum} company`;
    }
    case 'roll-initiative':
      return 'Roll 2d6 for first turn';
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
    case 'store-item':
      return `Store item ${instName(action.itemInstanceId)} from ${instName(action.characterId)}`;
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
      const targetTag = action.targetCompanyId
        ? ` on ${compName(action.targetCompanyId)}`
        : action.targetScoutInstanceId
          ? ` on ${instName(action.targetScoutInstanceId)}`
          : '';
      const discardTag = action.discardTargetInstanceId
        ? `, discard ${instName(action.discardTargetInstanceId)}`
        : '';
      return `Play short-event ${instName(action.cardInstanceId)}${targetTag}${discardTag}`;
    }
    case 'play-hazard': {
      const target = action.targetCharacterId
        ? `on ${instName(action.targetCharacterId)}`
        : `against ${compName(action.targetCompanyId)}`;
      const base = `Play hazard ${instName(action.cardInstanceId)} ${target}`;
      const raceTag = action.chosenCreatureRace ? ` (race: ${action.chosenCreatureRace})` : '';
      if (action.keyedBy) return `${base} (keyed by ${action.keyedBy.method}: ${action.keyedBy.value})${raceTag}`;
      return `${base}${raceTag}`;
    }
    case 'sideboard-with-nazgul':
      return `Tap and discard Nazgûl ${instName(action.cardInstanceId)} to sideboard (${action.destination})`;
    case 'allocate-cvcc-excess':
      return 'Assign −1 excess strike to current defender';
    case 'assign-strike': {
      const tapTag = action.tapped ? ' [tapped]' : '';
      if (action.excess) {
        return `Assign excess strike to ${instName(action.characterId)}${tapTag} (-1 prowess)`;
      }
      if (action.attackingCharacterId) {
        return `Pair ${instName(action.attackingCharacterId)} → ${instName(action.characterId)}`;
      }
      return `Assign strike to ${instName(action.characterId)}${tapTag}`;
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
      const modStr = mod !== 0 ? `, modifier ${formatSignedNumber(mod)}` : '';
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
    case 'reshuffle-card-from-hand':
      return `Reshuffle ${instName(action.cardInstanceId)} from hand into play deck (show opponent)`;
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
    case 'card-sideboard-to-deck':
      return `Bring ${instName(action.cardInstanceId)} from sideboard to play deck`;
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
    case 'play-site-auto-attack':
      return `Play ${instName(action.cardInstanceId)} from hand as site's automatic-attack`;
    case 'cancel-auto-attack':
      return `Tap ${instName(action.characterId)} to cancel automatic-attack at home site`;
    case 'declare-agent-attack':
      return action.homeSiteInstanceId
        ? `Declare agent attack ${instName(action.agentInstanceId)} (reveal at ${instName(action.homeSiteInstanceId)})`
        : `Declare agent attack ${instName(action.agentInstanceId)}`;
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
      return action.noTap
        ? `Activate ${action.actionId} on ${instName(action.sourceCardId)} (${instName(action.characterId)}, no tap, −3 to roll)`
        : `Activate ${action.actionId} on ${instName(action.sourceCardId)} (${instName(action.characterId)} taps)`;
    case 'faction-influence-roll':
      return `Roll influence: ${action.explanation}`;
    case 'cancel-attack':
      return action.scoutInstanceId
        ? `Cancel attack: play ${instName(action.cardInstanceId)}, tap ${instName(action.scoutInstanceId)}`
        : `Cancel attack: play ${instName(action.cardInstanceId)}`;
    case 'cancel-influence':
      return `Cancel influence: play ${instName(action.cardInstanceId)}, ${instName(action.characterId)} makes corruption check`;
    case 'halve-strikes':
      return `Halve strikes: play ${instName(action.cardInstanceId)}`;
    case 'modify-attack':
      return action.characterInstanceId
        ? `Tap ${instName(action.cardInstanceId)} on ${instName(action.characterInstanceId)} to modify attack`
        : `Play ${instName(action.cardInstanceId)} from hand to modify attack`;
    case 'tap-item-for-strike':
      return `Tap ${instName(action.cardInstanceId)} on ${instName(action.characterInstanceId)} — ${action.explanation}`;
    case 'face-strike-on-tap':
      return `Tap ${instName(action.cardInstanceId)} so ${instName(action.characterInstanceId)} faces a strike (regardless of the attack's capabilities and his status)`;
    case 'cancel-by-tap':
      return `Cancel attack by tapping ${instName(action.characterId)}`;
    case 'salvage-item':
      return `Salvage ${instName(action.itemInstanceId)} to ${instName(action.recipientCharacterId)}`;
    case 'discard-item-from-company':
      return `Discard item ${instName(action.itemInstanceId)} (An Article Missing)`;
    case 'force-discard-card':
      return `Discard ring ${instName(action.cardInstanceId)} (Rolled down to the Sea)`;
    case 'play-strike-event':
      return `Strike event: play ${instName(action.cardInstanceId)} — ${action.explanation}`;
    case 'cancel-strike':
      return `${instName(action.cancellerInstanceId)} taps to cancel strike against ${instName(action.targetCharacterId)}`;
    case 'flee-from-strike':
      return `Play ${instName(action.cardInstanceId)} to flee the strike (cancel it, tap the character)`;
    case 'support-corruption-check':
      return `Tap ${instName(action.supportingCharacterId)} for CC support (+1)`;
    case 'resolve-dice-check':
      return action.explanation;
    case 'flattery-attempt':
      return `Flattery attempt by ${instName(action.characterInstanceId)}: need ${action.need}`;
    case 'seized-by-terror-roll':
      return `Roll for Seized by Terror on ${instName(action.targetCharacterId)} (need ${action.need})`;
    case 'gold-ring-test-roll':
      return `Gold-ring auto-test: ${instName(action.goldRingInstanceId)} — ${action.explanation}`;
    case 'test-ring-at-site':
      return `${instName(action.characterId)} taps to test ring ${instName(action.targetCardId)} at this site`;
    case 'play-ring-after-test':
      return `Play ${instName(action.ringInstanceId)} as replacement ring after test`;
    case 'haven-join-attack':
      return `${instName(action.characterId)} joins attacked company from haven`;
    case 'cancel-return-to-origin':
      return `${instName(action.allyInstanceId)} taps to cancel return-to-origin effect`;
    case 'counter-cancel-roll':
      return `Play ${instName(action.cardInstanceId)} to counter-cancel ${instName(action.targetInstanceId)} (roll + attack prowess)`;
    case 'counter-cancel-attack':
      return `Play ${instName(action.cardInstanceId)} to counter-cancel ${instName(action.targetInstanceId)} (the Balrog’s attack survives)`;
    case 'select-forewarned-attack':
      return `Select auto-attack ${action.attackIndex} (Forewarned Is Forearmed)`;
    case 'pair-resource-with-cof':
      return `Pair ${instName(action.cardInstanceId)} with Crown of Flowers (${instName(action.cofInstanceId)})`;
    case 'play-wizard-from-search':
      return `Play wizard ${defName(action.wizardDefinitionId)} from ${action.source}`;
    case 'skip-wizard-search':
      return `Skip wizard search`;
    case 'select-card-bearer':
      return `Select ${instName(action.characterId)} as bearer of ${instName(action.cardInstanceId)}`;
    case 'play-agent-hazard':
      return `Play agent ${instName(action.agentCardInstanceId)} as hazard (face-down)`;
    case 'reveal-agent':
      return action.homeSiteInstanceId
        ? `Reveal agent ${action.agentId as string} at ${instName(action.homeSiteInstanceId)}`
        : `Reveal agent ${action.agentId as string} (no home site — discarded at end of turn)`;
    case 'agent-move':
      return `Agent ${action.agentId as string} moves to ${instName(action.destinationSiteInstanceId)}`;
    case 'agent-move-back':
      return `Agent ${action.agentId as string} moves back`;
    case 'agent-return-home':
      return action.homeSiteInstanceId
        ? `Agent ${action.agentId as string} returns home to ${instName(action.homeSiteInstanceId)}`
        : `Agent ${action.agentId as string} returns home`;
    case 'agent-heal':
      return `Agent ${action.agentId as string} heals`;
    case 'agent-untap':
      return `Agent ${action.agentId as string} untaps`;
    case 'agent-turn-face-down':
      return `Agent ${action.agentId as string} turns face-down`;
    case 'agent-key-creatures':
      return `Agent ${action.agentId as string} taps to key creatures`;
    case 'agent-influence-attempt':
      return `Agent ${action.agentId as string} taps to influence ${action.targetKind} ${instName(action.targetInstanceId)}`;
    case 'agent-tap-attack':
      return `Agent ${action.agentId as string} taps to attack`;
    case 'agent-discard-return-to-origin':
      return `Agent ${action.agentId as string} is discarded to return company to its site of origin`;
    case 'agent-strike-roll':
      return `Agent rolls for strike`;
    case 'under-deeps-roll':
      return `${playerName(action.player)} rolls for Under-deeps movement`;
    case 'haven-return':
      return `${playerName(action.player)} returns company to origin haven`;
    case 'run-home':
      return `${playerName(action.player)} discards ${instName(action.allyInstanceId)} to move company ${action.companyId} to its nearest haven (Bill the Pony)`;
    case 'pay-hazard-event-maintenance':
      return action.paymentType === 'discard-self'
        ? `Discard ${instName(action.sourceInstanceId)} (hazard event maintenance)`
        : `Discard ${instName(action.cardInstanceId)} from hand to maintain ${instName(action.sourceInstanceId)}`;
    case 'tap-hazard-card-for-limit':
      return `${playerName(action.player)} taps ${instName(action.cardInstanceId)} for +1 hazard limit`;
    case 'pay-hazard-limit-to-untap-card':
      return `${playerName(action.player)} spends hazard limit to untap ${instName(action.cardInstanceId)}`;
    case 'discard-card-for-hazard-limit':
      return `${playerName(action.player)} discards ${instName(action.cardInstanceId)} for +2 hazard limit against ${compName(action.targetCompanyId)}`;
    case 'protect-from-assignment':
      return `Play Ruse — ${instName(action.targetCharacterId)} protected from strike assignment`;
    case 'declare-company-attack':
      return `${playerName(action.player)} declares company attack on ${compName(action.targetCompanyId)}`;
    case 'take-trophy':
      return `${playerName(action.player)} takes creature ${instName(action.creatureInstanceId)} as trophy for ${instName(action.characterId)}`;
    case 'shield-discard-roll':
      return `${playerName(action.player)} rolls to determine if shield ${instName(action.itemInstanceId)} is discarded`;
    case 'tap-character-by-effect':
      return `${playerName(action.player)} taps character ${instName(action.characterInstanceId)} (hazard effect)`;
    case 'restore-character-by-effect':
      return `${playerName(action.player)} untaps/heals character ${instName(action.characterInstanceId)} (Hall of Fire)`;
    case 'place-starting-company-event':
      return `${playerName(action.player)} places ${defName(action.cardDefId)} on company ${compName(action.companyId)} as a starting event`;
    case 'reserve-creature':
      return `${playerName(action.player)} reserves creature ${instName(action.cardInstanceId)} via ${instName(action.sourceCardInstanceId)}`;
    case 'play-reserved-creature':
      return `${playerName(action.player)} plays reserved creature from ${instName(action.sourceCardInstanceId)} against company ${compName(action.targetCompanyId)}`;
    case 'play-creature-from-discard':
      return `${playerName(action.player)} plays creature ${instName(action.creatureInstanceId)} from discard pile against company ${compName(action.targetCompanyId)}`;
    case 'spawn-replay-creature':
      return `${playerName(action.player)} replays creature ${instName(action.creatureInstanceId)} from discard pile against company ${compName(action.targetCompanyId)} (${instName(action.sourceInstanceId)})`;
    case 'stay-her-appetite-roll':
      return `${playerName(action.player)} rolls for Stay Her Appetite`;
    case 'transfer-returned-item':
      return action.itemInstanceId && action.targetCharacterId
        ? `${playerName(action.player)} transfers returned item ${instName(action.itemInstanceId)} to ${instName(action.targetCharacterId)}`
        : `${playerName(action.player)} declines to transfer a returned item`;
    case 'tap-ally-combat-boost':
      return `${playerName(action.player)} taps ally ${instName(action.cardInstanceId)} to boost its company in combat`;
    case 'tap-ally-body-check-boost':
      return `${playerName(action.player)} taps ally ${instName(action.cardInstanceId)} to boost its controlling character's body check`;
    case 'tap-ally-discard-hazard':
      return `${playerName(action.player)} taps ally ${instName(action.allyInstanceId)} to discard hazard ${instName(action.targetInstanceId)}`;
    case 'convert-creature-to-ally':
      return `${playerName(action.player)} plays ${instName(action.cardInstanceId)} to convert the attacking creature into an ally controlled by ${instName(action.controllingCharacterId)}`;
    case 'discard-character':
      return `${playerName(action.player)} discards character ${instName(action.characterInstanceId)} while organizing`;
    case 'discard-stage-resource':
      return `${playerName(action.player)} discards stage resource ${instName(action.cardInstanceId)}`;
    case 'activate-org-fetch':
      return `${playerName(action.player)} activates org-phase fetch from ${instName(action.cardInstanceId)} (take one matching card to hand)`;
    case 'manifestation-swap':
      return `${playerName(action.player)} brings ${instName(action.cardInstanceId)} into play, replacing ${instName(action.characterId)} (removed from the game, cards transferred)`;
    case 'discard-to-recruit':
      return `${playerName(action.player)} discards ${instName(action.characterId)} to bring ${instName(action.cardInstanceId)} into play with his company`;
    case 'rescue-prisoner':
      return `${playerName(action.player)} attempts to rescue prisoners held by ${instName(action.hostInstanceId)} (faces the rescue-attack)`;
    case 'tap-alt-permanent-event':
      return `${playerName(action.player)} taps ${instName(action.cardInstanceId)} (permanent-event → short-event)${action.targetCharacterId ? `, tapping ${instName(action.targetCharacterId)}` : ''}`;
    case 'play-agent-manifestation':
      return `${playerName(action.player)} taps ${instName(action.characterId)} to play ${instName(action.manifestationCardInstanceId)} (agent discarded)`;
    case 'arrange-deck-top-card':
      return `Place ${instName(action.cardInstanceId)} next on top of your play deck`;
    case 'choose-revealed-card':
      return `Take revealed card ${instName(action.cardInstanceId)} into hand (shuffle the rest back into the play deck)`;
    case 'remove-revealed-card':
      return `${playerName(action.player)} removes revealed card ${instName(action.cardInstanceId)} from play (opponent's discard → out of play)`;
    case 'desire-choose-shown-card':
      return `${playerName(action.player)} shows revealed card ${instName(action.cardInstanceId)} to the opponent (Desire All for Thy Belly)`;
    case 'desire-choose-penalty':
      return action.penalty === 'remove-from-game'
        ? `${playerName(action.player)} removes the shown card from the game (Desire All for Thy Belly)`
        : `${playerName(action.player)} reduces his hand size by one for the rest of the game (Desire All for Thy Belly)`;
    case 'choose-great-hunt-source':
      return `${playerName(action.player)} has the opponent reveal from their ${action.source === 'deck' ? 'play deck' : 'discard pile'} (The Great Hunt)`;
    case 'great-hunt-attack-with-creature':
      return `${playerName(action.player)} has discarded creature ${instName(action.creatureInstanceId)} attack Alatar's company (The Great Hunt)`;
    case 'gangways-extra-move':
      return `${playerName(action.player)} sends company ${action.companyId} on another Under-deeps movement to ${instName(action.destinationSite)} (Gangways over the Fire)`;
    case 'extra-mh-move':
      return `${playerName(action.player)} sends company ${action.companyId} on another movement to ${instName(action.destinationSite)} (extra movement/hazard phase)`;
    case 'apply-attacker-attack-option':
      return `${playerName(action.player)} applies ${instName(action.cardInstanceId)} to the attack (+prowess / detainment)`;
    case 'voluntary-discard-in-play':
      return `${playerName(action.player)} discards ${instName(action.cardInstanceId)} from play`;
    case 'return-attached-to-hand':
      return `${playerName(action.player)} returns ${instName(action.cardInstanceId)} to hand`;
    case 'discard-for-evil-hour-movement':
      return `${playerName(action.player)} discards ${instName(action.cardInstanceId)} to grant company ${action.companyId} the region-movement bonus (A More Evil Hour)`;
    case 'left-behind-rejoin':
      return `${playerName(action.player)} rejoins the left-behind company ${action.companyId} with its original company (Left Behind)`;
    case 'cancel-weapon-effects':
      return `${playerName(action.player)} taps ${instName(action.cardInstanceId)} to cancel all effects of weapon ${instName(action.weaponInstanceId)} until end of combat (Whip of Many Thongs)`;
    case 'pay-site-tax':
      return `${playerName(action.player)} taps ${instName(action.characterId)} to pay the site tax before playing an ally or item (Eddy in Fate's Tide)`;
    case 'pay-movement-tax':
      return `${playerName(action.player)} taps ${instName(action.characterId)} to pay company ${action.companyId}'s movement tax (Enchanted Stream)`;
    default: {
      const _exhaustive: never = action;
      return `Unknown action`;
    }
  }
}
