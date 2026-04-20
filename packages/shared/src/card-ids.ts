/**
 * @module card-ids
 *
 * Named constants for frequently-referenced card definition IDs. These map
 * human-readable names (e.g. `ARAGORN`, `RIVENDELL`) to their underlying
 * set-prefixed identifiers from the card data JSON files.
 *
 * Using named constants instead of raw strings avoids typos, enables IDE
 * autocompletion, and makes test fixtures and default deck configurations
 * self-documenting.
 *
 * **Policy:** Only add a constant here when the card ID is referenced in
 * more than one place (typically a card-specific test plus another file).
 * IDs used in a single test file should be declared locally in that test
 * file to keep this module from accumulating merge-conflict churn.
 */

import type { CardDefinitionId, CardInstanceId } from './types/common.js';

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
/** Fatty Bolger — hobbit, scout, can tap to cancel strike against another hobbit. */
export const FATTY_BOLGER = did('tw-495');
/** Théoden — man, warrior/diplomat, mind 6, Rohan leader. */
export const THEODEN = did('tw-182');
/** Elrond — elf, expensive mind cost (10), powerful leader. */
export const ELROND = did('tw-145');
/** Glorfindel II — elf warrior/sage, prowess 8, mind 8. */
export const GLORFINDEL_II = did('tw-161');
/** Haldir — elf warrior, mind 3, Lorien. */
export const HALDIR = did('tw-164');
/** Celeborn — elf, mind 6, Lórien leader, +5 DI against Galadriel. */
export const CELEBORN = did('tw-136');
/** Galadriel — elf, mind 9, Lórien leader, +1 hand size at Lórien. */
export const GALADRIEL = did('tw-153');
/** Éowyn — woman of Rohan, mind 2, anti-Nazgûl prowess bonus. */
export const EOWYN = did('tw-147');
/** Beregond — Dúnadan warrior, mind 2, Minas Tirith. */
export const BEREGOND = did('tw-127');
/** Bard Bowman — Man warrior/scout, mind 2, Lake-town. */
export const BARD_BOWMAN = did('tw-124');
/** Adrazar — Dúnadan scout/diplomat, +1 DI against all factions. */
export const ADRAZAR = did('tw-116');
/** Anborn — Dúnadan scout/ranger, mind 2, Pelargir. */
export const ANBORN = did('tw-118');
/** Peath — Man ranger/diplomat, +4 DI vs Dunlendings, +5 prowess vs Nazgûl, halves Nazgûl body. */
export const PEATH = did('tw-176');
/** Balin — dwarf warrior/sage, DI 2, +2 prowess vs Orcs, +1 DI vs Dwarves. */
export const BALIN = did('tw-123');
/** Kíli — dwarf warrior/scout, mind 3, +1 prowess vs Orcs, corruption/faction penalties. */
export const KILI = did('tw-167');
/** Saruman — wizard, scout/ranger/sage/diplomat, DI 10, can use Palantíri. */
export const SARUMAN = did('tw-181');
/** Ioreth — Dúnadan sage, 0 prowess, healing effects affect all in her company. */
export const IORETH = did('td-93');

// ---- Items ----

/** Glamdring — major weapon, prowess bonus, found at goblin sites. */
export const GLAMDRING = did('tw-244');
/** Sting — minor weapon, small prowess bonus, pairs well with hobbits. */
export const STING = did('tw-333');
/** The Mithril-coat — major armour with body bonus and corruption cost. */
export const THE_MITHRIL_COAT = did('tw-345');
/** Dagger of Westernesse — minor weapon, low corruption, good starter item. */
export const DAGGER_OF_WESTERNESSE = did('tw-206');
/** Horn of Anor — minor item, +1 prowess to a warrior in combat. */
export const HORN_OF_ANOR = did('tw-259');
/** Hauberk of Bright Mail — major armour, warrior only, +2 body max 9. */
export const HAUBERK_OF_BRIGHT_MAIL = did('tw-254');
/** Precious Gold Ring — gold ring item that can be tested to become a special ring. */
export const PRECIOUS_GOLD_RING = did('tw-306');
/** Cram — minor item, discard to untap bearer or grant extra region movement. */
export const CRAM = did('td-105');
/** Scroll of Isildur — greater item, gold ring test modifier, playable at ruins/shadow/dark. */
export const SCROLL_OF_ISILDUR = did('tw-323');
/** Palantír of Orthanc — special item, palantír, playable only at Isengard. */
export const PALANTIR_OF_ORTHANC = did('tw-300');
/** Sapling of the White Tree — major item, storable at Minas Tirith for 2 MP. */
export const SAPLING_OF_THE_WHITE_TREE = did('tw-322');

