"use strict";
(() => {
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };

  // ../shared/src/types/common.ts
  var init_common = __esm({
    "../shared/src/types/common.ts"() {
      "use strict";
    }
  });

  // ../shared/src/types/effects.ts
  var init_effects = __esm({
    "../shared/src/types/effects.ts"() {
      "use strict";
    }
  });

  // ../shared/src/types/cards.ts
  function isCharacterCard(card) {
    return card !== void 0 && CHARACTER_CARD_TYPES.has(card.cardType);
  }
  function isAvatarCharacter(card) {
    return isCharacterCard(card) && card.mind === null;
  }
  function isItemCard(card) {
    return card !== void 0 && ITEM_CARD_TYPES.has(card.cardType);
  }
  function isAllyCard(card) {
    return card !== void 0 && ALLY_CARD_TYPES.has(card.cardType);
  }
  function isFactionCard(card) {
    return card !== void 0 && FACTION_CARD_TYPES.has(card.cardType);
  }
  var CHARACTER_CARD_TYPES, ITEM_CARD_TYPES, ALLY_CARD_TYPES, FACTION_CARD_TYPES;
  var init_cards = __esm({
    "../shared/src/types/cards.ts"() {
      "use strict";
      CHARACTER_CARD_TYPES = /* @__PURE__ */ new Set(["hero-character", "minion-character"]);
      ITEM_CARD_TYPES = /* @__PURE__ */ new Set(["hero-resource-item", "minion-resource-item"]);
      ALLY_CARD_TYPES = /* @__PURE__ */ new Set(["hero-resource-ally", "minion-resource-ally"]);
      FACTION_CARD_TYPES = /* @__PURE__ */ new Set(["hero-resource-faction", "minion-resource-faction"]);
    }
  });

  // ../shared/src/types/state-cards.ts
  var init_state_cards = __esm({
    "../shared/src/types/state-cards.ts"() {
      "use strict";
    }
  });

  // ../shared/src/types/state-player.ts
  var init_state_player = __esm({
    "../shared/src/types/state-player.ts"() {
      "use strict";
    }
  });

  // ../shared/src/types/state-phases.ts
  var init_state_phases = __esm({
    "../shared/src/types/state-phases.ts"() {
      "use strict";
    }
  });

  // ../shared/src/types/state-combat.ts
  var init_state_combat = __esm({
    "../shared/src/types/state-combat.ts"() {
      "use strict";
    }
  });

  // ../shared/src/types/state.ts
  var init_state = __esm({
    "../shared/src/types/state.ts"() {
      "use strict";
      init_state_cards();
      init_state_player();
      init_state_phases();
      init_state_combat();
    }
  });

  // ../shared/src/types/pending.ts
  var init_pending = __esm({
    "../shared/src/types/pending.ts"() {
      "use strict";
    }
  });

  // ../shared/src/types/actions.ts
  var init_actions = __esm({
    "../shared/src/types/actions.ts"() {
      "use strict";
    }
  });

  // ../shared/src/types/phases.ts
  var PHASE_ORDER;
  var init_phases = __esm({
    "../shared/src/types/phases.ts"() {
      "use strict";
      init_state();
      PHASE_ORDER = [
        "untap" /* Untap */,
        "organization" /* Organization */,
        "long-event" /* LongEvent */,
        "movement-hazard" /* MovementHazard */,
        "site" /* Site */,
        "end-of-turn" /* EndOfTurn */
      ];
    }
  });

  // ../shared/src/types/player-view.ts
  var init_player_view = __esm({
    "../shared/src/types/player-view.ts"() {
      "use strict";
    }
  });

  // ../shared/src/types/protocol.ts
  var init_protocol = __esm({
    "../shared/src/types/protocol.ts"() {
      "use strict";
    }
  });

  // ../shared/src/types/index.ts
  var init_types = __esm({
    "../shared/src/types/index.ts"() {
      "use strict";
      init_common();
      init_effects();
      init_cards();
      init_state();
      init_pending();
      init_actions();
      init_phases();
      init_player_view();
      init_protocol();
    }
  });

  // ../shared/src/constants.ts
  var init_constants = __esm({
    "../shared/src/constants.ts"() {
      "use strict";
    }
  });

  // ../shared/src/data/tw-characters.json
  var tw_characters_default;
  var init_tw_characters = __esm({
    "../shared/src/data/tw-characters.json"() {
      tw_characters_default = [
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-156",
          name: "Gandalf",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Gandalf.jpg",
          unique: true,
          race: "wizard",
          skills: [
            "warrior",
            "scout",
            "sage",
            "diplomat"
          ],
          prowess: 6,
          body: 9,
          mind: null,
          directInfluence: 10,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 1,
          homesite: "Any Haven",
          effects: [
            {
              type: "check-modifier",
              check: "corruption",
              value: 1
            },
            {
              type: "grant-action",
              action: "test-gold-ring",
              cost: {
                tap: "self"
              },
              targets: {
                scope: "company-items",
                filter: {
                  subtype: "gold-ring"
                }
              },
              apply: {
                type: "sequence",
                apps: [
                  {
                    type: "roll-check",
                    check: "gold-ring-test",
                    label: "Gold ring test"
                  },
                  {
                    type: "move",
                    select: "target",
                    from: "in-play",
                    to: "discard"
                  }
                ]
              }
            }
          ],
          text: "Unique. +1 to all of his corruption checks. Gandalf may tap to test a gold ring in his company.",
          certified: "2026-04-07"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-120",
          name: "Aragorn II",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/AragornII.jpg",
          unique: true,
          race: "dunadan",
          skills: [
            "warrior",
            "scout",
            "ranger"
          ],
          prowess: 6,
          body: 9,
          mind: 9,
          directInfluence: 3,
          marshallingPoints: 3,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Bree",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Rangers of the North"
              }
            },
            {
              type: "mp-modifier",
              value: -3,
              when: {
                reason: "elimination"
              }
            }
          ],
          text: "Unique. +2 direct influence against the Rangers of the North faction. -3 marshalling points if eliminated.",
          certified: "2026-04-07"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-168",
          name: "Legolas",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Legolas.jpg",
          unique: true,
          race: "elf",
          skills: [
            "warrior",
            "diplomat"
          ],
          prowess: 5,
          body: 8,
          mind: 6,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Thranduil's Halls",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Wood-elves"
              }
            }
          ],
          text: "Unique. +2 direct influence against the Wood-elves faction."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-159",
          name: "Gimli",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Gimli.jpg",
          unique: true,
          race: "dwarf",
          skills: [
            "warrior",
            "diplomat"
          ],
          prowess: 5,
          body: 8,
          mind: 6,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Iron Hill Dwarf-hold",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Iron Hill Dwarves"
              }
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 2,
              when: {
                reason: "combat",
                "enemy.race": "orc"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 1,
              when: {
                reason: "influence-check",
                "target.race": "elf"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 1,
              when: {
                reason: "faction-influence-check",
                "faction.race": "elf"
              }
            }
          ],
          text: "Unique. +2 direct influence against the Iron Hill Dwarves faction, +2 prowess against Orcs. +1 direct influence against Elves and Elf factions."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-152",
          name: "Frodo",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Frodo.jpg",
          unique: true,
          race: "hobbit",
          skills: [
            "scout",
            "diplomat"
          ],
          prowess: 1,
          body: 9,
          mind: 5,
          directInfluence: 1,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 4,
          homesite: "Bag End",
          effects: [
            {
              type: "play-flag",
              flag: "home-site-only",
              when: {
                $not: {
                  reason: "starting-character"
                }
              }
            },
            {
              type: "mp-modifier",
              value: -2,
              when: {
                reason: "elimination"
              }
            }
          ],
          text: "Unique. Unless he is one of the starting characters, he may only be brought into play at his home site. All of his corruption checks are modified by +4. -2 marshalling points if eliminated.",
          certified: "2026-04-07"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-149",
          name: "Faramir",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Faramir.jpg",
          unique: true,
          race: "dunadan",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 5,
          body: 8,
          mind: 5,
          directInfluence: 1,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Henneth Ann\xFBn",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Rangers of Ithilien"
              }
            }
          ],
          text: "Unique. +2 direct influence against the Rangers of Ithilien faction."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-131",
          name: "Bilbo",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Bilbo.jpg",
          unique: true,
          race: "hobbit",
          skills: [
            "scout",
            "sage"
          ],
          prowess: 1,
          body: 9,
          mind: 5,
          directInfluence: 1,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 4,
          homesite: "Bag End",
          certified: "2026-04-07",
          effects: [
            {
              type: "check-modifier",
              check: "corruption",
              value: 4
            },
            {
              type: "play-flag",
              flag: "home-site-only",
              when: {
                $not: {
                  reason: "starting-character"
                }
              }
            },
            {
              type: "mp-modifier",
              value: -2,
              when: {
                reason: "elimination"
              }
            }
          ],
          text: "Unique. Unless he is one of the starting characters, he may only be brought into play at his home site. All of his corruption checks are modified by +4. -2 marshalling points if eliminated."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-180",
          name: "Sam Gamgee",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/SamGamgee.jpg",
          unique: true,
          race: "hobbit",
          skills: [
            "scout",
            "ranger"
          ],
          prowess: 1,
          body: 9,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 3,
          homesite: "Bag End",
          effects: [
            {
              type: "check-modifier",
              check: "corruption",
              value: 3
            },
            {
              type: "play-flag",
              flag: "home-site-only",
              when: {
                $not: {
                  reason: "starting-character"
                }
              }
            }
          ],
          text: "Unique. Unless he is one of the starting characters, he may only be brought into play at his home site. All of his corruption checks are modified by +3.",
          certified: "2026-04-07"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-126",
          name: "Beorn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Beorn.jpg",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 7,
          body: 9,
          mind: 7,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Beorn's House",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Beornings"
              }
            }
          ],
          text: "Unique. +2 direct influence against the Beornings faction."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-182",
          name: "Th\xE9oden",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Theoden.jpg",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "diplomat"
          ],
          prowess: 5,
          body: 6,
          mind: 6,
          directInfluence: 3,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Edoras",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Riders of Rohan"
              }
            }
          ],
          text: "Unique. +2 direct influence against the Riders of Rohan faction.",
          certified: "2026-04-07"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-145",
          name: "Elrond",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Elrond.jpg",
          unique: true,
          race: "elf",
          skills: [
            "warrior",
            "sage",
            "diplomat"
          ],
          prowess: 7,
          body: 9,
          mind: 10,
          directInfluence: 4,
          marshallingPoints: 3,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Rivendell",
          effects: [
            {
              type: "hand-size-modifier",
              value: 1,
              when: {
                "self.location": "Rivendell"
              }
            },
            {
              type: "mp-modifier",
              value: -3,
              when: {
                reason: "elimination"
              }
            }
          ],
          text: "Unique. When Elrond is at Rivendell, you may keep one more card than normal in your hand. -3 marshalling points if eliminated.",
          certified: "2026-04-07"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-161",
          name: "Glorfindel II",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GlorfindelII.jpg",
          unique: true,
          race: "elf",
          skills: [
            "warrior",
            "sage"
          ],
          prowess: 8,
          body: 9,
          mind: 8,
          directInfluence: 2,
          marshallingPoints: 3,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Rivendell",
          certified: "2026-04-01",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 1,
              when: {
                reason: "influence-check",
                "target.race": "elf"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 1,
              when: {
                reason: "faction-influence-check",
                "faction.race": "elf"
              }
            }
          ],
          text: "Unique. +1 direct influence against Elves."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-136",
          name: "Celeborn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Celeborn.jpg",
          unique: true,
          race: "elf",
          skills: [
            "warrior",
            "sage"
          ],
          prowess: 6,
          body: 9,
          mind: 6,
          directInfluence: 1,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "L\xF3rien",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 5,
              when: {
                reason: "influence-check",
                "target.name": "Galadriel"
              }
            }
          ],
          text: "Unique. +5 direct influence that is only usable against Galadriel.",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-147",
          name: "\xC9owyn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Eowyn.jpg",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "scout"
          ],
          prowess: 2,
          body: 7,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Edoras",
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 6,
              when: {
                reason: "combat",
                "enemy.race": "nazgul"
              }
            },
            {
              type: "enemy-modifier",
              stat: "body",
              op: "halve-round-up",
              when: {
                reason: "combat",
                "enemy.race": "nazgul"
              }
            }
          ],
          text: "Unique. Against Nazg\xFBl and Ringwraiths, +6 to her prowess and the Nazg\xFBl/Ringwraith's body is halved (rounded up).",
          certified: "2026-04-07"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-127",
          name: "Beregond",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Beregond.jpg",
          unique: true,
          race: "dunadan",
          skills: [
            "warrior"
          ],
          prowess: 4,
          body: 8,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: -1,
          homesite: "Minas Tirith",
          effects: [
            {
              type: "check-modifier",
              check: "corruption",
              value: -1
            },
            {
              type: "check-modifier",
              check: "influence",
              value: -1
            }
          ],
          certified: "2026-04-07",
          text: "Unique. -1 to all of his corruption checks. -1 to influence checks against factions."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-129",
          name: "Bergil",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Bergil.jpg",
          unique: true,
          race: "dunadan",
          skills: [
            "warrior",
            "scout"
          ],
          prowess: 1,
          body: 9,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Minas Tirith",
          text: "Unique."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-124",
          name: "Bard Bowman",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BardBowman.jpg",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "scout"
          ],
          prowess: 3,
          body: 6,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Lake-town",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Men of Northern Rhovanion"
              }
            }
          ],
          text: "Unique. +2 direct influence against the Men of Northern Rhovanion faction."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-118",
          name: "Anborn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Anborn.jpg",
          unique: true,
          race: "dunadan",
          skills: [
            "scout",
            "ranger"
          ],
          prowess: 2,
          body: 8,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Pelargir",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Men of Lebennin"
              }
            }
          ],
          text: "Unique. +2 direct influence against the Men of Lebennin faction.",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-143",
          name: "Elladan",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Elladan.jpg",
          unique: true,
          race: "elf",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 5,
          body: 8,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Rivendell",
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              when: {
                reason: "combat",
                "enemy.race": "orc"
              }
            }
          ],
          text: "Unique. +1 prowess against Orcs.",
          certified: "2026-04-24"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-116",
          name: "Adrazar",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Adrazar.jpg",
          unique: true,
          race: "dunadan",
          skills: [
            "scout",
            "diplomat"
          ],
          prowess: 3,
          body: 6,
          mind: 3,
          directInfluence: 1,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Dol Amroth",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 1,
              when: {
                reason: "faction-influence-check"
              }
            }
          ],
          text: "Unique. +1 direct influence against all factions.",
          certified: "2026-04-02"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-495",
          name: "Fatty Bolger",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/FattyBolger.jpg",
          unique: true,
          race: "hobbit",
          skills: [
            "scout"
          ],
          prowess: 1,
          body: 8,
          mind: 3,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 1,
          homesite: "Bag End",
          effects: [
            {
              type: "check-modifier",
              check: "corruption",
              value: 1
            },
            {
              type: "play-flag",
              flag: "home-site-only",
              when: {
                $not: {
                  reason: "starting-character"
                }
              }
            },
            {
              type: "cancel-strike",
              cost: {
                tap: "self"
              },
              target: "other-in-company",
              filter: {
                "target.race": "hobbit"
              }
            }
          ],
          text: "Unique. Unless he is one of the starting characters, he may only be brought into play at his home site. All of his corruption checks are modified by +1. He can tap to cancel a strike against another Hobbit in his company.",
          certified: "2026-04-14"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-181",
          name: "Saruman",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Saruman.jpg",
          unique: true,
          race: "wizard",
          skills: [
            "scout",
            "ranger",
            "sage",
            "diplomat"
          ],
          prowess: 6,
          body: 9,
          mind: null,
          directInfluence: 10,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Isengard",
          certified: "2026-04-14",
          effects: [
            {
              type: "grant-action",
              action: "saruman-fetch-spell",
              cost: {
                tap: "self"
              },
              apply: {
                type: "move",
                select: "target",
                from: "discard",
                to: "hand",
                filter: {
                  keywords: { $includes: "spell" }
                }
              }
            }
          ],
          text: "Unique. May tap to use a Palant\xEDr he bears. At the beginning of your end-of-turn phase, you may tap Saruman to take one spell card from your discard pile to your hand."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-178",
          name: "Radagast",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Radagast.jpg",
          unique: true,
          race: "wizard",
          skills: [
            "warrior",
            "scout",
            "ranger",
            "diplomat"
          ],
          prowess: 6,
          body: 9,
          mind: null,
          directInfluence: 10,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 1,
          homesite: "Rhosgobel",
          effects: [
            {
              type: "draw-modifier",
              draw: "resource",
              value: "sitePath.wildernessCount",
              min: 0
            },
            {
              type: "check-modifier",
              check: "corruption",
              value: 1
            }
          ],
          text: "Unique. When Radagast's new site is revealed, he may draw one additional card for each Wilderness in his company's site path. +1 to all of his corruption checks.",
          certified: "2026-04-22"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-123",
          name: "Balin",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Balin.jpg",
          unique: true,
          race: "dwarf",
          skills: [
            "warrior",
            "sage"
          ],
          prowess: 4,
          body: 7,
          mind: 5,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Blue Mountain Dwarf-hold",
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 2,
              when: {
                reason: "combat",
                "enemy.race": "orc"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 1,
              when: {
                reason: "influence-check",
                "target.race": "dwarf"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 1,
              when: {
                reason: "faction-influence-check",
                "faction.race": "dwarf"
              }
            }
          ],
          text: "Unique. +2 prowess against Orcs, +1 direct influence against Dwarves and Dwarf factions.",
          certified: "2026-04-02"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-167",
          name: "K\xEDli",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Kili.jpg",
          unique: true,
          race: "dwarf",
          skills: [
            "warrior",
            "scout"
          ],
          prowess: 3,
          body: 8,
          mind: 3,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: -1,
          homesite: "Blue Mountain Dwarf-hold",
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              when: {
                reason: "combat",
                "enemy.race": "orc"
              }
            },
            {
              type: "check-modifier",
              check: "corruption",
              value: -1
            },
            {
              type: "check-modifier",
              check: "influence",
              value: -1,
              when: {
                reason: "faction-influence-check"
              }
            }
          ],
          text: "Unique. +1 prowess against Orcs. -1 to all of his corruption checks. -1 to influence checks against factions."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-164",
          name: "Haldir",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Haldir.jpg",
          unique: true,
          race: "elf",
          skills: [
            "warrior"
          ],
          prowess: 4,
          body: 8,
          mind: 3,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: -1,
          homesite: "L\xF3rien",
          effects: [
            {
              type: "check-modifier",
              check: "corruption",
              value: -1
            },
            {
              type: "check-modifier",
              check: "influence",
              value: -1
            }
          ],
          text: "Unique. -1 to all of his corruption checks. -1 to influence checks against factions.",
          certified: "2026-04-01"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-176",
          name: "Peath",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Peath.jpg",
          unique: true,
          race: "man",
          skills: [
            "ranger",
            "diplomat"
          ],
          prowess: 4,
          body: 7,
          mind: 4,
          directInfluence: 1,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Dunnish Clan-hold",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 4,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Dunlendings"
              }
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 5,
              when: {
                reason: "combat",
                "enemy.race": "nazgul"
              }
            },
            {
              type: "enemy-modifier",
              stat: "body",
              op: "halve-round-up",
              when: {
                reason: "combat",
                "enemy.race": "nazgul"
              }
            }
          ],
          text: "Unique. +4 direct influence against the Dunlendings faction. Against Nazg\xFBl and Ringwraiths, +5 to her prowess and the Nazg\xFBl/Ringwraith's body is halved (rounded up).",
          certified: "2026-04-08"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-117",
          name: "Alatar",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Alatar.jpg",
          unique: true,
          race: "wizard",
          skills: [
            "warrior",
            "scout",
            "ranger",
            "sage"
          ],
          prowess: 6,
          body: 9,
          mind: null,
          directInfluence: 10,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Edhellond",
          effects: [
            {
              type: "draw-modifier",
              draw: "hazard",
              value: -1,
              min: 0
            },
            {
              type: "on-event",
              event: "creature-attack-begins",
              apply: {
                type: "offer-char-join-attack",
                discardOwnedAllies: true,
                forceStrike: true,
                postAttack: {
                  tapIfUntapped: true,
                  corruptionCheck: {}
                }
              }
            }
          ],
          certified: "2026-04-23",
          text: "Unique. The number of cards your opponent draws based on Alatar's company's movement is reduced by one (to minimum of 0). If at a Haven when a hazard creature attacks one of your companies, he may immediately join that company (discard allies he controls). Alatar must face a strike from that creature (in all cases). Following the attack, Alatar must tap (if untapped) and make a corruption check."
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "tw-153",
          name: "Galadriel",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Galadriel.jpg",
          unique: true,
          race: "elf",
          skills: [
            "scout",
            "sage",
            "diplomat"
          ],
          prowess: 3,
          body: 10,
          mind: 9,
          directInfluence: 4,
          marshallingPoints: 3,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "L\xF3rien",
          effects: [
            {
              type: "hand-size-modifier",
              value: 1,
              when: {
                "self.location": "L\xF3rien"
              }
            },
            {
              type: "mp-modifier",
              value: -3,
              when: {
                reason: "elimination"
              }
            }
          ],
          text: "Unique. When Galadriel is at L\xF3rien, you may keep one more card than normal in your hand. -3 marshalling points if eliminated."
        },
        {
          cardType: "hero-character",
          id: "tw-119",
          name: "Annalena",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Annalena.jpg",
          text: "Unique.",
          alignment: "wizard",
          unique: true,
          race: "elf",
          skills: [
            "scout",
            "sage"
          ],
          prowess: 3,
          body: 8,
          mind: 3,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Edhellond"
        },
        {
          cardType: "hero-character",
          id: "tw-122",
          name: "Arwen",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Arwen.jpg",
          text: "Unique. +7 direct influence only usable against Aragorn II.",
          alignment: "wizard",
          unique: true,
          race: "elf",
          skills: [
            "scout",
            "sage"
          ],
          prowess: 2,
          body: 8,
          mind: 3,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Rivendell"
        },
        {
          cardType: "hero-character",
          id: "tw-128",
          name: "Beretar",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Beretar.jpg",
          text: "Unique. +2 direct influence against the Rangers of the North faction.",
          alignment: "wizard",
          unique: true,
          race: "dunadan",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 5,
          body: 8,
          mind: 5,
          directInfluence: 1,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Bree",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Rangers of the North"
              }
            }
          ],
          certified: "2026-04-24"
        },
        {
          cardType: "hero-character",
          id: "tw-132",
          name: "Bofur",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Bofur.jpg",
          text: "Unique. +1 prowess against Orcs. -1 to all of his corruption checks. -1 to influence checks against factions.",
          alignment: "wizard",
          unique: true,
          race: "dwarf",
          skills: [
            "warrior"
          ],
          prowess: 4,
          body: 7,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: -1,
          homesite: "Blue Mountain Dwarf-hold",
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              when: {
                reason: "combat",
                "enemy.race": "orc"
              }
            },
            {
              type: "check-modifier",
              check: "corruption",
              value: -1
            },
            {
              type: "check-modifier",
              check: "influence",
              value: -1,
              when: {
                reason: "faction-influence-check"
              }
            }
          ],
          certified: "2026-04-24"
        },
        {
          cardType: "hero-character",
          id: "tw-134",
          name: "Boromir II",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BoromirII.jpg",
          text: "Unique. +2 direct influence against the Men of An\xF3rien faction. -1 to all of his corruption checks.",
          alignment: "wizard",
          unique: true,
          race: "dunadan",
          skills: [
            "warrior"
          ],
          prowess: 6,
          body: 7,
          mind: 4,
          directInfluence: 1,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Minas Tirith"
        },
        {
          cardType: "hero-character",
          id: "tw-141",
          name: "Dori",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Dori.jpg",
          text: "Unique. +1 prowess against Orcs. -1 to all of his corruption checks. -1 to influence checks against factions.",
          alignment: "wizard",
          unique: true,
          race: "dwarf",
          skills: [
            "warrior"
          ],
          prowess: 3,
          body: 6,
          mind: 1,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Blue Mountain Dwarf-hold"
        },
        {
          cardType: "hero-character",
          id: "tw-144",
          name: "Elrohir",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Elrohir.jpg",
          text: "Unique. +1 prowess against Orcs.",
          alignment: "wizard",
          unique: true,
          race: "elf",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 5,
          body: 8,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Rivendell",
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              when: {
                reason: "combat",
                "enemy.race": "orc"
              }
            }
          ],
          certified: "2026-04-24"
        },
        {
          cardType: "hero-character",
          id: "tw-148",
          name: "Erkenbrand",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Erkenbrand.jpg",
          text: "Unique. +2 direct influence against the Riders of Rohan faction.",
          alignment: "wizard",
          unique: true,
          race: "man",
          skills: [
            "warrior"
          ],
          prowess: 5,
          body: 6,
          mind: 4,
          directInfluence: 2,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Edoras",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Riders of Rohan"
              }
            }
          ],
          certified: "2026-04-24"
        },
        {
          cardType: "hero-character",
          id: "tw-150",
          name: "F\xEDli",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Fili.jpg",
          text: "Unique. +1 prowess against Orcs. -1 to all of his corruption checks. -1 to influence checks against factions.",
          alignment: "wizard",
          unique: true,
          race: "dwarf",
          skills: [
            "warrior",
            "scout"
          ],
          prowess: 2,
          body: 8,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Blue Mountain Dwarf-hold"
        },
        {
          cardType: "hero-character",
          id: "tw-151",
          name: "Forlong",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Forlong.jpg",
          text: "Unique. -1 to all of his corruption checks. -1 to influence checks against factions.",
          alignment: "wizard",
          unique: true,
          race: "dunadan",
          skills: [
            "warrior"
          ],
          prowess: 3,
          body: 7,
          mind: 1,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Minas Tirith"
        },
        {
          cardType: "hero-character",
          id: "tw-158",
          name: "Gildor Inglorion",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GildorInglorion.jpg",
          text: "Unique. +2 prowess against Orcs.",
          alignment: "wizard",
          unique: true,
          race: "elf",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 5,
          body: 7,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Rivendell",
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 2,
              when: {
                reason: "combat",
                "enemy.race": "orc"
              }
            }
          ],
          certified: "2026-04-24"
        },
        {
          cardType: "hero-character",
          id: "tw-160",
          name: "Gl\xF3in",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Gloin.jpg",
          text: "Unique. +2 direct influence against the Blue Mountain Dwarves faction, +1 prowess against Orcs. +1 direct influence against Dwarves and Dwarf factions.",
          alignment: "wizard",
          unique: true,
          race: "dwarf",
          skills: [
            "warrior",
            "diplomat"
          ],
          prowess: 5,
          body: 7,
          mind: 5,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Blue Mountain Dwarf-hold"
        },
        {
          cardType: "hero-character",
          id: "tw-162",
          name: "Halbarad",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Halbarad.jpg",
          text: "Unique. +2 direct influence against the Hillmen faction.",
          alignment: "wizard",
          unique: true,
          race: "dunadan",
          skills: [
            "sage",
            "diplomat"
          ],
          prowess: 0,
          body: 5,
          mind: 1,
          directInfluence: 1,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Cameth Brin"
        },
        {
          cardType: "hero-character",
          id: "tw-165",
          name: "H\xE1ma",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Hama.jpg",
          text: "Unique. -1 to all of his corruption checks. -1 to influence checks against factions.",
          alignment: "wizard",
          unique: true,
          race: "man",
          skills: [
            "warrior"
          ],
          prowess: 4,
          body: 8,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Edoras"
        },
        {
          cardType: "hero-character",
          id: "tw-166",
          name: "Imrahil",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Imrahil.jpg",
          text: "Unique. +2 direct influence against the Knights of Dol Amroth faction.",
          alignment: "wizard",
          unique: true,
          race: "dunadan",
          skills: [
            "warrior",
            "diplomat"
          ],
          prowess: 5,
          body: 8,
          mind: 6,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Dol Amroth"
        },
        {
          cardType: "hero-character",
          id: "tw-172",
          name: "\xD3in",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Oin.jpg",
          text: "Unique. +1 prowess against Orcs. -1 to all of his corruption checks.",
          alignment: "wizard",
          unique: true,
          race: "dwarf",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 3,
          body: 8,
          mind: 3,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Blue Mountain Dwarf-hold"
        },
        {
          cardType: "hero-character",
          id: "tw-174",
          name: "Orophin",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Orophin.jpg",
          text: "Unique. -1 to all of his corruption checks. -1 to influence checks against factions.",
          alignment: "wizard",
          unique: true,
          race: "elf",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 2,
          body: 7,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: -1,
          homesite: "L\xF3rien",
          effects: [
            { type: "check-modifier", check: "corruption", value: -1 },
            { type: "check-modifier", check: "influence", value: -1 }
          ],
          certified: "2026-04-24"
        },
        {
          cardType: "hero-character",
          id: "tw-175",
          name: "Pallando",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Pallando.jpg",
          text: "Unique. You may keep one more card than normal in your hand. Opponent must discard his cards face-up.",
          alignment: "wizard",
          unique: true,
          race: "wizard",
          skills: [
            "warrior",
            "ranger",
            "sage",
            "diplomat"
          ],
          prowess: 6,
          body: 9,
          mind: null,
          directInfluence: 10,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Grey Havens"
        },
        {
          cardType: "hero-character",
          id: "tw-183",
          name: "Thorin II",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/ThorinII.jpg",
          text: "Unique. +2 direct influence against the Blue Mountain Dwarves faction. +3 prowess against Orcs. +2 direct influence against Dwarves and Dwarf factions.",
          alignment: "wizard",
          unique: true,
          race: "dwarf",
          skills: [
            "warrior",
            "scout",
            "diplomat"
          ],
          prowess: 5,
          body: 8,
          mind: 8,
          directInfluence: 2,
          marshallingPoints: 3,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Blue Mountain Dwarf-hold"
        },
        {
          cardType: "hero-character",
          id: "tw-184",
          name: "Thranduil",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Thranduil.jpg",
          text: "Unique. +2 direct influence against the Wood-elves faction.",
          alignment: "wizard",
          unique: true,
          race: "elf",
          skills: [
            "warrior",
            "ranger",
            "sage"
          ],
          prowess: 7,
          body: 8,
          mind: 9,
          directInfluence: 3,
          marshallingPoints: 3,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Thranduil\u2019s Halls"
        }
      ];
    }
  });

  // ../shared/src/data/tw-items.json
  var tw_items_default;
  var init_tw_items = __esm({
    "../shared/src/data/tw-items.json"() {
      tw_items_default = [
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-244",
          name: "Glamdring",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Glamdring.jpg",
          unique: true,
          subtype: "major",
          keywords: [
            "weapon"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 3,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 3,
              max: 8,
              id: "glamdring-prowess"
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 3,
              max: 9,
              overrides: "glamdring-prowess",
              when: {
                reason: "combat",
                "enemy.race": "orc"
              }
            }
          ],
          text: "Unique. Weapon. +3 to prowess to a maximum of 8 (a maximum of 9 against Orcs).",
          certified: "2026-04-07"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-333",
          name: "Sting",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Sting.jpg",
          unique: true,
          subtype: "minor",
          keywords: [
            "weapon"
          ],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 1,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              max: 8,
              id: "sting-prowess"
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 2,
              max: 8,
              overrides: "sting-prowess",
              when: {
                "bearer.race": "hobbit"
              }
            }
          ],
          text: "Unique. Weapon. +1 to prowess to a maximum of 8, +2 to a Hobbit's prowess to a maximum of 8."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-347",
          name: "The One Ring",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TheOneRing.jpg",
          unique: true,
          subtype: "special",
          marshallingPoints: 6,
          marshallingCategory: "item",
          corruptionPoints: 6,
          prowessModifier: 5,
          bodyModifier: 5,
          playableAt: [],
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 5,
              max: "bearer.baseProwess * 2"
            },
            {
              type: "stat-modifier",
              stat: "body",
              value: 5,
              max: 10
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 5
            },
            {
              type: "company-modifier",
              stat: "corruption-points",
              value: 1
            },
            {
              type: "cancel-strike",
              cost: {
                check: "corruption",
                modifier: -2
              },
              when: {
                $not: {
                  $or: [
                    {
                      "enemy.race": "undead"
                    },
                    {
                      "enemy.race": "nazgul"
                    }
                  ]
                }
              }
            }
          ],
          text: "Unique. The One Ring. Playable only with a Gold Ring and after a test indicates The One Ring. +5 prowess (to a maximum of double the bearer's starting prowess). +5 to body (to a maximum of 10). +5 to direct influence. Bearer may make a corruption check modified by -2 to cancel a strike against himself; this does not work against Undead and Nazg\xFBl strikes. +1 corruption point to every character in the bearer's company.",
          keywords: [
            "ring"
          ]
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-345",
          name: "The Mithril-coat",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TheMithrilcoat.jpg",
          unique: true,
          subtype: "greater",
          keywords: [
            "armor"
          ],
          marshallingPoints: 4,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 3,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "body",
              value: 3,
              max: 10
            }
          ],
          text: "Unique. Armor. +3 to body (to a maximum of 10).",
          certified: "2026-04-07"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-206",
          name: "Dagger of Westernesse",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/DaggerofWesternesse.jpg",
          unique: false,
          subtype: "minor",
          keywords: [
            "weapon"
          ],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 1,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              max: 8
            }
          ],
          text: "Weapon. +1 to prowess to a maximum of 8.",
          certified: "2026-04-07"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-259",
          name: "Horn of Anor",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/HornofAnor.jpg",
          unique: false,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check"
              }
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            }
          ],
          text: "+2 to direct influence against factions. Cannot be duplicated on a given character.",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-254",
          name: "Hauberk of Bright Mail",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/HauberkofBrightMail.jpg",
          unique: false,
          subtype: "major",
          keywords: [
            "armor"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "body",
              value: 2,
              max: 9,
              when: {
                "bearer.skills": {
                  $includes: "warrior"
                }
              }
            }
          ],
          text: "Unique. Armor. Warrior only: +2 to body to a maximum of 9.",
          certified: "2026-04-13"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-300",
          name: "Palant\xEDr of Orthanc",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/PalantirofOrthanc.jpg",
          unique: true,
          subtype: "special",
          keywords: [
            "palantir"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              sites: [
                "Isengard"
              ]
            },
            {
              type: "grant-action",
              action: "palantir-fetch-discard",
              cost: {
                tap: "self"
              },
              when: {
                $and: [
                  {
                    "bearer.canUsePalantir": true
                  },
                  {
                    "player.playDeckSize": {
                      $gte: 5
                    }
                  }
                ]
              },
              apply: {
                type: "enqueue-pending-fetch",
                fetchFrom: [
                  "discard-pile"
                ],
                fetchCount: 1,
                fetchShuffle: true,
                postCorruptionCheck: true
              }
            }
          ],
          text: "Unique. Palant\xEDr. Playable only at Isengard. With its bearer able to use a Palant\xEDr and with at least 5 cards in your play deck, tap Palant\xEDr of Orthanc to choose one card from your discard pile to place in your play deck (reshuffle the play deck). Bearer makes a corruption check. This item does not give MPs to a Fallen-wizard regardless of other cards in play.",
          certified: "2026-04-13"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-322",
          name: "Sapling of the White Tree",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/SaplingoftheWhiteTree.jpg",
          unique: false,
          subtype: "major",
          marshallingPoints: 1,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs"
          ],
          effects: [
            {
              type: "storable-at",
              sites: [
                "Minas Tirith"
              ],
              marshallingPoints: 2
            }
          ],
          text: "Not playable in a Shadow-hold or Dark-hold. May be stored at Minas Tirith. 2 marshalling points if stored at Minas Tirith.",
          certified: "2026-04-13"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-323",
          name: "Scroll of Isildur",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/ScrollofIsildur.jpg",
          unique: true,
          subtype: "greater",
          marshallingPoints: 4,
          marshallingCategory: "item",
          corruptionPoints: 3,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold"
          ],
          effects: [
            {
              type: "check-modifier",
              check: "gold-ring-test",
              value: 2
            }
          ],
          certified: "2026-04-13",
          text: "Unique. When a gold ring is tested in a company with the Scroll of Isildur, the result of the roll is modified by +2."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-306",
          name: "Precious Gold Ring",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/PreciousGoldRing.jpg",
          unique: false,
          subtype: "gold-ring",
          keywords: [
            "ring"
          ],
          marshallingPoints: 1,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold",
            "free-hold",
            "border-hold"
          ],
          effects: [],
          text: "Discard Precious Gold Ring when tested. If tested, make a roll to determine which ring card may be immediately played: The One Ring (10,11,12+); a Dwarven ring (8,9,10,11,12+); a Magic Ring (1,2,3,4,5); a Lesser Ring (any result)."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "tw-313",
          name: "Red Book of Westmarch",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/RedBookofWestmarch.jpg",
          unique: true,
          subtype: "special",
          keywords: [],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              sites: [
                "Bag End"
              ]
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "influence-check",
                "target.race": "hobbit"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.race": "hobbit"
              }
            },
            {
              type: "storable-at",
              siteTypes: [
                "haven"
              ],
              marshallingPoints: 1
            }
          ],
          text: "Unique. Only playable at Bag End. +2 to direct influence against a Hobbit character or faction. 1 marshalling point if stored at a Haven [{H}].",
          certified: "2026-04-23"
        },
        {
          cardType: "hero-resource-item",
          id: "tw-196",
          name: "Beautiful Gold Ring",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BeautifulGoldRing.jpg",
          text: "Discard Beautiful Gold Ring when tested. If tested, make a roll to determine which ring card may be immediately played: \u2022 The One Ring (12+); \u2022 a Dwarven Ring (10,11,12+); \u2022 a Magic Ring (1,2,3,4,5,6,7); \u2022 a Lesser Ring (any result).",
          alignment: "wizard",
          unique: false,
          subtype: "gold-ring",
          marshallingPoints: 1,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          keywords: [
            "ring"
          ]
        },
        {
          cardType: "hero-resource-item",
          id: "tw-201",
          name: "Book of Mazarbul",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BookofMazarbul.jpg",
          text: "Unique. Only playable at Moria. May be stored at a Dwarf-hold for 5 marshalling points. If its bearer is a sage, tap Book of Mazarbul during your organization phase to increase your hand size by 1 until your next untap phase.",
          alignment: "wizard",
          unique: true,
          subtype: "special",
          marshallingPoints: 1,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              sites: [
                "Moria"
              ]
            },
            {
              type: "storable-at",
              sites: [
                "Blue Mountain Dwarf-hold",
                "Iron Hill Dwarf-hold"
              ],
              marshallingPoints: 5
            },
            {
              type: "grant-action",
              action: "book-of-mazarbul-hand-boost",
              cost: {
                tap: "self"
              },
              when: {
                "bearer.skills": {
                  $includes: "sage"
                }
              },
              apply: {
                type: "add-constraint",
                constraint: "hand-size-modifier",
                scope: "turn",
                target: "player",
                value: 1
              }
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hero-resource-item",
          id: "tw-212",
          name: "Durin\u2019s Axe",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/DurinsAxe.jpg",
          text: "Unique. Weapon. +2 prowess (+4 if held by a Dwarf) to a maximum of 9. If held by a Dwarf, 4 marshalling points and 3 corruption points.",
          alignment: "wizard",
          unique: true,
          subtype: "major",
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "hero-resource-item",
          id: "tw-224",
          name: "Elf-stone",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Elfstone.jpg",
          text: "+2 to direct influence used against an Elf character or an Elf faction. Cannot be duplicated on a given character.",
          alignment: "wizard",
          unique: false,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "hero-resource-item",
          id: "tw-250",
          name: "Great-shield of Rohan",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GreatshieldofRohan.jpg",
          text: "Unique. Shield. +2 to body to a maximum of 9. Warrior only: tap Great Shield of Rohan to remain untapped against one strike (unless the bearer is wounded by the strike).",
          alignment: "wizard",
          unique: true,
          subtype: "major",
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "stat-modifier",
              stat: "body",
              value: 2,
              max: 9
            },
            {
              type: "cancel-strike",
              cost: {
                tap: "self"
              },
              when: {
                "bearer.skills": {
                  $includes: "warrior"
                }
              }
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hero-resource-item",
          id: "tw-266",
          name: "Lesser Ring",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/LesserRing.jpg",
          text: "Lesser Ring. Playable only with a gold ring and after a test indicates Lesser Ring. +2 to direct influence.",
          alignment: "wizard",
          unique: false,
          subtype: "special",
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          keywords: [
            "ring"
          ]
        },
        {
          cardType: "hero-resource-item",
          id: "tw-274",
          name: "Magic Ring of Stealth",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MagicRingofStealth.jpg",
          text: "Magic Ring. Playable only with a gold ring and after a test indicates a Magic Ring. Gives the bearer scout skill. If the bearer is already a scout, he may tap the Magic Ring of Stealth to cancel a strike directed against him. Cannot be duplicated on a given character.",
          alignment: "wizard",
          unique: false,
          subtype: "special",
          marshallingPoints: 3,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          keywords: [
            "ring"
          ]
        },
        {
          cardType: "hero-resource-item",
          id: "tw-289",
          name: "Narsil",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Narsil.jpg",
          text: "Unique. Weapon. +1 to prowess and direct influence.",
          alignment: "wizard",
          unique: true,
          subtype: "greater",
          marshallingPoints: 3,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "hero-resource-item",
          id: "tw-295",
          name: "Orcrist",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Orcrist.jpg",
          text: "Unique. Weapon. +3 to prowess to a maximum of 9 (+4 prowess to a maximum of 10 against Orcs).",
          alignment: "wizard",
          unique: true,
          subtype: "greater",
          keywords: [
            "weapon"
          ],
          marshallingPoints: 4,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 3,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 3,
              max: 9,
              id: "orcrist-prowess"
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 4,
              max: 10,
              overrides: "orcrist-prowess",
              when: {
                reason: "combat",
                "enemy.race": "orc"
              }
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hero-resource-item",
          id: "tw-327",
          name: "Shield of Iron-bound Ash",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/ShieldofIronboundAsh.jpg",
          text: "Shield. +1 to body to a maximum of 8. Tap Shield of Iron-bound Ash to gain +1 prowess against one strike.",
          alignment: "wizard",
          unique: false,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          keywords: [
            "shield"
          ],
          certified: "2026-04-24",
          effects: [
            {
              type: "stat-modifier",
              stat: "body",
              value: 1,
              max: 8
            },
            {
              type: "item-tap-strike-bonus",
              cost: {
                tap: "self"
              },
              prowessBonus: 1
            }
          ]
        },
        {
          cardType: "hero-resource-item",
          id: "tw-330",
          name: "Star-glass",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Starglass.jpg",
          text: "Tap bearer of Star-glass to cancel an Undead attack against his company or to modify the prowess of a Spiders, Animals, or Wolves attack against his company by -2. Bearer makes a corruption check.",
          alignment: "wizard",
          unique: false,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "hero-resource-item",
          id: "tw-336",
          name: "Sword of Gondolin",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/SwordofGondolin.jpg",
          text: "Weapon. Warrior only: +2 to prowess to a maximum of 8.",
          alignment: "wizard",
          unique: false,
          subtype: "major",
          keywords: [
            "weapon"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 2,
              max: 8,
              when: {
                "bearer.skills": {
                  $includes: "warrior"
                }
              }
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hero-resource-item",
          id: "tw-351",
          name: "Torque of Hues",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TorqueofHues.jpg",
          text: "Unique. Tap Torque of Hues and its bearer to cancel an attack against his company. Bearer makes a corruption check.",
          alignment: "wizard",
          unique: true,
          subtype: "major",
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "hero-resource-item",
          id: "tw-494",
          name: "Black Arrow",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BlackArrow.jpg",
          text: "Warrior only: Tap Black Arrow to give -1 to the prowess and body of any one attack against bearer's company. When Black Arrow is tapped, discard it if its bearer is not a Man.",
          alignment: "wizard",
          unique: false,
          subtype: "minor",
          keywords: [
            "weapon"
          ],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold"
          ],
          effects: [
            {
              type: "modify-attack",
              cost: {
                tap: "self"
              },
              prowessModifier: -1,
              bodyModifier: -1,
              when: {
                "bearer.skills": {
                  $includes: "warrior"
                }
              },
              discardIfBearerNot: {
                race: [
                  "man"
                ]
              }
            }
          ],
          certified: "2026-04-22"
        }
      ];
    }
  });

  // ../shared/src/data/tw-creatures.json
  var tw_creatures_default;
  var init_tw_creatures = __esm({
    "../shared/src/data/tw-creatures.json"() {
      tw_creatures_default = [
        {
          cardType: "hazard-creature",
          id: "tw-020",
          name: "Cave-drake",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Cavedrake.jpg",
          unique: false,
          strikes: 2,
          prowess: 10,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "wilderness",
                "wilderness"
              ],
              siteTypes: [
                "ruins-and-lairs"
              ]
            }
          ],
          effects: [
            {
              type: "combat-attacker-chooses-defenders"
            }
          ],
          text: "Dragon. Two strikes. Attacker chooses defending characters.",
          race: "dragon",
          certified: "2026-04-06"
        },
        {
          cardType: "hazard-creature",
          id: "tw-074",
          name: "Orc-patrol",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Orcpatrol.jpg",
          unique: false,
          strikes: 3,
          prowess: 6,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "wilderness",
                "shadow",
                "dark"
              ],
              siteTypes: [
                "ruins-and-lairs",
                "shadow-hold",
                "dark-hold"
              ]
            }
          ],
          text: "Orcs. Three strikes.",
          race: "orc",
          certified: "2026-04-06"
        },
        {
          cardType: "hazard-creature",
          id: "tw-015",
          name: "Barrow-wight",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Barrowwight.jpg",
          unique: false,
          strikes: 1,
          prowess: 12,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "shadow",
                "dark"
              ],
              siteTypes: [
                "shadow-hold",
                "dark-hold"
              ]
            }
          ],
          effects: [
            {
              type: "on-event",
              event: "character-wounded-by-self",
              apply: {
                type: "force-check",
                check: "corruption",
                modifier: -2
              },
              target: "wounded-character"
            }
          ],
          text: "Undead. One strike. After the attack, each character wounded by Barrow-wight makes a corruption check modified by -2.",
          race: "undead",
          certified: "2026-04-06"
        },
        {
          cardType: "hazard-creature",
          id: "tw-016",
          name: "Bert (Burat)",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BertBurat.jpg",
          unique: true,
          strikes: 1,
          prowess: 12,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "wilderness",
                "shadow"
              ],
              siteTypes: [
                "shadow-hold"
              ]
            }
          ],
          effects: [
            {
              type: "on-event",
              event: "character-wounded-by-self",
              apply: {
                type: "move",
                select: "filter-all",
                from: "items-on-wounded",
                to: "discard",
                toOwner: "defender",
                filter: { subtype: { $ne: "special" } }
              },
              target: "wounded-character",
              when: {
                $or: [
                  {
                    "company.hazardsEncountered": {
                      $includes: "William (Wuluag)"
                    }
                  },
                  {
                    "company.hazardsEncountered": {
                      $includes: "Tom (Tuma)"
                    }
                  }
                ]
              }
            }
          ],
          text: 'Unique. Troll. One strike. If played against a company that faced "William" or "Tom" this turn, each character wounded by "Bert" discards all non-special items he bears.',
          race: "troll",
          certified: "2026-04-12"
        },
        {
          cardType: "hazard-creature",
          id: "tw-072",
          name: "Orc-guard",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Orcguard.jpg",
          unique: false,
          strikes: 5,
          prowess: 8,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "shadow",
                "dark"
              ],
              siteTypes: [
                "shadow-hold",
                "dark-hold"
              ]
            }
          ],
          text: "Orcs. Five strikes.",
          race: "orc",
          certified: "2026-04-14"
        },
        {
          cardType: "hazard-creature",
          id: "tw-073",
          name: "Orc-lieutenant",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Orclieutenant.jpg",
          unique: false,
          strikes: 1,
          prowess: 7,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "wilderness",
                "shadow",
                "dark"
              ],
              siteTypes: [
                "ruins-and-lairs",
                "shadow-hold",
                "dark-hold"
              ]
            }
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 4,
              when: {
                "company.facedRaces": {
                  $includes: "orc"
                }
              }
            }
          ],
          text: "Orcs. One strike. If played on a company that has already faced an Orc attack this turn, Orc-lieutenant receives +4 prowess.",
          race: "orc",
          certified: "2026-04-14"
        },
        {
          cardType: "hazard-creature",
          id: "tw-076",
          name: "Orc-warband",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Orcwarband.jpg",
          unique: false,
          strikes: 5,
          prowess: 4,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "wilderness",
                "shadow",
                "dark"
              ],
              siteTypes: [
                "ruins-and-lairs",
                "shadow-hold",
                "dark-hold"
              ]
            }
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 3,
              when: {
                "company.facedRaces": {
                  $includes: "orc"
                }
              }
            }
          ],
          text: "Orcs. Five strikes. If played on a company that has already faced an Orc attack this turn, Orc-warband receives +3 prowess.",
          race: "orc",
          certified: "2026-04-14"
        },
        {
          cardType: "hazard-creature",
          id: "tw-078",
          name: "Orc-watch",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Orcwatch.jpg",
          unique: false,
          strikes: 3,
          prowess: 9,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "shadow",
                "dark"
              ],
              siteTypes: [
                "shadow-hold",
                "dark-hold"
              ]
            }
          ],
          certified: "2026-04-14",
          text: "Orcs. Three strikes.",
          race: "orc"
        },
        {
          cardType: "hazard-creature",
          id: "tw-103",
          name: "Tom (Tuma)",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TomTuma.jpg",
          unique: true,
          strikes: 1,
          prowess: 13,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "wilderness",
                "wilderness"
              ]
            }
          ],
          effects: [
            {
              type: "on-event",
              event: "character-wounded-by-self",
              apply: {
                type: "move",
                select: "filter-all",
                from: "items-on-wounded",
                to: "discard",
                toOwner: "defender",
                filter: { subtype: { $ne: "special" } }
              },
              target: "wounded-character",
              when: {
                $or: [
                  {
                    "company.hazardsEncountered": {
                      $includes: "Bert (Burat)"
                    }
                  },
                  {
                    "company.hazardsEncountered": {
                      $includes: "William (Wuluag)"
                    }
                  }
                ]
              }
            }
          ],
          text: 'Unique. Troll. One strike. If played against a company that faced "Bert" or "William" this turn, each character wounded by "Tom" discards all non-special items he bears.',
          race: "troll",
          certified: "2026-04-13"
        },
        {
          cardType: "hazard-creature",
          id: "tw-112",
          name: "William (Wuluag)",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/WilliamWuluag.jpg",
          unique: true,
          strikes: 1,
          prowess: 11,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "wilderness",
                "shadow",
                "dark"
              ],
              siteTypes: [
                "shadow-hold",
                "dark-hold"
              ]
            }
          ],
          effects: [
            {
              type: "on-event",
              event: "character-wounded-by-self",
              apply: {
                type: "move",
                select: "filter-all",
                from: "items-on-wounded",
                to: "discard",
                toOwner: "defender",
                filter: { subtype: { $ne: "special" } }
              },
              target: "wounded-character",
              when: {
                $or: [
                  {
                    "company.hazardsEncountered": {
                      $includes: "Bert (Burat)"
                    }
                  },
                  {
                    "company.hazardsEncountered": {
                      $includes: "Tom (Tuma)"
                    }
                  }
                ]
              }
            }
          ],
          text: 'Unique. Troll. One strike. If played against a company that faced "Bert" or "Tom" this turn, each character wounded by "William" discards all non-special items he bears.',
          race: "troll",
          certified: "2026-04-13"
        },
        {
          cardType: "hazard-creature",
          id: "tw-8",
          name: "Assassin",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Assassin.jpg",
          unique: false,
          strikes: 1,
          prowess: 11,
          body: null,
          killMarshallingPoints: 2,
          race: "men",
          keyedTo: [
            {
              siteTypes: [
                "free-hold",
                "border-hold"
              ]
            }
          ],
          effects: [
            {
              type: "combat-attacker-chooses-defenders"
            },
            {
              type: "combat-multi-attack",
              count: 3
            },
            {
              type: "combat-cancel-attack-by-tap",
              maxCancels: 2
            }
          ],
          text: "Man. Three attacks (of one strike each) all against the same character. Attacker chooses defending character.One or two of these attacks may be canceled by tapping one character (not the defending character) in the defender\u2019s company for each attack canceled. This may be done even after a strike is assigned and after facing another attack.If an attack from Assassin is given more than one strike, each additional strike becomes an excess strike (-1 prowess modification) against the attacked character.",
          certified: "2026-04-08"
        },
        {
          cardType: "hazard-creature",
          id: "tw-3",
          name: "Agburanar",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Agburanar.jpg",
          unique: true,
          strikes: 2,
          prowess: 15,
          body: 9,
          killMarshallingPoints: 4,
          race: "dragon",
          keyedTo: [],
          effects: [],
          text: "Unique. May be played at Caves of \xDBlund. Dragon. Two strikes. If Doors of Night is in play, may also be played keyed to Grey Mountain Narrows, Iron Hills, Northern Rhovanion, and Withered Heath; and may also be played at sites in these regions.",
          manifestId: "tw-3"
        },
        {
          cardType: "hazard-creature",
          id: "tw-26",
          name: "Daelomin",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Daelomin.jpg",
          unique: true,
          strikes: 3,
          prowess: 13,
          body: 8,
          killMarshallingPoints: 4,
          race: "dragon",
          keyedTo: [],
          effects: [],
          text: "Unique. May be played at Dancing Spire. Dragon. Three strikes. Attacker chooses defending characters. If Doors of Night is in play, may also be played keyed to Grey Mountain Narrows, Iron Hills, Northern Rhovanion, and Withered Heath; and may also be played at sites in these regions.",
          manifestId: "tw-26"
        },
        {
          cardType: "hazard-creature",
          id: "tw-48",
          name: "Leucaruth",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Leucaruth.jpg",
          unique: true,
          strikes: 2,
          prowess: 16,
          body: 8,
          killMarshallingPoints: 4,
          race: "dragon",
          keyedTo: [],
          effects: [],
          text: "Unique. May be played at Irerock. Dragon. Two strikes. If Doors of Night is in play, may also be played keyed to Grey Mountain Narrows, Iron Hills, Northern Rhovanion, and Withered Heath; and may also be played at sites in these regions.",
          manifestId: "tw-48"
        },
        {
          cardType: "hazard-creature",
          id: "tw-90",
          name: "Smaug",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Smaug.jpg",
          unique: true,
          strikes: 2,
          prowess: 17,
          body: 8,
          killMarshallingPoints: 5,
          race: "dragon",
          keyedTo: [
            {
              siteNames: ["The Lonely Mountain"]
            },
            {
              regionNames: [
                "Grey Mountain Narrows",
                "Iron Hills",
                "Northern Rhovanion",
                "Withered Heath"
              ],
              when: { inPlay: "Doors of Night" }
            }
          ],
          effects: [
            {
              type: "combat-attacker-chooses-defenders"
            }
          ],
          text: "Unique. May be played at The Lonely Mountain. Dragon. Two strikes. Attacker chooses defending characters. If Doors of Night is in play, may also be played keyed to Grey Mountain Narrows, Iron Hills, Northern Rhovanion, and Withered Heath; and may also be played at sites in these regions.",
          manifestId: "tw-90",
          certified: "2026-04-22"
        },
        {
          cardType: "hazard-creature",
          id: "tw-1",
          name: "Abductor",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Abductor.jpg",
          text: "Man. One Strike. Each non-Wizard/non-Ringwraith defending character wounded by the Abductor is discarded.",
          unique: false,
          strikes: 1,
          prowess: 10,
          body: null,
          killMarshallingPoints: 1,
          race: "men",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "tw-109",
          name: "Wargs",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Wargs.jpg",
          text: "Wolves. Two strikes.",
          unique: false,
          strikes: 2,
          prowess: 9,
          body: null,
          killMarshallingPoints: 1,
          race: "wolves",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "tw-110",
          name: "Watcher in the Water",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/WatcherintheWater.jpg",
          text: "Animal. Each character in the company faces one strike. May also be played at Moria.",
          unique: false,
          strikes: 1,
          prowess: 8,
          body: null,
          killMarshallingPoints: 1,
          race: "animals",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "tw-114",
          name: "Wolves",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Wolves.jpg",
          text: "Wolves. Three strikes.",
          unique: false,
          strikes: 3,
          prowess: 8,
          body: null,
          killMarshallingPoints: 1,
          race: "wolves",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "tw-17",
          name: "Brigands",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Brigands.jpg",
          text: "Men. Two strikes. If any strike of Brigands wounds a character, the company must immediately discard one item (of defender\u2019s choice).",
          unique: false,
          strikes: 2,
          prowess: 8,
          body: null,
          killMarshallingPoints: 1,
          race: "men",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "tw-23",
          name: "Corpse-candle",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Corpsecandle.jpg",
          text: "Undead. One strike. If this attack is not canceled, every character in the company makes a corruption check before defending characters are selected.",
          unique: false,
          strikes: 1,
          prowess: 7,
          body: null,
          killMarshallingPoints: 1,
          race: "undead",
          keyedTo: [
            { regionTypes: ["wilderness", "shadow", "dark"] },
            { siteTypes: ["shadow-hold", "dark-hold"] }
          ],
          effects: [
            {
              type: "on-event",
              event: "creature-attack-begins",
              apply: {
                type: "force-check-all-company",
                check: "corruption"
              }
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hazard-creature",
          id: "tw-24",
          name: "Corsairs of Umbar",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/CorsairsofUmbar.jpg",
          text: "Men. Five strikes. May also be played keyed to Andrast, Anfalas, Belfalas, Cardolan, Enedhwaith, Harondor, Lindon, Lebennin, and Old P\xFBkel-land; and may also be played at Ruins & Lairs [{R}] and Shadow-holds [{S}] in these regions. May also be played at any site in Elven Shores, Eriadoran Coast, Andrast Coast, Bay of Belfalas, or Mouths of the Anduin.",
          unique: false,
          strikes: 5,
          prowess: 9,
          body: null,
          killMarshallingPoints: 1,
          race: "men",
          keyedTo: [
            {
              regionTypes: ["coastal"]
            },
            {
              regionNames: [
                "Andrast",
                "Anfalas",
                "Belfalas",
                "Cardolan",
                "Enedhwaith",
                "Harondor",
                "Lindon",
                "Lebennin",
                "Old P\xFBkel-land"
              ]
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hazard-creature",
          id: "tw-37",
          name: "Ghosts",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Ghosts.jpg",
          text: "Undead. Three strikes. After attack, each character wounded by Ghosts makes a corruption check modified by -1.",
          unique: false,
          strikes: 3,
          prowess: 9,
          body: null,
          killMarshallingPoints: 1,
          race: "undead",
          keyedTo: [
            {
              regionTypes: [
                "shadow",
                "dark"
              ],
              siteTypes: [
                "shadow-hold",
                "dark-hold"
              ]
            }
          ],
          effects: [
            {
              type: "on-event",
              event: "character-wounded-by-self",
              apply: {
                type: "force-check",
                check: "corruption",
                modifier: -1
              },
              target: "wounded-character"
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hazard-creature",
          id: "tw-40",
          name: "Giant Spiders",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GiantSpiders.jpg",
          text: "Spiders. Two strikes. If the body check for a non-Wizard, non-Ringwraith character wounded by Giant Spiders equals his body, the character is discarded. May also be played keyed to Heart of Mirkwood, Southern Mirkwood, Western Mirkwood, and Woodland Realm; and may also be played at Ruins & Lairs [{R}], Shadow-holds [{S}], and Dark-holds [{D}] in these regions.",
          unique: false,
          strikes: 2,
          prowess: 10,
          body: null,
          killMarshallingPoints: 1,
          race: "spiders",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "tw-493",
          name: "Neeker-breekers",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Neekerbreekers.jpg",
          text: "Animals. Each non-Wizard/non-Ringwraith character in the company faces one strike. His prowess against such a strike is equal to his mind attribute. Any character that would normally be wounded is only tapped instead\u2014no body checks are made.",
          unique: false,
          strikes: 1,
          prowess: 7,
          body: null,
          killMarshallingPoints: 1,
          race: "animals",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "tw-82",
          name: "P\xFBkel-men",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Pukelmen.jpg",
          text: "P\xFBkel-creature. Two strikes. May also be played at Ruins & Lairs [{R}] sites in the following regions: Andrast, Anfalas, An\xF3rien, Dunland, Enedhwaith, Gap of Isen, Lamedon, Old P\xFBkel Gap, Old P\xFBkel-land, and Rohan.",
          unique: false,
          strikes: 2,
          prowess: 11,
          body: null,
          killMarshallingPoints: 1,
          race: "p\xFBkel-creature",
          keyedTo: []
        }
      ];
    }
  });

  // ../shared/src/data/tw-sites.json
  var tw_sites_default;
  var init_tw_sites = __esm({
    "../shared/src/data/tw-sites.json"() {
      tw_sites_default = [
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-421",
          name: "Rivendell",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Rivendell.jpg",
          siteType: "haven",
          sitePath: [],
          nearestHaven: "",
          region: "Rhudaur",
          havenPaths: {
            L\u00F3rien: [
              "wilderness",
              "border",
              "wilderness",
              "wilderness"
            ],
            "Grey Havens": [
              "free",
              "wilderness",
              "wilderness"
            ]
          },
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Site Path From L\xF3rien: Wilderness/Border-land/Wilderness/Wilderness. Site Path From Grey Havens: Free-domain/Wilderness/Wilderness.",
          certified: "2026-03-28"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-408",
          name: "L\xF3rien",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Lorien.jpg",
          siteType: "haven",
          sitePath: [],
          nearestHaven: "",
          region: "Wold & Foothills",
          havenPaths: {
            Rivendell: [
              "wilderness",
              "wilderness",
              "border",
              "wilderness"
            ],
            Edhellond: [
              "wilderness",
              "border",
              "free",
              "free",
              "border",
              "wilderness"
            ]
          },
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Site Path From Rivendell: Wilderness/Wilderness/Border-land/Wilderness. Site Path From Edhellond: Wilderness/Border-land/Free-domain/Free-domain/Border-land/Wilderness.",
          certified: "2026-04-01"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-393",
          name: "Edhellond",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Edhellond.jpg",
          siteType: "haven",
          sitePath: [],
          nearestHaven: "",
          region: "Anfalas",
          havenPaths: {
            "Grey Havens": [
              "free",
              "coastal",
              "coastal",
              "coastal",
              "coastal",
              "wilderness"
            ],
            L\u00F3rien: [
              "wilderness",
              "border",
              "free",
              "free",
              "border",
              "wilderness"
            ]
          },
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Site Path From Grey Havens: Free-domain/Coastland/Coastland/Coastland/Coastland/Wilderness. Site Path From L\xF3rien: Wilderness/Border-land/Free-domain/Free-domain/Border-land/Wilderness.",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-399",
          name: "Grey Havens",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GreyHavens.jpg",
          siteType: "haven",
          sitePath: [],
          nearestHaven: "",
          region: "Lindon",
          havenPaths: {
            Rivendell: [
              "wilderness",
              "wilderness",
              "free"
            ],
            Edhellond: [
              "wilderness",
              "coastal",
              "coastal",
              "coastal",
              "coastal",
              "free"
            ]
          },
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Site Path From Rivendell: Wilderness/Wilderness/Free-domain. Site Path From Edhellond: Wilderness/Coastland/Coastland/Coastland/Coastland/Free-domain.",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-413",
          name: "Moria",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Moria.jpg",
          siteType: "shadow-hold",
          sitePath: [
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Redhorn Gate",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 4,
              prowess: 7
            }
          ],
          resourceDraws: 2,
          hazardDraws: 3,
          text: "Playable: Items (minor, major, greater, gold ring). Automatic-attacks: Orcs \u2014 4 strikes with 7 prowess.",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-412",
          name: "Minas Tirith",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MinasTirith.jpg",
          siteType: "free-hold",
          sitePath: [
            "wilderness",
            "border",
            "free"
          ],
          nearestHaven: "L\xF3rien",
          region: "An\xF3rien",
          playableResources: [
            "faction"
          ],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-414",
          name: "Mount Doom",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MountDoom.jpg",
          siteType: "shadow-hold",
          sitePath: [
            "wilderness",
            "border",
            "free",
            "wilderness",
            "shadow",
            "dark"
          ],
          nearestHaven: "L\xF3rien",
          region: "Gorgoroth",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 3,
          hazardDraws: 6,
          text: "Any company moving to this site has its hazard limit increased by 2 and hazard creatures may always be played keyed to the site regardless of any other cards played."
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-395",
          name: "Ettenmoors",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Ettenmoors.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness"
          ],
          nearestHaven: "Rivendell",
          region: "Rhudaur",
          playableResources: [
            "minor"
          ],
          automaticAttacks: [
            {
              creatureType: "Trolls",
              strikes: 1,
              prowess: 9
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Playable: Items (minor). Automatic-attacks: Troll \u2014 1 strike with 9 prowess."
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-430",
          name: "The White Towers",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TheWhiteTowers.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Rivendell",
          region: "Arthedain",
          playableResources: [],
          automaticAttacks: [
            {
              creatureType: "Wolves",
              strikes: 2,
              prowess: 6
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Automatic-attacks: Wolves \u2014 2 strikes with 6 prowess."
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-375",
          name: "Barrow-downs",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Barrowdowns.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Rivendell",
          region: "Cardolan",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Undead",
              strikes: 1,
              prowess: 8
            }
          ],
          resourceDraws: 1,
          hazardDraws: 2,
          text: "Playable: Items (minor, major). Automatic-attacks: Undead \u2014 1 strike with 8 prowess; each character wounded must make a corruption check.",
          certified: "2026-04-06",
          effects: [
            {
              type: "on-event",
              event: "character-wounded-by-self",
              apply: {
                type: "force-check",
                check: "corruption"
              },
              target: "wounded-character"
            }
          ]
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-391",
          name: "Eagles' Eyrie",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/EaglesEyrie.jpg",
          siteType: "free-hold",
          sitePath: [
            "wilderness",
            "border"
          ],
          nearestHaven: "L\xF3rien",
          region: "Anduin Vales",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-400",
          name: "Henneth Ann\xFBn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/HennethAnnun.jpg",
          siteType: "border-hold",
          sitePath: [
            "wilderness",
            "border",
            "free",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Ithilien",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "",
          certified: "2026-04-11"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-417",
          name: "Old Forest",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/OldForest.jpg",
          siteType: "border-hold",
          sitePath: [
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Rivendell",
          region: "Cardolan",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Healing effects affect all characters at the site.",
          effects: [
            {
              type: "site-rule",
              rule: "healing-affects-all"
            }
          ],
          certified: "2026-04-06"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-372",
          name: "Bag End",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BagEnd.jpg",
          siteType: "free-hold",
          sitePath: [
            "wilderness",
            "wilderness",
            "free"
          ],
          nearestHaven: "Rivendell",
          region: "The Shire",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-386",
          name: "Dol Amroth",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/DolAmroth.jpg",
          siteType: "free-hold",
          sitePath: [
            "wilderness",
            "free"
          ],
          nearestHaven: "Edhellond",
          region: "Belfalas",
          playableResources: [
            "faction"
          ],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "",
          effects: [],
          certified: "2026-04-11"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-394",
          name: "Edoras",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Edoras.jpg",
          siteType: "free-hold",
          sitePath: [
            "wilderness",
            "border"
          ],
          nearestHaven: "L\xF3rien",
          region: "Rohan",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "",
          effects: [],
          certified: "2026-04-11"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-397",
          name: "Glittering Caves",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GlitteringCaves.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border",
            "border"
          ],
          nearestHaven: "L\xF3rien",
          region: "Gap of Isen",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "P\xFBkel-creature",
              strikes: 1,
              prowess: 9
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Haven: L\xF3rien. Playable: Items (minor, major). Automatic-attacks: P\xFBkel-creature \u2014 1 strike with 9 prowess.",
          effects: [],
          certified: "2026-04-11"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-404",
          name: "Isengard",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Isengard.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border",
            "border"
          ],
          nearestHaven: "L\xF3rien",
          region: "Gap of Isen",
          playableResources: [
            "minor",
            "major",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Wolves",
              strikes: 3,
              prowess: 7
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Haven: L\xF3rien. Playable: Items (minor, major, gold ring). Automatic-attacks: Wolves \u2014 3 strikes with 7 prowess.",
          effects: [],
          certified: "2026-04-02"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-407",
          name: "Lond Galen",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/LondGalen.jpg",
          siteType: "border-hold",
          sitePath: [
            "wilderness"
          ],
          nearestHaven: "Edhellond",
          region: "Anfalas",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Nearest Haven: Edhellond.",
          effects: [],
          certified: "2026-04-13"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-419",
          name: "Pelargir",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Pelargir.jpg",
          siteType: "free-hold",
          sitePath: [
            "wilderness",
            "border",
            "free"
          ],
          nearestHaven: "Edhellond",
          region: "Lebennin",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Haven: Edhellond.",
          effects: [],
          certified: "2026-04-13"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-433",
          name: "Tolfalas",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Tolfalas.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "free",
            "coastal"
          ],
          nearestHaven: "Edhellond",
          region: "Mouths of the Anduin",
          playableResources: [
            "minor",
            "major",
            "greater"
          ],
          automaticAttacks: [
            {
              creatureType: "Undead",
              strikes: 3,
              prowess: 7
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Haven: Edhellond. Playable: Items (minor, major, greater*) *-Scroll of Isildur only. Automatic-attacks: Undead \u2014 3 strikes with 7 prowess; each character wounded must make a corruption check.",
          effects: [
            {
              type: "on-event",
              event: "character-wounded-by-self",
              apply: {
                type: "force-check",
                check: "corruption"
              },
              target: "wounded-character"
            },
            {
              type: "site-rule",
              rule: "deny-item",
              when: {
                subtype: "greater",
                name: {
                  $ne: "Scroll of Isildur"
                }
              }
            }
          ],
          certified: "2026-04-13"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-437",
          name: "Wellinghall",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Wellinghall.jpg",
          siteType: "free-hold",
          sitePath: [
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Fangorn",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Nearest Haven: L\xF3rien.",
          effects: [],
          certified: "2026-04-11"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-432",
          name: "Thranduil's Halls",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/ThranduilsHalls.jpg",
          siteType: "free-hold",
          sitePath: [
            "wilderness",
            "border",
            "border"
          ],
          nearestHaven: "L\xF3rien",
          region: "Woodland Realm",
          playableResources: [
            "faction"
          ],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Haven: L\xF3rien."
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-377",
          name: "Blue Mountain Dwarf-hold",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BlueMountainDwarfhold.jpg",
          siteType: "free-hold",
          sitePath: [
            "free",
            "wilderness"
          ],
          nearestHaven: "Grey Havens",
          region: "N\xFAmeriador",
          playableResources: [
            "faction"
          ],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Nearest Haven: Grey Havens.",
          certified: "2026-04-25"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-378",
          name: "Bree",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Bree.jpg",
          siteType: "border-hold",
          sitePath: [
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Rivendell",
          region: "Arthedain",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-373",
          name: "Bandit Lair",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BanditLair.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "shadow"
          ],
          nearestHaven: "L\xF3rien",
          region: "Brown Lands",
          playableResources: [],
          automaticAttacks: [
            {
              creatureType: "Men",
              strikes: 3,
              prowess: 6
            }
          ],
          resourceDraws: 1,
          hazardDraws: 2,
          text: "Nearest Haven: L\xF3rienPlayable: Items (minor, gold ring)Automatic-attacks: Men \u2014 3 strikes with 6 prowess"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-385",
          name: "Dimrill Dale",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/DimrillDale.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Redhorn Gate",
          playableResources: [],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 1,
              prowess: 6
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Nearest Haven: L\xF3rienPlayable: InformationAutomatic-attacks: Orcs \u2014 1 strike with 6 prowess"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-398",
          name: "Goblin-gate",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Goblingate.jpg",
          siteType: "shadow-hold",
          sitePath: [
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Rivendell",
          region: "High Pass",
          playableResources: [
            "minor",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 3,
              prowess: 6
            }
          ],
          resourceDraws: 1,
          hazardDraws: 2,
          text: "Nearest Haven: RivendellPlayable: Items (minor, gold ring)Automatic-attacks: Orcs \u2014 3 strikes with 6 prowess",
          certified: "2026-04-25"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-390",
          name: "Dunnish Clan-hold",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/DunnishClanhold.jpg",
          siteType: "border-hold",
          sitePath: [
            "wilderness",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Rivendell",
          region: "Dunland",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Haven: Rivendell.",
          effects: []
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-381",
          name: "Caves of \xDBlund",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/CavesofUlund.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border",
            "shadow",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Withered Heath",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 13
            }
          ],
          resourceDraws: 3,
          hazardDraws: 3,
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major, greater, gold ring) Automatic-attacks: Dragon \u2014 1 strike with 13 prowess",
          lairOf: "tw-3",
          keywords: [
            "hoard"
          ]
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-383",
          name: "Dancing Spire",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/DancingSpire.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border",
            "shadow",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Withered Heath",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 2,
              prowess: 11
            }
          ],
          resourceDraws: 3,
          hazardDraws: 3,
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major, greater, gold ring) Automatic-attacks: Dragon \u2014 2 strikes with 11 prowess",
          lairOf: "tw-26",
          keywords: [
            "hoard"
          ]
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-402",
          name: "Irerock",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Irerock.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border",
            "shadow",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Withered Heath",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 14
            }
          ],
          resourceDraws: 3,
          hazardDraws: 3,
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major, greater, gold ring) Automatic-attacks: Dragon \u2014 1 strike with 14 prowess",
          lairOf: "tw-48",
          keywords: [
            "hoard"
          ]
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "tw-428",
          name: "The Lonely Mountain",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TheLonelyMountain.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border",
            "border",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Northern Rhovanion",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 14
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major, greater, gold ring) Automatic-attacks: Dragon \u2014 1 strike with 14 prowess",
          lairOf: "tw-90",
          keywords: [
            "hoard"
          ]
        },
        {
          cardType: "hero-site",
          id: "tw-380",
          name: "Carn D\xFBm",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/CarnDum.jpg",
          text: "Nearest Haven: Rivendell Playable: Items (minor, major, greater) Automatic-attacks: Orcs \u2014 4 strikes with 7 prowess",
          alignment: "wizard",
          siteType: "dark-hold",
          sitePath: [
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Rivendell",
          region: "Angmar",
          playableResources: [
            "minor",
            "major",
            "greater"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 4,
              prowess: 7
            }
          ],
          resourceDraws: 2,
          hazardDraws: 3
        },
        {
          cardType: "hero-site",
          id: "tw-384",
          name: "Dead Marshes",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/DeadMarshes.jpg",
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major, greater) Automatic-attacks: Undead \u2014 2 strikes with 8 prowess; each character wounded must make a corruption check",
          alignment: "wizard",
          siteType: "shadow-hold",
          sitePath: [
            "wilderness",
            "shadow",
            "shadow"
          ],
          nearestHaven: "L\xF3rien",
          region: "Dagorlad",
          playableResources: [
            "minor",
            "major",
            "greater"
          ],
          automaticAttacks: [
            {
              creatureType: "Undead",
              strikes: 2,
              prowess: 8
            }
          ],
          resourceDraws: 2,
          hazardDraws: 3
        },
        {
          cardType: "hero-site",
          id: "tw-392",
          name: "Easterling Camp",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/EasterlingCamp.jpg",
          text: "Nearest Haven: L\xF3rien",
          alignment: "wizard",
          siteType: "border-hold",
          sitePath: [
            "wilderness",
            "shadow",
            "shadow",
            "shadow"
          ],
          nearestHaven: "L\xF3rien",
          region: "Horse Plains",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 4,
          hazardDraws: 4
        },
        {
          cardType: "hero-site",
          id: "tw-396",
          name: "Gladden Fields",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GladdenFields.jpg",
          text: "Nearest Haven: L\xF3rien Playable: Items (gold ring) Automatic-attacks: Undead \u2014 1 strike with 8 prowess; each character wounded must make a corruption check",
          alignment: "wizard",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border"
          ],
          nearestHaven: "L\xF3rien",
          region: "Anduin Vales",
          playableResources: [
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Undead",
              strikes: 1,
              prowess: 8
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1
        },
        {
          cardType: "hero-site",
          id: "tw-403",
          name: "Iron Hill Dwarf-hold",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/IronHillDwarfhold.jpg",
          text: "Nearest Haven: L\xF3rien",
          alignment: "wizard",
          siteType: "free-hold",
          sitePath: [
            "wilderness",
            "border",
            "border",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Iron Hills",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 3,
          hazardDraws: 3
        },
        {
          cardType: "hero-site",
          id: "tw-409",
          name: "Lossadan Cairn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/LossadanCairn.jpg",
          text: "Nearest Haven: Rivendell Playable: Items (minor, major, greater*), *\u2014Palant\xEDri Only Automatic-attacks: Undead \u2014 2 strikes with 8 prowess; each character wounded must make a corruption check",
          alignment: "wizard",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Rivendell",
          region: "Forochel",
          playableResources: [
            "minor",
            "major",
            "special"
          ],
          automaticAttacks: [
            {
              creatureType: "Undead",
              strikes: 2,
              prowess: 8
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          effects: [
            {
              type: "on-event",
              event: "character-wounded-by-self",
              apply: { type: "force-check", check: "corruption" },
              target: "wounded-character"
            },
            {
              type: "site-rule",
              rule: "deny-item",
              when: {
                $and: [
                  { subtype: "special" },
                  { $not: { keywords: { $includes: "palantir" } } }
                ]
              }
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hero-site",
          id: "tw-415",
          name: "Mount Gram",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MountGram.jpg",
          text: "Nearest Haven: Rivendell Playable: Items (minor, major) Automatic-attacks: Orcs \u2014 3 strikes with 6 prowess",
          alignment: "wizard",
          siteType: "shadow-hold",
          sitePath: [
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Rivendell",
          region: "Angmar",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 3,
              prowess: 6
            }
          ],
          resourceDraws: 2,
          hazardDraws: 3,
          certified: "2026-04-25"
        },
        {
          cardType: "hero-site",
          id: "tw-416",
          name: "Mount Gundabad",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MountGundabad.jpg",
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major, greater) Automatic-attacks: Orcs \u2014 2 strikes with 8 prowess",
          alignment: "wizard",
          siteType: "shadow-hold",
          sitePath: [
            "wilderness",
            "border",
            "dark"
          ],
          nearestHaven: "L\xF3rien",
          region: "Gundabad",
          playableResources: [
            "minor",
            "major",
            "greater"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 2,
              prowess: 8
            }
          ],
          resourceDraws: 2,
          hazardDraws: 3,
          certified: "2026-04-25"
        },
        {
          cardType: "hero-site",
          id: "tw-420",
          name: "Rhosgobel",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Rhosgobel.jpg",
          text: "Nearest Haven: L\xF3rien. Playable: Items (minor). Special: Healing effects affect all characters at the site.",
          alignment: "wizard",
          siteType: "free-hold",
          sitePath: [
            "wilderness",
            "border",
            "dark"
          ],
          nearestHaven: "L\xF3rien",
          region: "Southern Mirkwood",
          playableResources: [
            "minor"
          ],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 3,
          effects: [
            {
              type: "site-rule",
              rule: "healing-affects-all"
            }
          ],
          certified: "2026-04-22"
        },
        {
          cardType: "hero-site",
          id: "tw-423",
          name: "Sarn Goriwing",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/SarnGoriwing.jpg",
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major) Automatic-attacks: Orcs \u2014 3 strikes with 5 prowess",
          alignment: "wizard",
          siteType: "shadow-hold",
          sitePath: [
            "wilderness",
            "border",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Heart of Mirkwood",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 3,
              prowess: 5
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2
        },
        {
          cardType: "hero-site",
          id: "tw-425",
          name: "Shrel-Kain",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/ShrelKain.jpg",
          text: "Nearest Haven: L\xF3rien",
          alignment: "wizard",
          siteType: "border-hold",
          sitePath: [
            "wilderness",
            "border",
            "border",
            "wilderness",
            "border"
          ],
          nearestHaven: "L\xF3rien",
          region: "Dorwinion",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 3,
          hazardDraws: 3
        }
      ];
    }
  });

  // ../shared/src/data/tw-regions.json
  var tw_regions_default;
  var init_tw_regions = __esm({
    "../shared/src/data/tw-regions.json"() {
      tw_regions_default = [
        {
          cardType: "region",
          id: "tw-440",
          name: "Andrast",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Andrast.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Andrast Coast",
            "Anfalas",
            "Bay of Belfalas",
            "Eriadoran Coast",
            "Old P\xFBkel-land"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-441",
          name: "Andrast Coast",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/AndrastCoast.jpg",
          regionType: "coastal",
          adjacentRegions: [
            "Andrast",
            "Bay of Belfalas",
            "Eriadoran Coast"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-442",
          name: "Anduin Vales",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/AnduinVales.jpg",
          regionType: "border",
          adjacentRegions: [
            "Brown Lands",
            "Grey Mountain Narrows",
            "Gundabad",
            "High Pass",
            "Southern Mirkwood",
            "Western Mirkwood",
            "Wold & Foothills",
            "Woodland Realm"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-443",
          name: "Anfalas",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Anfalas.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Andrast",
            "Bay of Belfalas",
            "Belfalas",
            "Lamedon",
            "Old P\xFBkel Gap"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-444",
          name: "Angmar",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Angmar.jpg",
          regionType: "shadow",
          adjacentRegions: [
            "Arthedain",
            "Forochel",
            "Gundabad",
            "Rhudaur"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-445",
          name: "An\xF3rien",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Anorien.jpg",
          regionType: "free",
          adjacentRegions: [
            "Ithilien",
            "Lebennin",
            "Rohan"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-446",
          name: "Arthedain",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Arthedain.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Angmar",
            "Cardolan",
            "Forochel",
            "Lindon",
            "N\xFAmeriador",
            "Rhudaur",
            "The Shire"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-447",
          name: "Bay of Belfalas",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BayofBelfalas.jpg",
          regionType: "coastal",
          adjacentRegions: [
            "Andrast Coast",
            "Andrast",
            "Mouths of the Anduin",
            "Anfalas",
            "Belfalas"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-448",
          name: "Belfalas",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Belfalas.jpg",
          regionType: "free",
          adjacentRegions: [
            "Mouths of the Anduin",
            "Anfalas",
            "Bay of Belfalas",
            "Lamedon",
            "Lebennin"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-449",
          name: "Brown Lands",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BrownLands.jpg",
          regionType: "shadow",
          adjacentRegions: [
            "Anduin Vales",
            "Dagorlad",
            "Southern Mirkwood",
            "Wold & Foothills"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-450",
          name: "Cardolan",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Cardolan.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Arthedain",
            "Dunland",
            "Enedhwaith",
            "Eriadoran Coast",
            "Hollin",
            "Rhudaur",
            "The Shire"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-451",
          name: "Dagorlad",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Dagorlad.jpg",
          regionType: "shadow",
          adjacentRegions: [
            "Brown Lands",
            "Horse Plains",
            "Ithilien",
            "Southern Mirkwood",
            "Southern Rhovanion"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-452",
          name: "Dorwinion",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Dorwinion.jpg",
          regionType: "border",
          adjacentRegions: [
            "Northern Rhovanion",
            "Southern Rhovanion"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-453",
          name: "Dunland",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Dunland.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Cardolan",
            "Enedhwaith",
            "Hollin"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-454",
          name: "Elven Shores",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/ElvenShores.jpg",
          regionType: "coastal",
          adjacentRegions: [
            "Eriadoran Coast",
            "Lindon"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-455",
          name: "Enedhwaith",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Enedhwaith.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Cardolan",
            "Dunland",
            "Eriadoran Coast",
            "Gap of Isen",
            "Old P\xFBkel-land"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-456",
          name: "Eriadoran Coast",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/EriadoranCoast.jpg",
          regionType: "coastal",
          adjacentRegions: [
            "Andrast",
            "Andrast Coast",
            "Cardolan",
            "Elven Shores",
            "Enedhwaith",
            "Old P\xFBkel-land"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-457",
          name: "Fangorn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Fangorn.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Gap of Isen",
            "Rohan",
            "Wold & Foothills"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-458",
          name: "Forochel",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Forochel.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Angmar",
            "Arthedain",
            "N\xFAmeriador"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-459",
          name: "Gap of Isen",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GapofIsen.jpg",
          regionType: "border",
          adjacentRegions: [
            "Enedhwaith",
            "Fangorn",
            "Old P\xFBkel-land",
            "Rohan"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-460",
          name: "Gorgoroth",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Gorgoroth.jpg",
          regionType: "dark",
          adjacentRegions: [
            "Imlad Morgul",
            "Nurn",
            "Ud\xFBn"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-461",
          name: "Grey Mountain Narrows",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GreyMountainNarrows.jpg",
          regionType: "shadow",
          adjacentRegions: [
            "Anduin Vales",
            "Northern Rhovanion",
            "Withered Heath",
            "Woodland Realm"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-462",
          name: "Gundabad",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Gundabad.jpg",
          regionType: "dark",
          adjacentRegions: [
            "Anduin Vales",
            "Angmar"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-463",
          name: "Harondor",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Harondor.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Mouths of the Anduin",
            "Ithilien",
            "Khand"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-464",
          name: "Heart of Mirkwood",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/HeartofMirkwood.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Northern Rhovanion",
            "Southern Mirkwood",
            "Southern Rhovanion",
            "Western Mirkwood",
            "Woodland Realm"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-465",
          name: "High Pass",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/HighPass.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Anduin Vales",
            "Rhudaur"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-466",
          name: "Hollin",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Hollin.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Cardolan",
            "Dunland",
            "Redhorn Gate",
            "Rhudaur"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-467",
          name: "Horse Plains",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/HorsePlains.jpg",
          regionType: "shadow",
          adjacentRegions: [
            "Dagorlad",
            "Nurn",
            "Southern Rhovanion"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-468",
          name: "Imlad Morgul",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/ImladMorgul.jpg",
          regionType: "shadow",
          adjacentRegions: [
            "Gorgoroth",
            "Ithilien"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-469",
          name: "Iron Hills",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/IronHills.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Northern Rhovanion",
            "Withered Heath"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-470",
          name: "Ithilien",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Ithilien.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "An\xF3rien",
            "Dagorlad",
            "Harondor",
            "Imlad Morgul"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-471",
          name: "Khand",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Khand.jpg",
          regionType: "shadow",
          adjacentRegions: [
            "Harondor",
            "Nurn"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-472",
          name: "Lamedon",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Lamedon.jpg",
          regionType: "border",
          adjacentRegions: [
            "Anfalas",
            "Belfalas",
            "Lebennin"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-473",
          name: "Lebennin",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Lebennin.jpg",
          regionType: "free",
          adjacentRegions: [
            "Mouths of the Anduin",
            "An\xF3rien",
            "Belfalas",
            "Lamedon"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-474",
          name: "Lindon",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Lindon.jpg",
          regionType: "free",
          adjacentRegions: [
            "Arthedain",
            "Elven Shores",
            "N\xFAmeriador"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-475",
          name: "Mouths of the Anduin",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MouthsoftheAnduin.jpg",
          regionType: "coastal",
          adjacentRegions: [
            "Bay of Belfalas",
            "Belfalas",
            "Harondor",
            "Lebennin"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-476",
          name: "Northern Rhovanion",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/NorthernRhovanion.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Dorwinion",
            "Heart of Mirkwood",
            "Iron Hills",
            "Southern Rhovanion",
            "Withered Heath",
            "Woodland Realm",
            "Grey Mountain Narrows"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-477",
          name: "N\xFAmeriador",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Numeriador.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Arthedain",
            "Forochel",
            "Lindon"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-478",
          name: "Nurn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Nurn.jpg",
          regionType: "dark",
          adjacentRegions: [
            "Gorgoroth",
            "Horse Plains",
            "Khand"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-479",
          name: "Old P\xFBkel Gap",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/OldPukelGap.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Anfalas",
            "Old P\xFBkel-land"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-480",
          name: "Old P\xFBkel-land",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/OldPukelland.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Andrast",
            "Enedhwaith",
            "Eriadoran Coast",
            "Gap of Isen",
            "Old P\xFBkel Gap"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-481",
          name: "Redhorn Gate",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/RedhornGate.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Hollin",
            "Wold & Foothills"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-482",
          name: "Rhudaur",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Rhudaur.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Angmar",
            "Arthedain",
            "Cardolan",
            "High Pass",
            "Hollin"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-483",
          name: "Rohan",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Rohan.jpg",
          regionType: "border",
          adjacentRegions: [
            "An\xF3rien",
            "Fangorn",
            "Gap of Isen",
            "Wold & Foothills"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-484",
          name: "Southern Mirkwood",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/SouthernMirkwood.jpg",
          regionType: "dark",
          adjacentRegions: [
            "Anduin Vales",
            "Brown Lands",
            "Dagorlad",
            "Heart of Mirkwood",
            "Southern Rhovanion",
            "Western Mirkwood"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-485",
          name: "Southern Rhovanion",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/SouthernRhovanion.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Dagorlad",
            "Dorwinion",
            "Heart of Mirkwood",
            "Horse Plains",
            "Northern Rhovanion",
            "Southern Mirkwood"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-486",
          name: "The Shire",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TheShire.jpg",
          regionType: "free",
          adjacentRegions: [
            "Arthedain",
            "Cardolan"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-487",
          name: "Ud\xFBn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Udun.jpg",
          regionType: "dark",
          adjacentRegions: [
            "Gorgoroth"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-488",
          name: "Western Mirkwood",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/WesternMirkwood.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Anduin Vales",
            "Heart of Mirkwood",
            "Southern Mirkwood",
            "Woodland Realm"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-489",
          name: "Withered Heath",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/WitheredHeath.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Iron Hills",
            "Northern Rhovanion",
            "Grey Mountain Narrows"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-490",
          name: "Wold & Foothills",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/WoldFoothills.jpg",
          regionType: "wilderness",
          adjacentRegions: [
            "Anduin Vales",
            "Brown Lands",
            "Fangorn",
            "Redhorn Gate",
            "Rohan"
          ],
          text: ""
        },
        {
          cardType: "region",
          id: "tw-491",
          name: "Woodland Realm",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/WoodlandRealm.jpg",
          regionType: "border",
          adjacentRegions: [
            "Anduin Vales",
            "Heart of Mirkwood",
            "Northern Rhovanion",
            "Western Mirkwood",
            "Grey Mountain Narrows"
          ],
          text: ""
        }
      ];
    }
  });

  // ../shared/src/data/tw-resources.json
  var tw_resources_default;
  var init_tw_resources = __esm({
    "../shared/src/data/tw-resources.json"() {
      tw_resources_default = [
        {
          cardType: "hero-resource-ally",
          alignment: "wizard",
          id: "tw-251",
          name: "Gwaihir",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Gwaihir.jpg",
          unique: true,
          prowess: 4,
          body: 8,
          mind: 4,
          marshallingPoints: 2,
          marshallingCategory: "ally",
          playableAt: [
            {
              site: "Eagles' Eyrie"
            }
          ],
          text: "Unique. Playable at Eagles' Eyrie. If his company's size is two or less, you may discard Gwaihir during the organization phase to allow his company to move to any site that is not in a Shadow-land, Dark-domain, or Under-deeps; only hazard creatures keyed to the site may be played on a company that moves in this fashion.",
          effects: [
            {
              type: "grant-action",
              action: "gwaihir-special-movement",
              cost: {
                discard: "self"
              },
              when: {
                "company.size": {
                  $lte: 2
                },
                "company.hasPlannedMovement": false
              },
              apply: {
                type: "set-company-special-movement",
                specialMovement: "gwaihir"
              }
            }
          ],
          certified: "2026-04-07"
        },
        {
          cardType: "hero-resource-ally",
          alignment: "wizard",
          id: "tw-326",
          name: "Shadowfax",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Shadowfax.jpg",
          unique: true,
          prowess: 2,
          body: 8,
          mind: 2,
          marshallingPoints: 1,
          marshallingCategory: "ally",
          playableAt: [
            {
              site: "Edoras"
            },
            {
              site: "Dunharrow"
            }
          ],
          text: "Unique. Playable at Edoras or Dunharrow. If his company has only one character or one character and a Hobbit at the end of the movement/hazard phase, tap Shadowfax to allow his company to immediately move again; an additional site card may be played and an additional movement/hazard phase follows for that company."
        },
        {
          cardType: "hero-resource-faction",
          alignment: "wizard",
          id: "tw-311",
          name: "Rangers of the North",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/RangersoftheNorth.jpg",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 10,
          race: "dunadan",
          playableAt: [
            {
              site: "Bree"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: 1,
              when: {
                "bearer.race": "dunadan"
              }
            }
          ],
          text: "Unique. Playable at Bree if the influence check is greater than 9. Standard Modifications: D\xFAnedain (+1).",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-resource-faction",
          alignment: "wizard",
          id: "tw-317",
          name: "Riders of Rohan",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/RidersofRohan.jpg",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 10,
          race: "man",
          playableAt: [
            {
              site: "Edoras"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: 1,
              when: {
                "bearer.race": "hobbit"
              }
            },
            {
              type: "check-modifier",
              check: "influence",
              value: 1,
              when: {
                "bearer.race": "dunadan"
              }
            }
          ],
          text: "Unique. Playable at Edoras if the influence check is greater than 9. Standard Modifications: Hobbits (+1), D\xFAnedain (+1).",
          certified: "2026-04-14"
        },
        {
          cardType: "hero-resource-faction",
          alignment: "wizard",
          id: "tw-263",
          name: "Knights of Dol Amroth",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/KnightsofDolAmroth.jpg",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 9,
          race: "dunadan",
          playableAt: [
            {
              site: "Dol Amroth"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: 1,
              when: {
                "bearer.race": "dunadan"
              }
            }
          ],
          text: "Unique. Playable at Dol Amroth if the influence check is greater than 8. Standard Modifications: D\xFAnedain (+1).",
          certified: "2026-04-12"
        },
        {
          cardType: "hero-resource-faction",
          alignment: "wizard",
          id: "tw-367",
          name: "Wood-elves",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Woodelves.jpg",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 8,
          race: "elf",
          playableAt: [
            {
              site: "Thranduil's Halls"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: -1,
              when: {
                "bearer.race": "man"
              }
            },
            {
              type: "check-modifier",
              check: "influence",
              value: 1,
              when: {
                "bearer.race": "elf"
              }
            },
            {
              type: "check-modifier",
              check: "influence",
              value: -2,
              when: {
                "bearer.race": "dwarf"
              }
            }
          ],
          text: "Unique. Playable at Thranduil's Halls if the influence check is greater than 8. Standard Modifications: Men (-1), Elves (+1), Dwarves (-2)."
        },
        {
          cardType: "hero-resource-faction",
          alignment: "wizard",
          id: "tw-200",
          name: "Blue Mountain Dwarves",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/BlueMountainDwarves.jpg",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 9,
          race: "dwarf",
          playableAt: [
            {
              site: "Blue Mountain Dwarf-hold"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: -2,
              when: {
                "bearer.race": "elf"
              }
            },
            {
              type: "check-modifier",
              check: "influence",
              value: 2,
              when: {
                "bearer.race": "dwarf"
              }
            }
          ],
          text: "Unique. Playable at Blue Mountain Dwarf-hold if the influence check is greater than 9. Standard Modifications: Elves (-2), Dwarves (+2).",
          certified: "2026-04-25"
        },
        {
          cardType: "hero-resource-faction",
          alignment: "wizard",
          id: "tw-276",
          name: "Men of Anfalas",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MenofAnfalas.jpg",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 9,
          race: "man",
          playableAt: [
            {
              site: "Lond Galen"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: 1,
              when: {
                "bearer.race": "dunadan"
              }
            }
          ],
          text: "Unique. Playable at Lond Galen if the influence check is greater than 8. Standard Modifications: D\xFAnedain (+1).",
          certified: "2026-04-12"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-243",
          name: "Gates of Morning",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GatesofMorning.jpg",
          unique: false,
          eventType: "permanent",
          keywords: [
            "environment"
          ],
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "duplication-limit",
              scope: "game",
              max: 1
            },
            {
              type: "on-event",
              event: "self-enters-play",
              apply: {
                type: "move",
                select: "filter-all",
                from: "in-play",
                to: "discard",
                filter: {
                  cardType: "hazard-event",
                  keywords: {
                    $includes: "environment"
                  }
                }
              }
            }
          ],
          text: "Environment. When Gates of Morning is played, all environment hazard cards in play are immediately discarded, and all hazard environment effects are canceled. Cannot be duplicated.",
          certified: "2026-04-01"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-335",
          name: "Sun",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Sun.jpg",
          unique: false,
          eventType: "long",
          keywords: [
            "environment"
          ],
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "duplication-limit",
              scope: "game",
              max: 1
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              target: "all-characters",
              when: {
                "target.race": "dunadan"
              }
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: -1,
              target: "all-attacks",
              when: {
                inPlay: "Gates of Morning"
              }
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              target: "all-characters",
              when: {
                $and: [
                  {
                    inPlay: "Gates of Morning"
                  },
                  {
                    "target.race": {
                      $in: [
                        "man",
                        "dunadan"
                      ]
                    }
                  }
                ]
              }
            }
          ],
          text: "Environment. The prowess of each D\xFAnadan is modified by +1. Additionally, if Gates of Morning is in play, the prowess of each automatic-attack and hazard creature is modified by -1 and the prowess of each Man and D\xFAnadan is modified by +1. Cannot be duplicated.",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-204",
          name: "Concealment",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Concealment.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "cancel-attack",
              cost: {
                tap: "character"
              },
              requiredSkill: "scout"
            }
          ],
          text: "Scout only. Tap scout to cancel one attack against his company.",
          certified: "2026-04-08"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-207",
          name: "Dark Quarrels",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/DarkQuarrels.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "cancel-attack",
              when: {
                "enemy.race": {
                  $in: [
                    "orc",
                    "troll",
                    "men",
                    "man"
                  ]
                }
              }
            },
            {
              type: "halve-strikes",
              when: {
                inPlay: "Gates of Morning"
              }
            }
          ],
          text: "Cancel one attack by Orcs, Trolls, or Men. Alternatively, if Gates of Morning is in play, the number of strikes from any attack is reduced to half of its original number, rounded up.",
          certified: "2026-04-13"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-209",
          name: "Dodge",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Dodge.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "dodge-strike",
              bodyPenalty: -1
            }
          ],
          text: "Target character does not tap against one strike (unless he is wounded by the strike). If wounded by the strike, his body is modified by -1 for the resulting body check.",
          certified: "2026-04-13"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-248",
          name: "Great Ship",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/GreatShip.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-window",
              phase: "organization",
              step: "end-of-org"
            },
            {
              type: "play-target",
              target: "company",
              cost: {
                tap: "character"
              }
            },
            {
              type: "on-event",
              event: "self-enters-play",
              apply: {
                type: "add-constraint",
                constraint: "granted-action",
                scope: "turn",
                grantedAction: {
                  action: "cancel-chain-entry",
                  phase: "movement-hazard",
                  cost: {
                    tap: "character"
                  },
                  when: {
                    $and: [
                      {
                        "chain.hazardCount": {
                          $gt: 0
                        }
                      },
                      {
                        path: {
                          $includes: "coastal"
                        }
                      },
                      {
                        path: {
                          $noConsecutiveOtherThan: "coastal"
                        }
                      }
                    ]
                  },
                  apply: {
                    type: "cancel-chain-entry",
                    select: "most-recent-unresolved-hazard"
                  }
                }
              }
            }
          ],
          text: "Tap a character in target company during the organization phase to play Great Ship on that company. Until the end of the turn, if the company's current site path contains a Coastal Sea region and no consecutive non-Coastal Seas regions, any character in the company may tap to cancel a hazard that targets (as an active condition of playing the card itself) the company or an entity associated with the company.",
          certified: "2026-04-14"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-253",
          name: "Halfling Strength",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/HalflingStrength.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                "target.race": "hobbit"
              }
            },
            {
              type: "play-option",
              id: "untap",
              when: {
                "target.status": "tapped"
              },
              apply: {
                type: "set-character-status",
                status: "untapped"
              }
            },
            {
              type: "play-option",
              id: "heal",
              when: {
                "target.status": "inverted"
              },
              apply: {
                type: "set-character-status",
                status: "untapped"
              }
            },
            {
              type: "play-option",
              id: "corruption-check-boost",
              when: {
                "pending.corruptionCheckTargetsMe": true
              },
              apply: {
                type: "add-constraint",
                constraint: "check-modifier",
                check: "corruption",
                scope: "until-cleared",
                value: 4
              }
            }
          ],
          certified: "2026-04-13",
          text: "Hobbit only. The Hobbit may untap or he may move from wounded status to well and untapped during his organization phase or he may receive a +4 modification to one corruption check."
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-190",
          name: "Align Palant\xEDr",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/AlignPalantir.jpg",
          unique: false,
          eventType: "permanent",
          corruptionPoints: 2,
          marshallingPoints: 2,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                $and: [
                  {
                    "target.itemKeywords": {
                      $includes: "palantir"
                    }
                  },
                  {
                    "company.skills": {
                      $includes: "sage"
                    }
                  }
                ]
              }
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            },
            {
              type: "on-event",
              event: "bearer-company-moves",
              apply: {
                type: "move",
                select: "self",
                from: "self-location",
                to: "discard"
              }
            }
          ],
          text: "Sage only. Playable on a Palant\xEDr with a sage in the company. Bearer now has the ability to use the Palant\xEDr. If the Palant\xEDr is stored, this card is stored too. Discard Align Palant\xEDr if the company carrying the Palant\xEDr moves. Cannot be duplicated on a given Palant\xEDr.",
          certified: "2026-04-14"
        },
        {
          cardType: "hero-resource-faction",
          alignment: "wizard",
          id: "tw-277",
          name: "Men of An\xF3rien",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MenofAnorien.jpg",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 8,
          race: "man",
          playableAt: [
            {
              site: "Minas Tirith"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: 1,
              when: {
                "bearer.race": "dunadan"
              }
            }
          ],
          text: "Unique. Playable at Minas Tirith if the influence check is greater than 7. Standard Modifications: D\xFAnedain (+1).",
          certified: "2026-04-12"
        },
        {
          cardType: "hero-resource-faction",
          alignment: "wizard",
          id: "tw-280",
          name: "Men of Lebennin",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MenofLebennin.jpg",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 8,
          race: "man",
          playableAt: [
            {
              site: "Pelargir"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: 1,
              when: {
                "bearer.race": "dunadan"
              }
            }
          ],
          text: "Unique. Playable at Pelargir if the influence check is greater than 7. Standard Modifications: D\xFAnedain (+1).",
          certified: "2026-04-12"
        },
        {
          cardType: "hero-resource-faction",
          alignment: "wizard",
          id: "tw-310",
          name: "Rangers of Ithilien",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/RangersofIthilien.jpg",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 8,
          race: "dunadan",
          playableAt: [
            {
              site: "Henneth Ann\xFBn"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: 1,
              when: {
                "bearer.race": "dunadan"
              }
            }
          ],
          text: "Unique. Playable at Henneth Ann\xFBn if the influence check is greater than 7. Standard Modifications: D\xFAnedain (+1).",
          certified: "2026-04-12"
        },
        {
          cardType: "hero-resource-ally",
          alignment: "wizard",
          id: "tw-353",
          name: "Treebeard",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Treebeard.jpg",
          unique: true,
          prowess: 8,
          body: 9,
          mind: 3,
          marshallingPoints: 2,
          marshallingCategory: "ally",
          playableAt: [
            {
              site: "Wellinghall"
            }
          ],
          effects: [
            {
              type: "on-event",
              event: "company-arrives-at-site",
              apply: {
                type: "move",
                select: "self",
                from: "self-location",
                to: "discard"
              },
              when: {
                $not: {
                  "site.region": {
                    $in: [
                      "Fangorn",
                      "Rohan",
                      "Gap of Isen",
                      "Wold & Foothills",
                      "Enedhwaith",
                      "Old P\xFBkel-land",
                      "Brown Lands",
                      "Anduin Vales",
                      "Redhorn Gate"
                    ]
                  }
                }
              }
            }
          ],
          text: "Unique. Playable at Wellinghall. May not be attacked by automatic-attacks or hazards keyed to his site. Discard Treebeard if his company moves to a site that is not in: Fangorn, Rohan, Gap of Isen, Wold & Foothills, Enedhwaith, Old P\xFBkel-land, Brown Lands, Anduin Vales, or Redhorn Gate.",
          certified: "2026-04-14"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-348",
          name: "The White Tree",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TheWhiteTree.jpg",
          unique: true,
          eventType: "permanent",
          marshallingPoints: 5,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-target",
              target: "site",
              filter: {
                name: "Minas Tirith"
              }
            },
            {
              type: "play-target",
              target: "character",
              filter: {
                "target.skills": {
                  $includes: "sage"
                }
              }
            },
            {
              type: "play-condition",
              requires: "discard-named-card",
              cardName: "Sapling of the White Tree",
              sources: [
                "character-items",
                "out-of-play-pile"
              ]
            },
            {
              type: "on-event",
              event: "self-enters-play",
              apply: {
                type: "add-constraint",
                constraint: "site-type-override",
                overrideType: "haven",
                scope: "until-cleared"
              }
            }
          ],
          text: "Unique. Sage only at Minas Tirith. Playable only if you discard a Sapling of the White Tree borne by one of your characters at Minas Tirith, or one from your Marshalling Points pile stored at Minas Tirith. Minas Tirith becomes a Haven [{H}] for the purposes of healing and playing hazards.",
          certified: "2026-04-15"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-356",
          name: "Vanishment",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Vanishment.jpg",
          unique: false,
          eventType: "short",
          keywords: [
            "spell"
          ],
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "cancel-attack",
              requiredRace: "wizard",
              cost: {
                check: "corruption",
                modifier: -2
              }
            }
          ],
          text: "Spell. Wizard only. Cancels an attack against the Wizard's company. Wizard makes a corruption check modified by -2.",
          certified: "2026-04-15"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-362",
          name: "Wizard\u2019s Laughter",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/WizardsLaughter.jpg",
          unique: false,
          eventType: "short",
          keywords: [
            "spell"
          ],
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "cancel-influence",
              requiredRace: "wizard",
              cost: {
                check: "corruption",
                modifier: -2
              }
            }
          ],
          certified: "2026-04-15",
          text: "Spell. Wizard only during opponent\u2019s site phase. Automatically cancels an influence check against one of the Wizard\u2019s player\u2019s characters, followers, factions, allies, or items. Wizard makes a corruption check modified by -2."
        },
        {
          cardType: "hero-resource-faction",
          alignment: "wizard",
          id: "tw-211",
          name: "Dunlendings",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Dunlendings.jpg",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 9,
          race: "man",
          playableAt: [
            {
              site: "Dunnish Clan-hold"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: -1,
              when: {
                "bearer.race": "man"
              }
            },
            {
              type: "check-modifier",
              check: "influence",
              value: -1,
              when: {
                "bearer.race": "dunadan"
              }
            },
            {
              type: "check-modifier",
              check: "influence",
              value: -1,
              when: {
                "bearer.race": "dwarf"
              }
            }
          ],
          text: "Unique. Playable at Dunnish Clan-hold if the influence check is greater than 9. Standard Modifications: Men (-1), D\xFAnedain (-1), Dwarves (-1)."
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-332",
          name: "Stealth",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Stealth.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-window",
              phase: "organization",
              step: "end-of-org"
            },
            {
              type: "play-target",
              target: "character",
              filter: {
                $and: [
                  {
                    "target.skills": {
                      $includes: "scout"
                    }
                  },
                  {
                    "target.status": "untapped"
                  }
                ]
              },
              maxCompanySize: 2,
              cost: {
                tap: "character"
              },
              requiredSkill: "scout"
            },
            {
              type: "on-event",
              event: "self-enters-play",
              apply: {
                type: "add-constraint",
                constraint: "no-creature-hazards-on-company",
                scope: "turn"
              },
              target: "scout-company"
            }
          ],
          text: "Scout only. Tap a scout to play at the end of the organization phase only if the scout's company size is less than three. No creature hazards may be played on his company this turn.",
          certified: "2026-04-08"
        },
        {
          cardType: "hero-resource-event",
          id: "tw-189",
          name: "A Friend or Three",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/AFriendorThree.jpg",
          text: "One influence check or corruption check by a character in a company receives a +1 modification for each character in his company.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-faction",
          id: "tw-197",
          name: "Beornings",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Beornings.jpg",
          text: "Unique. Playable at Beorn\u2019s House if the influence check is greater than 7. Standard Modifications: Men (+1).",
          alignment: "wizard",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "man",
          playableAt: []
        },
        {
          cardType: "hero-resource-faction",
          id: "tw-222",
          name: "Easterlings",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Easterlings.jpg",
          text: "Unique. Playable at Easterling Camp if the influence check is greater than 9. Standard Modifications: D\xFAnedain (-2).",
          alignment: "wizard",
          unique: true,
          marshallingPoints: 4,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "man",
          playableAt: []
        },
        {
          cardType: "hero-resource-event",
          id: "tw-229",
          name: "Escape",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Escape.jpg",
          text: "Playable on an unwounded character facing an attack. The attack is canceled and the character is wounded (no body check is required).",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: { "target.status": { $ne: "inverted" } }
            },
            { type: "cancel-attack" },
            { type: "wound-target-character" }
          ],
          certified: "2026-04-24"
        },
        {
          cardType: "hero-resource-event",
          id: "tw-240",
          name: "Fellowship",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Fellowship.jpg",
          text: "Only playable at a Haven [{H}] during the organization phase on a company that has four or more characters and allies. +1 to prowess and +1 to corruption checks for all characters and allies in the company. Discard this card if a character or ally joins or leaves the company for any reason.",
          alignment: "wizard",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-ally",
          id: "tw-245",
          name: "Goldberry",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Goldberry.jpg",
          text: "Unique. Playable at Old Forest. May not be attacked. Tap Goldberry to cancel an effect declared earlier in the same chain of effects that would return Goldberrys' company to its site of origin. Alternatively, tap Goldberry to cancel one attack against her company keyed to Wilderness [{w}].",
          alignment: "wizard",
          unique: true,
          prowess: 0,
          body: 0,
          mind: 2,
          marshallingPoints: 1,
          marshallingCategory: "ally",
          playableAt: [
            { site: "Old Forest" }
          ],
          effects: [
            {
              type: "combat-protection",
              protection: "no-attack"
            },
            {
              type: "cancel-attack",
              cost: { tap: "self" },
              when: { "attack.keying": "wilderness" }
            }
          ]
        },
        {
          cardType: "hero-resource-ally",
          id: "tw-246",
          name: "Gollum",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Gollum.jpg",
          text: "Unique. Playable at Goblin-gate or Moria. If his company\u2019s size is two or less, tap Gollum to cancel one attack against his company keyed to Wilderness [{w}] or Shadow-land [{s}]. You may tap Gollum if he is at the same non-Haven site as The One Ring ; then both Gollum and The One Ring are discarded.",
          alignment: "wizard",
          unique: true,
          prowess: 2,
          body: 9,
          mind: 4,
          marshallingPoints: 2,
          marshallingCategory: "ally",
          certified: "2026-04-24",
          playableAt: [
            {
              site: "Goblin-gate"
            },
            {
              site: "Moria"
            }
          ],
          effects: [
            {
              type: "grant-action",
              action: "stinker-discard-with-ring",
              cost: {
                discard: "self"
              },
              when: {
                $and: [
                  {
                    "bearer.atHaven": false
                  },
                  {
                    "site.hasOneRing": true
                  }
                ]
              },
              apply: {
                type: "move",
                select: "named",
                from: "in-play",
                to: "discard",
                cardName: "The One Ring"
              }
            },
            {
              type: "cancel-attack",
              cost: {
                tap: "self"
              },
              when: {
                $and: [
                  {
                    "bearer.companySize": {
                      $lte: 2
                    }
                  },
                  {
                    $or: [
                      {
                        "attack.keying": "wilderness"
                      },
                      {
                        "attack.keying": "shadow"
                      }
                    ]
                  }
                ]
              }
            }
          ]
        },
        {
          cardType: "hero-resource-event",
          id: "tw-249",
          name: "Great-road",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Greatroad.jpg",
          text: "Playable at the end of the organization phase on a company at a Haven [{H}]. Opponent may draw up to twice the normal number of cards for this company during the movement/hazard phase. At the end of the turn, the company may replace its site card with the Haven card at which it began the turn. This is considered movement with no movement/hazard phase.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-faction",
          id: "tw-261",
          name: "Iron Hill Dwarves",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/IronHillDwarves.jpg",
          text: "Unique. Playable at Iron Hill Dwarf-hold if the influence check is greater than 8. Standard Modifications: Elves (-2), Dwarves (+2).",
          alignment: "wizard",
          unique: true,
          marshallingPoints: 4,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "dwarf",
          playableAt: []
        },
        {
          cardType: "hero-resource-event",
          id: "tw-269",
          name: "Lucky Search",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/LuckySearch.jpg",
          text: "Scout only. During the site phase, tap a scout at a tapped or untapped Shadow-hold [{S}] or Dark-hold [{D}]. Turn over cards from your play deck one at a time until: you reveal a non-special item (it cannot be a unique item already in play) or reach the end (does not exhaust the play deck). If you reveal such an item, the scout takes control of it. In any case, the scout faces a single strike attack with prowess equal to 3 plus the number of cards revealed. This attack/strike cannot be canceled. Discard the item if the scout is wounded. Reshuffle all revealed cards except the item back into the play deck.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-faction",
          id: "tw-278",
          name: "Men of Dorwinion",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MenofDorwinion.jpg",
          text: "Unique. Playable at Shrel-Kain if the influence check is greater than 6. Standard Modifications: Men (+1).",
          alignment: "wizard",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "man",
          playableAt: []
        },
        {
          cardType: "hero-resource-event",
          id: "tw-288",
          name: "Muster",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Muster.jpg",
          text: "Warrior only. An influence check against a faction by a warrior is modified by adding the warrior\u2019s prowess to a maximum modifier of +5.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: { "target.skills": { $includes: "warrior" } }
            },
            {
              type: "play-option",
              id: "influence-boost",
              when: { "player.hasFactionInHand": true },
              apply: {
                type: "add-constraint",
                constraint: "check-modifier",
                check: "influence",
                scope: "until-cleared",
                valueExpr: "min(target.baseProwess, 5)"
              }
            }
          ],
          certified: "2026-04-24"
        },
        {
          cardType: "hero-resource-event",
          id: "tw-292",
          name: "New Friendship",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/NewFriendship.jpg",
          text: "Diplomat only. +3 to any one influence check by a diplomat. Alternatively, +2 to a corruption check by a character in a diplomat's company.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-ally",
          id: "tw-307",
          name: "Quickbeam",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Quickbeam.jpg",
          text: "Unique. Playable at Wellinghall. May not be attacked by automatic-attacks or hazards keyed to his site.",
          alignment: "wizard",
          unique: true,
          prowess: 6,
          body: 9,
          mind: 3,
          marshallingPoints: 2,
          marshallingCategory: "ally",
          playableAt: []
        },
        {
          cardType: "hero-resource-event",
          id: "tw-315",
          name: "Rescue Prisoners",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/RescuePrisoners.jpg",
          text: "Playable at an already tapped Dark-hold [{D}] or Shadow-hold [{S}] during the site phase. The company faces a Spider attack (2 strikes with 7 prowess). If no characters are untapped after the attack, discard Rescue Prisoners . Otherwise, you may tap 1 character in the company and put Rescue Prisoners under his control. No marshalling points are received and that character may not untap until Rescue Prisoners is stored at a Haven [{H}], Border-hold [{B}], or Free-hold [{F}] during his organization phase. Cannot be duplicated at a given site.",
          alignment: "wizard",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-target",
              target: "site",
              filter: {
                siteType: {
                  $in: [
                    "dark-hold",
                    "shadow-hold"
                  ]
                }
              }
            },
            {
              type: "play-flag",
              flag: "tapped-site-only"
            },
            {
              type: "play-target",
              target: "character"
            },
            {
              type: "storable-at",
              siteTypes: [
                "haven",
                "border-hold",
                "free-hold"
              ],
              marshallingPoints: 2
            },
            {
              type: "duplication-limit",
              scope: "site",
              max: 1
            }
          ]
        },
        {
          cardType: "hero-resource-event",
          id: "tw-316",
          name: "Return of the King",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/ReturnoftheKing.jpg",
          text: "Unique. Aragorn II only. Only playable in Minas Tirith and only if Denethor II is not in play. Aragorn II\u2019s direct influence is modified by +3. Keep this card with Aragorn II; discard if he leaves play.",
          alignment: "wizard",
          unique: true,
          eventType: "permanent",
          marshallingPoints: 3,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-event",
          id: "tw-319",
          name: "Risky Blow",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/RiskyBlow.jpg",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "modify-strike",
              prowessBonus: 3,
              bodyPenalty: -1,
              requiredSkill: "warrior"
            }
          ],
          text: "Warrior only against one strike. +3 to prowess and -1 to body.",
          certified: "2026-04-22"
        },
        {
          cardType: "hero-resource-event",
          id: "tw-342",
          name: "The Cock Crows",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TheCockCrows.jpg",
          text: "Cancels a Troll attack. Alternatively, if Gates of Morning is in play, discard one hazard permanent-event.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "cancel-attack",
              when: { "enemy.race": "troll" }
            },
            {
              type: "move",
              select: "target",
              from: "in-play",
              to: "discard",
              filter: {
                $and: [
                  { cardType: "hazard-event" },
                  { eventType: "permanent" }
                ]
              },
              when: { inPlay: "Gates of Morning" }
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hero-resource-event",
          id: "tw-346",
          name: "The Old Thrush",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TheOldThrush.jpg",
          text: "-3 to the prowess and body of a non-Nazg\xFBl attack with a normal prowess of 13 or more. Cannot be duplicated on a given attack.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-event",
          id: "tw-349",
          name: "Thorough Search",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/ThoroughSearch.jpg",
          text: "Scout only. Playable during the site phase on an untapped scout. Tap the scout. Another character in his company may play a minor, major, or gold ring item normally playable at the site. This does not tap the site, and Thorough Search can be played at a site that is already tapped.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-faction",
          id: "tw-352",
          name: "Tower Guard of Minas Tirith",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TowerGuardofMinasTirith.jpg",
          text: "Unique. Playable at Minas Tirith if the influence check is greater than 7. Standard Modifications: D\xFAnedain (+1).",
          alignment: "wizard",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "dunadan",
          playableAt: []
        },
        {
          cardType: "hero-resource-event",
          id: "tw-358",
          name: "Vilya",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Vilya.jpg",
          text: "Playable on Elrond. +4 prowess, +2 body, +6 direct influence until the end of the turn. If Elrond is at Rivendell and your play deck has at least 5 cards in it, you may take 3 resource cards of your choice from your discard pile and shuffle them into your play deck. Elrond makes a corruption check modified by -3. Cannot be duplicated on a given turn.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "tw-270",
          name: "Lucky Strike",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/LuckyStrike.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "reroll-strike",
              filter: {
                "target.skills": {
                  $includes: "warrior"
                }
              }
            }
          ],
          text: "Warrior only. Make two rolls against a strike and choose one of the two results to use.",
          certified: "2026-04-22"
        }
      ];
    }
  });

  // ../shared/src/data/tw-hazards.json
  var tw_hazards_default;
  var init_tw_hazards = __esm({
    "../shared/src/data/tw-hazards.json"() {
      tw_hazards_default = [
        {
          cardType: "hazard-event",
          id: "tw-28",
          name: "Doors of Night",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/DoorsofNight.jpg",
          unique: false,
          eventType: "permanent",
          keywords: [
            "environment"
          ],
          effects: [
            {
              type: "duplication-limit",
              scope: "game",
              max: 1
            },
            {
              type: "on-event",
              event: "self-enters-play",
              apply: {
                type: "move",
                select: "filter-all",
                from: "in-play",
                to: "discard",
                filter: {
                  cardType: "hero-resource-event",
                  keywords: {
                    $includes: "environment"
                  }
                }
              }
            }
          ],
          text: "Environment. When Doors of Night is played, all resource environment cards in play are immediately discarded, and all resource environment effects are canceled. Cannot be duplicated.",
          certified: "2026-04-01"
        },
        {
          cardType: "hazard-event",
          id: "tw-32",
          name: "Eye of Sauron",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/EyeofSauron.jpg",
          unique: false,
          eventType: "long",
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              target: "all-automatic-attacks",
              id: "eye-of-sauron-prowess"
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 3,
              target: "all-automatic-attacks",
              overrides: "eye-of-sauron-prowess",
              when: {
                inPlay: "Doors of Night"
              }
            }
          ],
          text: "The prowess of each automatic-attack is increased by one. Alternatively, if Doors of Night is in play, the prowess of each automatic-attack is increased by three.",
          certified: "2026-04-06"
        },
        {
          cardType: "hazard-event",
          id: "tw-108",
          name: "Wake of War",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/WakeofWar.jpg",
          unique: false,
          eventType: "long",
          effects: [
            {
              type: "duplication-limit",
              scope: "game",
              max: 1
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              target: "all-attacks",
              id: "wake-of-war-prowess",
              when: {
                "enemy.race": {
                  $in: [
                    "wolf",
                    "spider",
                    "animal"
                  ]
                }
              }
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 2,
              target: "all-attacks",
              overrides: "wake-of-war-prowess",
              when: {
                $and: [
                  {
                    "enemy.race": "wolf"
                  },
                  {
                    inPlay: "Doors of Night"
                  }
                ]
              }
            },
            {
              type: "stat-modifier",
              stat: "strikes",
              value: 1,
              target: "all-attacks",
              id: "wake-of-war-strikes",
              when: {
                "enemy.race": {
                  $in: [
                    "wolf",
                    "spider",
                    "animal"
                  ]
                }
              }
            },
            {
              type: "stat-modifier",
              stat: "strikes",
              value: 2,
              target: "all-attacks",
              overrides: "wake-of-war-strikes",
              when: {
                $and: [
                  {
                    "enemy.race": "wolf"
                  },
                  {
                    inPlay: "Doors of Night"
                  }
                ]
              }
            }
          ],
          text: "The number of strikes and prowess of each Wolf, Spider, and Animal attack are each increased by one (by two for Wolf attacks if Doors of Night is in play). Cannot be duplicated.",
          certified: "2026-04-06"
        },
        {
          cardType: "hazard-event",
          id: "tw-106",
          name: "Twilight",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Twilight.jpg",
          unique: false,
          eventType: "short",
          keywords: [
            "environment"
          ],
          effects: [
            {
              type: "play-flag",
              flag: "playable-as-resource"
            },
            {
              type: "play-flag",
              flag: "no-hazard-limit"
            }
          ],
          certified: "2026-04-06",
          text: "Environment. One environment card (in play or declared earlier in the same chain of effects) is canceled and discarded. Twilight may also be played as a resource, may be played at any point during any player's turn and does not count against the hazard limit."
        },
        {
          cardType: "hazard-event",
          id: "tw-21",
          name: "Choking Shadows",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/ChokingShadows.jpg",
          unique: false,
          eventType: "short",
          keywords: [
            "environment"
          ],
          effects: [
            {
              type: "duplication-limit",
              scope: "turn",
              max: 1
            },
            {
              type: "on-event",
              event: "company-arrives-at-site",
              when: {
                $and: [
                  {
                    "environment.doorsOfNightInPlay": true
                  },
                  {
                    "company.destinationSiteType": "ruins-and-lairs"
                  }
                ]
              },
              apply: {
                type: "add-constraint",
                constraint: "site-type-override",
                overrideType: "shadow-hold",
                scope: "turn"
              }
            },
            {
              type: "on-event",
              event: "company-arrives-at-site",
              when: {
                $and: [
                  {
                    "environment.doorsOfNightInPlay": true
                  },
                  {
                    "company.destinationRegionType": "wilderness"
                  }
                ]
              },
              apply: {
                type: "add-constraint",
                constraint: "region-type-override",
                overrideType: "shadow",
                regionName: "destination",
                scope: "turn"
              }
            },
            {
              type: "on-event",
              event: "company-arrives-at-site",
              when: {
                "company.destinationSiteType": "ruins-and-lairs"
              },
              apply: {
                type: "add-constraint",
                constraint: "auto-attack-prowess-boost",
                value: 2,
                siteType: "ruins-and-lairs",
                scope: "company-site-phase"
              }
            }
          ],
          text: "Environment. Modify the prowess of one automatic-attack at a Ruins & Lairs site by +2. Alternatively, if Doors of Night is in play, treat one Wilderness as a Shadow-land or one Ruins & Lairs as a Shadow-hold until the end of the turn. Cannot be duplicated.",
          certified: "2026-04-14"
        },
        {
          cardType: "hazard-event",
          id: "tw-61",
          name: "Minions Stir",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MinionsStir.jpg",
          unique: false,
          eventType: "long",
          effects: [
            {
              type: "duplication-limit",
              scope: "game",
              max: 1
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              target: "all-attacks",
              id: "minions-stir-orc-prowess",
              when: {
                "enemy.race": "orc"
              }
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 2,
              target: "all-attacks",
              overrides: "minions-stir-orc-prowess",
              when: {
                $and: [
                  {
                    "enemy.race": "orc"
                  },
                  {
                    inPlay: "Doors of Night"
                  }
                ]
              }
            },
            {
              type: "stat-modifier",
              stat: "strikes",
              value: 1,
              target: "all-attacks",
              id: "minions-stir-orc-strikes",
              when: {
                "enemy.race": "orc"
              }
            },
            {
              type: "stat-modifier",
              stat: "strikes",
              value: 2,
              target: "all-attacks",
              overrides: "minions-stir-orc-strikes",
              when: {
                $and: [
                  {
                    "enemy.race": "orc"
                  },
                  {
                    inPlay: "Doors of Night"
                  }
                ]
              }
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              target: "all-attacks",
              when: {
                "enemy.race": "troll"
              }
            },
            {
              type: "stat-modifier",
              stat: "strikes",
              value: 1,
              target: "all-attacks",
              when: {
                "enemy.race": "troll"
              }
            }
          ],
          text: "The number of strikes and prowess of each Orc and Troll attack are each increased by one (by two for Orc attacks if Doors of Night is in play). Cannot be duplicated.",
          certified: "2026-04-14"
        },
        {
          cardType: "hazard-event",
          id: "tw-18",
          name: "Call of Home",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/CallofHome.jpg",
          unique: false,
          eventType: "short",
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                $and: [
                  {
                    "target.race": {
                      $ne: "wizard"
                    }
                  },
                  {
                    "target.race": {
                      $ne: "ringwraith"
                    }
                  },
                  {
                    $not: {
                      "target.possessions": {
                        $includes: "The One Ring"
                      }
                    }
                  }
                ]
              }
            },
            {
              type: "call-of-home-check",
              threshold: 10
            }
          ],
          text: "Playable on a non-Ringwraith, non-Wizard character not bearing The One Ring. The character's player makes a roll. The character returns to his player's hand if the result plus his player's unused general influence is less than 10. Any one item held by the removed character may automatically be transferred to another character in his company (all other non-follower cards he controls are discarded).",
          certified: "2026-04-14"
        },
        {
          cardType: "hazard-event",
          id: "tw-67",
          name: "Muster Disperses",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/MusterDisperses.jpg",
          unique: false,
          eventType: "short",
          effects: [
            {
              type: "play-target",
              target: "faction"
            }
          ],
          text: "Playable on a faction. The faction's player makes a roll. The faction is discarded if the result plus his unused general influence is less than 11.",
          certified: "2026-04-14"
        },
        {
          cardType: "hazard-event",
          id: "tw-84",
          name: "River",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/River.jpg",
          unique: false,
          eventType: "short",
          effects: [
            {
              type: "play-target",
              target: "site"
            },
            {
              type: "on-event",
              event: "company-arrives-at-site",
              target: "arriving-company",
              apply: {
                type: "sequence",
                apps: [
                  {
                    type: "add-constraint",
                    constraint: "site-phase-do-nothing",
                    scope: "company-site-phase"
                  },
                  {
                    type: "add-constraint",
                    constraint: "granted-action",
                    scope: "company-site-phase",
                    grantedAction: {
                      action: "cancel-river",
                      cost: {
                        tap: "character"
                      },
                      when: {
                        $and: [
                          {
                            "actor.skills": {
                              $includes: "ranger"
                            }
                          },
                          {
                            "actor.status": "untapped"
                          }
                        ]
                      },
                      apply: {
                        type: "remove-constraint",
                        select: "constraint-source"
                      }
                    }
                  }
                ]
              }
            }
          ],
          text: "Playable on a site. A company moving to this site this turn must do nothing during its site phase. A ranger in such a company may tap to cancel this effect, even at the start of his company's site phase.",
          certified: "2026-04-08"
        },
        {
          cardType: "hazard-event",
          id: "tw-53",
          name: "Lost in Free-domains",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/LostinFreedomains.jpg",
          unique: false,
          eventType: "permanent",
          effects: [
            {
              type: "play-target",
              target: "company"
            },
            {
              type: "on-event",
              event: "self-enters-play",
              apply: {
                type: "add-constraint",
                constraint: "site-phase-do-nothing",
                scope: "company-site-phase"
              },
              target: "target-company"
            }
          ],
          text: "Playable on a company moving with a Free-domain in its site path. The company may do nothing during its site phase.",
          certified: "2026-04-08"
        },
        {
          cardType: "hazard-event",
          id: "tw-60",
          name: "Lure of the Senses",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/LureoftheSenses.jpg",
          unique: false,
          eventType: "permanent",
          keywords: ["corruption"],
          effects: [
            {
              type: "play-target",
              target: "character"
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            },
            {
              type: "stat-modifier",
              stat: "corruption-points",
              value: 2
            },
            {
              type: "on-event",
              event: "untap-phase-end",
              when: {
                "bearer.atHaven": true
              },
              apply: {
                type: "force-check",
                check: "corruption"
              },
              target: "bearer"
            },
            {
              type: "grant-action",
              action: "remove-self-on-roll",
              cost: {
                tap: "bearer"
              },
              apply: {
                type: "roll-then-apply",
                threshold: 7,
                onSuccess: {
                  type: "move",
                  select: "self",
                  from: "self-location",
                  to: "discard"
                }
              }
            }
          ],
          text: "Corruption. Playable on a non-Ringwraith character. Target character receives 2 corruption points and makes a corruption check at the end of his untap phase if at a Haven/Darkhaven. During his organization phase, the character may tap to attempt to remove this card. Make a roll\u2014if the result is greater than 6, discard this card. Cannot be duplicated on a given character.",
          certified: "2026-04-08"
        },
        {
          cardType: "hazard-event",
          id: "tw-27",
          name: "Despair of the Heart",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/DespairoftheHeart.jpg",
          text: "Corruption. Playable on a non-Hobbit, non-Wizard, non-Ringwraith character. Target character receives 2 corruption points and makes a corruption check each time a character in his company becomes wounded. During his organization phase, the character may tap to attempt to remove this card. Make a roll\u2014if the result is greater than 4, discard this card. Cannot be duplicated on a given character.",
          unique: false,
          eventType: "permanent"
        },
        {
          cardType: "hazard-event",
          id: "tw-36",
          name: "Foul Fumes",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/FoulFumes.jpg",
          text: "Environment. Each moving company that has a Shadow-land [{s}] or a Dark-domain [{d}] in its site path must return to its site of origin unless it contains a ranger. Additionally, if Doors of Night is in play, each non-Haven site in play with a Shadow-land [{s}] or a Dark-domain [{d}] in its site path is tapped. This card has no effect on a minion player. Cannot be duplicated.",
          unique: false,
          eventType: "long"
        },
        {
          cardType: "hazard-event",
          id: "tw-91",
          name: "Snowstorm",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/Snowstorm.jpg",
          text: "Environment. Playable if Doors of Night is in play. Each moving company with a Wilderness [{w}] in its site path must return to its site of origin. Cannot be duplicated.",
          unique: false,
          eventType: "long"
        },
        {
          cardType: "hazard-event",
          id: "tw-99",
          name: "The Ring\u2019s Betrayal",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/TheRingsBetrayal.jpg",
          text: "The bearer of a Ring must make a corruption check modified by -2. If the bearer fails this corruption check, his Ring is discarded, but he remains in play.",
          unique: false,
          eventType: "short",
          keywords: ["Corruption"],
          certified: "2026-04-25",
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: { "target.itemKeywords": { $includes: "ring" } },
              cost: { check: "corruption", modifier: -2, failureMode: "discard-ring-only" }
            }
          ]
        },
        {
          cardType: "hazard-event",
          id: "tw-29",
          name: "Dragon\u2019s Desolation",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/tw/DragonsDesolation.jpg",
          unique: false,
          eventType: "short",
          certified: "2026-04-22",
          effects: [
            {
              type: "play-flag",
              flag: "no-hazard-limit"
            },
            {
              type: "modify-attack-from-hand",
              player: "attacker",
              prowessModifier: 2,
              when: {
                "enemy.race": "dragon"
              }
            },
            {
              type: "play-condition",
              requires: "site-path",
              condition: {
                $and: [
                  { destinationSiteType: "ruins-and-lairs" },
                  {
                    $or: [
                      { "sitePath.wildernessCount": { $gte: 2 } },
                      {
                        $and: [
                          { "sitePath.wildernessCount": { $gte: 1 } },
                          { inPlay: "Doors of Night" }
                        ]
                      }
                    ]
                  }
                ]
              }
            },
            {
              type: "creature-race-choice",
              exclude: [],
              fixedRace: "dragon",
              apply: {
                type: "add-constraint",
                constraint: "creature-keying-bypass",
                scope: "company-mh-phase"
              }
            }
          ],
          text: "The prowess of one Dragon attack is modified by +2.Alternatively, it may be played on a Ruins & Lairs [{R}] site that has two Wildernesses [{w}] in its site path (only one Wilderness [{w}] is required if Doors of Night is in play)\u2014one Dragon hazard creature may be played on a company at that site this turn.\u201C\u2026 there was neither bush nor tree, and only broken and blackened stumps\u2026\u201D \u2014Hob"
        }
      ];
    }
  });

  // ../shared/src/data/as-characters.json
  var as_characters_default;
  var init_as_characters = __esm({
    "../shared/src/data/as-characters.json"() {
      as_characters_default = [
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "as-4",
          name: "Perchen",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Perchen.jpg",
          unique: true,
          race: "man",
          skills: [
            "scout",
            "diplomat"
          ],
          prowess: 3,
          body: 9,
          mind: 5,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Dunnish Clan-hold",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 3,
              when: {
                reason: "faction-influence-check",
                "faction.playableAt": "Dunnish Clan-hold"
              }
            }
          ],
          text: "Unique. +3 direct influence against any faction playable at Dunnish Clan-hold.",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "as-3",
          name: "Mionid",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Mionid.jpg",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 5,
          body: 8,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Variag Camp",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.playableAt": "Variag Camp"
              }
            }
          ],
          text: "Unique. +2 direct influence against any faction playable at Variag Camp.",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "as-6",
          name: "W\xFBluag",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Wuluag.jpg",
          unique: true,
          race: "troll",
          skills: [
            "warrior",
            "scout"
          ],
          prowess: 5,
          body: 8,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any non-Under-deeps Ruins & Lairs",
          effects: [],
          text: `Unique. Manifestation of "William". May not be included with a starting company. May be played on the same turn B\xFBrat and/or T\xFBma is played, without counting against the one character per turn limit. Discard on a body check result of 8. +1 prowess against Dwarves. Tap W\xFBluag to untap B\xFBrat or T\xFBma if at the same site. If B\xFBrat and/or T\xFBma is in his company, W\xFBluag's mind is reduced by one.`
        },
        {
          cardType: "minion-character",
          id: "as-1",
          name: "B\xFBrat",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Burat.jpg",
          text: "Unique. Manifestation of \u201CBert\u201D. May not be included with a starting company. May be played on the same turn T\xFBma and/or W\xFBluag is played, without counting against the one character per turn limit. Discard on a body check result of 8. +1 prowess against Dwarves. Tap B\xFBrat to untap T\xFBma or W\xFBluag if at the same site. If T\xFBma and/or W\xFBluag is in his company, B\xFBrat\u2019s mind is reduced by one.",
          alignment: "ringwraith",
          unique: true,
          race: "troll",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 5,
          body: 8,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any non-Under-deeps Ruins & Lairs"
        },
        {
          cardType: "minion-character",
          id: "as-5",
          name: "T\xFBma",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Tuma.jpg",
          text: "Unique. Manifestation of \u201CTom\u201D. May not be included with a starting company. May be played on the same turn B\xFBrat and/or W\xFBluag is played, without counting against the one character per turn limit. Discard on a body check result of 8. +1 prowess against Dwarves. Tap T\xFBma to untap B\xFBrat or W\xFBluag if at the same site. If B\xFBrat and/or W\xFBluag is in his company, T\xFBma\u2019s mind is reduced by one.",
          alignment: "ringwraith",
          unique: true,
          race: "troll",
          skills: [
            "warrior"
          ],
          prowess: 6,
          body: 8,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any non-Under-deeps Ruins & Lairs"
        }
      ];
    }
  });

  // ../shared/src/data/as-creatures.json
  var as_creatures_default;
  var init_as_creatures = __esm({
    "../shared/src/data/as-creatures.json"() {
      as_creatures_default = [
        {
          cardType: "hazard-creature",
          id: "as-21",
          name: "Stout Men of Gondor",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/StoutMenofGondor.jpg",
          text: "Men. Six strikes. Detainment against hero and covert companies. May be played keyed to Old P\xFBkel-land, Old P\xFBkel Gap, Andrast, Anfalas, Lamedon, Belfalas, Lebennin, An\xF3rien, or Rohan; or at sites in these regions.",
          unique: false,
          strikes: 6,
          prowess: 7,
          body: null,
          killMarshallingPoints: 1,
          race: "men",
          keyedTo: []
        }
      ];
    }
  });

  // ../shared/src/data/as-hazards.json
  var as_hazards_default;
  var init_as_hazards = __esm({
    "../shared/src/data/as-hazards.json"() {
      as_hazards_default = [
        {
          cardType: "hazard-corruption",
          id: "as-24",
          name: "Alone and Unadvised",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/AloneandUnadvised.jpg",
          unique: false,
          corruptionPoints: 4,
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                $and: [
                  {
                    "target.race": {
                      $ne: "wizard"
                    }
                  },
                  {
                    "target.race": {
                      $ne: "ringwraith"
                    }
                  }
                ]
              },
              maxCompanySize: 3
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            },
            {
              type: "on-event",
              event: "end-of-company-mh",
              apply: {
                type: "force-check",
                check: "corruption"
              },
              target: "bearer",
              perRegion: true
            },
            {
              type: "check-modifier",
              check: "corruption",
              value: "company.characterCount"
            },
            {
              type: "grant-action",
              action: "remove-self-on-roll",
              cost: {
                tap: "bearer"
              },
              apply: {
                type: "roll-then-apply",
                threshold: 7,
                onSuccess: {
                  type: "move",
                  select: "self",
                  from: "self-location",
                  to: "discard"
                }
              }
            },
            {
              type: "on-event",
              event: "company-composition-changed",
              apply: {
                type: "move",
                select: "self",
                from: "self-location",
                to: "discard"
              },
              when: {
                "company.characterCount": {
                  $gte: 4
                }
              }
            }
          ],
          text: "Corruption. Playable on a non-Wizard, non-Ringwraith character in a company with 3 or fewer characters. Target character makes a corruption check at the end of his movement/hazard phase for each region he moved through. All of his corruption checks are modified by adding the number of characters in his company. During his organization phase, the character may tap to attempt to remove this card. Make a roll\u2014if the result is greater than 6, discard this card. Discard this card if his company has 4 or more characters. Cannot be duplicated on a given character.",
          certified: "2026-04-14"
        },
        {
          cardType: "hazard-event",
          id: "as-39",
          name: "Summons from Long Sleep",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/SummonsfromLongSleep.jpg",
          unique: false,
          eventType: "permanent",
          effects: [],
          text: "This card reserves up to one Dragon or Drake hazard creature at a time. To reserve a Dragon or Drake creature, place it face up \u201Coff to the side\u201D with this card (not counting against the hazard limit). You may play a reserved creature as though it were in your hand. Discard this card after the reserved creature attacks. A reserved Dragon or Drake receives +2 prowess when attacking."
        },
        {
          cardType: "hazard-event",
          id: "as-30",
          name: "Full of Froth and Rage",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/FullofFrothandRage.jpg",
          text: "All Spider and Animal attacks receive +2 prowess. Discard if a Spider or Animal attack is defeated. Cannot be duplicated.",
          unique: false,
          eventType: "permanent"
        },
        {
          cardType: "hazard-event",
          id: "as-34",
          name: "Power Built by Waiting",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/PowerBuiltbyWaiting.jpg",
          text: "Tap during a company\u2019s movement/hazard phase to increase the hazard limit against that company by one. This card does not untap during your untap phase. You may use two against a company\u2019s hazard limit to untap this card.",
          unique: false,
          eventType: "permanent"
        }
      ];
    }
  });

  // ../shared/src/data/as-sites.json
  var as_sites_default;
  var init_as_sites = __esm({
    "../shared/src/data/as-sites.json"() {
      as_sites_default = [
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "as-169",
          name: "Weathertop",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Weathertop.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "shadow",
            "wilderness"
          ],
          nearestHaven: "Carn D\xFBm",
          region: "Arthedain",
          playableResources: [
            "information"
          ],
          automaticAttacks: [
            {
              creatureType: "Wolves",
              strikes: 2,
              prowess: 6
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Playable: Information. Automatic-attacks: Wolves \u2014 2 strikes with 6 prowess.",
          certified: "2026-04-21"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "as-142",
          name: "The Worthy Hills",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/TheWorthyHills.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Rivendell",
          region: "Cardolan",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 2,
          text: "Nearest Haven: RivendellPlayable: InformationAutomatic-attacks: Men \u2014 each character faces 1 strike with 9 prowess (detainment).Special: During the site phase, you may tap two characters to untap this site\u2014one a sage, one a scout."
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "as-144",
          name: "Eagles' Eyrie",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/EaglesEyrie.jpg",
          siteType: "free-hold",
          sitePath: [
            "dark",
            "shadow"
          ],
          nearestHaven: "Dol Guldur",
          region: "Anduin Vales",
          playableResources: [
            "information",
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Animals",
              strikes: 2,
              prowess: 10,
              special: "attacker chooses defending characters"
            }
          ],
          resourceDraws: 1,
          hazardDraws: 2,
          text: "Playable: Information, Items (minor, major). Automatic-attacks: Animals \u2014 2 strikes with 10 prowess (attacker chooses defending characters).",
          certified: "2026-04-19"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "as-143",
          name: "Dancing Spire",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/DancingSpire.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "dark",
            "wilderness",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Dol Guldur",
          region: "Withered Heath",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 2,
              prowess: 11
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (minor, major, greater, gold ring) Automatic-attacks: Dragon \u2014 2 strikes with 11 prowess"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "as-148",
          name: "Gold Hill",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/GoldHill.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "dark",
            "wilderness",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Dol Guldur",
          region: "Withered Heath",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 15
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (minor, major, greater, gold ring) Automatic-attacks: Dragon \u2014 1 strike with 15 prowess"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "as-151",
          name: "Irerock",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Irerock.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "dark",
            "wilderness",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Dol Guldur",
          region: "Withered Heath",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 14
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (minor, major, greater, gold ring) Automatic-attacks: Dragon \u2014 1 strike with 14 prowess"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "as-153",
          name: "Isle of the Ulond",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/IsleoftheUlond.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "wilderness",
            "coastal"
          ],
          nearestHaven: "Geann a-Lisch",
          region: "Andrast Coast",
          playableResources: [
            "information",
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 14
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Darkhaven: Geann a-Lisch Playable: Information, Items (minor, major) Automatic-attacks: Dragon \u2014 1 strike with 14 prowess Special: An overt company must tap an untapped character (if available) if this site is revealed as its new site."
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "as-157",
          name: "Ovir Hollow",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/OvirHollow.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "dark",
            "wilderness",
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Dol Guldur",
          region: "Grey Mountain Narrows",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 12
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (minor, major) Automatic-attacks: Dragon \u2014 1 strike with 12 prowess"
        },
        {
          cardType: "hero-site",
          id: "as-139",
          name: "Gobel M\xEDrlond",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/GobelMirlond.jpg",
          text: "Nearest Haven: Edhellond Playable: Items (minor, major) Automatic-attacks: Men \u2014 4 strikes with 9 prowess (detainment)",
          alignment: "wizard",
          siteType: "border-hold",
          sitePath: [
            "wilderness",
            "free",
            "coastal",
            "wilderness"
          ],
          nearestHaven: "Edhellond",
          region: "Harondor",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Men",
              strikes: 4,
              prowess: 9
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2
        },
        {
          cardType: "hero-site",
          id: "as-141",
          name: "Raider-hold",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Raiderhold.jpg",
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major) Automatic-attacks: Men \u2014 4 strikes with 9 prowess (detainment)",
          alignment: "wizard",
          siteType: "border-hold",
          sitePath: [
            "wilderness",
            "shadow",
            "shadow",
            "shadow"
          ],
          nearestHaven: "L\xF3rien",
          region: "Horse Plains",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Men",
              strikes: 4,
              prowess: 9
            }
          ],
          resourceDraws: 3,
          hazardDraws: 4
        }
      ];
    }
  });

  // ../shared/src/data/as-resources.json
  var as_resources_default;
  var init_as_resources = __esm({
    "../shared/src/data/as-resources.json"() {
      as_resources_default = [
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "as-90",
          name: "Join With That Power",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/JoinWithThatPower.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Diplomat only. One influence check or corruption check by a character in a diplomat\u2019s company receives a bonus equal to the number of characters in the company minus one. Cannot be duplicated on a given check."
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "as-101",
          name: "Tokens to Show",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/TokenstoShow.jpg",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Minion characters may store resources (items and events) during the end-of-turn phase as though it were their organization phase. Cannot be duplicated. Discard when any play deck is exhausted."
        },
        {
          cardType: "hero-resource-faction",
          alignment: "wizard",
          id: "as-67",
          name: "Woses of the Eryn Vorn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/WosesoftheErynVorn.jpg",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 11,
          race: "wose",
          playableAt: [
            {
              site: "The"
            }
          ],
          effects: [],
          text: "Unique. Manifestation of minion Woses of the Eryn Vorn. Playable at The Worthy Hills if the influence check is greater than 10. Standard Modifications: none."
        },
        {
          cardType: "minion-resource-ally",
          alignment: "ringwraith",
          id: "as-76",
          name: "Regiment of Black Crows",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/RegimentofBlackCrows.jpg",
          unique: false,
          prowess: null,
          body: null,
          marshallingPoints: 1,
          marshallingCategory: "ally",
          playableAt: [
            {
              site: "a tapped or untapped non-Under-deeps Ruins & Lairs [{R}]"
            }
          ],
          effects: [],
          text: "Playable at a tapped or untapped non-Under-deeps Ruins & Lairs [{R}]. Its controlling character's company is overt. May not be attacked. Discard this ally if its controlling character is wounded. Tap this ally to cancel a hazard creature attack against his company not keyed to a site and to put the creature\u2019s card back into its player\u2019s hand. Cannot be duplicated in a given company."
        },
        {
          cardType: "minion-resource-event",
          id: "as-102",
          name: "The Tormented Earth",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/TheTormentedEarth.jpg",
          text: "Magic. Sorcery. Playable on a sorcery-using character facing a non-automatic-attack. Cancels the attack or gives the attack -3 prowess, your choice. Unless he is a Ringwraith, character makes a corruption check modified by -4. Cannot be duplicated against a given attack.",
          alignment: "ringwraith",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "as-108",
          name: "Well-preserved",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Wellpreserved.jpg",
          text: "Magic. Shadow-magic. Playable on a wounded character in a company with a shadow-magic-using character. Wounded character becomes untapped with -1 to body. Discard at the end of his untap phase if at a Darkhaven [{DH}]. Unless the shadow-magic-user is a Ringwraith, he makes a corruption check modified by -3.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-faction",
          id: "as-111",
          name: "Asdriags",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Asdriags.jpg",
          text: "Unique. Playable at N\xFBrniag Camp if the influence check is greater than 10. Standard Modifications: N\xFBrniags (+2), Variags of Khand (+2), Balchoth (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "man",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "as-114",
          name: "Corsairs of Rh\xFBn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/CorsairsofRhun.jpg",
          text: "Unique. Playable at Raider-hold if the influence check is greater than 9. Standard Modifications: Easterlings (+2), Men of Dorwinion (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "man",
          playableAt: []
        },
        {
          cardType: "hero-resource-event",
          id: "as-49",
          name: "Glamour of Surpassing Excellance",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/GlamourofSurpassingExcellance.jpg",
          text: "Playable on a company at a Border-hold [{B}] or Free-hold [{F}]. Make a roll for each hazard permanent-event on characters in the company. Discard each hazard whose roll is greater than the number normally needed to remove it as printed on the card (ignoring all modifiers and conditions). If no number is given, the permanent-event is discarded if its result is greater than 8. Cannot be included in a Fallen-wizard's deck.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-event",
          id: "as-54",
          name: "Safe from the Shadow",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/SafefromtheShadow.jpg",
          text: "Hero characters may store resources (items and events) during the end-of-turn phase as though it were their organization phase. Cannot be duplicated. Discard when any play deck is exhausted.",
          alignment: "wizard",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            { type: "play-flag", flag: "allow-store-eot" },
            { type: "duplication-limit", scope: "game", max: 1 },
            { type: "on-event", event: "play-deck-exhausted", apply: { type: "discard-self" } }
          ],
          certified: "2026-04-24"
        },
        {
          cardType: "hero-resource-faction",
          id: "as-60",
          name: "Wain-easterlings",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Waineasterlings.jpg",
          text: "Unique. Manifestation of minion Wain- easterlings. Playable at Easterling Camp if the influence check is greater than 8. Standard Modifications: Wizards (-5), D\xFAnedain (-2).",
          alignment: "wizard",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "man",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "as-63",
          name: "Haradrim",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Haradrim.jpg",
          text: "Unique. Playable at Southron Oasis if the influence check is greater than 9. Standard Modifications: Southrons (+2), Variags of Khand (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "man",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "as-66",
          name: "Wain-easterlings",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/Waineasterlings.jpg",
          text: "Unique. Playable at Easterling Camp if the influence check is greater than 9. Standard Modifications: Easterlings (+2), N\xFBriags (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "man",
          playableAt: []
        },
        {
          cardType: "minion-resource-ally",
          id: "as-74",
          name: "Great Bats",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/GreatBats.jpg",
          text: "Playable at a tapped or untapped Shadow-hold [{S}]. Its controlling character's company is overt. May not be attacked. Discard this ally if its controlling character is wounded. Tap this ally to remove the effect of an attack against its controlling character\u2019s company that states: \u201Cattacker chooses defending characters.\u201D Cannot be duplicated in a given company.",
          alignment: "ringwraith",
          unique: false,
          prowess: 0,
          body: 0,
          mind: 1,
          marshallingPoints: 1,
          marshallingCategory: "ally",
          playableAt: []
        },
        {
          cardType: "minion-resource-ally",
          id: "as-75",
          name: "Great Lord of Goblin-gate",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/GreatLordofGoblingate.jpg",
          text: "Unique. Playable at Goblin-gate. Orc. Manifestation of The Great Goblin. Its controlling character's company is overt. Tap to give +2 prowess to all Orcs in its company: against one attack or in company versus company combat.",
          alignment: "ringwraith",
          unique: true,
          prowess: 5,
          body: 7,
          mind: 3,
          marshallingPoints: 2,
          marshallingCategory: "ally",
          playableAt: []
        },
        {
          cardType: "minion-resource-event",
          id: "as-77",
          name: "Above the Abyss",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/AbovetheAbyss.jpg",
          text: "Playable on a tapped non-Ringwraith character if your opponent is a Wizard and your Ringwraith is in play. Untap target character. Cannot be included in a Balrog's deck.",
          alignment: "ringwraith",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "as-88",
          name: "Hold Rebuilt and Repaired",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/HoldRebuiltandRepaired.jpg",
          text: "Playable during the site phase on a non-Dragon\u2019s lair, non-Under-deeps Ruins & Lairs [{R}]. The site becomes a Shadow-hold [{S}] and all automatic-attacks become detainment. Discard this card when the site is discarded or returned to its location deck.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "as-94",
          name: "Orders from Lugb\xFArz",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/OrdersfromLugburz.jpg",
          text: "Playable on a company. May be played with a starting company in lieu of a minor item. This company may contain a Troll leader in addition to another leader. +1 to all corruption checks by followers of Troll leaders in this company. Discard if Ren is your Ringwraith or when a leader leaves the company. Cannot be duplicated on a given company. Cannot be included in a Balrog's deck.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        }
      ];
    }
  });

  // ../shared/src/data/as-items.json
  var as_items_default;
  var init_as_items = __esm({
    "../shared/src/data/as-items.json"() {
      as_items_default = [
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "as-128",
          name: "Necklace of Girion",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/NecklaceofGirion.jpg",
          unique: true,
          subtype: "special",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 3,
          marshallingCategory: "item",
          corruptionPoints: 3,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Unique. Playable at The Lonely Mountain. Bearer receives +3 direct influence against Men and Man factions. If bearer is at a Border-hold [{B}] during the site phase, he can make a corruption check, and, if successful, discard this item to play up to 3 non-unique minor and/or major items with his company. Characters need not tap to receive these items."
        },
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "as-129",
          name: "Old Treasure",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/OldTreasure.jpg",
          unique: false,
          subtype: "minor",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Hoard item. +1 direct influence. Discard this item to give +4 direct influence to bearer until the end of the turn."
        },
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "as-132",
          name: "Thong of Fire",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/ThongofFire.jpg",
          unique: true,
          subtype: "greater",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 3,
          marshallingCategory: "item",
          corruptionPoints: 3,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Unique. Hoard item. Weapon. May only be borne by a character with a prowess of 6 or more. Warrior only: +1 body; +1 prowess; if bearer chooses not to tap against a strike, he receives no prowess penalty."
        },
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "as-136",
          name: "Usriev of Treachery",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/UsrievofTreachery.jpg",
          unique: false,
          subtype: "major",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 1,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Hoard item. Weapon. May only be born by a character with a prowess of 5 or more. Warrior only: +1 prowess to a maximum of 8 (+2 against Elves to a maximum of 9); if you assign a strike to the bearer, you may choose to assign a second strike to the bearer. The bearer faces an additional strike sequence."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "as-70",
          name: "Jewel of Beleriand",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/JewelofBeleriand.jpg",
          unique: false,
          subtype: "minor",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Hoard item. Tap this item and make a roll \u2014if the result is greater than 6, the bearer untaps if tapped. Cannot be duplicated on a given character."
        },
        {
          cardType: "minion-resource-item",
          id: "as-123",
          name: "Dwarven Ring of Th\xE9lor\u2019s Tribe",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/DwarvenRingofThelorsTribe.jpg",
          text: "Unique. Dwarven Ring. Playable only with a gold ring and after a test indicates a Dwarven Ring. Values in parentheses apply to a Dwarf bearer. Tap a Dwarf bearer to search your play deck and/or your discard pile for any one or two minor items; place these items in your hand and reshuffle your play deck. Bearer then makes a corruption check modified by +2.",
          alignment: "ringwraith",
          unique: true,
          subtype: "special",
          marshallingPoints: 4,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          keywords: [
            "ring"
          ]
        },
        {
          cardType: "minion-resource-item",
          id: "as-124",
          name: "Dwarven Ring of Thr\xE1r\u2019s Tribe",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/DwarvenRingofThrarsTribe.jpg",
          text: "Unique. Dwarven Ring. Playable only with a gold ring and after a test indicates a Dwarven Ring. Values in parentheses apply to a Dwarf bearer. Tap a Dwarf bearer to search your play deck and/or your discard pile for any one or two minor items; place these items in your hand and reshuffle your play deck. Bearer then makes a corruption check modified by +2.",
          alignment: "ringwraith",
          unique: true,
          subtype: "special",
          marshallingPoints: 4,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          keywords: [
            "ring"
          ]
        },
        {
          cardType: "minion-resource-item",
          id: "as-126",
          name: "Helm of Fear",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/HelmofFear.jpg",
          text: "Unique. Playable at a tapped or untapped Barad-d\xFBr and only on your Ringwraith (does not tap the site). This item only affects a Ringwraith. Tap this item to cancel an attack against the Ringwraith\u2019s company. May not cancel combat with a hero company. All body checks against the bearer are modified by -1. Cannot be included in a Balrog's deck.",
          alignment: "ringwraith",
          unique: true,
          subtype: "special",
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "minion-resource-item",
          id: "as-130",
          name: "Records Unread",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/RecordsUnread.jpg",
          text: "Cannot be included with a starting company. Discard: to untap a Shadow-hold [{S}] or to make Information playable at any Shadow-hold [{S}]. Cannot be duplicated in a given company.",
          alignment: "ringwraith",
          unique: false,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "minion-resource-item",
          id: "as-131",
          name: "Secret Book",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/SecretBook.jpg",
          text: "Cannot be included with a starting company. Discard: to untap a Free-hold [{F}] or Border-hold [{B}] or to make Information playable at any Ruins & Lairs [{R}]. Cannot be duplicated in a given company.",
          alignment: "ringwraith",
          unique: false,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "minion-resource-item",
          id: "as-134",
          name: "Thr\xF3r\u2019s Map",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/ThrorsMap.jpg",
          text: "Unique. Discard Thr\xF3r\u2019s Map to untap a site with a Dragon automatic-attack.",
          alignment: "ringwraith",
          unique: true,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "hero-resource-item",
          id: "as-68",
          name: "Bow of the Galadhrim",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/as/BowoftheGaladhrim.jpg",
          text: "Unique. The following effect applies only if the bearer is an Elf Warrior. In company versus company combat, make a roll before strikes are assigned for each non-unique minion ally in the company the bearer is facing. If the result for an ally is greater than the ally\u2019s mind plus five, discard the ally.",
          alignment: "wizard",
          unique: true,
          subtype: "major",
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        }
      ];
    }
  });

  // ../shared/src/data/le-characters.json
  var le_characters_default;
  var init_le_characters = __esm({
    "../shared/src/data/le-characters.json"() {
      le_characters_default = [
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-24",
          name: "The Mouth",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TheMouth.jpg",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "diplomat"
          ],
          prowess: 6,
          body: 8,
          mind: 9,
          directInfluence: 4,
          marshallingPoints: 3,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Barad-d\xFBr",
          manifestId: "tw-65",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check"
              }
            },
            {
              type: "grant-action",
              action: "recall-to-deck",
              cost: { tap: "self" },
              apply: {
                type: "enqueue-pending-fetch",
                fetchFrom: ["discard-pile"],
                fetchCount: 1,
                fetchShuffle: true,
                filter: {
                  cardType: {
                    $in: [
                      "minion-character",
                      "minion-resource-item",
                      "minion-resource-ally",
                      "minion-resource-faction",
                      "minion-resource-event"
                    ]
                  }
                }
              }
            }
          ],
          text: "Unique. Manifestation of Mouth of Sauron. +2 direct influence against any faction. Tap during your organization phase to move one resource or character from your discard pile to your play deck and reshuffle.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-21",
          name: "Lieutenant of Dol Guldur",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/LieutenantofDolGuldur.jpg",
          unique: true,
          race: "troll",
          skills: [
            "warrior",
            "sage"
          ],
          prowess: 7,
          body: 9,
          mind: 9,
          directInfluence: 3,
          marshallingPoints: 3,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Dol Guldur",
          keywords: [
            "Leader",
            "Olog-hai"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.race": "troll"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.race": "orc"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "influence-check",
                "target.race": "troll"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "influence-check",
                "target.race": "orc"
              }
            },
            {
              type: "hand-size-modifier",
              value: 1,
              when: {
                "self.location": "Dol Guldur"
              }
            }
          ],
          text: "Unique. Olog-hai. Leader. Manifestation of Gorfaur the Lame. Discard on a body check result of 9. +2 direct influence against Trolls, Orcs, Troll factions, and Orc factions. When he is at Dol Guldur, you may keep one more card than normal in your hand.",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-11",
          name: "Gorbag",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Gorbag.jpg",
          unique: true,
          race: "orc",
          skills: [
            "warrior",
            "scout"
          ],
          prowess: 6,
          body: 9,
          mind: 6,
          directInfluence: 0,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Minas Morgul",
          keywords: [
            "Leader",
            "Uruk-hai"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 3,
              when: {
                reason: "influence-check",
                "target.race": "orc"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 3,
              when: {
                reason: "faction-influence-check",
                "faction.race": "orc"
              }
            }
          ],
          text: "Unique. Uruk-hai. Leader. Discard on a body check result of 9. +3 direct influence against Orcs and Orc factions.",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-39",
          name: "Shagrat",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Shagrat.jpg",
          unique: true,
          race: "orc",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 6,
          body: 9,
          mind: 6,
          directInfluence: 0,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Cirith Ungol",
          keywords: [
            "Leader",
            "Uruk-hai"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 4,
              when: {
                reason: "influence-check",
                "target.race": "orc"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 4,
              when: {
                reason: "faction-influence-check",
                "faction.race": "orc"
              }
            }
          ],
          text: "Unique. Uruk-hai. Leader. Discard on a body check result of 9. +4 direct influence against Orcs and Orc factions.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-50",
          name: "Ad\xFBnaphel the Ringwraith",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/AdunapheltheRingwraith.jpg",
          unique: true,
          race: "ringwraith",
          skills: [
            "warrior",
            "scout",
            "diplomat"
          ],
          prowess: 8,
          body: 10,
          mind: null,
          directInfluence: 4,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Urlurtsu Nurn",
          effects: [
            {
              type: "cancel-attack",
              cost: { tap: "self" },
              when: {
                $and: [
                  { "bearer.atHaven": true },
                  { "attack.source": "creature" }
                ]
              }
            }
          ],
          text: "Unique. Manifestation of Ad\xFBnaphel. Can use spirit-magic. +2 direct influence in Heralded Lord mode. -2 prowess in Fell Rider mode. As your Ringwraith, if at a Darkhaven, she may tap to cancel one hazard creature attack not played at a site against any one of your companies.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-1",
          name: "Asternak",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Asternak.jpg",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "diplomat"
          ],
          prowess: 5,
          body: 7,
          mind: 5,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Variag Camp",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.playableAt": "Variag Camp"
              }
            }
          ],
          text: "Unique. +2 direct influence against any faction playable at Variag Camp.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-31",
          name: "Orc Captain",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/OrcCaptain.jpg",
          unique: false,
          race: "orc",
          skills: [
            "warrior"
          ],
          prowess: 5,
          body: 8,
          mind: 5,
          directInfluence: 0,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any Dark-hold",
          keywords: [
            "Leader"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 3,
              when: {
                reason: "influence-check",
                "target.race": "orc"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 3,
              when: {
                reason: "faction-influence-check",
                "faction.race": "orc"
              }
            }
          ],
          text: "Leader. Discard on a body check result of 8. +3 direct influence against Orcs and Orc factions.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-10",
          name: "Eradan",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Eradan.jpg",
          unique: true,
          race: "dunadan",
          skills: [
            "scout",
            "ranger"
          ],
          prowess: 4,
          body: 8,
          mind: 4,
          directInfluence: 1,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Sarn Goriwing",
          effects: [],
          text: "Unique.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-19",
          name: "Layos",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Layos.jpg",
          unique: true,
          race: "man",
          skills: [
            "sage",
            "diplomat"
          ],
          prowess: 3,
          body: 8,
          mind: 5,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Shrel-Kain",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Men of Dorwinion"
              }
            }
          ],
          text: "Unique. +2 direct influence against the Men of Dorwinion faction.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-23",
          name: "Luitprand",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Luitprand.jpg",
          unique: true,
          race: "man",
          skills: [
            "scout"
          ],
          prowess: 3,
          body: 7,
          mind: 1,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Lake-town",
          effects: [],
          text: "Unique.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-6",
          name: "Ciryaher",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Ciryaher.jpg",
          unique: true,
          race: "dunadan",
          skills: [
            "scout",
            "sage"
          ],
          prowess: 2,
          body: 7,
          mind: 5,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Barad-d\xFBr",
          effects: [],
          text: "Unique. Can use shadow-magic.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-character",
          alignment: "ringwraith",
          id: "le-36",
          name: "Ostisen",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Ostisen.jpg",
          unique: true,
          race: "man",
          skills: [
            "scout"
          ],
          prowess: 3,
          body: 9,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Vale of Erech",
          effects: [],
          text: "Unique.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-character",
          id: "le-12",
          name: "Grishn\xE1kh",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Grishnakh.jpg",
          text: "Unique. Uruk-hai. Discard on a body check result of 8.",
          alignment: "ringwraith",
          unique: true,
          race: "orc",
          skills: [
            "warrior",
            "scout"
          ],
          prowess: 4,
          body: 8,
          mind: 3,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any site in Imlad Morgul"
        },
        {
          cardType: "minion-character",
          id: "le-14",
          name: "Hador",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Hador.jpg",
          text: "Unique. Can use sorcery.",
          alignment: "ringwraith",
          unique: true,
          race: "dunadan",
          skills: [
            "warrior",
            "sage"
          ],
          prowess: 5,
          body: 9,
          mind: 6,
          directInfluence: 1,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Dol Guldur"
        },
        {
          cardType: "minion-character",
          id: "le-16",
          name: "Horseman in the Night",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/HorsemanintheNight.jpg",
          text: "+1 direct influence against any faction.",
          alignment: "ringwraith",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "diplomat"
          ],
          prowess: 3,
          body: 7,
          mind: 4,
          directInfluence: 2,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any Dark-hold"
        },
        {
          cardType: "minion-character",
          id: "le-17",
          name: "Jerrek",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Jerrek.jpg",
          text: "Unique. +1 direct influence against any faction playable at Southron Oasis.",
          alignment: "ringwraith",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "scout"
          ],
          prowess: 5,
          body: 8,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Southron Oasis"
        },
        {
          cardType: "minion-character",
          id: "le-18",
          name: "Lagduf",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Lagduf.jpg",
          text: "Unique. Uruk-hai. Discard on a body check result of 8.",
          alignment: "ringwraith",
          unique: true,
          race: "orc",
          skills: [
            "warrior"
          ],
          prowess: 5,
          body: 8,
          mind: 3,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any site in Imlad Morgul"
        },
        {
          cardType: "minion-character",
          id: "le-22",
          name: "Lieutenant of Morgul",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/LieutenantofMorgul.jpg",
          text: "Unique. Half-troll. Leader. Manifestation of Gothmog. Discard on a body check result of 9. +3 direct influence against Trolls, Orcs, Troll factions, and Orc factions. When he is at Minas Morgul, you may keep one more card than normal in your hand.",
          alignment: "ringwraith",
          unique: true,
          race: "troll",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 8,
          body: 9,
          mind: 9,
          directInfluence: 2,
          marshallingPoints: 3,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Minas Morgul"
        },
        {
          cardType: "minion-character",
          id: "le-25",
          name: "Muzgash",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Muzgash.jpg",
          text: "Unique. Uruk-hai. Discard on a body check result of 8.",
          alignment: "ringwraith",
          unique: true,
          race: "orc",
          skills: [
            "warrior"
          ],
          prowess: 4,
          body: 8,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any site in Imlad Morgul"
        },
        {
          cardType: "minion-character",
          id: "le-27",
          name: "Nevido Sm\xF4d",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/NevidoSmod.jpg",
          text: "Unique. +2 direct influence against any faction playable at Easterling Camp.",
          alignment: "ringwraith",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 4,
          body: 8,
          mind: 4,
          directInfluence: 1,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Easterling Camp",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.playableAt": "Easterling Camp"
              }
            }
          ],
          certified: "2026-04-21"
        },
        {
          cardType: "minion-character",
          id: "le-28",
          name: "Odoacer",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Odoacer.jpg",
          text: "Unique. +3 direct influence against the Woodmen faction.",
          alignment: "ringwraith",
          unique: true,
          race: "man",
          skills: [
            "ranger"
          ],
          prowess: 4,
          body: 6,
          mind: 1,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Woodmen-town"
        },
        {
          cardType: "minion-character",
          id: "le-30",
          name: "Orc Brawler",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/OrcBrawler.jpg",
          text: "Discard on a body check result of 7 or 8. -1 to all corruption checks.",
          alignment: "ringwraith",
          unique: true,
          race: "orc",
          skills: [
            "warrior"
          ],
          prowess: 3,
          body: 8,
          mind: 1,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any Dark-hold"
        },
        {
          cardType: "minion-character",
          id: "le-34",
          name: "Orc Tracker",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/OrcTracker.jpg",
          text: "Discard on a body check result of 7 or 8. -1 to all corruption checks.",
          alignment: "ringwraith",
          unique: true,
          race: "orc",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 3,
          body: 8,
          mind: 3,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any Dark-hold"
        },
        {
          cardType: "minion-character",
          id: "le-35",
          name: "Orc Veteran",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/OrcVeteran.jpg",
          text: "Discard on a body check result of 8. -1 to all corruption checks.",
          alignment: "ringwraith",
          unique: true,
          race: "orc",
          skills: [
            "warrior"
          ],
          prowess: 4,
          body: 8,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any Dark-hold"
        },
        {
          cardType: "minion-character",
          id: "le-38",
          name: "Radbug",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Radbug.jpg",
          text: "Unique. Uruk-hai. Discard on a body check result of 8.",
          alignment: "ringwraith",
          unique: true,
          race: "orc",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 5,
          body: 8,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any site in Imlad Morgul"
        },
        {
          cardType: "minion-character",
          id: "le-46",
          name: "Tros Hesnef",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TrosHesnef.jpg",
          text: "Unique. +1 direct influence against any faction playable at Easterling Camp. -1 to all corruption checks.",
          alignment: "ringwraith",
          unique: true,
          race: "man",
          skills: [
            "warrior"
          ],
          prowess: 5,
          body: 7,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Easterling Camp"
        },
        {
          cardType: "minion-character",
          id: "le-48",
          name: "Ufthak",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Ufthak.jpg",
          text: "Unique. Uruk-hai. Discard on a body check result of 8.",
          alignment: "ringwraith",
          unique: true,
          race: "orc",
          skills: [
            "warrior",
            "scout",
            "ranger"
          ],
          prowess: 4,
          body: 8,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any site in Imlad Morgul"
        },
        {
          cardType: "minion-character",
          id: "le-52",
          name: "Dwar the Ringwraith",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/DwartheRingwraith.jpg",
          text: "Unique. Manifestation of Dwar of Waw. Can use sorcery. -3 direct influence in Heralded Lord mode. -1 prowess in Fell Rider mode. As your Ringwraith, if at a Darkhaven [{DH}], he may tap to give +1 prowess and +1 body to all characters in any one of your companies until the end of the turn.",
          alignment: "ringwraith",
          unique: true,
          race: "ringwraith",
          skills: [
            "warrior",
            "scout",
            "sage"
          ],
          prowess: 9,
          body: 10,
          mind: null,
          directInfluence: 5,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any site in Ud\xFBn"
        },
        {
          cardType: "minion-character",
          id: "le-53",
          name: "Hoarm\xFBrath the Ringwraith",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/HoarmuraththeRingwraith.jpg",
          text: "Unique. Manifestation of Hoarm\xFBrath of D\xEDr. Can use sorcery. +1 direct influence in Heralded Lord mode. +2 prowess in Fell Rider mode. As your Ringwraith, if at a Darkhaven [{DH}], you may keep one more card than normal in your hand.",
          alignment: "ringwraith",
          unique: true,
          race: "ringwraith",
          skills: [
            "scout",
            "ranger",
            "sage"
          ],
          prowess: 8,
          body: 9,
          mind: null,
          directInfluence: 3,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any site in Ud\xFBn"
        },
        {
          cardType: "minion-character",
          id: "le-54",
          name: "Ind\xFBr the Ringwraith",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/IndurtheRingwraith.jpg",
          text: "Unique. Manifestation of Ind\xFBr Dawndeath. Can use sorcery and spirit-magic. -1 direct influence in Heralded Lord mode. -3 prowess in Fell Rider mode. As your Ringwraith, at the beginning of each of his end-of-turn phases, he may tap to take a magic card from your discard pile to your hand.",
          alignment: "ringwraith",
          unique: true,
          race: "ringwraith",
          skills: [
            "warrior",
            "diplomat"
          ],
          prowess: 9,
          body: 10,
          mind: null,
          directInfluence: 5,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any site in Ud\xFBn or Imlad Morgul"
        },
        {
          cardType: "minion-character",
          id: "le-58",
          name: "The Witch-king",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TheWitchking.jpg",
          text: "Unique. Manifestation of The Witch-king of Angmar. Can use spirit-magic and shadow-magic. +3 direct influence in Heralded Lord mode. +1 prowess in Fell Rider mode. As your Ringwraith, up to two Ringwraith followers in his company may be controlled with no influence. You may bring these followers into play during separate organization phases.",
          alignment: "ringwraith",
          unique: true,
          race: "ringwraith",
          skills: [
            "warrior",
            "sage",
            "diplomat"
          ],
          prowess: 9,
          body: 12,
          mind: null,
          directInfluence: 3,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any site in Imlad Morgul"
        }
      ];
    }
  });

  // ../shared/src/data/le-creatures.json
  var le_creatures_default;
  var init_le_creatures = __esm({
    "../shared/src/data/le-creatures.json"() {
      le_creatures_default = [
        {
          cardType: "hazard-creature",
          id: "le-77",
          name: "Hobgoblins",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Hobgoblins.jpg",
          unique: false,
          strikes: 2,
          prowess: 10,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "wilderness",
                "wilderness"
              ]
            }
          ],
          effects: [],
          text: "Orcs. Two strikes.",
          race: "orc",
          certified: "2026-04-13"
        },
        {
          cardType: "hazard-creature",
          id: "le-90",
          name: "Slayer",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Slayer.jpg",
          unique: false,
          strikes: 1,
          prowess: 11,
          body: null,
          killMarshallingPoints: 2,
          race: "slayer",
          keyedTo: [
            {
              regionTypes: [
                "border"
              ],
              siteTypes: [
                "border-hold"
              ]
            }
          ],
          effects: [
            { type: "combat-attacker-chooses-defenders" },
            { type: "combat-multi-attack", count: 2 },
            { type: "combat-cancel-attack-by-tap", maxCancels: 1 }
          ],
          text: "Slayer. Two attacks (of one strike each) all against the same character. Attacker chooses defending character. The defender may tap any one character in the company to cancel one of these attacks. This may be done even after a strike is assigned and after facing another attack.If an attack from Slayer is given more than one strike, each additional strike becomes an excess strike (-1 prowess modification) against the attacked character.",
          certified: "2026-04-23"
        },
        {
          cardType: "hazard-creature",
          id: "le-95",
          name: "True Fire-drake",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TrueFiredrake.jpg",
          certified: "2026-04-23",
          unique: false,
          strikes: 2,
          prowess: 13,
          body: null,
          killMarshallingPoints: 1,
          race: "drake",
          keyedTo: [
            {
              regionTypes: ["wilderness", "wilderness", "wilderness"]
            },
            {
              regionTypes: ["wilderness", "wilderness"],
              when: { inPlay: "Doors of Night" }
            }
          ],
          effects: [],
          text: "Drake. Two strikes. Only two Wildernesses [{w}] in site path are required if Doors of Night is in play."
        },
        {
          cardType: "hazard-creature",
          id: "le-59",
          name: "Ambusher",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Ambusher.jpg",
          unique: false,
          strikes: 2,
          prowess: 10,
          body: null,
          killMarshallingPoints: 1,
          race: "men",
          keyedTo: [
            {
              regionTypes: [
                "border",
                "free"
              ]
            }
          ],
          effects: [
            { type: "combat-attacker-chooses-defenders" }
          ],
          text: "Men. Two strikes. Attacker chooses defending characters.",
          certified: "2026-04-23"
        },
        {
          cardType: "hazard-creature",
          id: "le-84",
          name: "Marsh-drake",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Marshdrake.jpg",
          unique: false,
          strikes: 2,
          prowess: 11,
          body: null,
          killMarshallingPoints: 1,
          race: "drake",
          keyedTo: [
            {
              regionTypes: [
                "shadow",
                "coastal"
              ]
            }
          ],
          effects: [],
          text: "Drake. Two strikes.",
          certified: "2026-04-23"
        },
        {
          cardType: "hazard-creature",
          id: "le-65",
          name: "Cave Worm",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/CaveWorm.jpg",
          text: "Drake. One strike. May be played keyed to Redhorn Gate, High Pass, Gap of Isen, Angmar, Gundabad, Grey Mountain Narrows, Withered Heath, N\xFAmeriador, and Iron Hills.",
          unique: false,
          strikes: 1,
          prowess: 16,
          body: null,
          killMarshallingPoints: 1,
          race: "drake",
          keyedTo: [
            {
              regionNames: [
                "Redhorn Gate",
                "High Pass",
                "Gap of Isen",
                "Angmar",
                "Gundabad",
                "Grey Mountain Narrows",
                "Withered Heath",
                "N\xFAmeriador",
                "Iron Hills"
              ]
            }
          ],
          effects: [],
          certified: "2026-04-23"
        },
        {
          cardType: "hazard-creature",
          id: "le-67",
          name: "Corpse-candle",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Corpsecandle.jpg",
          text: "Undead. One strike. If this attack is not canceled, every character in the company makes a corruption check before defending characters are selected.",
          unique: false,
          strikes: 1,
          prowess: 7,
          body: null,
          killMarshallingPoints: 1,
          race: "undead",
          keyedTo: [
            { regionTypes: ["wilderness", "shadow", "dark"] },
            { siteTypes: ["shadow-hold", "dark-hold"] }
          ],
          effects: [
            {
              type: "on-event",
              event: "creature-attack-begins",
              apply: {
                type: "force-check-all-company",
                check: "corruption"
              }
            }
          ]
        },
        {
          cardType: "hazard-creature",
          id: "le-68",
          name: "Dire Wolves",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/DireWolves.jpg",
          text: "Wolves. Four strikes.",
          unique: false,
          strikes: 4,
          prowess: 8,
          body: null,
          killMarshallingPoints: 1,
          race: "wolves",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "le-71",
          name: "Ent in Search of the Entwives",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/EntinSearchoftheEntwives.jpg",
          text: "Awakened Plant. One strike (detainment against covert and hero companies). If Doors of Night is not in play, may also be played keyed to Shadow-lands [{s}].",
          unique: false,
          strikes: 1,
          prowess: 14,
          body: 8,
          killMarshallingPoints: 1,
          race: "awakened plant",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "le-72",
          name: "Ghosts",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Ghosts.jpg",
          text: "Undead. Three strikes. After attack, each character wounded by Ghosts makes a corruption check modified by -1.",
          unique: false,
          strikes: 3,
          prowess: 9,
          body: null,
          killMarshallingPoints: 1,
          race: "undead",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "le-73",
          name: "Ghouls",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Ghouls.jpg",
          text: "Undead. Five strikes.",
          unique: false,
          strikes: 5,
          prowess: 7,
          body: null,
          killMarshallingPoints: 1,
          race: "undead",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "le-75",
          name: "Giant Spiders",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/GiantSpiders.jpg",
          text: "Spiders. Two strikes. If the body check for a non-Wizard, non-Ringwraith character wounded by Giant Spiders equals his body, the character is discarded. May also be played keyed to Heart of Mirkwood, Southern Mirkwood, Western Mirkwood, and Woodland Realm; and may also be played at Ruins & Lairs [{R}], Shadow-holds [{S}], and Dark-holds [{D}] in these regions.",
          unique: false,
          strikes: 2,
          prowess: 10,
          body: null,
          killMarshallingPoints: 1,
          race: "spiders",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "le-78",
          name: "Horse-lords",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Horselords.jpg",
          text: "Men. Each character in the company faces one strike (detainment against covert and hero companies). May be played keyed to Rohan, Wold & Foothills, Gap of Isen, and An\xF3rien; and may also be played at non-Haven sites in these regions. May not be played against a company containing a character with Edoras as a home site.",
          unique: false,
          strikes: 1,
          prowess: 10,
          body: 6,
          killMarshallingPoints: 2,
          race: "men",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "le-82",
          name: "Lawless Men",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/LawlessMen.jpg",
          text: "Men. Two strikes.",
          unique: false,
          strikes: 2,
          prowess: 9,
          body: null,
          killMarshallingPoints: 1,
          race: "men",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "le-89",
          name: "Sellswords Between Charters",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SellswordsBetweenCharters.jpg",
          text: "Men. Two strikes.",
          unique: false,
          strikes: 2,
          prowess: 11,
          body: null,
          killMarshallingPoints: 1,
          race: "men",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "le-91",
          name: "Sons of Kings",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SonsofKings.jpg",
          text: "D\xFAnedain. Three strikes (playable only against minion companies).",
          unique: false,
          strikes: 3,
          prowess: 10,
          body: null,
          killMarshallingPoints: 2,
          race: "d\xFAnedain",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "le-92",
          name: "Stirring Bones",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/StirringBones.jpg",
          text: "Undead. Two strikes.",
          unique: false,
          strikes: 2,
          prowess: 9,
          body: null,
          killMarshallingPoints: 1,
          race: "undead",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "le-69",
          name: "Elf-lord Revealed in Wrath",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/ElflordRevealedinWrath.jpg",
          certified: "2026-04-20",
          text: "Elf. One strike (detainment against hero companies). +4 prowess versus Ringwraiths. If Doors of Night is not in play, may also be played keyed to Shadow-lands [{s}].",
          unique: false,
          strikes: 1,
          prowess: 15,
          body: 9,
          killMarshallingPoints: 3,
          race: "elves",
          keyedTo: [
            {
              regionTypes: ["wilderness", "wilderness"]
            },
            {
              regionTypes: ["shadow"],
              when: { $not: { inPlay: "Doors of Night" } }
            }
          ],
          effects: [
            {
              type: "combat-detainment",
              when: {
                $or: [
                  { "defender.alignment": "hero" },
                  {
                    $and: [
                      { "defender.alignment": "fallen-wizard" },
                      { "defender.covert": true }
                    ]
                  }
                ]
              }
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 4,
              when: { "defender.alignment": "ringwraith" }
            }
          ]
        },
        {
          cardType: "hazard-creature",
          id: "le-97",
          name: "Wandering Eldar",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/WanderingEldar.jpg",
          certified: "2026-04-21",
          text: "Elves. Each character in the company faces one strike (detainment against covert and hero companies). If Doors of Night is not in play, may also be played keyed to Free-domains [{f}].",
          unique: false,
          strikes: 1,
          prowess: 9,
          body: null,
          killMarshallingPoints: 1,
          race: "elves",
          keyedTo: [
            { regionTypes: ["wilderness", "border"] },
            {
              regionTypes: ["free"],
              when: { $not: { inPlay: "Doors of Night" } }
            }
          ],
          effects: [
            { type: "combat-one-strike-per-character" },
            {
              type: "combat-detainment",
              when: {
                $or: [
                  { "defender.alignment": "hero" },
                  {
                    $and: [
                      { "defender.alignment": "fallen-wizard" },
                      { "defender.covert": true }
                    ]
                  }
                ]
              }
            }
          ]
        },
        {
          cardType: "hazard-creature",
          id: "le-98",
          name: "Wargs",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Wargs.jpg",
          text: "Wolves. Two strikes.",
          unique: false,
          strikes: 2,
          prowess: 9,
          body: null,
          killMarshallingPoints: 1,
          race: "wolves",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "le-99",
          name: "Watcher in the Water",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/WatcherintheWater.jpg",
          text: "Animal. Each character in the company faces one strike. May also be played at Moria.",
          unique: false,
          strikes: 1,
          prowess: 8,
          body: null,
          killMarshallingPoints: 1,
          race: "animals",
          keyedTo: []
        }
      ];
    }
  });

  // ../shared/src/data/le-hazards.json
  var le_hazards_default;
  var init_le_hazards = __esm({
    "../shared/src/data/le-hazards.json"() {
      le_hazards_default = [
        {
          cardType: "hazard-event",
          id: "le-115",
          name: "Incite Defenders",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/InciteDefenders.jpg",
          unique: false,
          eventType: "short",
          keywords: [],
          certified: "2026-04-14",
          effects: [
            {
              type: "play-target",
              target: "site",
              filter: {
                $and: [
                  {
                    siteType: {
                      $in: [
                        "border-hold",
                        "free-hold"
                      ]
                    }
                  },
                  {
                    "automaticAttacks.length": {
                      $gt: 0
                    }
                  }
                ]
              }
            },
            {
              type: "duplication-limit",
              scope: "turn",
              max: 1
            },
            {
              type: "on-event",
              event: "company-arrives-at-site",
              apply: {
                type: "add-constraint",
                constraint: "auto-attack-duplicate",
                scope: "company-site-phase"
              },
              when: {
                "company.destinationSiteType": {
                  $in: [
                    "border-hold",
                    "free-hold"
                  ]
                }
              }
            }
          ],
          text: "Playable on a Border-hold or Free-hold. An additional automatic-attack is created at the site until the end of the turn. This is an exact duplicate (including all existing and eventual modifications to prowess, etc.) of an existing automatic-attack of your choice at the site. This automatic-attack is faced immediately following its original. Cannot be duplicated on a given site."
        },
        {
          cardType: "hazard-event",
          id: "le-119",
          name: "Lost in Free-domains",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/LostinFreedomains.jpg",
          unique: false,
          eventType: "permanent",
          effects: [
            {
              type: "play-target",
              target: "company"
            },
            {
              type: "on-event",
              event: "self-enters-play",
              apply: {
                type: "add-constraint",
                constraint: "site-phase-do-nothing",
                scope: "company-site-phase"
              },
              target: "target-company"
            }
          ],
          text: "Playable on a company moving with a Free-domain in its site path. The company may do nothing during its site phase.",
          certified: "2026-04-08"
        },
        {
          cardType: "hazard-event",
          id: "le-134",
          name: "River",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/River.jpg",
          unique: false,
          eventType: "permanent",
          effects: [
            {
              type: "play-target",
              target: "site"
            },
            {
              type: "on-event",
              event: "company-arrives-at-site",
              apply: {
                type: "add-constraint",
                constraint: "site-phase-do-nothing",
                scope: "company-site-phase",
                cancelWhen: {
                  $and: [
                    {
                      "actor.skills": {
                        $includes: "ranger"
                      }
                    },
                    {
                      "actor.status": "untapped"
                    }
                  ]
                }
              },
              target: "arriving-company"
            }
          ],
          text: "Playable on a site. A company moving to this site this turn must do nothing during its site phase. A ranger in such a company may tap to cancel this effect, even at the start of his company's site phase.",
          certified: "2026-04-08"
        },
        {
          cardType: "hazard-event",
          id: "le-145",
          name: "Twilight",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Twilight.jpg",
          certified: "2026-04-07",
          unique: false,
          eventType: "short",
          keywords: [
            "environment"
          ],
          effects: [
            {
              type: "play-flag",
              flag: "playable-as-resource"
            },
            {
              type: "play-flag",
              flag: "no-hazard-limit"
            }
          ],
          text: "Environment. One environment card (in play or declared earlier in the same chain of effects) is canceled and discarded. Twilight may also be played as a resource, may be played at any point during any player's turn and does not count against the hazard limit."
        },
        {
          cardType: "hazard-event",
          id: "le-132",
          certified: "2026-04-14",
          name: "Rebel-talk",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Rebeltalk.jpg",
          unique: false,
          eventType: "permanent",
          keywords: [],
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                $and: [
                  {
                    "target.race": {
                      $ne: "wizard"
                    }
                  },
                  {
                    "target.race": {
                      $ne: "ringwraith"
                    }
                  },
                  {
                    "target.mind": {
                      $lte: 7
                    }
                  }
                ]
              }
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            },
            {
              type: "control-restriction",
              rule: "no-direct-influence"
            },
            {
              type: "grant-action",
              action: "remove-self-on-roll",
              cost: {
                tap: "bearer"
              },
              apply: {
                type: "roll-then-apply",
                threshold: 8,
                onSuccess: {
                  type: "move",
                  select: "self",
                  from: "self-location",
                  to: "discard"
                }
              }
            }
          ],
          text: "Playable on a non-Ringwraith, non-Wizard character with mind of 7 or less. Character cannot be controlled by direct influence. Once during each of his organization phases, the character may attempt to remove this card. Make a roll\u2014if the result is greater than 7, discard this card. Cannot be duplicated on a given character."
        },
        {
          cardType: "hazard-event",
          id: "le-112",
          name: "Foolish Words",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/FoolishWords.jpg",
          unique: false,
          eventType: "permanent",
          keywords: [],
          effects: [
            {
              type: "play-target",
              target: "character"
            },
            {
              type: "on-guard-reveal",
              trigger: "influence-attempt"
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            },
            {
              type: "check-modifier",
              check: [
                "influence",
                "riddling",
                "offering"
              ],
              value: -4
            },
            {
              type: "grant-action",
              action: "remove-self-on-roll",
              cost: {
                tap: "bearer"
              },
              apply: {
                type: "roll-then-apply",
                threshold: 8,
                onSuccess: {
                  type: "move",
                  select: "self",
                  from: "self-location",
                  to: "discard"
                }
              }
            }
          ],
          text: "Playable on a character. Any riddling roll, offering attempt, or influence attempt by target character is modified by -4. If placed on-guard, it may be revealed and played when a character in the company declares such an attempt. During his organization phase, the character may tap to attempt to remove this card. Make a roll\u2014if the result is greater than 7, discard this card. Cannot be duplicated on a given character.",
          certified: "2026-04-25"
        },
        {
          cardType: "hazard-event",
          id: "le-136",
          name: "Searching Eye",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SearchingEye.jpg",
          unique: false,
          eventType: "short",
          effects: [
            {
              type: "on-event",
              event: "self-enters-play",
              apply: {
                type: "cancel-chain-entry",
                select: "target",
                requiredSkill: "scout"
              }
            },
            {
              type: "on-guard-reveal",
              trigger: "resource-short-event",
              apply: {
                type: "cancel-chain-entry",
                select: "target",
                requiredSkill: "scout"
              }
            }
          ],
          text: "Cancel and discard any card requiring scout skill before it is resolved or cancel any ongoing effect of a card that required scout skill to play. If this card is played as an on-guard card, it can be revealed during the opponent\u2019s site phase to cancel and discard a card requiring scout skill before it is resolved.",
          certified: "2026-04-23"
        },
        {
          cardType: "hazard-event",
          id: "le-123",
          name: "Lure of Nature",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/LureofNature.jpg",
          unique: false,
          eventType: "permanent",
          keywords: ["corruption"],
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                $and: [
                  { "target.race": { $ne: "hobbit" } },
                  { "target.race": { $ne: "dwarf" } },
                  { "target.race": { $ne: "orc" } },
                  { "target.race": { $ne: "ringwraith" } }
                ]
              }
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            },
            {
              type: "stat-modifier",
              stat: "corruption-points",
              value: 2
            },
            {
              type: "on-event",
              event: "end-of-company-mh",
              apply: {
                type: "force-check",
                check: "corruption"
              },
              target: "bearer",
              regionTypeFilter: ["wilderness"]
            },
            {
              type: "grant-action",
              action: "remove-self-on-roll",
              cost: {
                tap: "bearer"
              },
              apply: {
                type: "roll-then-apply",
                threshold: 5,
                onSuccess: {
                  type: "move",
                  select: "self",
                  from: "self-location",
                  to: "discard"
                }
              }
            }
          ],
          text: "Corruption. Playable on a non-Hobbit, non-Dwarf, non-Orc, non-Ringwraith character. Target character receives 2 corruption points and makes a corruption check at the end of his movement/hazard phase for each Wilderness [{w}] in his company\u2019s site path. During his organization phase, the character may tap to attempt to remove this card. Make a roll\u2014if the result is greater than 4, discard this card. Cannot be duplicated on a given character.",
          certified: "2026-04-23"
        },
        {
          cardType: "hazard-event",
          id: "le-124",
          name: "Lure of the Senses",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/LureoftheSenses.jpg",
          unique: false,
          eventType: "permanent",
          keywords: ["corruption"],
          effects: [
            {
              type: "play-target",
              target: "character"
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            },
            {
              type: "stat-modifier",
              stat: "corruption-points",
              value: 2
            },
            {
              type: "on-event",
              event: "untap-phase-end",
              when: {
                "bearer.atHaven": true
              },
              apply: {
                type: "force-check",
                check: "corruption"
              },
              target: "bearer"
            },
            {
              type: "grant-action",
              action: "remove-self-on-roll",
              cost: {
                tap: "bearer"
              },
              apply: {
                type: "roll-then-apply",
                threshold: 7,
                onSuccess: {
                  type: "move",
                  select: "self",
                  from: "self-location",
                  to: "discard"
                }
              }
            }
          ],
          text: "Corruption. Playable on a non-Ringwraith character. Target character receives 2 corruption points and makes a corruption check at the end of his untap phase if at a Haven/Darkhaven [{H}].During his organization phase, the character may tap to attempt to remove this card. Make a roll\u2014if the result is greater than 6, discard this card. Cannot be duplicated on a given character.",
          certified: "2026-04-08"
        },
        {
          cardType: "hazard-event",
          id: "le-122",
          name: "Lure of Expedience",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/LureofExpedience.jpg",
          unique: false,
          eventType: "permanent",
          keywords: ["corruption"],
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                $not: { "target.race": { $in: ["ringwraith", "wizard", "hobbit"] } }
              }
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            },
            {
              type: "stat-modifier",
              stat: "corruption-points",
              value: 2
            },
            {
              type: "on-event",
              event: "character-gains-item",
              apply: { type: "force-check", check: "corruption" },
              target: "bearer"
            },
            {
              type: "grant-action",
              action: "remove-self-on-roll",
              cost: { tap: "bearer" },
              apply: {
                type: "roll-then-apply",
                threshold: 6,
                onSuccess: {
                  type: "move",
                  select: "self",
                  from: "self-location",
                  to: "discard"
                }
              }
            }
          ],
          text: "Corruption. Playable on a non-Ringwraith, non-Wizard, non-Hobbit character. Target character receives 2 corruption points and makes a corruption check each time a character in his company gains an item (including a ring special item). During his organization phase, the character may tap to attempt to remove this card. Make a roll\u2014if the result is greater than 5, discard this card. Cannot be duplicated on a given character.",
          certified: "2026-04-25"
        },
        {
          cardType: "hazard-event",
          id: "le-107",
          name: "Covetous Thoughts",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/CovetousThoughts.jpg",
          keywords: ["corruption"],
          text: "Corruption. Playable only on a minion. At the end of each of his turns, target minion makes a corruption check for each item his company bears that he does not bear. For each check, modify the roll by subtracting the corruption of that item. During his organization phase, the minion may tap to attempt to remove this card. Make a roll\u2014if the result is greater than 5, discard this card. Cannot be duplicated on a given minion.",
          unique: false,
          eventType: "permanent",
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: { "target.cardType": "minion-character" }
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            },
            {
              type: "grant-action",
              action: "remove-self-on-roll",
              cost: { tap: "bearer" },
              apply: {
                type: "roll-then-apply",
                threshold: 6,
                onSuccess: {
                  type: "move",
                  select: "self",
                  from: "self-location",
                  to: "discard"
                }
              }
            }
          ]
        },
        {
          cardType: "hazard-event",
          id: "le-117",
          name: "Long Winter",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/LongWinter.jpg",
          text: "Environment. Each moving company that has at least two Wildernesses [{w}] in its site path must return to its site of origin unless it contains a ranger. Additionally, if Doors of Night is in play, each non-Haven/non-Darkhaven site in play with at least two Wildernesses [{w}] in its site path is tapped. Cannot be duplicated.",
          unique: false,
          eventType: "long"
        },
        {
          cardType: "hazard-event",
          id: "le-128",
          name: "Nothing to Eat or Drink",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/NothingtoEatorDrink.jpg",
          text: "Playable on a minion company at or moving to a Free-hold [{F}] or Border-hold [{B}] , or playable on a hero company at or moving to a Shadow-hold [{S}] or Dark-hold [{D}]. The prowess and body of each character in the company is modified by -1. Discard this card during its organization phase if the company is at a Haven/Darkhaven [{H}]. Cannot be duplicated on a given company.",
          unique: false,
          eventType: "permanent"
        },
        {
          cardType: "hazard-event",
          id: "le-130",
          name: "Plague of Wights",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/PlagueofWights.jpg",
          text: "The prowess of all Undead attacks is increased by one. Additionally, if Doors of Night is in play, the number of strikes for each Undead attack is doubled. Cannot be duplicated.",
          unique: false,
          eventType: "long"
        },
        {
          cardType: "hazard-event",
          id: "le-140",
          name: "Stay Her Appetite",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/StayHerAppetite.jpg",
          text: "Playable on an ally. Make a roll. If the result plus the ally\u2019s mind is greater than your opponent\u2019s unused general influence plus its controlling character\u2019s unused direct influence plus 5, the ally attacks its controlling character (detainment attack against a hero). This attack has 1 strike and prowess equal to the ally\u2019s normal prowess plus a dice roll. Discard the ally if it attacks and is not defeated.",
          unique: false,
          eventType: "short"
        },
        {
          cardType: "hazard-event",
          id: "le-141",
          name: "Stench of Mordor",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/StenchofMordor.jpg",
          text: "Environment. At the start of its site phase, each company at a site in a Dark-domain [{d}] (or Shadow-land [{s}], if Doors of Night is in play) must tap one untapped character if available. Discard when any play deck is exhausted. Cannot be duplicated.",
          unique: false,
          eventType: "permanent"
        },
        {
          cardType: "hazard-event",
          id: "le-142",
          name: "Thrice Outnumbered",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/ThriceOutnumbered.jpg",
          text: "Each player may take one Man hazard creature from his discard pile and shuffle it into his play deck at the end of each turn. Discard this card or a Man hazard creature from your hand at the end of opponent\u2019s long-event phase. Discard when any play deck is exhausted. Cannot be duplicated.",
          unique: false,
          eventType: "permanent"
        },
        {
          cardType: "hazard-event",
          id: "le-143",
          name: "Tidings of Bold Spies",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TidingsofBoldSpies.jpg",
          text: "Playable on a company moving to a site with an automatic-attack. This card creates one or more attacks on the company, the total of which duplicates exactly (including modifications) all automatic-attacks at the site. These attacks must be faced immediately and are not considered automatic-attacks.",
          unique: false,
          eventType: "short"
        },
        {
          cardType: "hazard-event",
          id: "le-146",
          name: "Veils Flung Away",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/VeilsFlungAway.jpg",
          text: "Playable on a company moving in a Wilderness [{w}] , Border-land [{b}] , or Free-domain [{f}] if Doors of Night is not in play; does not count against the hazard limit. Make a body check modified by -1 for each character. Determine if each Orc or Troll character is discarded as indicated on their cards. Otherwise, the body checks have no effect unless an untapped character fails his check, in which case he becomes tapped.",
          unique: false,
          eventType: "short"
        },
        {
          cardType: "hazard-event",
          id: "le-149",
          name: "Weariness of the Heart",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/WearinessoftheHeart.jpg",
          text: "Playable on a character. The prowess of target character is modified by -1 until the end of the turn. This use cannot be duplicated on a given character. Alternatively, target character makes a corruption check.",
          unique: false,
          eventType: "short"
        }
      ];
    }
  });

  // ../shared/src/data/le-resources.json
  var le_resources_default;
  var init_le_resources = __esm({
    "../shared/src/data/le-resources.json"() {
      le_resources_default = [
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "le-299",
          name: "Black Mace",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/BlackMace.jpg",
          unique: false,
          subtype: "greater",
          keywords: [
            "weapon"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 3,
          prowessModifier: 3,
          bodyModifier: 0,
          playableAt: [
            "shadow-hold",
            "dark-hold"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 3,
              max: 10,
              id: "black-mace-prowess",
              when: {
                "bearer.skills": {
                  $includes: "warrior"
                }
              }
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 4,
              max: 10,
              overrides: "black-mace-prowess",
              when: {
                reason: "combat",
                "enemy.race": "elf",
                "bearer.skills": {
                  $includes: "warrior"
                }
              }
            }
          ],
          text: "Weapon. Warrior only: +3 prowess to a maximum of 10 (+4 to a maximum of 10 against Elves).",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "le-313",
          name: "High Helm",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/HighHelm.jpg",
          unique: true,
          subtype: "major",
          keywords: [
            "helmet"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2
            },
            {
              type: "stat-modifier",
              stat: "body",
              value: 1,
              max: 9
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              max: 8,
              when: {
                "bearer.skills": {
                  $includes: "warrior"
                }
              }
            }
          ],
          text: "Unique. Helmet. +2 to direct influence. +1 to body to a maximum of 9. Warrior only: +1 to prowess to a maximum of 8.",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "le-342",
          name: "Saw-toothed Blade",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SawtoothedBlade.jpg",
          unique: false,
          subtype: "minor",
          keywords: [
            "weapon"
          ],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 1,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold",
            "border-hold"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              max: 8
            }
          ],
          text: "Weapon. +1 to prowess to a maximum of 8.",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "le-328",
          name: "Orc-draughts",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Orcdraughts.jpg",
          unique: false,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold",
            "border-hold"
          ],
          effects: [
            {
              type: "grant-action",
              action: "company-prowess-boost",
              anyPhase: true,
              cost: {
                discard: "self"
              },
              apply: {
                type: "add-constraint",
                constraint: "company-stat-modifier",
                stat: "prowess",
                value: 1,
                target: "bearer-company",
                scope: "turn"
              }
            }
          ],
          text: "Discard to give +1 prowess to all characters in bearer's company until the end of the turn.",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "le-310",
          name: "Foul-smelling Paste",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/FoulsmellingPaste.jpg",
          unique: false,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold",
            "border-hold"
          ],
          effects: [
            {
              type: "grant-action",
              action: "heal-company-character",
              anyPhase: true,
              cost: {
                discard: "self"
              },
              apply: {
                type: "set-character-status",
                target: "target-character",
                status: "untapped"
              }
            }
          ],
          text: "The bearer can discard this item to heal a wounded character in his company\u2014change the character\u2019s status from wounded to well and untapped.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "le-302",
          name: "Blazon of the Eye",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/BlazonoftheEye.jpg",
          unique: false,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [
            "ruins-and-lairs",
            "shadow-hold",
            "dark-hold",
            "border-hold"
          ],
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check"
              }
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            }
          ],
          text: "+2 to direct influence against factions. Cannot be duplicated on a given character.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-resource-faction",
          alignment: "ringwraith",
          id: "le-265",
          name: "Goblins of Goblin-gate",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/GoblinsofGoblingate.jpg",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 9,
          inPlayInfluenceNumber: 0,
          race: "orc",
          playableAt: [
            {
              site: "Goblin-gate"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: 2,
              when: {
                "controller.inPlay": "Grey Mountain Goblins"
              }
            }
          ],
          text: "Unique. Playable at Goblin-gate if the influence check is greater than 8. Once in play, the number required to influence this faction is 0. Standard Modifications: Grey Mountain Goblins (+2).",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-resource-ally",
          alignment: "ringwraith",
          id: "le-158",
          name: "The Warg-king",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TheWargking.jpg",
          unique: true,
          prowess: 4,
          body: 8,
          mind: 3,
          marshallingPoints: 2,
          marshallingCategory: "ally",
          playableAt: [
            {
              siteType: "ruins-and-lairs",
              when: {
                "site.autoAttack.race": "wolf"
              }
            }
          ],
          effects: [
            {
              type: "cancel-attack",
              cost: {
                tap: "self"
              },
              when: {
                "enemy.race": {
                  $in: [
                    "wolf",
                    "wolves",
                    "animal",
                    "animals"
                  ]
                }
              }
            },
            {
              type: "check-modifier",
              check: "influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.race": "wolf"
              }
            }
          ],
          text: "Unique. Playable at any tapped or untapped Ruins & Lairs with a Wolf automatic-attack. Tap to cancel a Wolf or Animal attack against his company. +2 to any influence attempt by a character in his company against a Wolf faction.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-216",
          name: "Orc Quarrels",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/OrcQuarrels.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "cancel-attack",
              when: {
                "enemy.race": {
                  $in: [
                    "orc",
                    "troll",
                    "men",
                    "man"
                  ]
                }
              }
            },
            {
              type: "halve-strikes",
              when: {
                inPlay: "Skies of Fire"
              }
            }
          ],
          text: "Playable on an Orc, Troll, or Man attack. The attack is canceled. Alternatively, playable on any attack if Skies of Fire is in play. The number of strikes from the attack is reduced to half of its original number (rounded up).",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-253",
          name: "Weigh All Things to a Nicety",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/WeighAllThingstoaNicety.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Bring one resource or character (including a Ringwraith) from your sideboard or discard pile into your play deck and shuffle."
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-160",
          name: "A Nice Place to Hide",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/ANicePlacetoHide.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "cancel-attack",
              cost: {
                tap: "character"
              },
              requiredSkill: "scout"
            }
          ],
          text: "Scout only. Tap scout to cancel an attack against his company.",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-225",
          name: "Ruse",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Ruse.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Diplomat only. Scout only. Playable on a untapped diplomat in a covert company facing an attack. Tap the diplomat. The attack is canceled. Alternatively, playable on a scout facing an attack. No strikes of the attack may be assigned to the scout."
        },
        {
          cardType: "minion-resource-ally",
          alignment: "ringwraith",
          id: "le-154",
          name: "Stinker",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Stinker.jpg",
          unique: true,
          prowess: 2,
          body: 9,
          mind: 4,
          marshallingPoints: 2,
          marshallingCategory: "ally",
          playableAt: [
            { site: "Goblin-gate" },
            { site: "Moria" }
          ],
          effects: [
            {
              type: "grant-action",
              action: "stinker-discard-with-ring",
              cost: { discard: "self" },
              when: {
                $and: [
                  { "bearer.atHaven": false },
                  { "site.hasOneRing": true }
                ]
              },
              apply: {
                type: "move",
                select: "named",
                from: "in-play",
                to: "discard",
                cardName: "The One Ring"
              }
            },
            {
              type: "cancel-attack",
              cost: { tap: "self" },
              when: {
                $and: [
                  { "bearer.companySize": { $lt: 3 } },
                  {
                    $or: [
                      { "attack.keying": "wilderness" },
                      { "attack.keying": "shadow" }
                    ]
                  }
                ]
              }
            }
          ],
          text: "Unique. Playable at Goblin-gate or Moria. Manifestation of Gollum and My Precious. If his company's size is less than three, tap Stinker to cancel one attack against his company keyed to Wilderness [{w}] or Shadow-land [{s}]. You may tap Stinker if he is at the same non-Darkhaven site as The One Ring; then both Stinker and The One Ring are discarded.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-235",
          name: "Sudden Call",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SuddenCall.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-flag",
              flag: "playable-as-hazard"
            },
            {
              type: "call-council",
              lastTurnFor: "opponent"
            },
            {
              type: "call-council",
              lastTurnFor: "self"
            },
            {
              type: "move",
              select: "self",
              from: "hand",
              to: "deck",
              shuffleAfter: true
            }
          ],
          text: "You may play this card as a resource or a hazard according to The Audience of Sauron Rules. This card may not be played as a hazard against a Wizard player, and may be included as a hazard in a Wizard's deck. You may reshuffle this card into your play deck at any time that it is in your hand (show opponent).",
          certified: true
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-250",
          name: "Voices of Malice",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/VoicesofMalice.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                "target.skills": {
                  $includes: "sage"
                }
              },
              cost: {
                tap: "character"
              }
            },
            {
              type: "move",
              select: "target",
              from: "in-play",
              to: "discard",
              filter: {
                $and: [
                  {
                    cardType: "hazard-event"
                  },
                  {
                    eventType: {
                      $in: [
                        "permanent",
                        "long"
                      ]
                    }
                  },
                  {
                    $not: {
                      keywords: {
                        $includes: "environment"
                      }
                    }
                  }
                ]
              },
              corruptionCheck: {
                modifier: -2
              }
            }
          ],
          text: "Sage only. Tap a sage to discard one non-environment hazard permanent-event or non-environment hazard long-event. Sage makes a corruption check modified by -2.",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-resource-faction",
          alignment: "ringwraith",
          id: "le-278",
          name: "Orcs of Moria",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/OrcsofMoria.jpg",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 11,
          race: "orc",
          playableAt: [
            {
              site: "Moria"
            }
          ],
          effects: [],
          text: "Unique. Playable at Moria if the influence check is greater than 10. Once in play, the number required to influence this faction is 0. Standard Modifications: Goblins of Goblin-gate (+2), Orcs of Dol Guldur (-2)."
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-167",
          name: "Bade to Rule",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/BadetoRule.jpg",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Playable at a Darkhaven [{DH}] during the organization phase on your Ringwraith. -2 to his direct influence, +5 general influence. You may discard this card during any of your organization phases. Discard this card if your Ringwraith moves. Alternatively, playable if your Ringwraith is not in play. +5 general influence. Place this card with your Ringwraith when he comes into play. Cannot be duplicated by a given player.Cannot be included in a Balrog's deck."
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-179",
          name: "Deeper Shadow",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/DeeperShadow.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Magic. Shadow-magic. Playable during the movement/hazard phase on a moving shadow-magic-using character. In character\u2019s site path, change a Ruins & Lairs [{R}] to a Shadow-hold [{S}] or one Wilderness [{w}] to a Shadow-land [{s}].Alternatively, decrease the hazard limit against his company by one (to no minimum). Unless he is a Ringwraith, he makes a corruption check modified by -3."
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-212",
          name: "Not Slay Needlessly",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/NotSlayNeedlessly.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Playable on an attack by Elves, Dwarves, D\xFAnedain, or Men. Against a covert company, the attack is canceled. Otherwise, -2 to the attack's prowess. Cannot be duplicated on a given attack."
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-226",
          name: "Secrets of Their Forging",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SecretsofTheirForging.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Sage only. Playable on a sage during the site phase at a site where Information is playable if a character in his company has a gold ring item. Tap the sage and the site. You may replace the gold ring with a special item ring from your hand (except for The One Ring) for which the gold ring could normally be tested. Discard the gold ring item."
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-246",
          name: "To Satisfy the Questioner",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/ToSatisfytheQuestioner.jpg",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Playable during the site phase on an untapped character at a Free-hold [{F}]. Tap the character and site. No marshalling points are received and the character may not untap until this card is stored at a Darkhaven [{DH}] during his organization phase."
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "le-219",
          name: "Poisonous Despair",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/PoisonousDespair.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Magic. Spirit-magic. Playable on a spirit-magic-using character in response to an influence attempt against a character, ally, or item in his company. The attempt is canceled. If the character is a Ringwraith, he can also cancel an influence attempt against any of his factions. May be played during opponent\u2019s site phase. Unless he is a Ringwraith, he makes a corruption check modified by -3."
        },
        {
          cardType: "minion-resource-ally",
          id: "le-153",
          name: "Last Child of Ungoliant",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/LastChildofUngoliant.jpg",
          text: "Unique. Playable at Shelob's Lair. Manifestation of Shelob. Its controlling character's company is overt. Tap this ally to either: cancel one hazard creature attack against a company moving to a site in Imlad Morgul, Ithilien, or Gorgoroth or to discard one hazard permanent-event on such a company or on a character in such a company. Discard this card if her company moves to a site that is not in Gorgoroth, Imlad Morgul, or Ithilien. Return her to your hand if Shelob is played.",
          alignment: "ringwraith",
          unique: true,
          prowess: 11,
          body: 9,
          mind: 4,
          marshallingPoints: 3,
          marshallingCategory: "ally",
          playableAt: []
        },
        {
          cardType: "minion-resource-ally",
          id: "le-157",
          name: "War-wolf",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Warwolf.jpg",
          text: "Playable at any tapped or untapped Ruins & Lairs [{R}] with a Wolf automatic-attack or at any tapped or untapped Shadow-hold [{S}] with an Orc automatic-attack.",
          alignment: "ringwraith",
          unique: false,
          prowess: 2,
          body: 7,
          mind: 1,
          marshallingPoints: 1,
          marshallingCategory: "ally",
          playableAt: []
        },
        {
          cardType: "minion-resource-event",
          id: "le-165",
          name: "Awaiting the Call",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/AwaitingtheCall.jpg",
          text: "Playable during the organization phase on a character with a mind of 6 or less at a non-Darkhaven. For the purposes of controlling this character, his mind is halved (round down). Discard this card when the character moves. Cannot be duplicated on a given character.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-172",
          name: "Bold Thrust",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/BoldThrust.jpg",
          text: "Warrior only. Warrior receives +3 to prowess and -1 to body against one strike.",
          alignment: "ringwraith",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-173",
          name: "Burning Rick, Cot, and Tree",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/BurningRickCotandTree.jpg",
          text: "Playable at an already tapped Border-hold [{B}] during the site phase. The company faces two attacks (Men \u2014 4 strikes with 7 prowess, 1 strike with 9 prowess). If no characters are untapped after the attack, discard this card. Otherwise, you may tap one character in the company and put this card in your marshalling point pile. Discard any factions you have in play that are playable at that site. Cannot be duplicated at a given site.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 2,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-174",
          name: "By the Ringwraith\u2019s Word",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/BytheRingwraithsWord.jpg",
          text: "Playable during the organization phase on one of your other characters at the same Darkhaven [{DH}] as your Ringwraith. The character: becomes a leader (if not already), receives +4 direct influence against characters in his company, and cannot be discarded by a body check. Discard at any time if there is a character in his company with a higher mind. Cannot be duplicated by a given player. Cannot be included in a Balrog's deck.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: []
        },
        {
          cardType: "minion-resource-event",
          id: "le-178",
          name: "Crooked Promptings",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/CrookedPromptings.jpg",
          text: "Diplomat only. +3 to any one influence check by a character in a diplomat\u2019s company or +2 to a corruption check by a character in his company.",
          alignment: "ringwraith",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-180",
          name: "Diversion",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Diversion.jpg",
          text: "Playable on an unwounded character facing an attack. The attack is canceled and the character is wounded (no body check is required).",
          alignment: "ringwraith",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-183",
          name: "Fell Rider",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/FellRider.jpg",
          text: "Fell Rider mode. Playable at a Darkhaven [{DH}] during the organization phase on your Ringwraith\u2019s own company. +2 prowess, -3 direct influence to your Ringwraith. Discard all allies and Ringwraith followers in the company; none may join the company. Your Ringwraith may move to a non-Darkhaven site. Discard this card during any of your following organization phases your Ringwraith is at a Darkhaven [{DH}]. Cannot be duplicated on a given company. Cannot be included in a Balrog's deck.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-184",
          name: "Focus Palant\xEDr",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/FocusPalantir.jpg",
          text: "Sage only. Playable on a Palant\xEDr with a sage in the company. If the bearer of the Palant\xEDr is not a Ringwraith, he now has the ability to use the Palant\xEDr. Discard Focus Palant\xEDr if the Palant\xEDr\u2019s company moves.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-188",
          name: "Gifts as Given of Old",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/GiftsasGivenofOld.jpg",
          text: "Provides +3 to an influence attempt against a faction.",
          alignment: "ringwraith",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-196",
          name: "I\u2019ll Report You",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/IllReportYou.jpg",
          text: "Command. Playable on a leader during the organization phase. Return all other command cards on target leader to your hand when this card is played. -2 to leader\u2019s direct influence (to a minimum of 0) and +1 prowess to all characters in his company. You may return this card to your hand during any organization phase.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-220",
          name: "Ready to His Will",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/ReadytoHisWill.jpg",
          text: "Playable on an Orc, Troll, Giant, Slayer, or Man hazard creature with one strike for each of its attacks. All attacks of the creature are canceled. The creature becomes an ally under the control of any character in the company that now taps. It has a mind of 1, 1 ally marshalling point, prowess equal to its normal prowess minus 7, and a body equal to 8. Place this card with the creature.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 1,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-228",
          name: "Skies of Fire",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SkiesofFire.jpg",
          text: "Environment. When Skies of Fire is played, all hazard environment cards in play are immediately discarded, and all hazard environment effects are canceled. This card acts as Gates of Morning for the purposes of interpreting hazards. Cannot be duplicated.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-231",
          name: "Sneakin\u2019",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Sneakin.jpg",
          text: "Scout only. Playable during the organization phase on an untapped scout in a company with a company size less than 3. Tap the scout. No creature hazards may be played on his company this turn.",
          alignment: "ringwraith",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-237",
          name: "Swarm of Bats",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SwarmofBats.jpg",
          text: "Playable at a Darkhaven [{DH}] , Shadow-hold [{S}] , or Dark-hold [{D}] during the organization phase on an overt company that has more than one Orc. Any attack against this company has its prowess and body modified by -1. Discard this card if a character leaves the company for any reason. Cannot be duplicated on a given company.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-238",
          name: "Swift Strokes",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SwiftStrokes.jpg",
          text: "Warrior only. Warrior receives +1 prowess against one strike and obtains two random values against it, choosing the one to use.",
          alignment: "ringwraith",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-240",
          name: "That Ain\u2019t No Secret",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/ThatAintNoSecret.jpg",
          text: "Playable during the site phase on an untapped character at a site where Information is playable. Tap the character (but not the site). No marshalling points are received until this card is stored at a Darkhaven [{DH}] during the character\u2019s organization phase.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 1,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-241",
          name: "That\u2019s Been Heard Before Tonight",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/ThatsBeenHeardBeforeTonight.jpg",
          text: "Playable during the site phase on an untapped character in a covert company at a Border-hold [{B}] or Free-hold [{F}] where Information is playable. Tap the character (but not the site). No marshalling points are received and the character may not untap until this card is stored at a Darkhaven [{DH}] during his organization phase.",
          alignment: "ringwraith",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 2,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-event",
          id: "le-247",
          name: "Under His Blow",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/UnderHisBlow.jpg",
          text: "Untapped character does not tap against one strike.",
          alignment: "ringwraith",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "minion-resource-faction",
          id: "le-260",
          name: "Balchoth",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Balchoth.jpg",
          text: "Unique. Playable at Raider-hold if the influence check is greater than 8. Standard Modifications: Easterlings (+2), Men of Dorwinion (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "man",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-262",
          name: "Black Trolls",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/BlackTrolls.jpg",
          text: "Unique. Playable at Cirith Gorgor or Barad-d\xFBr if the influence check is greater than 10. Once in play, the number required to influence this faction is 0. If this influence attempt is made by an Orc or Troll leader, you may place this faction under the control of that leader and not tap the site. Discard the faction if the leader moves or leaves play. Three or more factions controlled by the same leader give 2 extra marshalling points. Standard Modifications: Morgul Orcs (+2), Orcs of Gundabad (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 1,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "troll",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-264",
          name: "Easterlings",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Easterlings.jpg",
          text: "Unique. Manifestation of hero Easterlings. Playable at Easterling Camp if the influence check is greater than 8. Standard Modifications: Balchoth (+2), Wain-easterlings (+2), Men of Dorwinion (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 8,
          race: "man",
          playableAt: [
            {
              site: "Easterling Camp"
            }
          ]
        },
        {
          cardType: "minion-resource-faction",
          id: "le-266",
          name: "Grey Mountain Goblins",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/GreyMountainGoblins.jpg",
          text: "Unique. Playable at Gondmaeglom if the influence check is greater than 8. Once in play, the number required to influence this faction is 0. Standard Modifications: Orcs of Gundabad (+2), Goblins of Goblin-gate (+2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "orc",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-270",
          name: "Ice-orcs",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Iceorcs.jpg",
          text: "Unique. Playable at any Ruins & Lairs [{R}] in Forochel or Withered Heath if the influence check is greater than 10. Once in play, the number required to influence this faction is 0. Standard Modifications: Wargs of the Forochel (+2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 4,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "orc",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-271",
          name: "Men of Dorwinion",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/MenofDorwinion.jpg",
          text: "Unique. Manifestation of hero Men of Dorwinion. Playable at Shrel-Kain if the influence check is greater than 10. Standard Modifications: Easterlings (-2), Balchoth (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 10,
          race: "man",
          playableAt: [
            {
              site: "Shrel-Kain"
            }
          ]
        },
        {
          cardType: "minion-resource-faction",
          id: "le-273",
          name: "N\xFBrniags",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Nurniags.jpg",
          text: "Unique. Playable at N\xFBrniag Camp if the influence check is greater than 9. Standard Modifications: N\xFBriags (+2), Balchoth (-2), Variags of Khand (+2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "man",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-276",
          name: "Orcs of Gundabad",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/OrcsofGundabad.jpg",
          text: "Unique. Playable at Mount Gundabad if the influence check is greater than 9. Once in play, the number required to influence this faction is 0. Standard Modifications: Grey Mountain Goblins (+2), Orcs of Angmar (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "orc",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-277",
          name: "Orcs of Mirkwood",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/OrcsofMirkwood.jpg",
          text: "Unique. Playable at Sarn Goriwing if the influence check is greater than 8. Once in play, the number required to influence this faction is 0. Standard Modifications: Orcs of Red Eye (-2), Orcs of Gorgoroth (+2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "orc",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-279",
          name: "Orcs of the Ash Mountains",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/OrcsoftheAshMountains.jpg",
          text: "Unique. Playable at Cirith Gorgor if the influence check is greater than 8. Once in play, the number required to influence this faction is 0. If this influence attempt is made by an Orc or Troll leader, you may place this faction under the control of that leader and not tap the site. Discard the faction if the leader moves or leaves play. Three or more factions controlled by the same leader give 2 extra marshalling points. Standard Modifications: Orcs of the Ephel D\xFAath (-2), Snaga-hai (+2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 1,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "orc",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-282",
          name: "Orcs of Ud\xFBn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/OrcsofUdun.jpg",
          text: "Unique. Playable at Cirith Gorgor if the influence check is greater than 8. Once in play, the number required to influence this faction is 0. If this influence attempt is made by an Orc or Troll leader, you may place this faction under the control of that leader and not tap the site. Discard the faction if the leader moves or leaves play. Three or more factions controlled by the same leader give 2 extra marshalling points. Standard Modifications: Orcs of Gorgoroth (+2), Orcs of the Red Eye (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 1,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "orc",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-286",
          name: "Snaga-hai",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Snagahai.jpg",
          text: "Playable at any tapped or untapped Shadow-hold [{S}] if the influence check is greater than 9. Once in play, the number required to influence this faction is 0.",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 1,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "orc",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-287",
          name: "Southrons",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Southrons.jpg",
          text: "Unique. Manifestation of hero Southrons. Playable at Southron Oasis if the influence check is greater than 8. Standard Modifications: Haradrim (+2), Asdriags (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "man",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-291",
          name: "Uruk-hai",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Urukhai.jpg",
          text: "Unique. Playable at Barad-d\xFBr, Cirith Gorgor, or Cirith Ungol if the influence check is greater than 11. Once in play, the number required to influence this faction is 0. If this influence attempt is made by an Orc or Troll leader, you may place this faction under the control of that leader and not tap the site. Discard the faction if the leader moves or leaves play. Three or more factions controlled by the same leader give 2 extra marshalling points. Standard Modifications: Any other Orc faction (-2; applied only once).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 0,
          race: "orc",
          playableAt: []
        },
        {
          cardType: "minion-resource-faction",
          id: "le-292",
          name: "Variags of Khand",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/VariagsofKhand.jpg",
          text: "Unique. Manifestation of hero Variags of Khand. Playable at Variag Camp if the influence check is greater than 8. Standard Modifications: N\xFBrniags (+2), Haradrim (-2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 8,
          race: "man",
          playableAt: [
            {
              site: "Variag Camp"
            }
          ]
        },
        {
          cardType: "minion-resource-faction",
          id: "le-293",
          name: "Wargs of the Forochel",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/WargsoftheForochel.jpg",
          text: "Unique. Playable at Lossadan Cairn if the influence check is greater than 10. Once in play, the number required to influence this faction is 0. Standard Modifications: Ice-orcs (+2), Misty Mountain Wargs (+2).",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 10,
          inPlayInfluenceNumber: 0,
          race: "wolf",
          playableAt: [
            {
              site: "Lossadan Cairn"
            }
          ]
        },
        {
          cardType: "minion-resource-faction",
          id: "le-296",
          name: "Woses of the Eryn Vorn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/WosesoftheErynVorn.jpg",
          text: "Unique. Playable at The Worthy Hills if the influence check is greater than 11.",
          alignment: "ringwraith",
          unique: true,
          marshallingPoints: 3,
          marshallingCategory: "faction",
          influenceNumber: 12,
          race: "wose",
          playableAt: [
            {
              site: "The Worthy Hills"
            }
          ],
          effects: []
        }
      ];
    }
  });

  // ../shared/src/data/le-sites.json
  var le_sites_default;
  var init_le_sites = __esm({
    "../shared/src/data/le-sites.json"() {
      le_sites_default = [
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-367",
          name: "Dol Guldur",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/DolGuldur.jpg",
          siteType: "haven",
          sitePath: [],
          nearestHaven: "",
          region: "Southern Mirkwood",
          havenPaths: {
            "Minas Morgul": [
              "shadow",
              "dark",
              "dark",
              "shadow",
              "dark"
            ],
            "Carn D\xFBm": [
              "shadow",
              "dark",
              "border",
              "dark"
            ]
          },
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Any gold ring stored at this site is automatically tested (modify the roll by -2). Any attack against a minion company at this site is canceled.",
          effects: [
            { type: "site-rule", rule: "auto-test-gold-ring", rollModifier: -2 },
            { type: "site-rule", rule: "cancel-attacks" }
          ],
          certified: "2026-04-20"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-390",
          name: "Minas Morgul",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/MinasMorgul.jpg",
          siteType: "haven",
          sitePath: [],
          nearestHaven: "",
          region: "Imlad Morgul",
          havenPaths: {
            "Dol Guldur": [
              "dark",
              "shadow",
              "dark",
              "dark",
              "shadow"
            ]
          },
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Any gold ring stored at this site is automatically tested (modify the roll by -2). Any attack against a minion company at this site is canceled.",
          effects: [
            { type: "site-rule", rule: "auto-test-gold-ring", rollModifier: -2 },
            { type: "site-rule", rule: "cancel-attacks" }
          ],
          certified: "2026-04-20"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-373",
          name: "Ettenmoors",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Ettenmoors.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "shadow",
            "wilderness"
          ],
          nearestHaven: "Carn D\xFBm",
          region: "Rhudaur",
          playableResources: [
            "minor"
          ],
          automaticAttacks: [
            {
              creatureType: "Trolls",
              strikes: 1,
              prowess: 9
            },
            {
              creatureType: "Wolves",
              strikes: 2,
              prowess: 8
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Playable: Items (minor). Automatic-attacks (2): (1st) Troll \u2014 1 strike with 9 prowess; (2nd) Wolves \u2014 2 strikes with 8 prowess.",
          certified: "2026-04-20"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-412",
          name: "The White Towers",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TheWhiteTowers.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "shadow",
            "wilderness"
          ],
          nearestHaven: "Carn D\xFBm",
          region: "Arthedain",
          playableResources: [
            "information"
          ],
          automaticAttacks: [
            {
              creatureType: "Wolves",
              strikes: 2,
              prowess: 6
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Playable: Information. Automatic-attacks: Wolves \u2014 2 strikes with 6 prowess.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-384",
          name: "Isengard",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Isengard.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Geann a-Lisch",
          region: "Gap of Isen",
          playableResources: [
            "information",
            "minor",
            "major",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Wolves",
              strikes: 3,
              prowess: 7
            }
          ],
          resourceDraws: 1,
          hazardDraws: 2,
          text: "Nearest Darkhaven: Geann a-Lisch. Playable: Information, Items (minor, major, gold ring). Automatic-attacks: Wolves \u2014 3 strikes with 7 prowess."
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-392",
          name: "Moria",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Moria.jpg",
          siteType: "shadow-hold",
          sitePath: [
            "dark",
            "shadow",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Dol Guldur",
          region: "Redhorn Gate",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 4,
              prowess: 7
            }
          ],
          resourceDraws: 2,
          hazardDraws: 3,
          text: "Non-Nazg\xFBl creatures played at this site attack normally, not as detainment. Playable: Items (minor, major, greater, gold ring). Automatic-attacks: Orcs \u2014 4 strikes with 7 prowess.",
          effects: [
            {
              type: "site-rule",
              rule: "attacks-not-detainment",
              filter: { "enemy.race": { $ne: "nazgul" } }
            }
          ],
          certified: "2026-04-21"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-350",
          name: "Bag End",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/BagEnd.jpg",
          siteType: "free-hold",
          sitePath: [
            "shadow",
            "wilderness",
            "free"
          ],
          nearestHaven: "Carn D\xFBm",
          region: "The Shire",
          playableResources: [
            "information",
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Hobbits",
              strikes: 5,
              prowess: 5
            },
            {
              creatureType: "D\xFAnedain",
              strikes: 3,
              prowess: 11
            }
          ],
          resourceDraws: 1,
          hazardDraws: 3,
          text: "Playable: Information, Items (minor, major, greater*, gold ring) *\u2014hero item only. Automatic-attacks (2): (1st) Hobbits \u2014 5 strikes with 5 prowess; (2nd) D\xFAnedain \u2014 3 strikes with 11 prowess.",
          effects: [
            {
              type: "site-rule",
              rule: "deny-item",
              when: {
                subtype: "greater",
                alignment: {
                  $ne: "wizard"
                }
              }
            }
          ],
          certified: "2026-04-19"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-351",
          name: "Bandit Lair",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/BanditLair.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "dark",
            "shadow"
          ],
          nearestHaven: "Dol Guldur",
          region: "Brown Lands",
          playableResources: [
            "minor",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Men",
              strikes: 3,
              prowess: 6
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Playable: Items (minor, gold ring). Automatic-attacks: Men \u2014 3 strikes with 6 prowess.",
          certified: "2026-04-19"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-352",
          name: "Barad-d\xFBr",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Baraddur.jpg",
          siteType: "dark-hold",
          sitePath: [
            "shadow",
            "dark"
          ],
          nearestHaven: "Minas Morgul",
          region: "Gorgoroth",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 1,
          text: "Treat this site as a Darkhaven during the untap phase. Any gold ring item at this site is automatically tested during the site phase (the site need not be entered). All ring tests at this site are modified by -3.",
          effects: [
            {
              type: "site-rule",
              rule: "heal-during-untap"
            }
          ]
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-354",
          name: "Beorn's House",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/BeornsHouse.jpg",
          siteType: "free-hold",
          sitePath: [
            "dark",
            "shadow"
          ],
          nearestHaven: "Dol Guldur",
          region: "Anduin Vales",
          playableResources: [
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Men",
              strikes: -1,
              prowess: 10,
              special: "each character faces 1 strike",
              detainmentAgainstCovert: true
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Playable: Items (gold ring). Automatic-attacks: Men \u2014 each character faces 1 strike with 10 prowess (detainment against covert company).",
          certified: "2026-04-19"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-359",
          name: "Carn D\xFBm",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/CarnDum.jpg",
          siteType: "haven",
          sitePath: [],
          nearestHaven: "",
          region: "Angmar",
          havenPaths: {
            "Dol Guldur": [
              "dark",
              "border",
              "dark",
              "shadow"
            ],
            "Geann a-Lisch": [
              "wilderness",
              "wilderness",
              "wilderness",
              "wilderness",
              "shadow"
            ]
          },
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Unless this site is a character's home site, a non-Orc, non-Troll character may not be brought into play at this site. Any gold ring stored at this site is automatically tested (modify the roll by -2). Any attack against a minion company at this site is canceled.",
          effects: [
            {
              type: "site-rule",
              rule: "deny-character",
              filter: { $not: { race: { $in: ["orc", "troll"] } } },
              exceptHomesite: true
            },
            { type: "site-rule", rule: "auto-test-gold-ring", rollModifier: -2 },
            { type: "site-rule", rule: "cancel-attacks" }
          ],
          certified: "2026-04-21"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-365",
          name: "Dimrill Dale",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/DimrillDale.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "dark",
            "shadow",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Dol Guldur",
          region: "Redhorn Gate",
          playableResources: [
            "information"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 1,
              prowess: 6
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Playable: Information. Automatic-attacks: Orcs \u2014 1 strike with 6 prowess.",
          certified: "2026-04-19"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-372",
          name: "Edoras",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Edoras.jpg",
          siteType: "free-hold",
          sitePath: [
            "shadow",
            "wilderness",
            "free",
            "shadow"
          ],
          nearestHaven: "Minas Morgul",
          region: "Rohan",
          playableResources: [
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Men",
              strikes: -1,
              prowess: 10,
              special: "each character faces 1 strike",
              detainmentAgainstCovert: true
            }
          ],
          resourceDraws: 2,
          hazardDraws: 3,
          text: "Playable: Items (gold ring). Automatic-attacks: Men \u2014 each character faces 1 strike with 10 prowess (detainment against covert company).",
          certified: "2026-04-19"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-378",
          name: "Goblin-gate",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Goblingate.jpg",
          siteType: "shadow-hold",
          sitePath: [
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Carn D\xFBm",
          region: "High Pass",
          playableResources: [
            "minor",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 3,
              prowess: 6
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Non-Nazg\xFBl creatures played at this site attack normally, not as detainment. Playable: Items (minor, gold ring). Automatic-attacks: Orcs \u2014 3 strikes with 6 prowess.",
          certified: "2026-04-19"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-408",
          name: "Thranduil's Halls",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/ThranduilsHalls.jpg",
          siteType: "free-hold",
          sitePath: [
            "dark",
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Dol Guldur",
          region: "Woodland Realm",
          playableResources: [
            "information",
            "minor",
            "major",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Elves",
              strikes: -1,
              prowess: 9,
              special: "each character faces 1 strike",
              detainmentAgainstCovert: true
            },
            {
              creatureType: "Elves",
              strikes: 3,
              prowess: 10,
              special: "against overt company only"
            }
          ],
          resourceDraws: 1,
          hazardDraws: 2,
          text: "Playable: Information, Items (minor, major, gold ring). Automatic-attacks (2): (1st) Elves \u2014 each character faces 1 strike with 9 prowess (detainment against covert company); (2nd) Elves \u2014 3 strikes with 10 prowess (against overt company only).",
          certified: "2026-04-19"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-415",
          name: "The Worthy Hills",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TheWorthyHills.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "shadow",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Carn D\xFBm",
          region: "Cardolan",
          playableResources: [
            "information"
          ],
          automaticAttacks: [
            {
              creatureType: "Men",
              strikes: -1,
              prowess: 9,
              special: "each character faces 1 strike",
              detainmentAgainstCovert: true
            }
          ],
          resourceDraws: 1,
          hazardDraws: 2,
          effects: [
            {
              type: "site-rule",
              rule: "never-taps"
            }
          ],
          text: "Playable: Information. Automatic-attacks: Men \u2014 each character faces 1 strike with 9 prowess (detainment against covert company). Special: This site never taps.",
          certified: "2026-04-21"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-360",
          name: "Caves of \xDBlund",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/CavesofUlund.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "dark",
            "wilderness",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Dol Guldur",
          region: "Withered Heath",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 13
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (minor, major, greater, gold ring) Automatic-attacks: Dragon \u2014 1 strike with 13 prowess"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-379",
          name: "Gondmaeglom",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Gondmaeglom.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "dark",
            "wilderness",
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Dol Guldur",
          region: "Grey Mountain Narrows",
          playableResources: [
            "minor",
            "major",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 14
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (minor, major, gold ring) Automatic-attacks: Dragon \u2014 1 strike with 14 prowess"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-388",
          name: "Lossadan Cairn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/LossadanCairn.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "shadow",
            "wilderness"
          ],
          nearestHaven: "Carn D\xFBm",
          region: "Forochel",
          playableResources: [
            "minor",
            "major",
            "greater"
          ],
          automaticAttacks: [
            {
              creatureType: "Undead",
              strikes: 2,
              prowess: 8
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Nearest Darkhaven: Carn D\xFBm Playable: Items (minor, major, greater*) *\u2014Palant\xEDri only Automatic-attacks: Undead \u2014 2 strikes with 8 prowess; each character wounded must make a corruption check modified by -2"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-387",
          name: "The Lonely Mountain",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TheLonelyMountain.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "dark",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Dol Guldur",
          region: "Northern Rhovanion",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 14
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (minor, major, greater, gold ring) Automatic-attacks: Dragon \u2014 1 strike with 14 prowess"
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-417",
          name: "Zarak D\xFBm",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/ZarakDum.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "shadow"
          ],
          nearestHaven: "Carn D\xFBm",
          region: "Angmar",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 11
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Nearest Darkhaven: Carn D\xFBm Playable: Items (minor, major) Automatic-attacks: Dragon \u2014 1 strike with 11 prowess"
        },
        {
          cardType: "minion-site",
          id: "le-361",
          name: "Cirith Gorgor",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/CirithGorgor.jpg",
          text: "Nearest Darkhaven: Minas Morgul",
          alignment: "ringwraith",
          siteType: "dark-hold",
          sitePath: [
            "shadow",
            "dark",
            "dark"
          ],
          nearestHaven: "Minas Morgul",
          region: "Ud\xFBn",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 1
        },
        {
          cardType: "minion-site",
          id: "le-362",
          name: "Cirith Ungol",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/CirithUngol.jpg",
          text: "Nearest Darkhaven: Minas Morgul",
          alignment: "ringwraith",
          siteType: "dark-hold",
          sitePath: [
            "shadow"
          ],
          nearestHaven: "Minas Morgul",
          region: "Imlad Morgul",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1
        },
        {
          cardType: "minion-site",
          id: "le-363",
          name: "Dale",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Dale.jpg",
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (gold ring) Automatic-attacks: Men \u2014 each character faces 1 strike with 5 prowess (detainment against covert company)",
          alignment: "ringwraith",
          siteType: "border-hold",
          sitePath: [
            "dark",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Dol Guldur",
          region: "Northern Rhovanion",
          playableResources: [
            "gold-ring"
          ],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2
        },
        {
          cardType: "minion-site",
          id: "le-364",
          name: "Dead Marshes",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/DeadMarshes.jpg",
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (minor, major) Automatic-attacks: Undead \u2014 2 strikes with 8 prowess; each character wounded must make a corruption check modified by -2 Special: Non-Nazg\xFBl creatures played at this site attack normally, not as detainment.",
          alignment: "ringwraith",
          siteType: "shadow-hold",
          sitePath: [
            "dark",
            "shadow"
          ],
          nearestHaven: "Dol Guldur",
          region: "Dagorlad",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Undead",
              strikes: 2,
              prowess: 8
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1
        },
        {
          cardType: "minion-site",
          id: "le-371",
          name: "Easterling Camp",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/EasterlingCamp.jpg",
          text: "Nearest Darkhaven: Dol Guldur Automatic-attacks: Men \u2014 each character faces 1 strike with 5 prowess (detainment against covert company)",
          alignment: "ringwraith",
          siteType: "border-hold",
          sitePath: [
            "dark",
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Dol Guldur",
          region: "Horse Plains",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2
        },
        {
          cardType: "minion-site",
          id: "le-391",
          name: "Minas Tirith",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/MinasTirith.jpg",
          text: "Nearest Darkhaven: Minas Morgul Playable: Information, Items (minor, major, gold ring) Automatic-attacks (2): (1st) Men \u2014 each character faces 1 strike with 9 prowess (detainment against covert company) (2nd) D\xFAnedain \u2014 4 strikes with 10 prowess (against overt company only)",
          alignment: "ringwraith",
          siteType: "free-hold",
          sitePath: [
            "shadow",
            "wilderness",
            "free"
          ],
          nearestHaven: "Minas Morgul",
          region: "An\xF3rien",
          playableResources: [
            "minor",
            "major",
            "gold-ring",
            "information"
          ],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 3
        },
        {
          cardType: "minion-site",
          id: "le-393",
          name: "Mount Doom",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/MountDoom.jpg",
          text: "Nearest Darkhaven: Minas Morgul Playable: Information Automatic-attacks: Orcs \u2014 1 strike with 6 prowess Special: Any sage may tap to test a ring at this site, modifying the result by -3.",
          alignment: "ringwraith",
          siteType: "shadow-hold",
          sitePath: [
            "shadow",
            "dark"
          ],
          nearestHaven: "Minas Morgul",
          region: "Gorgoroth",
          playableResources: [
            "information"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 1,
              prowess: 6
            }
          ],
          resourceDraws: 2,
          hazardDraws: 1
        },
        {
          cardType: "minion-site",
          id: "le-394",
          name: "Mount Gram",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/MountGram.jpg",
          text: "Nearest Darkhaven: Carn D\xFBm",
          alignment: "ringwraith",
          siteType: "shadow-hold",
          sitePath: [
            "shadow"
          ],
          nearestHaven: "Carn D\xFBm",
          region: "Angmar",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1
        },
        {
          cardType: "minion-site",
          id: "le-395",
          name: "Mount Gundabad",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/MountGundabad.jpg",
          text: "Nearest Darkhaven: Carn D\xFBm Playable: Items (minor, major) Automatic-attacks: Orcs \u2014 each character faces 1 strike with 7 prowess (detainment against overt company)",
          alignment: "ringwraith",
          siteType: "shadow-hold",
          sitePath: [
            "shadow",
            "dark"
          ],
          nearestHaven: "Carn D\xFBm",
          region: "Gundabad",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 1
        },
        {
          cardType: "minion-site",
          id: "le-396",
          name: "N\xFBrniag Camp",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/NurniagCamp.jpg",
          text: "Nearest Darkhaven: Minas Morgul",
          alignment: "ringwraith",
          siteType: "shadow-hold",
          sitePath: [
            "shadow",
            "dark",
            "dark"
          ],
          nearestHaven: "Minas Morgul",
          region: "Nurn",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1
        },
        {
          cardType: "minion-site",
          id: "le-399",
          name: "Raider-hold",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/Raiderhold.jpg",
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (minor, major*) *\u2014weapon, armor, shield, or helmet only Automatic-attacks: Men \u2014 each character faces 1 strike with 7 prowess (detainment against covert company)",
          alignment: "ringwraith",
          siteType: "border-hold",
          sitePath: [
            "dark",
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Dol Guldur",
          region: "Horse Plains",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2
        },
        {
          cardType: "minion-site",
          id: "le-401",
          name: "Sarn Goriwing",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SarnGoriwing.jpg",
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (minor, major) Automatic-attacks: Orcs \u2014 3 strikes with 5 prowess",
          alignment: "ringwraith",
          siteType: "shadow-hold",
          sitePath: [
            "dark",
            "wilderness"
          ],
          nearestHaven: "Dol Guldur",
          region: "Heart of Mirkwood",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 3,
              prowess: 5
            }
          ],
          resourceDraws: 1,
          hazardDraws: 1
        },
        {
          cardType: "minion-site",
          id: "le-402",
          name: "Shelob\u2019s Lair",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/ShelobsLair.jpg",
          text: "Nearest Darkhaven: Minas Morgul Playable: Items (minor, major) Automatic-attacks (2): (1st) Orcs \u2014 2 strikes with 8 prowess (2nd) Spider (cannot be canceled) \u2014 1 strike with 16 prowess; any character wounded is immediately eliminated Special: Contains a hoard. Non-Nazg\xFBl creatures played at this site attack normally, not as detainment.",
          alignment: "ringwraith",
          siteType: "shadow-hold",
          sitePath: [
            "shadow"
          ],
          nearestHaven: "Minas Morgul",
          region: "Imlad Morgul",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 1
        },
        {
          cardType: "minion-site",
          id: "le-403",
          name: "Shrel-Kain",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/ShrelKain.jpg",
          text: "Nearest Darkhaven: Dol Guldur Playable: Items (minor, major) \u2014 weapon, armor, shield, or helmet only Automatic-attacks: Men \u2014 each character faces 1 strike with 8 prowess (detainment against covert company)",
          alignment: "ringwraith",
          siteType: "border-hold",
          sitePath: [
            "dark",
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Dol Guldur",
          region: "Dorwinion",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 2
        },
        {
          cardType: "minion-site",
          id: "le-404",
          name: "Southron Oasis",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SouthronOasis.jpg",
          text: "Nearest Darkhaven: Minas Morgul Automatic-attacks: Men \u2014 each character faces 1 strike with 5 prowess (detainment against covert company)",
          alignment: "ringwraith",
          siteType: "border-hold",
          sitePath: [
            "shadow",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "Minas Morgul",
          region: "Harondor",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2
        },
        {
          cardType: "minion-site",
          id: "le-413",
          name: "The Wind Throne",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TheWindThrone.jpg",
          text: "Nearest Darkhaven: Dol Guldur Playable: Information, Items (minor, major) Automatic-attacks: Orcs \u2014 3 strikes with 7 prowess",
          alignment: "ringwraith",
          siteType: "ruins-and-lairs",
          sitePath: [
            "dark",
            "wilderness",
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Dol Guldur",
          region: "Grey Mountain Narrows",
          playableResources: [
            "minor",
            "major",
            "information"
          ],
          automaticAttacks: [
            {
              creatureType: "Orcs",
              strikes: 3,
              prowess: 7
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2
        },
        {
          cardType: "minion-site",
          alignment: "ringwraith",
          id: "le-411",
          name: "Variag Camp",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/VariagCamp.jpg",
          siteType: "border-hold",
          sitePath: [
            "shadow",
            "wilderness",
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Minas Morgul",
          region: "Khand",
          playableResources: [],
          automaticAttacks: [
            {
              creatureType: "Men",
              strikes: -1,
              prowess: 5,
              special: "each character faces 1 strike",
              detainmentAgainstCovert: true
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Darkhaven: Minas Morgul. Automatic-attacks: Men \u2014 each character faces 1 strike with 5 prowess (detainment against covert company)."
        }
      ];
    }
  });

  // ../shared/src/data/le-items.json
  var le_items_default;
  var init_le_items = __esm({
    "../shared/src/data/le-items.json"() {
      le_items_default = [
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "le-315",
          name: "The Least of Gold Rings",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TheLeastofGoldRings.jpg",
          unique: false,
          subtype: "gold-ring",
          keywords: [
            "ring"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 4,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "on-event",
              event: "untap-phase-end",
              apply: {
                type: "force-check",
                check: "corruption"
              },
              target: "bearer"
            },
            {
              type: "storable-at",
              sites: [
                "Dol Guldur",
                "Minas Morgul",
                "Carn D\xFBm"
              ]
            }
          ],
          text: "Bearer must make a corruption check at the end of each of his untap phases. Discard this ring when tested. If tested, obtain a random value to determine which ring card may be immediately played: The One Ring (12+); a Dwarven Ring (10,11,12+); a Magic Ring (1,2,3,4,5,6,7); a Lesser Ring (any result).",
          certified: "2026-04-19"
        },
        {
          cardType: "minion-resource-item",
          alignment: "ringwraith",
          id: "le-418",
          name: "The Arkenstone",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/TheArkenstone.jpg",
          unique: true,
          subtype: "greater",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 3,
          marshallingCategory: "item",
          corruptionPoints: 3,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Unique. +5 to bearer\u2019s direct influence against Dwarves and Dwarf factions. Each Dwarf in play has +1 mind. If the bearer of this item is at the same site as a Dwarf character, you may discard this item to force the discard of the Dwarf (and all non-follower cards he controls)."
        },
        {
          cardType: "minion-resource-item",
          id: "le-311",
          name: "Gleaming Gold Ring",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/GleamingGoldRing.jpg",
          text: "May only be played at a Border-hold [{B}] where gold rings are playable. Bearer must make a corruption check at the end of each of his untap phases. Discard this ring when tested. If tested, obtain a random value to determine which ring card may be immediately played: a Spirit Ring (10,11,12+); a Dwarven Ring (9,10,11,12+); a Magic Ring (1,2,3,4,5,6); a Lesser Ring (any result). You may search your play deck and discard pile for a Lesser Ring to be played.",
          alignment: "ringwraith",
          unique: false,
          subtype: "gold-ring",
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          keywords: [
            "ring"
          ]
        },
        {
          cardType: "minion-resource-item",
          id: "le-324",
          name: "Minor Ring",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/MinorRing.jpg",
          text: "Lesser Ring. Playable only with a gold ring and after a test indicates a Lesser Ring. +2 to direct influence. Cannot be duplicated on a given character.",
          alignment: "ringwraith",
          unique: false,
          subtype: "special",
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          keywords: [
            "ring"
          ]
        },
        {
          cardType: "minion-resource-item",
          id: "le-333",
          name: "Palant\xEDr of Minas Tirith",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/PalantirofMinasTirith.jpg",
          text: "Unique. Palant\xEDr. Playable at Minas Tirith. With its bearer able to use a Palant\xEDr, tap Palant\xEDr of Minas Tirith to look at the top five cards of your play deck; shuffle these 5 cards and return then to the top of your play deck. Do the same to your opponent\u2019s play deck. Bearer then makes a corruption check.",
          alignment: "ringwraith",
          unique: true,
          subtype: "special",
          marshallingPoints: 3,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "minion-resource-item",
          id: "le-341",
          name: "Sable Shield",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/SableShield.jpg",
          text: "Unique. Shield. If a strike against the bearer is successful, he is not wounded. Instead, the attacker makes a roll\u2014if this result is greater than 6, discard Sable Shield.",
          alignment: "ringwraith",
          unique: true,
          subtype: "major",
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "minion-resource-item",
          id: "le-345",
          name: "Strange Rations",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/StrangeRations.jpg",
          text: "Discard to untap bearer. Alternatively, discard during organization phase to allow its bearer\u2019s company to play an additional region card.",
          alignment: "ringwraith",
          unique: false,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "minion-resource-item",
          id: "le-339",
          name: "Red Book of Westmarch",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/le/RedBookofWestmarch.jpg",
          text: "Unique. Playable at Bag End. May be stored at Barad-d\xFBr for 5 marshalling points.",
          alignment: "ringwraith",
          unique: true,
          subtype: "special",
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        }
      ];
    }
  });

  // ../shared/src/data/wh-characters.json
  var wh_characters_default;
  var init_wh_characters = __esm({
    "../shared/src/data/wh-characters.json"() {
      wh_characters_default = [
        {
          cardType: "minion-character",
          id: "wh-10",
          name: "Sly Southerner",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/SlySoutherner.jpg",
          text: "Half-orc. Discard on a body check result of 9.",
          alignment: "ringwraith",
          unique: true,
          race: "orc",
          skills: [
            "warrior",
            "scout"
          ],
          prowess: 1,
          body: 9,
          mind: 2,
          directInfluence: 0,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any Dark-hold"
        },
        {
          cardType: "minion-character",
          id: "wh-5",
          name: "Ill-favoured Fellow",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/IllfavouredFellow.jpg",
          text: "Half-orc. Discard on a body check result of 9.",
          alignment: "ringwraith",
          unique: true,
          race: "orc",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 2,
          body: 9,
          mind: 3,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Any Dark-hold"
        },
        {
          cardType: "minion-character",
          id: "wh-6",
          name: "Lugdush",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/Lugdush.jpg",
          text: "Unique. Uruk-hai. Discard on a body check result of 8.",
          alignment: "ringwraith",
          unique: true,
          race: "orc",
          skills: [
            "warrior",
            "scout"
          ],
          prowess: 5,
          body: 8,
          mind: 4,
          directInfluence: 0,
          marshallingPoints: 1,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Isengard"
        }
      ];
    }
  });

  // ../shared/src/data/wh-items.json
  var wh_items_default;
  var init_wh_items = __esm({
    "../shared/src/data/wh-items.json"() {
      wh_items_default = [
        {
          cardType: "minion-resource-item",
          id: "wh-51",
          name: "Blasting Fire",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/BlastingFire.jpg",
          text: "Technology. Playable at a tapped or untapped Shadow-hold [{S}] , Dark-hold [{D}] , or a site with a Dwarf automatic-attack. Discard to cancel all automatic-attacks at a site against the bearer\u2019s company, any influence attempts against factions at the site this turn are modified by +2.",
          alignment: "ringwraith",
          unique: false,
          subtype: "special",
          marshallingPoints: 1,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "minion-resource-item",
          id: "wh-54",
          name: "Vile Fumes",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/VileFumes.jpg",
          text: "Technology. Playable at a tapped or untapped Shadow-hold [{S}] , Dark-hold [{D}] , or a site with a Dwarf automatic-attack. Discard during the site phase at a Border-hold [{B}] or Shadow-hold [{S}] to make all versions of the site Ruins & Lairs [{R}]. Its normal automatic-attacks are replaced with: Gas\u2014each character faces 1 strike with 7 prowess (cannot be canceled). Keep Vile Fumes with the site until the site is discarded or returned to its location deck.",
          alignment: "ringwraith",
          unique: false,
          subtype: "special",
          marshallingPoints: 1,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        }
      ];
    }
  });

  // ../shared/src/data/wh-resources.json
  var wh_resources_default;
  var init_wh_resources = __esm({
    "../shared/src/data/wh-resources.json"() {
      wh_resources_default = [
        {
          cardType: "hero-resource-event",
          alignment: "fallen-wizard",
          id: "wh-75",
          name: "Hidden Haven",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/HiddenHaven.jpg",
          unique: false,
          text: "Playable on a non-Dragon's lair Ruins & Lairs in a Wilderness, Border-land, or Shadow-land. This site becomes one of your Wizardhavens and loses all automatic-attacks. Nothing is considered playable as written on the site card. If one of your companies is at this site, all attacks against it are canceled."
        },
        {
          cardType: "hero-resource-event",
          alignment: "fallen-wizard",
          id: "wh-82",
          name: "Thrall of the Voice",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/ThralloftheVoice.jpg",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 1,
          marshallingCategory: "misc",
          text: "Instead of a normal character, during your organization phase you may bring into play one character (including a minion agent) with up to a 6 mind. Place this card with the character. -1 to his mind to a minimum of 1. Such a character may also be in your starting company."
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "wh-34",
          name: "Promptings of Wisdom",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/PromptingsofWisdom.jpg",
          unique: false,
          eventType: "permanent",
          corruptionPoints: 2,
          keywords: [
            "light-enchantment"
          ],
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                "target.skills": {
                  $includes: "ranger"
                }
              }
            },
            {
              type: "duplication-limit",
              scope: "company",
              max: 1
            },
            {
              type: "grant-action",
              action: "cancel-return-and-site-tap",
              cost: {
                tap: "bearer"
              },
              apply: {
                type: "sequence",
                apps: [
                  {
                    type: "add-constraint",
                    constraint: "cancel-return-and-site-tap",
                    scope: "turn",
                    target: "bearer-company"
                  },
                  {
                    type: "enqueue-corruption-check"
                  }
                ]
              }
            }
          ],
          certified: "2026-04-15",
          text: "Light Enchantment. Playable during the organization phase on a ranger. Target ranger may tap to cancel all hazard effects for the rest of the turn that: force his company to return to its site of origin or that tap his company's current or new site. If so tapped, target ranger makes a corruption check. Cannot be duplicated in a given company."
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "wh-43",
          name: "Crept Along Cleverly",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/CreptAlongCleverly.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Ranger only. Cancels a Wolf, Animal, Spider, Dragon, Drake, or Undead attack against a ranger\u2019s company."
        },
        {
          cardType: "minion-resource-event",
          alignment: "ringwraith",
          id: "wh-47",
          name: "Piercing All Shadows",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/PiercingAllShadows.jpg",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [],
          text: "Playable during the organization phase on a ranger. Target ranger may tap to cancel all hazard effects for the rest of the turn that: force his company to return to its site of origin or that tap his company\u2019s current or new site. If so tapped, target ranger makes a corruption check. Cannot be duplicated in a given company."
        },
        {
          cardType: "hero-resource-ally",
          id: "wh-33",
          name: "Noble Steed",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/NobleSteed.jpg",
          text: "Playable at any tapped or untapped non-Haven site in Rohan, Southern Rhovanion, Khand, Dorwinion, Horse Plains, or Harondor. If each character in a company controls a Noble Steed (or Bill the Pony or Shadowfax ), the company may move up to two additional regions. Tap to cancel a strike (not from an automatic-attack) against its bearer or itself.",
          alignment: "wizard",
          unique: false,
          prowess: 0,
          body: 8,
          mind: 1,
          marshallingPoints: 1,
          marshallingCategory: "ally",
          playableAt: []
        }
      ];
    }
  });

  // ../shared/src/data/wh-sites.json
  var wh_sites_default;
  var init_wh_sites = __esm({
    "../shared/src/data/wh-sites.json"() {
      wh_sites_default = [
        {
          cardType: "fallen-wizard-site",
          alignment: "fallen-wizard",
          id: "wh-58",
          name: "The White Towers",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/wh/TheWhiteTowers.jpg",
          siteType: "haven",
          sitePath: [],
          nearestHaven: "",
          region: "Arthedain",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "If one of your companies is at this site, all attacks against it are canceled.",
          effects: [
            { type: "site-rule", rule: "cancel-attacks" }
          ]
        }
      ];
    }
  });

  // ../shared/src/data/td-characters.json
  var td_characters_default;
  var init_td_characters = __esm({
    "../shared/src/data/td-characters.json"() {
      td_characters_default = [
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "td-90",
          name: "Brand",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Brand.jpg",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "diplomat"
          ],
          prowess: 4,
          body: 9,
          mind: 6,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Dale",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2,
              when: {
                reason: "faction-influence-check",
                "faction.name": "Men of Dale"
              }
            }
          ],
          text: "Unique. +2 direct influence against Men of Dale faction.",
          certified: "2026-04-22"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "td-91",
          name: "Fram Framson",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/FramFramson.jpg",
          unique: true,
          race: "man",
          skills: [
            "warrior",
            "ranger"
          ],
          prowess: 6,
          body: 8,
          mind: 5,
          directInfluence: 0,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Framsburg",
          effects: [
            {
              type: "play-flag",
              flag: "not-starting-character"
            },
            {
              type: "play-flag",
              flag: "home-site-only"
            }
          ],
          text: "Unique. He may not be one of the starting characters. He may only be brought into play at his home site. +3 prowess against Dragon and Drake attacks.",
          certified: "2026-04-20"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "td-92",
          name: "Galdor",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Galdor.jpg",
          unique: true,
          race: "elf",
          skills: [
            "ranger",
            "diplomat"
          ],
          prowess: 2,
          body: 9,
          mind: 5,
          directInfluence: 2,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Grey Havens",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 1,
              when: {
                reason: "influence-check",
                "target.race": "elf"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 1,
              when: {
                reason: "faction-influence-check",
                "faction.race": "elf"
              }
            }
          ],
          text: "Unique. +1 direct influence against Elves and Elf factions.",
          certified: "2026-04-22"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "td-93",
          name: "Ioreth",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Ioreth.jpg",
          unique: true,
          race: "dunadan",
          skills: [
            "sage"
          ],
          prowess: 0,
          body: 7,
          mind: 1,
          directInfluence: 1,
          marshallingPoints: 0,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Minas Tirith",
          effects: [
            { type: "company-rule", rule: "healing-affects-all" }
          ],
          text: "Unique. Healing effects affect all characters in her company.",
          certified: "2026-04-14"
        },
        {
          cardType: "hero-character",
          alignment: "wizard",
          id: "td-94",
          name: "Thr\xE1in II",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ThrainII.jpg",
          unique: true,
          race: "dwarf",
          skills: [
            "warrior",
            "ranger",
            "sage"
          ],
          prowess: 7,
          body: 8,
          mind: 9,
          directInfluence: 2,
          marshallingPoints: 3,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "None",
          text: "Unique. +3 direct influence against Dwarves and Dwarf factions.",
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 3,
              when: {
                reason: "influence-check",
                "target.race": "dwarf"
              }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 3,
              when: {
                reason: "faction-influence-check",
                "faction.race": "dwarf"
              }
            }
          ],
          certified: "2026-04-22"
        }
      ];
    }
  });

  // ../shared/src/data/td-items.json
  var td_items_default;
  var init_td_items = __esm({
    "../shared/src/data/td-items.json"() {
      td_items_default = [
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-105",
          name: "Cram",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Cram.jpg",
          unique: false,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "grant-action",
              action: "untap-bearer",
              anyPhase: true,
              cost: {
                discard: "self"
              },
              when: {
                "bearer.status": "tapped"
              },
              apply: {
                type: "set-character-status",
                target: "bearer",
                status: "untapped"
              }
            },
            {
              type: "grant-action",
              action: "extra-region-movement",
              cost: {
                discard: "self"
              },
              when: {
                "company.hasPlannedMovement": false,
                "company.hasExtraRegionDistance": false
              },
              apply: {
                type: "increment-company-extra-region-distance",
                amount: 1
              }
            }
          ],
          text: "Discard to untap bearer. Alternatively, discard during organization phase to allow its bearer's company to play an additional region card.",
          certified: "2026-04-08"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-96",
          name: "Adamant Helmet",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/AdamantHelmet.jpg",
          unique: false,
          subtype: "minor",
          keywords: [
            "hoard",
            "helmet"
          ],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 1,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            },
            {
              type: "stat-modifier",
              stat: "body",
              value: 1,
              max: 9
            },
            {
              type: "ward-bearer",
              filter: {
                keywords: {
                  $includes: "dark-enchantment"
                }
              }
            }
          ],
          text: "Hoard item. Helmet. +1 to body to a maximum of 9. Cancels all dark enchantments targetting bearer.",
          certified: "2026-04-22"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-99",
          name: "Arrows Shorn of Ebony",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ArrowsShornofEbony.jpg",
          unique: false,
          subtype: "minor",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Hoard item. Warrior only: discard Arrows Shorn of Ebony to modify a strike from a hazard creature attack not keyed to a site by -1 prowess, -2 body. If this strike is defeated, all other subsequent failed strikes from this attack are automatically defeated."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-102",
          name: "Bow of Dragon-horn",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/BowofDragonhorn.jpg",
          unique: true,
          subtype: "major",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Unique. Hoard item. Warrior only: tap bow to reduce the number of strikes from one hazard creature attack not keyed to a site by one (to a minimum of one)."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-112",
          name: "Emerald of Doriath",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/EmeraldofDoriath.jpg",
          unique: true,
          subtype: "minor",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Unique. Hoard item. +1 to direct influence against Elves and Elf factions. If bearer is a Wizard, your general influence is increased by two."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-113",
          name: "Emerald of the Mariner",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/EmeraldoftheMariner.jpg",
          unique: true,
          subtype: "greater",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 3,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Unique. Hoard item. Bearer receives +1 to all of his corruption checks. You may keep one more card than normal in your hand. This item is considered a source of 0 corruption points."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-114",
          name: "Enruned Shield",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/EnrunedShield.jpg",
          unique: true,
          subtype: "greater",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 3,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            },
            {
              type: "stat-modifier",
              stat: "body",
              value: 3,
              max: 10
            },
            {
              type: "cancel-strike",
              cost: { tap: "self" },
              when: { "bearer.skills": { $includes: "warrior" } }
            }
          ],
          text: "Unique. Hoard item. Shield. +3 to body to a maximum of 10. Warrior only: tap Enruned Shield to cause one strike against bearer to be ineffectual (i. e., it doesn\u2019t fail and it is not successful).",
          certified: "2026-04-22"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-120",
          name: "Habergeon of Silver",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/HabergeonofSilver.jpg",
          unique: false,
          subtype: "major",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 2,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            },
            {
              type: "stat-modifier",
              stat: "body",
              value: 2,
              max: 10
            }
          ],
          text: "Hoard item. Armor. Bearer receives +2 body to a maximum of 10.",
          certified: "2026-04-22"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-130",
          name: "Magical Harp",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/MagicalHarp.jpg",
          unique: true,
          subtype: "major",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            },
            {
              type: "grant-action",
              action: "cancel-character-discard",
              cost: { tap: "self" },
              anyPhase: true,
              opposingSitePhase: true,
              freeCouncil: true,
              apply: {
                type: "sequence",
                apps: [
                  {
                    type: "add-constraint",
                    constraint: "cancel-character-discard",
                    scope: "turn",
                    target: "bearer-company"
                  },
                  {
                    type: "enqueue-corruption-check"
                  }
                ]
              }
            }
          ],
          certified: "2026-04-22",
          text: "Unique. Hoard item. Tap Magical Harp to cancel all effects for the rest of the turn that discard a target character in bearer\u2019s company. Bearer makes a corruption check. This item may also be so tapped during opponent\u2019s site phase or the Free Council."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-141",
          name: "Necklace of Silver and Pearls",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/NecklaceofSilverandPearls.jpg",
          unique: false,
          subtype: "minor",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Hoard item. Discard this card to give +3 direct influence and +5 mind to bearer until the end of the turn. The bearer\u2019s additional mind does not use any controlling influence. This item may also be so discarded during opponent\u2019s site phase."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-150",
          name: "Scabbard of Chalcedony",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ScabbardofChalcedony.jpg",
          unique: false,
          subtype: "minor",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Hoard item. -1 body to all failed strikes against bearer. Cannot be duplicated on a given character."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-161",
          name: "Valiant Sword",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ValiantSword.jpg",
          unique: false,
          subtype: "major",
          keywords: [
            "hoard",
            "weapon"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 2,
              max: 9
            },
            {
              type: "stat-modifier",
              stat: "body",
              value: 1,
              max: 9,
              when: {
                "bearer.skills": {
                  $includes: "warrior"
                }
              }
            }
          ],
          text: "Hoard item. Weapon. +2 to bearer\u2019s prowess to a maximum of 9. Warrior only: +1 to body to a maximum of 9.",
          certified: "2026-04-22"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-170",
          name: "Wizard\u2019s Staff",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/WizardsStaff.jpg",
          unique: false,
          subtype: "greater",
          keywords: [
            "hoard",
            "weapon"
          ],
          marshallingPoints: 3,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 2,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            },
            {
              type: "play-target",
              target: "character",
              filter: {
                "target.race": "wizard"
              }
            },
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 2
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 2
            },
            {
              type: "check-modifier",
              check: "corruption",
              value: 2,
              when: {
                "source.keywords": {
                  $includes: "spell"
                }
              }
            },
            {
              type: "grant-action",
              action: "wizards-staff-fetch",
              cost: {
                tap: "bearer"
              },
              apply: {
                type: "sequence",
                apps: [
                  {
                    type: "move",
                    select: "target",
                    from: "discard",
                    to: "hand",
                    filter: {
                      $or: [
                        { keywords: { $includes: "spell" } },
                        { keywords: { $includes: "ritual" } },
                        { keywords: { $includes: "light-enchantment" } }
                      ]
                    }
                  },
                  {
                    type: "enqueue-corruption-check"
                  }
                ]
              }
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            }
          ],
          text: "Hoard item. Weapon. Only a Wizard may bear this item. + 2 to direct influence and +2 to prowess. +2 to any corruption check required by a spell card. Tap bearer at the beginning of your end-of-turn phase to take one \u201Cspell,\u201D \u201Critual,\u201D or \u201Clight enchantment\u201D from your discard pile into your hand. Bearer makes corruption check. Cannot be duplicated on a given Wizard.",
          certified: "2026-04-22"
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-183",
          name: "Horn of Defiance",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/HornofDefiance.jpg",
          unique: true,
          subtype: "greater",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 1,
          marshallingCategory: "item",
          corruptionPoints: 1,
          prowessModifier: 2,
          bodyModifier: 0,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Unique. Hoard item . +2 direct influence. A stored Reforging may be placed with this item to \u201Crestore\u201D it. Once restored, Horn of Defiance gives 3 marshalling points and 2 corruption points. If its bearer is the first to face a strike, that character may choose to face all strikes of an attack. The character faces a separate strike sequence for each strike."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-184",
          name: "Ringil",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Ringil.jpg",
          unique: true,
          subtype: "greater",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 1,
          bodyModifier: 1,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Unique. Hoard item. Weapon. +1 body. Warrior only: +1 prowess (to a maximum of 8). A stored Reforging may be placed with this item to \u201Crestore\u201D it. Once restored, Ringil gives 4 marshalling points, 3 corruption points and +5 prowess (to a maximum of 11)."
        },
        {
          cardType: "hero-resource-item",
          alignment: "wizard",
          id: "td-185",
          name: "Belegennon",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Belegennon.jpg",
          unique: true,
          subtype: "greater",
          keywords: [
            "hoard"
          ],
          marshallingPoints: 2,
          marshallingCategory: "item",
          corruptionPoints: 2,
          prowessModifier: 0,
          bodyModifier: 1,
          playableAt: [],
          effects: [
            {
              type: "item-play-site",
              filter: {
                "site.keywords": {
                  $includes: "hoard"
                }
              }
            }
          ],
          text: "Unique. Hoard item. Armor. +1 body (to a maximum of 9). A stored Reforging may be placed with this item to \u201Crestore\u201D it. Once restored, Belegennon gives 4 marshalling points and 3 corruption points. Warrior only (restored): If bearer chooses not to tap against a strike, he receives no prowess penalty."
        },
        {
          cardType: "hero-resource-item",
          id: "td-158",
          name: "Thr\xF3r\u2019s Map",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ThrorsMap.jpg",
          text: "Unique. Discard Thr\xF3r\u2019s Map to untap a site with a Dragon automatic-attack.",
          alignment: "wizard",
          unique: true,
          subtype: "minor",
          marshallingPoints: 0,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        },
        {
          cardType: "hero-resource-item",
          id: "td-172",
          name: "Wormsbane",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Wormsbane.jpg",
          text: "Unique. Weapon. +2 to prowess to a maximum of 9 (+4 to prowess to a maximum of 12 and -2 to strike\u2019s body against a Dragon or Drake strike).",
          alignment: "wizard",
          unique: true,
          subtype: "greater",
          marshallingPoints: 4,
          marshallingCategory: "item",
          corruptionPoints: 0,
          prowessModifier: 0,
          bodyModifier: 0,
          playableAt: []
        }
      ];
    }
  });

  // ../shared/src/data/td-resources.json
  var td_resources_default;
  var init_td_resources = __esm({
    "../shared/src/data/td-resources.json"() {
      td_resources_default = [
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "td-98",
          name: "And Forth He Hastened",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/AndForthHeHastened.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                $and: [
                  {
                    "target.status": "tapped"
                  },
                  {
                    "target.inAvatarCompany": true
                  }
                ]
              }
            },
            {
              type: "play-option",
              id: "untap",
              apply: {
                type: "set-character-status",
                status: "untapped"
              }
            }
          ],
          text: "Untap a character in your Wizard's company.",
          certified: "2026-04-14"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "td-134",
          name: "Marvels Told",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/MarvelsTold.jpg",
          unique: false,
          eventType: "short",
          keywords: [
            "ritual"
          ],
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                "target.skills": {
                  $includes: "sage"
                }
              },
              cost: {
                tap: "character"
              }
            },
            {
              type: "move",
              select: "target",
              from: "in-play",
              to: "discard",
              filter: {
                $and: [
                  {
                    cardType: "hazard-event"
                  },
                  {
                    eventType: {
                      $in: [
                        "permanent",
                        "long"
                      ]
                    }
                  },
                  {
                    $not: {
                      keywords: {
                        $includes: "environment"
                      }
                    }
                  }
                ]
              },
              corruptionCheck: {
                modifier: -2
              }
            }
          ],
          text: "Sage only. Ritual. Tap a sage to force the discard of a hazard non-environment permanent-event or long-event. Sage makes a corruption check modified by -2.",
          certified: "2026-04-13"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "td-132",
          name: "Many Turns and Doublings",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ManyTurnsandDoublings.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "cancel-attack",
              requiredSkill: "ranger",
              when: {
                "enemy.race": {
                  $in: [
                    "wolf",
                    "spider",
                    "animal",
                    "undead"
                  ]
                }
              }
            },
            {
              type: "play-target",
              target: "character",
              filter: {
                "target.skills": {
                  $includes: "ranger"
                }
              }
            },
            {
              type: "play-option",
              id: "decrease-hazard-limit",
              when: {
                inPlay: "Gates of Morning"
              },
              apply: {
                type: "add-constraint",
                constraint: "hazard-limit-modifier",
                scope: "company-mh-phase",
                value: -1
              }
            }
          ],
          text: "Ranger only. Cancel an attack by Wolves, Spiders, Animals, or Undead against a ranger's company. Alternatively, if Gates of Morning is in play, decrease the hazard limit against the ranger's company by one (no minimum).",
          certified: "2026-04-15"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "td-169",
          name: "Wizard Uncloaked",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/WizardUncloaked.jpg",
          unique: false,
          eventType: "short",
          keywords: [
            "spell"
          ],
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                "target.race": "wizard"
              }
            },
            {
              type: "move",
              select: "filter-all",
              from: "attached-to-target-company",
              to: "hand",
              toOwner: "opponent",
              filter: {
                $and: [
                  { cardType: "hazard-event" },
                  { eventType: "permanent" }
                ]
              },
              corruptionCheck: {
                modifier: -2
              }
            }
          ],
          text: "Spell. Wizard only. Return all hazard permanent-events on characters in your Wizard's company to opponent's hand. Wizard makes a corruption check modified by -2.\n\nCannot be included in a Fallen-wizard's deck.",
          certified: "2026-04-15"
        },
        {
          cardType: "hero-resource-event",
          id: "td-101",
          name: "Bounty of the Hoard",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/BountyoftheHoard.jpg",
          text: "Playable during the site phase. One minor or major item may be played at a tapped site that contains a hoard.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-event",
          id: "td-116",
          name: "Flatter a Foe",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/FlatteraFoe.jpg",
          text: "Flattery attempt. Playable on a character whose company is facing an attack of the type listed below. Character makes an influence check (modified by his unused direct influence and +2 if a diplomat). If successful, the attack is canceled and the hazard limit for the character\u2019s company is decreased by two. This influence check is successful if the result is greater than: 10 against a Dragon; 11 against Men or Drakes; 12 against Trolls, Orcs, Elves and Giants.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-faction",
          id: "td-138",
          name: "Men of Dale",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/MenofDale.jpg",
          text: "Unique. Playable at Dale if the influence check is greater than 7. Standard Modifications: Men (+2), Dwarves (+1).",
          alignment: "wizard",
          unique: true,
          marshallingPoints: 2,
          marshallingCategory: "faction",
          influenceNumber: 8,
          race: "man",
          playableAt: [
            {
              site: "Dale"
            }
          ],
          effects: [
            {
              type: "check-modifier",
              check: "influence",
              value: 2,
              when: {
                "bearer.race": "man"
              }
            },
            {
              type: "check-modifier",
              check: "influence",
              value: 1,
              when: {
                "bearer.race": "dwarf"
              }
            }
          ]
        },
        {
          cardType: "hero-resource-event",
          id: "td-143",
          name: "Not at Home",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/NotatHome.jpg",
          text: "Cancel one Dragon, Drake, or Troll attack. This attack must be either an automatic-attack or keyed to a site. Alternatively, if Gates of Morning is in play, reduce the number of strikes of any automatic-attack by 2 (to a minimum of 1).",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        }
      ];
    }
  });

  // ../shared/src/data/td-hazards.json
  var td_hazards_default;
  var init_td_hazards = __esm({
    "../shared/src/data/td-hazards.json"() {
      td_hazards_default = [
        {
          cardType: "hazard-event",
          id: "td-21",
          name: "E\xE4rcarax\xEB Ahunt",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/EarcaraxeAhunt.jpg",
          unique: true,
          eventType: "long",
          effects: [
            {
              type: "duplication-limit",
              scope: "game",
              max: 1
            },
            {
              type: "ahunt-attack",
              regionNames: [
                "Andrast Coast",
                "Bay of Belfalas",
                "Eriadoran Coast",
                "Andrast"
              ],
              strikes: 3,
              prowess: 15,
              body: 6,
              race: "dragon",
              combatRules: [
                "attacker-chooses-defenders"
              ],
              extended: {
                when: {
                  inPlay: "Doors of Night"
                },
                regionNames: [
                  "Old P\xFBkel-land",
                  "Enedhwaith",
                  "Anfalas"
                ],
                regionTypes: [
                  "coastal-sea"
                ]
              }
            }
          ],
          text: "Unique. Any company moving in Andrast Coast, Bay of Belfalas, Eriadoran Coast, and/or Andrast faces one Dragon attack (considered a hazard creature attack) \u2014 3 strikes at 15/6 (attacker chooses defending characters). If Doors of Night is in play, this attack also affects: Old P\xFBkel-land, Enedhwaith, Anfalas, and any Coastal Sea region (or region type).",
          certified: "2026-04-14",
          manifestId: "td-20"
        },
        {
          cardType: "hazard-event",
          id: "td-25",
          name: "Foolish Words",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/FoolishWords.jpg",
          unique: false,
          eventType: "permanent",
          keywords: [],
          effects: [
            {
              type: "play-target",
              target: "character"
            },
            {
              type: "on-guard-reveal",
              trigger: "influence-attempt"
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            },
            {
              type: "check-modifier",
              check: [
                "influence",
                "riddling",
                "offering"
              ],
              value: -4
            },
            {
              type: "grant-action",
              action: "remove-self-on-roll",
              cost: {
                tap: "bearer"
              },
              apply: {
                type: "roll-then-apply",
                threshold: 8,
                onSuccess: {
                  type: "move",
                  select: "self",
                  from: "self-location",
                  to: "discard"
                }
              }
            }
          ],
          text: "Playable on a character. Any riddling roll, offering attempt, or influence attempt by target character is modified by -4. If placed on-guard, it may be revealed and played when a character in the company declares such an attempt. During his organization phase, the character may tap to attempt to remove this card. Make a roll\u2014if the result is greater than 7, discard this card. Cannot be duplicated on a given character.",
          certified: "2026-04-06"
        },
        {
          cardType: "hazard-event",
          id: "td-27",
          name: "From the Pits of Angband",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/FromthePitsofAngband.jpg",
          unique: false,
          eventType: "long",
          effects: [
            {
              type: "duplication-limit",
              scope: "game",
              max: 1
            }
          ],
          text: "At the end of each turn, each player may take one unique Dragon manifestation or one Drake hazard creature from his discard pile and shuffle it into his play deck.Alternatively, if Doors of Night is in play, at the end of each turn, each player may return one unique Dragon manifestation and/or one Drake hazard creature from his discard pile to his hand.Cannot be duplicated."
        },
        {
          cardType: "hazard-event",
          id: "td-37",
          name: "Itangast Ahunt",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ItangastAhunt.jpg",
          unique: true,
          eventType: "long",
          effects: [
            {
              type: "duplication-limit",
              scope: "game",
              max: 1
            },
            {
              type: "ahunt-attack",
              regionNames: [
                "Withered Heath",
                "Northern Rhovanion",
                "Iron Hills",
                "Grey Mountain Narrows"
              ],
              strikes: 4,
              prowess: 16,
              body: 7,
              race: "dragon",
              extended: {
                when: {
                  inPlay: "Doors of Night"
                },
                regionNames: [
                  "Southern Rhovanion",
                  "Dorwinion",
                  "Heart of Mirkwood",
                  "Woodland Realm"
                ]
              }
            }
          ],
          text: "Unique. Any company moving in Withered Heath, Northern Rhovanion, Iron Hills, and/or Grey Mountain Narrows faces one Dragon attack (considered a hazard creature attack) \u2014 4 strikes at 16/7.If Doors of Night is in play, this attack also affects: Southern Rhovanion, Dorwinion, Heart of Mirkwood, and Woodland Realm.",
          certified: "2026-04-23",
          manifestId: "td-36"
        },
        {
          cardType: "hazard-event",
          id: "td-1",
          name: "Agburanar Ahunt",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/AgburanarAhunt.jpg",
          unique: true,
          eventType: "long",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [],
          text: "Unique. Any company moving in Withered Heath, Northern Rhovanion, Iron Hills, and/or Grey Mountain Narrows faces one Dragon attack (considered a hazard creature attack) \u2014 3 strikes at 13/8. If Doors of Night is in play, this attack also affects: Southern Rhovanion, Dorwinion, Heart of Mirkwood, and Woodland Realm.",
          manifestId: "tw-3"
        },
        {
          cardType: "hazard-event",
          id: "td-4",
          name: "Bairanax Ahunt",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/BairanaxAhunt.jpg",
          unique: true,
          eventType: "long",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [],
          text: "Unique. Any company moving in Withered Heath, Gundabad, Anduin Vales, and/or Grey Mountain Narrows faces one Dragon attack (considered a hazard creature attack) \u2014 3 strikes at 12/6 (attacker chooses defending characters). If Doors of Night is in play, this attack also affects: Northern Rhovanion, Iron Hills, Southern Rhovanion, and Angmar.",
          manifestId: "td-3"
        },
        {
          cardType: "hazard-event",
          id: "td-10",
          name: "Daelomin Ahunt",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/DaelominAhunt.jpg",
          unique: true,
          eventType: "long",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [],
          text: "Unique. Any company moving in Withered Heath, Northern Rhovanion, Iron Hills, and/or Grey Mountain Narrows faces one Dragon attack (considered a hazard creature attack) \u2014 4 strikes at 11/7 (attacker chooses defending characters). If Doors of Night is in play, this attack also affects: Brown Lands, Southern Rhovanion, Dorwinion, Dagorlad, and Horse Plains.",
          manifestId: "tw-26"
        },
        {
          cardType: "hazard-event",
          id: "td-43",
          name: "Leucaruth Ahunt",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/LeucaruthAhunt.jpg",
          unique: true,
          eventType: "long",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [],
          text: "Unique. Any company moving in Withered Heath, Northern Rhovanion, Iron Hills, and/or Grey Mountain Narrows faces one Dragon attack (considered a hazard creature attack) \u2014 3 strikes at 14/7. If Doors of Night is in play, this attack also affects: Southern Rhovanion, Dorwinion, Heart of Mirkwood, and Woodland Realm.",
          manifestId: "tw-48"
        },
        {
          cardType: "hazard-event",
          id: "td-61",
          name: "Scatha Ahunt",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ScathaAhunt.jpg",
          unique: true,
          eventType: "long",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [],
          text: "Unique. Any company moving in Withered Heath, Woodland Realm, Northern Rhovanion, and/or Grey Mountain Narrows faces one Dragon attack (considered a hazard creature attack) \u2014 4 strikes at 13/8. If Doors of Night is in play, this attack also affects: Anduin Vales, Western Mirkwood, Heart of Mirkwood, and Gundabad.",
          manifestId: "td-60"
        },
        {
          cardType: "hazard-event",
          id: "td-64",
          name: "Scorba Ahunt",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ScorbaAhunt.jpg",
          unique: true,
          eventType: "long",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [],
          text: "Unique. Any company moving in Forochel, Angmar, and/or Gundabad faces one Dragon attack (considered a hazard creature attack) \u2014 4 strikes at 10/7 (attacker chooses defending characters). If Doors of Night is in play, this attack also affects: N\xFAmeriador, Arthedain, and Rhudaur.",
          manifestId: "td-63"
        },
        {
          cardType: "hazard-event",
          id: "td-70",
          name: "Smaug Ahunt",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/SmaugAhunt.jpg",
          unique: true,
          eventType: "long",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [],
          text: "Unique. Any company moving in Withered Heath, Northern Rhovanion, Iron Hills, and/or Grey Mountain Narrows faces one Dragon attack (considered a hazard creature attack) \u2014 3 strikes at 15/7 (attacker chooses defending characters). If Doors of Night is in play, this attack also affects: Brown Lands, Southern Rhovanion, Dorwinion, Dagorlad, and Horse Plains.",
          manifestId: "tw-90"
        },
        {
          cardType: "hazard-event",
          id: "td-2",
          name: "Agburanar at Home",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/AgburanaratHome.jpg",
          unique: true,
          eventType: "permanent",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [
            {
              type: "dragon-at-home",
              attack: {
                creatureType: "Dragon",
                strikes: 2,
                prowess: 16
              }
            }
          ],
          text: "Unique. Unless Agburanar Ahunt is in play, Caves of \xDBlund has an additional automatic-attack: Dragon \u2014 2 strikes at 16/9. In addition, one unique Dragon manifestation played against each company does not count against the hazard limit.",
          manifestId: "tw-3"
        },
        {
          cardType: "hazard-event",
          id: "td-5",
          name: "Bairanax at Home",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/BairanaxatHome.jpg",
          unique: true,
          eventType: "permanent",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [
            {
              type: "dragon-at-home",
              attack: {
                creatureType: "Dragon",
                strikes: 2,
                prowess: 15
              }
            }
          ],
          text: "Unique. Unless Bairanax Ahunt is in play, Ovir Hollow has an additional automatic-attack: Dragon \u2014 2 strikes at 15/7. In addition, the hazard limit against any company facing one or more animal hazard creature attacks is increased by one.",
          manifestId: "td-3"
        },
        {
          cardType: "hazard-event",
          id: "td-11",
          name: "Daelomin at Home",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/DaelominatHome.jpg",
          unique: true,
          eventType: "permanent",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [
            {
              type: "dragon-at-home",
              attack: {
                creatureType: "Dragon",
                strikes: 3,
                prowess: 14
              }
            }
          ],
          text: "Unique. Unless Daelomin Ahunt is in play, Dancing Spire has an additional automatic-attack: Dragon \u2014 3 strikes at 14/8. In addition, you may discard this card from play during opponent\u2019s movement/hazard phase (not counting against the hazard limit) to increase the hazard limit against one company by two.",
          manifestId: "tw-26"
        },
        {
          cardType: "hazard-event",
          id: "td-22",
          name: "E\xE4rcarax\xEB at Home",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/EarcaraxeatHome.jpg",
          unique: true,
          eventType: "permanent",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [
            {
              type: "dragon-at-home",
              attack: {
                creatureType: "Dragon",
                strikes: 2,
                prowess: 18
              }
            }
          ],
          text: "Unique. Unless E\xE4rcarax\xEB Ahunt is in play, Isle of the Ulond has an additional automatic-attack: Dragon \u2014 2 strikes at 18/7 (attacker chooses defending characters). In addition, the hazard limit against any moving company with a Coastal Sea [{c}] region in its site path is increased by one.",
          manifestId: "td-20"
        },
        {
          cardType: "hazard-event",
          id: "td-38",
          name: "Itangast at Home",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ItangastatHome.jpg",
          unique: true,
          eventType: "permanent",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [
            {
              type: "dragon-at-home",
              attack: {
                creatureType: "Dragon",
                strikes: 3,
                prowess: 19
              }
            }
          ],
          text: "Unique. Unless Itangast Ahunt is in play, Gold Hill has an additional automatic-attack: Dragon \u2014 3 strikes at 19/8. In addition, each greater item gives an additional corruption point.",
          manifestId: "td-36"
        },
        {
          cardType: "hazard-event",
          id: "td-44",
          name: "Leucaruth at Home",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/LeucaruthatHome.jpg",
          unique: true,
          eventType: "permanent",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [
            {
              type: "dragon-at-home",
              attack: {
                creatureType: "Dragon",
                strikes: 2,
                prowess: 17
              }
            }
          ],
          text: "Unique. Unless Leucaruth Ahunt is in play, Irerock has an additional automatic-attack: Dragon \u2014 2 strikes at 17/8. In addition, only one unique Dragon manifestation may be played per turn.",
          manifestId: "tw-48"
        },
        {
          cardType: "hazard-event",
          id: "td-62",
          name: "Scatha at Home",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ScathaatHome.jpg",
          unique: true,
          eventType: "permanent",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [
            {
              type: "dragon-at-home",
              attack: {
                creatureType: "Dragon",
                strikes: 3,
                prowess: 16
              }
            }
          ],
          text: "Unique. Unless Scatha Ahunt is in play, Gondmaeglom has an additional automatic-attack: Dragon \u2014 3 strikes at 16/9. In addition, -1 to all influence attempts.",
          manifestId: "td-60"
        },
        {
          cardType: "hazard-event",
          id: "td-65",
          name: "Scorba at Home",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ScorbaatHome.jpg",
          unique: true,
          eventType: "permanent",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [
            {
              type: "dragon-at-home",
              attack: {
                creatureType: "Dragon",
                strikes: 3,
                prowess: 13
              }
            }
          ],
          text: "Unique. Unless Scorba Ahunt is in play, Zarak D\xFBm has an additional automatic-attack: Dragon \u2014 3 strikes at 13/8. In addition, each major item gives an additional corruption point.",
          manifestId: "td-63"
        },
        {
          cardType: "hazard-event",
          id: "td-71",
          name: "Smaug at Home",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/SmaugatHome.jpg",
          unique: true,
          eventType: "permanent",
          keywords: [
            "dragon-manifestation"
          ],
          effects: [
            {
              type: "dragon-at-home",
              attack: {
                creatureType: "Dragon",
                strikes: 2,
                prowess: 18
              }
            }
          ],
          text: "Unique. Unless Smaug Ahunt is in play, The Lonely Mountain has an additional automatic-attack: Dragon \u2014 2 strikes at 18/8. In addition, each moving company draws one less card to a minimum of one at the start of its movement/hazard phase.",
          manifestId: "tw-90"
        },
        {
          cardType: "hazard-event",
          id: "td-18",
          name: "Dragon-sickness",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Dragonsickness.jpg",
          text: "Playable on a character bearing a major or greater item. Character makes a corruption check modified by -1.",
          unique: false,
          eventType: "short",
          keywords: ["corruption"],
          effects: [
            {
              type: "play-target",
              target: "character",
              filter: {
                $or: [
                  { "target.itemSubtypes": { $includes: "major" } },
                  { "target.itemSubtypes": { $includes: "greater" } }
                ]
              },
              cost: { check: "corruption", modifier: -1 }
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hazard-event",
          id: "td-34",
          name: "Incite Denizens",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/InciteDenizens.jpg",
          text: "Playable on a Ruins & Lairs [{R}]. An additional automatic-attack is created at the site until the end of the turn. This is an exact duplicate (including all existing and eventual modifications to prowess, etc.) of an existing automatic-attack at the site of your choice. This automatic-attack is faced immediately following its original. Cannot be duplicated on a given site.",
          unique: false,
          eventType: "short"
        },
        {
          cardType: "hazard-event",
          id: "td-85",
          name: "Withered Lands",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/WitheredLands.jpg",
          text: "Environment. Playable if Doors of Night is in play. Treat one Wilderness [{w}] as two Wildernesses [{w}] or one Shadow-land [{s}] as two Wildernesses [{w}] or one Border-land [{b}] as two Wildernesses [{w}] until the end of the turn.",
          unique: false,
          eventType: "short"
        },
        {
          cardType: "hazard-event",
          id: "td-9",
          name: "Cruel Caradhras",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/CruelCaradhras.jpg",
          text: "Playable on a company using region movement to move through (not stopping at a site therein) or leave one of the following regions: High Pass, Redhorn Gate, Angmar, Gundabad, Grey Mountain Narrows, or Imlad Morgul. Each character in target company must face one strike (not an attack) of 8 prowess which cannot be canceled. Any resulting body check is modified by +1.",
          unique: false,
          eventType: "short"
        },
        {
          cardType: "hazard-event",
          id: "td-16",
          name: "Dragon's Curse",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/DragonsCurse.jpg",
          unique: false,
          eventType: "permanent",
          keywords: [
            "corruption",
            "dark-enchantment"
          ],
          effects: [
            {
              type: "play-window",
              phase: "combat",
              step: "resolve-strike"
            },
            {
              type: "play-condition",
              requires: "combat-creature-race",
              race: "dragon"
            },
            {
              type: "play-target",
              target: "character",
              filter: {
                $not: { "target.race": { $in: ["wizard", "ringwraith", "balrog"] } }
              }
            },
            {
              type: "duplication-limit",
              scope: "character",
              max: 1
            },
            {
              type: "on-event",
              event: "self-enters-play-combat",
              apply: {
                type: "modify-current-strike-prowess",
                value: -1
              }
            },
            {
              type: "stat-modifier",
              stat: "corruption-points",
              value: 2
            },
            {
              type: "on-event",
              event: "untap-phase-end",
              apply: {
                type: "force-check",
                check: "corruption"
              },
              target: "bearer"
            },
            {
              type: "grant-action",
              action: "remove-self-on-roll",
              cost: {
                tap: "sage-in-company"
              },
              apply: {
                type: "roll-then-apply",
                threshold: 7,
                onSuccess: {
                  type: "move",
                  select: "self",
                  from: "self-location",
                  to: "discard"
                }
              }
            }
          ],
          text: "Corruption. Dark enchantment. Playable on a non-Wizard character facing a strike from a Dragon hazard creature attack. The strike's prowess is modified by -1. The character receives 2 corruption points. The target character makes a corruption check at the end of his untap phase. Cannot be duplicated on a given character. During his organization phase, a sage in the target character's company may tap to attempt to remove this card. Make a roll: if this result is greater than 6, discard this card.",
          certified: "2026-04-22"
        }
      ];
    }
  });

  // ../shared/src/data/td-sites.json
  var td_sites_default;
  var init_td_sites = __esm({
    "../shared/src/data/td-sites.json"() {
      td_sites_default = [
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "td-178",
          name: "Isle of the Ulond",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/IsleoftheUlond.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "coastal",
            "coastal"
          ],
          nearestHaven: "Edhellond",
          region: "Andrast Coast",
          playableResources: [
            "information",
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 14
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Haven: Edhellond. Playable: Information, Items (minor, major). Automatic-attacks: Dragon \u2014 1 strike with 14 prowess.",
          certified: "2026-04-13",
          lairOf: "td-20",
          keywords: [
            "hoard"
          ]
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "td-176",
          name: "Gold Hill",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/GoldHill.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border",
            "shadow",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Withered Heath",
          playableResources: [
            "minor",
            "major",
            "greater",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 15
            }
          ],
          resourceDraws: 3,
          hazardDraws: 3,
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major, greater, gold ring) Automatic-attacks: Dragon \u2014 1 strike with 15 prowess",
          certified: "2026-04-21",
          lairOf: "td-36",
          keywords: [
            "hoard"
          ]
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "td-177",
          name: "Gondmaeglom",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Gondmaeglom.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border",
            "shadow"
          ],
          nearestHaven: "L\xF3rien",
          region: "Grey Mountain Narrows",
          playableResources: [
            "minor",
            "major",
            "gold-ring"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 14
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major, gold ring) Automatic-attacks: Dragon \u2014 1 strike with 14 prowess",
          certified: "2026-04-21",
          lairOf: "td-60",
          keywords: [
            "hoard"
          ]
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "td-179",
          name: "Ovir Hollow",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/OvirHollow.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border",
            "shadow"
          ],
          nearestHaven: "L\xF3rien",
          region: "Grey Mountain Narrows",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 12
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2,
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major) Automatic-attacks: Dragon \u2014 1 strike with 12 prowess",
          lairOf: "td-3",
          keywords: [
            "hoard"
          ],
          certified: "2026-04-21"
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "td-181",
          name: "Zarak D\xFBm",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/ZarakDum.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "shadow"
          ],
          nearestHaven: "Rivendell",
          region: "Angmar",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Dragon",
              strikes: 1,
              prowess: 11
            }
          ],
          resourceDraws: 2,
          hazardDraws: 3,
          text: "Nearest Haven: Rivendell Playable: Items (minor, major) Automatic-attacks: Dragon \u2014 1 strike with 11 prowess",
          certified: "2026-04-21",
          lairOf: "td-63",
          keywords: [
            "hoard"
          ]
        },
        {
          cardType: "hero-site",
          alignment: "wizard",
          id: "td-175",
          name: "Framsburg",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Framsburg.jpg",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border"
          ],
          nearestHaven: "L\xF3rien",
          region: "Anduin Vales",
          playableResources: [
            "minor"
          ],
          automaticAttacks: [],
          resourceDraws: 1,
          hazardDraws: 2,
          text: "Nearest Haven: L\xF3rien Playable: Items (minor) Automatic-attacks: When a company enters this site, opponent may play one creature from his hand that is treated in all ways as the site's automatic-attack (if defeated, creature is discarded). It must normally be playable keyed to a Ruins & Lairs [{R}], Shadow-hold [{S}], single Wilderness [{w}], or Shadow-land [{s}]. Special: Contains a hoard.",
          keywords: [
            "hoard"
          ],
          effects: [
            {
              type: "site-rule",
              rule: "dynamic-auto-attack",
              keying: {
                siteTypes: ["ruins-and-lairs", "shadow-hold"],
                regionTypes: ["wilderness", "shadow"]
              }
            }
          ],
          certified: "2026-04-22"
        },
        {
          cardType: "hero-site",
          id: "td-173",
          name: "Buhr Widu",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/BuhrWidu.jpg",
          text: "Nearest Haven: L\xF3rien Playable: Items (minor, major) Automatic-attacks: Troll \u2014 1 strike with 10 prowess Special: This site is always returned to the location deck, never to the discard pile.",
          alignment: "wizard",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "border",
            "wilderness",
            "wilderness",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Southern Rhovanion",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Trolls",
              strikes: 1,
              prowess: 10
            }
          ],
          resourceDraws: 3,
          hazardDraws: 3
        },
        {
          cardType: "hero-site",
          id: "td-174",
          name: "Dale",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Dale.jpg",
          text: "Nearest Haven: L\xF3rien",
          alignment: "wizard",
          siteType: "border-hold",
          sitePath: [
            "wilderness",
            "border",
            "border",
            "wilderness"
          ],
          nearestHaven: "L\xF3rien",
          region: "Northern Rhovanion",
          playableResources: [],
          automaticAttacks: [],
          resourceDraws: 2,
          hazardDraws: 2
        }
      ];
    }
  });

  // ../shared/src/data/td-creatures.json
  var td_creatures_default;
  var init_td_creatures = __esm({
    "../shared/src/data/td-creatures.json"() {
      td_creatures_default = [
        {
          cardType: "hazard-creature",
          id: "td-57",
          name: "Rain-drake",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Raindrake.jpg",
          unique: false,
          strikes: 1,
          prowess: 15,
          body: null,
          killMarshallingPoints: 1,
          race: "drake",
          keyedTo: [
            {
              regionTypes: [
                "coastal",
                "wilderness",
                "wilderness",
                "wilderness"
              ]
            },
            {
              siteTypes: ["ruins-and-lairs"],
              when: {
                $or: [
                  { "destinationSite.sitePath.wildernessCount": { $gte: 2 } },
                  { "destinationSite.sitePath.coastalCount": { $gte: 1 } }
                ]
              }
            }
          ],
          effects: [],
          text: "Drake. One strike. May also be played at a Ruins & Lairs [{R}] that has two Wildernesses [{w}] or one Coastal Sea [{c}] in its site path.",
          certified: "2026-04-23"
        },
        {
          cardType: "hazard-creature",
          id: "td-59",
          name: "Sand-drake",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Sanddrake.jpg",
          unique: false,
          strikes: 3,
          prowess: 12,
          body: null,
          killMarshallingPoints: 1,
          race: "drake",
          keyedTo: [
            {
              regionNames: ["Khand", "Harondor"]
            },
            {
              regionNames: ["Ithilien", "Nurn", "Horse Plains"],
              when: { inPlay: "Doors of Night" }
            }
          ],
          effects: [
            {
              type: "combat-attacker-chooses-defenders"
            }
          ],
          text: "Drake. Three strikes. Attacker chooses defending characters. May be played keyed to Khand and Harondor. If Doors of Night is in play, may also be played keyed to Ithilien, Nurn, and Horse Plains.",
          certified: "2026-04-23"
        },
        {
          cardType: "hazard-creature",
          id: "td-77",
          name: "True Cold-drake",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/TrueColddrake.jpg",
          unique: false,
          strikes: 2,
          prowess: 14,
          body: null,
          killMarshallingPoints: 1,
          race: "drake",
          keyedTo: [
            {
              regionNames: [
                "N\xFAmeriador",
                "Forochel",
                "Angmar",
                "Gundabad",
                "Grey Mountain Narrows",
                "Withered Heath",
                "Iron Hills"
              ]
            }
          ],
          effects: [],
          text: "Drake. Two strikes. May be played keyed to N\xFAmeriador, Forochel, Angmar, Gundabad, Grey Mountain Narrows, Withered Heath, and Iron Hills.",
          certified: "2026-04-22"
        },
        {
          cardType: "hazard-creature",
          id: "td-3",
          name: "Bairanax",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Bairanax.jpg",
          unique: true,
          strikes: 2,
          prowess: 14,
          body: 7,
          killMarshallingPoints: 3,
          race: "dragon",
          keyedTo: [
            {
              siteNames: ["Ovir Hollow"]
            },
            {
              regionNames: [
                "Withered Heath",
                "Gundabad",
                "Anduin Vales",
                "Grey Mountain Narrows"
              ],
              when: { inPlay: "Doors of Night" }
            }
          ],
          effects: [
            {
              type: "combat-attacker-chooses-defenders"
            }
          ],
          text: "Unique. May be played at Ovir Hollow. Dragon. Two strikes. Attacker chooses defending characters. If Doors of Night is in play, may also be played keyed to Withered Heath, Gundabad, Anduin Vales, and Grey Mountain Narrows; may also be played at sites in these regions.",
          manifestId: "td-3",
          certified: "2026-04-22"
        },
        {
          cardType: "hazard-creature",
          id: "td-20",
          name: "E\xE4rcarax\xEB",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Earcaraxe.jpg",
          unique: true,
          strikes: 2,
          prowess: 17,
          body: 7,
          killMarshallingPoints: 4,
          race: "dragon",
          keyedTo: [
            {
              siteNames: ["Isle of the Ulond"]
            },
            {
              regionNames: [
                "Andrast Coast",
                "Bay of Belfalas",
                "Eriadoran Coast",
                "Andrast"
              ],
              when: { inPlay: "Doors of Night" }
            }
          ],
          effects: [
            {
              type: "combat-attacker-chooses-defenders"
            }
          ],
          text: "Unique. May be played at Isle of the Ulond. Dragon. Two strikes. Attacker chooses defending characters. If Doors of Night is in play, may also be played keyed to Andrast Coast, Bay of Belfalas, Eriadoran Coast, and Andrast; and may also be played at sites in these regions.",
          manifestId: "td-20",
          certified: "2026-04-22"
        },
        {
          cardType: "hazard-creature",
          id: "td-36",
          name: "Itangast",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Itangast.jpg",
          unique: true,
          strikes: 3,
          prowess: 18,
          body: 8,
          killMarshallingPoints: 6,
          race: "dragon",
          keyedTo: [],
          effects: [],
          text: "Unique. May be played at Gold Hill. Dragon. Three strikes. If Doors of Night is in play, may also be played keyed to Withered Heath, Iron Hills, Northern Rhovanion, Grey Mountain Narrows; may also be played at sites in these regions.",
          manifestId: "td-36"
        },
        {
          cardType: "hazard-creature",
          id: "td-60",
          name: "Scatha",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Scatha.jpg",
          unique: true,
          strikes: 3,
          prowess: 15,
          body: 9,
          killMarshallingPoints: 5,
          race: "dragon",
          keyedTo: [
            {
              siteNames: ["Gondmaeglom"]
            },
            {
              regionNames: [
                "Withered Heath",
                "Woodland Realm",
                "Northern Rhovanion",
                "Grey Mountain Narrows"
              ],
              when: { inPlay: "Doors of Night" }
            }
          ],
          effects: [],
          text: "Unique. May be played at Gondmaeglom. Dragon. Three strikes. If Doors of Night is in play, may also be played keyed to Withered Heath, Woodland Realm, Northern Rhovanion, and Grey Mountain Narrows; and may also be played at sites in these regions.",
          manifestId: "td-60",
          certified: "2026-04-22"
        },
        {
          cardType: "hazard-creature",
          id: "td-63",
          name: "Scorba",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/Scorba.jpg",
          unique: true,
          strikes: 3,
          prowess: 12,
          body: 8,
          killMarshallingPoints: 3,
          race: "dragon",
          keyedTo: [],
          effects: [],
          text: "Unique. May be played at Zarak D\xFBm. Dragon. Three strikes. Attacker chooses defending characters. If Doors of Night is in play, may also be played keyed to Forochel, Angmar, Gundabad; may also be played at sites in these regions.",
          manifestId: "td-63"
        },
        {
          cardType: "hazard-creature",
          id: "td-42",
          name: "Lesser Spiders",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/LesserSpiders.jpg",
          text: "Spiders. Four strikes.",
          unique: false,
          strikes: 4,
          prowess: 7,
          body: null,
          killMarshallingPoints: 1,
          race: "spiders",
          keyedTo: []
        },
        {
          cardType: "hazard-creature",
          id: "td-8",
          name: "Cave Worm",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/td/CaveWorm.jpg",
          text: "Drake. One strike. May be played keyed to Redhorn Gate, High Pass, Gap of Isen, Angmar, Gundabad, Grey Mountain Narrows, Withered Heath, N\xFAmeriador, and Iron Hills.",
          unique: false,
          strikes: 1,
          prowess: 16,
          body: null,
          killMarshallingPoints: 1,
          race: "drake",
          keyedTo: []
        }
      ];
    }
  });

  // ../shared/src/data/dm-creatures.json
  var dm_creatures_default;
  var init_dm_creatures = __esm({
    "../shared/src/data/dm-creatures.json"() {
      dm_creatures_default = [
        {
          cardType: "hazard-creature",
          id: "dm-108",
          name: "Little Snuffler",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/LittleSnuffler.jpg",
          unique: false,
          strikes: 1,
          prowess: 5,
          body: null,
          killMarshallingPoints: 1,
          keyedTo: [
            {
              regionTypes: [
                "wilderness",
                "shadow",
                "dark"
              ],
              siteTypes: [
                "ruins-and-lairs",
                "shadow-hold",
                "dark-hold"
              ]
            }
          ],
          effects: [
            {
              type: "combat-attacker-chooses-defenders"
            },
            {
              type: "on-event",
              event: "attack-not-defeated",
              apply: {
                type: "add-constraint",
                constraint: "deny-scout-resources",
                scope: "turn"
              }
            }
          ],
          text: "Orc. One strike. Attacker chooses defending characters. Each ranger in attacked company lowers Little Snuffler's body by 2. If attack is not defeated, any resource that requires a scout in target company cannot be played for the rest of the turn.",
          race: "orc",
          certified: "2026-04-13"
        },
        {
          cardType: "hazard-creature",
          id: "dm-109",
          name: "Nameless Thing",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/NamelessThing.jpg",
          unique: false,
          strikes: 2,
          prowess: 10,
          body: 4,
          killMarshallingPoints: 3,
          race: "drake",
          keyedTo: [],
          effects: [
            { type: "combat-multi-attack", count: 3 },
            { type: "combat-cancel-attack-by-tap", maxCancels: 1 }
          ],
          text: "Drake. 3 attacks of 2 strikes each. A character can tap to cancel one of these attacks. Playable at any Under-deeps site. If Doors of Night is in play, also playable at an adjacent site of any Under-deeps site or keyed to a Coastal Sea [{c}]."
        },
        {
          cardType: "hazard-creature",
          id: "dm-106",
          name: "Chill Douser",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/ChillDouser.jpg",
          text: "Undead. Three strikes. Unless Chill Douser\u2019s attack is canceled, all other Undead attacks against the company for the rest of the turn receive +1 strike and +1 prowess.",
          unique: false,
          strikes: 3,
          prowess: 8,
          body: null,
          killMarshallingPoints: 1,
          race: "undead",
          keyedTo: [
            { siteTypes: ["ruins-and-lairs", "shadow-hold"] }
          ],
          effects: [
            {
              type: "on-event",
              event: "attack-not-canceled",
              apply: {
                type: "add-constraint",
                constraint: "creature-attack-boost",
                scope: "turn",
                race: "undead",
                strikes: 1,
                prowess: 1
              }
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hazard-creature",
          id: "dm-111",
          name: "Stirring Bones",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/StirringBones.jpg",
          text: "Undead. Two strikes.",
          unique: false,
          strikes: 2,
          prowess: 9,
          body: null,
          killMarshallingPoints: 1,
          race: "undead",
          keyedTo: [
            {
              regionTypes: [
                "wilderness",
                "wilderness",
                "shadow",
                "dark"
              ],
              siteTypes: [
                "ruins-and-lairs",
                "shadow-hold"
              ]
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hazard-creature",
          id: "dm-113",
          name: "Wisp of Pale Sheen",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/WispofPaleSheen.jpg",
          text: "Undead. One strike. Attacker chooses defending characters. Any character facing a strike whose mind is equal to or lower than the strike\u2019s prowess must tap if untapped following the strike (unless the strike is canceled).",
          unique: false,
          strikes: 1,
          prowess: 6,
          body: null,
          killMarshallingPoints: 1,
          race: "undead",
          keyedTo: []
        }
      ];
    }
  });

  // ../shared/src/data/dm-hazards.json
  var dm_hazards_default;
  var init_dm_hazards = __esm({
    "../shared/src/data/dm-hazards.json"() {
      dm_hazards_default = [
        {
          cardType: "hazard-event",
          id: "dm-45",
          name: "An Unexpected Outpost",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/AnUnexpectedOutpost.jpg",
          unique: false,
          eventType: "short",
          effects: [
            {
              type: "move",
              select: "target",
              from: ["sideboard", "discard"],
              to: "deck",
              shuffleAfter: true,
              filter: {
                cardType: {
                  $in: [
                    "hazard-event",
                    "hazard-creature"
                  ]
                }
              },
              count: 1
            },
            {
              type: "move",
              select: "target",
              from: ["sideboard", "discard"],
              to: "deck",
              shuffleAfter: true,
              filter: {
                cardType: {
                  $in: [
                    "hazard-event",
                    "hazard-creature"
                  ]
                }
              },
              count: 1,
              when: {
                inPlay: "Doors of Night"
              }
            }
          ],
          text: "Bring one hazard from your sideboard or discard pile into your play deck and shuffle. If Doors of Night is in play, you may do this twice.",
          certified: "2026-04-14"
        },
        {
          cardType: "hazard-event",
          id: "dm-97",
          name: "Two or Three Tribes Present",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/TwoorThreeTribesPresent.jpg",
          unique: false,
          eventType: "short",
          effects: [
            {
              type: "play-condition",
              requires: "site-path",
              condition: {
                $or: [
                  {
                    "sitePath.wildernessCount": {
                      $gte: 2
                    }
                  },
                  {
                    "sitePath.shadowCount": {
                      $gte: 1
                    }
                  },
                  {
                    "sitePath.darkCount": {
                      $gte: 1
                    }
                  }
                ]
              }
            },
            {
              type: "creature-race-choice",
              exclude: [
                "ringwraith",
                "undead",
                "dragon"
              ],
              apply: {
                type: "add-constraint",
                constraint: "creature-type-no-hazard-limit",
                scope: "company-mh-phase"
              }
            }
          ],
          text: "Playable on a company moving with at least two Wildernesses, one Shadow-land, or one Dark-domain in their site path. When played, announce a creature type except Nazgul, Undead, or Dragons (like Orcs, Men, Slayers, Drakes, etc.). For this turn, any hazard creatures of this type played against target company do not count against the hazard limit.",
          certified: "2026-04-14"
        },
        {
          cardType: "hazard-event",
          id: "dm-55",
          name: "Exhalation of Decay",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/ExhalationofDecay.jpg",
          text: "Playable on an Undead hazard creature in your discard pile. If target Undead can attack, bring it into play as a creature that attacks immediately (not counting against the hazard limit). The attack\u2019s prowess is modified by -1.",
          unique: false,
          eventType: "short"
        },
        {
          cardType: "hazard-event",
          id: "dm-71",
          name: "The Moon Is Dead",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/TheMoonIsDead.jpg",
          text: "All Undead attacks receive +1 strike and +1 prowess. All Undead automatic-attacks are duplicated (i. e., each must be faced twice, including all modifications). Discard this card when an Undead attack is defeated. Cannot be duplicated.",
          unique: false,
          eventType: "permanent",
          effects: [
            {
              type: "stat-modifier",
              stat: "prowess",
              value: 1,
              target: "all-attacks",
              when: { "enemy.race": "undead" }
            },
            {
              type: "stat-modifier",
              stat: "strikes",
              value: 1,
              target: "all-attacks",
              when: { "enemy.race": "undead" }
            },
            {
              type: "auto-attack-race-duplicate",
              race: "undead"
            },
            {
              type: "on-event",
              event: "attack-defeated",
              apply: { type: "discard-self" },
              when: { "enemy.race": "undead" }
            },
            {
              type: "duplication-limit",
              scope: "game",
              max: 1
            }
          ],
          certified: "2026-04-25"
        },
        {
          cardType: "hazard-event",
          id: "dm-80",
          name: "Rank upon Rank",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/RankuponRank.jpg",
          text: "All non-agent Man attacks receive +1 prowess and +1 strikes. If Doors of Night is in play, all Giant attacks also receive these bonuses. Discard this card when such an affected attack (automatic, hazard creature, or otherwise) is defeated. Cannot be duplicated.",
          unique: false,
          eventType: "permanent"
        },
        {
          cardType: "hazard-event",
          id: "dm-88",
          name: "Seized by Terror",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/SeizedbyTerror.jpg",
          text: "Playable on a non-Wizard character, non-Ringwraith character moving in a Shadow-land [{s}] or Dark-domain [{d}] . Target character\u2019s player makes a roll and adds character\u2019s mind. If the result is less than 12, that character splits off into a different company. This new company immediately returns to his original company\u2019s site of origin.",
          unique: false,
          eventType: "short",
          effects: [
            {
              type: "play-condition",
              requires: "site-path",
              condition: {
                $or: [
                  { "sitePath.shadowCount": { $gte: 1 } },
                  { "sitePath.darkCount": { $gte: 1 } }
                ]
              }
            },
            {
              type: "play-target",
              target: "character",
              filter: {
                $and: [
                  { "target.race": { $ne: "wizard" } },
                  { "target.race": { $ne: "ringwraith" } }
                ]
              }
            },
            {
              type: "seized-by-terror-check",
              threshold: 12
            }
          ],
          certified: "2026-04-25"
        }
      ];
    }
  });

  // ../shared/src/data/dm-resources.json
  var dm_resources_default;
  var init_dm_resources = __esm({
    "../shared/src/data/dm-resources.json"() {
      dm_resources_default = [
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "dm-159",
          name: "Smoke Rings",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/SmokeRings.jpg",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "move",
              select: "target",
              from: ["sideboard", "discard"],
              to: "deck",
              shuffleAfter: true,
              filter: {
                cardType: {
                  $in: [
                    "hero-character",
                    "hero-resource-item",
                    "hero-resource-ally",
                    "hero-resource-faction",
                    "hero-resource-event"
                  ]
                }
              },
              count: 1
            }
          ],
          text: "Bring one resource or character from your sideboard or discard pile into your play deck and shuffle.",
          certified: "2026-04-06"
        },
        {
          cardType: "hero-resource-event",
          alignment: "wizard",
          id: "dm-155",
          name: "Rebuild the Town",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/RebuildtheTown.jpg",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            {
              type: "play-target",
              target: "site",
              filter: {
                siteType: "ruins-and-lairs"
              }
            },
            {
              type: "on-event",
              event: "self-enters-play",
              apply: {
                type: "add-constraint",
                constraint: "site-type-override",
                overrideType: "border-hold",
                scope: "until-cleared"
              }
            },
            {
              type: "on-event",
              event: "self-enters-play",
              apply: {
                type: "add-constraint",
                constraint: "skip-automatic-attacks",
                scope: "until-cleared"
              }
            }
          ],
          text: "Playable during the site phase on a non-Dragon's lair, non-Under-deeps Ruins & Lairs [R]. The site becomes a Border-hold [B] and all automatic-attacks are removed. Discard Rebuild the Town when the site is discarded or returned to its location deck.",
          certified: "2026-04-15"
        },
        {
          cardType: "hero-resource-event",
          id: "dm-121",
          name: "Crown of Flowers",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/CrownofFlowers.jpg",
          text: "Environment. Crown of Flowers has no effect until you play a resource with it. You can play one resource from your hand with this card. The resource is considered to be played and to be in play as though Gates of Morning were in play and Doors of Night were not. Crown of Flowers does not affect the interpretation of any card except the resource played with it. Discard Crown of Flowers when the resource is discarded. Discard the resource if Crown of Flowers is discarded.",
          alignment: "wizard",
          unique: false,
          eventType: "permanent",
          keywords: ["environment"],
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-event",
          id: "dm-124",
          name: "The Dwarves Are upon You!",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/TheDwarvesAreuponYou.jpg",
          text: "Playable on a company containing Dwarves facing an attack. All Dwarves in the company receive +2 prowess and -1 body against the attack. Cannot be duplicated against a given attack.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-event",
          id: "dm-132",
          name: "Forewarned Is Forearmed",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/ForewarnedIsForearmed.jpg",
          text: "Any non-Dragon Lair site with more than one automatic-attack is reduced to having one automatic-attack of the hazard player\u2019s choice (this attack cannot be canceled). Any creature or other hazard with more than one attack is reduced to one attack of the hazard player\u2019s choice (this attack cannot be canceled). Discard when such an isolated attack is defeated. Cannot be duplicated.",
          alignment: "wizard",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 0,
          marshallingCategory: "misc",
          effects: [
            { type: "duplication-limit", scope: "game", max: 1 }
          ]
        },
        {
          cardType: "hero-resource-event",
          id: "dm-142",
          name: "Hundreds of Butterflies",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/HundredsofButterflies.jpg",
          text: "Playable on a moving character during his movement/hazard phase. Untap the character and increase the hazard limit against his company by one.",
          alignment: "wizard",
          unique: false,
          eventType: "short",
          marshallingPoints: 0,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-event",
          id: "dm-164",
          name: "The Windlord Found Me",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/TheWindlordFoundMe.jpg",
          text: "Playable at an untapped Isengard, Shadow-hold [{S}] , or Dark-hold [{D}] during the site phase. Tap the site. The company faces an Orc attack (4 strikes with 9 prowess). Afterwards, a character may tap and place this card under him. If you do not place this card with a character after the attack, discard it. That character may not untap until after this card is stored in a Haven [{H}] during the organization phase. When this card is stored, and if your Wizard is not already in play, you may search your play deck or discard pile for a Wizard and play him at that Haven [{H}] (does not count towards the one character per turn limit). Cannot be duplicated by a given player. Cannot be included in a Fallen-wizard's deck.",
          alignment: "wizard",
          unique: false,
          eventType: "permanent",
          marshallingPoints: 3,
          marshallingCategory: "misc"
        },
        {
          cardType: "hero-resource-ally",
          id: "dm-179",
          name: "Noble Hound",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/NobleHound.jpg",
          text: "Playable at any tapped or untapped Border-hold [{B}]. In all cases, Noble Hound must be assigned a strike before any strike can be assigned to its controlling character. If Noble Hound is tapped or wounded, treat it as though it were untapped for the purposes of assigning strikes. Discard Noble Hound to cancel any effect that would take its controlling character prisoner (does not protect other characters from being taken prisoner).",
          alignment: "wizard",
          unique: false,
          prowess: 3,
          body: 6,
          mind: 1,
          marshallingPoints: 1,
          marshallingCategory: "ally",
          playableAt: []
        }
      ];
    }
  });

  // ../shared/src/data/dm-sites.json
  var dm_sites_default;
  var init_dm_sites = __esm({
    "../shared/src/data/dm-sites.json"() {
      dm_sites_default = [
        {
          cardType: "hero-site",
          id: "dm-31",
          name: "Haudh-in-Gwan\xFBr",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/dm/HaudhinGwanur.jpg",
          text: "Nearest Haven: Edhellond Playable: Items (minor, major) Automatic-attacks: Undead \u2014 1 strike with 10 prowess; each character wounded must make a corruption check",
          alignment: "wizard",
          siteType: "ruins-and-lairs",
          sitePath: [
            "wilderness",
            "free",
            "coastal",
            "wilderness"
          ],
          nearestHaven: "Edhellond",
          region: "Harondor",
          playableResources: [
            "minor",
            "major"
          ],
          automaticAttacks: [
            {
              creatureType: "Undead",
              strikes: 1,
              prowess: 10
            }
          ],
          resourceDraws: 2,
          hazardDraws: 2
        }
      ];
    }
  });

  // ../shared/src/data/ba-characters.json
  var ba_characters_default;
  var init_ba_characters = __esm({
    "../shared/src/data/ba-characters.json"() {
      ba_characters_default = [
        {
          cardType: "minion-character",
          alignment: "balrog",
          id: "ba-2",
          name: "Azog",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/ba/Azog.jpg",
          unique: true,
          race: "orc",
          skills: ["warrior", "diplomat"],
          prowess: 6,
          body: 9,
          mind: 7,
          directInfluence: 1,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Moria",
          keywords: ["Leader"],
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 3,
              when: { reason: "influence-check", "target.race": "orc" }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 3,
              when: { reason: "faction-influence-check", "faction.race": "orc" }
            }
          ],
          text: "Unique. Balrog specific. Leader. Discard on a body check result of 9. +3 direct influence against Orcs and Orc factions. +2 direct influence against Balrog specific characters."
        },
        {
          cardType: "minion-character",
          alignment: "balrog",
          id: "ba-4",
          name: "Bolg",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/ba/Bolg.jpg",
          unique: true,
          race: "orc",
          skills: ["warrior", "ranger"],
          prowess: 7,
          body: 9,
          mind: 7,
          directInfluence: 0,
          marshallingPoints: 2,
          marshallingCategory: "character",
          corruptionModifier: 0,
          homesite: "Moria",
          keywords: ["Leader"],
          effects: [
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 3,
              when: { reason: "influence-check", "target.race": "orc" }
            },
            {
              type: "stat-modifier",
              stat: "direct-influence",
              value: 3,
              when: { reason: "faction-influence-check", "faction.race": "orc" }
            }
          ],
          text: "Unique. Balrog specific. Leader. Discard on a body check result of 9. +3 direct influence against Orcs and Orc factions. +2 direct influence against Balrog specific characters."
        }
      ];
    }
  });

  // ../shared/src/data/ba-sites.json
  var ba_sites_default;
  var init_ba_sites = __esm({
    "../shared/src/data/ba-sites.json"() {
      ba_sites_default = [
        {
          cardType: "balrog-site",
          alignment: "balrog",
          id: "ba-93",
          name: "Moria",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/ba/Moria.jpg",
          siteType: "haven",
          sitePath: [],
          nearestHaven: "",
          region: "Redhorn Gate",
          playableResources: [],
          automaticAttacks: [],
          underDeeps: false,
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Any gold ring stored at this site is automatically tested (modify the roll by -2). Creatures keyed to this site are detainment. If one of your companies is at this site, all attacks against it are canceled.",
          effects: [
            { type: "site-rule", rule: "auto-test-gold-ring", rollModifier: -2 },
            { type: "site-rule", rule: "cancel-attacks" }
          ]
        },
        {
          cardType: "balrog-site",
          alignment: "balrog",
          id: "ba-100",
          name: "The Under-gates",
          image: "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/ba/TheUndergates.jpg",
          siteType: "haven",
          sitePath: [],
          nearestHaven: "",
          region: "Redhorn Gate",
          playableResources: [],
          automaticAttacks: [],
          underDeeps: true,
          resourceDraws: 1,
          hazardDraws: 1,
          text: "Any gold ring stored at this site is automatically tested (modify the roll by -2). Creatures keyed to this site attack as detainment. If one of your companies is at this site, all attacks against it are canceled.",
          effects: [
            { type: "site-rule", rule: "auto-test-gold-ring", rollModifier: -2 },
            { type: "site-rule", rule: "cancel-attacks" }
          ]
        }
      ];
    }
  });

  // ../shared/src/data/index.ts
  function loadCardPool() {
    const pool = {};
    for (const card of allCards) {
      pool[card.id] = card;
    }
    return pool;
  }
  var allCards;
  var init_data = __esm({
    "../shared/src/data/index.ts"() {
      "use strict";
      init_tw_characters();
      init_tw_items();
      init_tw_creatures();
      init_tw_sites();
      init_tw_regions();
      init_tw_resources();
      init_tw_hazards();
      init_as_characters();
      init_as_creatures();
      init_as_hazards();
      init_as_sites();
      init_as_resources();
      init_as_items();
      init_le_characters();
      init_le_creatures();
      init_le_hazards();
      init_le_resources();
      init_le_sites();
      init_le_items();
      init_wh_characters();
      init_wh_items();
      init_wh_resources();
      init_wh_sites();
      init_td_characters();
      init_td_items();
      init_td_resources();
      init_td_hazards();
      init_td_sites();
      init_td_creatures();
      init_dm_creatures();
      init_dm_hazards();
      init_dm_resources();
      init_dm_sites();
      init_ba_characters();
      init_ba_sites();
      allCards = [
        // The Wizards (base set)
        ...tw_characters_default,
        ...tw_items_default,
        ...tw_resources_default,
        ...tw_creatures_default,
        ...tw_hazards_default,
        ...tw_sites_default,
        ...tw_regions_default,
        // Against the Shadow
        ...as_characters_default,
        ...as_creatures_default,
        ...as_hazards_default,
        ...as_sites_default,
        // The Lidless Eye
        ...le_characters_default,
        ...le_creatures_default,
        ...le_hazards_default,
        ...le_resources_default,
        ...le_sites_default,
        ...le_items_default,
        // The White Hand
        ...wh_characters_default,
        ...wh_items_default,
        ...wh_resources_default,
        ...wh_sites_default,
        // The Dragons
        ...td_characters_default,
        ...td_items_default,
        ...td_resources_default,
        ...td_hazards_default,
        ...td_sites_default,
        ...td_creatures_default,
        // Dark Minions
        ...dm_creatures_default,
        ...dm_hazards_default,
        ...dm_resources_default,
        ...dm_sites_default,
        // The Balrog
        ...ba_characters_default,
        ...ba_sites_default,
        ...as_resources_default,
        ...as_items_default
      ];
    }
  });

  // ../shared/src/format-helpers.ts
  function formatSignedNumber(value) {
    return value >= 0 ? `+${value}` : `${value}`;
  }
  function getCardCss(def) {
    if (def.cardType === "hero-character" && def.race === "wizard") {
      return WIZARD_CSS;
    }
    if (def.cardType === "minion-character" && def.race === "ringwraith") {
      return RINGWRAITH_CSS;
    }
    return CARD_TYPE_CSS[def.cardType];
  }
  var CARD_TYPE_CSS, WIZARD_CSS, RINGWRAITH_CSS;
  var init_format_helpers = __esm({
    "../shared/src/format-helpers.ts"() {
      "use strict";
      CARD_TYPE_CSS = {
        "hero-character": "color:#6090e0;font-weight:bold",
        "hero-resource-item": "color:#d0a040",
        "hero-resource-faction": "color:#50b0b0",
        "hero-resource-ally": "color:#60c060",
        "hero-resource-event": "color:#60c060",
        "hazard-creature": "color:#e06060",
        "hazard-event": "color:#e06060",
        "hazard-corruption": "color:#e06060",
        "hero-site": "color:#d0d0d0",
        "minion-character": "color:#c070c0;font-weight:bold",
        "minion-resource-item": "color:#a080a0",
        "minion-resource-faction": "color:#a080a0",
        "minion-resource-ally": "color:#a080a0",
        "minion-resource-event": "color:#a080a0",
        "minion-site": "color:#d0d0d0",
        "balrog-site": "color:#e08030",
        "fallen-wizard-site": "color:#d0d0d0",
        "region": "color:#6090e0;opacity:0.6"
      };
      WIZARD_CSS = "color:#3060b0;font-weight:bold";
      RINGWRAITH_CSS = "color:#b05030;font-weight:bold";
    }
  });

  // ../shared/src/format-cards.ts
  var init_format_cards = __esm({
    "../shared/src/format-cards.ts"() {
      "use strict";
      init_cards();
      init_common();
      init_format_helpers();
    }
  });

  // ../shared/src/state-utils.ts
  function computeTournamentBreakdown(self, opponent) {
    const adjusted = {};
    for (const src of ALL_SOURCES) {
      adjusted[src] = self[src];
    }
    for (const src of DOUBLING_SOURCES) {
      if (opponent[src] <= 0) {
        adjusted[src] *= 2;
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      const total = ALL_SOURCES.reduce((sum, s) => sum + Math.max(0, adjusted[s]), 0);
      if (total <= 0) break;
      const half = Math.floor(total / 2);
      for (const src of ALL_SOURCES) {
        if (adjusted[src] > half) {
          adjusted[src] = half;
          changed = true;
        }
      }
    }
    return adjusted;
  }
  function computeTournamentScore(self, opponent) {
    const b = computeTournamentBreakdown(self, opponent);
    return b.character + b.item + b.faction + b.ally + b.kill + b.misc;
  }
  var DOUBLING_SOURCES, ALL_SOURCES;
  var init_state_utils = __esm({
    "../shared/src/state-utils.ts"() {
      "use strict";
      init_types();
      init_constants();
      DOUBLING_SOURCES = [
        "character",
        "item",
        "faction",
        "ally"
      ];
      ALL_SOURCES = [
        "character",
        "item",
        "faction",
        "ally",
        "kill",
        "misc"
      ];
    }
  });

  // ../shared/src/format-state.ts
  var init_format_state = __esm({
    "../shared/src/format-state.ts"() {
      "use strict";
      init_state();
      init_state();
      init_state_utils();
      init_constants();
      init_format_helpers();
      init_format_cards();
    }
  });

  // ../shared/src/card-ids.ts
  var did, GANDALF, ARAGORN, LEGOLAS, GIMLI, FRODO, FARAMIR, BILBO, SAM_GAMGEE, FATTY_BOLGER, THEODEN, ELROND, GLORFINDEL_II, HALDIR, CELEBORN, GALADRIEL, EOWYN, BEREGOND, BARD_BOWMAN, ADRAZAR, ANBORN, PEATH, BALIN, KILI, SARUMAN, IORETH, GLAMDRING, STING, THE_MITHRIL_COAT, DAGGER_OF_WESTERNESSE, HORN_OF_ANOR, HAUBERK_OF_BRIGHT_MAIL, PRECIOUS_GOLD_RING, CRAM, SCROLL_OF_ISILDUR, PALANTIR_OF_ORTHANC, SAPLING_OF_THE_WHITE_TREE, GWAIHIR, TREEBEARD, RANGERS_OF_THE_NORTH, RIDERS_OF_ROHAN, KNIGHTS_OF_DOL_AMROTH, RANGERS_OF_ITHILIEN, WOOD_ELVES, MEN_OF_LEBENNIN, MEN_OF_ANORIEN, BLUE_MOUNTAIN_DWARVES, MEN_OF_ANFALAS, DUNLENDINGS, GATES_OF_MORNING, SUN, SMOKE_RINGS, LITTLE_SNUFFLER, CONCEALMENT, DODGE, DARK_QUARRELS, AND_FORTH_HE_HASTENED, MARVELS_TOLD, WIZARDS_LAUGHTER, VANISHMENT, DOORS_OF_NIGHT, EYE_OF_SAURON, TWILIGHT, AN_UNEXPECTED_OUTPOST, TWO_OR_THREE_TRIBES_PRESENT, ASSASSIN, CAVE_DRAKE, ORC_GUARD, ORC_WARBAND, ORC_LIEUTENANT, ORC_WATCH, ORC_PATROL, BARROW_WIGHT, BERT_BURAT, TOM_TUMA, WILLIAM_WULUAG, HOBGOBLINS, FOOLISH_WORDS, LURE_OF_THE_SENSES, ALONE_AND_UNADVISED, LOST_IN_FREE_DOMAINS, STEALTH, RIVER, HALFLING_STRENGTH, RIVENDELL, LORIEN, EDHELLOND, GREY_HAVENS, MORIA, MINAS_TIRITH, MOUNT_DOOM, ETTENMOORS_HERO, THE_WHITE_TOWERS_HERO, BARROW_DOWNS, TOLFALAS, EAGLES_EYRIE, HENNETH_ANNUN, OLD_FOREST, BAG_END, BAG_END_LE, CARN_DUM, BREE, PELARGIR, EDORAS, DOL_AMROTH, THRANDUILS_HALLS, ISENGARD, BLUE_MOUNTAIN_DWARF_HOLD, BANDIT_LAIR, DUNNISH_CLAN_HOLD, WELLINGHALL, LOND_GALEN, UNKNOWN_CARD, UNKNOWN_SITE;
  var init_card_ids = __esm({
    "../shared/src/card-ids.ts"() {
      "use strict";
      did = (s) => s;
      GANDALF = did("tw-156");
      ARAGORN = did("tw-120");
      LEGOLAS = did("tw-168");
      GIMLI = did("tw-159");
      FRODO = did("tw-152");
      FARAMIR = did("tw-149");
      BILBO = did("tw-131");
      SAM_GAMGEE = did("tw-180");
      FATTY_BOLGER = did("tw-495");
      THEODEN = did("tw-182");
      ELROND = did("tw-145");
      GLORFINDEL_II = did("tw-161");
      HALDIR = did("tw-164");
      CELEBORN = did("tw-136");
      GALADRIEL = did("tw-153");
      EOWYN = did("tw-147");
      BEREGOND = did("tw-127");
      BARD_BOWMAN = did("tw-124");
      ADRAZAR = did("tw-116");
      ANBORN = did("tw-118");
      PEATH = did("tw-176");
      BALIN = did("tw-123");
      KILI = did("tw-167");
      SARUMAN = did("tw-181");
      IORETH = did("td-93");
      GLAMDRING = did("tw-244");
      STING = did("tw-333");
      THE_MITHRIL_COAT = did("tw-345");
      DAGGER_OF_WESTERNESSE = did("tw-206");
      HORN_OF_ANOR = did("tw-259");
      HAUBERK_OF_BRIGHT_MAIL = did("tw-254");
      PRECIOUS_GOLD_RING = did("tw-306");
      CRAM = did("td-105");
      SCROLL_OF_ISILDUR = did("tw-323");
      PALANTIR_OF_ORTHANC = did("tw-300");
      SAPLING_OF_THE_WHITE_TREE = did("tw-322");
      GWAIHIR = did("tw-251");
      TREEBEARD = did("tw-353");
      RANGERS_OF_THE_NORTH = did("tw-311");
      RIDERS_OF_ROHAN = did("tw-317");
      KNIGHTS_OF_DOL_AMROTH = did("tw-263");
      RANGERS_OF_ITHILIEN = did("tw-310");
      WOOD_ELVES = did("tw-367");
      MEN_OF_LEBENNIN = did("tw-280");
      MEN_OF_ANORIEN = did("tw-277");
      BLUE_MOUNTAIN_DWARVES = did("tw-200");
      MEN_OF_ANFALAS = did("tw-276");
      DUNLENDINGS = did("tw-211");
      GATES_OF_MORNING = did("tw-243");
      SUN = did("tw-335");
      SMOKE_RINGS = did("dm-159");
      LITTLE_SNUFFLER = did("dm-108");
      CONCEALMENT = did("tw-204");
      DODGE = did("tw-209");
      DARK_QUARRELS = did("tw-207");
      AND_FORTH_HE_HASTENED = did("td-98");
      MARVELS_TOLD = did("td-134");
      WIZARDS_LAUGHTER = did("tw-362");
      VANISHMENT = did("tw-356");
      DOORS_OF_NIGHT = did("tw-28");
      EYE_OF_SAURON = did("tw-32");
      TWILIGHT = did("tw-106");
      AN_UNEXPECTED_OUTPOST = did("dm-45");
      TWO_OR_THREE_TRIBES_PRESENT = did("dm-97");
      ASSASSIN = did("tw-8");
      CAVE_DRAKE = did("tw-020");
      ORC_GUARD = did("tw-072");
      ORC_WARBAND = did("tw-076");
      ORC_LIEUTENANT = did("tw-073");
      ORC_WATCH = did("tw-078");
      ORC_PATROL = did("tw-074");
      BARROW_WIGHT = did("tw-015");
      BERT_BURAT = did("tw-016");
      TOM_TUMA = did("tw-103");
      WILLIAM_WULUAG = did("tw-112");
      HOBGOBLINS = did("le-77");
      FOOLISH_WORDS = did("td-25");
      LURE_OF_THE_SENSES = did("tw-60");
      ALONE_AND_UNADVISED = did("as-24");
      LOST_IN_FREE_DOMAINS = did("tw-53");
      STEALTH = did("tw-332");
      RIVER = did("tw-84");
      HALFLING_STRENGTH = did("tw-253");
      RIVENDELL = did("tw-421");
      LORIEN = did("tw-408");
      EDHELLOND = did("tw-393");
      GREY_HAVENS = did("tw-399");
      MORIA = did("tw-413");
      MINAS_TIRITH = did("tw-412");
      MOUNT_DOOM = did("tw-414");
      ETTENMOORS_HERO = did("tw-395");
      THE_WHITE_TOWERS_HERO = did("tw-430");
      BARROW_DOWNS = did("tw-375");
      TOLFALAS = did("tw-433");
      EAGLES_EYRIE = did("tw-391");
      HENNETH_ANNUN = did("tw-400");
      OLD_FOREST = did("tw-417");
      BAG_END = did("tw-372");
      BAG_END_LE = did("le-350");
      CARN_DUM = did("le-359");
      BREE = did("tw-378");
      PELARGIR = did("tw-419");
      EDORAS = did("tw-394");
      DOL_AMROTH = did("tw-386");
      THRANDUILS_HALLS = did("tw-432");
      ISENGARD = did("tw-404");
      BLUE_MOUNTAIN_DWARF_HOLD = did("tw-377");
      BANDIT_LAIR = did("tw-373");
      DUNNISH_CLAN_HOLD = did("tw-390");
      WELLINGHALL = did("tw-437");
      LOND_GALEN = did("tw-407");
      UNKNOWN_CARD = did("unknown-card");
      UNKNOWN_SITE = did("unknown-site");
    }
  });

  // ../shared/src/format-actions.ts
  var init_format_actions = __esm({
    "../shared/src/format-actions.ts"() {
      "use strict";
      init_cards();
      init_card_ids();
      init_format_cards();
    }
  });

  // ../shared/src/format.ts
  var init_format = __esm({
    "../shared/src/format.ts"() {
      "use strict";
      init_format_helpers();
      init_format_cards();
      init_format_state();
      init_format_actions();
    }
  });

  // ../shared/src/rng.ts
  var init_rng = __esm({
    "../shared/src/rng.ts"() {
      "use strict";
    }
  });

  // ../shared/src/card-images.ts
  function cardImageProxyPath(card) {
    if (!card.image.startsWith(RAW_BASE)) return void 0;
    const relativePath = card.image.substring(RAW_BASE.length);
    return `/cards/images/${relativePath}`;
  }
  var RAW_BASE;
  var init_card_images = __esm({
    "../shared/src/card-images.ts"() {
      "use strict";
      RAW_BASE = "https://raw.githubusercontent.com/council-of-rivendell/meccg-remaster/master/en-remaster/";
    }
  });

  // ../shared/src/effects/condition-matcher.ts
  var init_condition_matcher = __esm({
    "../shared/src/effects/condition-matcher.ts"() {
      "use strict";
    }
  });

  // ../shared/src/effects/play-flags.ts
  var init_play_flags = __esm({
    "../shared/src/effects/play-flags.ts"() {
      "use strict";
    }
  });

  // ../shared/src/effects/index.ts
  var init_effects2 = __esm({
    "../shared/src/effects/index.ts"() {
      "use strict";
      init_condition_matcher();
      init_play_flags();
    }
  });

  // ../shared/src/rules/template.ts
  var init_template = __esm({
    "../shared/src/rules/template.ts"() {
      "use strict";
    }
  });

  // ../shared/src/rules/evaluator.ts
  var init_evaluator = __esm({
    "../shared/src/rules/evaluator.ts"() {
      "use strict";
      init_condition_matcher();
      init_template();
    }
  });

  // ../shared/src/rules/definitions/character-draft.ts
  var init_character_draft = __esm({
    "../shared/src/rules/definitions/character-draft.ts"() {
      "use strict";
    }
  });

  // ../shared/src/rules/definitions/character-deck-draft.ts
  var init_character_deck_draft = __esm({
    "../shared/src/rules/definitions/character-deck-draft.ts"() {
      "use strict";
    }
  });

  // ../shared/src/rules/definitions/starting-site-selection.ts
  var init_starting_site_selection = __esm({
    "../shared/src/rules/definitions/starting-site-selection.ts"() {
      "use strict";
    }
  });

  // ../shared/src/rules/definitions/item-draft.ts
  var init_item_draft = __esm({
    "../shared/src/rules/definitions/item-draft.ts"() {
      "use strict";
    }
  });

  // ../shared/src/rules/definitions/movement.ts
  var init_movement = __esm({
    "../shared/src/rules/definitions/movement.ts"() {
      "use strict";
    }
  });

  // ../shared/src/rules/index.ts
  var init_rules = __esm({
    "../shared/src/rules/index.ts"() {
      "use strict";
      init_evaluator();
      init_template();
      init_character_draft();
      init_character_deck_draft();
      init_starting_site_selection();
      init_item_draft();
      init_movement();
    }
  });

  // ../shared/src/alignment-rules.ts
  var init_alignment_rules = __esm({
    "../shared/src/alignment-rules.ts"() {
      "use strict";
      init_common();
      init_card_ids();
    }
  });

  // ../shared/src/movement-map.ts
  var init_movement_map = __esm({
    "../shared/src/movement-map.ts"() {
      "use strict";
      init_types();
    }
  });

  // ../shared/src/engine/legal-actions/log.ts
  var init_log = __esm({
    "../shared/src/engine/legal-actions/log.ts"() {
      "use strict";
    }
  });

  // ../shared/src/engine/effects/expression-eval.ts
  var init_expression_eval = __esm({
    "../shared/src/engine/effects/expression-eval.ts"() {
      "use strict";
    }
  });

  // ../shared/src/engine/item-slots.ts
  var init_item_slots = __esm({
    "../shared/src/engine/item-slots.ts"() {
      "use strict";
      init_effects3();
    }
  });

  // ../shared/src/engine/effects/resolver.ts
  var init_resolver = __esm({
    "../shared/src/engine/effects/resolver.ts"() {
      "use strict";
      init_src();
      init_state();
      init_expression_eval();
      init_item_slots();
    }
  });

  // ../shared/src/engine/pending.ts
  var init_pending2 = __esm({
    "../shared/src/engine/pending.ts"() {
      "use strict";
    }
  });

  // ../shared/src/engine/reducer-utils.ts
  var init_reducer_utils = __esm({
    "../shared/src/engine/reducer-utils.ts"() {
      "use strict";
      init_src();
      init_log();
      init_effects2();
      init_effects3();
      init_pending2();
    }
  });

  // ../shared/src/engine/effects/ward.ts
  var init_ward = __esm({
    "../shared/src/engine/effects/ward.ts"() {
      "use strict";
      init_effects2();
      init_state();
      init_reducer_utils();
      init_log();
    }
  });

  // ../shared/src/engine/effects/index.ts
  var init_effects3 = __esm({
    "../shared/src/engine/effects/index.ts"() {
      "use strict";
      init_expression_eval();
      init_resolver();
      init_ward();
    }
  });

  // ../shared/src/engine/manifestations.ts
  var init_manifestations = __esm({
    "../shared/src/engine/manifestations.ts"() {
      "use strict";
      init_state();
    }
  });

  // ../shared/src/engine/recompute-derived.ts
  var init_recompute_derived = __esm({
    "../shared/src/engine/recompute-derived.ts"() {
      "use strict";
      init_src();
      init_effects3();
      init_item_slots();
      init_manifestations();
      init_state();
    }
  });

  // ../shared/src/engine/reducer-move.ts
  var init_reducer_move = __esm({
    "../shared/src/engine/reducer-move.ts"() {
      "use strict";
      init_condition_matcher();
      init_rng();
      init_log();
    }
  });

  // ../shared/src/engine/cost-evaluator.ts
  var init_cost_evaluator = __esm({
    "../shared/src/engine/cost-evaluator.ts"() {
      "use strict";
      init_src();
      init_log();
      init_reducer_utils();
      init_pending2();
    }
  });

  // ../shared/src/engine/legal-actions/combat.ts
  var init_combat = __esm({
    "../shared/src/engine/legal-actions/combat.ts"() {
      "use strict";
      init_src();
      init_log();
      init_recompute_derived();
      init_cost_evaluator();
    }
  });

  // ../shared/src/engine/reducer-combat.ts
  var init_reducer_combat = __esm({
    "../shared/src/engine/reducer-combat.ts"() {
      "use strict";
      init_src();
      init_condition_matcher();
      init_log();
      init_combat();
      init_state();
      init_reducer_utils();
      init_cost_evaluator();
      init_effects3();
      init_recompute_derived();
      init_pending2();
      init_chain_reducer();
    }
  });

  // ../shared/src/engine/apply-dispatcher.ts
  var init_apply_dispatcher = __esm({
    "../shared/src/engine/apply-dispatcher.ts"() {
      "use strict";
      init_reducer_move();
      init_reducer_combat();
      init_log();
    }
  });

  // ../shared/src/engine/detainment.ts
  var SHADOW_LAND_RACES, DARK_SITE_TYPES;
  var init_detainment = __esm({
    "../shared/src/engine/detainment.ts"() {
      "use strict";
      init_common();
      init_condition_matcher();
      init_log();
      SHADOW_LAND_RACES = /* @__PURE__ */ new Set([
        "orc" /* Orc */,
        "troll" /* Troll */,
        "undead" /* Undead */,
        "man" /* Man */
      ]);
      DARK_SITE_TYPES = /* @__PURE__ */ new Set([
        "dark-hold" /* DarkHold */,
        "shadow-hold" /* ShadowHold */
      ]);
    }
  });

  // ../shared/src/engine/chain-reducer.ts
  var init_chain_reducer = __esm({
    "../shared/src/engine/chain-reducer.ts"() {
      "use strict";
      init_src();
      init_state();
      init_log();
      init_reducer_move();
      init_effects3();
      init_recompute_derived();
      init_pending2();
      init_src();
      init_reducer_utils();
      init_apply_dispatcher();
      init_detainment();
    }
  });

  // ../shared/src/engine/visibility.ts
  var init_visibility = __esm({
    "../shared/src/engine/visibility.ts"() {
      "use strict";
      init_state();
    }
  });

  // ../shared/src/engine/reverse-actions.ts
  var init_reverse_actions = __esm({
    "../shared/src/engine/reverse-actions.ts"() {
      "use strict";
    }
  });

  // ../shared/src/engine/legal-actions/organization-characters.ts
  var init_organization_characters = __esm({
    "../shared/src/engine/legal-actions/organization-characters.ts"() {
      "use strict";
      init_src();
      init_log();
      init_effects3();
      init_reducer_utils();
      init_organization();
      init_condition_matcher();
    }
  });

  // ../shared/src/engine/legal-actions/organization-events.ts
  var init_organization_events = __esm({
    "../shared/src/engine/legal-actions/organization-events.ts"() {
      "use strict";
      init_src();
      init_log();
    }
  });

  // ../shared/src/engine/legal-actions/organization-companies.ts
  var init_organization_companies = __esm({
    "../shared/src/engine/legal-actions/organization-companies.ts"() {
      "use strict";
      init_src();
      init_log();
      init_effects3();
      init_reverse_actions();
      init_organization();
    }
  });

  // ../shared/src/engine/legal-actions/organization-sideboard.ts
  var init_organization_sideboard = __esm({
    "../shared/src/engine/legal-actions/organization-sideboard.ts"() {
      "use strict";
      init_src();
      init_log();
      init_reducer_utils();
    }
  });

  // ../shared/src/engine/legal-actions/organization.ts
  var init_organization = __esm({
    "../shared/src/engine/legal-actions/organization.ts"() {
      "use strict";
      init_src();
      init_condition_matcher();
      init_log();
      init_effects3();
      init_recompute_derived();
      init_reducer_utils();
      init_reducer_move();
      init_state();
      init_reverse_actions();
      init_organization_characters();
      init_organization_events();
      init_organization_companies();
      init_organization_sideboard();
      init_cost_evaluator();
    }
  });

  // ../shared/src/engine/reducer-untap.ts
  var init_reducer_untap = __esm({
    "../shared/src/engine/reducer-untap.ts"() {
      "use strict";
      init_src();
      init_log();
      init_reducer_utils();
      init_pending2();
    }
  });

  // ../shared/src/engine/reducer-organization.ts
  var init_reducer_organization = __esm({
    "../shared/src/engine/reducer-organization.ts"() {
      "use strict";
      init_src();
      init_log();
      init_organization();
      init_state();
      init_reducer_utils();
      init_reducer_events();
      init_pending2();
      init_recompute_derived();
      init_effects3();
      init_reducer_move();
      init_cost_evaluator();
    }
  });

  // ../shared/src/engine/reducer-end-of-turn.ts
  var init_reducer_end_of_turn = __esm({
    "../shared/src/engine/reducer-end-of-turn.ts"() {
      "use strict";
      init_src();
      init_rng();
      init_effects3();
      init_log();
      init_reducer_utils();
      init_reducer_untap();
      init_pending2();
      init_reducer_organization();
    }
  });

  // ../shared/src/engine/reducer-events.ts
  var init_reducer_events = __esm({
    "../shared/src/engine/reducer-events.ts"() {
      "use strict";
      init_src();
      init_log();
      init_chain_reducer();
      init_state();
      init_visibility();
      init_reducer_utils();
      init_reducer_end_of_turn();
      init_pending2();
      init_reducer_move();
      init_condition_matcher();
      init_reducer_organization();
      init_src();
      init_expression_eval();
      init_cost_evaluator();
    }
  });

  // ../shared/src/engine/effective.ts
  var init_effective = __esm({
    "../shared/src/engine/effective.ts"() {
      "use strict";
      init_condition_matcher();
    }
  });

  // ../shared/src/engine/reducer-site.ts
  var init_reducer_site = __esm({
    "../shared/src/engine/reducer-site.ts"() {
      "use strict";
      init_src();
      init_log();
      init_effects3();
      init_effects2();
      init_chain_reducer();
      init_organization();
      init_alignment_rules();
      init_reducer_utils();
      init_reducer_events();
      init_reducer_organization();
      init_recompute_derived();
      init_pending2();
      init_effective();
      init_manifestations();
      init_detainment();
    }
  });

  // ../shared/src/engine/pending-reducers.ts
  var init_pending_reducers = __esm({
    "../shared/src/engine/pending-reducers.ts"() {
      "use strict";
      init_pending2();
      init_src();
      init_state();
      init_reducer_utils();
      init_cost_evaluator();
      init_log();
      init_reducer_site();
      init_chain_reducer();
    }
  });

  // ../shared/src/engine/init.ts
  var init_init = __esm({
    "../shared/src/engine/init.ts"() {
      "use strict";
      init_src();
      init_recompute_derived();
    }
  });

  // ../shared/src/engine/reducer-setup.ts
  var init_reducer_setup = __esm({
    "../shared/src/engine/reducer-setup.ts"() {
      "use strict";
      init_src();
      init_log();
      init_init();
      init_reducer_utils();
    }
  });

  // ../shared/src/engine/reducer-movement-hazard.ts
  var init_reducer_movement_hazard = __esm({
    "../shared/src/engine/reducer-movement-hazard.ts"() {
      "use strict";
      init_reducer_end_of_turn();
      init_src();
      init_effects3();
      init_resolver();
      init_condition_matcher();
      init_log();
      init_chain_reducer();
      init_state();
      init_reducer_utils();
      init_reducer_events();
      init_reducer_events();
      init_reducer_organization();
      init_pending2();
      init_recompute_derived();
      init_detainment();
    }
  });

  // ../shared/src/engine/reducer-free-council.ts
  var init_reducer_free_council = __esm({
    "../shared/src/engine/reducer-free-council.ts"() {
      "use strict";
      init_src();
      init_log();
      init_state_utils();
      init_state();
      init_reducer_utils();
    }
  });

  // ../shared/src/engine/reducer.ts
  var init_reducer = __esm({
    "../shared/src/engine/reducer.ts"() {
      "use strict";
      init_src();
      init_log();
      init_recompute_derived();
      init_manifestations();
      init_chain_reducer();
      init_visibility();
      init_reducer_utils();
      init_pending2();
      init_pending_reducers();
      init_reducer_setup();
      init_reducer_untap();
      init_reducer_organization();
      init_reducer_events();
      init_reducer_movement_hazard();
      init_reducer_site();
      init_reducer_end_of_turn();
      init_reducer_free_council();
      init_reducer_combat();
    }
  });

  // ../shared/src/engine/legal-actions/draft.ts
  var init_draft = __esm({
    "../shared/src/engine/legal-actions/draft.ts"() {
      "use strict";
      init_src();
      init_play_flags();
      init_log();
    }
  });

  // ../shared/src/engine/legal-actions/item-draft.ts
  var init_item_draft2 = __esm({
    "../shared/src/engine/legal-actions/item-draft.ts"() {
      "use strict";
      init_src();
      init_log();
    }
  });

  // ../shared/src/engine/legal-actions/character-deck-draft.ts
  var init_character_deck_draft2 = __esm({
    "../shared/src/engine/legal-actions/character-deck-draft.ts"() {
      "use strict";
      init_src();
      init_log();
    }
  });

  // ../shared/src/engine/legal-actions/starting-site-selection.ts
  var init_starting_site_selection2 = __esm({
    "../shared/src/engine/legal-actions/starting-site-selection.ts"() {
      "use strict";
      init_src();
      init_log();
    }
  });

  // ../shared/src/engine/legal-actions/character-placement.ts
  var init_character_placement = __esm({
    "../shared/src/engine/legal-actions/character-placement.ts"() {
      "use strict";
      init_src();
      init_log();
    }
  });

  // ../shared/src/engine/legal-actions/deck-shuffle.ts
  var init_deck_shuffle = __esm({
    "../shared/src/engine/legal-actions/deck-shuffle.ts"() {
      "use strict";
      init_src();
      init_log();
    }
  });

  // ../shared/src/engine/legal-actions/initial-draw.ts
  var init_initial_draw = __esm({
    "../shared/src/engine/legal-actions/initial-draw.ts"() {
      "use strict";
      init_src();
      init_log();
    }
  });

  // ../shared/src/engine/legal-actions/initiative-roll.ts
  var init_initiative_roll = __esm({
    "../shared/src/engine/legal-actions/initiative-roll.ts"() {
      "use strict";
      init_src();
      init_log();
    }
  });

  // ../shared/src/engine/legal-actions/setup.ts
  var init_setup = __esm({
    "../shared/src/engine/legal-actions/setup.ts"() {
      "use strict";
      init_draft();
      init_item_draft2();
      init_character_deck_draft2();
      init_starting_site_selection2();
      init_character_placement();
      init_deck_shuffle();
      init_initial_draw();
      init_initiative_roll();
      init_log();
    }
  });

  // ../shared/src/engine/legal-actions/untap.ts
  var init_untap = __esm({
    "../shared/src/engine/legal-actions/untap.ts"() {
      "use strict";
      init_src();
      init_log();
      init_reducer_utils();
    }
  });

  // ../shared/src/engine/legal-actions/long-event.ts
  var init_long_event = __esm({
    "../shared/src/engine/legal-actions/long-event.ts"() {
      "use strict";
      init_src();
      init_state_utils();
      init_log();
      init_organization();
      init_reducer_move();
      init_recompute_derived();
    }
  });

  // ../shared/src/engine/legal-actions/granted-action-constraints.ts
  var init_granted_action_constraints = __esm({
    "../shared/src/engine/legal-actions/granted-action-constraints.ts"() {
      "use strict";
      init_src();
      init_condition_matcher();
      init_log();
      init_cards();
      init_cost_evaluator();
    }
  });

  // ../shared/src/engine/legal-actions/movement-hazard.ts
  var init_movement_hazard = __esm({
    "../shared/src/engine/legal-actions/movement-hazard.ts"() {
      "use strict";
      init_src();
      init_state_utils();
      init_state();
      init_effects3();
      init_recompute_derived();
      init_common();
      init_log();
      init_organization_events();
      init_organization();
      init_long_event();
      init_granted_action_constraints();
      init_reducer_movement_hazard();
    }
  });

  // ../shared/src/engine/legal-actions/site.ts
  var init_site = __esm({
    "../shared/src/engine/legal-actions/site.ts"() {
      "use strict";
      init_src();
      init_state();
      init_effects3();
      init_log();
      init_organization();
      init_long_event();
      init_alignment_rules();
      init_manifestations();
      init_recompute_derived();
    }
  });

  // ../shared/src/engine/legal-actions/end-of-turn.ts
  var init_end_of_turn = __esm({
    "../shared/src/engine/legal-actions/end-of-turn.ts"() {
      "use strict";
      init_src();
      init_condition_matcher();
      init_effects3();
      init_state_utils();
      init_log();
      init_movement_hazard();
      init_long_event();
      init_play_flags();
      init_organization_companies();
    }
  });

  // ../shared/src/engine/legal-actions/free-council.ts
  var init_free_council = __esm({
    "../shared/src/engine/legal-actions/free-council.ts"() {
      "use strict";
      init_src();
      init_log();
      init_organization();
    }
  });

  // ../shared/src/engine/legal-actions/chain.ts
  var init_chain = __esm({
    "../shared/src/engine/legal-actions/chain.ts"() {
      "use strict";
      init_src();
      init_log();
      init_granted_action_constraints();
    }
  });

  // ../shared/src/engine/legal-actions/pending.ts
  var init_pending3 = __esm({
    "../shared/src/engine/legal-actions/pending.ts"() {
      "use strict";
      init_src();
      init_state();
      init_effects3();
      init_organization();
      init_recompute_derived();
      init_log();
      init_cost_evaluator();
    }
  });

  // ../shared/src/engine/legal-actions/index.ts
  var init_legal_actions = __esm({
    "../shared/src/engine/legal-actions/index.ts"() {
      "use strict";
      init_src();
      init_setup();
      init_untap();
      init_organization();
      init_long_event();
      init_movement_hazard();
      init_site();
      init_end_of_turn();
      init_free_council();
      init_chain();
      init_combat();
      init_log();
      init_pending2();
      init_pending3();
    }
  });

  // ../shared/src/engine/action-id.ts
  var init_action_id = __esm({
    "../shared/src/engine/action-id.ts"() {
      "use strict";
    }
  });

  // ../shared/src/ai/evaluators/common.ts
  function lookupDef(pool, defId) {
    if (!defId) return void 0;
    return pool[defId];
  }
  function mpValue(def) {
    if (!def) return 0;
    if ("marshallingPoints" in def && typeof def.marshallingPoints === "number") {
      return def.marshallingPoints;
    }
    return 0;
  }
  function diceSuccessPct(need) {
    if (need <= 2) return 100;
    if (need >= 13) return 0;
    const table = {
      2: 100,
      3: 97,
      4: 92,
      5: 83,
      6: 72,
      7: 58,
      8: 42,
      9: 28,
      10: 17,
      11: 8,
      12: 3
    };
    return table[need] ?? 0;
  }
  function isCharacter(def) {
    return isCharacterCard(def);
  }
  function isItem(def) {
    return isItemCard(def);
  }
  function isFaction(def) {
    return isFactionCard(def);
  }
  function isAlly(def) {
    return isAllyCard(def);
  }
  function isCreature(def) {
    return def !== void 0 && def.cardType === "hazard-creature";
  }
  function isCorruption(def) {
    return def !== void 0 && def.cardType === "hazard-corruption";
  }
  function isHazardEvent(def) {
    return def !== void 0 && def.cardType === "hazard-event";
  }
  function isSite(def) {
    if (!def) return false;
    return def.cardType === "hero-site" || def.cardType === "minion-site" || def.cardType === "fallen-wizard-site" || def.cardType === "balrog-site";
  }
  function resourcePlayableAt(def, site) {
    if (def.cardType === "hero-resource-item" || def.cardType === "minion-resource-item") {
      return def.playableAt.includes(site.siteType);
    }
    if (def.cardType === "hero-resource-faction" || def.cardType === "minion-resource-faction" || def.cardType === "hero-resource-ally" || def.cardType === "minion-resource-ally") {
      for (const entry of def.playableAt) {
        if ("site" in entry && entry.site === site.name) return true;
        if ("siteType" in entry && entry.siteType === site.siteType) return true;
      }
      return false;
    }
    return false;
  }
  function scoreDestinationSite(view, pool, destSite) {
    let playableCount = 0;
    for (const card of view.self.hand) {
      const def = lookupDef(pool, card.definitionId);
      if (def && resourcePlayableAt(def, destSite)) playableCount++;
    }
    const resourceDraws = "resourceDraws" in destSite ? destSite.resourceDraws : 0;
    const siteDanger = SITE_DANGER[destSite.siteType] ?? 2;
    let regionDanger = 0;
    if ("sitePath" in destSite && Array.isArray(destSite.sitePath)) {
      for (const region of destSite.sitePath) {
        regionDanger += REGION_DANGER[region] ?? 1;
      }
    }
    if (playableCount === 0) return 0;
    return Math.max(0, playableCount * 10 + resourceDraws * 2 - siteDanger - regionDanger);
  }
  function isWounded(character) {
    return character.status === "inverted" /* Inverted */;
  }
  function isUntapped(character) {
    return character.status === "untapped" /* Untapped */;
  }
  function woundedCharactersInCompany(view, company) {
    const out = [];
    for (const id of company.characters) {
      const ch = view.self.characters[id];
      if (ch && isWounded(ch)) out.push(id);
    }
    return out;
  }
  function hasUntappedCharacter(view, company) {
    for (const id of company.characters) {
      const ch = view.self.characters[id];
      if (ch && isUntapped(ch)) return true;
    }
    return false;
  }
  function isHealingSite(def) {
    if (!isSite(def)) return false;
    if (def.siteType === "haven") return true;
    const effects = def.effects;
    if (!Array.isArray(effects)) return false;
    for (const e of effects) {
      if (!e || typeof e !== "object") continue;
      const eff = e;
      if (eff.type === "site-rule" && eff.rule === "heal-during-untap") return true;
    }
    return false;
  }
  function effectsIncludeHeal(effects) {
    if (!effects) return false;
    for (const e of effects) {
      if (!e || typeof e !== "object") continue;
      const eff = e;
      if (eff.type === "grant-action" && eff.action === "heal-company-character") return true;
      const apply = eff.apply;
      if (apply && apply.type === "set-character-status" && apply.status === "untapped") return true;
    }
    return false;
  }
  function hasHealingAvailable(view, pool, company) {
    for (const charId of company.characters) {
      const ch = view.self.characters[charId];
      if (!ch) continue;
      for (const item of ch.items) {
        const def = lookupDef(pool, item.definitionId);
        if (!def) continue;
        const effects = def.effects;
        if (effectsIncludeHeal(effects)) return true;
      }
    }
    for (const card of view.self.hand) {
      const def = lookupDef(pool, card.definitionId);
      if (!def) continue;
      const effects = def.effects;
      if (effectsIncludeHeal(effects)) return true;
    }
    return false;
  }
  function hasUntapSource(view, pool, company) {
    return hasHealingAvailable(view, pool, company);
  }
  function handHasNoTapPlayableAt(view, pool, site) {
    for (const card of view.self.hand) {
      const def = lookupDef(pool, card.definitionId);
      if (!def) continue;
      if (def.cardType !== "hero-resource-event" && def.cardType !== "minion-resource-event") continue;
      const ev = def;
      if (ev.eventType !== "permanent") continue;
      void site;
      return true;
    }
    return false;
  }
  function findSiteDef(view, pool, siteInstanceId) {
    const fromDeck = view.self.siteDeck.find((c) => c.instanceId === siteInstanceId);
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
    return void 0;
  }
  var REGION_DANGER, SITE_DANGER;
  var init_common2 = __esm({
    "../shared/src/ai/evaluators/common.ts"() {
      "use strict";
      init_common();
      init_cards();
      REGION_DANGER = {
        "free-domain": 0,
        border: 1,
        wilderness: 2,
        "shadow-land": 4,
        "dark-domain": 5
      };
      SITE_DANGER = {
        haven: 0,
        "free-hold": 0,
        "border-hold": 1,
        "ruins-and-lairs": 3,
        "shadow-hold": 5,
        "dark-hold": 7
      };
    }
  });

  // ../shared/src/ai/evaluators/setup.ts
  function characterDraftScore(def) {
    const base = def.marshallingPoints * 3 + def.prowess + def.body + def.directInfluence * 2;
    return base + (isAvatarCharacter(def) ? 50 : 0);
  }
  function isHaven(def) {
    if (def.cardType !== "hero-site" && def.cardType !== "minion-site" && def.cardType !== "fallen-wizard-site" && def.cardType !== "balrog-site") {
      return false;
    }
    return def.siteType === "haven";
  }
  var setupEvaluator;
  var init_setup2 = __esm({
    "../shared/src/ai/evaluators/setup.ts"() {
      "use strict";
      init_cards();
      init_common2();
      setupEvaluator = {
        phases: ["setup"],
        score(action, context) {
          const pool = context.cardPool;
          switch (action.type) {
            case "draft-pick": {
              const view = context.view;
              const phaseState = view.phaseState;
              if (phaseState.phase !== "setup" || phaseState.setupStep.step !== "character-draft") return 1;
              const draftState = phaseState.setupStep.draftState[view.selfIndex];
              const card = draftState.pool.find((c) => c.instanceId === action.characterInstanceId);
              if (!card) return 1;
              const def = lookupDef(pool, card.definitionId);
              if (!isCharacter(def)) return 1;
              return Math.max(1, characterDraftScore(def));
            }
            case "draft-stop": {
              const view = context.view;
              const phaseState = view.phaseState;
              if (phaseState.phase !== "setup" || phaseState.setupStep.step !== "character-draft") return 1;
              const draftState = phaseState.setupStep.draftState[view.selfIndex];
              const drafted = draftState.drafted;
              const hasAvatar = drafted.some((c) => {
                const def = lookupDef(pool, c.definitionId);
                return isAvatarCharacter(def);
              });
              if (drafted.length >= 6 && hasAvatar) return 5;
              if (drafted.length >= 4 && hasAvatar) return 1;
              return 0;
            }
            case "assign-starting-item": {
              const view = context.view;
              const target = view.self.characters[action.characterInstanceId];
              if (!target) return 1;
              const def = lookupDef(pool, action.itemDefId);
              if (!isItem(def)) return 1;
              return Math.max(1, target.effectiveStats.prowess + def.prowessModifier);
            }
            case "add-character-to-deck": {
              const view = context.view;
              const phaseState = view.phaseState;
              if (phaseState.phase !== "setup" || phaseState.setupStep.step !== "character-deck-draft") return 1;
              const deckDraft = phaseState.setupStep.deckDraftState[view.selfIndex];
              const card = deckDraft.remainingPool.find((c) => c.instanceId === action.characterInstanceId);
              if (!card) return 1;
              const def = lookupDef(pool, card.definitionId);
              if (!isCharacter(def)) return 1;
              return Math.max(1, characterDraftScore(def));
            }
            case "select-starting-site": {
              const view = context.view;
              const card = view.self.siteDeck.find((c) => c.instanceId === action.siteInstanceId);
              if (!card) return 1;
              const def = lookupDef(pool, card.definitionId);
              if (!def) return 1;
              return isHaven(def) ? 100 : 5;
            }
            case "place-character": {
              const view = context.view;
              const char = view.self.characters[action.characterInstanceId];
              if (!char) return 1;
              const def = lookupDef(pool, char.definitionId);
              if (!isCharacter(def)) return 1;
              return Math.max(1, def.prowess + (def.mind ?? 0) + def.marshallingPoints);
            }
            case "shuffle-play-deck":
            case "roll-initiative":
              return 100;
            default:
              return null;
          }
        }
      };
    }
  });

  // ../shared/src/ai/evaluators/organization.ts
  var organizationEvaluator;
  var init_organization2 = __esm({
    "../shared/src/ai/evaluators/organization.ts"() {
      "use strict";
      init_common2();
      organizationEvaluator = {
        phases: ["organization", "untap"],
        score(action, context) {
          const view = context.view;
          const pool = context.cardPool;
          switch (action.type) {
            case "untap":
              return 100;
            case "play-character": {
              const card = view.self.hand.find((c) => c.instanceId === action.characterInstanceId);
              if (!card) return 1;
              const def = lookupDef(pool, card.definitionId);
              if (!isCharacter(def)) return 1;
              const score = def.marshallingPoints * 5 + def.prowess + def.directInfluence * 2;
              const mind = def.mind ?? 0;
              const giUsed = view.self.generalInfluenceUsed;
              const headroom = 20 - giUsed - mind;
              const penalty = headroom < 0 ? 50 : headroom < 3 ? 5 : 0;
              return Math.max(1, score - penalty);
            }
            case "play-permanent-event": {
              return 30;
            }
            case "plan-movement": {
              const destDef = findSiteDef(view, pool, action.destinationSite);
              if (!destDef) return 1;
              const base = scoreDestinationSite(view, pool, destDef);
              const company = view.self.companies.find((c) => c.id === action.companyId);
              if (!company) return base;
              const wounded = woundedCharactersInCompany(view, company);
              if (wounded.length === 0) return base;
              if (hasHealingAvailable(view, pool, company)) return base;
              if (isHealingSite(destDef)) {
                return Math.max(base, 30) + wounded.length * 20;
              }
              return Math.max(1, Math.floor(base / 2));
            }
            case "cancel-movement":
              return 1;
            case "merge-companies": {
              const source = view.self.companies.find((c) => c.id === action.sourceCompanyId);
              const target = view.self.companies.find((c) => c.id === action.targetCompanyId);
              if (!source || !target) return 2;
              if (source.characters.length === 1 && target.characters.length <= 2) return 8;
              return 2;
            }
            case "split-company": {
              const source = view.self.companies.find((c) => c.id === action.sourceCompanyId);
              if (!source) return 0;
              const wounded = woundedCharactersInCompany(view, source);
              if (wounded.length === 0 || wounded.length === source.characters.length) return 0;
              if (hasHealingAvailable(view, pool, source)) return 0;
              const movingChar = view.self.characters[action.characterId];
              if (!movingChar) return 0;
              const movingIsWounded = isWounded(movingChar);
              const staying = source.characters.length - 1;
              if (staying <= 0) return 0;
              return movingIsWounded ? 15 : 10;
            }
            case "move-to-company":
              return 2;
            case "move-to-influence":
              return 2;
            case "transfer-item":
              return 0;
            case "activate-granted-action":
              return 8;
            case "pass":
              return 5;
            default:
              return null;
          }
        }
      };
    }
  });

  // ../shared/src/ai/evaluators/movement-hazard.ts
  function creatureThreat(def, defenderProwess) {
    const baseThreat = def.prowess * def.strikes;
    return Math.max(1, baseThreat - Math.floor(defenderProwess / 2));
  }
  var movementHazardEvaluator;
  var init_movement_hazard2 = __esm({
    "../shared/src/ai/evaluators/movement-hazard.ts"() {
      "use strict";
      init_common2();
      movementHazardEvaluator = {
        phases: ["movement-hazard"],
        score(action, context) {
          const view = context.view;
          const pool = context.cardPool;
          switch (action.type) {
            case "draw-cards":
              return 100;
            case "select-company":
              return 10;
            case "declare-path":
              return action.movementType === "starter" ? 12 : 8;
            case "order-effects":
              return 10;
            case "play-hazard": {
              const card = view.self.hand.find((c) => c.instanceId === action.cardInstanceId);
              if (!card) return 1;
              const def = lookupDef(pool, card.definitionId);
              if (!def) return 1;
              if (isCreature(def)) {
                const targetCompany = view.opponent.companies.find((c) => c.id === action.targetCompanyId);
                let defenderProwess = 0;
                if (targetCompany) {
                  for (const charId of targetCompany.characters) {
                    const char = view.opponent.characters[charId];
                    if (char) defenderProwess += char.effectiveStats.prowess;
                  }
                }
                return Math.max(1, creatureThreat(def, defenderProwess));
              }
              if (isCorruption(def)) {
                return 8;
              }
              if (isHazardEvent(def)) {
                return 5;
              }
              return 3;
            }
            case "place-on-guard": {
              return 4;
            }
            case "pass":
              if (context.legalActions.some((a) => a.type === "draw-cards")) return 0;
              return 1;
            default:
              return null;
          }
        }
      };
    }
  });

  // ../shared/src/ai/evaluators/combat.ts
  var init_combat2 = __esm({
    "../shared/src/ai/evaluators/combat.ts"() {
      "use strict";
      init_common2();
    }
  });

  // ../shared/src/ai/evaluators/site-phase.ts
  var sitePhaseEvaluator;
  var init_site_phase = __esm({
    "../shared/src/ai/evaluators/site-phase.ts"() {
      "use strict";
      init_common2();
      sitePhaseEvaluator = {
        phases: ["site"],
        score(action, context) {
          const view = context.view;
          const pool = context.cardPool;
          switch (action.type) {
            case "enter-site": {
              const company = view.self.companies.find((c) => c.id === action.companyId);
              if (!company?.currentSite) return 50;
              const siteDef = lookupDef(pool, company.currentSite.definitionId);
              if (!isSite(siteDef)) return 50;
              let hasPlayable = false;
              for (const card of view.self.hand) {
                const def = lookupDef(pool, card.definitionId);
                if (def && resourcePlayableAt(def, siteDef)) {
                  hasPlayable = true;
                  break;
                }
              }
              if (!hasPlayable) return 0;
              if (!hasUntappedCharacter(view, company) && !hasUntapSource(view, pool, company) && !handHasNoTapPlayableAt(view, pool, siteDef)) {
                return 0;
              }
              return 50;
            }
            case "play-hero-resource": {
              const card = view.self.hand.find((c) => c.instanceId === action.cardInstanceId);
              if (!card) return 1;
              const def = lookupDef(pool, card.definitionId);
              if (!def) return 1;
              const baseMP = mpValue(def);
              let score = baseMP * 10;
              if (isItem(def)) {
                score += def.prowessModifier * 2 - def.corruptionPoints * 3;
              } else if (isFaction(def)) {
                score += 5;
              } else if (isAlly(def)) {
                score += 5;
              }
              return Math.max(1, score);
            }
            case "play-minor-item": {
              const card = view.self.hand.find((c) => c.instanceId === action.cardInstanceId);
              if (!card) return 1;
              const def = lookupDef(pool, card.definitionId);
              if (!def || !isItem(def)) return 5;
              return Math.max(1, mpValue(def) * 5 + def.prowessModifier);
            }
            case "influence-attempt":
            case "faction-influence-roll": {
              return Math.max(1, diceSuccessPct(action.need) / 5);
            }
            case "opponent-influence-attempt":
              return 6;
            case "opponent-influence-defend":
              return 100;
            case "reveal-on-guard":
              return 20;
            case "declare-agent-attack":
              return 8;
            case "place-on-guard":
              return 4;
            case "pass":
              return 1;
            default:
              return null;
          }
        }
      };
    }
  });

  // ../shared/src/ai/evaluators/end-of-turn.ts
  var endOfTurnEvaluator;
  var init_end_of_turn2 = __esm({
    "../shared/src/ai/evaluators/end-of-turn.ts"() {
      "use strict";
      init_common2();
      init_state_utils();
      endOfTurnEvaluator = {
        phases: ["end-of-turn", "long-event", "free-council", "game-over"],
        score(action, context) {
          const view = context.view;
          const pool = context.cardPool;
          switch (action.type) {
            case "draw-cards":
              return 100;
            case "discard-card": {
              const card = view.self.hand.find((c) => c.instanceId === action.cardInstanceId);
              if (!card) return 1;
              const def = lookupDef(pool, card.definitionId);
              if (!def) return 1;
              if (isCharacter(def) && (def.mind ?? 0) >= 6) return 8;
              if (def.cardType === "hazard-creature" || def.cardType === "hazard-event" || def.cardType === "hazard-corruption") return 6;
              return 3;
            }
            case "call-free-council": {
              const selfScore = computeTournamentScore(view.self.marshallingPoints, view.opponent.marshallingPoints);
              const oppScore = computeTournamentScore(view.opponent.marshallingPoints, view.self.marshallingPoints);
              const lead = selfScore - oppScore;
              let probability;
              if (lead <= 0) probability = 0;
              else if (lead <= 4) probability = 0.05;
              else if (lead >= 20) probability = 1;
              else probability = 0.05 + (lead - 4) * (0.95 / 16);
              return Math.random() < probability ? 1e6 : 0;
            }
            case "deck-exhaust":
              return 100;
            case "finished":
              return 100;
            case "pass":
              if (context.legalActions.some((a) => a.type === "draw-cards")) return 0;
              return 1;
            default:
              return null;
          }
        }
      };
    }
  });

  // ../shared/src/ai/heuristic.ts
  function buildPhaseTable() {
    const table = {};
    const evaluators = [
      setupEvaluator,
      organizationEvaluator,
      movementHazardEvaluator,
      sitePhaseEvaluator,
      endOfTurnEvaluator
    ];
    for (const ev of evaluators) {
      for (const phase of ev.phases) table[phase] = ev;
    }
    return table;
  }
  var PHASE_TABLE;
  var init_heuristic = __esm({
    "../shared/src/ai/heuristic.ts"() {
      "use strict";
      init_setup2();
      init_organization2();
      init_movement_hazard2();
      init_combat2();
      init_site_phase();
      init_end_of_turn2();
      PHASE_TABLE = buildPhaseTable();
    }
  });

  // ../shared/src/ai/strategy.ts
  var init_strategy = __esm({
    "../shared/src/ai/strategy.ts"() {
      "use strict";
    }
  });

  // ../shared/src/ai/index.ts
  var init_ai = __esm({
    "../shared/src/ai/index.ts"() {
      "use strict";
      init_heuristic();
      init_strategy();
    }
  });

  // ../shared/src/index.ts
  var init_src = __esm({
    "../shared/src/index.ts"() {
      "use strict";
      init_types();
      init_constants();
      init_data();
      init_format();
      init_rng();
      init_card_ids();
      init_card_images();
      init_effects2();
      init_rules();
      init_rules();
      init_alignment_rules();
      init_state_utils();
      init_movement_map();
      init_reducer();
      init_legal_actions();
      init_action_id();
      init_log();
      init_init();
      init_ai();
    }
  });

  // src/browser/app-state.ts
  function createDefaultAppState() {
    return {
      /** Active game WebSocket connection. */
      ws: null,
      /** Assigned player ID from the game server. */
      playerId: null,
      /** Lobby WebSocket connection (only in lobby mode). */
      lobbyWs: null,
      /** Current game server port (lobby mode -- direct connection). */
      gamePort: null,
      /** Current game token (lobby mode). */
      gameToken: null,
      /** Current logged-in player name (lobby mode). */
      lobbyPlayerName: null,
      /** Whether the current player has reviewer privileges. */
      lobbyPlayerIsReviewer: false,
      /** Current player's credit balance. */
      lobbyPlayerCredits: 0,
      /** Name of the player who sent us a challenge (lobby mode). */
      challengeFrom: null,
      /** Instance ID to definition ID lookup for the current game state. */
      lastInstanceLookup: (() => void 0),
      /** Company name lookup for the current game state. */
      lastCompanyNames: {},
      /** Phase from the last state update, for detecting phase transitions. */
      lastPhase: null,
      /** Current game ID (set on 'assigned' message). */
      currentGameId: null,
      /** Latest state sequence number (updated on each 'state' message). */
      currentStateSeq: 0,
      /** Opponent player name (lobby mode, set on 'game-starting'). */
      opponentName: null,
      /** Whether the current game is a pseudo-AI game (human controls both sides). */
      isPseudoAi: false,
      /** Second WebSocket for pseudo-AI: connects as the AI player. */
      pseudoAiWs: null,
      /** AI player's game token (pseudo-AI mode). */
      pseudoAiToken: null,
      /** The AI's selected deck, captured when the user clicks Play vs Pseudo-AI. */
      pendingAiDeck: null,
      /** Timer handle for auto-pass feature. */
      autoPassTimer: null,
      /** Stack of log entry counts, pushed before each action for undo support. */
      logCountStack: [],
      /** Whether to auto-reconnect on WebSocket close. */
      autoReconnect: true,
      /** Number of consecutive failed reconnect attempts. */
      reconnectAttempts: 0,
      // ---- Deck browser state ----
      /** IDs of decks the player already owns. */
      ownedDeckIds: /* @__PURE__ */ new Set(),
      /** Cached deck catalog for looking up AI decks. */
      cachedCatalog: [],
      /** Whether the my-deck-select change handler has been installed. */
      myDeckSelectInstalled: false,
      /** Currently selected deck ID. */
      currentDeckId: null,
      /** The current player's selected deck, loaded from the lobby API. */
      currentFullDeck: null,
      // ---- Deck editor state ----
      /** Set of "deckId:cardName" keys for already-requested cards. */
      requestedCards: /* @__PURE__ */ new Set(),
      /** Set of card definition IDs for already-requested certifications. */
      requestedCertifications: /* @__PURE__ */ new Set(),
      // ---- Inbox state ----
      /** Which mail tab is active. */
      activeMailTab: "inbox"
    };
  }
  function missingCards(deck) {
    const allEntries = [
      ...deck.pool,
      ...deck.deck.characters,
      ...deck.deck.hazards,
      ...deck.deck.resources,
      ...deck.sites,
      ...deck.sideboard ?? []
    ];
    return allEntries.filter((e) => e.card === null).map((e) => e.name);
  }
  function uncertifiedCards(deck) {
    const allEntries = [
      ...deck.pool,
      ...deck.deck.characters,
      ...deck.deck.hazards,
      ...deck.deck.resources,
      ...deck.sites,
      ...deck.sideboard ?? []
    ];
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const e of allEntries) {
      if (e.card === null || seen.has(e.card)) continue;
      seen.add(e.card);
      const def = cardPool[e.card];
      if (def && !("certified" in def && def.certified)) {
        result.push(e.name);
      }
    }
    return result;
  }
  function sortDeckEntries(entries) {
    return [...entries].sort((a, b) => {
      if (a.favourite !== b.favourite) return a.favourite ? -1 : 1;
      const defA = a.card ? cardPool[a.card] : void 0;
      const defB = b.card ? cardPool[b.card] : void 0;
      if (!defA !== !defB) return defA ? -1 : 1;
      const typeA = defA?.cardType ?? "";
      const typeB = defB?.cardType ?? "";
      if (typeA !== typeB) return typeA.localeCompare(typeB);
      const nameA = defA?.name ?? a.name;
      const nameB = defB?.name ?? b.name;
      return nameA.localeCompare(nameB);
    });
  }
  var _shared, appState, cardPool, SERVER_DEV, LOBBY_MODE, DEV_MODE_KEY, EDITING_DECK_KEY, ALIGNMENT_MAP;
  var init_app_state = __esm({
    "src/browser/app-state.ts"() {
      "use strict";
      init_src();
      _shared = window.__meccg ?? {
        appState: createDefaultAppState(),
        cardPool: loadCardPool(),
        showScreen: void 0,
        connectLobbyWs: void 0,
        connect: void 0,
        disconnect: void 0,
        resetVisualBoard: void 0,
        resetCompanyViews: void 0,
        connectPseudoAi: void 0,
        clearDice: void 0,
        restoreDice: void 0,
        clearGameBoard: void 0,
        loadDecks: void 0,
        openDeckEditor: void 0
      };
      if (!window.__meccg) window.__meccg = _shared;
      appState = _shared.appState;
      cardPool = _shared.cardPool;
      SERVER_DEV = window.__MECCG_DEV === true;
      LOBBY_MODE = window.__LOBBY === true;
      DEV_MODE_KEY = "meccg-dev-mode";
      EDITING_DECK_KEY = "meccg-editing-deck";
      ALIGNMENT_MAP = {
        hero: "wizard" /* Wizard */,
        minion: "ringwraith" /* Ringwraith */,
        "fallen-wizard": "fallen-wizard" /* FallenWizard */,
        balrog: "balrog" /* Balrog */
      };
    }
  });

  // src/browser/render-selection-state.ts
  var init_render_selection_state = __esm({
    "src/browser/render-selection-state.ts"() {
      "use strict";
    }
  });

  // src/browser/render-utils.ts
  var init_render_utils = __esm({
    "src/browser/render-utils.ts"() {
      "use strict";
      init_src();
    }
  });

  // src/browser/dice.ts
  var init_dice = __esm({
    "src/browser/dice.ts"() {
      "use strict";
    }
  });

  // src/browser/render-text-format.ts
  function isDevModeOn() {
    return SERVER_DEV && localStorage.getItem(DEV_MODE_KEY) === "true";
  }
  function getHoverImg() {
    if (hoverImg) return hoverImg;
    hoverImg = document.createElement("img");
    hoverImg.id = "card-hover-img";
    document.body.appendChild(hoverImg);
    return hoverImg;
  }
  function getHoverJson() {
    if (hoverJson) return hoverJson;
    hoverJson = document.createElement("pre");
    hoverJson.id = "card-hover-json";
    document.body.appendChild(hoverJson);
    return hoverJson;
  }
  var hoverImg, hoverJson, debugCardPool, REGION_ICON_CODES, SITE_ICON_CODES;
  var init_render_text_format = __esm({
    "src/browser/render-text-format.ts"() {
      "use strict";
      init_src();
      init_app_state();
      init_dice();
      hoverImg = null;
      hoverJson = null;
      debugCardPool = null;
      document.addEventListener("mouseover", (e) => {
        const target = e.target.closest?.("[data-card-image]");
        if (!target) return;
        if (target.closest("#game-log-panel")) return;
        const img = getHoverImg();
        img.src = target.dataset.cardImage;
        img.style.display = "block";
        if (!isDevModeOn()) return;
        if (target.closest("#drafted-self, #drafted-opponent, #set-aside")) return;
        const cardId = target.dataset.cardId;
        const def = cardId && debugCardPool ? debugCardPool[cardId] : void 0;
        if (def) {
          const json = getHoverJson();
          json.textContent = JSON.stringify(def, null, 2);
          json.style.display = "block";
        }
      });
      document.addEventListener("mouseout", (e) => {
        const target = e.target.closest?.("[data-card-image]");
        if (!target) return;
        const img = getHoverImg();
        img.style.display = "none";
        const json = getHoverJson();
        json.style.display = "none";
      });
      document.addEventListener("mousemove", (e) => {
        if (!hoverImg || hoverImg.style.display === "none") return;
        const imgW = hoverImg.offsetWidth || 350;
        const imgH = hoverImg.offsetHeight || 500;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let x = e.clientX + 16;
        let y = e.clientY + 16;
        if (x + imgW > vw) x = e.clientX - imgW - 16;
        if (y + imgH > vh) y = vh - imgH;
        hoverImg.style.left = `${x}px`;
        hoverImg.style.top = `${y}px`;
        if (hoverJson && hoverJson.style.display !== "none") {
          const jsonW = hoverJson.offsetWidth || 300;
          const jsonH = hoverJson.offsetHeight || 400;
          let jx = x + imgW + 8;
          if (jx + jsonW > vw) jx = x - jsonW - 8;
          let jy = y;
          if (jy + jsonH > vh) jy = vh - jsonH;
          if (jy < 0) jy = 0;
          hoverJson.style.left = `${jx}px`;
          hoverJson.style.top = `${jy}px`;
        }
      });
      REGION_ICON_CODES = {
        wilderness: "w",
        shadow: "s",
        dark: "d",
        coastal: "c",
        free: "f",
        border: "b"
      };
      SITE_ICON_CODES = {
        "haven": "haven",
        "free-hold": "free-hold",
        "border-hold": "border-hold",
        "ruins-and-lairs": "ruins-and-lairs",
        "shadow-hold": "shadow-hold",
        "dark-hold": "dark-hold"
      };
    }
  });

  // src/browser/render-debug-panels.ts
  var init_render_debug_panels = __esm({
    "src/browser/render-debug-panels.ts"() {
      "use strict";
      init_src();
      init_render_utils();
      init_render_text_format();
    }
  });

  // src/browser/render-game-over.ts
  var init_render_game_over = __esm({
    "src/browser/render-game-over.ts"() {
      "use strict";
      init_src();
      init_render_utils();
    }
  });

  // src/browser/render-actions.ts
  var init_render_actions = __esm({
    "src/browser/render-actions.ts"() {
      "use strict";
      init_src();
      init_render_utils();
      init_render_text_format();
    }
  });

  // src/browser/render-player-names.ts
  var init_render_player_names = __esm({
    "src/browser/render-player-names.ts"() {
      "use strict";
      init_src();
      init_dice();
      init_render_debug_panels();
    }
  });

  // src/browser/render-card-preview.ts
  function formatLabel(value) {
    const special = {
      dunadan: "D\xFAnadan",
      "awakened-plant": "Awakened Plant",
      "pukel-creature": "P\xFBkel-creature",
      "shadow-hold": "Shadow-hold",
      "free-hold": "Free-hold",
      "border-hold": "Border-hold",
      "ruins-and-lairs": "Ruins & Lairs",
      "shadow-land": "Shadow-land",
      "dark-domain": "Dark-domain",
      "free-domain": "Free-domain",
      "border-land": "Border-land",
      "coastal-sea": "Coastal Sea",
      "double-wilderness": "Double Wilderness",
      "double-shadow-land": "Double Shadow-land",
      "double-coastal-sea": "Double Coastal Sea",
      "gold-ring": "Gold Ring"
    };
    return special[value] ?? value.charAt(0).toUpperCase() + value.slice(1);
  }
  function formatCardType(cardType) {
    return cardType.replace(/^(hero|minion|fallen-wizard|balrog)-/, "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  function addAttr(parent, label, value) {
    const row = document.createElement("div");
    row.className = "card-preview-attr";
    row.innerHTML = `<span class="attr-label">${label}</span><span class="attr-value">${value}</span>`;
    parent.appendChild(row);
  }
  function regionIconsHtml(regions) {
    return regions.map((r) => {
      const code = REGION_ICON_CODES[r];
      if (code) {
        return `<img src="/images/regions/${code}.png" alt="${formatLabel(r)}" title="${formatLabel(r)}" style="width:16px;height:16px;display:inline-block">`;
      }
      return formatLabel(r);
    }).join("");
  }
  function siteIconsHtml(siteTypes) {
    return siteTypes.map((s) => {
      const code = SITE_ICON_CODES[s];
      if (code) {
        return `<img src="/images/sites/${code}.png" alt="${formatLabel(s)}" title="${formatLabel(s)}" style="width:16px;height:16px;display:inline-block">`;
      }
      return formatLabel(s);
    }).join("");
  }
  function buildCardAttributes(el, def) {
    addAttr(el, "Type", formatCardType(def.cardType));
    const keywords = def.keywords;
    if (keywords && keywords.length > 0) {
      addAttr(el, "Keywords", keywords.map(formatLabel).join(", "));
    }
    switch (def.cardType) {
      case "hero-character":
      case "minion-character": {
        addAttr(el, "Race", formatLabel(def.race));
        if (def.skills.length > 0) addAttr(el, "Skills", def.skills.map(formatLabel).join(", "));
        addAttr(el, "Prowess / Body", `${def.prowess} / ${def.body}`);
        if (def.mind !== null) addAttr(el, "Mind", def.mind);
        addAttr(el, "Direct Influence", def.directInfluence);
        addAttr(el, "MP", def.marshallingPoints);
        if (def.corruptionModifier !== 0) addAttr(el, "Corruption Mod", def.corruptionModifier);
        addAttr(el, "Home Site", def.homesite);
        break;
      }
      case "hero-resource-item":
      case "minion-resource-item": {
        addAttr(el, "Subtype", formatLabel(def.subtype));
        if (def.prowessModifier !== 0) addAttr(el, "Prowess", formatSignedNumber(def.prowessModifier));
        if (def.bodyModifier !== 0) addAttr(el, "Body", formatSignedNumber(def.bodyModifier));
        addAttr(el, "MP", def.marshallingPoints);
        if (def.corruptionPoints !== 0) addAttr(el, "Corruption", def.corruptionPoints);
        break;
      }
      case "hero-resource-faction":
      case "minion-resource-faction": {
        addAttr(el, "Race", formatLabel(def.race));
        addAttr(el, "Influence #", def.influenceNumber);
        addAttr(el, "MP", def.marshallingPoints);
        addAttr(el, "Playable At", def.playableAt.map((e) => "site" in e ? e.site : formatLabel(e.siteType)).join(", "));
        break;
      }
      case "hero-resource-ally":
      case "minion-resource-ally": {
        addAttr(el, "Prowess / Body", `${def.prowess} / ${def.body}`);
        addAttr(el, "Mind", def.mind);
        addAttr(el, "MP", def.marshallingPoints);
        break;
      }
      case "hazard-creature": {
        if (def.race) addAttr(el, "Race", formatLabel(def.race));
        addAttr(el, "Strikes", def.strikes);
        addAttr(el, "Prowess", def.prowess);
        if (def.body !== null) addAttr(el, "Body", def.body);
        if (def.killMarshallingPoints !== 0) addAttr(el, "Kill MP", def.killMarshallingPoints);
        if (def.keyedTo.length > 0) {
          const entries = [];
          for (const key of def.keyedTo) {
            const parts = [];
            if (key.regionTypes && key.regionTypes.length > 0) parts.push(regionIconsHtml(key.regionTypes));
            if (key.regionNames && key.regionNames.length > 0) parts.push(key.regionNames.join(", "));
            if (key.siteTypes && key.siteTypes.length > 0) parts.push(siteIconsHtml(key.siteTypes));
            if (key.siteNames && key.siteNames.length > 0) parts.push(key.siteNames.join(", "));
            const entry = parts.join(" ");
            if (entry.length > 0) entries.push(entry);
          }
          if (entries.length > 0) addAttr(el, "Keyed To", entries.join("; "));
        }
        break;
      }
      case "hazard-event": {
        addAttr(el, "Duration", formatLabel(def.eventType));
        break;
      }
      case "hero-resource-event": {
        addAttr(el, "Duration", formatLabel(def.eventType));
        if (def.marshallingPoints !== 0) addAttr(el, "MP", def.marshallingPoints);
        break;
      }
      case "hazard-corruption": {
        addAttr(el, "Corruption", def.corruptionPoints);
        break;
      }
      case "hero-site":
      case "minion-site":
      case "fallen-wizard-site":
      case "balrog-site": {
        addAttr(el, "Site Type", siteIconsHtml([def.siteType]));
        if (def.nearestHaven) addAttr(el, "Nearest Haven", def.nearestHaven);
        if (def.sitePath.length > 0) addAttr(el, "Path", regionIconsHtml(def.sitePath));
        if (def.havenPaths) {
          for (const [haven, path] of Object.entries(def.havenPaths)) {
            addAttr(el, haven, regionIconsHtml(path));
          }
        }
        if (def.playableResources.length > 0) addAttr(el, "Resources", def.playableResources.map(formatLabel).join(", "));
        if (def.automaticAttacks.length > 0) {
          for (const aa of def.automaticAttacks) {
            addAttr(el, "Auto-attack", `${aa.creatureType} (${aa.strikes}/${aa.prowess})`);
          }
        }
        break;
      }
      case "region": {
        addAttr(el, "Region Type", def.regionType);
        if (def.adjacentRegions.length > 0) addAttr(el, "Adjacent", def.adjacentRegions.join(", "));
        break;
      }
    }
  }
  var init_render_card_preview = __esm({
    "src/browser/render-card-preview.ts"() {
      "use strict";
      init_src();
      init_render_text_format();
    }
  });

  // src/browser/render-piles.ts
  var init_render_piles = __esm({
    "src/browser/render-piles.ts"() {
      "use strict";
      init_src();
      init_render_card_preview();
    }
  });

  // src/browser/render-instructions.ts
  var init_render_instructions = __esm({
    "src/browser/render-instructions.ts"() {
      "use strict";
      init_src();
      init_render_text_format();
      init_render_selection_state();
    }
  });

  // src/browser/render-board.ts
  var init_render_board = __esm({
    "src/browser/render-board.ts"() {
      "use strict";
      init_src();
      init_render_utils();
      init_render_text_format();
      init_render_selection_state();
      init_render_debug_panels();
    }
  });

  // src/browser/render-hand.ts
  var init_render_hand = __esm({
    "src/browser/render-hand.ts"() {
      "use strict";
      init_src();
      init_render_text_format();
      init_render_selection_state();
      init_render_debug_panels();
    }
  });

  // src/browser/render-chain.ts
  var init_render_chain = __esm({
    "src/browser/render-chain.ts"() {
      "use strict";
      init_src();
      init_render_text_format();
    }
  });

  // src/browser/render-log.ts
  var init_render_log = __esm({
    "src/browser/render-log.ts"() {
      "use strict";
      init_render_utils();
      init_render_text_format();
    }
  });

  // src/browser/render.ts
  var init_render = __esm({
    "src/browser/render.ts"() {
      "use strict";
      init_render_selection_state();
      init_render_debug_panels();
      init_render_game_over();
      init_render_actions();
      init_render_player_names();
      init_render_piles();
      init_render_instructions();
      init_render_card_preview();
      init_render_board();
      init_render_hand();
      init_render_chain();
      init_render_log();
    }
  });

  // src/browser/deck-browser.ts
  init_src();
  init_app_state();

  // src/browser/dialog.ts
  function showAlert(message) {
    return new Promise((resolve2) => {
      const modal = document.createElement("div");
      modal.className = "app-dialog";
      const backdrop = document.createElement("div");
      backdrop.className = "app-dialog-backdrop";
      modal.appendChild(backdrop);
      const dialog = document.createElement("div");
      dialog.className = "app-dialog-box";
      const msg = document.createElement("p");
      msg.className = "app-dialog-message";
      msg.textContent = message;
      dialog.appendChild(msg);
      const actions = document.createElement("div");
      actions.className = "app-dialog-actions";
      const okBtn = document.createElement("button");
      okBtn.textContent = "OK";
      actions.appendChild(okBtn);
      dialog.appendChild(actions);
      modal.appendChild(dialog);
      document.body.appendChild(modal);
      const close = () => {
        document.removeEventListener("keydown", onKey, true);
        modal.remove();
        resolve2();
      };
      const onKey = (e) => {
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      };
      okBtn.addEventListener("click", close);
      backdrop.addEventListener("click", close);
      document.addEventListener("keydown", onKey, true);
      okBtn.focus();
    });
  }
  function showConfirm(message, options = {}) {
    return new Promise((resolve2) => {
      const modal = document.createElement("div");
      modal.className = "app-dialog";
      const backdrop = document.createElement("div");
      backdrop.className = "app-dialog-backdrop";
      modal.appendChild(backdrop);
      const dialog = document.createElement("div");
      dialog.className = "app-dialog-box";
      const msg = document.createElement("p");
      msg.className = "app-dialog-message";
      msg.textContent = message;
      dialog.appendChild(msg);
      const actions = document.createElement("div");
      actions.className = "app-dialog-actions";
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "app-dialog-btn-cancel";
      cancelBtn.textContent = options.cancelLabel ?? "Cancel";
      const okBtn = document.createElement("button");
      okBtn.textContent = options.okLabel ?? "OK";
      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      dialog.appendChild(actions);
      modal.appendChild(dialog);
      document.body.appendChild(modal);
      const finish = (result) => {
        document.removeEventListener("keydown", onKey, true);
        modal.remove();
        resolve2(result);
      };
      const onKey = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      };
      okBtn.addEventListener("click", () => finish(true));
      cancelBtn.addEventListener("click", () => finish(false));
      backdrop.addEventListener("click", () => finish(false));
      document.addEventListener("keydown", onKey, true);
      okBtn.focus();
    });
  }

  // src/browser/deck-browser.ts
  var openDeckEditorFn = null;
  function setDeckBrowserCallbacks(openDeckEditor2) {
    openDeckEditorFn = openDeckEditor2;
  }
  function updatePlayControls() {
    const hasDeck = appState.currentDeckId !== null;
    const notice = document.getElementById("no-deck-notice");
    if (notice) notice.classList.toggle("hidden", hasDeck);
    const playSmartAiBtn = document.getElementById("play-smart-ai-btn");
    if (playSmartAiBtn) playSmartAiBtn.disabled = !hasDeck;
    const aiDeckSelect = document.getElementById("ai-deck-select");
    if (aiDeckSelect) aiDeckSelect.disabled = !hasDeck;
    for (const btn of document.querySelectorAll(".lobby-player-item button")) {
      btn.disabled = !hasDeck;
    }
    const acceptBtn = document.getElementById("accept-challenge-btn");
    if (acceptBtn) acceptBtn.disabled = !hasDeck;
  }
  function renderMyDeckItem(deck, isCurrent) {
    const missing = missingCards(deck);
    const item = document.createElement("div");
    item.className = "lobby-deck-item lobby-deck-item--owned" + (isCurrent ? " lobby-deck-item--current" : "");
    const info = document.createElement("div");
    info.className = "lobby-deck-info";
    const nameEl = document.createElement("span");
    nameEl.className = "lobby-deck-name";
    nameEl.textContent = deck.name;
    const meta = document.createElement("span");
    meta.className = "lobby-deck-meta";
    meta.textContent = deck.alignment + (isCurrent ? " \u2014 selected" : "");
    info.appendChild(nameEl);
    info.appendChild(meta);
    if (missing.length > 0) {
      const warn = document.createElement("span");
      warn.className = "lobby-deck-warning";
      warn.textContent = `\u26A0 ${missing.length} missing card${missing.length > 1 ? "s" : ""}`;
      warn.title = missing.join(", ");
      info.appendChild(warn);
    }
    const uncertified = uncertifiedCards(deck);
    if (uncertified.length > 0) {
      const warn = document.createElement("span");
      warn.className = "lobby-deck-warning lobby-deck-warning--uncertified";
      warn.textContent = `\u26A0 ${uncertified.length} uncertified card${uncertified.length > 1 ? "s" : ""}`;
      warn.title = uncertified.join(", ");
      info.appendChild(warn);
    }
    item.appendChild(info);
    const btns = document.createElement("div");
    btns.style.display = "flex";
    btns.style.gap = "0.4rem";
    if (isCurrent) {
      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => {
        void openDeckEditorFn?.(deck.id);
      });
      btns.appendChild(editBtn);
    } else {
      const selectBtn = document.createElement("button");
      selectBtn.textContent = "Select";
      selectBtn.addEventListener("click", () => {
        void selectDeck(deck.id);
      });
      btns.appendChild(selectBtn);
    }
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "Delete";
    deleteBtn.className = "lobby-delete-btn";
    deleteBtn.addEventListener("click", () => {
      void showConfirm(`Delete deck "${deck.name}"?`).then((ok) => {
        if (ok) void deleteDeck(deck.id);
      });
    });
    btns.appendChild(deleteBtn);
    item.appendChild(btns);
    return item;
  }
  function renderCatalogDeckItem(deck, owned, onAdd) {
    const missing = missingCards(deck);
    const item = document.createElement("div");
    item.className = "lobby-deck-item";
    const info = document.createElement("div");
    info.className = "lobby-deck-info";
    const nameEl = document.createElement("span");
    nameEl.className = "lobby-deck-name";
    nameEl.textContent = deck.name;
    const meta = document.createElement("span");
    meta.className = "lobby-deck-meta";
    meta.textContent = deck.alignment;
    info.appendChild(nameEl);
    info.appendChild(meta);
    if (missing.length > 0) {
      const warn = document.createElement("span");
      warn.className = "lobby-deck-warning";
      warn.textContent = `\u26A0 ${missing.length} missing card${missing.length > 1 ? "s" : ""}`;
      warn.title = missing.join(", ");
      info.appendChild(warn);
    }
    const uncertified = uncertifiedCards(deck);
    if (uncertified.length > 0) {
      const warn = document.createElement("span");
      warn.className = "lobby-deck-warning lobby-deck-warning--uncertified";
      warn.textContent = `\u26A0 ${uncertified.length} uncertified card${uncertified.length > 1 ? "s" : ""}`;
      warn.title = uncertified.join(", ");
      info.appendChild(warn);
    }
    item.appendChild(info);
    const btn = document.createElement("button");
    if (owned) {
      btn.textContent = "Owned";
      btn.disabled = true;
    } else {
      btn.textContent = "Copy";
      btn.title = "Make a copy for yourself to edit";
      btn.addEventListener("click", () => {
        btn.disabled = true;
        btn.textContent = "Copying...";
        onAdd();
      });
    }
    item.appendChild(btn);
    return item;
  }
  function renderCompactDeck(container, deck) {
    const sections = [
      [
        { label: "Pool", entries: deck.pool },
        { label: "Characters", entries: deck.deck.characters }
      ],
      [{ label: "Resources", entries: deck.deck.resources }],
      [{ label: "Hazards", entries: deck.deck.hazards }],
      [{ label: "Sideboard", entries: deck.sideboard ?? [] }],
      [{ label: "Sites", entries: deck.sites }]
    ];
    const nameEl = document.createElement("div");
    nameEl.className = "compact-deck-name";
    nameEl.textContent = deck.name;
    container.appendChild(nameEl);
    const alignEl = document.createElement("div");
    alignEl.className = "compact-deck-alignment";
    alignEl.textContent = deck.alignment;
    container.appendChild(alignEl);
    const grid = document.createElement("div");
    grid.className = "compact-deck-grid";
    for (const group of sections) {
      const col = document.createElement("div");
      col.className = "compact-deck-section";
      for (const section of group) {
        if (section.entries.length === 0) continue;
        const heading = document.createElement("div");
        heading.className = "compact-deck-heading";
        heading.textContent = section.label;
        col.appendChild(heading);
        for (const entry of sortDeckEntries(section.entries)) {
          const row = document.createElement("div");
          row.className = "compact-deck-entry" + (entry.card === null ? " compact-deck-entry--missing" : "");
          const star = entry.favourite ? " \u2605" : "";
          row.textContent = (entry.qty > 1 ? `${entry.qty}\xD7 ${entry.name}` : entry.name) + star;
          if (entry.card) {
            row.dataset.cardId = entry.card;
            const def = cardPool[entry.card];
            const style = def ? getCardCss(def) : void 0;
            if (style) row.setAttribute("style", style);
          }
          col.appendChild(row);
        }
      }
      if (col.children.length > 0) grid.appendChild(col);
    }
    container.appendChild(grid);
  }
  async function loadDecks() {
    const [catalogResp, myResp] = await Promise.all([
      fetch("/api/decks"),
      fetch("/api/my-decks")
    ]);
    const catalog = catalogResp.ok ? await catalogResp.json() : [];
    appState.cachedCatalog = catalog;
    const myData = myResp.ok ? await myResp.json() : { decks: [], currentDeck: null, currentFullDeck: null };
    const myDecks = myData.decks;
    appState.currentDeckId = myData.currentDeck;
    appState.currentFullDeck = myData.currentFullDeck ?? myDecks.find((d) => d.id === appState.currentDeckId) ?? null;
    appState.ownedDeckIds = new Set(myDecks.map((d) => d.id));
    updatePlayControls();
    const myContainer = document.getElementById("my-decks");
    myContainer.innerHTML = "";
    if (myDecks.length === 0) {
      myContainer.innerHTML = '<p class="lobby-empty">No decks yet \u2014 add one from the catalog below</p>';
    } else {
      for (const deck of myDecks) {
        myContainer.appendChild(renderMyDeckItem(deck, deck.id === appState.currentDeckId));
      }
    }
    const catContainer = document.getElementById("deck-catalog");
    catContainer.innerHTML = "";
    if (catalog.length === 0) {
      catContainer.innerHTML = '<p class="lobby-empty">No decks available</p>';
    } else {
      for (const deck of catalog) {
        catContainer.appendChild(renderCatalogDeckItem(deck, appState.ownedDeckIds.has(`${appState.lobbyPlayerName}-${deck.id}`), () => {
          void addDeckToCollection(deck);
        }));
      }
    }
    const previewContainer = document.getElementById("current-deck-preview");
    if (previewContainer) {
      previewContainer.innerHTML = "";
      if (appState.currentFullDeck) {
        renderCompactDeck(previewContainer, appState.currentFullDeck);
      } else {
        previewContainer.innerHTML = '<p class="lobby-empty">No deck selected</p>';
      }
    }
    const mySelect = document.getElementById("my-deck-select");
    if (mySelect) {
      mySelect.innerHTML = "";
      const allDecks = myDecks.length + catalog.length;
      if (allDecks === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "No decks available";
        opt.disabled = true;
        mySelect.appendChild(opt);
      } else {
        if (myDecks.length > 0) {
          const group = document.createElement("optgroup");
          group.label = "My Decks";
          for (const deck of myDecks) {
            const opt = document.createElement("option");
            opt.value = deck.id;
            const missing = missingCards(deck);
            const uncert = uncertifiedCards(deck);
            let label = deck.name;
            if (missing.length > 0) label = `\u26A0 ${label}`;
            if (uncert.length > 0) label = `\u2606 ${label}`;
            opt.textContent = label;
            opt.selected = deck.id === appState.currentDeckId;
            group.appendChild(opt);
          }
          mySelect.appendChild(group);
        }
        if (catalog.length > 0) {
          const group = document.createElement("optgroup");
          group.label = "Stock Decks";
          for (const deck of catalog) {
            const opt = document.createElement("option");
            opt.value = deck.id;
            const missing = missingCards(deck);
            const uncert = uncertifiedCards(deck);
            let label = deck.name;
            if (missing.length > 0) label = `\u26A0 ${label}`;
            if (uncert.length > 0) label = `\u2606 ${label}`;
            opt.textContent = label;
            opt.selected = deck.id === appState.currentDeckId;
            group.appendChild(opt);
          }
          mySelect.appendChild(group);
        }
      }
      if (!appState.myDeckSelectInstalled) {
        appState.myDeckSelectInstalled = true;
        mySelect.addEventListener("change", () => {
          if (mySelect.value) void selectDeck(mySelect.value);
        });
      }
    }
    const aiSelect = document.getElementById("ai-deck-select");
    if (aiSelect) {
      aiSelect.innerHTML = "";
      for (const deck of catalog) {
        const opt = document.createElement("option");
        opt.value = deck.id;
        const missing = missingCards(deck);
        opt.textContent = missing.length > 0 ? `\u26A0 ${deck.name}` : deck.name;
        if (deck.id === "development-proto-hero") opt.selected = true;
        aiSelect.appendChild(opt);
      }
    }
  }
  async function selectDeck(deckId) {
    await fetch("/api/my-decks/current", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deckId })
    });
    await loadDecks();
  }
  async function deleteDeck(deckId) {
    await fetch(`/api/my-decks/${encodeURIComponent(deckId)}`, { method: "DELETE" });
    await loadDecks();
  }
  async function addDeckToCollection(deck) {
    const personalDeck = { ...deck, id: `${appState.lobbyPlayerName}-${deck.id}` };
    const resp = await fetch("/api/my-decks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(personalDeck)
    });
    if (resp.ok) {
      await loadDecks();
    }
  }

  // src/browser/deck-editor.ts
  init_src();
  init_app_state();
  init_render();
  var showScreenFn = null;
  function setDeckEditorCallbacks(showScreen) {
    showScreenFn = showScreen;
  }
  function renderCardList(container, entries, deckId) {
    container.innerHTML = "";
    const sorted = sortDeckEntries(entries);
    for (const entry of sorted) {
      const row = document.createElement("div");
      row.className = "deck-editor-card";
      const qtyEl = document.createElement("span");
      qtyEl.className = "deck-editor-card-qty";
      qtyEl.textContent = String(entry.qty);
      const nameEl = document.createElement("span");
      nameEl.className = "deck-editor-card-name";
      const def = entry.card ? cardPool[entry.card] : void 0;
      const favStar = entry.favourite ? " \u2605" : "";
      nameEl.textContent = (def ? def.name : entry.name) + favStar;
      const badge = document.createElement("span");
      badge.className = "deck-editor-certified-badge";
      if (def) {
        const style = getCardCss(def) ?? "";
        if (style) nameEl.setAttribute("style", style);
        row.dataset.cardId = entry.card;
        row.style.cursor = "pointer";
        if ("certified" in def && def.certified) {
          badge.textContent = "\u2605";
          badge.title = `Certified ${def.certified}`;
        }
      } else {
        row.classList.add("deck-editor-card--unknown");
        const requestKey = `${deckId}:${entry.name}`;
        const btn = document.createElement("button");
        btn.className = "deck-editor-request-btn";
        btn.title = "Ask the server admin to add this card to the game data";
        if (appState.requestedCards.has(requestKey)) {
          btn.textContent = "Requested";
          btn.disabled = true;
        } else {
          btn.textContent = "Request";
          btn.addEventListener("click", () => {
            btn.disabled = true;
            btn.textContent = "Requested";
            appState.requestedCards.add(requestKey);
            void fetch("/api/card-requests", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ deckId, cardName: entry.name })
            }).then(async (r) => {
              if (!r.ok) {
                const data = await r.json();
                btn.disabled = false;
                btn.textContent = "Request";
                appState.requestedCards.delete(requestKey);
                await showAlert(data.error ?? "Request failed");
              }
            });
          });
        }
        row.appendChild(qtyEl);
        row.appendChild(badge);
        row.appendChild(nameEl);
        row.appendChild(btn);
        container.appendChild(row);
        continue;
      }
      row.appendChild(qtyEl);
      row.appendChild(badge);
      row.appendChild(nameEl);
      if (def && !("certified" in def && def.certified)) {
        const certBtn = document.createElement("button");
        certBtn.className = "deck-editor-certify-btn";
        certBtn.title = "Request certification for this card";
        if (appState.requestedCertifications.has(entry.card)) {
          certBtn.textContent = "Requested";
          certBtn.disabled = true;
        } else {
          certBtn.textContent = "Certify";
          certBtn.addEventListener("click", () => {
            certBtn.disabled = true;
            certBtn.textContent = "Requested";
            appState.requestedCertifications.add(entry.card);
            void fetch("/api/certification-requests", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cardId: entry.card })
            }).then(async (r) => {
              if (!r.ok) {
                const data = await r.json();
                certBtn.disabled = false;
                certBtn.textContent = "Certify";
                appState.requestedCertifications.delete(entry.card);
                await showAlert(data.error ?? "Certification request failed");
              }
            });
          });
        }
        row.appendChild(certBtn);
      }
      container.appendChild(row);
    }
  }
  function setupDeckEditorPreview() {
    const screen = document.getElementById("deck-editor-screen");
    const preview = document.getElementById("deck-editor-preview");
    screen.addEventListener("mouseover", (e) => {
      const row = e.target.closest(".deck-editor-card[data-card-id]");
      if (!row) return;
      const def = cardPool[row.dataset.cardId];
      if (!def) return;
      const section = row.closest(".deck-editor-section");
      const sections = [...screen.querySelectorAll(".deck-editor-section")];
      const sectionIdx = section ? sections.indexOf(section) : -1;
      const targetCol = [1, 2, 3, 2, 3][sectionIdx] ?? 0;
      const targetSection = sections[targetCol];
      preview.className = "deck-editor-preview";
      if (targetSection) {
        const targetRect = targetSection.getBoundingClientRect();
        preview.style.left = `${targetRect.left}px`;
        preview.style.right = "";
      }
      preview.innerHTML = "";
      const info = document.createElement("div");
      info.className = "card-preview-info";
      const name = document.createElement("div");
      name.className = "card-preview-name";
      name.textContent = def.name;
      info.appendChild(name);
      const imgPath = cardImageProxyPath(def);
      if (imgPath) {
        const img = document.createElement("img");
        img.src = imgPath;
        img.alt = def.name;
        info.appendChild(img);
      }
      buildCardAttributes(info, def);
      preview.appendChild(info);
    });
    screen.addEventListener("mouseout", (e) => {
      const row = e.target.closest(".deck-editor-card[data-card-id]");
      if (!row) return;
      preview.innerHTML = "";
      preview.style.left = "";
    });
  }
  function setupDecksPreview() {
    const screen = document.getElementById("decks-screen");
    const preview = document.getElementById("decks-preview");
    screen.addEventListener("mouseover", (e) => {
      const row = e.target.closest(".compact-deck-entry[data-card-id]");
      if (!row) return;
      const def = cardPool[row.dataset.cardId];
      if (!def) return;
      const columns = [...screen.querySelectorAll(".lobby-column")];
      const targetCol = columns[1];
      preview.className = "deck-editor-preview";
      if (targetCol) {
        const targetRect = targetCol.getBoundingClientRect();
        preview.style.left = `${targetRect.left + targetRect.width * 0.25}px`;
        preview.style.right = "";
      }
      preview.innerHTML = "";
      const info = document.createElement("div");
      info.className = "card-preview-info";
      const name = document.createElement("div");
      name.className = "card-preview-name";
      name.textContent = def.name;
      info.appendChild(name);
      const imgPath = cardImageProxyPath(def);
      if (imgPath) {
        const img = document.createElement("img");
        img.src = imgPath;
        img.alt = def.name;
        info.appendChild(img);
      }
      buildCardAttributes(info, def);
      preview.appendChild(info);
    });
    screen.addEventListener("mouseout", (e) => {
      const row = e.target.closest(".compact-deck-entry[data-card-id]");
      if (!row) return;
      preview.innerHTML = "";
      preview.style.left = "";
    });
  }
  async function openDeckEditor(deckId) {
    const [decksResp, sentResp] = await Promise.all([
      fetch("/api/my-decks"),
      fetch("/api/mail/sent")
    ]);
    if (!decksResp.ok) return;
    const data = await decksResp.json();
    const deck = data.decks.find((d) => d.id === deckId);
    if (!deck) return;
    appState.requestedCards = /* @__PURE__ */ new Set();
    appState.requestedCertifications = /* @__PURE__ */ new Set();
    if (sentResp.ok) {
      const sent = await sentResp.json();
      for (const msg of sent.messages) {
        const pending = msg.status !== "processed";
        if (pending && msg.topic === "card-request" && msg.keywords.deckId && msg.keywords.cardName) {
          appState.requestedCards.add(`${msg.keywords.deckId}:${msg.keywords.cardName}`);
        }
        if (pending && msg.topic === "certification-request" && msg.keywords.cardId) {
          appState.requestedCertifications.add(msg.keywords.cardId);
        }
      }
    }
    sessionStorage.setItem(EDITING_DECK_KEY, deckId);
    document.getElementById("deck-editor-title").textContent = deck.name;
    const sections = [
      { id: "pool", label: "Pool", entries: deck.pool },
      { id: "characters", label: "Characters", entries: deck.deck.characters },
      { id: "hazards", label: "Hazards", entries: deck.deck.hazards },
      { id: "resources", label: "Resources", entries: deck.deck.resources },
      { id: "sites", label: "Sites", entries: deck.sites },
      { id: "sideboard", label: "Sideboard", entries: deck.sideboard ?? [] }
    ];
    for (const s of sections) {
      renderCardList(document.getElementById(`deck-editor-${s.id}`), s.entries, deckId);
      const total = s.entries.reduce((sum, e) => sum + e.qty, 0);
      document.getElementById(`deck-editor-${s.id}-title`).textContent = `${s.label} (${total})`;
    }
    showScreenFn?.("deck-editor-screen");
  }

  // src/browser/deck-editor-entry.ts
  var ns = window.__meccg;
  setDeckEditorCallbacks((id) => ns.showScreen?.(id));
  setDeckBrowserCallbacks(openDeckEditor);
  setupDeckEditorPreview();
  setupDecksPreview();
  ns.loadDecks = loadDecks;
  ns.openDeckEditor = openDeckEditor;
})();
