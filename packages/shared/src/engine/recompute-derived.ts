/**
 * @module recompute-derived
 *
 * Recomputes derived player values from the authoritative game state after
 * every action. Instead of incrementally tracking values like marshalling
 * points and general influence in each reducer handler, this module
 * recalculates them from the ground truth (characters in play, items, etc.).
 *
 * Effective stats are computed using the card effects resolver — the DSL
 * effects on each character and their items are evaluated in context to
 * produce final prowess, body, direct influence, and corruption point values.
 *
 * This is called once after each successful reducer step, ensuring derived
 * values are always consistent regardless of which phase handler ran.
 */

import type {
  GameState,
  PlayerState,
  MarshallingPointTotals,
  EffectiveStats,
  CharacterInPlay,
  CardDefinition,
  CharacterCard,
  CardEffect,
  FactionCard,
  Alignment,
  Company,
  CompanyId,
  CardDefinitionId,
  PlayerId,
  RingwraithModeEffect,
  FallenWizardCharacterAllyMpEffect,
} from '../index.js';
import { isCharacterCard, isItemCard, isFactionCard, isSiteCard } from '../types/cards.js';
import { MarshallingCategory, Race } from '../types/common.js';
import { ZERO_MARSHALLING_POINTS } from '../types/state-cards.js';
import { Phase, SetupStep } from '../types/state-phases.js';
import { getPlayerIndex, isBalrogAvatarDef } from '../state-utils.js';
import {
  buildBearerContext,
  collectCharacterEffects,
  collectGlobalEffects,
  resolveStatModifiers,
  resolveDef,
  evaluateExpr,
} from './effects/index.js';
import { matchesContext } from '../effects/condition-matcher.js';
import type { ResolverContext } from './effects/index.js';
import { playerById, findCharacterCompany, getLeaderControlEffect, getCardEffects, matchesDefinition, stagePointsOfCard, siteOccupancyStagePointsOfCard, findPlayerAvatar, findPlayConditionEffect, defById, playerHasKillMpExemption, hasEliminatedAvatar, collectEnvironmentOverride, isHavenForPlayer, characterBearsAttachedEffect } from './reducer-utils.js';
import type { Condition } from '../types/effects.js';
import { pickActiveItemsForCharacter } from './item-slots.js';
import { controlCostOf } from './control-cost.js';
import { manifestIdOf } from './manifestations.js';
import { ownerOf } from '../types/state.js';

/**
 * Returns the MP multiplier for a cross-alignment item (MELE Part IV).
 *
 * A Ringwraith player's hero items and a Wizard player's minion items are
 * worth only half their normal marshalling points (rounded up). All other
 * combinations return 1.0 (full value).
 */
function crossAlignmentItemMpFactor(
  playerAlignment: Alignment,
  itemCardType: string,
): number {
  if (playerAlignment === 'ringwraith' && itemCardType === 'hero-resource-item') return 0.5;
  if (playerAlignment === 'wizard' && itemCardType === 'minion-resource-item') return 0.5;
  return 1.0;
}

/** A card definition that carries marshalling-point scoring data. */
type MarshallingScoredCard = CardDefinition & {
  readonly marshallingPoints: number;
  readonly marshallingCategory: MarshallingCategory;
};

/** Whether a card definition carries marshalling-point scoring data. */
function hasMarshallingPoints(def: CardDefinition): def is MarshallingScoredCard {
  return 'marshallingPoints' in def && 'marshallingCategory' in def;
}

/**
 * Applies the MEWH §4 marshalling-point rule for a Fallen-wizard: every card
 * other than a stage resource is worth only **1** marshalling point to him,
 * regardless of its printed value, while stage resource cards (`alignment:
 * 'stage'`) score their printed MP normally. For all other player alignments
 * the printed value is returned unchanged.
 *
 * Only positive MP is clamped — a card worth 0 contributes 0, and any negative
 * value (e.g. a prisoner penalty) passes through.
 */
function fwClampMp(baseMp: number, def: CardDefinition, playerAlignment: Alignment): number {
  if (playerAlignment !== 'fallen-wizard') return baseMp;
  if ('alignment' in def && (def as { alignment?: string }).alignment === 'stage') return baseMp;
  return baseMp > 0 ? 1 : baseMp;
}

/**
 * Adds a card's marshalling points to the running totals by its category,
 * applying the Fallen-wizard 1-MP-per-card rule (MEWH §4) via {@link fwClampMp}.
 *
 * `fwCharAllyCaps` carries any in-play `fw-character-ally-mp` overrides (Great
 * Patron wh-72). Passed only when scoring **characters and allies**: a
 * Fallen-wizard card whose printed MP meets a cap's threshold is worth the cap's
 * `value` instead of the flat §4 1-MP clamp. Stage cards and non-Fallen-wizard
 * players are never affected.
 *
 * `fwFullMp` requests the full printed MP for a Fallen-wizard ally that matches
 * an in-play `fw-ally-mp-full` exemption (Join the Hunt wh-93 / Oromë's Warders
 * wh-94). It takes precedence over both the §4 clamp and any `fwCharAllyCaps`.
 */
/**
 * Roots of the Earth (ba-74): true when a card named `requiredCardName` is in
 * play (either player's `cardsInPlay`) attached to the **same site** as `card`
 * — i.e. both carry the same `attachedToSite` definition id. Drives the
 * `conditional-mp` bonus.
 */
function conditionalMpApplies(
  state: GameState,
  card: { readonly attachedToSite?: CardDefinitionId },
  requiredCardName: string,
): boolean {
  if (card.attachedToSite === undefined) return false;
  for (const player of state.players) {
    for (const other of player.cardsInPlay) {
      if (other.attachedToSite !== card.attachedToSite) continue;
      const def = defById(state, other.definitionId);
      if (def?.name === requiredCardName) return true;
    }
  }
  return false;
}

/**
 * True when a faction card is playable at any site of `siteType` — either a
 * `playableAt` entry naming that site type directly, or one naming a specific
 * site whose definition carries that type. Used by the Great Army of the North
 * (ba-38) conditional-MP gate to exclude Orc/Troll factions "playable at a
 * Darkhold [{D}]".
 */
function factionPlayableAtSiteType(
  state: GameState,
  factionDef: FactionCard,
  siteType: string,
): boolean {
  for (const entry of factionDef.playableAt) {
    if ('siteType' in entry && entry.siteType === siteType) return true;
    if ('site' in entry) {
      const siteName = entry.site;
      for (const cardDef of Object.values(state.cardPool)) {
        if (isSiteCard(cardDef) && cardDef.name === siteName && cardDef.siteType === siteType) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Counts the factions a player has in play (their own `cardsInPlay`) that
 * satisfy a `conditional-mp` `requiresFactionCount` gate: a race in `races`,
 * unique when required, and — when `excludePlayableAtSiteType` is set — not
 * playable at a site of that type. Drives Great Army of the North (ba-38): "at
 * least 4 unique Orc and/or Troll factions —none playable at a Darkhold [{D}]".
 */
function conditionalMpFactionCount(
  state: GameState,
  player: PlayerState,
  gate: NonNullable<import('../types/effects.js').ConditionalMpEffect['requiresFactionCount']>,
): number {
  let count = 0;
  for (const card of player.cardsInPlay) {
    const def = defById(state, card.definitionId);
    if (!def || !isFactionCard(def)) continue;
    if (!gate.races.includes(def.race)) continue;
    if (gate.unique && !def.unique) continue;
    if (gate.excludePlayableAtSiteType
      && factionPlayableAtSiteType(state, def, gate.excludePlayableAtSiteType)) continue;
    count += 1;
  }
  return count;
}

/** One active `faction-mp-bonus`: the bonus and the set of races it boosts. */
type FactionMpBonus = { readonly bonus: number; readonly races: ReadonlySet<string> };

/**
 * Collects the `faction-mp-bonus` effects a player currently has in play whose
 * race-diversity gate is satisfied, i.e. the controller has at least one
 * (non-set-aside) in-play faction of *each* race listed in `requireEachRace`.
 * Alliance of Free Peoples (as-45) is the sole precedent. Only the controller's
 * own `cardsInPlay` factions are counted (their own hero factions), matching the
 * card's "give an additional marshalling point" — MP always accrues to the
 * faction's owner. Returns an empty array when no such card is in play (the
 * common case) so unaffected recomputes cost nothing.
 */
function factionMpBonusEntries(state: GameState, player: PlayerState): FactionMpBonus[] {
  const entries: FactionMpBonus[] = [];
  // The races present among the controller's own non-set-aside in-play factions.
  const racesInPlay = new Set<string>();
  for (const card of player.cardsInPlay) {
    if (card.setAsideHost !== undefined) continue;
    const def = defById(state, card.definitionId);
    if (def && isFactionCard(def)) racesInPlay.add(def.race);
  }
  for (const def of playerCardsInPlayDefs(state, player)) {
    for (const effect of getCardEffects(def)) {
      if (effect.type !== 'faction-mp-bonus') continue;
      const gate = effect.requireEachRace ?? [];
      if (gate.every(race => racesInPlay.has(race))) {
        entries.push({ bonus: effect.bonus, races: new Set(effect.races) });
      }
    }
  }
  return entries;
}

function addMP(
  totals: MarshallingPointTotals,
  def: CardDefinition,
  playerAlignment: Alignment,
  fwCharAllyCaps: readonly FallenWizardCharacterAllyMpEffect[] = [],
  fwFullMp = false,
): MarshallingPointTotals {
  if (!hasMarshallingPoints(def)) return totals;
  let mp = fwClampMp(def.marshallingPoints, def, playerAlignment);
  if (
    playerAlignment === 'fallen-wizard'
    && def.marshallingPoints > 0
    && !('alignment' in def && (def as { alignment?: string }).alignment === 'stage')
  ) {
    if (fwFullMp) {
      // Join the Hunt (wh-93) / Oromë's Warders (wh-94): a matching ally scores
      // its full printed MP, ignoring both the §4 clamp and any cap below.
      mp = def.marshallingPoints;
    } else if (fwCharAllyCaps.length > 0) {
      // Great Patron (wh-72): a Fallen-wizard's characters/allies that normally
      // give at least `threshold` MP are each worth `value` instead of the §4
      // 1-MP clamp.
      for (const cap of fwCharAllyCaps) {
        if (def.marshallingPoints >= cap.threshold) {
          mp = cap.value;
          break;
        }
      }
    }
  }
  if (mp === 0) return totals;
  const cat = def.marshallingCategory;
  return { ...totals, [cat]: totals[cat] + mp };
}

/**
 * Collects the active `fw-character-ally-mp` overrides (Great Patron wh-72) a
 * Fallen-wizard player has in play. Empty for non-Fallen-wizard players, who
 * never field stage resources. The overrides apply to the player's characters
 * and allies when their printed MP meets the threshold.
 */
function fwCharacterAllyMpCaps(
  state: GameState,
  player: PlayerState,
): FallenWizardCharacterAllyMpEffect[] {
  if (player.alignment !== 'fallen-wizard') return [];
  const caps: FallenWizardCharacterAllyMpEffect[] = [];
  for (const def of playerCardsInPlayDefs(state, player)) {
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'fw-character-ally-mp') caps.push(effect);
    }
  }
  return caps;
}

/**
 * The marshalling-point pin a player's in-play `nonhaven-company-mp-pin` effect
 * imposes on company-held cards outside a Wizardhaven (Await the Onset wh-96),
 * or `undefined` when no such card is in play. At most one applies (the carrier
 * is duplication-limited), so the first match wins.
 */
function nonHavenCompanyMpPin(state: GameState, player: PlayerState): number | undefined {
  for (const def of playerCardsInPlayDefs(state, player)) {
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'nonhaven-company-mp-pin') return effect.value;
    }
  }
  return undefined;
}

