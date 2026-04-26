# Changelog

## 0.26.0 — 2026-04-26
Challenge Deck B

### Game Engine

- **Escape fix:** Escape no longer offered as a play-short-event action outside combat (rule enforcement).
- **Corruption card removal:** Tapped bearer correctly applies −3 penalty when attempting corruption-card removal (rule 10.08).
- **Corruption card limit:** Enforced one-corruption-card-per-character-per-turn limit (CoE 7.2.1).
- **Corruption rules 10.07–10.08:** Implemented corruption-cards test and removing-corruption-cards rules.
- **Rescue Prisoners auto-attack:** Bearer selected post-attack; bearer-cannot-untap constraint enforced; clickable store-item shown in browser UI.

### DSL & Cards

- **New DSL primitives:** `cancel-chain-return-to-origin` (Goldberry), `cost-evaluator` unification, `wound-target-character` (Escape), `character-gains-item` event (Lure of Expedience), `pair-resource-with-cof` (Crown of Flowers), `attack-not-canceled` boost (Chill Douser), `reduce-attacks-to-one` + `uncancelable-attack` (Forewarned Is Forearmed), haven-join DSL primitive (Alatar).
- **Challenge Deck B — certified this release (~60 cards):**
  - Hero characters — Gildor Inglorion (tw-158), Beretar (tw-128), Bofur (tw-132), Elladan (tw-143), Elrohir (tw-144), Erkenbrand (tw-148), Orophin (tw-174).
  - Hero resources/items — Rescue Prisoners (tw-315), Escape (tw-229), Muster (tw-288), Shield of Iron-bound Ash (tw-327), Great-shield of Rohan (tw-250), Red Book of Westmarch (tw-313), The Cock Crows (tw-342), Orcrist (tw-295), Sword of Gondolin (tw-336), Book of Mazarbul (tw-201), Blue Mountain Dwarves (tw-200), Gollum (tw-246), Goldberry (tw-245), Corpse-candle (tw-23), Ghosts (tw-37), The Ring's Betrayal (tw-99).
  - Hero sites — Blue Mountain Dwarf-hold (tw-377), Carn Dûm (tw-380), Goblin-gate (tw-398), Lossadan Cairn (tw-409), Mount Gram (tw-415), Mount Gundabad (tw-416).
  - Minion cards — Lure of Expedience (le-122), Lure of Nature (le-123), Veils Flung Away (le-146), Rebel-talk (le-132), Searching Eye (le-136), Covetous Thoughts (le-107), Orc Quarrels (le-216), Ambusher (le-59), Cave Worm (le-65), Hobgoblins (le-77), Marsh-drake (le-84), Slayer (le-90), True Fire-drake (le-95), Goblins of Goblin-gate (le-265), Foolish Words (le-112).
  - Dragons set — Dragon-sickness (td-18), Itangast Ahunt (td-37), Rain-drake (td-57), Sand-drake (td-59), From the Pits of Angband (td-27, partial), Eärcaraxë Ahunt (td-21).
  - Hazards — Seized by Terror (dm-88), Stirring Bones (dm-111), The Moon Is Dead (dm-71), Chill Douser (dm-106), The Windlord Found Me (dm-164), Crown of Flowers (dm-121), Forewarned Is Forearmed (dm-132), Corsairs of Umbar (tw-24).
  - Minion wizard — Alatar (tw-117, haven-jump via DSL primitive).
  - Against the Shadow — Safe from the Shadow (as-54).
  - Vilya (tw-358): stat modifier + conditional fetch + deferred corruption check.

### Web Client

- **Game log panel:** Redesigned as top-right panel with per-game history and scroll.
- **Dice rolls:** Opponent dice rolls shown in game log panel; separate explicit roll actions per player.
- **Hazard limit:** Remaining hazard limit shown instead of total.
- **Card highlighting:** Goldberry and cancel-attack allies/characters highlighted in combat view; Lucky Strike highlighted in hand arc during combat.
- **Combat UI:** Instruction text added for cancel-window sub-phase.
- **Score labels:** HL and small labels added to score displays.
- **Bug fixes:** Eliminated allies sent to eliminated pile (not discard).

### Infrastructure

- **Browser bundles split:** Lobby, game, and deck-editor bundles built separately (esbuild); dev server restart loop fixed.
- **AI strategy code:** Moved from `@meccg/shared` to `@meccg/text-client`; AI client scripts moved from `@meccg/lobby-server` to `@meccg/text-client`.
- **Mail timestamps:** `updatedAt` field added to mail messages.
- **CLAUDE.md:** Split into per-package files for clarity.
- **Cost DSL unification:** All `ActionCost` payments routed through `cost-evaluator.ts`.

## 0.25.0 — 2026-04-23

Dragons Sample Deck

### Game Engine

- **Strike sequence priority (rule 8.12):** Attacker now receives Step 1 priority during strike sequences, matching CoE timing.
- **Skill-required resources (rule 3.iv.5):** Enforce one skill-required resource per strike.
- **Additional minor item (rule 6.13):** Allow an additional minor item after a site-tapping resource.
- **Combat-time permanent events:** Support playing permanent events during combat with a strike prowess modifier path.
- **Visibility model:** Generic `revealedInstances` projection replaces per-case visibility flags; pinned by regression tests for place-on-guard and discard-card.
- **Follower hazards:** Render hazards attached to follower characters.

### DSL & Cards

