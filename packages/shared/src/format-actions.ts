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
  const hidden = PRIVATE_ACTION_FIELDS[action.type];
  if (hidden) {
    visit(Object.fromEntries(Object.entries(action).filter(([k]) => !hidden.includes(k))));
    return defs;
  }
  visit(action);
  return defs;
}

/**
 * Action fields that must never be resolved to a public card identity, per
 * action type — {@link extractActionCardDefs} drops them before visiting the
 * action. Each entry hides *private information* an otherwise-revealed
 * instance id would leak through the opponent's toast:
 *
 * - `fetch-from-pile` `cardInstanceId` — the fetch moves a card from a
 *   private pile (discard or sideboard) into the private play deck. Even if
 *   the card was previously revealed (e.g. played as a hazard earlier),
 *   broadcasting its identity would tell the opponent which specific card
 *   was chosen. The toast shows "Fetch a card from …".
 * - `exchange-sideboard` both instance ids — the swap is between two private
 *   locations (opponent sees neither), so which cards were exchanged is
 *   hidden information even when either card was revealed before.
 * - `arrange-deck-top-card` `cardInstanceId` — the set-aside cards go
 *   face-down on top of the acting player's own play deck "in any order you
 *   choose" (Revealed to all Watchers, dm-85). The identities were public a
 *   moment earlier via revealHand, but the *ordering* the player picks is
 *   private; per-step broadcasts would leak the exact deck-top order to the
 *   opponent and every spectator. The audience only sees "Place a card … on
 *   top of the play deck"; the acting player still names their choices via
 *   the legal actions.
 * - `plan-movement` `destinationSite` — the destination is placed face-down
 *   (CoE 2.II.7) and stays secret until revealed during the company's M/H
 *   sub-phase. If this exact site instance was public earlier in the game,
 *   `revealedInstances` never forgets that — but re-selecting it as a new
 *   destination must not leak its identity again. The opponent's toast
 *   reads "Move company to a site".
 * - `place-on-guard` `cardInstanceId` — the card is declared as a hazard and
 *   placed face-down at the site (CoE 2.IV.vii.4); bluffing is allowed, so
 *   the resource player must not learn its identity until it is later
 *   revealed. If this exact instance was public earlier in the game (e.g. it
 *   fought in combat or was played face-up before returning to hand),
 *   `revealedInstances` never forgets that — but placing it on-guard now must
 *   not leak its identity again. The resource player's toast reads "Place
 *   on-guard card a card".
 */
const PRIVATE_ACTION_FIELDS: Partial<Record<GameAction['type'], readonly string[]>> = {
  'fetch-from-pile': ['cardInstanceId'],
  'exchange-sideboard': ['discardCardInstanceId', 'sideboardCardInstanceId'],
  'arrange-deck-top-card': ['cardInstanceId'],
  'plan-movement': ['destinationSite'],
  'place-on-guard': ['cardInstanceId'],
};

/**
 * A copy of `action` with its {@link PRIVATE_ACTION_FIELDS} removed — the
 * form safe to broadcast to recipients other than the acting player.
 *
 * Dropping the fields from the card-defs map alone is not enough: instance
 * ids are stable for the whole game and many identity mappings are public
 * from earlier broadcasts (a site the company once stood at, a hazard once
 * played), so shipping the raw action would let the audience resolve e.g. a
 * `plan-movement.destinationSite` instance id to a site name even though the
 * destination is placed face-down (CoE 2.II.7). Actions without private
 * fields are returned unchanged.
 */
export function redactActionForAudience(action: GameAction): GameAction {
  const hidden = PRIVATE_ACTION_FIELDS[action.type];
  if (!hidden) return action;
  return Object.fromEntries(
    Object.entries(action).filter(([k]) => !hidden.includes(k)),
  ) as unknown as GameAction;
}

// ---- Action description ----

/**
 * Convert a card-data `play-option` id (kebab-case, e.g. `decrease-hazard-limit`)
 * into a readable phrase (`decrease hazard limit`) for display in legal-action
 * text, so a card offering several options is distinguishable option-by-option.
 */