/**
 * Adds a company-held card's pinned marshalling points (Await the Onset wh-96):
 * a card with printed MP scores exactly `value`, overriding every other rule.
 * Cards with no MP (or 0 printed MP) contribute nothing.
 */
function addPinnedCardMp(
  totals: MarshallingPointTotals,
  def: CardDefinition,
  value: number,
): MarshallingPointTotals {
  if (!hasMarshallingPoints(def) || def.marshallingPoints <= 0) return totals;
  const cat = def.marshallingCategory;
  return { ...totals, [cat]: totals[cat] + value };
}

/**
 * Adds an item card's marshalling points to the running totals. For a
 * Fallen-wizard the item is worth a flat 1 MP (MEWH §4); otherwise the
 * cross-alignment half-MP rule applies (MELE Part IV) when the player's
 * alignment does not match the item's alignment.
 *
 * `fwItemMpExempt` overrides the §4 clamp for a Fallen-wizard: when `true`, the
 * item scores its full printed MP. Used by Saruman (wh-9), whose
 * `fw-item-mp-full` effect exempts his non-combat items.
 */
function addItemMP(
  totals: MarshallingPointTotals,
  def: CardDefinition,
  playerAlignment: Alignment,
  fwItemMpExempt = false,
): MarshallingPointTotals {
  if (!hasMarshallingPoints(def)) return totals;
  const baseMp = def.marshallingPoints;
  if (baseMp === 0) return totals;
  const cat = def.marshallingCategory;
  let mp: number;
  if (playerAlignment === 'fallen-wizard') {
    mp = fwItemMpExempt ? baseMp : fwClampMp(baseMp, def, playerAlignment);
  } else {
    const factor = crossAlignmentItemMpFactor(playerAlignment, def.cardType);
    mp = factor < 1 ? Math.ceil(baseMp * factor) : baseMp;
  }
  if (mp === 0) return totals;
  return { ...totals, [cat]: totals[cat] + mp };
}

/** One faction-MP-override rule: a condition and the MP it grants when matched. */
type FactionMpOverrideRule = { readonly when: Condition; readonly value: number };

/**
 * Collects the faction-MP-override rule sets a player has in play (e.g. Gatherer
 * of Loyalties wh-70 as a stage permanent-event, or Pallando wh-7 as a
 * character). Each in-play card or character carrying a `faction-mp-override`
 * effect contributes its ordered rule list; the lists are concatenated in card
 * order so the shared "last matching rule wins" precedence still holds. Returns
 * an empty array when no such card is in play.
 */
function factionMpOverrideRules(
  state: GameState,
  player: PlayerState,
): FactionMpOverrideRule[] {
  const rules: FactionMpOverrideRule[] = [];
  for (const def of playerInPlayAndCharacterDefs(state, player)) {
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'faction-mp-override') rules.push(...effect.rules);
    }
  }
  return rules;
}

/**
 * Resolves the overridden marshalling-point value for a faction the player
 * controls, or `undefined` if no rule matches (so the faction scores normally).
 * Each rule is evaluated against the per-faction context
 * `{ faction: { unique, race, normalMp, name }, player: { avatar } }`; the last
 * matching rule wins, letting avatar-specific rules override the base rule.
 */
function resolveFactionMpOverride(
  def: FactionCard,
  rules: readonly FactionMpOverrideRule[],
  avatarName: string | undefined,
): number | undefined {
  const ctx = {
    faction: { unique: def.unique, race: def.race, normalMp: def.marshallingPoints, name: def.name },
    player: { avatar: avatarName },
  };
  let value: number | undefined;
  for (const rule of rules) {
    if (matchesContext(rule.when, ctx)) value = rule.value;
  }
  return value;
}

/**
 * Resolves the card definitions of every card a player has in `cardsInPlay`,
 * skipping any whose definition cannot be resolved. Centralizes the
 * resolve-and-filter loop shared by the in-play context builders below.
 */
function playerCardsInPlayDefs(state: GameState, player: PlayerState): CardDefinition[] {
  const defs: CardDefinition[] = [];
  for (const card of player.cardsInPlay) {
    const def = resolveDef(state, card.instanceId);
    if (def) defs.push(def);
  }
  return defs;
}

/**
 * Resolves the card definitions of every source a player-wide, in-play effect
 * can live on: the player's `cardsInPlay` (permanent-events, factions, stage
 * cards, …) plus their in-play characters. Character-carried player-wide effects
 * (e.g. Pallando wh-7's `faction-mp-override`, Saruman wh-9's `fw-item-mp-full`)
 * are collected the same way as ones carried by a stage permanent-event.
 */
function playerInPlayAndCharacterDefs(state: GameState, player: PlayerState): CardDefinition[] {
  const defs = [...playerCardsInPlayDefs(state, player)];
  for (const char of Object.values(player.characters)) {
    const def = resolveDef(state, char.instanceId);
    if (def) defs.push(def);
  }
  return defs;
}

/**
 * The names of all named cards a player has in `cardsInPlay`, in card order.
 *
 * A card carrying a `name-alias` effect (e.g. Skies of Fire le-228 "acts as
 * Gates of Morning for the purposes of interpreting hazards") contributes its
 * alias name in addition to its own, so any `{ "inPlay": "<alias>" }` DSL
 * condition is satisfied while the bearer is in play.
 */
function inPlayNamesOf(state: GameState, player: PlayerState): string[] {
  const names: string[] = [];
  for (const def of playerCardsInPlayDefs(state, player)) {
    if ('name' in def) names.push(def.name);
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'name-alias') names.push(effect.as);
    }
  }
  return names;
}

/**
 * Builds the list of card names currently in play as events or other cards.
 * Used to populate the `inPlay` context field so DSL conditions
 * like `{ "inPlay": "Gates of Morning" }` can be evaluated.
 *
 * Any in-play card carrying an `environment-override` effect (Peril Returned
 * td-54) reshapes the resulting set game-wide: its `considerNotInPlay` names are
 * removed (so their environment interpretation is suppressed even though the
 * card itself remains in `cardsInPlay`) and its `considerInPlay` names are added
 * (treated as in play without an actual card). Removals precede additions.
 */
export function buildInPlayNames(state: GameState): readonly string[] {
  const names = state.players.flatMap(player => inPlayNamesOf(state, player));
  return applyEnvironmentOverrides(state, names);
}

/**
 * Applies every in-play `environment-override` effect to a raw in-play-names
 * list. Collects all `considerNotInPlay` / `considerInPlay` names across both
 * players' `cardsInPlay`, removes the former, then adds the latter (additions
 * win over removals for any name in both). Returns the input unchanged when no
 * override is in play (the common case), avoiding array churn.
 */
function applyEnvironmentOverrides(state: GameState, names: string[]): string[] {
  const { add, remove } = collectEnvironmentOverride(state);
  if (remove.size === 0 && add.size === 0) return names;
  const result = names.filter(n => !remove.has(n) || add.has(n));
  for (const n of add) {
    if (!result.includes(n)) result.push(n);
  }
  return result;
}

/**
 * Computes the game-wide reduction to the maximum region distance for region
 * movement, contributed by in-play environment cards carrying a
 * `region-movement-limit` effect (e.g. No Way Forward, dm-75).
 *
 * Environments affect every player's companies, so both players' `cardsInPlay`
 * are scanned. For each such effect the contribution is `reduceWithDoorsOfNight`
 * while Doors of Night is in play, otherwise `reduce`; contributions sum across
 * cards. The returned `floor` is the largest `min` among contributing effects —
 * the effective max region distance must never be reduced below it.
 *
 * Returns `{ reduction: 0, floor: 0 }` when no such environment is in play.
 */
export function collectRegionMovementReduction(state: GameState): { reduction: number; floor: number } {
  const doorsOfNight = buildInPlayNames(state).includes('Doors of Night');
  let reduction = 0;
  let floor = 0;
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = state.cardPool[card.definitionId];
      if (!def) continue;
      for (const eff of getCardEffects(def)) {
        if (eff.type !== 'region-movement-limit') continue;
        const amount = doorsOfNight && eff.reduceWithDoorsOfNight !== undefined
          ? eff.reduceWithDoorsOfNight
          : eff.reduce;
        reduction += amount;
        floor = Math.max(floor, eff.min);
      }
    }
  }
  return { reduction, floor };
}

/**
 * Applies the {@link collectRegionMovementReduction} environment reduction to a
 * candidate max region distance. The reduction is floored at the environment's
 * `min` (never lowered below it); when no reduction is in play the input value
 * is returned unchanged.
 */
export function applyRegionMovementReduction(state: GameState, maxRegions: number): number {
  const { reduction, floor } = collectRegionMovementReduction(state);
  if (reduction <= 0) return maxRegions;
  return Math.max(floor, maxRegions - reduction);
}

/**
 * Builds the list of card names in play that belong to a specific
 * player. Used to populate the `controller.inPlay` resolver context so
 * DSL conditions can reference factions controlled by the influencing
 * player only (e.g. LE Standard Modifications like "Grey Mountain
 * Goblins (+2)", which apply only when the same player controls both
 * factions).
 */
export function buildControllerInPlayNames(
  state: GameState,
  playerId: import('../index.js').PlayerId,
): readonly string[] {
  const player = playerById(state, playerId);
  return player ? inPlayNamesOf(state, player) : [];
}

/**
 * Builds the distinct races of factions a specific player has in play.
 * Used to populate the `controller.factionRaces` resolver context so DSL
 * conditions can reference the *kind* of factions the controller already
 * has — e.g. Uruk-hai (le-291) takes "Any other Orc faction (-2)", which
 * applies whenever the controller has at least one Orc faction in play,
 * without naming a specific faction. The faction currently being
 * influenced is in hand (not yet in `cardsInPlay`), so it is naturally
 * excluded — satisfying the "any *other* Orc faction" wording.
 */
export function buildControllerFactionRaces(
  state: GameState,
  playerId: import('../index.js').PlayerId,
): readonly string[] {
  const player = playerById(state, playerId);
  if (!player) return [];
  const races = new Set(
    playerCardsInPlayDefs(state, player).filter(isFactionCard).map(def => def.race),
  );
  return [...races];
}

/**
 * Flattens a faction's `playableAt` entries to a list of site names and
 * site types. Site entries contribute their `site` name; site-type
 * entries contribute their `siteType`. Conditions like
 * `{ "faction.playableAt": "Dunnish Clan-hold" }` (AS-4 Perchen) match
 * when the corresponding site name appears in this array.
 */
export function buildFactionPlayableAt(def: FactionCard): readonly string[] {
  return def.playableAt.map(entry =>
    'region' in entry ? `region:${entry.region}`
      : 'any' in entry ? 'any'
        : 'site' in entry ? entry.site
          : entry.siteType);
}