// ---- Allies ----

/** Gwaihir — eagle ally, prowess 4/body 8, playable at Eagles' Eyrie, can fly company. */
export const GWAIHIR = did('tw-251');
/** Treebeard — ent ally, prowess 8/body 9, playable at Wellinghall, discards if company leaves Ent regions. */
export const TREEBEARD = did('tw-353');

// ---- Factions ----

/** Rangers of the North — Dúnadan faction, 3 MP, playable at Bree. */
export const RANGERS_OF_THE_NORTH = did('tw-311');
/** Riders of Rohan — Man faction, 3 MP, playable at Edoras. */
export const RIDERS_OF_ROHAN = did('tw-317');
/** Knights of Dol Amroth — Dúnadan faction, 3 MP, playable at Dol Amroth. */
export const KNIGHTS_OF_DOL_AMROTH = did('tw-263');
/** Rangers of Ithilien — Dúnadan faction, 3 MP, playable at Henneth Annûn. */
export const RANGERS_OF_ITHILIEN = did('tw-310');
/** Wood-elves — Elf faction, 3 MP, playable at Thranduil's Halls. */
export const WOOD_ELVES = did('tw-367');
/** Men of Lebennin — Man faction, 2 MP, playable at Pelargir. */
export const MEN_OF_LEBENNIN = did('tw-280');
/** Men of Anórien — Man faction, 2 MP, playable at Minas Tirith. */
export const MEN_OF_ANORIEN = did('tw-277');
/** Blue Mountain Dwarves — Dwarf faction, 3 MP, playable at Blue Mountain Dwarf-hold. */
export const BLUE_MOUNTAIN_DWARVES = did('tw-200');
/** Men of Anfalas — Man faction, 2 MP, playable at Lond Galen. */
export const MEN_OF_ANFALAS = did('tw-276');
/** Dunlendings — Man faction, 2 MP, playable at Dunnish Clan-hold. */
export const DUNLENDINGS = did('tw-211');

// ---- Resource Events ----

/** Gates of Morning — permanent environment event, cancels hazard environments. */
export const GATES_OF_MORNING = did('tw-243');
/** Sun — long environment event, +1 prowess to Dúnadan; with Gates of Morning also buffs Men and weakens enemies. */
export const SUN = did('tw-335');

/** Smoke Rings — short event, fetch a resource or character from sideboard or discard pile to play deck. */
export const SMOKE_RINGS = did('dm-159');
/** Little Snuffler — orc creature, attacker chooses defenders, denies scout resources if not defeated. */
export const LITTLE_SNUFFLER = did('dm-108');
/** Concealment — short event, tap a scout to cancel one attack against his company. */
export const CONCEALMENT = did('tw-204');
/** Dodge — short event, target character does not tap against one strike (body -1 if wounded). */
export const DODGE = did('tw-209');
/** Dark Quarrels — short event, cancel one attack by Orcs/Trolls/Men or halve strikes if Gates of Morning in play. */
export const DARK_QUARRELS = did('tw-207');
/** And Forth He Hastened — short event, untap a character in your Wizard's company. */
export const AND_FORTH_HE_HASTENED = did('td-98');
/** Marvels Told — ritual short event, tap a sage to discard a hazard non-environment permanent/long-event. */
export const MARVELS_TOLD = did('td-134');
/** Wizard's Laughter — spell short event, wizard only, cancels an influence check. */
export const WIZARDS_LAUGHTER = did('tw-362');
/** Vanishment — spell short event, wizard only, cancels an attack. */
export const VANISHMENT = did('tw-356');

// ---- Hazard Events ----

/** Doors of Night — permanent hazard event, environment that cancels resource environments. Cannot be duplicated. */
export const DOORS_OF_NIGHT = did('tw-28');
/** Eye of Sauron — long hazard event, increases automatic-attack prowess (+1, or +3 with Doors of Night). */
export const EYE_OF_SAURON = did('tw-32');
/** Twilight — short hazard event, environment that cancels another environment. May also be played as a resource. */
export const TWILIGHT = did('tw-106');
/** An Unexpected Outpost — short hazard event, fetch a hazard from sideboard/discard to play deck (twice with Doors of Night). */
export const AN_UNEXPECTED_OUTPOST = did('dm-45');
/** Two or Three Tribes Present — short hazard event, choose a creature type to bypass hazard limit. */
export const TWO_OR_THREE_TRIBES_PRESENT = did('dm-97');

