/**
 * Common primitive types, branded IDs, and enums shared across the entire MECCG engine.
 *
 * Branded ID types use TypeScript's intersection trick to prevent accidentally
 * passing a raw string where a specific ID type is expected (e.g. passing a
 * CardInstanceId where a CardDefinitionId is required).
 */

/** Unique identifier for a player in a game session. */
export type PlayerId = string & { readonly __brand: 'PlayerId' };

/**
 * Unique identifier for a specific card instance in a game.
 * Multiple instances can share the same CardDefinitionId (e.g. two copies
 * of Dagger of Westernesse), but each has a unique CardInstanceId.
 */
export type CardInstanceId = string & { readonly __brand: 'CardInstanceId' };

/**
 * Identifier for a card definition in the static card pool.
 * Corresponds to the card's ID in the JSON data files (e.g. "tw-120" for Aragorn II).
 */
export type CardDefinitionId = string & { readonly __brand: 'CardDefinitionId' };

/**
 * Identifier for a "manifestation chain" — a set of related cards that
 * together represent multiple in-game forms of one entity (e.g. the basic
 * Dragon creature, its Ahunt long-event, and its At-Home permanent-event
 * all manifest the same Dragon).
 *
 * Conventionally the value is the {@link CardDefinitionId} of the chain's
 * **base form** — the dragon creature card for Dragons. All cards in a
 * chain (including the base form itself) carry the same `manifestId`.
 *
 * Used to derive whole-chain state (e.g. "is this Dragon defeated?") from
 * the eliminated pile without a separate top-level state map. See
 * `specs/2026-04-17-dragons-expansion-plan.md` §4.3.
 */
export type ManifestId = CardDefinitionId;

/** Unique identifier for a company (a group of characters traveling together). */
export type CompanyId = string & { readonly __brand: 'CompanyId' };

/**
 * A readonly map keyed by a {@link CardInstanceId}.
 *
 * Prefer this over `Readonly<Record<string, V>>` for any record indexed by a
 * card instance id: the branded key turns "indexing with the wrong id type"
 * (e.g. a {@link CompanyId} or a bare `string`) into a compile error, and lets
 * call sites drop the reflexive `id as string` casts that a plain
 * `Record<string, V>` does not require but accumulated as noise.
 */
export type ById<V> = Readonly<Record<CardInstanceId, V>>;

/** A readonly map keyed by a {@link CardDefinitionId} (e.g. the static card pool). */
export type ByCardDefinitionId<V> = Readonly<Record<CardDefinitionId, V>>;

/** A readonly map keyed by a {@link PlayerId}. */
export type ByPlayerId<V> = Readonly<Record<PlayerId, V>>;

/** A single die result (1-6) for a standard six-sided die. */
export type DieRoll = 1 | 2 | 3 | 4 | 5 | 6;

/** Result of rolling two six-sided dice (2d6), used in combat, corruption checks, and influence attempts. */
export interface TwoDiceSix {
  readonly die1: DieRoll;
  readonly die2: DieRoll;
}

/**
 * Races for characters and creatures, covering all alignments and creature types.
 *
 * This enum is the *only* race vocabulary in the game: every `race` on a card,
 * every race compared in a DSL condition (`enemy.race`, `target.race`,
 * `races`, …), and every race the engine derives from a site's automatic-attack
 * label must be one of these values. There is deliberately exactly one
 * identifier per race — no plural/singular or spelling variants such as
 * `orcs`/`orc` or `dúnadan`/`dúnedain`, which used to exist side by side and
 * silently made conditions fail to match. The printed plural labels the cards
 * show (an "Orcs" automatic-attack) are `creatureType` display text and are
 * converted here through `normalizeCreatureRace`.
 *
 * Every race-carrying field, parameter and local in the engine is typed as
 * this enum rather than `string`, so a plural or misspelt race is a compile
 * error rather than a condition that quietly never matches. Two consequences
 * are worth knowing:
 *
 * - A race-typed slot holds exactly **one** race. The handful of creatures
 *   that print several attack types (Goblin-faces wh-13 "Orcs. Men.") keep the
 *   primary race in `race` and the rest in `additionalRaces`; nothing ever
 *   stores a comma-joined list.
 * - Text that names no race — Vile Fumes' "Gas" label, an injected attack's
 *   empty label, an ally or item being influenced — is represented as absent
 *   (`undefined`), never as an empty string or a lowercased label posing as a
 *   race.
 *
 * A card test asserts that no other race value appears anywhere in the card
 * data, so adding a race means adding it here first.
 */