/**
 * Resolves the geographic regions in which a faction can be played, by mapping
 * each **named site** in its `playableAt` to that site's `region` (looked up in
 * the card pool) and folding in explicit `region:` entries. Site-type and `any`
 * entries contribute no specific region (a site type spans many regions, so it
 * is not a definite "can be played in region X" claim). Multiple site defs may
 * share a name across sets (e.g. TW and LE both print Pelargir); they resolve to
 * the same region, so the de-duplicating set is unaffected.
 *
 * Used by DSL conditions like
 * `{ "faction.playableRegions": { "$includes": "Lamedon" } }` — e.g. Firiel
 * (dm-10): "+2 direct influence against … factions that can be played in
 * Anfalas, Anórien, Belfalas, Lamedon, and Lebennin."
 */
export function buildFactionPlayableRegions(state: GameState, def: FactionCard): readonly string[] {
  const namedSites = new Set(
    def.playableAt.filter((e): e is { site: string } => 'site' in e).map(e => e.site),
  );
  const regions = new Set<string>();
  for (const entry of def.playableAt) {
    if ('region' in entry) regions.add(entry.region);
  }
  if (namedSites.size > 0) {
    for (const cardDef of Object.values(state.cardPool)) {
      if (isSiteCard(cardDef) && namedSites.has(cardDef.name)) {
        regions.add(cardDef.region);
      }
    }
  }
  return [...regions];
}

/**
 * Builds a {@link ResolverContext} for computing a character's effective stats.
 *
 * Includes `bearer` (the character), `target` (same character, for global
 * effects that filter by `target.race` etc.), `inPlay` (names of all
 * events/cards in play for condition checking), `company.characterNames`
 * (names of other characters in the same company), and optionally
 * `bearer.companionDefinitionIds` (definition IDs of companions, for
 * conditions that match by ID rather than name).
 */
/**
 * Returns true when a company is at, moving to, or moving from an Under-deeps
 * site. A company's `currentSite` stays the origin for the whole M/H phase
 * (it is only replaced by the destination at step 8, when movement finalizes
 * and the company is no longer "moving"), so checking `currentSite` covers both
 * "at" and "moving from", while `destinationSite` covers "moving to". Used to
 * spare characters near the Under-deeps from environments like The Sun Shone
 * Fiercely (ba-25).
 */
function companyAtOrMovingUnderDeeps(
  state: GameState,
  company: Company | undefined,
): boolean {
  if (!company) return false;
  const isUnderDeepsDef = (defId: CardDefinitionId | undefined): boolean => {
    if (!defId) return false;
    const def = state.cardPool[defId];
    return !!(def && 'keywords' in def
      && (def as { keywords?: readonly string[] }).keywords?.includes('under-deeps'));
  };
  return isUnderDeepsDef(company.currentSite?.definitionId)
    || isUnderDeepsDef(company.destinationSite?.definitionId);
}

function buildEffectiveStatsContext(
  charDef: CharacterCard,
  inPlayNames: readonly string[],
  companionNames: readonly string[] = [],
  companionDefinitionIds: readonly string[] = [],
  ringwraithMode?: RingwraithModeEffect['mode'],
  isFollower = false,
  atOrMovingUnderDeeps = false,
): ResolverContext {
  const charInfo = buildBearerContext(charDef);
  return {
    reason: 'effective-stats',
    bearer: { ...charInfo, companionDefinitionIds, ringwraithMode, isFollower, atOrMovingUnderDeeps },
    target: charInfo,
    inPlay: inPlayNames,
    company: { characterNames: companionNames },
  };
}

/**
 * Resolves the Ringwraith mode currently established for a company by an in-play
 * mode card (Black Rider / Fell Rider / Heralded Lord) bound to it via
 * `CardInPlay.companyId`. Returns undefined when no mode card is bound.
 *
 * Exposed to the effective-stats resolver as `bearer.ringwraithMode` so a
 * Ringwraith avatar's per-mode `stat-modifier` effects can fire (e.g. Hoarmûrath
 * le-53: +1 DI in Heralded Lord mode, +2 prowess in Fell Rider mode).
 */
function resolveCompanyRingwraithMode(
  state: GameState,
  player: PlayerState,
  companyId: CompanyId | undefined,
): RingwraithModeEffect['mode'] | undefined {
  if (companyId === undefined) return undefined;
  for (const card of player.cardsInPlay) {
    if (card.companyId !== companyId) continue;
    const def = state.cardPool[card.definitionId];
    const effects = (def as { effects?: readonly CardEffect[] } | undefined)?.effects;
    if (!effects) continue;
    for (const eff of effects) {
      if (eff.type === 'ringwraith-mode') return eff.mode;
    }
  }
  return undefined;
}

/** One in-play global item-stat modifier (from an `in-play-item-modifier` effect). */
type InPlayItemModifier = {
  readonly itemFilter?: Condition;
  readonly corruptionPoints: number;
  readonly marshallingPoints: number;
};

/**
 * Collects every `in-play-item-modifier` effect carried by a card in either
 * player's `cardsInPlay` (e.g. Rumor of the One le-224, "+1 to the corruption
 * points and the marshalling points for all ring items"). Returns an empty
 * array when no such card is in play, so the per-item scan below short-circuits.
 */
function collectInPlayItemModifiers(state: GameState): InPlayItemModifier[] {
  const out: InPlayItemModifier[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = resolveDef(state, card.instanceId);
      if (!def) continue;
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'in-play-item-modifier') continue;
        out.push({
          itemFilter: effect.itemFilter,
          corruptionPoints: effect.corruptionPoints ?? 0,
          marshallingPoints: effect.marshallingPoints ?? 0,
        });
      }
    }
  }
  return out;
}

/**
 * Sums the corruption-point and marshalling-point deltas that the in-play
 * global item modifiers grant to a single item, matching each modifier's
 * optional `itemFilter` against a per-item context `{ item: { keywords, name,
 * cardType } }`. Returns `{ cp: 0, mp: 0 }` when nothing matches.
 */
function itemModifierDeltas(
  itemDef: CardDefinition,
  mods: readonly InPlayItemModifier[],
): { cp: number; mp: number } {
  if (mods.length === 0) return { cp: 0, mp: 0 };
  const ctx = {
    item: {
      keywords: (itemDef as { keywords?: readonly string[] }).keywords ?? [],
      name: itemDef.name,
      cardType: itemDef.cardType,
    },
  };
  let cp = 0;
  let mp = 0;
  for (const m of mods) {
    if (m.itemFilter && !matchesContext(m.itemFilter, ctx)) continue;
    cp += m.corruptionPoints;
    mp += m.marshallingPoints;
  }
  return { cp, mp };
}

/**
 * Collects the multipliers of every `corruption-source-multiplier` effect
 * carried by a card in either player's `cardsInPlay` (The Balance of Things
 * tw-93, "corruption points doubled for one of his sources of corruption").
 * Each in-play copy scales one of a character's corruption sources; the
 * returned array holds one multiplier per copy. Empty when none is in play,
 * so the per-character source scan below short-circuits.
 */
function collectCorruptionSourceMultipliers(state: GameState): number[] {
  const out: number[] = [];
  for (const player of state.players) {
    for (const card of player.cardsInPlay) {
      const def = resolveDef(state, card.instanceId);
      if (!def) continue;
      for (const effect of getCardEffects(def)) {
        if (effect.type !== 'corruption-source-multiplier') continue;
        out.push(effect.multiplier ?? 2);
      }
    }
  }
  return out;
}

/**
 * Given a character's individual corruption-source values and the multipliers
 * of every in-play `corruption-source-multiplier` effect, returns the extra
 * corruption the character suffers. The controlling player minimises their
 * corruption, so each copy scales the character's smallest remaining source and
 * the largest multiplier is paired with the smallest source (rearrangement
 * inequality). Returns 0 when the character has no source or no copy is in play.
 */
function corruptionSourceMultiplierDelta(
  sources: readonly number[],
  multipliers: readonly number[],
): number {
  if (sources.length === 0 || multipliers.length === 0) return 0;
  const ascSources = [...sources].sort((a, b) => a - b);
  const descIncrements = multipliers.map(m => m - 1).sort((a, b) => b - a);
  const k = Math.min(ascSources.length, descIncrements.length);
  let delta = 0;
  for (let i = 0; i < k; i++) {
    delta += ascSources[i] * descIncrements[i];
  }
  return delta;
}

/**
 * Computes effective stats for a character using the card effects resolver.
 *
 * Collects all effects from the character's card definition and their
 * equipped items, then resolves stat modifiers for each stat. Falls back
 * to the old hardcoded approach for items without effects arrays.
 *
 * @param companionNames Names of other characters in the same company (used
 *   for `company.characterNames` conditions like the troll-triplet mind reduction).
 * @param companionDefinitionIds Definition IDs of companions (used for
 *   `bearer.companionDefinitionIds` conditions). Pass empty array if unknown.
 */