- **New DSL primitives:** `ward-bearer` (Adamant Helmet), `modify-attack` (Black Arrow), `modify-strike` (Risky Blow), site-name keying (Smaug), sage-tap grant-action variant (Dragon's Curse), attacker-chooses-defenders + DoN region keying (Bairanax), dynamic auto-attack (Framsburg), wilderness-driven resource draws (Radagast).
- **Dragons & The Dragons set — certified this release (~30 cards):**
  - Dragons / creatures — Smaug (tw-90), Scatha (td-60), Bairanax (td-3), True Cold-drake (td-77), Eärcaraxë (td-20), Dragon's Curse (td-16), Dragon's Desolation (tw-29).
  - Dragon-ward items — Adamant Helmet (td-96), Enruned Shield (td-114), Habergeon of Silver (td-120), Valiant Sword (td-161), Black Arrow (tw-494), Magical Harp (td-130), Wizard's Staff (td-170).
  - Hero characters / sites — Radagast (tw-178), Brand (td-90), Galdor (td-92), Thráin II (td-94), Rhosgobel (tw-420), Framsburg (td-175).
  - Combat short events — Risky Blow (tw-319), Lucky Strike (tw-270).
  - Minion characters — Asternak (le-1), Ciryaher (le-6), Luitprand (le-23), Ostisen (le-36), Eradan (le-10), Nevido Smôd (le-27), Orc Captain (le-31), Layos (le-19), Adûnaphel the Ringwraith (le-50).
  - Minion resources / sites — Foul-smelling Paste (le-310), Blazon of the Eye (le-302), Carn Dûm (le-359), The Worthy Hills (le-415).
- **Dragons sample deck:** Tuned with combat cards and Dragon's Curse; now 100% certified.

### Web Client

- **Game messages:** Moved to a top-right panel with per-game history; mouse-wheel scrolling; content-width boxes with ragged left edge; easier exit from browsing mode.
- **Combat view:** Highlight items with modify-attack actions; show persistent hazards during combat rendering.
- **Menus & toolbars:** Dev toolbar column replaced with an icon + dropdown menu; Enter/Skip buttons swapped so Enter is primary; card-preview attribute values wrap.
- **Toasts & polish:** Slower toast fade (40s visible, 1.5s fade); opponent short-event plays named in toast and log; dev button column highlights on hover; card JSON hover gated on Developer Mode.
- **Screen text:** "Initiative" renamed to "First Turn" / "Who Goes First"; Roll actions excluded from auto-pass.

### AI & Tooling

- **Heuristic AI:** Seeks healing opportunities and skips dead-end site entries.
- **Remote bug reports:** Game log fetch API exposed for remote handling.
- **AI mail:** `MECCG_LOBBY_URL` / `MECCG_MASTER_KEY` now honored in AI mail skills and `bin/requests`.
- **Certification skill:** Requires CI pass before certifying a card.

### Data Fixes

- **Uniqueness:** Fixed flag on Hauberk of Bright Mail and Sapling of the White Tree.
- **Black Arrow:** Dúnadan corrected to not be a Man for targeting.
- **le-352 test:** Use minion character (Mionid) in untap tests.

## 0.24.0 — 2026-04-21

Minion Sample Deck

### Game Engine

- **Cross-alignment influence penalty (rule 10.15):** Apply the −3 influence penalty per CRF 8.W1/8.R1/8.F1/8.B1 when a player attempts to influence targets of an opposing alignment.
- **Company-arrives-at-site triggers:** Skip short-event triggers for non-moving companies, fixing false triggers (including River) during the Movement/Hazard phase for companies that stayed in place.
- **Discard-in-play label disambiguation:** Action labels for hazards with multiple instances now identify the specific bearer, preventing ambiguous menus (e.g. Voices of Malice).
- **Voices of Malice crash:** Route resource short-events through the correct handler in the M/H phase, fixing a crash on play.
- **Creature keying counts:** Fix wilderness keying counts for Cave-drake and Elf-lord Revealed in Wrath.
- **Stinker (le-154) playable-at:** Match Goblin-gate or Moria per card text; implemented the combat cancel-attack ability as part of certification.

### DSL & Engine Cleanup

- **DSL consolidation (steps 2–4):** Single-card consolidation spec added; dead constraint dropped from docs.
- **Grant-action ID cleanup:** Dropped fall-through dispatch in favour of a generic apply path with an `anyPhase` flag.

### Cards & Data

- **Certified this release (19 cards):**
  - Minion characters — The Mouth (le-24), Shagrat (le-39), Gorbag (le-11), The Warg-king (le-158).
  - Minion hazards / resources — Stinker (le-154, combat ability), Saw-toothed Blade (le-342), Orc-draughts (le-328), Wandering Eldar (le-97).
  - Sites — Moria (le-392), The White Towers (le-412), Weathertop (as-169), Minas Morgul (le-390), Framsburg (td-175), Gold Hill (td-176), Gondmaeglom (td-177), Ovir Hollow (td-179), Zarak Dûm (td-181).
  - Hazards — Mionid (as-3), Perchen (as-4).
- **New cards added:** Dragon's Desolation (tw-29), Lucky Strike (tw-270).
- **Dragons proto deck:** Fleshed out with combat cards and a Smaug payoff.
- **Rules tests:** Implemented rules 3.29 / 3.30 / 3.31 (organisation-phase company composition).

### Infrastructure & Tooling

- **run-ai hardening:** Treat dirty trees as fatal (never stash leftovers); idle-sleep backs off exponentially.
- **Certification skill:** Never leaves the working tree dirty on exit; tightened to refuse partial certifications.
- **Lobby URL:** Strip trailing slash from `MECCG_LOBBY_URL` in `bin/run-ai` and `bin/handle-mail`.
- **add-card:** Normalised card-name lookup and broadened deck-path search.

## 0.23.0 — 2026-04-20

Detainment Attack

### Game Engine

- **Detainment attacks (CoE §3.II):** Full implementation — minion/fw tap instead of body check; conditional on the defender (Elf-lord Revealed in Wrath makes Eldar detainment-only); detainment creature MP (§3.III).
- **Opponent faction re-influence (CoE rule 8.3):** Influence attempts against opponent's in-play factions now supported.
- **Darkhaven sites:** Dol Guldur (le-367) site rules implemented — enables the first certified darkhaven.
- **Free Council endgame trigger:** Sudden Call (le-235) — Minion/Balrog endgame trigger that forces a Free Council call; alignment-gated `call-free-council` effect.
- **DSL additions:** New `call-council` and `reshuffle-self-from-hand` effects; `combat-detainment` gated on defender.
- **Engine cleanup:** Generalized engine helpers and dispatch tables; unified `untap-phase-at-haven` into `untap-phase-end` with a `when` condition.

### Cards & Data

- **Certified this release (19 cards):** Bag End (le-350), Bandit Lair (le-351), Beorn's House (le-354), Dimrill Dale (le-365), Dol Guldur (le-367), Edoras (le-372), Ettenmoors (le-373), Goblin-gate (le-378), Thranduil's Halls (le-408), Eagles' Eyrie (as-144), Black Mace (le-299), High Helm (le-313), The Least of Gold Rings (le-315), A Nice Place to Hide (le-160), Lieutenant of Dol Guldur (le-21), Goblins of Goblin-gate (le-265), Orc Quarrels (le-216), Voices of Malice (le-250), Elf-lord Revealed in Wrath (le-69), Sudden Call (le-235).
- **Stub cards:** Added stub card definitions for cards referenced by challenge decks; filled in missing card IDs across challenge decks; added 3× Wandering Eldar to the minion proto deck.

### Bug Fixes

- **Marvels Told:** Fix effect being offered when all sages are already tapped.
- **Fatty Bolger:** Always show the menu for the cancel-strike ability.
- **River:** Wire cancel-river UI to the constraint strip.
- **Fram Framson (td-91):** Prevent drafting as a starting character.
- **tw-421 test:** Update expected site list after new Dragons-expansion and TW/LE sites became reachable from Rivendell.

### Infrastructure & Tests

- **AI / mail reliability:** `run-ai` and `handle-mail` can now target a remote lobby via API; real certification failures detected by handle-mail; handle-mail hardened against claude-CLI hangs and format drift.
- **Fixture-alignment rule:** Documented that minion/fallen-wizard/balrog card tests must use matching-alignment fixtures.

## 0.22.0 — 2026-04-19

The Dragons rules

### Game Engine

- **Middle-Earth: The Dragons (METD) rules:** New rule tests and engine support for the Dragons expansion — hoards (site flag, generic play-site filter, starting-item gate), lock hazard limit at site reveal (§5), defeat cascade for Dragon manifestations (§4.2), dragon-at-home effect with lair-attack augmentation, suppressed kill MP for self-defeated manifestations (§4.1), manifestation defeat state derived from eliminated piles, corruption no-tap removal variant (§7 / rule 10.08), METD check kinds (§1.2).
- **Card instance identity:** Owning player is now encoded into the `CardInstanceId` prefix, making owner lookup O(1) and eliminating a whole class of paired-reference bugs.
- **DSL generalization:** Check-modifier generalized to a closed `CheckKind` union; `grant-action` activations now route through a generic apply dispatch (migrations for gwaihir-special-movement, extra-region-movement, remove-self-on-roll, test-gold-ring, saruman-fetch-spell, palantir-fetch-discard, cancel-return-and-site-tap); combat-rule effect split into three typed effects; hoard sites tagged via `keywords[]` instead of per-tag booleans; new `Keyword` union type tightens card-data keyword fields.
- **Card behaviour fixes:** Enforce helmet one-at-a-time (rule 9.15); cascade triggers only on terminal piles, not discard; dedup cancel-constraint reducers and isCoastalPath predicates; collapse three Choking Shadows constraint kinds into a single attribute-modifier; migrate Great Ship onto granted-action constraint + path DSL; migrate River onto granted-action constraint pipeline.

### Cards & Data

- **The Dragons expansion data:** New characters (Radagast, Brand, Fram Framson, Galdor, Thráin II) and sites (Framsburg / td-175); full Dragons expansion data and spec; Dragons sample deck.

### Web Client

- **Keyboard shortcuts** for faster visual-view play.
- **UI labels** for the corruption no-tap variant.

### Infrastructure & Tests

- **Rule test coverage:** Filled in missing rule tests across 10 sections; rules README regenerated with METD entries.
- **Test readability pass:** Consolidated `play-and-resolve` helpers and `placeOnGuard`; finished test-helper sweep across remaining rule tests; simplified rule and card tests with shared helpers; introduced `RESOURCE_PLAYER` / `HAZARD_PLAYER` convention across tests; moved remaining test-file helpers and METD fixtures into `test-helpers.ts`; no mystery numbers; fixed pre-existing lint/nightly failures.
- **Specs:** Moved plans from `docs/plans/` to `specs/`; added specs directory with mission, tech-stack, and roadmap; prefixed spec files with creation date.

## 0.21.0 — 2026-04-16

First Challenge Deck A

### Game Engine

- **Reducer hardening:** Removed the per-reducer action validation in favour of validating actions by membership in the last-sent legal-action set. Dead validation guards dropped from reducer-events, reducer-organization, reducer-movement-hazard, reducer-site, reducer-combat, and the smaller phase reducers; reduce()-coupled tests rewritten where they relied on the removed guards.
- **Phase / timing fixes:** Allow resource short-events during the M/H and Site phases; route cancel-attack short events through the chain of effects; apply +1 per supporter when resolving strikes; discard tapped non-haven site of origin after movement; auto-join companies at the same non-haven site after M/H (rules 2.IV.6 / 5.33); implement rules 3.38 / 3.39 (movement to a site already in play) and extend 3.39 to sibling destinationSite (3.37); fix `untap-phase-at-haven` firing for non-active player's characters; fix game getting stuck when a character is eliminated with remaining strikes.
- **Combat & on-guard:** Allow allies to be targeted by strikes in combat (rule 2.V.2.2); fix multi-attack banner showing total strikes instead of attacks; fix cancel-attack removing all strikes from multi-attack creatures; fix Concealment unplayable vs `attacker-chooses-defenders` creatures; fix on-guard reveal allowing cards without an `on-guard-reveal` trigger.
- **New rules implemented:** Rule 2.05 (avatar eliminated), rule 3.03 / 3.11 (avatar / non-avatar play location), rule 4.01 / 4.03 (discard own resource / hazard long-events), corruption-check support tapping in Free Council (rule 7.1.1), item salvage from eliminated characters (rule 3.I.2), uniqueness for items across all players when playing resources, character-scoped duplication-limit for hazard events, plus pending tests for deck exhaustion, sideboard access, and influence.
- **DSL generalization:** Replace play-restriction rule IDs with a closed `play-flag` enum and combat-rule with a closed `CombatRule` union; replace `playableItemRestrictions` field with a site-rule DSL effect; replace `own-hobbit`/`own-scout` keywords with DSL filter expressions; use the DSL condition language for Tolfalas's item-deny rule; generalize `corruption-check-boost` into a `check-modifier` constraint; express Halfling Strength modes via DSL `play-option` effects; new effect types `draw-modifier`, `discard-in-play`, `dodge-strike`, `halve-strikes`, `ahunt-attack`, `cancel-hazard-by-tap`, `control-restriction`, `cancel-attack`-via-chain, `auto-attack-duplicate`, `storable-at`, `item-play-site`, `palantir-fetch-discard`, `gold-ring-test`, `inAvatarCompany` play-target filter, `healing-affects-all` company rule, `home-site-only` flag, `attacker-chooses-defenders`, `extra-region-movement`.
- **State model:** Rename `eliminatedPile` → `outOfPlayPile` and fold `storedItems` into it; rename `creaturesEncountered` → `hazardsEncountered` for broader use; add `sourceDefinitionId` to `ActiveConstraint` for UI display; preserve card instance IDs across the entire character draft; reset `siteCardOwned` to true when a company arrives at a new site; derive faced races from `phaseState.hazardsEncountered`; use the `on-event`/`discard-self` pattern for Alone and Unadvised.
- **Misc fixes:** Halfling Strength corruption-check-boost gated on target CP > 0 and made reactive; Choking Shadows duplication limit per turn; `grant-action` activations during end-of-org step; Cram `untap-bearer` restricted to organization phase; reducer accepting special items with `item-play-site` effects; Hauberk gated to warriors with conditional bonus; Marvels Told discard is compulsory and properly targets attached hazards; And Forth He Hastened restricted without a wizard in the long-event phase.

### Cards & Data

- **First Challenge Deck A certified:** Sites — Lond Galen, Pelargir, Henneth Annûn, Wellinghall, Glittering Caves, Edoras, Dol Amroth, Tolfalas, Isle of the Ulond, The White Tree. Hazards — Wizard's Laughter, Wizard Uncloaked, Vanishment, Promptings of Wisdom, Rebuild the Town, Many Turns and Doublings, Foolish Words, Choking Shadows, Two or Three Tribes Present, Alone and Unadvised, An Unexpected Outpost, Minions Stir, Marvels Told, Dark Quarrels, Halfling Strength, Call of Home. Hazard creatures — Orc-watch, Orc-warband, Orc-lieutenant, Orc-guard, Hobgoblins, Little Snuffler, William (Wuluag), Tom (Tuma), Bert (Burat), Eärcaraxë Ahunt. Hero characters — Saruman (spell-fetch grant-action), Treebeard (region-based discard on company arrival), Ioreth (`healing-affects-all` company rule), Fatty Bolger (`cancel-strike` for characters), And Forth He Hastened, Alatar (partial). Hero resources — Concealment, Dodge, Sun, Stealth, Sapling of the White Tree, Scroll of Isildur, Hauberk of Bright Mail, Palantír of Orthanc, Align Palantír, Rebel-talk, Incite Defenders, Muster Disperses, Riders of Rohan, Rangers of Ithilien, Men of Anfalas, Men of Anórien, Men of Lebennin, Knights of Dol Amroth, Great Ship.
- **Card-data refactors:** Removed tautological card-definition tests; pruned single-use constants from `card-ids.ts`; refreshed README deck catalog with current certification stats.

### Web Client

- **Combat UI:** Tooltip choice between support-strike and cancel-strike; point-and-click for cancel-attack scout selection; two-step character targeting for Stealth (and fix on-guard rendering); ally strike assignment fix; visual feedback for cancel-by-tap during Assassin combat; visual UI for item salvage during combat.
- **Targeting & focus:** Replace tooltip menus with two-step character targeting for allies and hazards; click-character targeting for item/resource play; auto-focus on new company when playing a character at a new site; auto-focus all companies view when moving character to company; auto-focus on company with pending corruption check; auto-focus own company during M/H select-company; surface discard target in Marvels Told play UI; show target scout in Stealth action label.
- **Banners & badges:** Show explanation banner for opponent influence defend roll; show River constraint in situation banner at enter-or-skip; show non-viable reason tooltip for hazard and other card types in hand; position constraint cards as miniatures overlapping right side of site; render active constraints on companies; show opponent action notifications in game UI; hide opponent card identities in toast text and discard pile projection; increase toast duration to 9s and show opponent actions in blue with name prefix.
- **Visual polish:** Color-coded circular character stat badges with gradient fills, borders, and shadows; prevent attachments from hiding prowess/body badge on tapped characters; movement viewer dashed border for sibling destination sites; margin on tapped site cards so movement arrow stays visible; hand arc hover flicker fix; deck exhaust modal cards now overlap on first open; deck exhaustion exchange modal layout improvements; deck editor preview column mapping for sideboard and sites; deck editor zoom preview reposition; debug/visual view toggle no longer disappears after reboot; hide Debug/Visual toggle when developer mode is off; sideboard hover preview in Hazards column; highlight items with granted actions; arrow keys no longer hijacked in text inputs; dice animation lands in tray instead of corner; multi-attack banner shows attacks instead of total strikes; replaced stale sample scenarios with current game save snapshot.
- **Misc fixes:** Dodge card now highlighted as playable in hand during strike resolution; Marvels Told target selection during organization phase; missing approve/decline buttons and inbox list scrollbar; Delete Read button for bulk-deleting handled messages.

### Lobby / Mail / AI

- **Lobby topology:** Game WebSockets are now proxied through the lobby at `/game/<port>`; lobby version badge in the nav bar; `bin/reboot` for controlled server reboot with client reload; delete save files once all players acknowledge the game result; redesigned lobby, auth, decks, and mail screens with a parchment theme; doubled the lobby background image pool (20 → 40 → 80).
- **Review / mail flow:** Defer review-request reply until lobby approval; withhold requestor reply until `approve-pr` merges the PR; remove `approve-pr` script and drop version notes from mails; add review-fix-request flow for declined PR reviews; bug-report and feature-implementation skills now open PRs instead of pushing to master; include waiting review-requests in mail badge count; rename `bin/list-requests` → `bin/requests` with `--all` and `del` subcommands; leave mail unprocessed when skipping for insufficient credits; simplify bug-report dialog copy; add regression-test step to bug-report handling skill; `-h`/`--help` support on all bin commands.
- **AI:** New Smart AI heuristic strategy with movement planning and a council heuristic (Random AI removed, Smart AI renamed to Smart-AI); skip site entry when no hand cards are playable; always draw max; no item transfers; skip moves with nothing to play at the destination; only travel when there are cards to play at the destination; longer body-check delay (3–4s) for more tension.

### Infrastructure & Tests

- **Docker:** Production and development image variants; `bin/build-and-publish` for dev image; source code included in dev image; runs as UID 1000 so `~/.meccg` files aren't owned by root; `/app` writable in dev image.
- **Testing:** Shared test helpers (`test-helpers.ts`) to collapse common boilerplate, applied across ~66 test files; extract shared avatar + sideboard helpers; move play-character viability helpers to test-helpers; tautological card-definition tests removed; lint cleanups (unnecessary type assertions in heuristic common helpers).
- **Plans & docs:** DSL generalization plan with attribute-modifier and granted-action sections; document DSL-expression-over-magic-keywords preference in CLAUDE.md; plan for moving a company to a site already in play; DSL-rewrite plan started.

## 0.20.0 — 2026-04-09

First demo deck fully certified

### Game Engine

- **Unified pending-resolution and active-constraint system:** New top-level shapes for tracking deferred game effects, replacing several ad-hoc pending arrays. End-of-organization step added.
- **Chain of effects for influence attempts:** Faction influence and opponent character/ally influence (rules 10.10–10.12) now flow through the chain of effects, with separate roll actions and a pause-before-roll situation banner.
- **Opponent influence attempts (Phase 1):** Implemented influence against opponent characters and allies, with browser UI for targeting and defend roll, identical-card reveal (rule 10.11), avatar guard, controller-DI, and FW alignment rules.
- **Combat refinements:** Combat-conditional prowess resolution for weapon effects (e.g. max 9 vs Orcs); strike-need calculation now includes tapped/wounded/excess penalties; body-check +1 wounded bonus no longer applies to freshly wounded characters; on-guard creature combat with new AttackSource type and tapped status on strike actions.
- **Phase/state fixes:** Reset company moved flags at start of M/H and Site phases; restrict character play to avatar's site when wizard is in play; allow resource permanent/short events during M/H phase; allow on-guard hazard events affecting auto-attacks to be revealed; merge `eventsInPlay` into per-player `cardsInPlay`; long-event discard cleanup.
- **End-of-organization implicit close:** Cards marked as end-of-org now implicitly close the organization phase.
- **Stat-modifier stacking:** Duplicate cards in play correctly stack their stat modifiers.
- **Engine refactor:** Split monolithic engine modules — `reducer.ts` (6465 lines → 11 phase modules), `state.ts`, `legal-actions/organization.ts`, `format.ts`, `types/cards.ts`, `types/actions.ts`, browser `render.ts`, `app.ts`, `company-view.ts` — into smaller focused modules.
- **Engine rules tests:** New rules tests for active-constraints, pending-resolutions, opponent influence (10.10–10.12), and on-guard reveal flows.

### Cards & Data

- **First hero demo deck fully certified:** All cards in the Stewards of Gondor proto deck are now certified (117 cards, 100% data, 13 certified card effects).
- **New card certifications (this release):** Aragorn II, Anborn, Bag End, Bard Bowman (verify), Barrow-downs, Barrow-wight, Beorn, Beregond, Bilbo, Bree, Cave-drake, Celeborn, Concealment, Cram, Dagger of Westernesse, Doors of Night, Eagles' Eyrie, Edhellond, Elrond, Éowyn, Eye of Sauron, Faramir, Foolish Words, Frodo, Gandalf, Gates of Morning, Glamdring, Glorfindel II, Grey Havens, Gwaihir, Haldir, Horn of Anor, Lost in Free-domains, Lórien, Legolas, Minas Tirith, Moria, Old Forest, Orc-patrol, Peath, Rangers of the North, Rivendell, River, Sam Gamgee, Smoke Rings, Stealth, Sting, Sun, Théoden, Twilight, Wake of War, plus the Assassin and other previously-added effects.
- **New cards added:** From the Pits of Angband, Marsh-drake, Nameless Thing, Rain-drake, Sand-drake, Searching Eye, Summons from Long Sleep, Itangast Ahunt, Crept Along Cleverly, Piercing All Shadows, Lure of Nature, Lure of Expedience, Lure of the Senses, Poisonous Despair, Regiment of Black Crows, True Cold-drake, True Fire-drake, Slayer, Ambusher, Bandit Lair, Dimrill Dale, Goblin-gate, Stinker, Ruse, Red Book of Westmarch, The Least of Gold Rings, Voices of Malice, Orcs of Moria, The Worthy Hills, Tokens to Show, To Satisfy the Questioner, Secrets of Their Forging, Not Slay Needlessly, Join With That Power, Woses of the Eryn Vorn, Bade to Rule, Deeper Shadow, Ostisen, Ciryaher, Mionid, Perchen, Gorbag, The Mouth, Shagrat, Lieutenant of Dol Guldur, The Warg-king, Black Mace, High Helm.
- **DSL extensions:** New effect types — `cancel-attack` (Concealment), `home-site-only` play restriction (Frodo, Bilbo, Sam), `hand-size-modifier` (Elrond), `enemy-modifier` (Éowyn), `test-gold-ring` grant-action (Gandalf), `untap-bearer`, `extra-region-movement`, `all-attacks` prowess modifier (Sun), `attacker-chooses-defenders`, `character-scoped duplication limit` (Horn of Anor), site-rule `healing-affects-all` (Old Forest), `fetch-to-deck` resource short events (Smoke Rings), automatic-attack prowess modifier (Eye of Sauron), `strikes` modifier with creature race context (Wake of War), `grant-action` removal (Foolish Words).
- **Card data fixes:** Marked Lidless Eye Twilight (le-145) as certified; backfilled card IDs in challenge decks; removed fake unknown-card and unknown-site definitions; River bound to a specific site via `attachedToSite`.

### Web Client

- **Pseudo-AI panel:** Collapsible icon-only toggle, JSON action toggle, sticky header layout fix, descriptive parenthesized labels.
- **Company view improvements:** Show "moving to [site]" for in-transit companies; nudge company view toggle and nav arrows down; wounded character positioning fix; hazard cards with granted actions highlighted and clickable during org phase.
- **Confirmation dialog:** Replaced native `confirm()` with in-app dialog; modal dialog for AI saved-game continue/new prompt.
- **Highlights & rendering:** Sort highlighted cards to the end of the pile browser during site selection; unify pile rendering with shared grouping helper; improved MP tooltips; corruption check moved from instruction line to situation banner; situation banner centering fix.
- **Influence UI:** Show roll button and situation banner for faction influence roll; include character name in influence chain-of-effects display; auto-take duplicate haven copy on company split.
- **Send protection:** Guard `sendAction` against double-sends until next server response; remove waiting highlight after review-request approve/decline.
- **Auto URL linking:** Mail message view auto-links URL keyword values.
- **Deck editor:** Show total card count in section headers; notice that deck editor is not yet implemented.
- **Misc:** Stale-button cleanup before early return; clarify resolve-attacks instruction text.

### Lobby / Mail / AI

- **Credit system:** New credit history log, Credit Usage page, set starting credits to 0 for new accounts, bill original requestor for forwarded planning requests and feature-implementation-requests, strip nested subject prefixes from credit-history reasons, show card name in credit usage entries, gate bug-report visibility on credits, block feature-request dialog when player has no credits.
- **Mail handling:** Centralised mail sending in handle-mail; skip handle-mail dispatch when requestor has no credits; mark feature-requests as `[REVIEW]` in list-requests; scan admin inbox so feature-requests appear; toast notification and error handling on feature-request send; skip feature-request mails in run-ai loop.
- **AI tooling:** `bin/handle-mail` (replaces `/handle-mail` skill); log Claude CLI verbose output and print cost/time summary after skill runs; `ai-raw.log` capture fix and removed post-handle sleep; auto-pick when pseudo AI has only one viable action.
- **Plans & docs:** Added AI opponent plan; CvCC plan updated; CRF 22 card errata link added to CLAUDE.md; tighter save-correspondence requirement in bug-report skill.

### Tests & Infrastructure

- **Helpers refactor:** Moved reusable test helpers (combat runners, opponent-influence helpers, multiple per-card helpers) out of individual test files into `test-helpers.ts`.
- **Hooks:** Added hooks to prevent direct test commits; reverted accidental test changes that should go through PR.
- **Lint cleanups:** Multiple unused-import / unused-cast / unnecessary-assertion fixes in engine and tests.
- **Markdown lint:** Fixed formatting in plans and changelog.

## 0.19.0 — 2026-04-05

On-guard handling

### Game Engine

- **On-guard card placement:** Hazard player can place any hand card face-down on a company's site during M/H phase. Counts against hazard limit, one per company.
- **On-guard creature reveal at site phase:** Creatures keyed to the site can be revealed at Step 1 (only if site has auto-attacks). Declared creatures enter the chain at Step 4 for combat.
- **On-guard event reveal at resource play:** When resource player plays a site-tapping resource, hazard player gets a window to reveal on-guard hazard events. Initiates nested chain per rule 2.V.6.1.
- **OnGuardCard type:** New type with `revealed` flag — cards stay in `onGuardCards` throughout, flipping to face-up when revealed. Replaces the removed `declaredOnGuardAttacks`.
- **Character hazard storage:** Replace `corruptionCards: CardInstanceId[]` with `hazards: CardInPlay[]` on characters. Add `Company.hazards` for company-targeting hazards.
- **Creature card lifecycle fix:** Creatures now enter `cardsInPlay` during combat (not discard). After combat: kill pile (defeated) or discard (not defeated).
- **Chain of effects for creatures:** Both M/H creatures and on-guard creature reveals go through the chain, allowing responses before combat.
- **play-target DSL effect:** New effect type for declaring character-targeting cards (e.g. Foolish Words).
- **on-guard-reveal DSL effect:** New effect type declaring when on-guard cards can be revealed.
- **Hazard sideboard once-per-untap:** Added `hazardSideboardAccessed` flag to prevent repeated access.
- **on-guard-creature attack source:** New `AttackSource` type for on-guard creature combat.
- **Tapped status on strike actions:** `AssignStrikeAction` and `ChooseStrikeOrderAction` include tapped flag.

### Cards & Data

- **Foolish Words** (le-112, td-25): Hazard permanent-event with play-target, on-guard-reveal, check-modifier effects.
- **Bree** (tw-378): Border-hold site in Arthedain, nearest haven Rivendell.
- **Development decks:** Added 2× Foolish Words to all development decks. Added Bree to hero deck. Moved Twilight to sideboard in hero deck.

### Web Client

- **On-guard card rendering:** Face-down cards on site with vertical stacking (up to 5). Card-back display with hover preview for hazard player. Revealed cards show face-up.
- **On-guard placement UI:** Hazard cards show "Place on-guard" in click menu alongside normal play options.
- **On-guard reveal UI:** Revealable cards get golden glow, clickable during reveal steps.
- **Combat card display:** On-guard creature attacks show the creature card in combat view.
- **Character-targeting menus:** "Play on <character name>" labels for targeted hazard events.
- **Destination site face-down:** Shows site-back until revealed during M/H, with hover preview.
- **Rename "Victory Display" to "Eliminated"** in pile labels.
- **Swap Hand debug feature:** Dev toolbar button to exchange hands between players.
- **Projection fix:** Hidden cards keep real instance IDs (no more UNKNOWN_INSTANCE collisions).

### Testing

- **On-guard rules tests:** 19 tests across rule-5.23, rule-6.02, rule-6.14, rule-6.16.
- **Foolish Words card test:** 4 tests for character targeting, influence modifier, on-guard placement and reveal.
- **Shared test helpers:** `makeSitePhase`, `attachHazardToChar`, `placeOnGuard`, `resolveChain`.

### Infrastructure

- **Card certifications:** Balin (tw-123), Adrazar (tw-116), Isengard (tw-404), Doors of Night (tw-28), Gates of Morning (tw-243), Haldir (tw-164), Lórien (tw-408).
- **Chain of effects:** Permanent and long events now route through the chain.
- **Card request handling:** Deterministic Node.js script replaces Claude skill.
- **Markdown linting:** Added markdownlint-cli2 to CI.
- **Pseudo-AI mode:** Human controls both sides via dual WebSocket.
- **Player credits system** for card requests and certifications.

## 0.18.0 — 2026-03-31

Testing system and status

### Game Engine

- **Structured CoE rules:** Replace coe-rules.txt with structured markdown from CoE website.
- **Comprehensive rules test scaffold:** Add 295 test.todo() entries covering all CoE rules sections.
- **Per-rule test structure:** Replace old rules tests with individual test files per rule.
- **Implemented rule tests:** Rule 1.02 (player type), 2.01 (resource/hazard roles), 2.02 (resource player actions), 2.11 (phase transitions with end-of-turn).
- **DeckList alignment type fix:** Fix alignment type in DeckList to match player type test.
- **Remove instanceMap:** Piles now store CardInstance objects directly.
- **Move deck characters to pool:** Challenge decks now keep characters in pool, share sort function.
- **Block avatar drafting:** Move avatars from pool to deck.characters, change destinationSite to SiteInPlay.

### Card Data

- **Complete CoE card database:** Local copy of authoritative card database at data/cards.json.
- **Card data policy:** Always reference local database copy for card stats.
- **New card:** William (Wuluag) hazard creature added, fix challenge deck A reference.

### Web Client

- **Sort favourites first:** Favourite decks appear at top of deck listing.
- **Default AI deck:** AI deck selection defaults to hero development deck in lobby.

### Infrastructure

- **Project status tracking:** Add Project Status section to README with coverage metrics.
- **Card tests README:** Add per-card test matrix tracking certification progress.
- **/update-readme command:** New slash command to refresh all progress metrics.
- **Updated README screenshot:** Replace character draft with organization phase screenshot.
- **Remove --debug features:** Strip ANSI coloring from servers and clients.
- **Lint cleanup:** Remove unused imports across untap phase tests.

## 0.17.0 — 2026-03-30

Playing a faction

### Game Engine

- **Faction influence attempts:** Play factions at their designated sites during
  the site phase. Two-step UI: select faction from hand, then click an untapped
  character to make the influence roll (2d6 + direct influence vs influence number).
- **DSL influence bonuses:** Faction cards carry `check-modifier` effects for
  standard modifications (e.g. Dúnedain +1). The resolver collects bonuses from
  both the character's equipment and the faction card itself.
- **Faction MP scoring:** Factions in `cardsInPlay` now correctly contribute
  marshalling points (previously ignored by `recomputePlayer`).
- **Explicit untap action:** Resource player must click "Untap" to untap cards
  during the untap phase, replacing automatic untap on phase advance.
- **Dice roll metadata:** All roll actions (`corruption-check`, `influence-attempt`,
  `resolve-strike`, `body-check-roll`) now include `need` and `explanation` fields
  showing what's needed for success and how it's calculated.
- **Type guard:** Added `isFactionCard` type guard and `FactionCard` union type.

### Web Client

- **Pile browser improvements:** Close with Escape key. Rows overlap when more
  than 3 to fit on screen without scrollbar, with per-row z-indexing.
- **Card preview in pile browser:** Hovering cards in the pile browser shows the
  zoomed preview with card info panel (moved above overlay z-index).
- **Site and region type icons:** Added official MECCG site type icons (haven,
  free-hold, border-hold, ruins-and-lairs, shadow-hold, dark-hold). Site paths,
  haven paths, site type, and creature keying display inline icons.
- **Dimmed card rendering:** Use `brightness(0.3)` filter instead of `opacity`
  to prevent bleed-through when cards overlap.
- **Debug MP breakdown:** Score line in debug UI shows component breakdown
  (C=x I=x F=x A=x K=x M=x).

### Data

- **Faction card effects:** All 8 faction cards now have DSL effects for their
  standard modifications.
- **Card image fixes:** Fixed 9 cards using wrong `cdn.jsdelivr.net` image URLs
  (Marvels Told, Smoke Rings, and others).

## 0.16.0 — 2026-03-30

Sideboard handling

### Game Engine

- **Sideboard access during organization:** Tap avatar to access sideboard during
  organization phase (CoE 2.II.6)
- **Hazard sideboard access during untap:** Hazard sideboard access during untap
  phase (CoE 2.I) with two-step declare-then-select flow
- **Deck exhaustion sideboard exchange:** Sideboard exchange on deck exhaustion
  (CoE §10)
- **Untap phase synchronization:** Require both players to pass untap phase before
  advancing
- **Fix untap deadlock:** Fix deadlock when hazard player starts sideboard after
  passing
- **Card instance identity:** Cards carry identity (definition ID, name) everywhere;
  unified pile rendering with server-built instanceMap
- **Fix multiple game bugs:** Various game bug fixes including dice tray UI

### Card Pool

- **New sites:** Dol Amroth, Edoras, Glittering Caves, Isengard, Isle of the Ulond,
  Lond Galen, Pelargir, Tolfalas, Wellinghall
- **New characters:** Alatar, Wûluag
- **New resources:** Align Palantír, And Forth He Hastened, Dark Quarrels, Dodge,
  Great Ship, Hauberk of Bright Mail, Halfling Strength, Incite Defenders,
  Men of Anfalas, Men of Anórien, Men of Lebennin, Marvels Told,
  Palantír of Orthanc, Rangers of Ithilien, Sapling of the White Tree,
  Scroll of Isildur, Stealth, Treebeard, An Unexpected Outpost, Alone and
  Unadvised, Promptings of Wisdom, Rebuild the Town, The White Tree
- **New hazards:** Bert (Burat), Call of Home, Choking Shadows, Eärcaraxë Ahunt,
  Hobgoblins, Little Snuffler, Many Turns and Doublings, Minions Stir,
  Muster Disperses, Orc-guard, Orc-lieutenant, Orc-warband, Orc-watch,
  Rebel-talk, Tom (Tuma), Two or Three Tribes Present

### Web Client

- **Sideboard UI:** Victory display and browsable sideboard piles in deck box;
  hazard sideboard buttons (Pass, Hazard to Deck/Discard) stacked vertically
- **Pile browsing:** All card piles clickable to browse contents with overlapping
  stack view for hidden piles; actionable cards sorted to front
- **Card animations:** Animate cards moving between piles and play area with
  crossfade transitions
- **Deck management:** Deck selector dropdown in lobby, stock catalog decks for all
  players, deck delete and catalog Copy button
- **Game display:** Seq number next to game ID in heading, unified card type colors,
  enlarged strike assignment arrows, dice slide animation restored
- **Bug report & feature request:** Bug report button, feature request workflow with
  admin approve/decline, one-click implementation requests

### Lobby Server

- **Game reliability:** Fix web UI reload failing to rejoin active game; relaunch
  game server via lobby on disconnect; fix AI client without deck and port
  collisions
- **Deck selection:** Auto-create reviewer players as system accounts; deck selector
  with stock catalogs
- **AI runner:** Added AI runner for automated gameplay

### Infrastructure

- **Card instance arrays:** Replace card pile count fields with UNKNOWN_INSTANCE
  arrays for consistent card tracking
- **Mail improvements:** Save recipients alongside mail messages; game log validation
  required before fixing bug reports
- **Documentation:** Card certification process documented in CLAUDE.md and glossary

## 0.15.0 — 2026-03-29

Feature requests and bug handling

### Game Engine

- **Fix duplicate haven actions:** Resolved bug where playing characters showed
  duplicate haven site actions

### Card Pool

- **Foul-smelling Paste (le-310):** New resource added from card request

### Web Client

- **Bug report button:** New toolbar button and dialog for submitting bug reports
  during gameplay
- **Feature request workflow:** New Feature Request button and modal on the mail
  page with admin approve/decline flow
- **Implement button:** One-click feature implementation request from approved
  feature plans
- **Persistent nav bar:** Added top navigation bar with separate Decks and Lobby
  screens
- **Mail UI improvements:** Hidden scrollbar on mail list, wider metadata labels,
  wrapped long lines in pre blocks, persistent mail view on refresh, status
  badge updates on approve/decline, default visual mode
- **Play button UX:** Disabled play buttons when no deck is selected with a
  notice linking to decks page
- **Renamed Dashboard to Lobby** in navigation

### Lobby Server

- **Bug report mail topic:** New `bug-reply` topic for bug report handling
- **Planning request topic:** New `planning-reply` and `feature-implementation-request`
  topics for feature workflow
- **Feature request enhancements:** Subject field, reviewer role rename,
  approved requests copied to sent

### Infrastructure

- **Build step in release:** Added `npm run build` type-check to release command
  checks
- **Skill updates:** Added `/handle-bug-report` command, renamed `certify-card`
  to `handle-certify-card`, added feature planning and implementation handling
  to mail skill

## 0.14.0 — 2026-03-29

Internal mail system

### Card Pool

- **Smoke Rings (dm-159):** New resource event added from card request
- **Concealment (tw-204):** New resource event added from card request
- **Peath (tw-176), Ioreth (td-93), Haldir (tw-164), Balin (tw-123),
  Saruman (tw-181), Cram (td-105):** New cards added via card request workflow

### Web Client

- **3-column lobby layout:** Decks in column 1, players and playing in column 2,
  column 3 reserved for future use
- **AI deck selection:** Pick any catalog deck for the AI opponent from a dropdown
- **Saved game detection:** "Continue" or "Start New" prompt when a saved game
  exists against AI
- **Deck upload on game start:** Player's selected deck is sent as the join
  message, filtering out unimplemented cards
- **Personal deck ID prefixing:** Copied decks get `<username>-<deckId>` format
- **Deck viewer sorting:** Cards sorted by type then alphabetically, unknown
  cards at the bottom
- **Missing card warnings:** Red warning icon on decks with unimplemented cards
  in both personal and catalog listings
- **Inbox screen:** Two-pane mail layout with markdown rendering
- **System notifications:** Persistent reddish toasts with close button

### Lobby Server

- **Internal mail system:** File-based inbox with send, read, delete, sent
  folder, and replyTo support
- **Mail API:** Endpoints for inbox, sent, and message status management
- **Admin review flow:** Approve/decline workflow for card requests with
  waiting/approved statuses
- **Display names:** Player display names with system player auto-creation
- **Save management API:** Check for saved games and delete save files
- **System API:** Admin notification broadcast and mail update endpoints

### Game Engine

- **Remove startingHavens:** Starting haven is now derived from the first
  haven in the site deck, simplifying deck configuration
- **Remove sample-decks:** All clients load decks from catalog JSON files
  instead of hardcoded sample decks

### Text Client

- **Catalog deck loading:** `--deck` flag now loads from catalog files on disk

### Infrastructure

- **AI client deck loading:** AI loads deck from catalog files via `--deck` arg
- **Mail glossary:** Added mail system terminology to project glossary
- **AI processor command:** Automated mail queue processing skill
- **Handle-mail skill:** Dispatch incoming mail to appropriate handlers

## 0.13.0 — 2026-03-28

Decks on lobby

### Card Pool

- **Elladan (tw-143):** New hero character added via card request workflow
- **Rivendell (tw-421) certified:** Full card test covering data validation,
  site phase behavior, starter movement, and region movement
- **Certified field:** Card definitions now include a `certified` date when
  all effects are engine-supported and fully tested

### Web Client

- **Deck browser:** Personal deck collection with save/load in the lobby
- **Deck editor:** Card preview panel with type-colored names, quantity
  controls, and bronze star badge for certified cards
- **Current deck selection:** Players choose their deck before matchmaking
- **Card request button:** Request new cards from the deck editor
- **Site zoom info:** Capitalize site type, path, and resource fields;
  show haven-to-haven paths for haven sites
- **System notifications:** Persistent reddish toasts with close button,
  distinct from regular auto-dismissing notifications

### Lobby Server

- **Deck management API:** Browse, save, and select decks per player
- **System API:** Admin notification broadcast endpoint with master key auth
- **Card request API:** Submit and track card addition requests with unique
  IDs and timestamps
- **Dev server fix:** Ignore bundle.js in nodemon watcher to prevent
  restart loops

### Shared

- **Challenge decks:** 10 predefined deck definitions (A-J) with full card
  ID mapping
- **DeckList types:** New types for deck editing and planning
- **Sample decks:** Development prototype decks for all 4 alignments
- **Certify-card skill:** Updated to verify site-specific properties
  (haven paths, auto-attacks, playable resources, region types)

### Infrastructure

- **Web-client bundle rebuild:** Automatically rebuild bundle when shared
  data files change
- **Verify-card command:** Check card playability against engine support

## 0.12.0 — 2026-03-28

End Game

### Game Engine

- **Deck exhaustion:** Second deck exhaustion triggers automatic Free
  Council transition
- **Free Council:** Full corruption check phase — each player must check
  every non-Ringwraith, non-Balrog character in order of their choosing
- **Free Council turn validation:** Use `currentPlayer` from phase state
  instead of `activePlayer` for correct turn enforcement
- **Mandatory corruption checks:** Pass is only available after all
  characters have been checked
- **Game Over scoring:** Tournament scoring with doubling rule (step 3)
  and diversity cap (step 4), avatar elimination penalty (step 6)
- **Finished action:** New `finished` action records game results to
  `~/.meccg/players/<name>/games.json` with game ID, time range,
  opponent, winner, and MP breakdown by category
- **Free Council MP threshold:** Use raw MP total for calling Free
  Council, restore 25-point threshold

### Web Client

- **Free Council company view:** Reuse normal all-companies view during
  Free Council instead of a custom flat character list — characters stay
  in their companies at sites for correct tapping support
- **Corruption check UI:** Click glowing characters to roll corruption
  checks; golden glow highlights available characters; green checkmarks
  on passed characters
- **Game Over scoring table:** MP categories as rows, both players as
  columns, adjusted/raw scores, mini card images for contributing cards
- **Finished button:** Returns to lobby after acknowledging game result
- **No dimming during Free Council:** Both players' companies visible
  at full brightness
- **Free Council debug panel:** Shows step, current player, checked and
  unchecked characters with colored hoverable card names
- **Dice cleared on Game Over:** No floating dice on the scoring screen
- **Deck boxes and hand hidden on Game Over**

### Infrastructure

- **Game reconnection:** Browser persists game port/token in
  sessionStorage; game server keeps state alive on disconnect and
  accepts immediate reconnection; AI client always reconnects
- **Dev server reload:** `bin/run-dev-server` runs esbuild watch with
  proper cleanup on exit, preventing orphaned watcher processes

## 0.11.0 — 2026-03-27

Lobby-server

### Infrastructure

- **Lobby server:** New `@meccg/lobby-server` package with player
  registration, authentication (scrypt-hashed passwords, JWT session
  cookies), online presence tracking, and matchmaking
- **Game lifecycle:** Lobby spawns game-server child processes on demand,
  signs short-lived game tokens, and signals browsers to connect directly
- **AI opponents:** Play against a random AI opponent from the lobby
- **Token auth:** Game servers verify JWT tokens when JWT_SECRET is set
  (backward compatible — standalone mode still works without auth)
- **Server launcher:** Unified server launch infrastructure
- **End-game plan:** Design for end-game scoring and victory conditions

### Web Client

- **Lobby UI:** Login, register, and lobby screens with challenge flow
- **Snapshot remapping:** Snapshot loading remaps player names so
  snapshots work across different game sessions
- **AI reconnect:** AI client handles restart/reconnect for save/load

## 0.10.0 — 2026-03-27

Combat and auto-attacks

### Game Engine

- **Combat framework:** Full combat phase implementation — creature chain
  resolution, strike assignment, defender-chooses-strike-order, prowess/body
  checks, kill/elimination marshalling points
- **Automatic attacks:** Implement automatic attack combat during site phase
  for entering non-free sites
- **Strike rules:** Attacker-chooses-defenders creatures skip defender strike
  assignment; per-keying-match creature hazard actions with disambiguation
- **Healing:** Heal wounded characters at havens during untap phase
- **Allies in combat:** Allow allies to tap for combat support
- **Company cleanup:** Remove empty companies after M/H and Site phase
  transitions; discard tapped sites from empty companies
- **Long-event phase:** Restrict to active player only; remove body-check-roll
  button
- **Player view:** Add startingPlayer and stateSeq to PlayerView

### Web Client

- **Combat UI:** Combat visual view with action buttons, instruction text,
  creature race display, and chain frame integration
- **Tapped/wounded display:** Fix character card rendering when tapped or
  wounded; rotate stat badges with card orientation; collapse empty space
  below tapped cards for item alignment
- **Dev snapshots:** Snapshot loader button, modal with character/site card
  images, and server endpoint for browsing dev snapshots
- **Debug view:** Collapsible raw JSON viewer with card hover and inline atoms;
  compact debug action buttons with right-panel padding
- **Combat projections:** Fix combat UI projections, pile rendering, buttons,
  and resource play during combat

### Infrastructure

- **Package renames:** server→game-server, client-text→text-client,
  client-web→web-client (directories and npm package names)
- **Save files:** Separate manual and automatic save files

## 0.9.0 — 2026-03-26

Chain of Effects

### Game Engine

- **Chain of effects framework:** Full chain-of-effects implementation across
  8 phases — types/plumbing, initiation/priority, resolution loop, short-event
  wiring, creature hazard wiring, passive conditions with nested chains,
  order-passives step, and phase boundary scanning
- **Twilight (tw-106):** Implement environment-canceling short event playable
  during organization and M/H play-hazards phases by either player; does not
  count against hazard limit; targets environments in play or on the chain
- **Chain resolution:** LIFO resolution with fizzle detection when targets are
  already removed; second Twilight can target first on the chain
- **Ally play:** Support ally play during site phase with site tapping
- **Save/restore:** Restore undo history from game log when loading a save
- **Card data:** Add keywords field to card types and data; add Twilight card

### Web Client

- **Chain of effects UI:** Visual chain panel showing declared/resolving entries
  with priority indicators and response actions
- **FLIP card animations:** Smooth card movement animations between positions
  with distance-scaled duration; fix hand arc CSS transform conflicts
- **Company view redesign:** Single-company default view with arrow cycling,
  keyboard navigation, flash effects; auto-switch to all-companies on opponent
  turn; auto-focus opponent's selected company for M/H and Site phases
- **Deck box UI:** 4-pile deck box per player with MP score, GI display, hover
  tooltips, and sideboard pile in debug view
- **Hazard player improvements:** Highlight all playable hazard cards in hand
  during M/H phase; show movement path with region type icons in instruction
  line; allow Twilight play targeting environments
- **Instruction text:** Phase-specific instruction text for all game phases and
  M/H steps with 75vw max width and text wrapping
- **Cards in play:** Never dim cards outside companies (environments, long events)
- **Set-aside display fix:** Resolve set-aside instance IDs through
  visibleInstances so cards render during character draft
- **UI polish:** Pass button moved to bottom-right; card preview zoom requires
  hover; copy-to-clipboard for game code; broadcast cheat usage to all players;
  consolidated z-index CSS custom properties; stacked dev toolbar

### Infrastructure

- **Sample decks:** Remove Sting, Thrall of the Voice, and one Horn of Anor
  from all sample deck draft pools
- **Card tests:** Twilight card tests covering cancel, chain interactions,
  multiple targets, and M/H play-hazards behavior
- **Plans:** Chain of effects and combat implementation plans

## 0.8.0 — 2026-03-24

End of Turn phase

### Game Engine

- **End-of-turn phase:** Implement 3-step state machine for end-of-turn
  processing (CoE 2.VI) covering discard, hand refill, and cleanup

## 0.7.0 — 2026-03-24

Site phase basic flow

### Game Engine

- **Site phase state machine:** Step-based site phase with company selection,
  item play with site tapping, and phase entry steps
- **Untap phase:** Implement untap logic to untap active player's cards at
  start of turn
- **Site tapping model:** Replace CardInstance.status with SiteInPlay for
  site tapping, enabling proper site state tracking
- **Company ID generation:** Fix duplicate company ID generation after merge

### Infrastructure

- **Pre-commit checks:** Note parallel execution for pre-commit checks in
  CLAUDE.md and fix lint error

## 0.6.0 — 2026-03-24

Movement and Hazard basics

### Game Engine

- **Movement/Hazard phase:** Full implementation of MH steps including company
  selection, site reveal, path declaration with region resolution, hazard limit,
  order effects, card drawing, playing hazard long-events, and interactive hand
  reset
- **Path declaration:** Compute and offer movement path options with site path
  resolution, sorted by shortest length and fewest distinct regions
- **Play hazards:** Creature placeholders with keying validation, permanent-event
  hazards support, and hazard duplication limits
- **DSL rules:** Maximum region distance rule for Movement/Hazard phase
- **Card data:** Added Doors of Night card, Wake of War duplication limit, and
  resource/hazard draw counts for all sites

### Web Client

- **Movement UI:** Path choice buttons under origin site, region types shown on
  path buttons, dimmed non-active companies, debug info box for MH sub-steps
- **UX improvements:** Press Enter to activate single action button, improved
  instruction line readability over cards in play, non-playable hazards shown
  with reasons
- **Dev tools:** Summon button to create any card in hand, server engine logs
  forwarded to web client in dev mode

### Infrastructure

- **Project README** added

## 0.5.0 — 2026-03-23

Long-event phase done

### Game Engine

- **Long-event phase:** Play long-events to cardsInPlay with full phase handler
  and UI support
- **Global stat-modifier effects:** DSL effects with `target: "all-characters"`
  now apply to character effective stats (e.g. Sun granting +1 prowess to Dúnadan)
- **Placeholder phase handlers:** Added stub handlers for movement, site, and
  end-turn phases
- **Precise undo tracking:** Replace touched-cards heuristic with precise reverse
  actions for cleaner state rollback
- **Card data:** Added Sun, Eye of Sauron, and Wake of War cards; preliminary DSL
  effects for Sun; glossary entry for DSL Effect

### Web Client

- **Corruption points badge:** Items in company view now show a CP badge overlay
  when they have corruption points
- **Site selection UI:** Replaced auto-opening site deck viewer with highlighted
  pile during site selection
- **Verbose flag:** Full state output gated behind `--verbose` flag

## 0.4.0 — 2026-03-23

Organization phase basics done

### Game Engine

- **Organization phase:** Play characters, split/merge companies, transfer items,
  plan movement, cancel movement, move characters between general and direct
  influence, and pass to advance phases
- **Corruption checks:** Required after item transfer; eliminated pile and
  pre-computed corruption check fields added to state
- **Merge companies:** Join two companies at the same site with regress tracking
- **Split companies:** Simplified to single characterId action; character movement
  between companies
- **Movement planning:** Plan-movement and cancel-movement actions with movement
  arrow visuals; movement map CLI tool with precalculated site reachability
- **Permanent events:** Play permanent-event resources (Gates of Morning) with
  duplication-limit enforcement
- **Move-to-influence:** Reassign characters between general and direct influence
- **Starting item limit:** Enforced in reducer (max 2 starting items)
- **Organization phase tests:** Explicit state builder for organization phase
  rules-as-specification tests
- **Card data cleanup:** Removed tw-other.json, moved cards to proper data files;
  removed alignment field from region cards; removed movementType/regionPath from
  PlanMovementAction

### Web Client

- **Company view:** Three view modes for play phases with leader-first rendering,
  dice-colored labels, horizontal card layout, faded non-bottom cards, items
  side-by-side
- **Character cards:** Mind badge overlay, follower stat badges, direct influence
  badge, playable card highlighting with golden halo
- **Two-step selection:** Targeting instruction text for character play and item
  transfer flows
- **Site browser:** Dialog with card zoom/info panel style; site deck viewer modal
  replacing hand arc for site selection
- **Movement:** Opponent's hidden movement shown as site card back; movement viewer
  with action JSON toggle
- **Turn notifications:** Shown when entering Untap phase; next phase name on pass
  button
- **Settings dialog:** Developer Mode toggle, Auto-pass setting to auto-take sole
  viable action
- **Toast notifications:** In both debug and visual view modes
- **Dice:** Buffered state updates until dice animation completes; clear on
  disconnect/save; cheat roll feature (dev-only)
- **UI polish:** Dark overlay z-index fix, click-empty-space to exit single view,
  persistent selected company via localStorage, dimmed inactive player companies,
  character action tooltip modal, hand arc hover fix, non-viable card reasons
  display, deck pile count badge, collapsible card lists in debug view

### Text Client

- **Dice display:** Track and show last dice roll
- **Pool size:** Shown during setup phases for both players

### Infrastructure

- **Package reorganization:** Moved game engine and tests from server to shared
  package
- **API documentation:** JSDoc generation with typedoc
- **Testing:** Rules-as-specification tests replacing unit tests; card test
  placeholders for all 36 cards with effects; separate nightly test run
- **Testing plan:** Full testing plan and extracted CoE rules reference
- **Skills:** Added /investigate skill; /release skill tracked in version control
- **Dev mode:** Gated dev operations behind --dev flag with server-driven
  confirmations; undo button; reseed RNG button
- **Card data:** Added ally and faction resources, 5 new hero sites, non-unique
  hazard limit (3 copies per deck)
- **Pre-push checklist:** Added to CLAUDE.md

## 0.3.0 — 2026-03-21

Fully functional setup phase for hero

### Game Engine

- **Untap phase:** Both players pass to advance to organization phase
- **Two-step item draft:** Select item, then pick target character
- **Separate deck shuffle and initial draw:** Split into distinct setup steps
  with explicit Shuffle and Draw actions
- **Card effects DSL:** Declarative condition matcher and resolver engine for
  card effects
- **Effective stats:** `EffectiveStats` on `CharacterInPlay` with item modifier
  computation
- **Detailed logging:** Full legal-actions logging with arguments, visual
  divider lines, and card status symbols
- **Card uniqueness enforcement:** Sample play deck respects uniqueness rules
- **Card data expansions:** Added cards from LE, AS, WH sets; minion resources;
  fallen-wizard and balrog sample decks; Thrall of the Voice (wh-82)
- **Game IDs and sequence numbers:** State tracking for client-side logging
- **Alignment starting sites:** Correct per-alignment allowed starting sites

### Web Client

- **Visual board:** Middle-Earth backgrounds (20 total), card art, dark overlay,
  hand arc (dynamic per phase), opponent hand arc, player names with scores
- **Dice system:** Red/black dice pairs, slide-to-name animation, initiative
  roll trigger, persistent overlays
- **Card preview:** Fixed right-side panel with attribute info, clear on click
- **Setup rendering:** Characters on table during drafts, sites during selection,
  company assignment in placement phase, item attachment display
- **Deck piles:** Draw deck and site deck piles for both players, shuffle
  animation
- **Interactive actions:** Clickable playable cards with golden halo, phase
  instruction text, pass/done button, set-aside cards display, GI counter
- **Favicon:** One Ring and card motif
- **Local fonts:** Medieval-themed local fonts

### Infrastructure

- **Save location:** Moved saves to `~/.meccg/`
- **Case-insensitive player names** with validation
- **tsx as root dev dependency**

## 0.2.0 — 2026-03-20

Complete pre-game setup flow, alignment system, and visual feedback.

### Game Engine

- **Setup phase consolidation:** All pre-game steps (character draft, item draft,
  deck draft, site selection, character placement, shuffle, draw, initiative roll)
  merged into a single `Phase.Setup` with `SetupStep` discriminant
- **Alignment system:** `Alignment` enum (wizard, ringwraith, fallen-wizard, balrog)
  with per-alignment rules: max starting company size, allowed starting sites,
  max starting sites
- **Alignment rules module:** `alignment-rules.ts` with extensible per-alignment constants
- **Item draft:** Players assign starting minor items to characters, with definition
  ID-based deduplication for duplicate items
- **Character deck draft:** Players add remaining pool characters to play deck
  (max 10 non-avatar characters)
- **Starting site selection:** Players choose sites from site deck filtered by
  alignment-allowed havens
- **Character placement:** When 2 sites selected, players distribute characters
  between companies; empty companies cleaned up with sites returned to deck
- **Deck shuffle:** Explicit `shuffle-play-deck` action (reusable for future phases)
- **Initial hand draw:** Explicit `draw-cards` action for 8-card starting hand
- **Initiative roll:** 2d6 roll to determine first player, with tie rerolling
- **Visual effects system:** `GameEffect` / `EffectMessage` for client-side feedback,
  starting with dice roll results broadcast from reducer
- **Save/Load/Reset:** Explicit save with backup copy, load from backup, and
  full reset with client reconnection
- **Card data corrections:** Character stats verified against Council of Elrond database

### Web Client

- Card image hover preview on card names (ID-based lookup via STX markers)
- Card back images for unknown cards/sites
- Live-reload in dev mode (esbuild watch + SSE)
- Save/Load/Reset toolbar buttons (hidden in visual mode)
- Draft section hidden after character draft step
- Card names with hover in log messages
- Animated 3D dice roller styled after MECCG Lidless Eye dice
- Debug/visual view toggle persisted in localStorage

### Text Client

- Number-only action selection (removed text commands)
- Reset command for game state
- Pretty-printed debug JSON (over 80 chars)
- AI strategy handles optional actions to avoid infinite loops

### Infrastructure

- Tests moved to `packages/server/src/tests/`
- `/release` slash command for automated releases
- Card data policy in CLAUDE.md (fetch from authoritative database)
- All lint errors resolved

## 0.1.0 — 2026-03-19

First milestone release. The core technical stack is functional end-to-end:
game server, text client, web client, card images, and CI.

### Game Engine

- Pure reducer architecture: `(state, action) -> state`
- Character draft with simultaneous picks, collision handling, and set-aside
- Company management: formation, splitting, merging, movement planning
- Combat system: strike assignment, resolution, support, tap-to-fight
- Site phase: play resources, items, factions; influence attempts
- Corruption checks with modifiers
- Marshalling point scoring across all categories
- General influence tracking and overflow detection
- Free Council endgame trigger
- Card draw, discard, and sideboard fetch

### Shared Types & Data

- Full card definition types for all 10 card categories
- Card data (JSON) for The Wizards base set (characters, items, creatures, sites, regions)
- Card image URLs pointing to council-of-rivendell/meccg-remaster repository
- Card back images (standard + site) bundled locally
- Player view projection with hidden information redacted

### Server

- WebSocket game server with two-player sessions
- Spectator support
- Game state save/load
- Auto-restart on code changes (dev mode)

### Text Client

- Interactive terminal client over WebSocket
- ANSI-colored card display by type
- Numbered action selection
- Pluggable AI strategy system with random baseline and smart draft
- Auto-reconnect on server restart
- Debug mode for raw message inspection

### Web Client

- Browser client with HTTP static serving + WebSocket proxy to game server
- Debug view: game state, draft info, action buttons, log panel
- Visual view: card image display (proof of concept)
- Card image hover preview on card names in debug view (ID-based lookup)
- Server-side card image caching proxy (GitHub -> local disk)
- Live-reload in dev mode (esbuild watch + SSE file change notification)
- Persistent view mode and player name in localStorage
- ANSI-to-HTML color conversion for rich text display

### Infrastructure

- TypeScript strict mode throughout
- npm workspaces monorepo
- GitHub Actions CI (lint + test on push)
- ESLint with typescript-eslint
- Vitest test suite