export enum Race {
  Hobbit = 'hobbit',
  Elf = 'elf',
  Dwarf = 'dwarf',
  Dunadan = 'dunadan',
  Man = 'man',
  Wizard = 'wizard',
  Orc = 'orc',
  Troll = 'troll',
  /**
   * The Nazgûl — both the minion Ringwraith avatar characters and the Nazgûl
   * hazard creatures, which are the same nine beings and are addressed
   * together by card text ("Against Nazgûl and Ringwraiths …").
   */
  Ringwraith = 'ringwraith',
  /** The five Istari as fallen-wizard avatars (White Hand expansion). */
  FallenWizard = 'fallen-wizard',
  /** The Balrog of Moria as the balrog avatar (The Balrog expansion). */
  Balrog = 'balrog',
  Dragon = 'dragon',
  Drake = 'drake',
  Undead = 'undead',
  Spider = 'spider',
  Wolf = 'wolf',
  Bear = 'bear',
  Giant = 'giant',
  Animal = 'animal',
  Eagle = 'eagle',
  Ent = 'ent',
  Wose = 'wose',
  /** Ainur in incarnate form (e.g. the Maia guardians of Against the Shadow sites). */
  Maia = 'maia',
  /** Spawn of the Balrog and kindred deep-dwelling horrors (The Balrog expansion). */
  Spawn = 'spawn',
  AwakenedPlant = 'awakened-plant',
  PukelCreature = 'pukel-creature',
  Slayer = 'slayer',
  /** Gollum ("My Precious", dm-29) — a creature rather than a member of any race. */
  Creature = 'creature',
  /** The Dead of Dunharrow ("Army of the Dead", tw-193) — a faction with no race. */
  Special = 'special',
}

/** Character skills that determine special abilities and card interactions. */
export enum Skill {
  Warrior = 'warrior',
  Scout = 'scout',
  Ranger = 'ranger',
  Sage = 'sage',
  Diplomat = 'diplomat',
  /**
   * Magic abilities. A character carrying one of these can cast (be the target
   * of) magic resource cards of the matching class — `sorcery`, `spirit-magic`,
   * or `shadow-magic`. Ringwraiths can use `shadow-magic` by race even without
   * the skill (see `organization-events.ts`); other characters need the skill.
   * Magic resource cards declare the class they require via the matching
   * {@link Keyword} (e.g. a `sorcery` card needs a `sorcery`-using caster).
   */
  Sorcery = 'sorcery',
  SpiritMagic = 'spirit-magic',
  ShadowMagic = 'shadow-magic',
}

/**
 * Region types represent the terrain of geographic areas on the Middle-earth map.
 * They determine which hazard creatures can be played against companies
 * moving through those regions.
 */
export enum RegionType {
  Wilderness = 'wilderness',
  Shadow = 'shadow',
  Dark = 'dark',
  Coastal = 'coastal',
  Free = 'free',
  Border = 'border',
}

/**
 * Site types classify locations on the map. Each type determines what
 * resources can be played there and what automatic attacks occur.
 * Havens are safe bases for healing and reorganization.
 */
export enum SiteType {
  Haven = 'haven',
  FreeHold = 'free-hold',
  BorderHold = 'border-hold',
  RuinsAndLairs = 'ruins-and-lairs',
  ShadowHold = 'shadow-hold',
  DarkHold = 'dark-hold',
}

/**
 * Movement types available when a company travels between sites.
 *
 * The resource player declares the movement type at step 2 of the
 * Movement/Hazard phase, which determines how the site path is computed.
 */
export enum MovementType {
  /** Path follows the route printed on the site or haven card. */
  Starter = 'starter',
  /** Path is a player-declared sequence of up to 4 consecutive regions. */
  Region = 'region',
  /** Movement through the Under-deeps network (no surface site path). */
  UnderDeeps = 'under-deeps',
  /** Movement via a special card effect; path depends on the effect. */
  Special = 'special',
}

