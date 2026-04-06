/**
 * @module card-ids
 *
 * Named constants for frequently-referenced card definition IDs. These map
 * human-readable names (e.g. `ARAGORN`, `RIVENDELL`) to their underlying
 * set-prefixed identifiers from the card data JSON files.
 *
 * Using named constants instead of raw strings avoids typos, enables IDE
 * autocompletion, and makes test fixtures and default deck configurations
 * self-documenting. Prefixes: "tw" = The Wizards, "le" = The Lidless Eye,
 * "wh" = The White Hand.
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
/** Beorn — man, strong warrior (prowess 7), mind 7. */
export const BEORN = did('tw-126');
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
/** Bergil — Dúnadan warrior/scout, mind 2, Minas Tirith. */
export const BERGIL = did('tw-129');
/** Bard Bowman — Man warrior/scout, mind 2, Lake-town. */
export const BARD_BOWMAN = did('tw-124');
/** Alatar — wizard, warrior/scout/ranger/sage, home site Edhellond. */
export const ALATAR = did('tw-117');
/** Adrazar — Dúnadan scout/diplomat, +1 DI against all factions. */
export const ADRAZAR = did('tw-116');
/** Anborn — Dúnadan scout/ranger, mind 2, Pelargir. */
export const ANBORN = did('tw-118');
/** Balin — dwarf warrior/sage, DI 2, +2 prowess vs Orcs, +1 DI vs Dwarves. */
export const BALIN = did('tw-123');
/** Kíli — dwarf warrior/scout, mind 3, +1 prowess vs Orcs, corruption/faction penalties. */
export const KILI = did('tw-167');

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

// ---- Allies ----

/** Gwaihir — eagle ally, prowess 4/body 8, playable at Eagles' Eyrie, can fly company. */
export const GWAIHIR = did('tw-251');
/** Shadowfax — horse ally, prowess 2/body 8, playable at Edoras, enables double movement. */
export const SHADOWFAX = did('tw-326');

// ---- Factions ----

/** Rangers of the North — Dúnadan faction, 3 MP, playable at Bree. */
export const RANGERS_OF_THE_NORTH = did('tw-311');
/** Riders of Rohan — Man faction, 3 MP, playable at Edoras. */
export const RIDERS_OF_ROHAN = did('tw-317');
/** Knights of Dol Amroth — Dúnadan faction, 3 MP, playable at Dol Amroth. */
export const KNIGHTS_OF_DOL_AMROTH = did('tw-263');
/** Wood-elves — Elf faction, 3 MP, playable at Thranduil's Halls. */
export const WOOD_ELVES = did('tw-367');
/** Men of Lebennin — Man faction, 2 MP, playable at Pelargir. */
export const MEN_OF_LEBENNIN = did('tw-280');
/** Blue Mountain Dwarves — Dwarf faction, 3 MP, playable at Blue Mountain Dwarf-hold. */
export const BLUE_MOUNTAIN_DWARVES = did('tw-200');

// ---- Resource Events ----

/** Gates of Morning — permanent environment event, cancels hazard environments. */
export const GATES_OF_MORNING = did('tw-243');
/** Sun — long environment event, +1 prowess to Dúnadan; with Gates of Morning also buffs Men and weakens enemies. */
export const SUN = did('tw-335');

/** Smoke Rings — short event, fetch a resource or character from sideboard or discard pile to play deck. */
export const SMOKE_RINGS = did('dm-159');

// ---- Hazard Events ----

/** Doors of Night — permanent hazard event, environment that cancels resource environments. Cannot be duplicated. */
export const DOORS_OF_NIGHT = did('tw-28');
/** Eye of Sauron — long hazard event, increases automatic-attack prowess (+1, or +3 with Doors of Night). */
export const EYE_OF_SAURON = did('tw-32');
/** Wake of War — long hazard event, boosts Wolf/Spider/Animal attacks (+1 strikes and prowess, +2 for Wolves with Doors of Night). */
export const WAKE_OF_WAR = did('tw-108');
/** Twilight — short hazard event, environment that cancels another environment. May also be played as a resource. */
export const TWILIGHT = did('tw-106');

// ---- Creatures ----

/** Cave-drake — wilderness hazard creature with moderate prowess. */
export const CAVE_DRAKE = did('tw-020');
/** Orc-patrol — shadow-land hazard, common low-prowess roadblock. */
export const ORC_PATROL = did('tw-074');
/** Barrow-wight — undead hazard found near ruins and shadow-lands. */
export const BARROW_WIGHT = did('tw-015');
/** Foolish Words — hazard permanent-event, -4 to influence attempts, revealable on-guard. */
export const FOOLISH_WORDS = did('td-25');

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
/** Eagles' Eyrie — hero free-hold in Anduin Vales, nearest haven Lórien. */
export const EAGLES_EYRIE = did('tw-391');
/** Henneth Annûn — hero border-hold in Ithilien, nearest haven Lórien. */
export const HENNETH_ANNUN = did('tw-400');
/** Old Forest — hero border-hold in Cardolan, nearest haven Rivendell. */
export const OLD_FOREST = did('tw-417');
/** Bag End — hero free-hold in The Shire, nearest haven Rivendell. */
export const BAG_END = did('tw-372');
/** Bree — border-hold in Arthedain, nearest haven Rivendell. */
export const BREE = did('tw-378');
/** Pelargir — hero free-hold in Lebennin, nearest haven Edhellond. */
export const PELARGIR = did('tw-419');
/** Dol Amroth — hero free-hold in Belfalas, nearest haven Edhellond. */
export const DOL_AMROTH = did('tw-386');
/** Thranduil's Halls — hero free-hold in Woodland Realm, nearest haven Lórien. */
export const THRANDUILS_HALLS = did('tw-432');
/** Isengard — hero ruins-and-lairs in Gap of Isen, nearest haven Lórien. */
export const ISENGARD = did('tw-404');
/** Blue Mountain Dwarf-hold — hero free-hold in Númeriador, nearest haven Grey Havens. */
export const BLUE_MOUNTAIN_DWARF_HOLD = did('tw-377');
/** Goblin-gate — hero ruins-and-lairs in High Pass, nearest haven Rivendell. */
export const GOBLIN_GATE = did('tw-398');
/** Dimrill Dale — hero ruins-and-lairs in Redhorn Gate, nearest haven Lórien. */
export const DIMRILL_DALE = did('tw-385');
/** Bandit Lair — hero border-hold in Brown Lands, nearest haven Lórien. */
export const BANDIT_LAIR = did('tw-373');