function computeEffectiveStats(
  state: GameState,
  char: CharacterInPlay,
  charDef: CharacterCard,
  inPlayNames: readonly string[],
  companionNames: readonly string[] = [],
  companionDefinitionIds: readonly string[] = [],
  ringwraithMode?: RingwraithModeEffect['mode'],
  controllingPlayerId?: PlayerId,
  bearerPlayerAlignment?: Alignment,
  atOrMovingUnderDeeps = false,
): EffectiveStats {
  const isFollower = char.controlledBy !== 'general';
  const context = buildEffectiveStatsContext(charDef, inPlayNames, companionNames, companionDefinitionIds, ringwraithMode, isFollower, atOrMovingUnderDeeps);
  let charEffects = collectCharacterEffects(state, char, context);
  const globalEffects = collectGlobalEffects(state, 'all-characters', context);
  // `own-characters`-scoped effects (e.g. A Strident Spawn wh-61) apply only to
  // characters controlled by the player who controls the source card.
  const ownEffects = controllingPlayerId !== undefined
    ? collectGlobalEffects(state, 'own-characters', context, undefined, controllingPlayerId)
    : [];

  // MEWH §9: an Orc or Troll may bear a hero item, but all of its bonuses and
  // special abilities are ignored (movement/playability restrictions and the
  // item's corruption points still apply — the latter via the structural
  // `corruptionPoints` sum below, not through these effects). Drop every effect
  // sourced from a hero item carried by an Orc/Troll bearer before resolving.
  const bearerIsOrcOrTroll = charDef.race === 'orc' || charDef.race === 'troll';
  if (bearerIsOrcOrTroll) {
    charEffects = charEffects.filter(ce => ce.sourceDef.cardType !== 'hero-resource-item');
  }

  // Rule 9.20: a Wizard player's character cannot USE a minion item it bears,
  // and a Ringwraith player's character cannot USE a hero item it bears
  // (corruption points still apply, via the structural sum below — only the
  // item's effects are nulled).
  const bearerBlocksMinionItems = bearerPlayerAlignment === 'wizard';
  const bearerBlocksHeroItems = bearerPlayerAlignment === 'ringwraith';
  if (bearerBlocksMinionItems) {
    charEffects = charEffects.filter(ce => ce.sourceDef.cardType !== 'minion-resource-item');
  }
  if (bearerBlocksHeroItems) {
    charEffects = charEffects.filter(ce => ce.sourceDef.cardType !== 'hero-resource-item');
  }

  // Rule 9.20: "Ringwraiths may bear items but those items cannot be used" —
  // unlike the player-alignment rule above, this is about the Ringwraith
  // (Nazgûl) avatar character itself, mirroring the Balrog avatar's blanket
  // item-usage ban below. Applies regardless of which item alignment it bears.
  const bearerIsRingwraithAvatar = charDef.race === Race.Ringwraith;
  if (bearerIsRingwraithAvatar) {
    charEffects = charEffects.filter(ce => !isItemCard(ce.sourceDef));
  }

  // MEBA: The Balrog may carry items (including rings) but may not use them —
  // "an item has no effect on The Balrog's company or on his attributes and
  // abilities." Drop every effect sourced from an item borne by the Balrog
  // avatar; the structural prowess/body/corruption contributions are likewise
  // skipped below (`bearerIsBalrogAvatar`). The item still occupies the bearer
  // (uniqueness, transfer, ring auto-test) — only its effect is nulled.
  const bearerIsBalrogAvatar = isBalrogAvatarDef(charDef);
  if (bearerIsBalrogAvatar) {
    charEffects = charEffects.filter(ce => !isItemCard(ce.sourceDef));
  }

  // `play-flag: "bearer-cannot-use-items"` — the card-driven form of the same
  // ban ("Radagast may bear, but may not use, items" — the Shapeshifter forms
  // wh-112/115/116). Unlike the Ringwraith/Balrog avatar bans above this is not
  // keyed on the character's race but on a card currently borne by them, so the
  // flag must be read *before* the filter runs; the flag's own source is a
  // permanent-event rather than an item, so it never filters itself away.
  // Corruption points still apply (the item is still borne) — matching the
  // MEWH §9 / rule 9.20 "bear but not use" wording, and unlike the Balrog ban.
  const bearerCannotUseItems = charEffects.some(
    ce => ce.effect.type === 'play-flag' && ce.effect.flag === 'bearer-cannot-use-items',
  );
  if (bearerCannotUseItems) {
    charEffects = charEffects.filter(ce => !isItemCard(ce.sourceDef));
  }
  const collected = [...charEffects, ...globalEffects, ...ownEffects];

  // If we have DSL effects, use the resolver for prowess, body, and DI
  const hasAnyEffects = collected.length > 0;

  let prowess: number;
  let body: number;
  let directInfluence: number;
  let corruptionPoints = 0;

  // The Balance of Things (tw-93): while a `corruption-source-multiplier` card
  // is in play, one of each character's corruption sources is scaled (the
  // controller minimising, so the smallest source). Track individual source
  // values only when such a card is in play and the bearer can hold corruption
  // (the Balrog avatar's borne items contribute none). See
  // `corruptionSourceMultiplierDelta`.
  const corruptionMultipliers = collectCorruptionSourceMultipliers(state);
  const trackCorruptionSources = corruptionMultipliers.length > 0 && !bearerIsBalrogAvatar;
  const corruptionSources: number[] = [];

  if (hasAnyEffects) {
    prowess = resolveStatModifiers(collected, 'prowess', charDef.prowess, context);
    body = resolveStatModifiers(collected, 'body', charDef.body, context);
    directInfluence = resolveStatModifiers(collected, 'direct-influence', charDef.directInfluence, context);

    // Corruption: sum from stat-modifier effects on corruption-points,
    // plus direct corruptionPoints from items and corruption cards that
    // don't have effects arrays yet.
    // Company-scoped stat-modifiers (e.g. The One Ring +1 CP) are collected
    // via collectCompanyItemEffects inside collectCharacterEffects and flow
    // through here as normal stat-modifier entries.
    const cpFromEffects = resolveStatModifiers(collected, 'corruption-points', 0, context);
    corruptionPoints = cpFromEffects;

    // Each card contributing corruption via a `corruption-points` stat-modifier
    // (e.g. The One Ring) is one corruption source: group the modifiers by
    // source card instance and sum each card's contribution.
    if (trackCorruptionSources) {
      const exprCtx = context as unknown as Record<string, unknown>;
      const perSource = new Map<string, number>();
      for (const ce of collected) {
        if (ce.effect.type === 'stat-modifier' && ce.effect.stat === 'corruption-points') {
          const v = evaluateExpr(ce.effect.value, exprCtx);
          perSource.set(ce.sourceInstance as string, (perSource.get(ce.sourceInstance as string) ?? 0) + v);
        }
      }
      for (const v of perSource.values()) {
        if (v > 0) corruptionSources.push(v);
      }
    }
  } else {
    // Fallback: use the old hardcoded approach for cards without effects
    prowess = charDef.prowess;
    body = charDef.body;
    directInfluence = charDef.directInfluence;
  }

  // Resolve effective mind: only set if a stat-modifier for "mind" fires.
  // charDef.mind is null for avatars; skip mind computation for them.
  let effectiveMind: number | undefined;
  if (hasAnyEffects && charDef.mind !== null) {
    const mindModifiers = collected.filter(ce => ce.effect.type === 'stat-modifier' && 'stat' in ce.effect && ce.effect.stat === 'mind');
    if (mindModifiers.length > 0) {
      effectiveMind = resolveStatModifiers(mindModifiers, 'mind', charDef.mind, context);
    }
  }

  // Per rule 9.15: prowess/body modifiers from items only apply while
  // the item is in use (one per slot). Corruption points come from
  // bearing the card and apply to every borne item regardless.
  //
  // The structural `prowessModifier` / `bodyModifier` fields are a
  // legacy way to declare what would otherwise be `stat-modifier` DSL
  // effects. Apply them only for items that haven't migrated to DSL
  // for those stats — checked per item, not per character. (The
  // character may have other DSL effects without preempting an item's
  // structural fallback; ditto for unrelated DSL effects on the item
  // itself, e.g. `item-play-site`.)
  const activeItems = pickActiveItemsForCharacter(state, char);
  // Global item-stat modifiers in play (Rumor of the One le-224: +1 corruption
  // point to all ring items). Applied to each borne matching item's corruption
  // total below, under the same Balrog-avatar exclusion as its printed CP.
  const inPlayItemMods = collectInPlayItemModifiers(state);
  // Whip of Many Thongs (ba-82): weapons whose effects were cancelled for the
  // current combat contribute no structural prowess/body either (the DSL-effect
  // path is filtered in `collectCharacterEffects`; this covers weapons that
  // declare their bonus via the legacy `prowessModifier`/`bodyModifier` fields).
  const suppressedWeapons = state.combat?.suppressedWeaponInstanceIds;
  for (const item of char.items) {
    const itemDef = resolveDef(state, item.instanceId);
    if (isItemCard(itemDef)) {
      const itemEffects = itemDef.effects ?? [];
      const itemHasStatMod = itemEffects.some(e => e.type === 'stat-modifier');
      const weaponSuppressed = !!suppressedWeapons?.includes(item.instanceId);
      // MEWH §9: structural prowess/body bonuses from a hero item are ignored on
      // an Orc/Troll bearer (its corruption points still apply below).
      const heroItemOnOrcTroll = bearerIsOrcOrTroll && itemDef.cardType === 'hero-resource-item';
      // Rule 9.20: a Wizard bearer's minion items, a Ringwraith bearer's hero
      // items, and any item on a Ringwraith avatar contribute no structural bonus.
      const itemUnusableByAlignment = (bearerBlocksMinionItems && itemDef.cardType === 'minion-resource-item')
        || (bearerBlocksHeroItems && itemDef.cardType === 'hero-resource-item')
        || bearerIsRingwraithAvatar
        || bearerCannotUseItems;
      if (!itemHasStatMod && !heroItemOnOrcTroll && !bearerIsBalrogAvatar && !itemUnusableByAlignment && !weaponSuppressed && activeItems.has(item.instanceId as string)) {
        prowess += itemDef.prowessModifier;
        body += itemDef.bodyModifier;
      }
      // MEBA: an item borne by the Balrog avatar has no effect on his
      // attributes — its corruption points do not apply either.
      if (!bearerIsBalrogAvatar) {
        const itemCp = itemDef.corruptionPoints + itemModifierDeltas(itemDef, inPlayItemMods).cp;
        corruptionPoints += itemCp;
        if (trackCorruptionSources && itemCp > 0) corruptionSources.push(itemCp);
      }
    }
  }

  for (const hazard of char.hazards) {
    const hDef = resolveDef(state, hazard.instanceId);
    if (hDef && hDef.cardType === 'hazard-corruption') {
      corruptionPoints += hDef.corruptionPoints;
      if (trackCorruptionSources && hDef.corruptionPoints > 0) corruptionSources.push(hDef.corruptionPoints);
    }
  }

  // The Balance of Things (tw-93): scale one (per in-play copy) of the
  // character's corruption sources, the controller minimising by scaling the
  // smallest. No source → no effect.
  if (trackCorruptionSources && corruptionSources.length > 0) {
    corruptionPoints += corruptionSourceMultiplierDelta(corruptionSources, corruptionMultipliers);
  }

  // MELE §8.37: trophy bonus — sum total printed MPs on all trophy cards.
  // Trophies are creature cards stored by definitionId; look them up directly
  // in the card pool rather than via resolveDef (which requires an instance
  // lookup that may fail for synthetically-placed trophies in tests).
  if (char.trophies && char.trophies.length > 0) {
    let totalTrophyMp = 0;
    for (const trophy of char.trophies) {
      const trophyDef = state.cardPool[trophy.definitionId];
      if (trophyDef && 'killMarshallingPoints' in trophyDef) {
        totalTrophyMp += (trophyDef as { killMarshallingPoints: number }).killMarshallingPoints;
      }
    }
    if (totalTrophyMp >= 4) {
      directInfluence += 2;
      prowess = Math.min(prowess + 2, 9);
    } else if (totalTrophyMp === 3) {
      directInfluence += 2;
      prowess = Math.min(prowess + 1, 9);
    } else if (totalTrophyMp === 2) {
      directInfluence += 1;
      prowess = Math.min(prowess + 1, 9);
    } else if (totalTrophyMp === 1) {
      directInfluence += 1;
    }
  }

  const result: EffectiveStats = { prowess, body, directInfluence, corruptionPoints };
  if (effectiveMind !== undefined) {
    return { ...result, mind: effectiveMind };
  }
  return result;
}

/** Returns true if two EffectiveStats are identical. */
function statsEqual(a: EffectiveStats, b: EffectiveStats): boolean {
  return a.prowess === b.prowess && a.body === b.body &&
    a.directInfluence === b.directInfluence && a.corruptionPoints === b.corruptionPoints &&
    a.mind === b.mind;
}

/**
 * A single Fallen-wizard full-MP exemption entry (from a `fw-item-mp-full` or
 * `fw-ally-mp-full` effect): the card-definition `filter` (a `null` filter means
 * "every card"), and whether the exemption is restricted to the avatar's company.
 */
type FwMpFullEntry = { readonly filter: Condition | null; readonly inAvatarCompany: boolean };

/**
 * Resolves the card definitions of every source a Fallen-wizard's MP-exemption
 * effects can live on: the player's in-play characters (Saruman wh-9 carries
 * `fw-item-mp-full` as a character) plus their `cardsInPlay` permanent-events
 * (Join the Hunt wh-93 / Oromë's Warders wh-94 carry the effects as stage
 * permanent-events).
 */
function fwExemptionSourceDefs(state: GameState, player: PlayerState): CardDefinition[] {
  return playerInPlayAndCharacterDefs(state, player);
}