/**
 * The six categories of marshalling points (victory points).
 * At the Free Council (endgame), the doubling and diversity rules
 * apply across these categories.
 */
export enum MarshallingCategory {
  Character = 'character',
  Item = 'item',
  Faction = 'faction',
  Ally = 'ally',
  Kill = 'kill',
  Misc = 'misc',
}

/**
 * The alignment of a player or card, determining which card pool
 * (wizard, ringwraith, fallen-wizard, or balrog) they belong to.
 * Used both as the player's chosen alignment and as a tag on each
 * card definition to indicate which alignment can include it in a deck.
 */
export enum Alignment {
  Wizard = 'wizard',
  Ringwraith = 'ringwraith',
  FallenWizard = 'fallen-wizard',
  Balrog = 'balrog',
}

/** The five Istari (Wizards) that serve as player avatars in the game. */
export enum WizardName {
  Gandalf = 'gandalf',
  Saruman = 'saruman',
  Radagast = 'radagast',
  Alatar = 'alatar',
  Pallando = 'pallando',
}

/**
 * The three possible states of a card in play.
 * Untapped cards can act freely; tapped cards are exhausted;
 * inverted (upside-down) cards represent wounded characters or
 * other special states depending on card type.
 */
export enum CardStatus {
  Untapped = 'untapped',
  Tapped = 'tapped',
  Inverted = 'inverted',
}

/**
 * The lowercase string names of the {@link CardStatus} values. This is the
 * representation used by the card DSL (e.g. `TriggeredAction.status`) and by
 * the condition-matcher / projection contexts, which speak plain strings
 * rather than the engine's nominal enum. Derived from {@link CardStatus} so
 * the two can never drift.
 */
export type CardStatusName = `${CardStatus}`;

/**
 * Convert a DSL/projection {@link CardStatusName} to the engine's
 * {@link CardStatus} enum. Centralises the `name === 'untapped' ? … : …`
 * ternary that was inlined at every set-character-status site.
 */
export function cardStatusFromName(name: CardStatusName): CardStatus {
  switch (name) {
    case 'untapped': return CardStatus.Untapped;
    case 'tapped': return CardStatus.Tapped;
    case 'inverted': return CardStatus.Inverted;
  }
}

/**
 * Convert an engine {@link CardStatus} to its lowercase {@link CardStatusName},
 * the representation expected by condition-matcher / projection contexts.
 */
export function cardStatusToName(status: CardStatus): CardStatusName {
  return status;
}

/**
 * The kinds of 2d6 checks that can be modified by `check-modifier`
 * effects. METD §1.2 generalized the original `influence` check into a
 * family — the scoring/modifier pipeline is identical, but cards can
 * target a specific kind (e.g. Foolish Words modifies influence,
 * riddling AND offering by -4).
 *
 * - `influence` — faction influence attempts and direct/general
 *   influence rolls.
 * - `riddling` — METD riddling attempts.
 * - `offering` — METD offering attempts.
 * - `flattery` — METD flattery attempts.
 * - `corruption` — corruption-removal rolls.
 * - `gold-ring-test` — gold-ring item test rolls.
 */
export type CheckKind =
  | 'influence'
  | 'riddling'
  | 'offering'
  | 'flattery'
  | 'corruption'
  | 'gold-ring-test';

