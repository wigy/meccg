# Dark Minions — Unimplemented / Untested

Generated: 2026-05-11. Source: `docs/coe-rules.md` cross-referenced with test files and card data.

Note: the official rules page (meccg.com/rules/by-expansion/dark-minions/) returned HTTP 403,
so this analysis is based entirely on the local CoE rules document.

---

## Rule Tests — Status

All major Dark Minions rule mechanics are **implemented and tested**:

| Area | Tests |
|---|---|
| Agent state model & deck construction | rule-9.00, rule-1.09/12/17/20/31/41/42 |
| Playing agent as hazard (§2.IV.vii.1) | rule-5.17 |
| Agent actions: move, return home, heal, untap, turn face-down, key creatures | rule-9.01, rule-9.02 |
| Agent combat: attack declaration, prowess modifiers, detainment (§3.II.2.R3/B3) | rule-9.02b, rule-8.09, rule-8.18, rule-8.33 |
| Agent reveal: movement legality, uniqueness, home site | rule-9.03, rule-9.04, rule-9.05 |
| Agent tapped-effect (§4.3) | rule-9.06 |
| Agent haven restriction (§4.4) | rule-9.07 |
| Agent alignment movement (§4.R1, F1, B1, B2) | rule-9.08 |
| Agent as character (§2.II.2.2.5) | rule-3.15 |
| Agent influence (§8.5) | rule-10.14 |
| Cross-alignment influence penalty (§8.W1/R1/F1/B1) | rule-10.15 |
| Under-deeps movement declaration (§2.II.7.iii) | rule-3.45 |
| Under-deeps movement roll (§2.IV.i.1) | rule-5.03 |
| Under-deeps extra item at site (§2.V.5.1) | rule-6.13 |
| Under-deeps MP exclusion from calling (§10.2.1–4) | rule-10.40 |
| Balrog under-deeps MP inclusion (§10.2.B2) | rule-10.42 |
| Fallen-wizard stage event rules | rule-9.14 |
| FW & Minion draft agent restriction (§1.9.R2, F1) | rule-1.41, rule-1.42 |

**No rule-level gaps identified.** All CoE §4 (Agents) sub-rules and all Under-deeps rules have
corresponding test coverage.

---

## Cards — Not Certified / Not Tested

66 DM cards total. 22 certified, 24 with test files. 42 are neither certified nor tested.

### Agent Characters (25 cards)

These agents have empty `effects: []` — their card-specific abilities are not implemented.

| ID | Name | Special ability (from card text) |
|---|---|---|
| dm-1 | Anarin | May move to a Haven; may tap at company's new site to attack during M/H phase |
| dm-2 | Baduila | If discarded at company's new site, company must return to site of origin |
| dm-4 | Dâsakûn | *(needs card text review)* |
| dm-5 | Deallus | *(needs card text review)* |
| dm-7 | Elerína | *(needs card text review)* |
| dm-8 | Elwen | *(needs card text review)* |
| dm-9 | Eun | *(needs card text review)* |
| dm-10 | Firiel | *(needs card text review)* |
| dm-12 | Gergeli | *(needs card text review)* |
| dm-13 | Gisulf | *(needs card text review)* |
| dm-14 | Golodhros | `agent-tap-influence` effect — tested in rule-10.14 but card not certified |
| dm-16 | Herion | *(needs card text review)* |
| dm-17 | Ivic | *(needs card text review)* |
| dm-18 | Jûoma | *(needs card text review)* |
| dm-19 | Leamon | *(needs card text review)* |
| dm-20 | Nimloth | *(needs card text review)* |
| dm-21 | Ôm-buri-Ôm | *(needs card text review)* |
| dm-22 | Pôn-ora-Pôn | *(needs card text review)* |
| dm-23 | Râisha | *(needs card text review)* |
| dm-24 | Súrion | *(needs card text review)* |
| dm-25 | Taladhan | *(needs card text review)* |
| dm-26 | Woffung | *(needs card text review)* |
| dm-181 | Baugúr | Half-orc. Leader. Discard on body check 8. +2 DI against Orcs and Orc factions |
| dm-182 | Freca | +1 DI against Riders of Rohan and Dunlendings |
| dm-183 | Wolf | +2 DI against Dunlendings |

dm-1 Anarin is notable: its Haven movement exception (`agent-tap-haven-attack`) would override
the general haven restriction from §4.4 and needs a dedicated effect implementation.

### Under-deeps Sites (10 cards)

Sites have no card effects by design, but none are certified. They need verification that
site adjacency data, automatic-attack data, and Under-deeps roll values are correct.

| ID | Name |
|---|---|
| dm-30 | The Gem-deeps |
| dm-33 | The Iron-deeps |
| dm-34 | The Pûkel-deeps |
| dm-35 | The Sulfur-deeps |
| dm-36 | The Under-courts |
| dm-37 | The Under-galleries |
| dm-38 | The Under-gates |
| dm-39 | The Under-grottos |
| dm-40 | The Under-leas |
| dm-41 | The Under-vaults |

dm-32 Hermit's Hill and dm-31 Haudh-in-Gwanûr are already tested/certified.

### Hazards (4 cards)

| ID | Name | Effect summary |
|---|---|---|
| dm-43 | An Article Missing | Tap a scout agent; agent may attack (+4 prowess) without using hazard limit |
| dm-55 | Exhalation of Decay | Bring Undead creature from discard pile back as a creature if it can attack |
| dm-80 | Rank upon Rank | +1 prowess/strikes to all non-agent Man attacks; +Giant attacks if Doors of Night |
| dm-113 | Wisp of Pale Sheen | Undead creature; attacker chooses defenders; strikes target characters with mind ≤ body result |

dm-43 depends on `agent-tap-attack` DSL effect (referenced in rule-9.06 test but card not certified).

### Resources (2 cards)

| ID | Name | Effect summary |
|---|---|---|
| dm-142 | Hundreds of Butterflies | Playable on moving character; untap and increase hazard limit again by 1 |
| dm-179 | Noble Hound | Ally at any Border-hold; must be assigned strike before any other character |

### Hero Character (1 card)

| ID | Name | Effect summary |
|---|---|---|
| dm-180 | Folco Boffin | Cannot be brought into play except at home site (unless starting character); corruption effects |

### Partially tested, not certified (2 cards)

| ID | Name | Notes |
|---|---|---|
| dm-32 | Hermit's Hill | Has a test file but `certified` date is missing |
| dm-109 | Nameless Thing | Has a test file but `certified` date is missing |

---

## Summary

- **Rule gaps:** None — all DM-specific rule mechanics are implemented and tested.
- **Card gaps:** 42 cards with no certification and no test; 2 more tested but not certified.
  - Priority: dm-1 Anarin (Haven-exception agent), dm-14 Golodhros (influence agent, used in tests),
    dm-43 An Article Missing (agent-tap-attack hazard), the 10 Under-deeps sites (data verification).
