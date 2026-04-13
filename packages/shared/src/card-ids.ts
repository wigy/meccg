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
/** Peath — Man ranger/diplomat, +4 DI vs Dunlendings, +5 prowess vs Nazgûl, halves Nazgûl body. */
export const PEATH = did('tw-176');
/** Balin — dwarf warrior/sage, DI 2, +2 prowess vs Orcs, +1 DI vs Dwarves. */
export const BALIN = did('tw-123');
/** Kíli — dwarf warrior/scout, mind 3, +1 prowess vs Orcs, corruption/faction penalties. */
export const KILI = did('tw-167');
/** Saruman — wizard, scout/ranger/sage/diplomat, DI 10, can use Palantíri. */
export const SARUMAN = did('tw-181');

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
/** Shadowfax — horse ally, prowess 2/body 8, playable at Edoras, enables double movement. */
export const SHADOWFAX = did('tw-326');

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
/** Wake of War — long hazard event, boosts Wolf/Spider/Animal attacks (+1 strikes and prowess, +2 for Wolves with Doors of Night). */
export const WAKE_OF_WAR = did('tw-108');
/** Twilight — short hazard event, environment that cancels another environment. May also be played as a resource. */
export const TWILIGHT = did('tw-106');

// ---- Creatures ----

/** Assassin — men hazard creature, three attacks against one character, keyed to free-holds/border-holds. */
export const ASSASSIN = did('tw-8');
/** Cave-drake — wilderness hazard creature with moderate prowess. */
export const CAVE_DRAKE = did('tw-020');
/** Orc-lieutenant — orc hazard, one strike, prowess 7. */
export const ORC_LIEUTENANT = did('tw-073');
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
/** LE printing of Lure of the Senses (mirror of TW-60). */
export const LURE_OF_THE_SENSES_LE = did('le-124');
/** LE printing of Lost in Free-domains (mirror of TW-53). */
export const LOST_IN_FREE_DOMAINS_LE = did('le-119');
/** LE printing of River (mirror of TW-84). */
export const RIVER_LE = did('le-134');

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
/** Glittering Caves — hero ruins-and-lairs in Gap of Isen, nearest haven Lórien. */
export const GLITTERING_CAVES = did('tw-397');
/** Blue Mountain Dwarf-hold — hero free-hold in Númeriador, nearest haven Grey Havens. */
export const BLUE_MOUNTAIN_DWARF_HOLD = did('tw-377');
/** Goblin-gate — hero ruins-and-lairs in High Pass, nearest haven Rivendell. */
export const GOBLIN_GATE = did('tw-398');
/** Dimrill Dale — hero ruins-and-lairs in Redhorn Gate, nearest haven Lórien. */
export const DIMRILL_DALE = did('tw-385');
/** Bandit Lair — hero border-hold in Brown Lands, nearest haven Lórien. */
export const BANDIT_LAIR = did('tw-373');
/** Dunnish Clan-hold — hero border-hold in Dunland, nearest haven Rivendell. */
export const DUNNISH_CLAN_HOLD = did('tw-390');
/** Wellinghall — hero free-hold in Fangorn, nearest haven Lórien. */
export const WELLINGHALL = did('tw-437');
/** Lond Galen — hero site, free-hold in Anfalas. */
export const LOND_GALEN = did('tw-407');

// ---- Against the Shadow — Hero Sites ----

/** The Worthy Hills — hero ruins-and-lairs in Cardolan, nearest haven Rivendell. */
export const THE_WORTHY_HILLS = did('as-142');

// ---- The Dragons — Hero Sites ----

/** Isle of the Ulond — hero ruins-and-lairs in Andrast Coast, nearest haven Edhellond. */
export const ISLE_OF_THE_ULOND = did('td-178');

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