function humanizeOptionId(optionId: string): string {
  return optionId.replace(/-/g, ' ');
}

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
      // The same character can be offered at the same site both under general
      // influence and as another character's direct-influence follower — the
      // controller must be in the label or the two actions look identical.
      return action.controlledBy === 'general'
        ? `Play character ${instName(action.characterInstanceId)} at site ${instName(action.atSite)}`
        : `Play character ${instName(action.characterInstanceId)} at site ${instName(action.atSite)} under ${instName(action.controlledBy)}'s direct influence`;
    case 'split-company':
      return `Split ${instName(action.characterId)} from ${compName(action.sourceCompanyId)}`;
    case 'move-to-company':
      return `Move ${instName(action.characterInstanceId)} to ${compName(action.targetCompanyId)}`;
    case 'merge-companies':
      return `Merge ${compName(action.sourceCompanyId)} into ${compName(action.targetCompanyId)}`;
    case 'use-item':
      return `${instName(action.characterInstanceId)} begins using ${instName(action.itemInstanceId)}`;
    case 'transfer-item':
      return `Transfer item ${instName(action.itemInstanceId)} from ${instName(action.fromCharacterId)} to ${instName(action.toCharacterId)}`;
    case 'store-item':
      return action.cacheHostInstanceId
        ? `Store item ${instName(action.itemInstanceId)} under ${instName(action.cacheHostInstanceId)} instead of the marshalling-point pile`
        : action.characterId
          ? `Store item ${instName(action.itemInstanceId)} from ${instName(action.characterId)}`
          : `Store ${instName(action.itemInstanceId)}${action.companyId ? ` from ${compName(action.companyId)}` : ''}`;
    case 'store-item-in-cache':
      return `Place item ${instName(action.itemInstanceId)} under ${instName(action.hostInstanceId)} from hand`;
    case 'move-to-influence':
      return action.controlledBy === 'general'
        ? `Move ${instName(action.characterInstanceId)} to general influence`
        : `Move ${instName(action.characterInstanceId)} under direct influence of ${instName(action.controlledBy)}`;
    case 'influence-overflow-discard':
      return `Remove ${instName(action.characterInstanceId)} from play — over general influence (CoE 3.47)`;
    case 'remove-corruption-offer':
      return action.corruptionInstanceId
        ? `${playerName(action.player)} removes corruption card ${instName(action.corruptionInstanceId)} (Elf-song)`
        : `${playerName(action.player)} declines to remove a corruption card (Elf-song)`;
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
      // Cards declaring multiple play-option effects (e.g. Deeper Shadow's
      // change-site-type / change-region-type / decrease-hazard-limit) emit
      // one otherwise-identical legal action per option — without naming the
      // chosen option here, the player cannot tell which ability they are
      // about to select.
      const optionTag = action.optionId ? ` (${humanizeOptionId(action.optionId)})` : '';
      return `Play short-event ${instName(action.cardInstanceId)}${targetTag}${discardTag}${optionTag}`;
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
      if (action.extraSequence) {
        return `Assign additional strike to ${instName(action.characterId)}${tapTag} (multi-strike-option)`;
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
    case 'concede':
      return `${playerName(action.player)} concedes the game`;
    case 'call-free-council':
      return 'Call the Free Council (trigger endgame)';
    case 'reshuffle-card-from-hand':
      return `Reshuffle ${instName(action.cardInstanceId)} from hand into play deck (show opponent)`;
    case 'play-long-event':
      return `Play long-event ${instName(action.cardInstanceId)}`;
    case 'exchange-sideboard':
      return `Exchange ${instName(action.discardCardInstanceId)} (discard) ↔ ${instName(action.sideboardCardInstanceId)} (sideboard)`;
    case 'swap-banned-vs-balrog':
      return `Remove ${instName(action.cardInstanceId)} from the game (unplayable vs Balrog): bring ${instName(action.sideboardCardInstanceId)} from sideboard into play deck`;
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
    case 'declare-burglary':
      return `${playerName(action.player)} taps ${instName(action.characterInstanceId)} and the site to attempt burglary in lieu of facing automatic-attacks (Burglary)`;
    case 'burglary-attempt':
      return `${playerName(action.player)} rolls for ${instName(action.characterInstanceId)}: ${action.explanation}`;
    case 'declare-agent-attack': {
      const reveal = action.homeSiteInstanceId ? ` (reveal at ${instName(action.homeSiteInstanceId)})` : '';
      const tap = action.tapForExtraStrike ? ' (tap for an extra strike)' : '';
      return `Declare agent attack ${instName(action.agentInstanceId)}${reveal}${tap}`;
    }
    case 'pass-chain-priority':
      return `Pass chain priority`;
    case 'order-passives':
      return `Order ${action.order.length} passive condition(s)`;
    case 'deck-exhaust':
      return `Exhaust deck (reshuffle discard)`;
    case 'fetch-from-pile':
      return `Fetch ${instName(action.cardInstanceId)} from ${action.source}`;
    case 'tap-discard-in-play':
      return `${playerName(action.player)} taps ${instName(action.characterId)} to discard ${instName(action.targetInstanceId)} from play (Praise to Elbereth)`;
    case 'finished':
      return `Finished`;
    case 'activate-granted-action': {
      const target = action.recipientCharacterId
        ? `: place ${instName(action.targetCardId as CardInstanceId)} on ${instName(action.recipientCharacterId)}`
        : action.targetCardId
          ? `: target ${instName(action.targetCardId)}`
          : '';
      return action.noTap
        ? `Activate ${action.actionId} on ${instName(action.sourceCardId)} (${instName(action.characterId)}, no tap, −3 to roll)${target}`
        : `Activate ${action.actionId} on ${instName(action.sourceCardId)} (${instName(action.characterId)} taps)${target}`;
    }
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
    case 'enable-multi-strike-option':
      return `Play ${instName(action.cardInstanceId)}: a warrior may face additional strikes this attack`;
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
    case 'play-revealed-card':
      return `Play the revealed ${instName(action.cardInstanceId)} with the influencing character (CoE 10.13)`;
    case 'force-discard-card':
      return `Discard ring ${instName(action.cardInstanceId)} (Rolled down to the Sea)`;
    case 'play-strike-event':
      return `Strike event: play ${instName(action.cardInstanceId)} — ${action.explanation}`;
    case 'cancel-strike':
      return `${instName(action.cancellerInstanceId)} taps to cancel strike against ${instName(action.targetCharacterId)}`;
    case 'cancel-prisoner-taking':
      return `Discard ${instName(action.cardInstanceId)} to cancel prisoner-taking (Noble Hound)`;
    case 'dodge-strike':
      return `Tap ${instName(action.cardInstanceId)} so ${instName(action.characterInstanceId)} dodges the strike — ${action.explanation}`;
    case 'flee-from-strike':
      return `Play ${instName(action.cardInstanceId)} to flee the strike (cancel it, tap the character)`;
    case 'play-sacrifice-of-form':
      return `Play ${instName(action.cardInstanceId)}: sacrifice ${instName(action.characterInstanceId)} — all strikes of this attack fail (+3 body checks)`;
    case 'support-corruption-check':
      return action.supportingItemInstanceId !== undefined
        ? `Tap ${instName(action.supportingItemInstanceId)} for CC support`
        : `Tap ${instName(action.supportingCharacterId!)} for CC support (+1)`;
    case 'resolve-dice-check':
      return action.explanation;
    case 'flattery-attempt':
      return `Flattery attempt by ${instName(action.characterInstanceId)}: need ${action.need}`;
    case 'goodwill-attempt':
      return action.itemInstanceId
        ? `Goodwill attempt by ${instName(action.characterInstanceId)}: discard ${instName(action.itemInstanceId)}, need ${action.need}`
        : `Goodwill attempt: ${action.explanation}`;
    case 'riddling-attempt':
      return `Riddling attempt by ${instName(action.characterInstanceId)}: need ${action.need}`;
    case 'riddling-guess':
      return `Name "${action.guessedCardName}"`;
    case 'swap-new-site-choice':
      return action.explanation;
    case 'seized-by-terror-roll':
      return `Roll for Seized by Terror on ${instName(action.targetCharacterId)} (need ${action.need})`;
    case 'gold-ring-test-roll':
      return `Gold-ring auto-test: ${instName(action.goldRingInstanceId)} — ${action.explanation}`;
    case 'choose-gold-ring-test-roll':
      return `Use ${action.rollTotal} for the test of ${instName(action.goldRingInstanceId)} — ${action.explanation}`;
    case 'test-ring-at-site':
      return `${instName(action.characterId)} taps to test ring ${instName(action.targetCardId)} at this site`;
    case 'play-ring-after-test':
      return `Play ${instName(action.ringInstanceId)} as replacement ring after test`;
    case 'haven-join-attack':
      return `${instName(action.characterId)} joins attacked company from haven`;
    case 'cancel-return-to-origin':
      return `${instName(action.allyInstanceId)} taps to cancel return-to-origin effect`;
    case 'cancel-hazard-event':
      return `${playerName(action.player)} discards ${instName(action.cardInstanceId)} to cancel hazard event ${instName(action.targetInstanceId)} before it resolves`;
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
    case 'reveal-hazard-for-snake':
      return `${playerName(action.player)} reveals ${instName(action.cardInstanceId)} (Here Is a Snake!)`;
    case 'tap-reveal-agent-for-snake':
      return action.homeSiteInstanceId
        ? `${playerName(action.player)} taps and reveals agent ${action.agentId as string} at ${instName(action.homeSiteInstanceId)} instead of revealing hazards (Here Is a Snake!)`
        : `${playerName(action.player)} taps and reveals agent ${action.agentId as string} (no home site — discarded at end of turn) instead of revealing hazards (Here Is a Snake!)`;
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
      return `${playerName(action.player)} returns company to its site of origin`;
    case 'run-home':
      return `${playerName(action.player)} discards ${instName(action.allyInstanceId)} to move ${compName(action.companyId)} to its nearest haven (Bill the Pony)`;
    case 'pay-event-maintenance':
      switch (action.paymentType) {
        case 'discard-self':
          return `Discard ${instName(action.sourceInstanceId)} (event maintenance)`;
        case 'decline':
          return `Bid nothing over ${instName(action.sourceInstanceId)} (event maintenance)`;
        default:
          return `Discard ${instName(action.cardInstanceId)} from hand to maintain ${instName(action.sourceInstanceId)}`;
      }
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
    case 'store-creature-in-item':
      return `${playerName(action.player)} stores creature ${instName(action.creatureInstanceId)} with ${instName(action.itemInstanceId)}`;
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
    case 'use-discard-substitute':
      return action.itemInstanceId
        ? `${playerName(action.player)} discards a substitute item to save ${instName(action.itemInstanceId)} from discard`
        : `${playerName(action.player)} declines to substitute an item for the required discard`;
    case 'tap-ally-combat-boost':
      return `${playerName(action.player)} taps ally ${instName(action.cardInstanceId)} to boost its company in combat`;
    case 'tap-ally-body-check-boost':
      return `${playerName(action.player)} taps ally ${instName(action.cardInstanceId)} to boost its controlling character's body check`;
    case 'capture-in-lieu-of-body-check':
      return `${playerName(action.player)} taps ${instName(action.characterId)} to capture the opposing character in lieu of the body check`;
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
      return action.characterInstanceId
        ? `${playerName(action.player)} taps ${instName(action.characterInstanceId)} to free the prisoners held by ${instName(action.hostInstanceId)}`
        : `${playerName(action.player)} attempts to rescue prisoners held by ${instName(action.hostInstanceId)} (faces the rescue-attack)`;
    case 'tap-alt-permanent-event':
      return `${playerName(action.player)} taps ${instName(action.cardInstanceId)} (permanent-event → short-event)${action.targetCharacterId ? `, tapping ${instName(action.targetCharacterId)}` : ''}`;
    case 'attack-alt-permanent-event':
      return `${playerName(action.player)} attacks with ${instName(action.cardInstanceId)} from its permanent-event state (against ${compName(action.targetCompanyId)})`;
    case 'return-alt-permanent-event':
      return `${playerName(action.player)} returns ${instName(action.cardInstanceId)} to hand from its permanent-event state`;
    case 'play-agent-manifestation':
      return `${playerName(action.player)} taps ${instName(action.characterId)} to play ${instName(action.manifestationCardInstanceId)} (agent discarded)`;
    case 'arrange-deck-top-card':
      return `Place ${instName(action.cardInstanceId)} next on top of your play deck`;
    case 'choose-revealed-card':
      return `Take revealed card ${instName(action.cardInstanceId)} into hand (shuffle the rest back into the play deck)`;
    case 'choose-set-aside-item':
      return `${playerName(action.player)} sets aside revealed item ${instName(action.cardInstanceId)} (Great Secrets Buried There)`;
    case 'remove-revealed-card':
      return `${playerName(action.player)} removes revealed card ${instName(action.cardInstanceId)} from play (opponent's discard → out of play)`;
    case 'desire-choose-shown-card':
      return `${playerName(action.player)} shows revealed card ${instName(action.cardInstanceId)} to the opponent (Desire All for Thy Belly)`;
    case 'desire-choose-penalty':
      return action.penalty === 'remove-from-game'
        ? `${playerName(action.player)} removes the shown card from the game (Desire All for Thy Belly)`
        : `${playerName(action.player)} reduces his hand size by one for the rest of the game (Desire All for Thy Belly)`;
    case 'choose-tap-or-roll':
      return action.choice === 'tap-character'
        ? `${playerName(action.player)} taps the threatened character instead (A Lie in Your Eyes)`
        : action.choice === 'tap-ally'
          ? `${playerName(action.player)} taps ${instName(action.allyInstanceId!)} instead (A Lie in Your Eyes)`
          : `${playerName(action.player)} lets the opponent roll (A Lie in Your Eyes)`;
    case 'choose-peek-deck':
      return `${playerName(action.player)} looks at the top cards of ${action.deckOwner === 'self' ? 'their own' : "the opponent's"} play deck and shuffles them back on top (Mirror of Galadriel)`;
    case 'choose-great-hunt-source':
      return `${playerName(action.player)} has the opponent reveal from their ${action.source === 'deck' ? 'play deck' : 'discard pile'} (The Great Hunt)`;
    case 'great-hunt-attack-with-creature':
      return `${playerName(action.player)} has discarded creature ${instName(action.creatureInstanceId)} attack Alatar's company (The Great Hunt)`;
    case 'choose-hunt-target':
      // `defName`, not `instName`: the named creature sits in the opponent's
      // deck/discard, which the acting player's own view may still redact —
      // the action itself carries the definition so the choice stays legible.
      return `${playerName(action.player)} names ${defName(action.definitionId)} to attack (The Hunt)`;
    case 'choose-long-dark-reach-attacker':
      return `${playerName(action.player)} names ${defName(action.definitionId)} to attack (Long Dark Reach)`;
    case 'gangways-extra-move':
      return `${playerName(action.player)} sends ${compName(action.companyId)} on another Under-deeps movement to ${instName(action.destinationSite)} (Gangways over the Fire)`;
    case 'extra-mh-move':
      return `${playerName(action.player)} sends ${compName(action.companyId)} on another movement to ${instName(action.destinationSite)} (extra movement/hazard phase)`;
    case 'ally-tap-extra-mh-phase':
      return `${playerName(action.player)} taps ${instName(action.allyInstanceId)} to send ${compName(action.companyId)} on another movement/hazard phase (Shadowfax)`;
    case 'character-tap-extra-mh-phase':
      return `${playerName(action.player)} taps ${instName(action.characterInstanceId)} to send ${compName(action.companyId)} on another movement/hazard phase (Carambor)`;
    case 'apply-attacker-attack-option':
      return `${playerName(action.player)} applies ${instName(action.cardInstanceId)} to the attack (+prowess / detainment)`;
    case 'voluntary-discard-in-play':
      return `${playerName(action.player)} discards ${instName(action.cardInstanceId)} from play`;
    case 'return-attached-to-hand':
      return `${playerName(action.player)} returns ${instName(action.cardInstanceId)} to hand`;
    case 'discard-for-evil-hour-movement':
      return `${playerName(action.player)} discards ${instName(action.cardInstanceId)} to grant ${compName(action.companyId)} the region-movement bonus (A More Evil Hour)`;
    case 'left-behind-rejoin':
      return `${playerName(action.player)} rejoins the left-behind ${compName(action.companyId)} with its original company (Left Behind)`;
    case 'recycle-hand-discard':
      return `${playerName(action.player)} moves discarded ${instName(action.cardInstanceId)} to the top of their play deck instead of the discard pile (Enduring Tales)`;
    case 'cancel-weapon-effects':
      return `${playerName(action.player)} taps ${instName(action.cardInstanceId)} to cancel all effects of weapon ${instName(action.weaponInstanceId)} until end of combat (Whip of Many Thongs)`;
    case 'pay-site-tax':
      return `${playerName(action.player)} taps ${instName(action.characterId)} to pay the site tax before playing an ally or item (Eddy in Fate's Tide)`;
    case 'pay-movement-tax':
      return `${playerName(action.player)} taps ${instName(action.characterId)} to pay ${compName(action.companyId)}'s movement tax (Enchanted Stream)`;
    case 'reanimate-from-discard':
      return `${playerName(action.player)} taps Ringwraith ${instName(action.ringwraithInstanceId)} to bring ${instName(action.characterInstanceId)} from the discard pile into play as a new company (Urlurtsu Nurn)`;
    case 'company-tap-roll':
      return `${playerName(action.player)} rolls for ${instName(action.targetCharacterId)}: ${action.explanation}`;
    case 'opposed-roll':
      return `${playerName(action.player)} rolls for ${instName(action.characterId)}: ${action.explanation}`;
    case 'play-named-card-offer':
      return `${playerName(action.player)} plays ${instName(action.cardInstanceId)} onto ${instName(action.targetCharacterId)}`;
    default: {
      const _exhaustive: never = action;
      return `Unknown action`;
    }
  }
}
