/**
 * @module ai/evaluators/common
 *
 * Shared scoring utilities for heuristic phase evaluators.
 *
 * Encapsulates lookups against the player view (find a card in hand, find
 * a character in play, dice success probability, etc.) so that individual
 * evaluators stay focused on their phase logic. All lookups are tolerant
 * of missing data — the AI never throws on partial information.
 */

import type { PlayerView, CardDefinition, CharacterCard, HeroItemCard, MinionItemCard, CreatureCard, HazardEventCard, HeroSiteCard, MinionSiteCard, FallenWizardSiteCard, BalrogSiteCard, CardInstanceId, RegionType, CharacterInPlay, Company, ItemPlaySiteEffect, PlayTargetEffect, StrikeModifierEffect, GameAction, Condition } from '@meccg/shared';
import { CardStatus, isCharacterCard, isItemCard, isFactionCard, isAllyCard, matchesCondition, hasPlayFlag } from '@meccg/shared';

/** Union of all site card types — handy for movement scoring. */
export type AnySiteCard = HeroSiteCard | MinionSiteCard | FallenWizardSiteCard | BalrogSiteCard;

/** Look up a card definition from the pool, returning undefined if missing. */
export function lookupDef(
  pool: Readonly<Record<string, CardDefinition>>,
  defId: string | undefined,
): CardDefinition | undefined {
  if (!defId) return undefined;
  return pool[defId];
}

/** Look up the definition of a card instance held in any visible zone. */
export function defOfInstance(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  instanceId: CardInstanceId,
): CardDefinition | undefined {
  const fromHand = view.self.hand.find(c => c.instanceId === instanceId);
  if (fromHand) return lookupDef(pool, fromHand.definitionId);
  const char = view.self.characters[instanceId];
  if (char) return lookupDef(pool, char.definitionId);
  const oppChar = view.opponent.characters[instanceId];
  if (oppChar) return lookupDef(pool, oppChar.definitionId);
  // Search items / allies / hazards on every character
  for (const c of Object.values(view.self.characters)) {
    for (const it of c.items) if (it.instanceId === instanceId) return lookupDef(pool, it.definitionId);
    for (const al of c.allies) if (al.instanceId === instanceId) return lookupDef(pool, al.definitionId);
    for (const hz of c.hazards) if (hz.instanceId === instanceId) return lookupDef(pool, hz.definitionId);
  }
  for (const c of Object.values(view.opponent.characters)) {
    for (const it of c.items) if (it.instanceId === instanceId) return lookupDef(pool, it.definitionId);
    for (const al of c.allies) if (al.instanceId === instanceId) return lookupDef(pool, al.definitionId);
    for (const hz of c.hazards) if (hz.instanceId === instanceId) return lookupDef(pool, hz.definitionId);
  }
  for (const card of view.self.cardsInPlay) if (card.instanceId === instanceId) return lookupDef(pool, card.definitionId);
  for (const card of view.opponent.cardsInPlay) if (card.instanceId === instanceId) return lookupDef(pool, card.definitionId);
  return undefined;
}

/**
 * Whether discarding the given in-play card instance (e.g. via Marvels
 * Told's forced-discard-a-hazard-event effect) benefits the viewing player
 * rather than their opponent.
 *
 * A hazard-event card attached to the opponent's character, or sitting in
 * the opponent's `cardsInPlay`, is presumed to be hindering the opponent's
 * side — discarding it undoes that hindrance and helps *them*, not us.
 * Conversely, a hazard-event on one of our own characters or in our own
 * `cardsInPlay` is presumed to be hindering us — discarding it helps us.
 * Falls back to `true` (beneficial) when the instance can't be located, so
 * unmodeled zones don't get suppressed to zero.
 */
