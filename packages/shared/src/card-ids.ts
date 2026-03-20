/**
 * @module card-ids
 *
 * Named constants for frequently-referenced card definition IDs. These map
 * human-readable names (e.g. `ARAGORN`, `RIVENDELL`) to their underlying
 * "tw-NNN" identifiers from the card data JSON files.
 *
 * Using named constants instead of raw strings avoids typos, enables IDE
 * autocompletion, and makes test fixtures and default deck configurations
 * self-documenting. The "tw" prefix refers to "The Wizards", the base set.
 */

import type { CardDefinitionId } from './types/common.js';

/**
 * Casts a raw string to the branded {@link CardDefinitionId} type.
 * This is a zero-cost helper — it exists solely to satisfy TypeScript's
 * nominal type system without cluttering every call site.
 */
const did = (s: string) => s as CardDefinitionId;

// ---- Characters ----

/** Gandalf — wizard character, the most powerful hero with high mind cost. */
export const GANDALF = did('tw-156');
/** Aragorn (Strider) — ranger, strong prowess/body, warrior and ranger skills. */
export const ARAGORN = did('tw-120');
/** Legolas — elf, scout skill, solid archer and warrior. */
export const LEGOLAS = did('tw-168');
/** Gimli — dwarf warrior with high prowess. */
export const GIMLI = did('tw-159');
/** Frodo — hobbit ring-bearer, low combat stats but crucial for ring items. */
export const FRODO = did('tw-152');
/** Faramir — Gondor ranger, balanced prowess and diplomatic skills. */
export const FARAMIR = did('tw-149');
/** Bilbo — hobbit, scout skill, good at corruption checks. */
export const BILBO = did('tw-131');
/** Sam Gamgee — hobbit, mind 4, scout/ranger, corruption checks +3. */
export const SAM_GAMGEE = did('tw-180');
/** Beorn — man, strong warrior (prowess 7), mind 7. */
export const BEORN = did('tw-126');
/** Théoden — man, warrior/diplomat, mind 6, Rohan leader. */
export const THEODEN = did('tw-182');
/** Elrond — elf, expensive mind cost (10), powerful leader. */
export const ELROND = did('tw-145');
/** Glorfindel II — elf warrior/sage, prowess 8, mind 8. */
export const GLORFINDEL_II = did('tw-161');
/** Celeborn — elf, mind 6, Lórien leader, +5 DI against Galadriel. */
export const CELEBORN = did('tw-136');
/** Éowyn — woman of Rohan, mind 2, anti-Nazgûl prowess bonus. */
export const EOWYN = did('tw-147');
/** Beregond — Dúnadan warrior, mind 2, Minas Tirith. */
export const BEREGOND = did('tw-127');
/** Bergil — Dúnadan warrior/scout, mind 2, Minas Tirith. */
export const BERGIL = did('tw-129');
/** Bard Bowman — Man warrior/scout, mind 2, Lake-town. */
export const BARD_BOWMAN = did('tw-124');
/** Anborn — Dúnadan scout/ranger, mind 2, Pelargir. */
export const ANBORN = did('tw-118');

// ---- Items ----

/** Glamdring — major weapon, prowess bonus, found at goblin sites. */
export const GLAMDRING = did('tw-244');
/** Sting — minor weapon, small prowess bonus, pairs well with hobbits. */
export const STING = did('tw-333');
/** The One Ring — the game's most powerful (and most corrupting) item. */
export const THE_ONE_RING = did('tw-347');
/** The Mithril-coat — major armour with body bonus and corruption cost. */
export const THE_MITHRIL_COAT = did('tw-345');
/** Dagger of Westernesse — minor weapon, low corruption, good starter item. */
export const DAGGER_OF_WESTERNESSE = did('tw-206');
/** Horn of Anor — minor item, +1 prowess to a warrior in combat. */
export const HORN_OF_ANOR = did('tw-259');

// ---- Creatures ----

/** Cave-drake — wilderness hazard creature with moderate prowess. */
export const CAVE_DRAKE = did('tw-020');
/** Orc-patrol — shadow-land hazard, common low-prowess roadblock. */
export const ORC_PATROL = did('tw-074');
/** Barrow-wight — undead hazard found near ruins and shadow-lands. */
export const BARROW_WIGHT = did('tw-015');

// ---- Sites ----

/** Rivendell — haven site, common starting location for hero players. */
export const RIVENDELL = did('tw-421');
/** Lorien — haven site in the heart of the elven woods. */
export const LORIEN = did('tw-408');
/** Moria — shadow-hold, site for major items but guarded by automatic attacks. */
export const MORIA = did('tw-413');
/** Minas Tirith — free-hold of Gondor, faction and ally destination. */
export const MINAS_TIRITH = did('tw-412');
/** Mount Doom — the only site where The One Ring can be destroyed. */
export const MOUNT_DOOM = did('tw-414');

// ---- Regions ----

/** Rhudaur — wilderness region north of Rivendell. */
export const RHUDAUR = did('tw-482');
/** Hollin — wilderness region (Eregion), path toward Moria. */
export const HOLLIN = did('tw-466');
/** Rohan — wilderness region of the horse-lords. */
export const ROHAN = did('tw-483');
/** Ithilien — shadow-land region east of Minas Tirith. */
export const ITHILIEN = did('tw-470');

// ---- Placeholder cards for unknown/hidden cards ----

/** Placeholder definition ID for a face-down play deck card (resource or hazard). */
export const UNKNOWN_CARD = did('unknown-card');
/** Placeholder definition ID for a face-down site card. */
export const UNKNOWN_SITE = did('unknown-site');