// ---- Creatures ----

/** Assassin — men hazard creature, three attacks against one character, keyed to free-holds/border-holds. */
export const ASSASSIN = did('tw-8');
/** Cave-drake — wilderness hazard creature with moderate prowess. */
export const CAVE_DRAKE = did('tw-020');
/** Orc-guard — orc hazard, five strikes, prowess 8, keyed to shadow/dark regions. */
export const ORC_GUARD = did('tw-072');
/** Orc-warband — orc hazard, five strikes, prowess 4 (+3 after prior orc attack), keyed to wilderness/shadow/dark. */
export const ORC_WARBAND = did('tw-076');
/** Orc-lieutenant — orc hazard, one strike, prowess 7. */
export const ORC_LIEUTENANT = did('tw-073');
/** Orc-watch — orc hazard, three strikes, prowess 9, keyed to shadow/dark regions. */
export const ORC_WATCH = did('tw-078');
/** Orc-patrol — shadow-land hazard, common low-prowess roadblock. */
export const ORC_PATROL = did('tw-074');
/** Barrow-wight — undead hazard found near ruins and shadow-lands. */
export const BARROW_WIGHT = did('tw-015');
/** Bert (Burat) — unique troll hazard, 1 strike, 12 prowess. Wounded characters discard non-special items if company faced William or Tom. */
export const BERT_BURAT = did('tw-016');
/** Tom (Tuma) — unique troll hazard, 1 strike, 13 prowess. Wounded characters discard non-special items if company faced Bert or William. */
export const TOM_TUMA = did('tw-103');
/** William (Wuluag) — unique troll hazard, 1 strike, 11 prowess. Wounded characters discard non-special items if company faced Bert or Tom. */
export const WILLIAM_WULUAG = did('tw-112');
/** Hobgoblins — orc hazard, 2 strikes, prowess 10, keyed to double wilderness. */
export const HOBGOBLINS = did('le-77');
/** Foolish Words — hazard permanent-event, -4 to influence attempts, revealable on-guard. */
export const FOOLISH_WORDS = did('td-25');
/**
 * Lure of the Senses — corruption hazard permanent-event playable on a
 * non-Ringwraith character. Adds 2 corruption points to the bearer and
 * forces a corruption check at the end of the bearer's untap phase if
 * at a Haven/Darkhaven. Bearer may tap during their organization phase
 * to remove the card on a roll greater than 6.
 */
export const LURE_OF_THE_SENSES = did('tw-60');
/**
 * Alone and Unadvised — hazard corruption card playable on a non-Wizard,
 * non-Ringwraith character in a company with 3 or fewer characters. Adds
 * 4 corruption points. Bearer makes corruption checks per region at end
 * of MH, all corruption checks modified by company size. Bearer may tap
 * to remove on roll > 6. Auto-discards if company reaches 4+ characters.
 */
export const ALONE_AND_UNADVISED = did('as-24');
/**
 * Lost in Free-domains — hazard permanent-event playable on a company
 * moving with a Free-domain in its site path. Adds an active constraint
 * (`site-phase-do-nothing`) that prevents the affected company from
 * doing anything during its next site phase.
 */
export const LOST_IN_FREE_DOMAINS = did('tw-53');
/**
 * Stealth — hero short-event resource. Played by tapping a scout at the
 * end of the organization phase if the scout's company has fewer than
 * three characters. Adds a `no-creature-hazards-on-company` active
 * constraint scoped to the current turn — the *opponent* may not play
 * creature hazards on the protected company until turn-end.
 */
export const STEALTH = did('tw-332');
/**
 * River — hazard short-event playable on a site. A company moving
 * to that site this turn must do nothing during its site phase. A
 * ranger in the affected company may tap to cancel the effect (only at
 * the very start of the company's site phase, per CRF 22).
 */
export const RIVER = did('tw-84');
/**
 * Halfling Strength — hero short-event resource. Hobbit only. During
 * organization the target hobbit may untap, heal from wounded to well,
 * or receive a +4 corruption-check modifier (as an active constraint).
 */
export const HALFLING_STRENGTH = did('tw-253');

// ---- Sites ----