export function discardBenefitsSelf(view: PlayerView, instanceId: CardInstanceId): boolean {
  for (const c of Object.values(view.self.characters)) {
    if (c.hazards.some(h => h.instanceId === instanceId)) return true;
  }
  for (const c of Object.values(view.opponent.characters)) {
    if (c.hazards.some(h => h.instanceId === instanceId)) return false;
  }
  if (view.self.cardsInPlay.some(c => c.instanceId === instanceId)) return false;
  if (view.opponent.cardsInPlay.some(c => c.instanceId === instanceId)) return true;
  return true;
}

/** Find a character in either player's in-play roster by instance ID. */
export function findCharacterInPlay(
  view: PlayerView,
  instanceId: CardInstanceId,
): { character: CharacterInPlay; isSelf: boolean } | null {
  const own = view.self.characters[instanceId];
  if (own) return { character: own, isSelf: true };
  const opp = view.opponent.characters[instanceId];
  if (opp) return { character: opp, isSelf: false };
  return null;
}

/** Find which company contains the given character (self side only). */
export function findCompanyOf(
  view: PlayerView,
  characterId: CardInstanceId,
): Company | null {
  for (const company of view.self.companies) {
    if (company.characters.includes(characterId)) return company;
  }
  return null;
}

/** Sum effective prowess of all characters in a company (self side only). */
export function companyProwess(view: PlayerView, company: Company): number {
  let sum = 0;
  for (const charId of company.characters) {
    const char = view.self.characters[charId];
    if (char) sum += char.effectiveStats.prowess;
  }
  return sum;
}

/** Marshalling-point value of a card definition (0 if unknown / non-scoring). */
export function mpValue(def: CardDefinition | undefined): number {
  if (!def) return 0;
  if ('marshallingPoints' in def && typeof def.marshallingPoints === 'number') {
    return def.marshallingPoints;
  }
  return 0;
}

/**
 * Probability of rolling at least `need` on 2d6 (×100, integer).
 * Used to score plays whose outcome depends on a dice roll.
 */
export function diceSuccessPct(need: number): number {
  if (need <= 2) return 100;
  if (need >= 13) return 0;
  // 2d6 success table for "roll >= need"
  const table: Record<number, number> = {
    2: 100, 3: 97, 4: 92, 5: 83, 6: 72,
    7: 58, 8: 42, 9: 28, 10: 17, 11: 8, 12: 3,
  };
  return table[need] ?? 0;
}

/** Whether the card definition is a character card. */
export function isCharacter(def: CardDefinition | undefined): def is CharacterCard {
  return isCharacterCard(def);
}

/** Whether the card definition is any kind of item. */
export function isItem(def: CardDefinition | undefined): def is HeroItemCard | MinionItemCard {
  return isItemCard(def);
}

/** Whether the card definition is a faction. */
export function isFaction(def: CardDefinition | undefined): boolean {
  return isFactionCard(def);
}

/** Whether the card definition is an ally. */
export function isAlly(def: CardDefinition | undefined): boolean {
  return isAllyCard(def);
}

/** Whether the card definition is a creature hazard. */
export function isCreature(def: CardDefinition | undefined): def is CreatureCard {
  return def !== undefined && def.cardType === 'hazard-creature';
}

/** Whether the card definition is a corruption hazard. */
export function isCorruption(def: CardDefinition | undefined): boolean {
  return def !== undefined && def.cardType === 'hazard-corruption';
}

/** Whether the card definition is a hazard event. */
export function isHazardEvent(def: CardDefinition | undefined): def is HazardEventCard {
  return def !== undefined && def.cardType === 'hazard-event';
}

/**
 * Whether a hazard-event card carries a board-wide `stat-modifier` boost
 * (`target: 'all-attacks'`, stat `prowess` or `strikes`) that would apply to
 * the given creature's attack — i.e. its `when` condition (if any) matches
 * `{ enemy: { race: creature.race } }`, the same context the engine resolves
 * such effects against in `resolveAttackProwess`/`resolveAttackStrikes`
 * (`packages/shared/src/engine/effects/resolver.ts`). Effects with no
 * `target` (self-only) or a different target scope don't count.
 *
 * Used to sequence hazard play: a boost like Full of Froth and Rage (as-30,
 * "+2 prowess to Spider/Animal attacks") is worthless once played after the
 * creature attack it would have strengthened has already resolved, so the AI
 * should prefer playing it *before* a matching creature still in hand.
 */