/**
 * Collects the item marshalling-point exemption entries a Fallen-wizard player
 * currently has in play (MEWH §4 exception, e.g. Saruman wh-9, Join the Hunt
 * wh-93). Returns each `fw-item-mp-full` effect's `filter` (absent → `null`,
 * "every item") together with its `inAvatarCompany` flag. Empty for any
 * non-Fallen-wizard player.
 *
 * The list is consumed by {@link itemExemptFromFwClamp} when scoring each item.
 */
function fwItemMpFullEntries(state: GameState, player: PlayerState): FwMpFullEntry[] {
  if (player.alignment !== 'fallen-wizard') return [];
  const entries: FwMpFullEntry[] = [];
  for (const def of fwExemptionSourceDefs(state, player)) {
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'fw-item-mp-full') {
        entries.push({ filter: effect.filter ?? null, inAvatarCompany: effect.inAvatarCompany ?? false });
      }
    }
  }
  return entries;
}

/**
 * Collects the ally marshalling-point exemption entries a Fallen-wizard player
 * currently has in play (`fw-ally-mp-full`, e.g. Join the Hunt wh-93). Each
 * matching ally scores its full printed MP instead of the §4 1-MP clamp. Empty
 * for any non-Fallen-wizard player.
 */
function fwAllyMpFullEntries(state: GameState, player: PlayerState): FwMpFullEntry[] {
  if (player.alignment !== 'fallen-wizard') return [];
  const entries: FwMpFullEntry[] = [];
  for (const def of fwExemptionSourceDefs(state, player)) {
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'fw-ally-mp-full') {
        entries.push({ filter: effect.filter ?? null, inAvatarCompany: effect.inAvatarCompany ?? false });
      }
    }
  }
  return entries;
}

/**
 * Collects the character marshalling-point exemption entries a Fallen-wizard
 * player currently has in play (`fw-char-mp-full`, e.g. the wh-4 Gandalf). Each
 * matching character scores its full printed character MP instead of the §4
 * 1-MP clamp. Empty for any non-Fallen-wizard player.
 */
function fwCharMpFullEntries(state: GameState, player: PlayerState): FwMpFullEntry[] {
  if (player.alignment !== 'fallen-wizard') return [];
  const entries: FwMpFullEntry[] = [];
  for (const def of fwExemptionSourceDefs(state, player)) {
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'fw-char-mp-full') {
        entries.push({ filter: effect.filter ?? null, inAvatarCompany: effect.inAvatarCompany ?? false });
      }
    }
  }
  return entries;
}

/**
 * Whether a card definition (item or ally) is exempt from the Fallen-wizard
 * 1-MP clamp given the active full-MP entries. A card is exempt if any entry's
 * filter matches it (a `null` filter matches every card) **and** the entry's
 * company restriction is satisfied — an `inAvatarCompany` entry only applies
 * when the bearer is in the player's avatar company (`bearerInAvatarCompany`).
 */
function cardExemptFromFwClamp(
  def: CardDefinition,
  entries: readonly FwMpFullEntry[],
  bearerInAvatarCompany: boolean,
): boolean {
  return entries.some(e =>
    (!e.inAvatarCompany || bearerInAvatarCompany)
    && (e.filter === null || matchesDefinition(def, e.filter)));
}

/**
 * Collects the `permanent-event-mp` overrides a player currently has in play
 * (e.g. Man of Skill wh-119). Scans the player's in-play cards and returns each
 * effect's `{ value, requiresResource }`. A permanent-event is matched by such
 * an override when it carries a `play-condition` requiring that resource
 * subtype's site (see {@link permanentEventMpOverride}).
 */
function permanentEventMpOverrides(
  state: GameState,
  player: PlayerState,
): { value: number; requiresResource: string }[] {
  const overrides: { value: number; requiresResource: string }[] = [];
  for (const card of player.cardsInPlay) {
    const def = resolveDef(state, card.instanceId);
    if (!def) continue;
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'permanent-event-mp') {
        overrides.push({ value: effect.value, requiresResource: effect.requiresResource });
      }
    }
  }
  return overrides;
}

/**
 * If an in-play permanent-event is subject to a `permanent-event-mp` override,
 * returns the overridden marshalling-point value; otherwise `undefined`. A
 * permanent-event matches an override iff it carries a `play-condition` with
 * `requires: 'site-has-resource'` and a `subtype` equal to the override's
 * `requiresResource` (the "requires a site where X is playable" prerequisite).
 */
function permanentEventMpOverride(
  def: CardDefinition,
  overrides: { value: number; requiresResource: string }[],
): number | undefined {
  if (overrides.length === 0) return undefined;
  const siteHasResource = findPlayConditionEffect(def, 'site-has-resource');
  if (!siteHasResource?.subtype) return undefined;
  const match = overrides.find(o => o.requiresResource === siteHasResource.subtype);
  return match?.value;
}

/** One `noncharacter-mp-override` rule: a per-card condition and its MP value. */
type NonCharacterMpOverrideRule = { readonly when: Condition; readonly value: number };

/**
 * Collects the `noncharacter-mp-override` rules a player currently has in play
 * (e.g. Give Welcome to the Unexpected wh-99). The carrying stage
 * permanent-event is placed "on the avatar", so it lives in the avatar's
 * `items` rather than `cardsInPlay`; both locations are scanned so the override
 * counts while the card is attached ("if on Gandalf"). Empty when no such card
 * is in play, so non-Fallen-wizards and unaffected games pay nothing.
 */
function nonCharacterMpOverrideRules(
  state: GameState,
  player: PlayerState,
): NonCharacterMpOverrideRule[] {
  const rules: NonCharacterMpOverrideRule[] = [];
  const collect = (def: CardDefinition | undefined): void => {
    if (!def) return;
    for (const effect of getCardEffects(def)) {
      if (effect.type === 'noncharacter-mp-override') rules.push({ when: effect.when, value: effect.value });
    }
  };
  for (const card of player.cardsInPlay) collect(resolveDef(state, card.instanceId));
  for (const char of Object.values(player.characters)) {
    for (const item of char.items) collect(resolveDef(state, item.instanceId));
  }
  return rules;
}

/**
 * Resolves the overridden marshalling-point value for one of the player's
 * **non-character** MP-scoring cards (an item, ally, faction, or misc
 * permanent-event) under the active `noncharacter-mp-override` rules, or
 * `undefined` when no rule matches (so the card scores normally). Each rule is
 * evaluated against `{ card: { unique, normalMp, cardType, name, race } }`,
 * where `normalMp` is the card's *printed* marshalling points; the last matching
 * rule wins. Cards with no printed MP are never overridden.
 */
function nonCharacterMpOverride(
  def: CardDefinition,
  rules: readonly NonCharacterMpOverrideRule[],
): number | undefined {
  if (rules.length === 0 || !hasMarshallingPoints(def)) return undefined;
  const ctx = {
    card: {
      unique: 'unique' in def ? (def as { unique?: boolean }).unique : undefined,
      normalMp: def.marshallingPoints,
      cardType: def.cardType,
      name: 'name' in def ? def.name : undefined,
      race: 'race' in def ? (def as { race?: string }).race : undefined,
    },
  };
  let value: number | undefined;
  for (const rule of rules) {
    if (matchesContext(rule.when, ctx)) value = rule.value;
  }
  return value;
}