// ---- Against the Shadow — Hero Sites ----

/** The Worthy Hills — hero ruins-and-lairs in Cardolan, nearest haven Rivendell. */
export const THE_WORTHY_HILLS = did('as-142');

// ---- Regions ----

/** Rhudaur — wilderness region north of Rivendell. */
export const RHUDAUR = did('tw-482');
/** Hollin — wilderness region (Eregion), path toward Moria. */
export const HOLLIN = did('tw-466');
/** Rohan — wilderness region of the horse-lords. */
export const ROHAN = did('tw-483');
/** Ithilien — shadow-land region east of Minas Tirith. */
export const ITHILIEN = did('tw-470');

// ---- Against the Shadow — Minion Characters ----

/** Perchen — man scout/diplomat, +3 DI against factions at Dunnish Clan-hold. */
export const PERCHEN = did('as-4');
/** Mionid — man warrior/ranger, +2 DI against factions at Variag Camp. */
export const MIONID = did('as-3');

// ---- Against the Shadow — Minion Sites ----

/** Weathertop — minion ruins-and-lairs in Arthedain, nearest darkhaven Carn Dûm. */
export const WEATHERTOP = did('as-169');

// ---- The Lidless Eye — Minion Characters ----

/** The Mouth — Sauron's lieutenant, high DI, faction influence specialist. */
export const THE_MOUTH = did('le-24');
/** Lieutenant of Dol Guldur — Olog-hai troll leader, prowess 7, mind 9. */
export const LIEUTENANT_OF_DOL_GULDUR = did('le-21');
/** Gorbag — Uruk-hai orc leader from Minas Morgul, prowess 6. */
export const GORBAG = did('le-11');
/** Shagrat — Uruk-hai orc leader from Cirith Ungol, prowess 6. */
export const SHAGRAT = did('le-39');
/** Adûnaphel the Ringwraith — Ringwraith avatar, warrior/scout/diplomat, spirit-magic. */
export const ADUNAPHEL_THE_RINGWRAITH = did('le-50');

// ---- The Lidless Eye — Minion Resources ----

/** Black Mace — greater item weapon, +3 prowess (+4 vs Elves), warrior only. */
export const BLACK_MACE = did('le-299');
/** High Helm — unique major item helmet, +2 DI, +1 body/prowess. */
export const HIGH_HELM = did('le-313');
/** Saw-toothed Blade — minor item weapon, +1 prowess. */
export const SAW_TOOTHED_BLADE = did('le-342');
/** Orc-draughts — minor item, discard for company-wide +1 prowess. */
export const ORC_DRAUGHTS = did('le-328');
/** Goblins of Goblin-gate — orc faction, playable at Goblin-gate. */
export const GOBLINS_OF_GOBLIN_GATE = did('le-265');
/** The Warg-king — unique ally, cancels Wolf/Animal attacks. */
export const THE_WARG_KING = did('le-158');

// ---- The Lidless Eye — Minion Sites ----

/** Dol Guldur — minion haven in Southern Mirkwood. */
export const DOL_GULDUR = did('le-367');
/** Ettenmoors — minion ruins-and-lairs in Rhudaur, nearest darkhaven Carn Dûm. */
export const ETTENMOORS = did('le-373');
/** Minas Morgul — minion haven in Imlad Morgul. */
export const MINAS_MORGUL = did('le-390');
/** The White Towers (minion) — ruins-and-lairs in Arthedain, nearest darkhaven Carn Dûm. */
export const THE_WHITE_TOWERS_MINION = did('le-412');

// ---- The White Hand — Fallen-wizard Resources ----

/** Hidden Haven — permanent-event, turns a Ruins & Lairs into a Wizardhaven. */
export const HIDDEN_HAVEN = did('wh-75');

/** Thrall of the Voice — permanent-event, forces a character to follow a fallen-wizard. */
export const THRALL_OF_THE_VOICE = did('wh-82');

// ---- The White Hand — Fallen-wizard Sites ----

/** The White Towers — fallen-wizard haven in Arthedain. */
export const THE_WHITE_TOWERS = did('wh-58');

// ---- The Balrog — Balrog Characters ----

/** Azog — orc warrior/diplomat, Leader, Balrog specific, +3 DI vs Orcs. */
export const AZOG = did('ba-2');
/** Bolg — orc warrior/ranger, Leader, Balrog specific, +3 DI vs Orcs. */
export const BOLG = did('ba-4');

// ---- The Balrog — Balrog Sites ----

/** Moria — balrog darkhaven (surface), starting site for balrog players. */
export const MORIA_BALROG = did('ba-93');
/** The Under-gates — balrog darkhaven (Under-deeps), adjacent to Moria. */
export const THE_UNDER_GATES = did('ba-100');

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