export function boostsCreatureAttack(
  eventDef: CardDefinition,
  creature: CreatureCard,
): boolean {
  const effects = (eventDef as { effects?: readonly Record<string, unknown>[] }).effects;
  if (!effects) return false;
  for (const effect of effects) {
    if (effect.type !== 'stat-modifier') continue;
    if (effect.target !== 'all-attacks') continue;
    if (effect.stat !== 'prowess' && effect.stat !== 'strikes') continue;
    const when = effect.when as Condition | undefined;
    if (!when || matchesCondition(when, { enemy: { race: creature.race } })) return true;
  }
  return false;
}

/**
 * Whether playing `eventDef` would satisfy an `{ inPlay: eventDef.name }`
 * condition gating a bonus effect on some *other* hazard-event card still in
 * hand — e.g. An Unexpected Outpost (dm-45) has a second `move` effect gated
 * on `{ inPlay: "Doors of Night" }` that doubles its fetch. Doors of Night
 * (tw-28) is a permanent event: once played it stays in play for the rest of
 * the game (see `buildInPlayNames` in
 * `packages/shared/src/engine/recompute-derived.ts`), so playing it *before*
 * the dependent card unlocks the bonus, while playing it after wastes it.
 * Sequencing here mirrors {@link boostsCreatureAttack}: the enabler should
 * outscore the plain hazard-event baseline so it gets played first.
 */
export function enablesHandCardBonus(
  eventDef: CardDefinition,
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
): boolean {
  for (const card of view.self.hand) {
    const def = lookupDef(pool, card.definitionId);
    if (!def || def.id === eventDef.id) continue;
    const effects = (def as { effects?: readonly Record<string, unknown>[] }).effects;
    if (!effects) continue;
    for (const effect of effects) {
      const when = effect.when as Record<string, unknown> | undefined;
      if (when?.inPlay === eventDef.name) return true;
    }
  }
  return false;
}

/** Mind cost (general influence) of a character, defaulting to 0 for avatars. */
export function mindCost(def: CardDefinition | undefined): number {
  if (!def || !isCharacter(def)) return 0;
  return def.mind ?? 0;
}

/** Whether a card definition is a site (any alignment). */
export function isSite(def: CardDefinition | undefined): def is AnySiteCard {
  if (!def) return false;
  return (
    def.cardType === 'hero-site' ||
    def.cardType === 'minion-site' ||
    def.cardType === 'fallen-wizard-site' ||
    def.cardType === 'balrog-site'
  );
}

/** Region-type danger weight (higher = more dangerous, better avoided). */
const REGION_DANGER: Record<string, number> = {
  'free-domain': 0,
  border: 1,
  wilderness: 2,
  'shadow-land': 4,
  'dark-domain': 5,
};

/** Site-type danger weight (higher = more dangerous). */
const SITE_DANGER: Record<string, number> = {
  haven: 0,
  'free-hold': 0,
  'border-hold': 1,
  'ruins-and-lairs': 3,
  'shadow-hold': 5,
  'dark-hold': 7,
};