function recomputePlayer(state: GameState, player: PlayerState, inPlayNames: readonly string[]): PlayerState {
  // MEWH §4 exception: items matching an in-play `fw-item-mp-full` effect's
  // filter (e.g. Saruman's non-combat items, or Join the Hunt's weapon/armor/
  // shield/helmet items in Alatar's company) score full printed MP instead of
  // being clamped to 1. Computed once per player; empty for non-Fallen-wizards.
  const fwItemExemptions = fwItemMpFullEntries(state, player);
  // Join the Hunt (wh-93) / Oromë's Warders (wh-94): allies matching a
  // `fw-ally-mp-full` filter score full printed MP instead of the §4 1-MP clamp.
  const fwAllyExemptions = fwAllyMpFullEntries(state, player);
  // Fallen-wizard Gandalf (wh-4): characters matching a `fw-char-mp-full` filter
  // score their full printed character MP instead of the §4 1-MP clamp.
  const fwCharExemptions = fwCharMpFullEntries(state, player);
  // Great Patron (wh-72): in-play overrides letting the Fallen-wizard's
  // characters/allies that normally give >= threshold MP score `value` instead
  // of the §4 1-MP clamp. Empty for non-Fallen-wizards.
  const fwCharAllyCaps = fwCharacterAllyMpCaps(state, player);
  // Give Welcome to the Unexpected (wh-99): in-play overrides re-valuing the
  // player's non-character cards (items, allies, factions, misc permanent-events)
  // that match a per-card condition. Collected from `cardsInPlay` and the
  // avatar's `items` (the carrier is placed "on Gandalf"); empty otherwise.
  const ncMpOverrides = nonCharacterMpOverrideRules(state, player);
  // Await the Onset (wh-96): pin every company-held MP card outside one of the
  // player's Wizardhavens to this value, overriding all other MP rules.
  // Undefined when the card is not in play (the common case).
  const nonHavenMpPin = nonHavenCompanyMpPin(state, player);
  // "in Alatar's company": the id of the company holding the player's revealed
  // avatar, resolved only when some exemption is company-restricted (Join the
  // Hunt). Undefined when the avatar is not in play, so no character matches.
  const needsAvatarCompany = fwItemExemptions.some(e => e.inAvatarCompany)
    || fwAllyExemptions.some(e => e.inAvatarCompany)
    || fwCharExemptions.some(e => e.inAvatarCompany);
  const avatarCompanyId = needsAvatarCompany
    ? (() => {
      const avatar = findPlayerAvatar(state, player);
      return avatar ? findCharacterCompany(player.companies, avatar.instanceId)?.id : undefined;
    })()
    : undefined;
  let generalInfluenceUsed = 0;
  let generalInfluenceBonus = 0;
  let generalInfluenceControlPenalty = 0;
  let generalInfluenceOverride: number | undefined;
  let mp = ZERO_MARSHALLING_POINTS;
  // Global item-stat modifiers in play (Rumor of the One le-224: +1 marshalling
  // point to all ring items). Collected once per recompute; applied flat to each
  // matching item's marshalling category in the item MP loop below.
  const inPlayItemMods = collectInPlayItemModifiers(state);
  // MEAS §6e: marshalling points of company-held cards (characters, their items
  // and allies) at an Under-deeps site, accumulated separately so they can be
  // excluded from the *call* threshold while remaining in the final tally.
  let underDeepsMp = ZERO_MARSHALLING_POINTS;
  let charactersChanged = false;
  const newCharacters: Record<string, CharacterInPlay> = {};

  // Build a map from character instance ID → names of other characters in the
  // same company, enabling companion-conditional stat modifiers (e.g. the
  // troll-triplet mind reduction when Bûrat/Tûma/Wûluag are in the same company).
  const companionNamesMap = new Map<string, string[]>();
  for (const company of player.companies) {
    // Collect all names in this company first
    const namesInCompany: string[] = [];
    for (const cid of company.characters) {
      const ch = player.characters[cid];
      if (!ch) continue;
      const def = state.cardPool[ch.definitionId];
      if (def) namesInCompany.push(def.name);
    }
    // For each character, store the names of the OTHER company members
    for (const cid of company.characters) {
      const ch = player.characters[cid];
      if (!ch) continue;
      const def = state.cardPool[ch.definitionId];
      const ownName = def?.name ?? null;
      companionNamesMap.set(cid as string, namesInCompany.filter(n => n !== ownName));
    }
  }

  for (const [key, char] of Object.entries(player.characters)) {
    const charDef = resolveDef(state, char.instanceId);
    if (!isCharacterCard(charDef)) {
      newCharacters[key] = char;
      continue;
    }

    // Prisoners (CoE 8.35) and Press-ganged characters (ba-22) are held "off to
    // the side": they cost 0 GI and are worth negative character MPs.
    const isPrisoner = state.activeConstraints.some(
      c => c.target.kind === 'character'
        && c.target.characterId === char.instanceId
        && (c.kind.type === 'character-is-prisoner' || c.kind.type === 'character-pressed'),
    );

    // Compute effective stats with both companion name and ID context so that
    // conditions using either company.characterNames or bearer.companionDefinitionIds work.
    const companionNames = companionNamesMap.get(key) ?? [];
    const charCompany = findCharacterCompany(player.companies, char.instanceId);
    const companionDefinitionIds = (charCompany?.characters ?? [])
      .filter(id => id !== char.instanceId)
      .map(id => {
        const compChar = player.characters[id];
        if (!compChar) return null;
        return compChar.definitionId as string;
      })
      .filter((id): id is string => id !== null);
    const ringwraithMode = resolveCompanyRingwraithMode(state, player, charCompany?.id);
    // The Sun Shone Fiercely (ba-25) and similar environments spare characters
    // at, moving to, or moving from an Under-deeps site. Flag the character's
    // company spatial relationship to any Under-deeps site so `all-characters`
    // effects can gate on `bearer.atOrMovingUnderDeeps`.
    const atOrMovingUnderDeeps = companyAtOrMovingUnderDeeps(state, charCompany);
    const newStats = computeEffectiveStats(state, char, charDef, inPlayNames, companionNames, companionDefinitionIds, ringwraithMode, player.id, player.alignment, atOrMovingUnderDeeps);
    if (statsEqual(char.effectiveStats, newStats)) {
      newCharacters[key] = char;
    } else {
      newCharacters[key] = { ...char, effectiveStats: newStats };
      charactersChanged = true;
    }

    // General influence: prisoners cost 0 GI; others under GI count normally.
    // Use effective mind (from stat-modifier effects) when available, otherwise
    // fall back to the base mind from the card definition.
    // A character flagged `influenceUnsubtracted` was removed from direct-influence
    // control outside an organization phase (e.g. by Rebel-talk); per CoE 2.II.2.2.3
    // its mind is not subtracted from general influence until the player's next
    // organization phase clears the flag.
    // Await the Advent of Allies (dm-117): a character bearing this attached
    // event "does not count against general influence" — its mind is not
    // subtracted from the pool while the card is attached.
    const giExempt = characterBearsAttachedEffect(state, char, 'general-influence-exempt');
    if (!isPrisoner && char.controlledBy === 'general' && !char.influenceUnsubtracted && charDef.mind !== null && !giExempt) {
      // A `control-restriction` (e.g. Wizard's Myrmidon) overrides the GI cost
      // to keep the character; otherwise the effective/printed mind is used.
      const mindCost = controlCostOf(state, char, newStats.mind ?? charDef.mind) ?? 0;
      generalInfluenceUsed += mindCost;
    }

    // MEAS §6e: is this character's company sitting at an Under-deeps site? Its
    // MPs are credited normally to `mp` (final tally) but also mirrored into
    // `underDeepsMp` so they can be removed from the call threshold.
    const charSiteDefId = charCompany?.currentSite?.definitionId;
    const charSiteDef = charSiteDefId ? state.cardPool[charSiteDefId] : undefined;
    const atUnderDeeps = !!(charSiteDef && 'keywords' in charSiteDef
      && (charSiteDef as { keywords?: readonly string[] }).keywords?.includes('under-deeps'));

    // Await the Onset (wh-96): when the pin is in play, this character's company
    // (and thus the items/allies it bears) is "not in one of your Wizardhavens"
    // unless its current site is a Wizardhaven for the player. A company with no
    // current site counts as outside. `pinValue` is undefined otherwise, leaving
    // normal MP scoring untouched.
    const pinValue = nonHavenMpPin !== undefined
      && !isHavenForPlayer(charSiteDef, player.alignment, { state, siteDefinitionId: charSiteDefId, playerId: player.id })
      ? nonHavenMpPin
      : undefined;

    // Is this character (and thus the items/allies it bears) in the player's
    // avatar company? Gates the "in Alatar's company" full-MP exemptions (Join
    // the Hunt wh-93). `avatarCompanyId` is undefined when no exemption is
    // company-restricted, so this stays false for every other card.
    const bearerInAvatarCompany = avatarCompanyId !== undefined && charCompany?.id === avatarCompanyId;

    // Await the Advent of Allies (dm-117): a character bearing this attached
    // event has its own printed marshalling points nullified ("its marshalling
    // points do not count"). Only the character's own MP is dropped — the items
    // and allies it bears still score normally below.
    const ownMpNotCounted = characterBearsAttachedEffect(state, char, 'own-mp-not-counted');

    // Character MPs: prisoners contribute negative MPs
    if (isPrisoner) {
      const charMp = charDef.marshallingPoints ?? 0;
      const cat = (charDef.marshallingCategory ?? 'character') as import('../index.js').MarshallingCategory;
      mp = { ...mp, [cat]: mp[cat] - charMp };
      if (atUnderDeeps) underDeepsMp = { ...underDeepsMp, [cat]: underDeepsMp[cat] - charMp };
    } else if (ownMpNotCounted) {
      // Character's own MP contributes nothing; items/allies handled below.
    } else if (pinValue !== undefined) {
      // wh-96: pin overrides the §4 clamp and every exemption (wh-4, Great Patron).
      mp = addPinnedCardMp(mp, charDef, pinValue);
      if (atUnderDeeps) underDeepsMp = addPinnedCardMp(underDeepsMp, charDef, pinValue);
    } else {
      // Fallen-wizard Gandalf (wh-4): a matching character scores full printed
      // MP instead of the §4 clamp (or a Great Patron cap).
      const charFull = fwCharExemptions.length > 0
        && cardExemptFromFwClamp(charDef, fwCharExemptions, bearerInAvatarCompany);
      mp = addMP(mp, charDef, player.alignment, fwCharAllyCaps, charFull);
      if (atUnderDeeps) underDeepsMp = addMP(underDeepsMp, charDef, player.alignment, fwCharAllyCaps, charFull);
    }

    // Item MPs (cross-alignment items are worth half MP, rounded up — MELE Part IV)
    for (const item of char.items) {
      const itemDef = resolveDef(state, item.instanceId);
      if (!itemDef) continue;
      // Await the Onset (wh-96): a company-held item outside a Wizardhaven is
      // pinned, overriding the ncOverride / cross-alignment / §4 / bonus logic.
      if (pinValue !== undefined) {
        mp = addPinnedCardMp(mp, itemDef, pinValue);
        if (atUnderDeeps) underDeepsMp = addPinnedCardMp(underDeepsMp, itemDef, pinValue);
        continue;
      }
      // Give Welcome to the Unexpected (wh-99): a matching unique non-character
      // item scores the override value instead of its printed / §4-clamped MP.
      const ncOverride = nonCharacterMpOverride(itemDef, ncMpOverrides);
      if (ncOverride !== undefined && hasMarshallingPoints(itemDef)) {
        const cat = itemDef.marshallingCategory;
        if (ncOverride !== 0) {
          mp = { ...mp, [cat]: mp[cat] + ncOverride };
          if (atUnderDeeps) underDeepsMp = { ...underDeepsMp, [cat]: underDeepsMp[cat] + ncOverride };
        }
        continue;
      }
      const fwExempt = fwItemExemptions.length > 0 && cardExemptFromFwClamp(itemDef, fwItemExemptions, bearerInAvatarCompany);
      mp = addItemMP(mp, itemDef, player.alignment, fwExempt);
      if (atUnderDeeps) underDeepsMp = addItemMP(underDeepsMp, itemDef, player.alignment, fwExempt);
      // Global item-MP bonus (Rumor of the One le-224): a flat delta to the
      // item's marshalling category, independent of the cross-alignment / §4
      // clamps applied to the item's own printed MP above.
      const globalMpDelta = itemModifierDeltas(itemDef, inPlayItemMods).mp;
      if (globalMpDelta !== 0 && hasMarshallingPoints(itemDef)) {
        const cat = itemDef.marshallingCategory;
        mp = { ...mp, [cat]: mp[cat] + globalMpDelta };
        if (atUnderDeeps) underDeepsMp = { ...underDeepsMp, [cat]: underDeepsMp[cat] + globalMpDelta };
      }
      // Apply bearer-conditional mp-modifier effects on items
      // (e.g. Durin's Axe: +2 MP if held by a Dwarf). Skipped for a Fallen-wizard
      // (MEWH §4): his items are worth a flat 1 MP and cannot be boosted by such
      // hero/minion resource modifiers.
      const itemEffects = player.alignment === 'fallen-wizard'
        ? undefined
        : (itemDef as { effects?: readonly CardEffect[] }).effects;
      if (itemEffects) {
        const bearerCtx = { bearer: { race: charDef.race } };
        for (const effect of itemEffects) {
          if (effect.type !== 'mp-modifier' || typeof effect.value !== 'number' || !effect.when) continue;
          if (!matchesContext(effect.when, bearerCtx)) continue;
          const cat = 'marshallingCategory' in itemDef
            ? (itemDef as { marshallingCategory: MarshallingCategory }).marshallingCategory
            : 'item' as MarshallingCategory;
          mp = { ...mp, [cat]: mp[cat] + effect.value };
          if (atUnderDeeps) underDeepsMp = { ...underDeepsMp, [cat]: underDeepsMp[cat] + effect.value };
        }
      }
    }

    // Ally MPs
    for (const ally of char.allies) {
      const allyDef = resolveDef(state, ally.instanceId);
      if (allyDef) {
        // Await the Onset (wh-96): a company-held ally outside a Wizardhaven is
        // pinned, overriding the ncOverride / §4 / full-MP exemption logic.
        if (pinValue !== undefined) {
          mp = addPinnedCardMp(mp, allyDef, pinValue);
          if (atUnderDeeps) underDeepsMp = addPinnedCardMp(underDeepsMp, allyDef, pinValue);
          continue;
        }
        // Give Welcome to the Unexpected (wh-99): a matching unique ally scores
        // the override value instead of its printed / §4-clamped MP.
        const allyNcOverride = nonCharacterMpOverride(allyDef, ncMpOverrides);
        if (allyNcOverride !== undefined && hasMarshallingPoints(allyDef)) {
          const cat = allyDef.marshallingCategory;
          if (allyNcOverride !== 0) {
            mp = { ...mp, [cat]: mp[cat] + allyNcOverride };
            if (atUnderDeeps) underDeepsMp = { ...underDeepsMp, [cat]: underDeepsMp[cat] + allyNcOverride };
          }
          continue;
        }
        // Join the Hunt (wh-93): a matching ally in the avatar company scores
        // full printed MP instead of the §4 clamp (or a Great Patron cap).
        const allyFull = fwAllyExemptions.length > 0
          && cardExemptFromFwClamp(allyDef, fwAllyExemptions, bearerInAvatarCompany);
        mp = addMP(mp, allyDef, player.alignment, fwCharAllyCaps, allyFull);
        if (atUnderDeeps) underDeepsMp = addMP(underDeepsMp, allyDef, player.alignment, fwCharAllyCaps, allyFull);
      }
    }
  }

  // General-influence bonus: sum stat-modifier general-influence effects. These
  // ride two kinds of source: an item / attached permanent-event on a character
  // (Bade to Rule le-167 on the Ringwraith, Great Shadow ba-62 on the Balrog),
  // and a bare stage permanent-event sitting in `cardsInPlay` (Truths of Doom
  // wh-108, which is not placed on any character). An optional `controlLimit`
  // caps how many of the added points may control characters; the excess is
  // accumulated as `generalInfluenceControlPenalty` (still part of the pool for
  // defensive unused-GI purposes, but never usable to control characters).
  // `op: "set"` is the exception: it does not add to the pool, it *replaces*
  // the avatar's printed general influence (Radagast's Shapeshifter forms
  // adopt a whole attribute line, e.g. Shifter of Hues wh-115's GI 27 in place
  // of Radagast's printed 22). Recorded separately so `effectiveGeneralInfluence`
  // can substitute it for the printed number and still add ordinary bonuses on
  // top. Last override collected wins.
  const applyGeneralInfluenceEffect = (effect: CardEffect): void => {
    if (effect.type !== 'stat-modifier') return;
    const e = effect as { stat?: string; value?: number; controlLimit?: number; op?: string };
    if (e.stat !== 'general-influence') return;
    const val = typeof e.value === 'number' ? e.value : 0;
    if (e.op === 'set') {
      generalInfluenceOverride = val;
      return;
    }
    generalInfluenceBonus += val;
    if (typeof e.controlLimit === 'number') {
      generalInfluenceControlPenalty += Math.max(0, val - e.controlLimit);
    }
  };
  for (const char of Object.values(player.characters)) {
    for (const item of char.items) {
      const itemDef = resolveDef(state, item.instanceId);
      const effects = itemDef && 'effects' in itemDef
        ? (itemDef as { effects?: readonly CardEffect[] }).effects ?? []
        : [];
      for (const effect of effects) applyGeneralInfluenceEffect(effect);
    }
  }
  for (const card of player.cardsInPlay) {
    if (card.setAsideHost !== undefined) continue;
    const def = resolveDef(state, card.instanceId);
    const effects = def && 'effects' in def
      ? (def as { effects?: readonly CardEffect[] }).effects ?? []
      : [];
    for (const effect of effects) applyGeneralInfluenceEffect(effect);
  }

  // Cards in play: factions, permanent events, etc. Set-aside cards (MEAS §1)
  // are skipped here — they are physically kept in their host player's
  // cardsInPlay, but their marshalling points are credited to their owner in
  // the dedicated pass below.
  // A Fallen-wizard stage card (e.g. Gatherer of Loyalties wh-70) can re-value
  // the player's factions, replacing both their printed MP and the §4 flat-1
  // clamp. Collect the active override rules once and the player's revealed
  // avatar name (Alatar/Pallando/Saruman) so avatar-specific rules can match.
  const factionOverrides = factionMpOverrideRules(state, player);
  const avatarChar = factionOverrides.length > 0 ? findPlayerAvatar(state, player) : undefined;
  const avatarName = avatarChar ? (resolveDef(state, avatarChar.instanceId) as { name?: string } | undefined)?.name : undefined;
  // Man of Skill (wh-119) and similar: in-play `permanent-event-mp` effects
  // override the MP of the player's permanent-events that require a given
  // resource site. Computed once per player; empty when no such effect is in play.
  const peMpOverrides = permanentEventMpOverrides(state, player);
  for (const card of player.cardsInPlay) {
    if (card.setAsideHost !== undefined) continue;
    const def = resolveDef(state, card.instanceId);
    if (!def) continue;
    // Await the Onset (wh-96) clause A: a faction stamped `mpPinned` (played after
    // the card came into play) scores exactly that value, overriding every faction
    // MP rule below ("regardless of other cards in play").
    if (card.mpPinned !== undefined) {
      mp = addPinnedCardMp(mp, def, card.mpPinned);
      continue;
    }
    // Give Welcome to the Unexpected (wh-99): a matching unique non-character
    // card in play (faction / misc permanent-event) scores the override value,
    // taking precedence over its printed / §4-clamped MP.
    const ncOverride = nonCharacterMpOverride(def, ncMpOverrides);
    if (ncOverride !== undefined) {
      const cat = hasMarshallingPoints(def) ? def.marshallingCategory : ('misc' as MarshallingCategory);
      if (ncOverride !== 0) mp = { ...mp, [cat]: mp[cat] + ncOverride };
      continue;
    }
    if (factionOverrides.length > 0 && isFactionCard(def)) {
      const overrideMp = resolveFactionMpOverride(def, factionOverrides, avatarName);
      if (overrideMp !== undefined) {
        mp = { ...mp, faction: mp.faction + overrideMp };
        continue;
      }
    }
    const override = permanentEventMpOverride(def, peMpOverrides);
    if (override !== undefined) {
      const cat = hasMarshallingPoints(def) ? def.marshallingCategory : ('misc' as MarshallingCategory);
      if (override !== 0) mp = { ...mp, [cat]: mp[cat] + override };
    } else {
      mp = addMP(mp, def, player.alignment);
    }
    // `conditional-mp` adds a bonus to the carrying card's own printed MP when
    // its gate holds. Roots of the Earth (ba-74): a named card is in play on the
    // same site. Great Army of the North (ba-38): the player has ≥N qualifying
    // factions in play ("at least 4 unique Orc and/or Troll factions —none
    // playable at a Darkhold").
    for (const eff of getCardEffects(def)) {
      if (eff.type !== 'conditional-mp') continue;
      const satisfied = eff.requiresFactionCount
        ? conditionalMpFactionCount(state, player, eff.requiresFactionCount) >= eff.requiresFactionCount.min
        : eff.requiresCardOnSameSite !== undefined
          && conditionalMpApplies(state, card, eff.requiresCardOnSameSite);
      if (!satisfied) continue;
      const cat = hasMarshallingPoints(def) ? def.marshallingCategory : ('misc' as MarshallingCategory);
      mp = { ...mp, [cat]: mp[cat] + eff.bonus };
    }
  }

  // MEAS §1: cards placed "off to the side" award their marshalling points to
  // their owner (derivable from the instance id), independent of which player's
  // cardsInPlay they are kept in.
  for (const other of state.players) {
    for (const card of other.cardsInPlay) {
      if (card.setAsideHost === undefined) continue;
      if (ownerOf(card.instanceId) !== player.id) continue;
      const def = resolveDef(state, card.instanceId);
      if (def) mp = addMP(mp, def, player.alignment);
    }
  }

  // Leader-controlled faction group bonus (LE "Orcs of Udûn"-style factions):
  // "Three or more factions controlled by the same leader give 2 extra
  // marshalling points." Count `controlledBy` factions per leader and award the
  // bonus once per leader that meets the threshold. The threshold and bonus are
  // read from the faction's `leader-control` effect (identical across the set).
  const factionsByLeader = new Map<string, { count: number; def: CardDefinition }>();
  for (const card of player.cardsInPlay) {
    if (card.controlledBy === undefined) continue;
    const def = resolveDef(state, card.instanceId);
    if (!def || !getLeaderControlEffect(def)) continue;
    const key = card.controlledBy as string;
    const existing = factionsByLeader.get(key);
    factionsByLeader.set(key, { count: (existing?.count ?? 0) + 1, def });
  }
  for (const { count, def } of factionsByLeader.values()) {
    const effect = getLeaderControlEffect(def);
    if (effect && count >= effect.groupBonus.count) {
      mp = { ...mp, faction: mp.faction + effect.groupBonus.mp };
    }
  }

  // Alliance of Free Peoples (as-45): while a `faction-mp-bonus` gate holds, each
  // of the controller's in-play factions whose race the bonus lists gains extra
  // faction MP. A separate pass (not folded into the per-card MP loop above) so
  // the bonus still lands on factions whose base MP was handled by an override
  // branch that `continue`d. Skips set-aside factions to match the gate.
  const factionBonuses = factionMpBonusEntries(state, player);
  if (factionBonuses.length > 0) {
    for (const card of player.cardsInPlay) {
      if (card.setAsideHost !== undefined) continue;
      const def = resolveDef(state, card.instanceId);
      if (!def || !isFactionCard(def)) continue;
      for (const b of factionBonuses) {
        if (b.races.has(def.race)) mp = { ...mp, faction: mp.faction + b.bonus };
      }
    }
  }

  // Kill/MP pile: defeated creatures and items stored at Havens (CoE rule
  // 2.II.4.1 places stored items in the marshalling point pile). Defeated
  // creatures earn kill MP — except, per METD §4.1, a player who defeats a
  // manifestation they themselves played awards no MPs. Owner is derivable in
  // O(1) from the instance ID prefix.
  const fullKillMp = playerHasKillMpExemption(state, player);
  for (const card of player.killPile) {
    const def = resolveDef(state, card.instanceId);
    if (!def) continue;
    const effects = (def as { effects?: readonly CardEffect[] }).effects;

    // mp-in-pile: a card that places itself into a marshalling-point pile and
    // scores a flat value from there (e.g. Neither so Ancient Nor so Potent
    // dm-73 — "It gives 2 item marshalling points"). Independent of the
    // stored-item / defeated-creature machinery below.
    const mpInPile = effects?.find(e => e.type === 'mp-in-pile') as
      | { type: 'mp-in-pile'; category: MarshallingCategory; value: number }
      | undefined;
    if (mpInPile) {
      mp = { ...mp, [mpInPile.category]: mp[mpInPile.category] + mpInPile.value };
      continue;
    }

    // Stored items: storable-at effect grants MP (overriding base MP when set).
    const storableEffect = effects?.find(e => e.type === 'storable-at') as
      | { type: 'storable-at'; marshallingPoints?: number }
      | undefined;
    if (storableEffect) {
      if (storableEffect.marshallingPoints !== undefined) {
        // Stored items with an explicit storable-at MP override still apply the
        // cross-alignment half-MP rule (MELE Part IV): the override MP counts
        // at the declared value, not at the card's base MP, but is halved when
        // the player's alignment does not match the item's alignment. For a
        // Fallen-wizard the item is instead worth a flat 1 MP (MEWH §4).
        let finalMp: number;
        if (player.alignment === 'fallen-wizard') {
          finalMp = storableEffect.marshallingPoints > 0 ? 1 : storableEffect.marshallingPoints;
        } else {
          const factor = crossAlignmentItemMpFactor(player.alignment, def.cardType);
          finalMp = factor < 1 ? Math.ceil(storableEffect.marshallingPoints * factor) : storableEffect.marshallingPoints;
        }
        const cat = ('marshallingCategory' in def)
          ? (def as { marshallingCategory: MarshallingCategory }).marshallingCategory
          : 'item' as MarshallingCategory;
        mp = { ...mp, [cat]: mp[cat] + finalMp };
      } else {
        mp = addItemMP(mp, def, player.alignment);
      }
      continue;
    }

    // Defeated creatures earn kill MP.
    if (!('killMarshallingPoints' in def)) continue;
    const killMP = (def as { killMarshallingPoints: number }).killMarshallingPoints;
    if (killMP === 0) continue;
    const mid = manifestIdOf(def);
    if (mid && ownerOf(card.instanceId) === player.id) continue;
    // MEWH §4: a defeated creature is worth a flat 1 MP to a Fallen-wizard —
    // unless the player has a `fw-kill-mp-full` carrier in play (Alatar wh-1),
    // which exempts him and awards the full printed kill MP instead.
    const killContribution =
      player.alignment === 'fallen-wizard' && killMP > 0 && !fullKillMp ? 1 : killMP;
    mp = { ...mp, kill: mp.kill + killContribution };
  }

  // Out-of-play pile: holds eliminated characters and sites stored via
  // stolen-knowledge.
  // - Sites with `stolen-knowledge` earn misc MPs as declared in the effect.
  // - Eliminated cards may carry `mp-modifier` effects with reason "elimination".
  for (const card of player.outOfPlayPile) {
    const def = resolveDef(state, card.instanceId);
    if (!def) continue;
    const effects = (def as { effects?: readonly CardEffect[] }).effects;

    // Sites stored via stolen-knowledge earn misc MPs.
    const stolenKnowledgeEffect = effects?.find(e => e.type === 'site-rule' && e.rule === 'stolen-knowledge') as
      | { type: 'site-rule'; rule: 'stolen-knowledge'; marshallingPoints: number }
      | undefined;
    if (stolenKnowledgeEffect) {
      mp = { ...mp, misc: mp.misc + stolenKnowledgeEffect.marshallingPoints };
      continue;
    }

    // Eliminated cards: mp-modifier effects with reason "elimination".
    if (effects) {
      for (const effect of effects) {
        if (effect.type === 'mp-modifier' && typeof effect.value === 'number'
          && effect.when && 'reason' in effect.when && effect.when.reason === 'elimination') {
          const cat = 'marshallingCategory' in def
            ? (def as { marshallingCategory: MarshallingCategory }).marshallingCategory
            : 'character' as MarshallingCategory;
          mp = { ...mp, [cat]: mp[cat] + effect.value };
        }
      }
    }
  }

  // MEBA: one-time bonus misc MP (Challenge the Power 9–10 band) is held on the
  // player rather than on a card in play, so fold it into the misc tally here.
  if (player.bonusMiscMarshallingPoints) {
    mp = { ...mp, misc: mp.misc + player.bonusMiscMarshallingPoints };
  }

  // One-time kill MP not tied to a defeated creature in the kill pile (A Malady
  // Without Healing le-159: "you receive his kill marshalling points" for a hero
  // eliminated by the card's checks). Held on the player and folded into kill.
  if (player.bonusKillMarshallingPoints) {
    mp = { ...mp, kill: mp.kill + player.bonusKillMarshallingPoints };
  }

  // CoE rule 2.2: an eliminated avatar provides -5 miscellaneous marshalling
  // points to its player. This penalty is in effect throughout the game (CoE
  // 10.3.vi — "despite having already been in effect for the purposes of
  // determining whether the game could be called"), so it is folded into the
  // running misc tally here rather than being applied only at final scoring.
  // Keeping it in the derived total means it is reflected in the live MP display
  // and read consistently by the end-game scorer. It is safe against the
  // tournament doubling step (CoE 10.3.iii), which ignores misc and never
  // doubles a negative source.
  if (hasEliminatedAvatar(state, getPlayerIndex(state, player.id))) {
    mp = { ...mp, misc: mp.misc - 5 };
  }

  // MEAS §6e: callable totals = full tally minus Under-deeps company-held MPs.
  // Rule 10.42 exempts Balrog players — they may count Under-deeps MPs both
  // for calling the end of the game and thereafter, so `mp` is used unmodified.
  // Reuse the `mp` reference when nothing is excluded (the common case) so the
  // no-allocation fast path below still holds.
  const callable: MarshallingPointTotals = underDeepsMp === ZERO_MARSHALLING_POINTS || player.alignment === 'balrog'
    ? mp
    : {
        character: mp.character - underDeepsMp.character,
        item: mp.item - underDeepsMp.item,
        faction: mp.faction - underDeepsMp.faction,
        ally: mp.ally - underDeepsMp.ally,
        kill: mp.kill - underDeepsMp.kill,
        misc: mp.misc - underDeepsMp.misc,
      };

  // MEWH §1: derive Fallen-wizard stage points by summing the `stage-points`
  // effect across this player's in-play stage permanent-events. Kept here so the
  // running total is a single source of truth alongside the MP tally rather than
  // a mutable counter. Only Fallen-wizard players accrue stage points (stage
  // resources are a Fallen-wizard-only card type), so this stays 0 for everyone
  // else regardless of what is in play.
  let stagePoints = 0;
  if (player.alignment === 'fallen-wizard') {
    for (const def of playerCardsInPlayDefs(state, player)) {
      stagePoints += stagePointsOfCard(def);
    }
    // A stage permanent-event played "on a character" (Wizard's Myrmidon wh-84,
    // The Forge-master wh-117) is attached to the bearer's `items`, not to
    // `cardsInPlay`, so its stage points must be summed from there too.
    // `stagePointsOfCard` returns 0 for ordinary items, so iterating all items
    // is safe.
    for (const char of Object.values(player.characters)) {
      for (const item of char.items) {
        stagePoints += stagePointsOfCard(resolveDef(state, item.instanceId));
      }
    }
    // MEWH §1 / CoE 1.7.F1: during the character draft the Stage resources a
    // Fallen-wizard has drafted are not yet in play (they only enter
    // `cardsInPlay` at draft finalize, see `applyDraftResults`), but they
    // already contribute to the running stage-point total the player is
    // building toward the required three. Sum them from the draft state so the
    // total is shown correctly mid-draft; they are not double-counted afterwards
    // because the `character-draft` step (and its `draftState`) is gone by then.
    if (
      state.phaseState.phase === Phase.Setup
      && state.phaseState.setupStep.step === SetupStep.CharacterDraft
    ) {
      const draft = state.phaseState.setupStep.draftState[getPlayerIndex(state, player.id)];
      for (const card of draft.draftedStageResources) {
        stagePoints += stagePointsOfCard(defById(state, card.definitionId));
      }
    }
    // A Fallen-wizard site that grants stage points *while occupied* (Deep Mines
    // wh-55: "You receive the three stage points if any of your companies are at
    // the site") contributes from each distinct occupied site instance. Dedup by
    // instance so two companies at the same site do not double the points; two
    // different occupied Deep Mines each count once.
    const countedSiteInstances = new Set<string>();
    for (const company of player.companies) {
      const site = company.currentSite;
      if (!site || countedSiteInstances.has(site.instanceId as string)) continue;
      countedSiteInstances.add(site.instanceId as string);
      stagePoints += siteOccupancyStagePointsOfCard(defById(state, site.definitionId));
    }
  }

  // Skip update if nothing changed
  if (
    !charactersChanged &&
    player.generalInfluenceUsed === generalInfluenceUsed &&
    player.generalInfluenceBonus === generalInfluenceBonus &&
    player.generalInfluenceControlPenalty === generalInfluenceControlPenalty &&
    player.generalInfluenceOverride === generalInfluenceOverride &&
    player.marshallingPoints === mp &&
    player.callableMarshallingPoints === callable &&
    player.stagePoints === stagePoints
  ) {
    return player;
  }

  return {
    ...player,
    characters: charactersChanged ? newCharacters : player.characters,
    generalInfluenceUsed,
    generalInfluenceBonus,
    generalInfluenceControlPenalty,
    generalInfluenceOverride,
    marshallingPoints: mp,
    callableMarshallingPoints: callable,
    stagePoints,
  };
}