/**
 * Recognized card-data keywords. Each entry is a tag used by card text and
 * (for some) by engine rules. Keep this union closed: an unrecognized
 * keyword string in card data is a typo, not a valid extension.
 *
 * **Engine-consumed keywords** (rules logic checks these):
 * - `weapon`, `armor`, `shield`, `helmet` — item slots; the bearer may use
 *   the effects of only one item per slot at a time (rule 9.15).
 * - `environment` — hazard events with this tag follow special play timing.
 * - `spell` — spell-tagged events have separate cancellation/discard timing.
 * - `hoard` — hoard items (METD §3) may only be played at hoard sites.
 * - `ring` — ring items subject to ring-test and identification mechanics.
 *
 * **Tag-only keywords** (used by card text matchers; no engine rule beyond
 * filterability):
 * - `palantir` — palantíri item subgrouping.
 * - `ritual` — METD ritual-tagged events.
 * - `light-enchantment`, `dark-enchantment` — METD enchantment categories.
 * - `stolen-knowledge` — MEWH resource-event subgrouping (e.g. Dark Numbers
 *   dm-123); referenced by sibling cards' text ("discards a Stolen Knowledge
 *   card it controls").
 * - `Leader`, `Uruk-hai`, `Olog-hai` — minion character subgroupings.
 * - `Half-orc` — race-keyword: the character counts as an Orc for all purposes
 *   *except* that it never makes its company overt and may not take trophies
 *   (CoE glossary "Half-orc"; CRF-22: "Half-orcs do not [make a company overt]").
 *   Consumed by `isCovertCompany` (reducer-utils) and the trophy-offer logic
 *   (reducer-combat); see {@link isHalfOrc}.
 * - `agent` — character is an agent (counts as both character and hazard for deck-building; has home sites).
 * - `Spawn` — Spawn-tagged creatures and their manifestations (e.g. Balrog of Moria, The Balrog).
 * - `starting-item` — the card belongs to the starting-item category:
 *   non-unique, non-hoard minor items plus cards whose text says they may
 *   be played "in lieu of a minor item". Excluded: unique cards (CRF) and
 *   cards whose text says "cannot be included with a starting company".
 *
 * **Legacy / superseded:**
 * - `dragon-manifestation` — superseded by the per-card `manifestId` tag
 *   (see Dragons expansion plan §4.3); retained for compatibility while
 *   manifestation cards still carry it.
 */
export type Keyword =
  | 'weapon'
  | 'armor'
  | 'shield'
  | 'helmet'
  | 'environment'
  | 'spell'
  | 'sorcery'
  | 'spirit-magic'
  | 'shadow-magic'
  | 'hoard'
  | 'ring'
  | 'palantir'
  | 'ritual'
  | 'light-enchantment'
  | 'dark-enchantment'
  | 'stolen-knowledge'
  | 'leader'
  | 'uruk-hai'
  | 'olog-hai'
  | 'half-orc'
  | 'balrog-specific'
  | 'agent'
  | 'dragon-manifestation'
  | 'corruption'
  | 'under-deeps'
  | 'spawn'
  | 'starting-item'
  | 'Nazgûl'
  // MEWH wizard-specific stage cards (the card is bound to one Fallen-wizard).
  | 'alatar-specific'
  | 'gandalf-specific'
  | 'pallando-specific'
  | 'radagast-specific'
  | 'saruman-specific';

/**
 * Maps each `<wizard>-specific` keyword to the avatar name it binds a card to
 * (CoE rule 1.3.4 / MEWH §12). Shared by the deck-construction check (a deck
 * may only include a wizard-specific card if that avatar is declared) and the
 * in-play sweep that discards such cards once the avatar leaves play.
 */
export const WIZARD_SPECIFIC_KEYWORD_NAMES: Readonly<Record<string, string>> = {
  'alatar-specific': 'Alatar',
  'gandalf-specific': 'Gandalf',
  'pallando-specific': 'Pallando',
  'radagast-specific': 'Radagast',
  'saruman-specific': 'Saruman',
};

/**
 * How a finished game was decided (CoE rule 10.39 / MELE §1).
 *
 * - `marshalling-points` — the normal CoE §10.3 endgame: the higher
 *   tournament score wins after Free Council corruption checks.
 * - `one-ring` — a player won immediately with The One Ring. `alignment`
 *   records which path was used; `card` is the played win-condition card
 *   (`tw-205` Cracks of Doom, `tw-247` Gollum's Fate, `wh-60` A New Ringlord,
 *   or `ba-52` Challenge the Power), or `null` for the Ringwraith positional
 *   win at Barad-dûr (which has no card).
 */
export type WinReason =
  | { readonly kind: 'marshalling-points' }
  | { readonly kind: 'one-ring'; readonly alignment: Alignment; readonly card: CardDefinitionId | null };

/**
 * A card reference carrying both its instance ID and definition ID.
 * Used everywhere a card is referenced in game state, phase state, and views.
 * For hidden cards the definition ID is `UNKNOWN_CARD` or `UNKNOWN_SITE`.
 */
export interface ViewCard {
  /** The card's unique in-game instance ID. */
  readonly instanceId: CardInstanceId;
  /** The card's definition ID (may be an unknown sentinel for hidden cards). */
  readonly definitionId: CardDefinitionId;
}