/** Whether a hand resource card can be played at the given site. */
export function resourcePlayableAt(def: CardDefinition, site: AnySiteCard): boolean {
  // Items: playability mirrors the engine (legal-actions/site.ts).
  if (def.cardType === 'hero-resource-item' || def.cardType === 'minion-resource-item') {
    // An item that carries its own `item-play-site` effect defines exactly
    // where it may be played (gold rings, Shadow/Dark-hold-restricted items,
    // etc.). Honour that first — it mirrors the engine's `item-play-site` gate.
    const itemPlaySite = (def.effects ?? []).find(
      (e): e is ItemPlaySiteEffect => e.type === 'item-play-site',
    );
    if (itemPlaySite) {
      if (itemPlaySite.sites?.includes(site.name)) return true;
      if (itemPlaySite.filter) {
        return matchesCondition(
          itemPlaySite.filter,
          { site: site as unknown as Record<string, unknown> },
        );
      }
      return false;
    }
    // Standard items: the engine gates play solely on whether the site's
    // printed `playableResources` list includes the item's class (subtype).
    // The item's own `playableAt` site-type list is NOT consulted for items,
    // so relying on it here made the AI enter sites for items the engine then
    // refused to let it play — e.g. a "greater" item (Scroll of Isildur) at a
    // site that only lists "minor"/"major" (Isle of the Ulond) — and take the
    // site's automatic-attack for no payoff.
    return (site.playableResources as readonly string[]).includes(def.subtype);
  }
  // Factions / allies: matched by named site or site type.
  if (
    def.cardType === 'hero-resource-faction' ||
    def.cardType === 'minion-resource-faction' ||
    def.cardType === 'hero-resource-ally' ||
    def.cardType === 'minion-resource-ally'
  ) {
    for (const entry of def.playableAt) {
      if ('site' in entry && entry.site === site.name) return true;
      if ('siteType' in entry && entry.siteType === site.siteType) return true;
    }
    return false;
  }
  // Resource events with play-target: site — card must be played at the company's current site,
  // so movement to a matching site unlocks the card.
  if (def.cardType === 'hero-resource-event' || def.cardType === 'minion-resource-event') {
    const siteTarget = (def.effects ?? []).find(
      (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'site',
    );
    if (siteTarget?.filter) {
      return matchesCondition(
        siteTarget.filter,
        site as unknown as Record<string, unknown>,
      );
    }
  }
  // Other events / characters: not site-specific in this scoring pass.
  return false;
}

/**
 * Whether any hand resource card can be played at the given site definition.
 * Used for the intermediate-movement check in {@link scoreDestinationSite}.
 */
export function anyCardPlayableAt(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  site: AnySiteCard,
): boolean {
  for (const card of view.self.hand) {
    const def = lookupDef(pool, card.definitionId);
    if (def && resourcePlayableAt(def, site)) return true;
  }
  return false;
}

/**
 * Whether any hand resource card can be played at ANY site still in the
 * player's site deck. Used to detect when the AI has scoring potential but
 * no directly-reachable playable destination — in that case, moving to a
 * haven as an intermediate step is better than standing still.
 */
function handHasPlayableSiteInDeck(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
): boolean {
  for (const siteEntry of view.self.siteDeck) {
    const def = lookupDef(pool, siteEntry.definitionId);
    if (!isSite(def)) continue;
    if (anyCardPlayableAt(view, pool, def)) return true;
  }
  return false;
}

/**
 * Score a destination site for movement-planning.
 *
 * Combines:
 * - The marshalling-point value of hand resources playable at the destination
 *   (MP × 10, minimum 1 per card — the dominant term, since the whole point
 *   of moving is to score MPs). Using actual MP values ensures high-value cards
 *   like factions (3 MP → 30 pts) and major items (2 MP → 20 pts) strongly
 *   outweigh the pass score, while 0-MP minor items still contribute a small
 *   amount (10 pts) to motivate movement toward sites where they can be played.
 * - Resource-draw count printed on the site (×2).
 * - Penalties for the danger of the site type and traversed regions.
 *
 * Intermediate-movement bonus: when the destination itself has nothing to play
 * but the player has hand cards playable somewhere in their site deck, moving
 * to a haven (a safe staging point for future turns) earns a small score
 * rather than zero — this nudges the AI toward productive movement instead
 * of staying idle every turn.
 *
 * Returns a non-negative integer; 0 means "do not move here".
 */
export function scoreDestinationSite(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  destSite: AnySiteCard,
): number {
  let playableScore = 0;
  for (const card of view.self.hand) {
    const def = lookupDef(pool, card.definitionId);
    if (def && resourcePlayableAt(def, destSite)) {
      // Weight by MP value so high-value cards strongly motivate movement.
      // Coefficient 20 ensures even a single 2-MP item (score 40) clearly
      // dominates the org-phase pass score (5), reducing the chance the AI
      // ignores a site where it has items to play.
      playableScore += Math.max(10, mpValue(def) * 20);
    }
  }

  const resourceDraws = 'resourceDraws' in destSite ? destSite.resourceDraws : 0;
  const siteDanger = SITE_DANGER[destSite.siteType] ?? 2;
  let regionDanger = 0;
  if ('sitePath' in destSite && Array.isArray(destSite.sitePath)) {
    for (const region of destSite.sitePath as readonly RegionType[]) {
      regionDanger += REGION_DANGER[region] ?? 1;
    }
  }

  if (playableScore === 0) {
    // No cards to play here directly. If the AI has cards playable somewhere
    // in the deck, score a haven move as an intermediate step toward those
    // sites. Havens are safe hubs that reset travel options for the next turn.
    if (destSite.siteType === 'haven' && handHasPlayableSiteInDeck(view, pool)) {
      return 15;
    }
    return 0;
  }

  return Math.max(0, playableScore + resourceDraws * 2 - siteDanger - regionDanger);
}

/**
 * Free direct influence of a character: total DI minus the sum of mind costs
 * of all characters they directly control via their followers list.
 */
export function freeDi(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  char: CharacterInPlay,
): number {
  let used = 0;
  for (const followerId of char.followers) {
    const follower = view.opponent.characters[followerId] ?? view.self.characters[followerId];
    if (follower) used += mindCost(lookupDef(pool, follower.definitionId));
  }
  return char.effectiveStats.directInfluence - used;
}

/** Whether this character is wounded (inverted). */
export function isWounded(character: CharacterInPlay): boolean {
  return character.status === CardStatus.Inverted;
}

/**
 * The `strike-modifier` effect (Dodge, Risky Blow, cancel/reroll cards, etc.)
 * declared on a card definition, or undefined if it has none.
 */
export function strikeModifierEffect(
  def: CardDefinition | undefined,
): StrikeModifierEffect | undefined {
  const effects = (def as { effects?: readonly StrikeModifierEffect[] } | undefined)?.effects;
  return effects?.find(e => e.type === 'strike-modifier');
}

/** Whether this character is tapped. */
export function isTapped(character: CharacterInPlay): boolean {
  return character.status === CardStatus.Tapped;
}

/** Whether this character is untapped (ready to act). */
export function isUntapped(character: CharacterInPlay): boolean {
  return character.status === CardStatus.Untapped;
}

/** IDs of wounded characters in a company (self side). */
export function woundedCharactersInCompany(
  view: PlayerView,
  company: Company,
): CardInstanceId[] {
  const out: CardInstanceId[] = [];
  for (const id of company.characters) {
    const ch = view.self.characters[id];
    if (ch && isWounded(ch)) out.push(id);
  }
  return out;
}

/** IDs of tapped (not wounded) characters in a company (self side). */
export function tappedCharactersInCompany(
  view: PlayerView,
  company: Company,
): CardInstanceId[] {
  const out: CardInstanceId[] = [];
  for (const id of company.characters) {
    const ch = view.self.characters[id];
    if (ch && isTapped(ch)) out.push(id);
  }
  return out;
}

/** Whether any character in the company is currently untapped. */
export function hasUntappedCharacter(view: PlayerView, company: Company): boolean {
  for (const id of company.characters) {
    const ch = view.self.characters[id];
    if (ch && isUntapped(ch)) return true;
  }
  return false;
}

/**
 * Whether a site heals wounded characters during untap.
 * Covers havens and sites carrying the `heal-during-untap` site-rule
 * effect (e.g. Barad-dûr as Darkhaven). Override constraints granted
 * by separate cards (e.g. Sapling of the White Tree) are not visible
 * from the site definition alone and are treated conservatively.
 */
export function isHealingSite(def: CardDefinition | undefined): boolean {
  if (!isSite(def)) return false;
  if (def.siteType === 'haven') return true;
  const effects = (def as { effects?: readonly unknown[] }).effects;
  if (!Array.isArray(effects)) return false;
  for (const e of effects) {
    if (!e || typeof e !== 'object') continue;
    const eff = e as { type?: unknown; rule?: unknown };
    if (eff.type === 'site-rule' && eff.rule === 'heal-during-untap') return true;
  }
  return false;
}

/**
 * Search a play-option / grant-action `when` condition for a `target.status`
 * or `bearer.status` requirement, returning the required status string if
 * present (else `undefined`). Recurses through `$and` / `$or` / `$not`.
 *
 * This lets the restore-source scan tell *which* status a card can act on:
 * Halfling Strength's untap option is gated by `{ target.status: 'tapped' }`
 * while its heal option is gated by `{ target.status: 'inverted' }`.
 */
function extractRequiredStatus(when: unknown): string | undefined {
  if (!when || typeof when !== 'object') return undefined;
  const obj = when as Record<string, unknown>;
  if (typeof obj['target.status'] === 'string') return obj['target.status'];
  if (typeof obj['bearer.status'] === 'string') return obj['bearer.status'];
  for (const key of ['$and', '$or'] as const) {
    const arr = obj[key];
    if (Array.isArray(arr)) {
      for (const sub of arr) {
        const found = extractRequiredStatus(sub);
        if (found) return found;
      }
    }
  }
  if (obj['$not']) {
    const found = extractRequiredStatus(obj['$not']);
    if (found) return found;
  }
  return undefined;
}

/**
 * Whether a card's `effects` array carries a restore option that can bring a
 * character in `desiredStatus` back to `untapped`. Two patterns count:
 * - An effect (or `play-option` / `grant-action` wrapper) whose `apply` is
 *   `set-character-status` → `untapped`. If the option's `when` constrains the
 *   target/bearer status, that status must equal `desiredStatus` — an
 *   untap-only option (`{ status: 'tapped' }`) is not a heal for a wounded
 *   character, and vice versa.
 * - A `grant-action` → `heal-company-character` effect, which heals wounded
 *   (`inverted`) characters only.
 */
function hasRestoreOptionForStatus(
  effects: readonly unknown[] | undefined,
  desiredStatus: CardStatus,
): boolean {
  if (!effects) return false;
  for (const e of effects) {
    if (!e || typeof e !== 'object') continue;
    const eff = e as {
      type?: unknown;
      action?: unknown;
      when?: unknown;
      apply?: { type?: unknown; status?: unknown };
    };
    if (eff.type === 'grant-action' && eff.action === 'heal-company-character') {
      if (desiredStatus === CardStatus.Inverted) return true;
      continue;
    }
    const apply = eff.apply;
    if (apply && apply.type === 'set-character-status' && apply.status === 'untapped') {
      const required = extractRequiredStatus(eff.when);
      if (required === undefined || required === desiredStatus) return true;
    }
  }
  return false;
}

/**
 * The character `play-target` filter of a card, if any — the restriction on
 * which characters a hand card may target (e.g. Halfling Strength:
 * `{ target.race: 'hobbit' }`). Returns `undefined` when the card targets a
 * character with no restriction.
 */
function characterTargetFilter(effects: readonly unknown[] | undefined): Condition | undefined {
  for (const e of effects ?? []) {
    if (!e || typeof e !== 'object') continue;
    const eff = e as { type?: unknown; target?: unknown; filter?: Condition };
    if (eff.type === 'play-target' && eff.target === 'character' && eff.filter) {
      return eff.filter;
    }
  }
  return undefined;
}

/**
 * Whether a single character has some restore source — an equipped item
 * (e.g. Cram untaps its tapped bearer) or a hand card (e.g. Halfling
 * Strength) — that can bring it from its current status back to `untapped`.
 * Respects the card's `play-target` filter: a card like Halfling Strength
 * that only restores hobbits is no help to a Man.
 */
function characterHasRestoreSource(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  ch: CharacterInPlay,
): boolean {
  for (const item of ch.items) {
    const def = lookupDef(pool, item.definitionId);
    const effects = (def as { effects?: readonly unknown[] } | undefined)?.effects;
    if (hasRestoreOptionForStatus(effects, ch.status)) return true;
  }
  for (const card of view.self.hand) {
    const def = lookupDef(pool, card.definitionId);
    if (!def) continue;
    const effects = (def as { effects?: readonly unknown[] }).effects;
    if (!hasRestoreOptionForStatus(effects, ch.status)) continue;
    const filter = characterTargetFilter(effects);
    if (!filter) return true;
    const cdef = lookupDef(pool, ch.definitionId);
    if (!cdef) continue;
    const context = { target: { ...(cdef as unknown as Record<string, unknown>), status: ch.status } };
    if (matchesCondition(filter, context)) return true;
  }
  return false;
}

/**
 * Whether the company has a way to restore AT LEAST ONE character currently
 * in `desiredStatus` to `untapped` without traveling to a haven.
 *
 * Crucially this rejects false positives: a restore card is only counted when
 * an eligible company character in `desiredStatus` exists and matches the
 * card's target restriction. Conflating "any card that could heal/untap
 * something" with "a card that helps *this* company" caused the AI to enter
 * sites it had nothing to play at (bug report: AI site phase).
 */
function hasRestoreSource(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  company: Company,
  desiredStatus: CardStatus,
): boolean {
  for (const charId of company.characters) {
    const ch = view.self.characters[charId];
    if (!ch || ch.status !== desiredStatus) continue;
    if (characterHasRestoreSource(view, pool, ch)) return true;
  }
  return false;
}

/**
 * Whether the company has a way to heal EVERY wounded (`inverted`) character
 * without traveling to a haven. A card that heals only one wounded character
 * (e.g. Halfling Strength, hobbit-only) does not make the trip unnecessary
 * for the rest of the wounded company — they still need a haven visit during
 * untap, so movement scoring must keep steering toward one.
 */
export function hasHealingAvailable(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  company: Company,
): boolean {
  const wounded = woundedCharactersInCompany(view, company)
    .map(id => view.self.characters[id])
    .filter((ch): ch is CharacterInPlay => !!ch);
  if (wounded.length === 0) return true;
  return wounded.every(ch => characterHasRestoreSource(view, pool, ch));
}

/**
 * Whether the company has access to an untap effect for a currently-tapped
 * character — a hand card or item that toggles a tapped character's status to
 * `untapped`, unblocking a tap-to-play resource at a site.
 */
export function hasUntapSource(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  company: Company,
): boolean {
  return hasRestoreSource(view, pool, company, CardStatus.Tapped);
}

/**
 * Whether the hand contains a card that can be played at the given site
 * without needing to tap any character — currently permanent resource
 * events that pass the site's play filters. Used to justify entering a
 * site whose only visitors are already tapped.
 *
 * Must honour the same site gates the engine enforces
 * (`legal-actions/site.ts`): a `play-target: site` filter (site name/type)
 * and the `tapped-site-only` / `untapped-site-required` play-flags. Skipping
 * these let the AI treat cards like Rescue Prisoners (tw-315, "playable at
 * an already tapped Dark-hold or Shadow-hold") as a no-tap play at any site
 * in any tap state, entering with a fully-tapped company for an attack it
 * couldn't even follow up with the card in hand (bug report: game
 * msxdgosl-8meok7, seq 894 — Alatar's company entered Mount Gundabad with no
 * untapped character and faced its Orc automatic-attack for nothing, since
 * the site wasn't already tapped so Rescue Prisoners was never playable).
 */
export function handHasNoTapPlayableAt(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  site: AnySiteCard,
  siteTapped: boolean,
): boolean {
  for (const card of view.self.hand) {
    const def = lookupDef(pool, card.definitionId);
    if (!def) continue;
    if (def.cardType !== 'hero-resource-event' && def.cardType !== 'minion-resource-event') continue;
    const ev = def as { eventType?: string; effects?: readonly PlayTargetEffect[] };
    if (ev.eventType !== 'permanent') continue;
    // Permanent events that attach to a character (play-target: character)
    // bind an untapped character the same way an item does — either as a
    // declared tap (most) or, for Rescue Prisoners (tw-315), a tap on
    // resolution that discards the card for nothing if no character is left
    // untapped after its own triggered attack. Neither is a "no tap needed"
    // play, so a company with every character already tapped gets no credit
    // for holding one.
    if (ev.effects?.some(e => e.type === 'play-target' && e.target === 'character')) continue;
    if (hasPlayFlag(def, 'tapped-site-only') && !siteTapped) continue;
    if (hasPlayFlag(def, 'untapped-site-required') && siteTapped) continue;
    const siteTarget = (def.effects ?? []).find(
      (e): e is PlayTargetEffect => e.type === 'play-target' && e.target === 'site',
    );
    if (siteTarget?.filter && !matchesCondition(siteTarget.filter, site as unknown as Record<string, unknown>)) continue;
    return true;
  }
  return false;
}

/**
 * Net MP gain from storing an item vs. keeping it on the character.
 *
 * Returns `storedMp - equippedMp`.  A positive value means storing
 * increases the player's score; zero or negative means no benefit.
 *
 * Regular items stored at havens earn 0 MP in the out-of-play pile
 * (they have no `storable-at` effect to credit them).  Items that
 * carry a `storable-at` override earn that value; items with the
 * effect but no override earn the same base MP as when carried.
 */
export function storeItemMpGain(
  pool: Readonly<Record<string, CardDefinition>>,
  itemDefinitionId: string | undefined,
): number {
  if (!itemDefinitionId) return 0;
  const def = pool[itemDefinitionId];
  if (!def) return 0;
  const baseMp = mpValue(def);
  const effects = (def as { effects?: readonly { type: string; marshallingPoints?: number }[] }).effects;
  const storableEffect = effects?.find(e => e.type === 'storable-at');
  if (!storableEffect) return -baseMp; // regular item: stored MP = 0
  const storedMp = storableEffect.marshallingPoints ?? baseMp; // override or same as base
  return storedMp - baseMp;
}

/**
 * Resolve a site `CardInstanceId` (from a `plan-movement` action) to its
 * static {@link AnySiteCard} definition by searching the player's site deck
 * and any in-play sites.
 */
export function findSiteDef(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  siteInstanceId: CardInstanceId,
): AnySiteCard | undefined {
  const fromDeck = view.self.siteDeck.find(c => c.instanceId === siteInstanceId);
  if (fromDeck) {
    const def = lookupDef(pool, fromDeck.definitionId);
    if (isSite(def)) return def;
  }
  for (const company of view.self.companies) {
    if (company.currentSite?.instanceId === siteInstanceId) {
      const def = lookupDef(pool, company.currentSite.definitionId);
      if (isSite(def)) return def;
    }
    if (company.destinationSite?.instanceId === siteInstanceId) {
      const def = lookupDef(pool, company.destinationSite.definitionId);
      if (isSite(def)) return def;
    }
  }
  return undefined;
}

/**
 * Whether any offered `plan-movement` action targets a site where a hand
 * resource can be played directly (i.e. moving there this turn unlocks a
 * resource play).
 *
 * Used by the Organization pass scorer to guarantee the AI never idles a
 * healthy company that could move to a site enabling a resource play. The
 * weighted-sampling dispatcher otherwise leaves a small residual chance of
 * passing even when a dominant productive move exists — which surfaced as a
 * bug report ("healthy company with a playable item but it does not move").
 */
export function hasDirectlyPlayableMovement(
  view: PlayerView,
  pool: Readonly<Record<string, CardDefinition>>,
  legalActions: readonly GameAction[],
): boolean {
  for (const action of legalActions) {
    if (action.type !== 'plan-movement') continue;
    const destDef = findSiteDef(view, pool, action.destinationSite);
    if (!destDef) continue;
    if (anyCardPlayableAt(view, pool, destDef)) return true;
  }
  return false;
}