/**
 * Recomputes all derived values for both players in the game state.
 *
 * Should be called after every successful reducer step. Returns the
 * original state object unchanged if no derived values differ (avoids
 * unnecessary object allocation).
 */
export function recomputeDerived(state: GameState): GameState {
  const inPlayNames = buildInPlayNames(state);
  const p0 = recomputePlayer(state, state.players[0], inPlayNames);
  const p1 = recomputePlayer(state, state.players[1], inPlayNames);

  // Avoid new object if nothing changed
  if (p0 === state.players[0] && p1 === state.players[1]) {
    return state;
  }

  return {
    ...state,
    players: [p0, p1],
  };
}

/**
 * Recomputes a character's effective prowess in combat context.
 *
 * During normal stat computation (`reason: 'effective-stats'`), combat-conditional
 * effects like Glamdring's "max 9 against Orcs" are not evaluated because there is
 * no enemy context. This function re-resolves prowess with `reason: 'combat'` and
 * the attacking creature's race, so conditional weapon bonuses apply correctly.
 *
 * @param state - The current game state (with combat active).
 * @param char - The character in play whose prowess to compute.
 * @param charDef - The character's card definition.
 * @param creatureRace - The lowercase race of the attacking creature (e.g. "orc").
 * @param strikeMode - How the character is facing the strike (`'tap'`, `'untap'`,
 *   `'dodge'`, `'reroll'`). Exposed to conditions as `combat.strikeMode` so a
 *   modifier can gate on "when tapping to face a strike", e.g. Stabbing Tongue
 *   of Fire (ba-81) / Whip of Many Thongs (ba-82): `+1 prowess`
 *   `when: { "combat.strikeMode": "tap" }`. When omitted, `combat.strikeMode` is
 *   absent and such a modifier does not apply (so it never leaks into
 *   non-facing prowess like effective-stats).
 * @returns The character's prowess value including combat-conditional effects.
 */