/** Rivendell — haven site, common starting location for hero players. */
export const RIVENDELL = did('tw-421');
/** Lorien — haven site in the heart of the elven woods. */
export const LORIEN = did('tw-408');
/** Edhellond — haven site on the coast of Anfalas. */
export const EDHELLOND = did('tw-393');
/** Grey Havens — haven site in Lindon, port of the Elves. */
export const GREY_HAVENS = did('tw-399');
/** Moria — shadow-hold, site for major items but guarded by automatic attacks. */
export const MORIA = did('tw-413');
/** Minas Tirith — free-hold of Gondor, faction and ally destination. */
export const MINAS_TIRITH = did('tw-412');
/** Mount Doom — the only site where The One Ring can be destroyed. */
export const MOUNT_DOOM = did('tw-414');
/** Ettenmoors — hero ruins-and-lairs in Rhudaur, nearest haven Rivendell. */
export const ETTENMOORS_HERO = did('tw-395');
/** The White Towers — hero ruins-and-lairs in Arthedain, nearest haven Rivendell. */
export const THE_WHITE_TOWERS_HERO = did('tw-430');
/** Barrow-downs — hero ruins-and-lairs in Cardolan, nearest haven Rivendell. */
export const BARROW_DOWNS = did('tw-375');
/** Tolfalas — hero ruins-and-lairs in Mouths of the Anduin, nearest haven Edhellond. */
export const TOLFALAS = did('tw-433');
/** Eagles' Eyrie — hero free-hold in Anduin Vales, nearest haven Lórien. */
export const EAGLES_EYRIE = did('tw-391');
/** Henneth Annûn — hero border-hold in Ithilien, nearest haven Lórien. */
export const HENNETH_ANNUN = did('tw-400');
/** Old Forest — hero border-hold in Cardolan, nearest haven Rivendell. */
export const OLD_FOREST = did('tw-417');
/** Bag End — hero free-hold in The Shire, nearest haven Rivendell. */
export const BAG_END = did('tw-372');
/** Bag End (LE) — minion free-hold in The Shire, nearest haven Carn Dûm. */
export const BAG_END_LE = did('le-350');
/** Carn Dûm — minion haven in Angmar. */
export const CARN_DUM = did('le-359');
/** Bree — border-hold in Arthedain, nearest haven Rivendell. */
export const BREE = did('tw-378');
/** Pelargir — hero free-hold in Lebennin, nearest haven Edhellond. */
export const PELARGIR = did('tw-419');
/** Edoras — hero free-hold in Rohan, nearest haven Lórien. */
export const EDORAS = did('tw-394');
/** Dol Amroth — hero free-hold in Belfalas, nearest haven Edhellond. */
export const DOL_AMROTH = did('tw-386');
/** Thranduil's Halls — hero free-hold in Woodland Realm, nearest haven Lórien. */
export const THRANDUILS_HALLS = did('tw-432');
/** Isengard — hero ruins-and-lairs in Gap of Isen, nearest haven Lórien. */
export const ISENGARD = did('tw-404');
/** Blue Mountain Dwarf-hold — hero free-hold in Númeriador, nearest haven Grey Havens. */
export const BLUE_MOUNTAIN_DWARF_HOLD = did('tw-377');
/** Bandit Lair — hero border-hold in Brown Lands, nearest haven Lórien. */
export const BANDIT_LAIR = did('tw-373');
/** Dunnish Clan-hold — hero border-hold in Dunland, nearest haven Rivendell. */
export const DUNNISH_CLAN_HOLD = did('tw-390');
/** Wellinghall — hero free-hold in Fangorn, nearest haven Lórien. */
export const WELLINGHALL = did('tw-437');
/** Lond Galen — hero site, free-hold in Anfalas. */
export const LOND_GALEN = did('tw-407');

// ---- Placeholder cards for unknown/hidden cards ----

/** Placeholder definition ID for a face-down play deck card (resource or hazard). */
export const UNKNOWN_CARD = did('unknown-card');
/** Placeholder definition ID for a face-down site card. */
export const UNKNOWN_SITE = did('unknown-site');
/** Placeholder instance ID for a hidden card in the draft pool. */
export const UNKNOWN_INSTANCE = 'unknown-instance' as CardInstanceId;

/** Check whether a definition ID represents a hidden (face-down) card. */
export function isCardHidden(definitionId: CardDefinitionId): boolean {
  return definitionId === UNKNOWN_CARD || definitionId === UNKNOWN_SITE;
}