export function computeCombatProwess(
  state: GameState,
  char: CharacterInPlay,
  charDef: CharacterCard,
  creatureRace: string,
  strikeMode?: 'tap' | 'untap' | 'dodge' | 'reroll',
): number {
  const inPlayNames = buildInPlayNames(state);
  const charInfo = buildBearerContext(charDef);
  const context: ResolverContext = {
    reason: 'combat',
    bearer: charInfo,
    target: charInfo,
    inPlay: inPlayNames,
    enemy: { race: creatureRace, name: '', prowess: 0, body: null },
    combat: { strikeMode },
  };

  const charEffects = collectCharacterEffects(state, char, context);
  const globalEffects = collectGlobalEffects(state, 'all-characters', context);
  // `own-characters`-scoped effects (e.g. Descent through Fire ba-56: "+1
  // prowess to all your characters") apply only to characters controlled by
  // the source card's owner. Find the player whose `characters` dict holds this
  // character so the bonus is scoped to that player's own company members.
  const ownerPlayer = state.players.find(
    p => Object.prototype.hasOwnProperty.call(p.characters, char.instanceId as string),
  );
  const ownEffects = ownerPlayer
    ? collectGlobalEffects(state, 'own-characters', context, undefined, ownerPlayer.id)
    : [];
  const collected = [...charEffects, ...globalEffects, ...ownEffects];

  if (collected.length > 0) {
    return resolveStatModifiers(collected, 'prowess', charDef.prowess, context);
  }
  return charDef.prowess;
}
