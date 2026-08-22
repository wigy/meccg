# Changelog

## 0.125.0 — 2026-08-22

Certification wave, agent-combat fixes, and server hardening

### Game Engine

- **Agent attacks corrected:** M/H agent attacks now honor minion
  detainment (rule 3.II.2.R3/B3, #2686) and the +1 body at-home bonus
  (#2672); a traveled face-down agent's reveal no longer destroys a
  site card or dooms the agent (#2683), and rule 8.22 marshalling
  points now apply to hunt-attack and long-dark-reach-attack (#2695).
- **Combat fixes:** no body check on defeated detainment strikes
  (CoE 3.II.1, #2699), cancel-by-tap full cancels run attack-end
  housekeeping (#2641), cancel-chain-entry no longer duplicates a
  hazard short event in discard (#2640), CvCC attacker body checks get
  the +1 already-wounded bonus (#2632), CvCC declaration is no longer
  offered from an empty company (#2661), trophy prowess bonuses never
  reduce prowess already above 9 (#2662), and `modify-attack` sees
  `enemy.name` for on-guard/played-auto attacks (#2701).
- **No card disappears:** draft collisions no longer fire for
  non-unique characters or delete pool copies (#2666), draft passes
  move leftover pool instances out-of-play (#2669), eliminateAvatar
  keeps attached hazards and followers (#2637), forced
  return-to-origin keeps the destination site card (#2638), and
  bindPrisoner removes a captured follower from its controller's list
  (#2691).
- **Deadlock and livelock fixes:** the end-of-turn forced-play
  livelock (Demon fána swap loop) is gone and council/fána permanent
  events gained their organization-phase gates (#2653, #2656),
  pending-roll deadlocks resolve when the rolling character leaves
  play (#2650), and select-card-bearer no longer deadlocks when the
  company is gone (#2648).
- **Play-legality gates:** hoard items must also satisfy the site's
  printed playableResources tier (#2665), discard-to-recruit honors
  uniqueness and manifestation gates (#2693), the "minion player" play
  ban now covers Balrog opponents (#2645), run-home is not offered
  when the nearest haven is unavailable (#2681), and on-guard creature
  keying honors when-gates and site-based key methods (#2649).
- **Dragons' region keying:** "may also be played at sites in these
  regions" is implemented (#2647 family), including The Great Goblin
  (#2644) and Huorn's region-restricted site-type keying (#2642).
- **Misc:** hazard-limit movement restrictions read the final movement
  type (#2635), Le-150 nullifies global modifiers in opponent
  influence (#2633), Where There's a Whip body-check semantics fixed
  (#2630), structural item stat fallbacks survive unrelated DSL
  modifiers (#2654), Free Council check failures discard attached
  hazards exactly once (#2657), and merge-companies keeps
  company-bound permanent events (#2698).

### Cards

- **22 new certifications:** All the Bells Ringing (as-44), Biter and
  Beater! (as-46), Belegaer (td-100), Elf-path (td-111), Trickery
  (td-159), Anduin River (tw-191), Ash Mountains (tw-194), Athelas
  (tw-195), Fair Travels in Wilderness (tw-237), Halfling Stealth
  (tw-252), Hobbits (tw-258), Crebain (tw-25), Narya (tw-290), Old
  Friendship (tw-293), Palantír of Elostirion (tw-298), Use Palantír
  (tw-355), Huorn (tw-45), Leucaruth (tw-48), Mûmak (tw-66),
  Pick-pocket (tw-79), Silent Watcher (tw-88), plus Fram Framson's +3
  prowess vs Dragon/Drake attacks (td-91).
- **De-certified:** Noble Hound (dm-179) — cancel-prisoner-taking is
  unimplemented (#2678).
- **Data fixes:** corruption points on 4 minor items (#2690),
  marshalling points on 6 permanent events (#2652), unique flags on 14
  minion sites (#2646), no-starting-company on Forgotten Scrolls and
  Lost Tome (#2639), and new data-integrity guards for card-pool
  cross-references (#2694) and shipped challenge decks (#2692).

### Lobby & Game Server

- **Security:** path traversal fixed in deck catalog lookup (#2668)
  and /api/saves routes (#2667); malformed session tokens no longer
  crash the lobby (unauthenticated DoS, #2659, #2689); mail
  recipients are validated server-side (#2655).
- **Reliability:** persistence writes are atomic (records, ratings,
  saves, json-store; #2671, #2674), reconnect races no longer evict
  players (#2696, #2697), and failed game starts release their port
  (#2664).
- **Hidden information:** spectators no longer see face-down on-guard
  cards, agents, or draft data (#2676, #2700); Pallando's discard
  override keeps explicitly revealed cards visible (#2679).

### AI / Sim

- The heuristic agent wires in the cycle guard (#2675), and the h2 AI
  draws tied action types first so item shuffling can't out-vote a
  move (#2658).

### Tests

- Rule 8.24 (combat during a chain of effects) implemented (#2688);
  rule 8.22 creature MP by alignment covered.

## 0.124.0 — 2026-08-21

CvCC combat corrections and three new certified cards

### Game Engine

- **CvCC body checks use effective body.** The attacker body check in
  company-versus-company combat compared against printed body, ignoring
  body-modifying effects (#2618); excess strikes beyond the defenders
  now correctly reduce defender prowess (#2613).
- **Veils Flung Away body-check semantics fixed** (le-146): the
  Ringwraith reveal now follows the correct body-check flow, with the
  pending shape shared across the Nazgûl unleashed family (#2621).
- **Duplication limits can no longer be evaded across printings.**
  Playing two printings of the same-named unique/limited card counted
  as different cards for duplication checks (#2617).
- **Discarding a character no longer makes its site vanish** when the
  discard empties the company during the organization phase (#2615).
- **Untap-phase granted actions are offered again.** An
  activate-granted-action available during the untap phase was
  swallowed and treated as a hazard pass (#2622).
- **Trophy-offer step fixed:** take-trophy had no click target and the
  banner incorrectly said Body Check (#2612).

### Cards

- **Certified: Long Dark Reach (dm-70)** — new chain-reducer support
  for the reveal-and-attack flow (#2620), **Palantír of Annúminas
  (tw-297)** (#2619), and **Secret Ways (dm-157)** (#2614).

### Web Client

- **The Hunt (dm-143) choose-hunt-target buttons render**, so the
  hazard player can actually pick the target (#2616).

## 0.123.0 — 2026-08-21

Engine fix wave, three new certified cards, and a broad refactoring pass

### Game Engine

- **CvCC kills now award marshalling points.** A defending character
  eliminated in company-versus-company combat never credited the
  attacker's kill MP (#2602).
- **Effective skills respected by strike modifiers.** The
  `requiredSkill` check on strike modifiers used printed skills,
  ignoring skill-granting effects (#2599).
- **Store/transfer corruption checks keep bearer-conditional item CP.**
  The corruption-check builder dropped an item's conditional CP bonus
  (e.g. Dwarven Rings) when computing the store/transfer check (#2604).
- **Creature keying keeps site-type overrides for mismatched-alignment
  movers** (#2603), and **Incite duplication is limited per site, not
  per turn** (#2601).
- **Rule 2.V.5.1 bonus item is offered at Deep Mines** (#2592), and the
  **Andúril/Narsil stored-combine action (tw-192) exists** (#2583).
- **Glove of Radagast can play an ally from the discard pile at a
  tapped site** (#2563), and **Dwarven Ring of Durin's Tribe grants its
  +1 body bonus** (#2596).
- **Ringwraith companies with an illegal mixed composition can no
  longer plan movement** (rule 3.07, #2562).
- **Beretar's Rangers of the North DI bonus applies on the
  opponent-steal path** (#2586).
- **anyPhase grant-actions (e.g. Foul-smelling Paste healing) are
  offered during the site phase's select-company and enter-or-skip
  steps** (#2561).
- Barad-dûr's storage ban and the One Ring's storage exception moved
  from engine hardcodes into data-driven site rules/play flags (#2573,
  #2572); attack-cancel site rules unified into a generic
  `cancel-auto-attacks` keyword (#2576).

### Cards

- **Certified: Wizard's Ring (tw-363), Rogrog (tw-85), and Tarcil
  (le-42)** (#2611, #2605, #2578).
- Crown of Flowers' environment reinterpretation now lives in its DSL
  effect (#2585).

### AI

- **H2 combat prices a tap that empties the company's last untapped
  body** by the resource plays it forfeits (#2575).
- Shared opportunity-plan skeleton extracted for the h2 proposers, and
  a common `scoredEvaluation` ending for the H2 modules (#2579, #2606).

### Web Client

- **The influence defend-roll toast shows the check formula and
  verdict** (#2598).
- **The Organization-phase pass button no longer says "Long-event"**
  (#2564), with the tutorial token updated to match.
- Deck browser deck-info block, generic action finder, and tutorial
  panel DOM construction deduplicated (#2589, #2568, #2566).

### Infrastructure & Refactoring

- Large deduplication pass across the engine: `guardResolution` rolled
  out to 18 pending-resolution reducers (#2577), shared
  faction-influence-check context builders (#2582), the sideboard-fetch
  family unified into one sub-flow builder (#2588), plus shared helpers
  for corruption-check possessions, same-site company resolution,
  attachment sweeps, end-of-turn dispatch, M/H agent abilities,
  alt permanent-event scaffolding, and discard-candidate collection.
- Lobby server: on-disk JSON idiom extracted into json-store helpers
  (#2607), solo-game launch and page formatters shared (#2567, #2584).
- Sim: `cliPreamble` shared by the 14 sim CLIs (#2595).
- Deck validation and private-field redaction are table-driven (#2610,
  #2609).

## 0.122.0 — 2026-08-20

Pass wins AI ties, same-site company moves fixed, and combat corrections

### AI

- **`pass` wins any tie in the h2 agent.** Design decision: an action no
  module needs in its plan is never taken — every action worth taking is
  priced strictly positive by the module whose plan needs it. This
  replaces the old "among equals, act" tie-break, which turned unmotivated
  legal actions into busywork: handing away starting items and touring a
  minor item around a whole five-character company one hop per decision,
  every organization phase (#2554, game `mt1j9m0i-5d4lze`). A module that
  prices passing strictly *below* the tied best is still respected.
- **The heuristic AI risks at most one character untapped per
  auto-attack.** It kept several characters untapped against a
  multi-strike automatic attack when one defender was enough, taking
  needless -1 modifiers on every extra strike (#2557).

### Game Engine

- **Moving a character between two companies at the same site works
  again when each company holds its own physical site-card instance.**
  `handleMoveToCompany` compared raw site instance ids where the
  legal-action generator compares site *definitions* (rule g.site.1), so
  the offered move was silently rejected — reported twice, from two games
  at Minas Morgul and after a company split (#2560, closing duplicate
  #2559).
- **Cancel-by-tap no longer discards an already-faced Assassin strike.**
  Tapping to cancel one strike of a multi-strike Assassin discarded the
  whole attack including a strike already resolved (#2556).

### Cards

- **Prophet of Doom (wh-106) awards its 3 miscellaneous marshalling
  points** (#2558).
- **Join the Hunt (P)** approved into the card pool.

### Web Client

- **The single-company view shrinks to fit large companies on screen**
  instead of overflowing (#2555).

## 0.121.0 — 2026-08-20

Whole-board organization planning and a round of AI-advice fixes

### AI

- **The organization phase is planned as one whole-board potential.**
  The h2 modular agent's shape decisions — splits, merges, follower
  stacking and un-stacking — are now priced as `u(after) − u(before)` of
  a single scored arrangement: the harm each company's size invites plus
  the goals the arrangement can serve, with committed plans reaching the
  modules for the first time. The design is cycle-free at every risk
  posture by construction (#2546, spec
  `2026-08-20-h2-organization-phase.md`, P1–P4).
- **Travel no longer prices cards the engine refuses at the
  destination.** Ally/faction `playableAt` `when` gates (e.g. War-wolf's
  "Ruins & Lairs with a Wolf automatic-attack") are honoured via the
  engine's own `siteMatchesEntry`, and the MEWH §10 cross-alignment
  site-tap rule is modelled for Fallen-wizard seats — the agent had
  recommended walking a company to Zarak Dûm to face a Dragon for a
  payoff the engine would refuse (#2551).
- **Company splits pay for the hazard slots they create.** The defence
  model now uses the engine's real hazard limit, `max(size, 2)` — the
  min-2 floor is what makes fragmentation expensive, and without it the
  arrangement scorer recommended one singleton spin-off per goal on the
  board (#2551).
- **A support-strike tap is priced by what the supporter forgoes**
  rather than a flat constant (#2553).
- **The heuristic AI no longer camps indefinitely** when its hand holds
  no site-targeted cards: a safe site's printed resource draw now
  outscores passing (#2548).

### Game Engine

- **Veils Flung Away body checks follow CoE 3.I.1 polarity.** The mass
  body check tapped/discarded on a *low* roll and spared a *high* one —
  exactly backwards; a roll at or below the (modified) body now passes.
  The eight minion-character card tests that had encoded the inverted
  polarity are flipped with it (#2549).
- **Fetch-gating honours region-type `when` conditions.** Strider- and
  Mistress Lobelia-style pile fetches now offer cards like A Panoply of
  Wings whose playability is gated on the site's region type
  (#2550).
- **Fetch-to-deck playableAtSite respects play-target site filters**
  (#2547).

### Web Client

- **The pass button no longer mislabels Hall of Fire's untap/heal
  offer** (#2552).

## 0.120.0 — 2026-08-20

Modular AI promoted in the lobby and the Fallen-wizard item family unblocked

### Game Engine

- **"Place this card on X if he is in play" items are playable without
  the wizard.** The whole eight-card Fallen-wizard item family (wh-90,
  wh-92, wh-105, wh-107, wh-111, wh-112, wh-113, wh-115) can now be
  played bare when its wizard is not yet in play — the card sits in play
  contributing its stage points and auto-attaches the moment the wizard
  is revealed, following the wh-99 / Bade to Rule pattern (#2545).
- **Awaiting the Call (le-165) is restricted to the organization
  phase** (#2538).
- **Ally play-target site filters respect site-type overrides.** A
  Noble Hound is playable at a site whose type has been overridden to
  Border-hold (#2541).

### Web Client

- **The opponent's discard-pile browser shows only revealed cards**
  when browsing under Aware of their Ways (#2540).

### AI

- **Modular AI (H2) is promoted in the lobby**, with a new stage module
  that plays stage resources (#2544).
- **H2 organization phase P1:** the turn plan's commitment now reaches
  the modules, backed by a new organization-phase spec (#2543).
- **Attack planning models visible tap-to-cancel-strike abilities**
  (Fatty Bolger-style board cancels) in the attack enumeration (#2542).

## 0.119.0 — 2026-08-20

Six new certified cards and a round of Ringwraith and targeting fixes

### Game Engine

- **Six cards certified:** Riven Gate (as-98), Some Secret Art of Flame
  (le-232), Adûnaphel Unleashed (le-161), Heralded Lord (le-190), Orcs of
  the Ephel Dúath (le-280) and Lordly Presence (tw-267). New DSL
  primitives along the way: `cancel-attack` with
  `cancelsRemainingSiteAttacks` + `influenceAtSiteModifier` (as-98),
  multiple from-hand `modify-attack` effects on one card with
  `grantAttackerChoosesDefenders`/`bodyCheckModifier` (le-161), and the
  supporting shapes for le-232 and tw-267.
- **Ringwraith mode cards follow the Ringwraith on a company split.**
  Fell Rider and other mode cards no longer stay behind with the wrong
  company (#2536).
- **Lure of the Senses can no longer target Ringwraith characters**
  (#2535).
- **Gandalf's test-gold-ring action is now offered during the
  end-of-turn phase** (#2533).
- **Whip's direct-influence discount is credited against already-held
  followers**, and restricted DI is accounted as a shared pool rather
  than a per-follower discount (#2530).
- **Aware of their Ways discard picks are revealed to the card-player**
  instead of staying hidden in the projection (#2528).

### Web Client

- **Glove of Radagast's granted ally can now be played from the discard
  pile** — the discard-pile ally click never worked (#2525).

### AI

- **Heuristic AI taps items for strike boosts** (Shield of Iron-bound
  Ash) when facing strikes (#2524).
- **Heuristic AI no longer wastes capped body/prowess items on
  characters already at the cap** (#2534).

## 0.118.0 — 2026-08-19

Cancel-window timing fixes, Wizardhaven targeting and an argmax AI

### Game Engine

- **Corpse-candle's (tw-23/le-67) company-wide corruption check no longer
  fires before the cancel-attack window closes.** The attack now opens in
  the cancel-window sub-phase and the checks are deferred via a new
  `pendingAttackBeginsCorruption` combat-state field, so a defender who
  cancels the attack (e.g. Star-glass) is not forced through corruption
  checks for an attack that never happened — per CoE rule 3.i (#2514).
- **Dual-mode discard events no longer fire their unrelated cancel-attack
  effect.** The Cock Crows (tw-342) played in its discard-in-play mode (via
  Gates of Morning) was wiping out whichever attack happened to be active;
  `shouldFireOnChainResolution` now skips the cancel-attack effect when the
  resolving entry carries a discard-mode payload (#2517).
- **Hall of Fire (dm-134) is playable on a converted Wizardhaven** — its
  play-target filter tested the printed `siteType` instead of
  `effectiveSiteType`, so a Ruins & Lairs turned into a Fallen-wizard's haven
  by Hidden Haven (wh-75) was never offered (#2515).
- **`companiesAtMatchingSite`** generator replaces five identical
  company-at-site scans in organization-events (White Tree, Return of the
  King, Fireworks, Hall of Fire / Hidden Haven, Caverns Unchoked) (#2518).
- **`filterCreaturePlaysAgainstCompany`** post-filter factors the shared
  skeleton of five creature-constraint appliers in `legal-actions/pending.ts`
  into verdict callbacks (#2519).
- **`findPlayerAllyPlayGrant`** and **`characterHomeSiteCards`** collapse the
  Wizardhaven/company-size ally-play-grant finders and the three home-site
  resolution loops in reducer-utils (#2520).
- **`raceThresholdCancelAttackActions`** / **`matchRaceThresholdEffect`**
  dedupe the Flatter a Foe (td-116) and Riddling Talk (td-148) twins in
  legal-actions/combat and the chain reducer (#2521).
- **New `engine/company-split.ts`** — `splitCharacterIntoNewCompany` is the
  single split core behind Left Behind (td-41) and
  `splitCharacterOffCompany` (as-41) (#2522).
- **`routeShortEventToChain`** folds four reveal → remove-from-hand → push
  chain-entry short-event branches in reducer-events into one helper (#2523).

### Web Client

- **Baduila's (dm-2) discard-to-return-company-to-origin power now appears
  in the agent tooltip** — `agent-discard-return-to-origin` was missing from
  the agent-action whitelist, so the engine offered it but it was unclickable
  (#2516).

### AI

- **The production heuristic AI plays its argmax move instead of sampling
  its weights.** `ai-client.ts` had its own weigh-then-pick loop that never
  received the argmax fix applied to `@meccg/sim`'s `createHeuristicAgent`, so
  a move scored half as good still won about a third of the time — e.g.
  playing Corpse-candle before The Moon Is Dead (#2513).

### Infrastructure

- The seed-7 sim game test now asserts the engine contract (scored game-over,
  victor follows final scores, `winner` null on a tie) instead of pinning one
  seed's outcome (#2514).

## 0.117.0 — 2026-08-19

Combat, scoring and Fallen-wizard bug fixes plus a reducer code-quality sweep

### Game Engine

- **A multi-attack creature is no longer counted as defeated when some of
  its attacks were merely canceled.** Assassin (tw-8) with two attacks
  canceled by Dark Quarrels and the third beaten in combat awarded its 2 kill
  MP; per CRF 22 annotation 14 every attack must be defeated, so canceled
  attacks now block the kill (#2512).
- **Fireworks (dm-130) gives its "+10 if a Wizard" untap bonus to a
  Fallen-wizard avatar sage** — the raw `race` check missed `fallen-wizard`;
  it now goes through `raceForCardTextFilter()` per g.wiz.F1 (#2508).
- **No Strangers at this Time (as-51) is no longer playable at a site
  converted into a Wizardhaven** by Chambers in the Royal Court + Guarded
  Haven; the play-target filter now tests `effectiveSiteType` instead of the
  printed type (#2509).
- **`regressable(state, action)`** replaces `viableWithRegress` and a shared
  `planMovement` builder covers the five identical plan-movement emitters in
  the organization phase (#2506).
- **`guardResolution`** (ex `guardRollResolution`) now also narrows the action
  and is reused by eleven more pending-resolution reducers (#2505).
- **`activate-granted-action` is routed once in `handleSite`** instead of in
  every one of 15 site-step handlers (#2504).
- **`removeSpentEventFromGame`** helper replaces four hand-rolled discard →
  out-of-play relocations in the chain reducer (#2507).

### Web Client

- **The Game Over "Total" row shows the authoritative `finalScores`**, so the
  unique-card-reveal penalty (rule 10.3.v) is reflected in the total (#2511).
- **Carambor's extra movement/hazard-phase tap is offered as a clickable
  button** under the company's site area; previously the legal action was
  only reachable from the debug panel and players saw nothing but "Pass"
  (#2510).

### Infrastructure

- `bin/pr-check` split out of `bin/run-ai`.

## 0.116.0 — 2026-08-19

Nine engine bug fixes and a code-quality sweep that trims 600 lines

### Game Engine

- **Hazard cards with several play-options no longer silently fire the first
  one.** Weariness of the Heart (le-149/tw-111) offers a prowess-penalty and a
  corruption-check option on the same target; the character click now presents
  a menu instead of always dispatching the prowess variant (#2500).
- **Great-shield of Rohan dodges a strike instead of cancelling it outright**
  (#2491).
- **Store-item corruption check uses the pre-storage CP**, not the 0 CP the
  character has once the item is already stored (#2492).
- **Fireworks (dm-130) is playable at a site converted into a Wizardhaven**
  by Hidden Haven (#2503).
- **An agent without a home site is discarded at the right time**, not one
  full turn late (#2502).
- **Extra movement/hazard destinations (Carambor, `grant-extra-mh-phase`)
  are enumerated correctly for mixed-alignment Fallen-wizard / Balrog decks**
  (#2497).
- **Gangways over the Fire honours Caverns Unchoked bridging consistently**:
  the legal-action offer and the reducer's validation now agree on the
  moving player's dynamic Under-deeps adjacency (#2488).
- **Heuristic AI no longer stalls forever after losing every character**
  (#2489).
- Certified **Stone of Erech (tw-334)** (#2501).

### Web Client

- **Forced item discards (Brigands, An Article Missing) are clickable again**
  — the missing click handler is wired (#2499).
- Character-targeting clicks (short-event, faction influence, ally, resource,
  permanent-event, tap-alt permanent-event, hazard) are driven by one
  `CHARACTER_TARGETING_MODES` table instead of seven copied branches (#2493).
- Two-step-selection render caches and their re-render helpers are one
  `renderCacheSlot()` factory + `reRenderFromCache()` (−183 lines, #2495).

### Code Quality

A delta scan over the ~30k lines added since 2026-07-30 folded the recurring
idioms into shared helpers, all behaviour-preserving:

- `pendingChainCards()` / `countUnresolvedChainHazards()` replace ten
  hand-rolled "unresolved, un-negated chain entry" scans (#2487).
- `siteDeckDestinations()` + `companySiteDef()` share the site-deck
  enumerators and the current-site lookup idiom (#2488).
- `rollDiceForPlayer()` replaces ten copies of roll → toast →
  `lastDiceRoll` (#2490).
- `playHazardInAltMode()` folds the four alternate-mode hazard play branches
  (#2494).
- Byte-identical Hall of Fire / Hidden Haven blocks merged (#2496);
  `agentCurrentSiteName` reused instead of re-inlined (#2498).

## 0.115.0 — 2026-08-18

Discards stay on your side of the table, and the AI finally plays its Wizard

### Game Engine

- **Discard-in-play cards reach only the caster's own characters.** Marvels
  Told, Voices of Malice, The Cock Crows and Ancient Secrets let a resource
  player force-discard a hazard permanent/long-event in play, but
  `collectDiscardInPlayTargets()` scanned hazards attached to characters
  on *both* sides, so Balin's Marvels Told could pull Rebel-talk off the
  opponent's character. Per CoE 2.IV.vii.3 an attached hazard-event always
  sits on its bearer's own side, so the character-hazard scan is now
  restricted to the acting player's characters (free-standing long-events
  such as Eye of Sauron in either player's `cardsInPlay` remain reachable).
  Two card tests (le-250, tw-342) that incidentally relied on the leak
  were corrected.
- **Fallen-wizards can fetch their own cross-alignment resources.** Smoke
  Rings and similar "bring a resource from your sideboard or discard pile
  into your play deck" cards filtered candidates by a single alignment's
  cardType, so a Fallen-wizard playing a hero-side fetch card was denied
  their own minion-typed cards (CoE 1.3.F1/F4 lets their deck mix both).
  `matchesDefinitionAcrossFallenWizardAlignment()` flips the hero-/minion-
  prefix for Fallen-wizard actors at both the legal-action enumeration
  and the validation site.
- **Deck-fetch candidates are revealed to their owner.** Mistress Lobelia
  and similar "tap to search your play deck for…" cards queued a fetch
  whose play-deck matches were never recorded in any reveal ledger, so
  the owner's pile browser showed only unpickable card backs and the only
  option was to decline. `buildSelfView` now unmasks exactly the play-deck
  instances the player's own viable fetch-from-pile legal actions target —
  computed at projection time, so nothing leaks to the opponent or
  outlives the fetch.
- **Reforging (tw-314) scores its 1 misc MP when stored.** The card
  database gives it 1 marshalling point but the local data had 0 and no
  `storable-at` override, so a stored Reforging never counted. It now
  mirrors Rescue Prisoners: base 0 while bearer-attached, `storable-at`
  declares `marshallingPoints: 1` once stored.
- `ItemInPlay.playedAtSiteDefId` is now stamped on the direct
  `play-target: character` attach path too (previously only the
  select-card-bearer path set it), so site-scoped duplication limits are
  anchored to where the card was played rather than the bearer's current
  location.

### Web Client

- **Corruption checks are clickable during Free Council.** The hand-arc's
  invisible hover catch zone sat above the all-companies overview that
  Free Council forces, swallowing clicks on any character row that landed
  in its band at the bottom of the viewport. The catch zone's
  pointer-events are disabled while free-council-mode is active; the
  fanned cards remain hoverable and playable.

### Card Data & Certification

- Certified: Vein of Arda (dm-162) — Sage-or-Dwarf permanent event
  playable at any Under-deeps site, tapping the site and the character,
  storable at a Haven for 2 misc MP, bearer cannot untap until stored,
  one per site.

### Simulation & AI

- **The h2 AI plays its avatar.** `play-character` was priced purely by
  marshalling points, so Saruman (0 MP by design) always lost the
  one-character-per-turn slot to any positive-MP character and was
  eventually discarded at the hand-size limit unplayed. A flat
  `avatarInPlayTsd` tunable now prices what an avatar in play unlocks —
  sideboard access (CoE 2.II.6) and resource-draw eligibility (CoE
  2.IV.v).

### Infrastructure

- **`bin/claude-run` — one supervisor for every headless `claude` run.**
  `handle-mail`, `run-ai` and `nightly-release` each carried their own
  copy of the supervisor loop, and the copies had drifted: a CLI change to
  the result object's key order broke the success check in one copy
  (burning ~110 good certifications), two of them passed the prompt as
  argv and hit the 128KB `MAX_ARG_STRLEN` limit, and one SIGKILLed a
  second after SIGTERM. All three now call `claude-run`, which reads the
  prompt from stdin, classifies results with jq, and shuts down
  gracefully.

## 0.114.0 — 2026-08-18

Attackers pick their targets, and Weathertop opens to Fallen-wizards

### Game Engine

- **Rule 1.10.F1 — Weathertop is a Fallen-wizard starting site.** The
  rule allows The White Towers or any Ruins & Lairs in Arthedain or
  Rhudaur, but the allowed-site list enumerated only White Towers and
  Ettenmoors, so Weathertop — a Ruins & Lairs in Arthedain — was
  rejected at starting-site selection. Both printings (tw-436 hero,
  as-169 minion) are accepted per rule 2.II.7.F1, and that completes the
  enumeration: those three are the only Ruins & Lairs in the two regions.

### Web Client

- **Characters can be discarded during organization again.** The engine
  offered `discard-character` (CoE rule 3.22 — a non-avatar character at
  a haven or her home site) but the browser client never consulted that
  action type: no getter, no click handler, no tooltip-menu entry. A
  character with no other action available — Ioreth alone in her own
  company, per two bug reports — was not even clickable. Discarding now
  asks for confirmation, since it is irreversible.
- The Pass button during play-hazards reads plain "Pass Hazards"; the
  "(N left)" suffix duplicated the HL box. In the all-companies overview
  the HL chip and the opponent status lines (name, MP/GI/SP) stay
  visible at their single-view positions, and the phase meter shows its
  two title lines — breadcrumb plus targeting hint, then the moving
  company's region path — with the phase tracks hidden, so the overview
  is no longer context-free. The tutorial's button reference was updated
  to match.

### Card Data & Certification

- Certified: Leaflock (tw-265), Skinbark (tw-328), Master of Shapes
  (wh-112), Pocketed Robes (wh-113). Skinbark also gained his missing
  `mind: 3`, and the `shapeshifter` keyword was added to the vocabulary.

### Simulation & AI

- **"Attacker chooses defending characters" is modeled.** The strike walk
  assumed the defence always answers with its best remaining parrier,
  which was wrong for the 19 creatures printing that text — Cave-drake
  among them — and wrong in both seats at once: the hazard side
  undervalued its own Cave-drake and the defending side over-rated its
  safety against one. `AttackProfile.attackerChooses` is read off the
  `combat-attacker-chooses-defenders` effect; a player who is ahead takes
  the greedy one-step target, one who is behind searches the adaptive
  optimum over the rest of the attack (bounded by `attackStateCap`). A
  character's combat-relevant card text now has a price too — tapping
  Fatty Bolger is worth more than a prowess-1 scout, because a tapped
  Fatty cannot cancel strikes. Three new unfitted tunables
  (`abilityTapDenialTsd`, `abilityLossDenialTsd`,
  `attackerChoiceSearchLambda`); not yet win-rate validated.
- Offered cards are priced by what their points add. `quote()` — the
  path fetches, draft picks and sideboard exchanges price on — computed
  a card's marginal by *subtracting* points it never held from the hand's
  projected total, so any card whose source had nothing in hand yet was
  quoted at exactly zero: a 1 MP ally at 0.0 where the point was worth
  4 TSD. The held branch (`worth()`) is unchanged; the offered branch
  adds. Also not yet win-rate validated.

## 0.113.0 — 2026-08-18

Rescues cost a tap, and banned cards buy their way out

### Game Engine

- **Rule 8.36 — a prisoner rescue now costs a tap, and pays for it.**
  Facing the host's rescue-attacks used to free the prisoners by itself.
  The rule sequences the tap *after* the attacks, so a new `rescue-tap`
  site step asks for it there: a character taps to free all of the
  hazard host's prisoners, the rescue site taps if it was untapped
  (never-taps sites excepted), and that tap opens the additional
  minor-item window — the same rule 2.V.5 flag a site-tapping resource
  play sets. `pass` walks away with the prisoners still held, which
  matters when the company's last free member was wounded facing the
  rescue-attack. Freed characters rejoin the company under general
  influence, which is the moment their mind starts being paid for again.
- **Rule 1.36 — trade a card a Balrog opponent made unplayable for a
  sideboard card.** Five cards cannot be played against a Balrog player
  and each already declared that ban itself, but the half of the rule
  that gives something back was missing: drawing one left a dead card in
  hand for the rest of the game. `swap-banned-vs-balrog` is that trade,
  in one atomic action naming both cards; per CRF 22 the banned card
  leaves for the out-of-play pile rather than the discard pile. A card
  qualifies only when the Balrog opponent is the *reason* it cannot be
  played — the restriction is re-evaluated against a counterfactual
  opponent of every other alignment, so CoE 1.35's Ringwraith family
  does not get a trade it was never granted.
- The additional-minor-item bonus (rule 2.V.5) now opens when a
  permanent- or short-event resource taps the site. The shared
  `applyTapSiteOnPlayFlag` helper never set the phase flags, so cards
  like Dreams of Lore (tw-210) and Far-sight (tw-238) silently skipped
  the bonus window that items, allies and factions all got.
- Multi-card `draw-cards` effects now reshuffle mid-draw (CoE 2.4). Dark
  Tryst (as-80) and Palantír of Elostirion (le-332) capped the draw at
  the play deck's remaining size and stopped silently, losing the owed
  cards and leaving the deck un-reshuffled. The new
  `drawCardsExhausting()` runs the full exhaust sequence when the deck
  empties mid-draw and then resumes.
- Body-check-roll previews now show an ally's own printed body. The
  legal-action preview only looked up strike targets among characters,
  so an ally struck via strike-shield fell through to the generic `9`
  fallback — the reducer already had this right.
- Influence-defend explanations now name the faction or item being
  targeted instead of "?", which had hidden what Twisted Tales (dm-96)
  and friends were actually attempting.
- `return-self-to-hand-when` joins `discard-self-when` as a way for a
  card to leave play *for its owner's hand*, and its sweep also reaches
  allies attached to a character. This closes the last `test.todo` in
  the card suite: Last Child of Ungoliant (le-153) returns to hand when
  Shelob reaches the table.
- Agent attachments generalized for Never Seen Him (dm-74): a
  `play-target: agent` kind, a `duplication-limit` scope of `agent`, and
  `extra-agent-actions` that can be scoped to one specific agent rather
  than only to the whole player or the agent's own reveal.

### Card Data & Certification

- Certified: A Merrier World (wh-59, which also extended the full
  kill-MP exemption to stage permanent-events), Golodhros (dm-14),
  Never Seen Him (dm-74), Ents of Fangorn (tw-228), Woodmen (tw-368).
- Certified reprint siblings whose data had been left inert: Fell Winter
  (tw-35), Brigands (le-64), Wolf-riders (td-87). Each carried the type
  and stats but an empty or partial `effects` array, so the second
  printing did nothing its twin did — including Fell Winter's
  duplication limit, which spans printings and had let both copies sit
  in play stacking Wolves attacks on every Border-hold.
- Modeling Woodmen's "Men (+1)" standard modification changed Wacho's
  (tw-187) influence needs at Woodmen-town; its expectations were
  updated to match.

### Simulation & AI

- The heuristic AI no longer enters a site for a permanent event it
  cannot actually play there. `handHasNoTapPlayableAt` credited any
  permanent resource event as a no-tap reason to enter, ignoring both
  the card's own site gates (`play-target: site` filter,
  `tapped-site-only` / `untapped-site-required`) and the fact that an
  event attaching to a character needs an untapped one just like an item
  does. Rescue Prisoners (tw-315) failed both ways, and companies walked
  into automatic-attacks for plays that were never legal.

## 0.112.0 — 2026-08-17

Ask the AI what it would do, and it learns what a card is worth

### Web Client

- **Ask AI.** A toolbar icon appears while an observer is attached and
  answers, in one click, what the selected agent would do in the position
  on screen: its pick, the ranked alternatives, what the engine refused,
  and the `explain` command that re-derives the whole thing offline. No
  confirmation dialog and no dev gate — asking is a read, it changes no
  state and does not mark the game cheated — and spectators get the
  control too, since watching an AI game and asking what a different
  agent would have played is a main use of it. `?` asks the first agent
  about the position; punctuation, because the letter keys all address
  hand and board targets. The follow-up questions — another agent, or
  "would it have played what I just played?" — live in the answer
  panel's action row, where there is already a ranking on screen to
  compare against. Every refusal says what to do about it: "no observer"
  prints the `bin/observe` line, a timeout suggests a cheaper agent. The
  button is disabled while a question is in flight and a late answer to
  a question the panel has moved on from is ignored.
- The active company is marked with an "Active" badge on the top-left
  corner of the site it is heading to — the destination while moving,
  the current site otherwise — instead of a green glow around its whole
  block. In the single-company view the glow had nothing to contrast
  against; the overview grid keeps it, where it does distinguish
  companies. The badge anchors to whichever wrapper the existing site
  overlays already built (agent attack, constraints, on-guard), falling
  back to wrapping the site image, so it lands on the outermost
  positioned box regardless of which overlays are present.
- Cards revealed from the opponent's hand are now shown. Palantír of Amon
  Sûl's peek-hand action grew `handRevealedInstances` and the projection
  resolved those instances to their real definition ids, but
  `getOpponentCards()` discarded that and filled the opponent arc with
  card backs unconditionally, so the reveal had nothing to show for
  itself. Unrevealed slots still carry `UNKNOWN_CARD` and render as backs.
- Hand cards whose only play is on-guard are dimmed again. Any card may
  be placed on-guard, so highlighting that branch lit up the whole hand
  and drowned out the cards with a genuine play; the click handler stays,
  so the on-guard menu is still reachable from every card.
- User actions are ignored for a short window after auto-pass fires. The
  pass button is one persistent DOM element rebound on every render, so a
  click already in flight when auto-pass acted could land after the
  re-render and silently send the *next* phase's action too.

### Game Engine

- A unique character that has been eliminated can no longer be replaced by
  the opposing player's own copy. `isUniqueCharacterInPlay()` scanned only
  in-play characters, so once (say) Balin was eliminated into its owner's
  out-of-play pile the other physical copy passed the uniqueness gate. Per
  the glossary's "unique" ruling an eliminated unique permanently occupies
  the "in play and/or removed-from-play" slot; a merely *discarded* copy is
  unaffected and stays replayable by either player. The check now scans
  both out-of-play piles, fixing play-character, organization-phase
  character play and recruit-via-event uniformly.
- Plan-movement can no longer take a two-leader company off a haven. CoE
  3.26 was enforced by move-to-company and merge-companies but never by
  `planMovementActions`, so a company holding two Leaders — legal while at
  a haven — could declare and travel to a non-haven site with both.
- A site converted into a Wizardhaven counts as either alignment for MEWH
  §10. `siteTapCrossAlignmentBlocked()` exempted only sites whose *printed*
  alignment was fallen-wizard, which blocked a Fallen-wizard from playing
  Palantír of Minas Tirith once Chambers in the Royal Court (wh-97) had
  converted the site into Gandalf's Wizardhaven.

### Cards

- **Align Palantír (tw-190)** is stored together with its Palantír, as CRF
  22 requires. `handleStoreItem` removed only the targeted item from its
  bearer, so the permanent event sharing that `character.items` slot
  vanished from game state entirely instead of following the Palantír into
  the marshalling point pile. A new `host-item-stored` on-event trigger
  scans the bearer's remaining items for a companion declaring a self-store
  `move`, mirroring the existing bearer-company-moves self-discard pattern.

### AI / Simulation

- **The long-event phase is scored at all.** `play-long-event` appeared in
  no evaluator anywhere in the repository, so the ranking on a long-event
  decision held exactly one candidate — the baseline's `pass` at zero — and
  both agents had passed the phase unconditionally in every game either has
  ever played. A whole card family was unplayable by construction rather
  than by judgement. The `events` module now owns it, being the same
  question as a short event.
- **Draws are valued.** Nothing in `packages/sim` referenced `draw-cards`,
  `new-hand` or `draw-modifier`; `travel` read a route's draws off the
  site's *printed* `resourceDraws`, so Radagast's and Alatar's extra draws,
  A Short Rest in play and Smaug at Home across the table all priced routes
  as though the cards were not on the table. A new `draw-value` service
  predicts what a company will actually draw, delegating the arithmetic to
  the engine's own `resolveDrawModifier` rather than reimplementing
  "4 − regionCount" a second time. `resourceDrawValue` is pinned to the
  floor a card in hand is worth: it had been 0.35 against the 1.00 `hand`
  charges itself to discard its deadest card, so the model held that two
  cards are worth less than one — cycling always lost to hoarding, and a
  two-draw site contributed 0.35 against the 12.0 of an item already in
  hand.
- **Companies are ordered by what the phase draws, not by what each one
  does.** A movement/hazard phase draws in two places: the moving company
  takes its site's draws, then step 8b tops *both* hands back to hand size
  after every company. Since the total does not depend on the order, only
  the first pick matters — and it should be the company drawing *least*, so
  the free top-up is not wasted. `travel` had that rule backwards. Two
  further rules `drawsAt` contradicted, both found while checking the
  first: a company moving to a **haven** draws from the site of origin (two
  phantom cards a trip on the commonest movement in the game), and a
  company with no avatar and nobody over **mind 3** draws no printed cards
  (CoE 2.IV.v) — the bar zeroes the base only, so A Short Rest still pays a
  company of hobbits.
- **Detainment attacks are played before the creatures that can be
  killed.** Both hazard agents hardcoded the detainment flag to false, so a
  detainment creature was priced as if it wounded and as if losing it
  handed the defender kill MP. `ai/detainment.ts` predicts the flag from the
  hazard seat by calling the engine's own `isDetainmentAttack` (CoE §3.II);
  H2's ordering then falls out of its sequence enumeration, and H1 gets the
  preference as a weight.
- **The hazard plan searches attack orderings** instead of inheriting the
  order it happened to pick cards in, crediting every card for what it adds
  *in that order*. At one reported position Wargs → Lesser Spiders is worth
  17.93 against 17.31 reversed; at another, a near-certain kill correctly
  still leads, because ending the company would leave the follow-up nothing
  to hit. Both are captured as scenarios.
- **A boost that names two races is visible again.** Full of Froth and Rage
  declares its condition as a race *list* and the modifier reader
  understood only a bare string, so a card whose entire text is "all Spider
  and Animal attacks receive +2 prowess" declared nothing: never played,
  never planned around, priced at nothing to keep. The plan now also
  includes support events, applies the board's existing modifiers to its
  own numbers, orders a support first, and reserves the hazard-limit slot
  the event itself spends.
- **The AI client no longer storms a dead server.** Four clients died on a
  4 GB heap in one day. `installReconnect` scheduled a retry from both the
  `close` and the `error` handler and `ws` emits *both* for a refused
  connection, so every failed attempt produced two sockets, then four, then
  eight — ~29,000 retries in a ten-second bucket, and a 512 MB lobby log.
  What set it off is that `npx` runs the client four processes deep and
  forwards no signal, so the game-exit `kill()` reaped the wrapper and left
  the client retrying a server that was gone. Now: one retry per socket,
  exponential backoff to a 30 s ceiling, give up after 15 consecutive
  failures, and spawn the client detached so the launcher can signal the
  whole process group. Adds vitest coverage to text-client, which had none.

### Infrastructure

- `bin/observe` launches a headless observer with one or more agents
  selected, asks the lobby which game is newest, attaches to that game
  server as an observer rather than a seat, and tails the game's log. The
  position comes from the log because the server never ships a full state —
  it projects per player — and the reader handles a live log's two
  properties: the last line may be half written, and `undo` truncates the
  file, so a shrink means re-read rather than append. An observer takes no
  seat, gets no state broadcasts, is absent from the watcher badge, and
  cannot keep an abandoned game alive. The server refuses an agent the
  attached observer does not offer, rather than quietly answering with a
  different one.
- `explainDecision()` renders a position, an agent's pick and its ranked
  candidates as text for every agent in one place — h2 by re-running its
  own module pipeline, everything else by asking it to choose once and
  rendering the weights it publishes. The pipeline assembly moved out of
  the explain CLI and the candidate listing out of the AI client, so the
  CLI, the lobby log and the browser panel cannot drift into explaining
  different things. Everything rendered comes from `projectPlayerView`,
  never from the state, because the text is bound for a browser.

### Documentation

- `specs/2026-08-17-ask-ai-observer.md` — the Ask AI observer design, with
  its open questions resolved: asking never marks a game cheated, the
  honesty model is social (the observer exists only when someone with the
  local master key started it, and its presence is broadcast to both
  sides), spectators may ask with no dev gate, and h2 is the default agent.

## 0.111.0 — 2026-08-17

The tutorial finds its ending, the Elo ledger its audit

### Web Client

- Chapter one of the guided tutorial is now the player's own first turn
  and ends cleanly. `TUTORIAL_STEPS` / `TUTORIAL_BEATS` stop at the
  `eot-1-end` End Turn (34 steps); the Mentor's turns and rounds 2-3 move
  to `LATER_CHAPTER_STEPS` / `LATER_CHAPTER_BEATS`, still replayed by both
  tutorial tests as a continuation so they stay engine-verified until
  released as chapters of their own. Previously a player who reached the
  end of the script had nothing left to click — `gateHumanActions` demoted
  every human action except pass-chain-priority and the panel only swapped
  its label to "Complete!". When the last beat is done the docked
  instruction panel now gives way to a card in the middle of the board:
  what the chapter taught, one line per lesson, and an "Exit Tutorial"
  button wired to `disconnect()`. `TutorialProgress` gained an optional
  `learned` list; the closing line reuses the existing `footer` field, so
  the panel still renders purely from `PlayerView.tutorial`. The lobby
  button drops its "(Not finished yet)" tag.
- A finished tutorial releases the game immediately. Exiting the
  completion card closes the WebSocket, but the session then sat in the
  no-humans grace period for a full minute before the child process
  exited — and the lobby learns a game ended only from that exit — so for
  `IDLE_EXIT_GRACE_MS` the player was still listed "In game". A finished
  tutorial now reports itself idle at once; quitting mid-chapter still
  waits out the grace period, since that player may be reloading. The
  completion card also gets its own heavier backdrop instead of sitting
  behind the continue gate's 55% one.
- The tutorial teaches the additional-minor-item bonus. The
  `site-goldberry` step played Goldberry (tapping the Old Forest) and then
  immediately passed, discarding the CoE rule 2.V.5 bonus that opens right
  there. A new `site-minor-item-bonus` step plays the spare Dagger of
  Westernesse the player's hand already held on Arwen via the bonus.
  Reported by a player via bug-report mail.
- The "Stop Existing Game" button stays pressable. Starting a game called
  `setLobbyPlayButtonsDisabled(true)`, which swept every
  `#lobby-screen .lobby-play-btn` — and `#stop-game-btn` carries that
  class — so after start-game → quit the player saw themselves listed as
  playing with no way to end it. The launch sweep now skips the stop
  button, the per-id reset moves into an exported `resetLobbyButtons()`,
  and rejected actions call it too, so "You are not in a game" no longer
  leaves the button stuck on "Stopping...".

### Game Engine

- The movement/hazard phase can end when its last company dissolves. A
  self-play batch deadlocked at seed 1157: the active player's sole
  character failed a corruption check while the phase sat at
  select-company, dissolving the company and with it every action the step
  could offer. Rule 2.IV.1's skip was applied only at the long-event → M/H
  transition. Pass is now offered at M/H select-company when no unhandled
  company remains, and accepted in the reducer.
- `isCompanyAtSite()` covers a departing company mid-sub-phase. It treated
  a company as en route only once `company.moved` flipped, missing the
  mirror-image window where a company has revealed its new site but not
  finished its own sub-phase (CoE 2.IV.5 / CRF-22 Annotation 25). A
  company at Minas Tirith that had already declared movement elsewhere was
  still offered Choice of Lúthien (dm-120) mid-sub-phase.
- Switching an item back is marked as undoing the switch. A game hit the
  25000-decision limit at seed 4029 with 23000 spent declaring two copies
  of Hauberk of Bright Mail at each other. `handleUseItem` already stored
  the displaced item as the reverse, but `matchesAction` had no `use-item`
  case, so nothing could ever set the documented `regress?: true` field.
  Seed 4029 now finishes in 1987 decisions.

### Cards

- **Icy Touch (td-33)** certified. Adds a `attachCorruptionOnWound`
  modify-attack rider for hazard events played on a company facing an
  attack that then attach to whichever character the attack wounds:
  `CombatState.pendingCorruptionAttach` marks it eligible and
  `finalizeCombat` splices it out of the discard pile onto the first
  eligible wounded character. Documented as DSL section 10e-ter.

### AI / Simulation

- Heuristics 1 plays its argmax instead of sampling its weights. The
  evaluators were written to rank candidates and the agent read their
  output as a distribution, so it chose from outside its own top-weighted
  set on 26.4% of contested decisions. Worth about +47 Elo, pooled
  2230W-1687L-80D over 3997 games across ten paired 400-game blocks, all
  ten favouring argmax. Ties break uniformly from the seeded stream with a
  relative tolerance. Sampling stays reachable as `heuristic:sample`, and
  `export-training` / `fit-winprob` ask for it by name. Note that H1 is
  the default gate champion, so every historical challenger was rated
  against the weaker version.
- The gate verifies its own working tree. Controls had been run in a `git
  worktree` or after a `git checkout` inside a compound command, and when
  the git step failed — it did, because a worktree already held `master` —
  the gate ran anyway and printed a clean-looking result for a tree it had
  never been given. `cli/tree-check` now refuses (rather than warns) if
  the code being run is not the code in this directory or the tree is
  dirty; `--allow-dirty` opts out of the second only. Every gate result
  now carries the branch and SHA it measured.
- The full ledger of what each merged change is worth, re-measured against
  a verified master: acting on ties +244 (claimed +110), favourites draft
  +51 (claimed neutral), haven healing +47 (+33), move-to-influence +26
  (+9), corruption check +20 (neutral), revisit charge +20 (+21),
  mind-priority draft 0 (+17), carried wound −18 (claimed +157, not
  merged), and #2397's tap deduction −75 (−87, reverted). Five of nine
  claims were directionally right, three inverted, one exact. Every H2
  figure from the broken harness — −96, −101, −111, −134, −155, −188,
  −211, −265 — is wrong and the conclusions resting on differences between
  them are unsupported. What survives is everything measured without a
  gate: corpus agreement rates, the `scoring-loop` funnel, `hand-flow`
  arrivals, `route-compare` shapes and the wounded/tapped/untapped splits.
- The heuristic stops burning Cram when it can already move.
- Fine-tuning inherits its parent's decode declaration. Deriving it from
  the training targets is right for a fresh clone and wrong for every RL
  candidate, which would have stamped `argmax` on a lineage cloned from
  human one-hots and gated it at a readout scoring 3.5% instead of 43%.
  `--decode` still forces it; a run without `--init` still derives.
- An opt-in `--hazard-memory` export was added and recorded as not
  helping: `plan-movement` moved from 3.3% to 3.6% against ~5% for
  guessing uniformly, still at chance. Corpus growth to 703 logs agrees —
  the pure policy improved from −83 to −47 Elo while the hybrid built on
  those weights measured −1 against the deployed hybrid's +23.

## 0.110.0 — 2026-08-16

Seven certifications and two corruption miscounts

### Cards

- **Thief (tw-102)** certified. Adds a `combat-strike-effect` DSL effect
  (`strikeEffect: "discard-item"`) for hazard creatures whose successful
  strike replaces the wound with a company item discard, generalizing the
  existing agent-attack precedent (Taladhan dm-25, An Article Missing
  dm-43) to plain creature combat in `initiateCreatureCombat`, reusing the
  shared discard-item resolution path.
- **Army of the Dead (tw-193)** certified. "May not be influenced by an
  opponent" had no engine backing. Adds `FactionCardBase.noOpponentInfluence`
  (a structural field, sibling to `requiredInfluencerName`) and gates all
  three routes by which an opponent could re-influence an in-play faction:
  the CoE 8.3 site-phase loop (`opponentInfluenceActions`), the rule-10.14
  agent-tap-influence branch (`agentInfluenceActions`), and Twisted Tales
  (dm-96)'s bespoke target enumeration.
- **Clear Skies (tw-203)** certified by composing two shipped primitives —
  a `play-condition requires: card-in-play` gate on Gates of Morning (the
  Fog tw-241 shape) and `stat-modifier target: all-characters` for +2
  prowess to every character in play (the Sun Shone Fiercely ba-25 shape).
  No engine work needed.
- **Greed (tw-42)**, **Weariness of the Heart (tw-111)**, **Ghouls
  (tw-38)** and **Barrow-wight (tw-14)** certified as reprints of already
  certified cards (le-113, le-149, le-73 and tw-015 respectively), each
  with its own card test rather than a shared one. All four were pure
  reuse of existing generic mechanics — the item-play-corruption-check
  engine path, the CoE 7.2.1 per-character corruption lock, structural
  race/strike-count fields, and the le-353 Barrow-downs
  `character-wounded-by-self` force-check.

### Card Data

- **Elf-stone (tw-224)** was missing 1 corruption point — `corruptionPoints`
  was 0 where the authoritative database lists 1, so characters carrying it
  had their effective corruption under-counted.
- **Magic Ring of Stealth (tw-274)** showed 0 corruption points instead of
  the printed 2 (matching its siblings tw-271 and tw-273). The bearer's
  effective stat was computed correctly from the field, so the wrong value
  was used silently.

### Documentation

- The deferral hypothesis behind a proposed third fix for the enter-site
  double-count is refuted. Measured over eight games, 87.0% of H2's
  resource plays happen on the turn the company entered, and Heuristics 1's
  figure is 100.0% — it never once played at a site on a later turn. A
  company plays where it arrives, on arrival, or not at all, so displaced
  plays are lost rather than deferred and pricing them as forfeited was
  right. Why two correct fixes each cost about 90 Elo remains unexplained.

## 0.109.0 — 2026-08-15

Movement risk gets a price tag

### AI / Simulation

- Travel now prices a destination's printed automatic attacks. H2 planned
  a company's movement by what a candidate destination's resources were
  worth minus the regions crossed, but never by what walking through the
  door would cost — even though `evaluateEnterSite` already prices exactly
  that once the company arrives, which is one decision too late: the
  regions are already crossed by then. `destinationValue` now charges the
  same automatic-attack harm (`automaticAttacksOf` against the roster via
  `computeDefence`) as part of the travel cost. Fixing this exposed a
  related bug — the arriving site's definition ID was re-derived from the
  action's own shape, which `cancel-movement` does not carry, so
  cancelling priced no automatic-attack risk while planning the same move
  did, breaking cancel's "exact inverse of travelling" invariant. Both now
  take an explicit `arrivingDefinitionId` set by every caller.
- Item transfers and storage are priced for corruption risk. The health
  module scored `transfer-item` and `store-item` at exactly 0 TSD whenever
  no marshalling points changed hands, tying them with `pass` — and the
  tie-break excludes `pass` whenever anything ties with it, so a
  "free" transfer always won. Per CoE 2.II.4.1 / 2.II.5 giving up an item
  unconditionally enqueues a corruption check on the bearer, a real risk
  of losing the character; the AI was shuffling items through
  intermediaries via needless checks instead of transferring once.

### Card Data

- I'll Report You (le-196) is restricted to the organization phase. The
  card text reads "Playable on a leader during the organization phase,"
  but the data was missing the play-condition phase gate that enforces it
  (compare le-210 No More Nonsense, identically restricted and correctly
  encoded), so rule 2.1.1's default "any phase" allowance for
  permanent-event resources let it be offered in the movement/hazard and
  site phases too.

### Web Client

- The hazard hand renderer no longer drops play-creature-from-discard
  actions. Exhalation of Decay (dm-55) and similar discard-pile revival
  cards produce a `play-creature-from-discard` legal action, distinct from
  `play-hazard`; the renderer only looked for the latter, so such cards
  fell through to the bare on-guard fallback and offered only "Place
  on-guard" even when the engine had computed a keyed play against the
  opponent's site path.
- The scoreboard's Replay button is disabled while the game bundle loads.
  Clicking it lazily fetches the bundle before the loading cover appears,
  so until the fetch resolved nothing indicated the click had registered.
  The button re-enables only if starting the replay fails.

### Documentation

- Recorded why the `evaluateEnterSite` tap double-count stays unfixed. It
  prices the cards entering unlocks on the pre-combat tap count, though
  automatic attacks resolve as part of entering (CoE 2.V.ii). It has been
  fixed correctly twice and both fixes were large regressions — −87 and
  −100 Elo. Two independent correct fixes costing ~90 Elo each is a
  measurement, not two mistakes; the likely cause is that displaced plays
  are deferred rather than lost. Nobody should attempt a third fix without
  measuring that assumption first.

## 0.108.0 — 2026-08-15

Five fixes and a reverted regression

### Game Engine

- Ringwraith and Balrog avatars are no longer offered corruption checks
  in the Free Council phase. Per CoE 7.4 / 10.44 a player checks each of
  their *non-Ringwraith, non-Balrog* characters; `freeCouncilActions()`
  now skips characters of race Ringwraith and the Balrog avatar, so a
  company holding one resolves only its checkable members.
- Marvels Told can now target Nazgûl played as permanent-events. Cards
  entering play through a `creature-alt-event` permanent-event mode
  (Uvatha the Horseman, Adúnaphel, …) sit in `cardsInPlay` as
  `hazard-creature`, so the discard-in-play filter's `hazard-event` check
  never saw them, contrary to rule 2.IV.vii.5 and CRF 22.
  `collectDiscardInPlayTargets` now matches such cards against an
  effective definition with `cardType: 'hazard-event'` and
  `eventType: 'permanent'`.

### Web Client

- Starting-company-event cards are playable during the item draft again.
  Orders from Lugbúrz (as-94) and its siblings are offered as a legal
  `place-starting-company-event` action throughout the draft, but the
  hand arc was populated only from unassigned draft items — these cards
  live in the play deck/sideboard, so they never appeared, and had no
  click handler even if they had. The arc now includes them and clicking
  dispatches the action, or opens a target menu for recruitment vehicles
  like Thrall of the Voice that offer one action per character.
- Exiting a replay clears the text-log panel. `#game-log-panel` is a
  `position: fixed` sibling of `#game`, so hiding `#game` left playback
  toasts floating over the page; `exitReplay()` now clears the per-game
  message log the way `disconnect()` already did.

### AI / Simulation

- Reverted the enter-site defender-tap deduction (#2397). The bug it
  fixed is real — a site's automatic attacks resolve as part of entering,
  so a lone defender cannot both parry and tap to play — but the change
  shipped ungated and cost about 87 Elo (35.8% → 25.3% win rate,
  intervals not overlapping), the largest single regression measured on
  this line. The deduction prices out every strike of every automatic
  attack regardless of threat, and H2's site-entry rate fell 56% → 45.7%.
  The sim README records the review lesson: correctness review is not a
  substitute for a gate, including for changes arriving from outside.

## 0.107.0 — 2026-08-15

Every finished game, played back

### Web Client

- The Scores page now links each completed game to a replay that plays it
  back on the ordinary game board. Every recorded line is a full state
  snapshot, so playback re-projects recorded states rather than re-running
  the reducer; a 62MB / 2302-frame log indexes in ~200ms and serves a frame
  in ~2ms, with no parsed state held in memory.
- Replay transport bar: step/jump/play, scrubber, speed, a seat switch that
  flips the board, and Exit. Arrows step, space plays, Escape leaves. The
  viewer borrows spectator mode to suppress the play affordances.
- Replay frames drive the identical render pipeline as live play — board,
  companies, chain, dice, phase meter, toasts — via the extracted
  `renderStateMessage`.
- Recordings older than several engine state fields no longer crash the
  projection on undefined piles. State and player defaults supply the values
  those games implicitly had, taking the local corpus from 152/295 to
  290/295 replayable; what still cannot project is reported as unreplayable
  rather than throwing.

### Game Engine

- New `company.destinationSiteRegionType` play-target filter context field,
  resolved from a company's declared destination site during the
  organization phase — unlike the M/H-only destination path array, it is
  available as soon as plan-movement sets a destination.
- New company-size-keyed grant-ally-play variant: a player-scoped,
  free-standing permanent-event grant (`maxCompanySize` + `allowTappedSite`)
  that lifts the untapped-site requirement for ally plays by any company
  whose effective size (CoE 3.24) is at most the given value.

### Card Data

- **tw-324 Secret Entrance** — certified. Now installs the narrower
  `no-creatures-keyed-to-site` constraint instead of Stealth's broad
  `no-creature-hazards-on-company`, matching the printed text, and
  implements the previously-missing "may not be played on a company moving
  to a site in a Dark-domain" restriction.
- **wh-109 Friend of Secret Things** — certified, adding the company-size
  tapped-site ally grant alongside its stage-points effect.
- **dm-22 Pôn-ora-Pôn** — certified, adding the +3 direct influence against
  Wose factions.

### Documentation

- The new grant-ally-play variant and destination-site region-type context
  field are recorded in the card-effects DSL and certification-support docs.

## 0.106.0 — 2026-08-15

The company goes home to heal

### Game Engine

- Fellowship (tw-240) is discarded when companies auto-merge at a non-haven
  site, as rule 2.IV.6 requires — the auto-merge path never swept the
  membership-changed events the explicit merge action does.
- The item-draft step no longer ends the moment the last unassigned item is
  taken while a starting-company-event card (e.g. Orders from Lugbúrz, as-94)
  could still be played in lieu of a minor item; the player must pass
  explicitly.
- Reforging (tw-314) is certified: its stored ability — discard the stored
  card to retrieve an item — is implemented through three new primitives, a
  `grant-action.fromStored` flag for abilities granted from the marshalling-
  point pile, a `sage-at-haven` tap cost, and a kill-pile fallback for
  `discard: "self"`.
- Treebeard (tw-353) may not be attacked by automatic-attacks or hazards keyed
  to his site, matching Quickbeam's wording; he was missing the play-flag and
  could be assigned as a strike target.
- Vile Fumes (wh-54) carries the "technology" keyword its printed card text
  designates, so Saruman's Machinery recognises it as a Technology item.
- Wormsbane (td-172) has the 2 corruption points the card database lists,
  restoring both the badge and the bearer's corruption-check total.

### Web Client

- Hall of Fire's (dm-134) untap/heal resolution is clickable on the board; the
  engine had always offered it, but the browser had no getter or click handler
  for the action.
- The Forge-master's (wh-117) menu is a two-step picker — item first, then
  recipient — instead of the full item × recipient cross product, which could
  overflow the screen with 28 unscrollable buttons.

### AI

- H2 sends a wounded company home: a haven is priced for the wounds it heals,
  worth +33 Elo, with recoveries up from 0.3 to 1.2 a game and characters
  wounded down from 34.6% to 28.0%.
- Healing is scored as certain rather than potential — a modelling correction
  that moved every proximate metric (going home when wounded 10.5% → 18.2%)
  while measuring strength-neutral, and is recorded as such.
- H2 no longer double-counts a defender's tap when entering a site: automatic
  attacks resolve before any resource can be played, so their strikes are
  deducted from the taps available to price what entering unlocks.
- The hazard bundle planner accounts for a creature's own play-order-dependent
  bonus (e.g. Orc-lieutenant's +4 prowess after a prior Orc attack), applying
  it only at the sequence position where the condition holds.
- The behaviour-cloning policy can delegate the decisions it cannot learn:
  `BcWeightsFile.route` names action types handed to another agent, taking the
  uploaded hybrid from −83 to +23 Elo against the heuristic.
- Heuristics 1, Monte-Carlo and Real-AI are documented alongside H2 under
  `docs/ai/`, each drawn as one decision end to end.

## 0.105.0 — 2026-08-14

The Hunt names its quarry

### Game Engine

- The Hunt (dm-143) is playable end to end. The named creature's identity now
  travels on the choice itself, so a candidate known only from having been
  seen attacking is no longer offered as an indistinguishable "a card"; every
  offered candidate is revealed to the naming player; and defeating the hunted
  creature awards its kill marshalling points.
- Neeker-breekers (tw-493) award kill marshalling points when defeated,
  despite the creature's tap-instead-of-wound effect.
- Sudden Call (le-235) is no longer playable during the site phase without
  meeting its endgame conditions.
- Character-targeting permanent events played in the site phase are held to
  the same site-type and Ringwraith-presence conditions as elsewhere.

### Web Client

- An item's corruption-point badge accounts for a bonus that is conditional on
  its bearer, instead of showing the unconditional value.

### AI

- H2 acts on ties, choosing uniformly among the tied candidates rather than
  taking the first — worth 110 Elo.
- A behaviour-cloning policy trained on recorded human games, read by
  action-type mass rather than by the loudest single candidate, with the
  weights file declaring how its policy should be interpreted.
- A company is charged for travelling back where it has already been, after
  route comparison showed H2 doubling back on its own path.
- Movement probes: no single destination attribute explains the movement gap —
  movement is a trade, and H2 already out-optimises the human on destination
  playability.
- How Heuristics 2 decides is written up with diagrams under `docs/ai/`.

## 0.104.0 — 2026-08-13

The agent stands on its own modules

### Game Engine

- Balrog companies can move to minion sites again. Their location deck mixes
  their own sites with minion ones, but the movement map only indexed sites of
  the player's own alignment, so every such move was negated as illegal.
- Company-bound permanent events (Fellowship and friends) are discarded when
  the character they belong to returns to hand via Call of Home.

### Web Client

- The End-of-Turn reset-hand button no longer borrows the Movement/Hazard
  wording, so the two phases' controls read distinctly.

### Cards

- Dark Quarrels (tw-208) certified.

### AI

- Heuristics 1 is gone from the modular agent. H2 now answers every decision
  with its own modules, and the `h2+<agent>` / `h2><agent>` fallback-compose
  specs are rejected rather than silently reduced.
- Corruption checks are taken instead of declined: a pending check gates every
  other organization action, so passing never avoided the roll — it only
  stalled the phase. Agreement on that decision moved 27.9% → 82.4% at no
  measurable strength cost.
- Freeing direct influence is priced by what it buys on an influence attempt
  rather than scored at a flat zero.

## 0.103.0 — 2026-08-13

Card fixes and a calmer hazard view

### Game Engine

- The Warg-king (le-158) is now playable at a tapped Ruins & Lairs site.
- The Hunt (dm-143) offers creatures revealed by attacking, not only those
  revealed by an explicit reveal effect.
- Followers can be reassigned directly between direct-influence controllers.
- The end-of-turn gold-ring auto-test is scoped to the Ringwraith's or
  Balrog's own company rather than firing across the table.

### Web Client

- The hazard view no longer jumps back to the overview mid-play, and shows
  the remaining hazard limit.
- The currently active company is highlighted with a green glow.
- The dice tray no longer vanishes after toggling the debug view.

### AI

- H2 drafts the expensive characters while the budget is there.

## 0.102.0 — 2026-08-13

Elo ratings on the Scores page

### Web Client

- The Scores page now ranks players by Elo rating, with **Rating** and **Peak**
  columns. Provisional ratings — those resting on fewer than 15 games — are
  marked with `?`, and players whose games predate the ratings sort last.
- Humans and AI seats share one rating pool, so the AI accounts act as fixed
  anchors and human ratings mean something even with few human-vs-human games.
  AI rows stay badged and can be hidden with a "Show AI players" toggle, which
  renumbers the human ladder from 1 rather than leaving gaps.
- Each game on the player detail page now shows the rating swing it caused.

### Game Engine

- Finished games produce a classic Elo rating per player: 1500 seed, K=40 while
  provisional, K=32 once established, draws worth half a point. Both sides'
  expectations come from the pre-game ratings, so the update is simultaneous.
- Ratings are folded in where the completed-game record is written — the only
  point where both player names, the outcome and the engine game id are known
  together. Updates are idempotent in the game id, so the record rewrite that
  follows an undo-then-game-over cannot double-count.
- Ratings are stored per account in `~/.meccg/players/<name>/rating.json`,
  alongside the existing `info.json` and `games.json`.

### Infrastructure

- New `bin/ratings.ts`: lists ratings, and `bin/ratings.ts rebuild` replays
  every completed-game record in the order the games ended to recompute all
  ratings from scratch. It is idempotent, supports `--dry-run`, and drops
  rating files no record backs any more. **A single run is needed on the
  server** to seed ratings from the existing game history; until then the
  Scores page reports no rating and falls back to games-played ordering.

## 0.101.0 — 2026-08-13

Fourteen cards certified, and the character draft stops flipping a coin

### Game Engine

- Balrog of Moria (tw-12) leaves play when its automatic attack is defeated by the company that owns the site. `finalizeCombat` looked for the auto-attack's source card only in the attacking player's `cardsInPlay`, so a permanent-event whose `onDefeat: 'remove-from-play'` fired while its own controller was the defender was never found, and the card sat in play for the rest of the game. Reported via game `msq88z0n-0atxav`, turn 34
- A company that fails its under-deeps movement roll still gets its hazard phase. The failure branch of `handleUnderDeepsRoll` called `advanceAfterCompanyMH` directly, finalizing the company's M/H phase without ever setting a hazard limit or offering `play-hazards`. CoE 2.IV requires all eight steps regardless of whether the company moved, and 2.IV.i.1 is explicit that a failed roll only means the company does not move — the same shape already handled correctly for illegal-movement negation. Reported via game `mspydlds-or5mv6`, turn 9

### Cards

Fourteen cards certified, several of them on new engine primitives:

- **Turning Hope to Despair** (as-41) — `modify-attack postAttackMindRollSplit` + `split-into-own-company`: a per-character post-attack mind roll that splits each failing character into his own company with a separate movement/hazard phase
- **Sacrifice of Form** (tw-321) — a from-hand Wizard-only combat permanent-event that discards the sacrificed Wizard and sets his items aside once the attack ends, with the reverse sweep to restore him if he returns to play
- **Pale Dream-maker** (dm-78) — a corruption check for every card the bearer's controller discards from hand during their own turn, instrumented as a prev/next state diff because hand discards have no single call site
- **Map to Mithril** (td-133) — `tap-at-site` + `reattach-to-item` + `activeWhileAttachedToItem`: a permanent-event that taps permanently at Moria, then moves onto a chosen weapon at a Dwarf-hold to grant its bonus
- **Magic Ring of Courage** (tw-271) — `ResolverContext.bearer.naturalSkills`, a printed-skills-only condition context so a card that grants warrior skill can still ask whether the bearer was *already* a warrior. Also restored the missing `magic-ring` keyword, without which the gold-ring play path could never offer it
- **Wrath of the West** (le-151) — an optional `threshold` on `cancel-chain-entry`
- **Armory** (dm-116), **Ent-draughts** (tw-227), **Ancient Stair** (dm-115), **Dwarven Hoard** (td-109), **Waybread** (td-165), **Magic Ring of Nature** (tw-273), **Plague of Wights** (tw-81), **Into Dark Tunnels** (dm-145)

### Web Client

- The single-company view is released when the focused company's turn ends. The hazard player can click an opponent company to focus it, but nothing reverted that focus once the company's M/H or Site turn was over — leaving a dead view showing stale buttons for a company that had already been passed. Reported via game `msq1wzcy-gwjpmx`, turn 3

### AI / Simulation

- **The character draft is no longer decided by a coin flip.** At 0–0 the tournament scorer's half-total cap (CoE 10.3 step 4) makes every marshalling-point source worth zero, so `card-price` quoted every draft candidate at 0 and the pick fell through to tie-break order. Against 150 attributed picks from the corpus, humans took a deck's favourite 75.3% of the time and chance was 40.6% — H2 managed 11.3%, *anti*-correlated with the plan of the deck it was playing. With favourites priced, that is 98.7%, and 24.0% of picks now match the human's exact card
- `corruption` owns the `support-corruption-check` window instead of leaving it to the Heuristics-1 weight soup — the first coverage gap in this line of work rather than a valuation bug. The rules make it exactly computable: supporting moves the 2d6 target down by one, so the gain is the averted failure and the cost is what tapping that character forgoes. Gated at +3 Elo [−30, +36] over 384 paired games
- **Two metric-chosen valuations reverted.** The five corpus-driven iterations of v0.100.0 were merged before their powered gates finished; the gates then put the combination at −42 Elo [−75, −10]. Gating each change individually cleared the two with a rule behind them (on-guard foreclosure, corruption support) and condemned the two picked because a metric moved — the held-card floor decomposition and the mind-does-not-fit valuation. Those two are undone; the rest stands
- `sitePhaseEvaluator` scores `play-short-event` by target. A Malady Without Healing (le-159) declares `targetScope: any-player`, so the legal-action generator correctly offers every character on both sides — and with no target-aware score they all shared the flat default weight of 1, making the AI as likely to corrupt its own character as an opponent's. Reported via game `msq1wzcy-gwjpmx`, turn 5
- `support-corruption-check` is scored in the movement/hazard evaluator. Unscored, every untapped company mate was worth as much as rolling, so the AI tapped three supporters where one already made the check unfailable — leaving two characters tapped through the site phase for no benefit. Reported via game `msq88z0n-0atxav`, turn 1

### Infrastructure

- CI runs on stacked pull requests. `ci.yml`'s `pull_request` trigger filtered on `branches: [main, master]`, so a PR based on another feature branch never ran a single job — and the failure was silent in the worst way: `gh pr view` reports an empty `statusCheckRollup` while `mergeStateStatus` still says `CLEAN`, which reads as *checks pending* rather than *checks will never run*. Two PRs reached master in v0.100.0 having never been tested once
- The README progress generator's two blind spots are closed, so the metrics `/release` publishes match what the tests and card data actually say

## 0.100.0 — 2026-08-12

Split companies held to the rules, and the agreement metric refuted

### Game Engine

- Rule 2.II.3.6 is enforced in full: companies produced by a split can no longer be rejoined during the same organization phase, and all but one of them must declare movement to a new site. Split lineage is now tracked per organization phase, merge actions exclude pairs tracing back to the same split, and `pass` is withheld while more than one member of a lineage still lacks a destination. Reported via game msp4od96-kfyqdn, where a split at Iron Hill Dwarf-hold left two companies stranded at the origin after an illegal merge

### Cards

- Durin's Axe (tw-212) carries its printed base corruption. The card recorded 0 with a +3 effect for Dwarf bearers, so a non-Dwarf bearer took no corruption from it at all; it is now 2 base with a +1 Dwarf delta, the "2(3)" the card database records and the pattern sibling Dwarven Ring of Durin's Tribe already used
- Records Unread (as-130) gains the 1 corruption point its printed card shows, which had been recorded as 0

### Web Client

- The hand is reachable during Free Council. The phase forces the all-companies overview on so support taps stay available, and the stylesheet hid the hand-arc whenever that mode was set — making CoE 10.3.i's reactive hand plays legal, in hand, and impossible to click
- Regular stored items appear in the Game Over marshalling-point breakdown. Items storable at any Haven without an explicit storable-at effect were dropped from the thumbnail row even though the authoritative total already counted them

### AI / Simulation

- A tie at the top is treated as a tie. `discriminates` compared the best-scored action to the *worst*, so a single bad outlier made the agent claim an opinion it did not have and play whichever tied candidate the sort happened to order first — in practice round-robining two starting items through every character before storing them
- The held-card floor is decomposed into the two jobs it was doing. What a card is worth to hold is a valuation and what throwing one costs is a decision, so `hand` now charges the floor **plus** the modelled worth instead of clamping the valuation. Every discard stays expensive and the cheapest card to throw is again the least valuable one
- On-guard placement is charged what it forecloses: the card comes back at cleanup, but while it sits on a site it cannot be played against a company still to move. Spurious placements fell from 154 to 116
- A character whose mind does not fit the free general influence is valued rather than zeroed — a timing fact, not a valuation, and the third instance of the same present-tense-standing-for-future-probability error
- Stealth's risk is scaled by the same belief `travel` uses, ending two models of one risk. Measuring that belief is the more useful result: it spans 0.15 across the whole corpus, so every consumer scaling by it applies a fixed discount wearing the costume of an estimate

#### The gate, and what it refutes

Five iterations of corpus-driven work raised agreement with recorded human play from 39.74% to 41.41%. Gated against `heuristic` on identical seeds with a paired side-swapped protocol, the same work moved the score from 47.9% to 41.1% and the paired Elo from -14 to -62 — 48 points the wrong way. The intervals overlap, so this is not proof of harm; there is no evidence of gain anywhere in it.

This was foreseeable and had been foreseen: H2 already agreed with humans more often than `heuristic` did while scoring a fraction of the marshalling points. **Agreement is not the objective**, and a rising agreement rate is not a better agent. The tool keeps its value as a localiser — it found the on-guard mispricing that five model changes and two gates had missed, and ruled out four hypotheses — but it is not a fitness function.

The one thing here that gated cleanly is the cycle guard: 0 unfinished games in 96, twice, against 32 of 96 before it existed.

## 0.99.0 — 2026-08-11

Automatic attacks corrected, and the AI measured against the humans who beat it

### Game Engine

- Site automatic-attacks no longer detain minion and balrog companies at shadow-holds and dark-holds. The attack was keyed so that companies of those alignments were treated as arriving at a hostile site, and a detainment attack cannot wound or kill — so an attack that should have been lethal was silently declawed. Keying now follows the company's alignment against the site's, not the site alone
- Goblin-gate's automatic-attack is no longer flagged as detainment, for the same root cause at a site whose own alignment made the mis-keying easy to miss
- Dragon "At Home" automatic-attacks perform the body check they were skipping, so a character defeated by one is resolved through the same path as any other strike rather than surviving unharmed
- Cram's untap-bearer granted action is reachable during the pre-assignment strike window. The action was computed only after strike assignment, which is exactly too late for the window the card exists to serve
- Balrog of Moria is offered for on-guard reveal at site entry; the reveal candidate was never generated, so an on-guard copy sat unplayable for the whole site phase

### Cards

- Arcane School (wh-103) is certified
- Wizard's Ring (tw-363) gains both of its missing rules: the +5 direct influence its card-database entry carries, and the on-play corruption check its printed text requires. The two were fixed on separate branches and both are now on the card — either alone would have left the other half unenforced
- Barrow-blade's corruption point is restored on Dagger of Westernesse

### Web Client

- Clicking Bow of Alatar to redirect a strike now works; the click handler resolved no action at all
- The "can only be played during combat" message no longer appears during live combat, where it was both wrong and actively misleading about why a card was refused

### AI / Simulation

- The plan layer is now live end to end: `resources` proposes, `travel` routes, and plans reach the ranking, with a plan's survival cost priced in. Gated against its own off-switch it wins 60.2% of games but **fails by 2 Elo** — reported as the null result it is, not as a win
- The cycle guard is restored, and doing so **invalidates the gate result it was meant to support** — recorded here rather than quietly re-run
- Site-deck flow diagnosed: H2 sits still, planning a move on 30% of turns against the heuristic's 43%. Three model errors are corrected on their own terms (a spurious penalty on every lateral move, a binary reach step now graded by distance, and a destination model blind to the site's own printed resource draws). None of them closes the gap; the arithmetic keeping the agent home is `regionCrossingCost`, a constant no gate has ever validated
- New `human-compare` replays recorded human games, recovers the move the human actually made by applying each candidate and hashing the result, and asks an agent what it would have done in the identical position. Over 8 games and 2642 attributed decisions, H2 agrees with the human 39.7% of the time against the heuristic's 35.4% — and `pass` is 42% of all human decisions, where agreement falls to 22.6%. The AI acts when humans do nothing
- AI-Heuristic's starting-item bearer choice respects discard and activation gates it was ignoring

### Infrastructure

- The two game-playing H2 core tests are given a budget they can meet. Each plays two full games and had 60 seconds to do it, which the work exceeds on any machine — so master and ten open pull requests were red at once, in whichever Node matrix job lost the race. Raised to five minutes. Worth remembering: vitest's `test(name, fn, timeout)` third argument overrides `--testTimeout`, so the failure reads as a hang no CLI flag can shift

## 0.98.0 — 2026-08-11

Elf-song lifts corruption, and the AI stops pacing in circles

### Game Engine

- The AI no longer loops forever splitting and re-merging a company. When a company splits, the engine records the reverse as `merge(newCompany -> oldCompany)`, but `computeLegalActions` offers both merge directions for any two companies at the same site and `isRegressive` only matched the exact stored direction — so the mirrored `merge(oldCompany -> newCompany)` read as fresh progress instead of the undo it was. A player (or AI) could split, move a character across, merge back via the unflagged direction and split again forever, with the planned destination alternating between two sites so the state never repeated. Reverses for `merge-companies` are now matched as an unordered pair of company IDs. Reported: AI-Modular stuck cycling split → plan-movement → move-to-company → merge in one organization phase (game msog03js-l8uj9s, seq ~765)

### Cards

- Elf-song (tw-223) is certified, adding two reusable DSL primitives. `offer-corruption-removal-at-site` (on self-enters-play) offers every character at a matching site — either player's — that bears a corruption card the one-time option to remove one, via a new `remove-corruption-offer` pending resolution, dispatched from a shared helper called by both `resolveLongEvent` and the generic permanent-event self-enters-play loop. `removal-protection` is a continuous, location-gated variant of the turn-scoped `protect-from-removal`: while the card is in play, a character at a matching site cannot be discarded or returned to hand for any reason. Folded into `isCharacterRemovalProtected`, it reaches every existing removal path (dice-check returns, CoE 3.47 influence overflow, body-check discards) with no per-path wiring, reproducing the CRF-22 ruling that Elf-song "will effectively stop influence attempts against characters"
- River (le-134) offers its ranger tap-to-cancel again. Its site-phase-do-nothing constraint encoded the ability as a `cancelWhen` field, a property no engine code reads, leaving affected companies locked into `pass` for the whole site phase. Its twin tw-84 already encodes the same rule correctly as a `sequence` of two add-constraint effects — the restriction plus a companion granted-action constraint — and le-134 now uses that shape. Reported: Gildor Inglorion, a ranger, could not be tapped to cancel (game msofql34-nfz3ai, seq 600-602)
- The minion printing of The Arkenstone (le-418) now carries the "Hoard item." wording every other hoard-keyword card has; the keyword itself was already correct. (The reported illegal play at Gondmaeglom is not a bug — a permanent Dragon automatic-attack makes a site contain a hoard per CoE glossary g.hoa.1.)

### Web Client

- Storing an item at a haven now asks for confirmation. The click handler fired `store-item` instantly, unlike the sibling self-discard and transfer branches that already gate on an explicit choice — and storing removes the item from play for the rest of the game, so a misclick lost it permanently. Reported: bug e05a8c55854c7e12 (game msofql34-nfz3ai, seq 774)
- The item-discard confirmation names what the discard buys. Clicking a self-discarding item's sole granted action showed a bare "Discard Cram?", ambiguous with more than one such item in play; it now reads "Discard Cram (Untap Bearer)?"
- The toolbar shows "Game X · Turn N · Phase" at all times, so a game can be identified for a bug report without opening the normally hidden debug view. Clicking it copies the text; auto-captured bug reports carry the same turn/phase info

### AI / Simulation

- New `scoring-loop` diagnostic reports the scoring chain as a funnel of offered-versus-taken per action type, separating "never offered" (a break upstream of the module owning the action) from "offered and declined" (a valuation bug, ranked by mean fractional rank). Offers are counted per decision rather than per candidate, and rank is fractional, since branching spans two orders of magnitude. The recorded baseline: `play-hero-resource` offered four times in six games — the acquisition modules are never asked, and heuristic scores 5.0 item MP a game against h2's 0.7
- Plan-layer scaffolding (spec `specs/2026-08-11-h2-plan-layer.md`, steps 0-1), inert: no module implements `proposePlans` yet. `core/plan` is the vocabulary — a plan is a commitment carrying a payoff in marginal TSD (never nominal MP, since CoE 10.3 step 4 caps a source at half the total) and a completion probability composed from existing services. `services/portfolio` is the commitment plus hysteresis: a committed plan is never dropped for being marginally out-ranked, which is what keeps the plan layer from reproducing h2's shape-change/undo alternation one level up. Both aggregation rules — bounded additive TSD (default) and rank-based voting — ship behind a constant, to be settled by the gate

## 0.97.0 — 2026-08-11

Excess strikes counted right, and the wounded finally heal

### Game Engine

- Assassin, Slayer and Nameless Thing no longer double their strikes under a global strikes boost. Rank upon Rank (dm-80) grants +1 strikes to Assassin (a Man creature), which inflated `strikesPerAttack` from 1 to 2 and multiplied the creature to 6 real strikes across its 3 attacks. Per CRF 22, "If an attack from Assassin is given more than one strike, each additional strike becomes an excess strike (-1 prowess modification) against the attacked character" — so for multi-attack "all strikes go to one target" creatures the totals now use the creature's *printed* strikes, and any boost overflow is tracked as the new `CombatState.excessStrikesPerAttack` and applied as `StrikeAssignment.excessStrikes` on each attack's single assignment
- Wounded allies heal at havens during the untap phase. The healing sweep in `performUntap()` only healed wounded (inverted) top-level characters (CoE 2.12/415); the ally branch of the untap mapping handled only tapped→untapped, leaving a wounded ally inverted forever no matter how long its company rested. CoE 2.V.2.2 treats allies as characters for healing purposes. Reported by Gamling: Gollum was wounded fighting a hazard creature and never healed across a full turn at The White Towers
- A follower is no longer discarded when its controller is removed by the CoE 3.47 end-of-organization overflow resolution. `freeOrDiscardFollowers()` checked whether the follower's mind fit under the current general-influence pool and discarded it outright if not, but CoE 2.II.2.2.3 defers the mind subtraction to the player's next organization phase regardless of GI room — the pattern already used in `combat-finalize.ts`, `combat-hazard-play.ts`, `combat-actions.ts`, `combat-strike.ts` and `reducer-organization.ts`. Reported: Balin (leader, mind 5) took his follower Bofur down with him instead of reverting Bofur to general influence
- Forewarned Is Forearmed no longer suppresses the attacks of the player who put it into play. `isReduceAttacksToOneInPlay()` scanned every player's `cardsInPlay`, so a hazard player holding their own copy (protecting their own companies elsewhere) had it reduce the multi-attack creatures and site auto-attacks *they* were playing against the opponent. The card is a defensive resource event; the check is now scoped to the defending player at both call sites
- Duplicate reveal (CoE 10.3.v) now sees unique characters, and the items and allies attached to them. `computeFinalScores` scanned only each player's `cardsInPlay`, but characters live in a separate `characters` dict — so a unique character like Gimli in play was invisible to the check, and an opponent holding a duplicate never took the -1

### Cards

- The Hunt (dm-143) is certified, implementing the new `named-creature-hunt` effect: the controller names a hazard creature the opponent has already revealed (`GameState.handRevealedInstances`) that still sits in their play deck or discard pile, forcing it to attack the bearer as a one-character company. Adds a `hunt-attack` attack source and `engine/hunt.ts` (candidate discovery, combat build, deck reshuffle on a play-deck find, post-attack tap), plus a `CombatState.spellsIneffective` flag enforced centrally — `cancelAttackActions` drops spell-keyword cancel options and the resolver skips spell-sourced creature-attack boosts. Reuses the `soloDefenderInstanceId` primitive proven by Burglary (td-103)
- Alert the Folk (td-97) is certified, extending `company-combat-boost` with two new fields: `when`, gating which attack the card may be played against (here, a Dragon or Drake attack that is not Eärcaraxë), and `costDiscard`, which computes the boost from cards the controller chooses to discard — the sum of the printed marshalling points of one or two factions playable in the four named regions. A new `costDiscardInstanceIds` on `PlayShortEventAction` carries the chosen cost cards
- Dragon-lore (td-108) is certified: play targeting taps an untapped sage and an untapped site with Information playable, and a new grant-action (cost: tap bearer + discard self), gated on `site.hasDragonAutoAttack` and `site.isTapped`, searches the play deck and discard pile for an item playable at the Dragon's lair. A new `unlockTappedSitePlay` flag on `enqueue-pending-fetch`/`fetch-to-deck` lets the fetched item be played at the already-tapped site, tracked by `SitePhaseState.tappedSiteItemUnlock` — the item-keyed sibling of Burglary's character-keyed `burglaryItemUnlock`
- Arrows Shorn of Ebony (td-99) is certified, extending the item `modify-attack` "current-strike" scope (previously tap-only and prowess-only, from Shield of Iron-bound Ash tw-327) with `cost: { discard: "self" }`, a per-strike `strikeCreatureBodyModifier` affecting only the one creature body check that strike triggers, and `cascadeDefeatOnSuccess` — once a strike carrying it is confirmed defeated, every other unresolved strike of the same attack auto-defeats via `CombatState.forcedStrikeDefeat` set mid-combat (previously only set at combat initiation, by Liquid Fire wh-52)
- Galva (tw-154) is certified: +2 direct influence against Men of Dorwinion, +6 prowess against Nazgûl and Ringwraiths, and enemy body halved (rounded up) against them. Reuses the `stat-modifier`/`enemy-modifier` pattern already certified on Peath (tw-176), Vôteli (tw-185) and Vygavril (tw-186) — no new engine support

### Web Client

- The combat situation banner says which card isolated a multi-attack. Gamling's Assassin reduced to a single uncancelable attack by an opponent's Forewarned Is Forearmed read exactly like a normal single-strike attack, and the card itself is invisible during combat because `renderCombatView` replaces the board entirely. The banner now carries an "(Isolated by \<name\> — cannot be canceled)" marker, following the existing Detainment marker

## 0.96.0 — 2026-08-10

Cards find their play windows, and every button names its target

### Cards

- Hidden Haven (wh-75) is playable during any phase, not just the site phase. Its card text carries no timing clause ("Playable on a non-Dragon's lair Ruins & Lairs…"), so rule 2.1.1 puts it in the same "any phase" family as Return of the King, Fireworks and Hall of Fire — but the site-play-target branch had no bucket matching its bare `wizardhaven-conversion` shape, so it fell through to the generic fallback that restricts site-targeting permanent events to the site phase. Reported from a Fallen-wizard company that had stayed at an eligible Ruins & Lairs into its organization phase
- Thrall of the Voice (wh-82) and Open to the Summons (wh-46) can no longer be played as bare permanent events. Both are recruitment vehicles — "Instead of a normal character… you may bring into play one character… Place this card with the character" — and the engine already models that as a `play-character` carrying `viaRecruitmentInstanceId`, but nothing stopped the generic standalone-permanent-event path from also offering them. Playing one that way put it into play unattached and spent the card for nothing. `recruitment-vehicle` now joins `play-with-stored-card` and `convert-creature-to-ally` in that path's exclusion list
- Jewel of Beleriand (as-70) is certified: a hoard item with a tap-and-roll ability that untaps its bearer on a result greater than 6, and a per-character duplication limit. Both clauses reuse existing primitives — the `roll-then-apply` grant dispatcher proven by The Ring Leaves Its Mark (le-223) and Magical Harp (td-130), and the `duplication-limit` scope from Horn of Anor (tw-259)
- Black-hide Shield (le-300) is certified after gaining the `stat-modifier` its text calls for: +1 body capped at 9, the same primitive and cap that Shield of Iron-bound Ash (tw-327) and Adamant Helmet (td-96) already use for an identical clause

### Web Client

- The Forge-master (wh-117) labels each of its organization-phase forge entries with the item and the recipient. The engine emits one action per (item, recipient) pair, but the menu builder only disambiguated same-`actionId` entries by the *acting* character — and for Forge-master every entry shares one actor, so the menu rendered a row of identical "Forge-Place-Item" buttons with no way to tell what any of them would do. Log and text-client action descriptions gained the same disambiguation
- A Strident Spawn (wh-61) can be activated from the board. Its "take one Half-orc character from your discard pile to your hand" ability was offered by the engine as a legal action, but the cards-in-play row had no click handler for `activate-org-fetch` at all — every sibling in-play activation had one — so the permanent rendered as an unclickable image and the ability was reachable only from the debug panel. `ActivateOrgFetchAction` is now re-exported from `@meccg/shared` as well
- The debug state dump shows the game ID. `PlayerView` had no `gameId` field, so the ID reached the browser only through the separate `assigned` WS message and never appeared in the shared text formatter — making it awkward to copy an ID for a bug report while working from the dump

## 0.95.0 — 2026-08-10

Ringwraiths ride alone, and the deeps attack in order

### Cards

- Angmarim (as-58) is certified: playable at Carn Dûm, influence check greater than 11, with the Standard Modifications (Wizards -5, Men +1). Its "(Muster has no effect on this attempt)" clause needed a new `block-influence-boost` DSL effect — a self-restriction living on the faction card itself, distinct from the region-scoped `faction-influence-restriction` environment that Mordor in Arms (dm-72) puts into play
- Noldo-lantern (dm-175) is certified: playable at any Under-deeps site, +2 to the bearer's under-deeps movement roll, and a tap ability giving -2 prowess and -1 strike (minimum one) to Undead, Nazgûl, Orc or Troll attacks on the bearer's company. It extends the Dwarven Light-stone (dm-168) pattern by combining the already-independent prowess and strike modifiers on a single `modify-attack`
- Dunlendings (tw-211) and Hillmen (tw-257) are certified, both porting the established faction pattern proven by Rangers of the North (tw-311) and Lossoth (tw-268): a home site, an influence number, and race-gated check modifiers
- Burglary (td-103) is no longer offered as a plain short-event after its declare-burglary window has closed. Its only effect resolves through the dedicated `declare-burglary` action during the site phase's automatic-attacks step, but the generic resource short-event enumerators didn't know that and kept offering it — so playing it later (e.g. during a combat's pre-assignment window) discarded the card for zero effect and the company still had to face the attack
- Fireworks (dm-130) offers every eligible untapped sage as a target instead of silently picking the first. The "any phase" fast path used a `find` rather than enumerating candidates, so a company with three untapped sages produced exactly one legal action
- World Gnawed by the Nameless (as-110) is no longer playable during the Organization phase. It grants an extra movement/hazard phase, and cards of that kind have their real play window enforced separately during the M/H phase — but the Organization-phase short-event enumerator was missing the exclusion its Long-event-phase sibling already had, so the card fell through to a no-op play. Forced March (le-185), Bridge (tw-202) and Leg It Double Quick (le-202) were exposed the same way

### Game Engine

- Automatic-attacks at Under-deeps sites resolve in the order printed on the site card. Sites carrying both a printed attack and a "(2nd) Opponent may play … from his hand" dynamic attack — The Under-leas, The Iron-deeps, The Gem-deeps, The Under-vaults and a dozen more across the DM/AS/BA printings — routed straight to the hand-played attack and never came back to it afterwards, so the dynamic attack was reachable only *before* the printed one. Sites with only a dynamic attack, such as Framsburg (td-175), are unaffected
- A company containing a Ringwraith and non-Ringwraith characters may not move at all, including haven-to-haven starter movement. Such a company is legal only *at* a Darkhaven (rule 3.07), and per a Council of Elrond rules ruling it is "at" neither endpoint while travelling. The engine enforced the composition rule on Organization-phase joins and on the end-of-phase forced combine, but never when an already-legal company actually set out
- The `cancel-attacks` site rule (Dol Guldur, Minas Morgul, Carn Dûm, The White Towers, Moria, The Under-gates) no longer blocks hazard plays against a company that is merely *moving toward* such a site. Per rule 2.IV.5 a company is "at" neither its origin nor its destination from the moment its new site is revealed until its site phase, and each of these sites only cancels attacks against a company "at this site" — so a company travelling between two of them was wrongly immune to every hazard for the whole trip
- Corruption checks forced at the end of the untap phase — Lure of the Senses (tw-60/le-124) and every other card using the `on-event: untap-phase-end` → `force-check: corruption` pattern — now allow tapping company-mates in support (rule 7.1.1). Every other corruption-check enqueue site in the engine already passed the flag; this one omitted it, so the check could not be supported at all
- The Under-deeps extra-item allowance (rule 2.V.5.1, "any one additional item that is playable at the site") accepts items that qualify through their own `item-play-site` restriction rather than through a subtype the site's card text lists. Dwarven Light-stone (dm-168) and Aiglos (dm-166) are playable at any Under-deeps site by their own text, but the bonus check tested only the printed `playableResources` list and rejected them with "site is already tapped"

### Web Client

- Site-bound permanent events show which site they belong to once their company has moved on. Cards like No Strangers at this Time (as-51) render beneath their bound site while a company stands there, but fall into the flat cards-in-play row with no context afterwards; they now carry a site-name badge, and the hover preview gains a "Bound to" line
- A "Stop Existing Game" button in the lobby kills a player's own lingering game server on demand. Previously a crashed tab or dropped connection left every "Play vs X" action rejected with "You are already in a game" until the 60-second idle-exit grace period expired, with nothing to click

### AI

- The heuristic AI no longer plays Dodge (tw-209) on an already-tapped character. Dodge's only benefit is that the character does not tap against a strike, which is worthless once it is tapped — leaving only the -1 body penalty on any resulting body check. The evaluator zeroed the score for already-*wounded* characters but had no equivalent check for tapped ones

## 0.94.0 — 2026-08-10

Seven field reports, seven fixes

### Cards

- Lossadan Cairn (tw-409) accepts greater Palantíri again. Both its playable-resource list and its `deny-item` site rule gated on item subtype `special` instead of `greater`, so Palantír of Amon Sûl (tw-296) was rejected outright while unrelated `special`-subtype items slipped through. The LE printing of the same site (le-388) already had the correct gate
- Minion Haradrim (as-63) and minion Wain-easterlings (as-66) now render with their own artwork instead of the hero printings' (as-59/as-60). Both pointed at the hero image filenames; the remaster repo serves the minion printings as `Haradrim2.jpg` and `Waineasterlings2.jpg`, matching the `2`-suffix convention already used by the Angmarim and Petty-dwarves hero/minion pairs in the same set

### Game Engine

- Characters whose homesite reads "Any Dark-hold" — such as Ill-favoured Fellow (wh-5) — can now be played at printed Dark-hold sites like Barad-dûr (le-352). The homesite matcher deliberately excluded Dark-hold on the assumption it was already covered by the Darkhaven path, but Darkhaven is a distinct concept (a minion *haven*), so any Dark-hold site that isn't also a haven was never offered. The Balrog-specific remap of "Any Dark-hold" to non-Dark-hold Under-deeps sites (rule 2.II.2.2.B1) still takes precedence

### Web Client

- Corpse-candle (tw-23/le-67) pre-defense corruption checks stay usable. Because combat enters `assign-strikes` before those per-character checks resolve, the client switched to the combat arena — which has no rendering for corruption checks — hiding the banner naming whose roll was pending, the tap-in-support buttons (CoE 7.1.1), and reactive plays like A Friend or Three. The company view now stays up until the pending checks resolve
- Region icons in the opponent-turn movement path readout are read from each region's own card rather than by zipping the region-name list against the site-path leg list. For starter haven-to-haven movement those two arrays are not index-parallel, so Anfalas (wilderness) was drawn with a border-land icon purely by array position

### AI

- The heuristic AI plays Ready to His Will (le-220). `convert-creature-to-ally` was missing from the combat action routing set, so it fell through to evaluators that never scored it and took the flat default weight of 1 — well under `assign-strike` — meaning the AI always fought an eligible creature instead of converting it into an ally

## 0.93.0 — 2026-08-09

Shelob stirs, and the Palantír looks upon the enemy's hand

### Cards

- Shelob (tw-86) is certified: keyed as a creature to any site in Imlad Morgul or Gorgoroth, playable as a permanent-event while Doors of Night is in play, and — new — able to convert from that permanent-event state into a full creature attack that still receives her own +1 prowess/+1 strikes bonus against Spiders and Animals
- Palantír of Amon Sûl (tw-296) is certified in full, not just its discard-on-move clause: 5 marshalling points when stored in a Haven, tap to look at your opponent's entire hand, and tap to borrow the abilities of Palantír of Annúminas or Palantír of Elostirion while either is in play (search for a "Sage only" card; remove a corruption card from an Elf or Wizard)
- Fair Sailing (tw-232) is certified: played at the end of the organization phase on a moving company, it lowers that company's hazard limit by one per Coastal Sea region in its site path, floored at two. The mechanic generalizes to its Fair Travels siblings (tw-233/235/237)
- Carambor (le-5) is certified: may tap at the end of his company's movement/hazard phase to move to one additional site, restricted to destinations whose site path contains at least one Wilderness
- Clouds (tw-22) is certified: +2 prowess to each hazard creature while Doors of Night is in play — and, unlike Sun (tw-335), correctly leaves site automatic-attacks and agent attacks alone
- Morgul-rats (td-49) is certified: 15-strike Animal keyed to Shadow-holds and Dark-holds, playable only if a character in the target company is wounded or Doors of Night is in play
- Awaken Denizens (le-104), Wake of War (le-148), Haradrim (as-59) and Lossoth (tw-268) are certified, porting mechanics already proven by their sibling printings
- A Strident Spawn (wh-61) and Saruman's Machinery (wh-120) are worth 1 marshalling point each, not 0 — both were stale data entries contradicting the card faces and the card database

### Game Engine

- The Great Hunt (wh-91) keeps **every** face-up discard visible, not just the top card of the pile. A card discarded face-up no longer becomes obscured again as soon as another card lands on top of it (Pallando's genuinely top-card-only ruling is unchanged)
- Skills granted by items are now visible to other borne items' stat modifiers: Saruman bearing both Swordmaster (granting Warrior) and Mechanical Bow (+2 prowess to Warriors) gets the bonus, where the granted skill was previously invisible to effective-stat resolution

### AI

- The heuristic AI scores region-movement paths by border-land exposure instead of picking uniformly among equal-length options, so it no longer declares a gratuitous border-land detour when an all-wilderness route of the same length exists
- Challenge decks (D) Bargain between Friends and (M) It's magic! are approved as AI opponent decks

### Infrastructure

- Fixed flaky CI timeouts in the full-game feature tests, the simulator and h2 agent tests, and the cycle-guard replay test

## 0.92.0 — 2026-08-09

Hounds guard their masters, and the Hunt strikes true

### Cards

- Grey Embassy (wh-100) is playable while Gandalf is not yet in play — the card required a Gandalf target to be played at all, contradicting its own "if he is in play" wording and CoE 5.F1 (same fix already applied to its sibling, Give Welcome to the Unexpected)
- Mistress Lobelia (dm-178) may tap to fetch an item, ally, or faction during any phase, not just the organization phase — her text carries no phase restriction (CoE 9.1.3 / 2.1.1)
- Noble Hound (dm-179) must be assigned a strike before its controlling character even when the *attacker* assigns strikes (automatic-attacks and Step 3 of strike assignment) — its "in all cases" wording takes precedence regardless of who is assigning (CoE 3.ii.3)
- The Great Hunt (wh-91) now counts "each character faces one strike" creatures correctly: a revealed Watcher in the Water faces the whole company, instead of striking only as many times as its printed strike value

### Game Engine

- Becoming a follower checks the character's *effective* mind rather than its printed mind, so a hazard-boosted character (e.g. Kíli under So You've Come Back) can no longer be recruited past the controller's direct influence

### Web Client

- Granted-action responses such as Tom Bombadil's tap-to-cancel are surfaced as buttons in the chain-of-effects panel, next to "Pass Priority" — the panel previously covered the board thumbnails that were the only way to activate them

### AI

- The heuristic AI no longer picks corruption-hazard-event targets at random: it scores candidates by existing corruption and carried value, so *Alone and Unadvised* lands on the corruptible key character rather than a throwaway follower

## 0.91.0 — 2026-08-09

The Great Hunt reveals, and destinations stay secret

### Cards

- The Great Hunt (wh-91) reveals the opponent's discards face-up, as its text requires — the passive reveal was missing, leaving the discard pile fully hidden
- Hidden Haven (wh-75) and other site-type overrides allow storing items: store-item now checks the site's effective type instead of its printed type

### Game Engine

- Plan-movement no longer leaks the identity of a destination site that had been public earlier in the game (e.g. a Wizardhaven that cycled back into the location deck) — the destination stays secret until revealed in the Movement/Hazard phase
- Plan-movement no longer drops an in-play sibling's site when a same-named site remains in the deck: site candidates are keyed by definition id rather than display name, so two printings sharing a name (hero and Wizardhaven "The White Towers") no longer clobber each other

### Web Client

- The attacking creature's card image is shown for creatures revealed and attacking via The Great Hunt, so the defender can see and target it

## 0.90.0 — 2026-08-08

Technology items, stored marshalling points, and clickable allies

### Cards

- Mechanical Bow (wh-53) is recognized as a technology item — the `technology` keyword is now spelled lowercase everywhere, matching the rest of the keyword vocabulary
- Man of Skill (wh-119) applies its marshalling-point override to permanent-events that have already been stored, not just those still in play
- Huntsman's Garb (wh-92) and similar fetch effects are offered during the end-of-turn signal-end, not skipped
- Crown of Flowers (dm-164) no longer offers site-restricted resource events when no company sits at a qualifying site
- Rebel-talk (le-132) defers its company restructuring to the owner's organization phase instead of applying it immediately
- Control-restriction costs pick the lowest-cost attached card instead of whichever was attached first (wh-84)

### Web Client

- In-play allies (e.g. Tom Bombadil) are clickable for the actions they grant
- The Lure of Nature corruption check no longer leaves the all-companies overview stuck
- Character lines show effective mind rather than printed mind

### AI

- The heuristic AI no longer plays Dodge on an already-wounded character

## 0.89.0 — 2026-08-08

Alatar's haven-join hardened and Earth-eater certified

### Cards

- Certified Earth-eater (wh-67)
- Man of Skill (wh-119) no longer misses character-borne permanent-events when applying its override
- Give Welcome to the Unexpected (wh-99) is playable before Gandalf enters play
- Guarded Haven (wh-74) gained its missing printed misc marshalling point
- Covetous Thoughts (le-107) end-of-turn corruption checks offer the tap-in-support option

### Game Engine

- Alatar's haven-join is permanent: he stays in the company he joined instead of being returned to the haven once combat ends
- Haven-join effects no longer trigger for a company that completed its own move this movement/hazard phase (CRF 22, Movement/Hazard Annotation 25)
- Alatar's forced strike is honoured when the attacker chooses defenders (Assassin)
- An attack can no longer be canceled out from under a pending forced strike
- Detainment strikes no longer heal already-wounded characters

### Web Client

- The combat view no longer reports tied, survived, canceled, or absorbed strikes as eliminations

### AI

- The heuristic AI discounts plan-movement for tapped characters that would walk into a fresh site attack

## 0.88.0 — 2026-08-07

Prisoner spells, Wild Horses, and company-view polish

### Cards

- Certified Spells of the Barrow-wights (dm-90): prisoners discard their rings on capture, and a recurring untap-phase body check can eliminate an unrescued prisoner
- Certified Wild Horses (wh-39): home-site-region standard modification (+3 for Men of the horse lands) and tap-to-grant a company +1 region of movement

### Game Engine

- Fallen-wizard Stage cards are no longer swept by the CoE 2.2.F1 elimination gate before the avatar is even played (Saruman's Machinery)
- Call of Home excludes Fallen-wizard avatars per CoE glossary g.wiz.F1
- Army of the Dead is playable after Paths of the Dead the same turn
- Hall of Fire is offered during the organization phase; Promptings of Wisdom (wh-34) no longer is outside it
- Wizard's Ring is playable at a Haven
- Site-scope duplication limits count copies already declared in the current chain
- Free Council corruption checks include company-size DSL modifiers
- William/Bert/Tom item discard no longer sweeps up attached permanent events
- Regiment of Black Crows gained its missing mind field, unblocking the An Untimely Brood grant
- A stale, never-started save is discarded instead of resurrecting the wrong decks
- Legal-action text distinguishes between play-option choices

### Web Client

- Opponent companies can be focused from the all-companies overview
- The all-companies overview is restored after combat ends mid-opponent-turn
- Merge-companies is reachable from the focused single-company view
- Hand-card clicks use the live focused-company site after board navigation
- The hand-arc catch zone no longer blocks combat-arena clicks

### AI

- Heuristic AI no longer overweights hazard creatures with multiple keying variants

### Infrastructure

- CI actions bumped (checkout and setup-node v4 → v7), fixing the Node.js 20 deprecation warning
- Deck S uses hero-site printings instead of minion-site cards

## 0.87.0 — 2026-08-06

Corruption-check support and Fallen-wizard targeting fixes

### Game Engine

- Company mates can tap in support of discard-in-play corruption checks (Marvels Told, CoE 7.1.1) and end-of-movement corruption checks (Lure of Nature)
- Resource short-events like A Friend or Three resolve properly during Free Council corruption checks instead of being discarded unresolved
- Fallen-wizard avatars are no longer targetable by hazards that filter for Wizards only; the `$in` condition operator now matches array-valued context (and Fool's Bane works again)
- Fireworks (dm-130) is playable during any phase, not just the site phase
- Site-restricted permanent events are playable before a moved company reaches its site phase
- Hazard timing window respected for companies moving while at a site
- Site-lock cards keep sibling permanent events alive instead of sweeping them as orphans

### Web Client

- Company navigation arrows show again when focused on your own company during the opponent's turn

## 0.86.0 — 2026-08-06

Fixes

### Cards

- Certified News of Doom (le-127) and In the Heart of his Realm (dm-67)

### Game Engine

- Gandalf's untap-self granted action is no longer blocked while a sideboard access is being resolved
- Corruption-card removal actions remain available during the sideboard fetch sub-flow
- Forced March's extra move now respects the Ringwraith Darkhaven/mode movement gate
- Wake of War and Voices of Malice can be discarded to boost strikes before strike assignment
- A drafted Stage resource set aside to hand at draft finalization keeps contributing its stage points until played

### Web Client

- Neeker-breekers' "need" display shows mind instead of prowess
- Character-action tooltip menus are clamped into the viewport
- The "Remove <character>" button no longer lingers after an influence-overflow discard

## 0.85.0 — 2026-08-05

Fixes

### Cards

- Barrow-blade (dm-119) regained its missing item marshalling points
- Girdle of Radagast (wh-110) regained its missing marshalling point
- Lesser Ring (tw-266) regained its missing corruption point
- Promptings of Wisdom (wh-34) now yields its corruption points
- Dwarven Light-stone is playable at Deep Mines again

### Game Engine

- Failed faction influence attempts no longer tap the site
- Company mates can again tap in support of on-play corruption checks (Andúril)
- Untap-on-play events no longer clear a character's wounded status
- Special-subtype items (e.g. Palantíri) can be stored at Havens again
- Align Palantír is no longer salvageable when its bearer is eliminated
- A tapped site no longer reverts to untapped when handed off mid-turn to an inbound sibling company
- Ringwraith companies can no longer plan or declare Region Movement
- Fell Rider and Black Rider are restricted to the organization phase (both the Ringwraith-company timing and the early site-phase steps)
- Fellowship (tw-240) is no longer playable outside the organization phase
- Dwar the Ringwraith's tap ability is no longer restricted to the organization phase
- Bade to Rule is playable before the movement/hazard company selection
- A Chance Meeting no longer discards with no effect during end-of-turn
- Records Unread's untap-site option is offered during the site phase
- A surplus Thrall of the Voice is no longer force-attached to a character that did not need its gate — it stays in hand as a recruitment vehicle
- A Fallen-wizard is no longer auto-stopped mid-draft with Stage resources stranded in the pool
- An unassigned mandatory Stage resource is no longer discarded when passing during the item draft
- The initial hand draw no longer overwrites Stage resources deferred to hand during draft finalization
- The opponent's hand view no longer leaks card identity after an influence-overflow return

### Web Client

- The combat view is no longer hidden behind the opponent-turn overview during hazard strikes
- A confirmation is asked before an item's self-discarding granted action fires
- Inactive companies are dimmed during the Free Council too
- The merge-companies targeting mode no longer switches to the all-companies view
- The arrange-deck-top pile browser stays open across picks

## 0.84.0 — 2026-08-05

Fixes

### Cards

- Certified Govern the Storms (wh-45), Sojourn in Shadows (wh-49) and Crept Along Carefully (ba-29)
- An Untimely Brood (wh-62) regained its missing marshalling point
- Blasting Fire (wh-51) regained its missing corruption points

### Game Engine

- Site-type overrides (Rebuild the Town) now replace the site's type for hazard creature keying instead of stacking additively, and keying resolution trusts the moving company's captured site type
- Fell Rider and Black Rider are again restricted to the Ringwraith's own company
- Creatures with mixed-type keying boxes (Rain-drake style) no longer offer a spurious region-type keying option
- Detainment is no longer falsely applied when a creature keys to Ruins & Lairs via a non-dark alternative
- Crown of Flowers no longer lets site-restricted allies and factions bypass their playable-at requirements
- Incite Defenders' duplicate attack keeps the each-character-faces-one-strike rule
- Combat-only short-events (Flatter a Foe) are no longer offered outside combat
- The Fellowship is discarded when its bearer's company loses a character in combat
- A Ringwraith mode card can no longer let the company hop between non-Darkhaven sites indefinitely
- Company-versus-company combat no longer loops forever when a strike is survived
- Bounty of the Hoard is no longer playable at non-hoard sites
- Return of the King is playable with correct any-phase timing instead of only during the site phase
- Permanent events are accepted during the site-phase select-company and enter-or-skip steps

### Web Client

- Clicks on opponent-company characters targeted by hazards are no longer ignored (both overview and grid view)
- A character is no longer rendered in two companies at once after a company split (Seized by Terror)
- Forced March's extra-move offer now shows clickable destination buttons
- The Fetch from Sideboard modal regained its hover card preview
- Non-active companies are dimmed again during the Site phase

### AI

- The heuristic AI no longer discards its own hazard-events with Marvels Told

### Infrastructure

- The replay round-trip CI test now gets the same timeout budget as other game-playing tests

## 0.83.0 — 2026-08-04

Rules bug-fix sweep and heuristic AI discipline

### Cards

- Certified Great Secrets Buried There (dm-63)

### Game Engine

- Bade to Rule (le-167) gained its alternative untargeted play mode and is playable with no Ringwraith in play
- Sudden Call (both resource and hazard versions) no longer ends the turn immediately
- Ready to His Will is no longer offered as a free site-phase play
- Return of the King can be played before entering the site
- Army of the Dead (tw-193) only lets Aragorn II influence the faction
- Covetous Thoughts no longer counts Stage resources as items
- Black Arrow no longer blocks real weapons from applying their prowess bonus
- Strike rerolls (Swift Strokes) no longer always tap the defender
- Fireworks' skip-next-untap can no longer be bypassed by non-phase untap effects, and the constraint no longer leaks to the other player
- Home-site-only characters can no longer be recruited elsewhere via A Chance Meeting, and comma-separated home-site lists now match correctly
- A character can now be played under general influence past the GI limit, resolving the overflow afterwards
- Character-targeted Stage resources drafted at setup now defer their placement to player choice
- No Strangers at this Time (as-51) keeps its faction-played condition across site-phase visits
- Minion-side Dragon-lair sites regained their missing hoard keyword
- Deck-exhaustion discards are no longer stranded outside the reshuffled play deck
- Agent hazards no longer disappear from their owner's board on the opponent's turn
- Saruman's spell-fetch granted action no longer leaks into the organization phase
- The cancel-by-tap window reopens between a multi-attack creature's strikes
- Ahunt-attack long-events now trigger immediately when played mid-movement
- The Secret Book untaps its site correctly during the site phase, and deck imports no longer mix up hero/minion faction versions

### AI

- The heuristic AI no longer discards the opponent's corruption cards for free
- The heuristic AI never voluntarily discards its own characters during organization
- On-guard placement is no longer over-weighted by per-card weight duplication
- The heuristic AI plays Doors of Night before An Unexpected Outpost

### Web Client

- Wounded allies are rendered visually wounded in the company view
- Remove buttons are shown for influence-overflow discard resolutions

### Infrastructure

- Lobby: MC-AI narrows to 4 candidates; Real-AI remains marked experimental
- CI stability: the replay round-trip test gets a proper timeout budget, and play-permanent-event is accepted during site-phase select-company

## 0.82.0 — 2026-08-03

Fallen-wizard draft fixes and item-handling repairs

### Cards

- Certified Herb-lore (dm-136), Gamling the Old (tw-155), Pass the Doors of Dol Guldur (dm-154) and Burglary (td-103)

### Game Engine

- Stored items no longer lose their marshalling points
- Item transfers back to any earlier bearer are flagged as regressive, ending an infinite Cram transfer-item loop
- Character-targeting Stage resources now attach to their target instead of entering play unattached at draft
- The Fallen-wizard draft no longer allows stopping while a Stage resource is still legal to pick
- Granted-action activation is routed in every site step

### AI

- The heuristic AI no longer skips haven routing when only some wounded characters can heal in place

### Web Client

- Tutorial step texts clarified and button references matched to the real UI labels

### Infrastructure

- Duplicate game-server launches for the same player are prevented
- Lobby dev mode restarts on shared/src changes via nodemon

## 0.81.0 — 2026-08-02

Five card certifications and missing-choice UI fixes

### Cards

- Certified Durin's Bane (dm-107), Darkness Under Tree (le-108), A Lie in Your Eyes (as-23), The Nazgûl are Abroad (tw-96) and Worn and Famished (td-89)

### Game Engine

- Resource permanent-events are now offered and routed correctly during the end-of-turn phase
- Characters can tap in support during Corpse-candle's forced corruption checks
- Cards being arranged on top of a deck are no longer hidden from the player choosing their order

### Web Client

- The Rule 9.21 ring-play offer (play or skip a tested ring) now shows its buttons
- The Revealed to all Watchers deck-ordering choice is now presented in the UI
- The current site card is clickable for the Great-road haven-return
- Side cards in large hands are clickable again after the hover catch-zone was lost

## 0.80.0 — 2026-08-02

New card certifications and gameplay fixes

### Cards

- Certified Far-sight (tw-238), Elven Cloak (tw-225), Riddling Talk (td-148) and Praise to Elbereth (tw-305)

### Game Engine

- Barrow-blade is no longer playable without a Dagger during the movement/hazard phase
- Resource permanent-events can now be played during the long-event phase
- Reroll strike-modifier cards no longer force tap-to-fight
- The active player is now synced when Free Council corruption checks switch players

### Web Client

- Widened the gap between stacked action buttons in the visual panel
- Fixed invisible sideboard/discard piles during a fetch-from-pile offer
- Fixed the on-guard card discard-target click for Withdrawn to Mordor
- Aware of their Ways discard-removal choice is now offered in the UI

### Infrastructure

- Fixed lobby server test mocks for the missing `toDirName` player-store export

## 0.79.0 — 2026-08-02

Goblin-town hordes and safer discards

### Cards

- Certified Orc-raiders (tw-75), Orc-warriors (tw-77), Wolf-riders (td-86), The Great Goblin (tw-95) and Hobgoblins (td-30)
- Certified Pledge of Conduct (td-144) and Lapse of Will (tw-264)

### Web Client

- Hand-card discards are now confirmed via a tooltip menu instead of dispatching instantly

### Infrastructure

- The `/release` title is now optional; nightly releases write their own headline
- Fixed lobby server test mocks for the mail store's unread counter

## 0.78.0 — 2026-08-02

Nightly Build

### Web Client

- Pass/continue button labels now name the step being skipped
- Admin: added a Send Mail to All button; unread mail badge is now seeded on connect
- Admin requests: rows are clickable and detail-page actions are labeled

### Cards

- Certified Healing Herbs (tw-255) and Dreams of Lore (tw-210)
- Fixed Glove of Radagast not being draftable as a Fallen-wizard Stage resource, and marked all draftable Stage resources with starting-item

## 0.77.0 — 2026-08-02

Nightly Build

### Game Engine

- Gated character discards behind the once-per-turn play/discard slot (rule 2.II.2)
- Fixed orphan-sweep exemption wrongly covering site-bound Invade Their Domain, and move-to-MP-pile cards being orphan-swept
- Fixed missing minion general-influence bonus in muster and call-of-home rolls
- Fixed the hazard player being offered a pass at end-of-turn signal-end with no store window open
- Fixed the non-active player being forced to store items during end-of-turn signal-end
- No-tap corruption removal is now withheld after a tap attempt the same turn
- Fixed an arriving company not inheriting its sibling company's tapped site status

### Web Client

- Added missing UI for The Great Hunt's play-deck/discard choice
- Added missing UI for choosing between Wizard's Test's two gold-ring rolls

### AI

- Heuristic AI now weighs automatic-attack risk before entering a site
- Fixed heuristic AI wasting Great Ship on landlocked companies

### Cards

- Certified Dark Numbers (dm-123), Three Golden Hairs (td-157), Dwarven Ring of Durin's Tribe (tw-216), Orc Stealth (le-217), and Woses of the Drúadan Forest (tw-370)
- Fixed The Balrog (as-71) missing its Under-gates playable-at entry

### Infrastructure

- Game autosave is now kept current after every action, not just on disconnect

## 0.76.0 — 2026-08-01

Nightly Build

### Game Engine

- Fixed A Chance Meeting / We Have Come to Kill being offered as a no-op play when no valid target exists

### Web Client

- Fixed missing Roll button for Seized by Terror pending resolution

### Cards

- Certified Here Is a Snake! (dm-137) and Whole Villages Roused (wh-31)

## 0.75.0 — 2026-08-01

Nightly Build

### Game Engine

- Fixed Alatar (and other compound-homesite characters) being unable to be revealed
- Fixed River's cancel-river action being rejected during the movement/hazard reset-hand step
- Fixed game-scope duplication limit missing copies pending on the chain of effects
- Characters can now tap in support during item-transfer corruption checks
- Fixed Liquid Fire (wh-52) rejected as not playable at a tapped site
- Fixed Were-worm (td-80) so the attacker chooses the defending characters
- Fixed Creature of an Older World (as-73) never being playable

### Web Client

- Added board UI for event-maintenance upkeep
- Fixed missing Roll button for Gandalf's gold-ring test
- Fixed on-guard-only hand cards rendering indistinguishable from dead cards

### Cards

- Certified Were-worm (td-80) and Blow Turned (le-171)
- Fixed Orc Chieftain (le-32) missing the "leader" keyword

## 0.74.0 — 2026-08-01

Nightly Build

### Game Engine

- Fixed Were-worm (td-80) not forcing an item discard when it wounds a character
- Fixed Winged Fire-drake (td-84) so the attacker chooses the defending characters
- Fixed merging companies when different instances of the same haven site are in play

### Web Client

- Fixed character self-granted actions being invisible on the board

### AI / Simulation

- AI now plays boost hazard events before the creatures they improve, and values them by the full plan instead of the marginal sliver
- Sim gate scheduler reuses the pairing it has already paid for

### Cards

- Certified Liquid Fire (wh-52), Men of Lamedon (tw-279), Block (tw-199), Wizard's Flame (tw-361) and Awaken Denizens (tw-9)
- Certified Vygavril (tw-186), Orc Chieftain (le-32) and Landroval (le-81)

## 0.73.0 — 2026-07-31

Nightly Build

### Game Engine

- Fixed Gandalf being unable to tap to test a gold ring during the untap phase
- Engine now survives a company being eliminated during order-effects resolution

### Web Client

- Moved the Pass Priority button into the chain-of-effects panel, while keeping the bottom-right Pass Priority button alongside it

### Cards

- Certified Many Sorrows Befall (td-46)

## 0.72.0 — 2026-07-31

Nightly Build

### Cards

- Certified dragons Itangast (td-36) and Agburanar (tw-3), and Daelomin (tw-26) with site-name keying
- Certified Favor of the Valar (tw-239) with a new new-hand DSL effect
- Certified The Arkenstone (tw-341) and Emerald of the Mariner (td-113)
- Certified Quickbeam (tw-308), the alternate-art printing of tw-307

## 0.71.0 — 2026-07-31

Tutorial Draft Phase

### Guided Tutorial

- Tutorial script: finer-grained steps, a rewritten battle lesson, rules fixes, and an aftermath step after the corruption check
- Tutorial browser UI: richer Mentor bubbles, inline card/token rendering, and better combat visibility
- Tutorial panel detached from the board flow into a left-docked fixed overlay
- Dramatic Mentor beats now wait behind a continue gate, with uniform one-second pacing
- Game session: paced Mentor message pump, tutorial save/load support, and a cursor in the game log
- Removed unused Lórien from the tutorial hero site deck

### Game Engine

- Fixed Flatter a Foe not asking which character makes the influence check
- Fixed The Dwarves Are upon You! being playable outside combat
- Gandalf can now test a gold ring during any phase, not just organization
- Fixed play-character joining the wrong company when two companies share a site

### Lobby & Web Client

- General influence is now shown as a ledger: pool first, per-character costs, free GI last
- Corruption-point badges are now shown on starting items during setup
- Added delete and renew buttons to the admin request detail view
- Fixed a duplicate rejoin-game launching two game-server processes
- Game-server message-handler exceptions are now logged instead of reported as "Invalid message format"

### AI & Simulation

- The modular AI never yields company-shape decisions to the fallback, and its `>` divergence numbers were corrected
- Modules can now yield to a fallback agent that can actually search

### Infrastructure

- Rebuilt the dev loop: watches the real import graph and reloads reliably
- Dev runtime resolves @meccg/shared from source instead of dist, eliminating stale-build ghosts
- Fixed the server URL in bin/update-dev

## 0.70.0 — 2026-07-31

Nightly Build

### Game Engine

- **Certified Fog (tw-241)** and fixed the Balance Between Powers (dm-118) test broken by Fog's new play-condition
- **Certified Choice of Lúthien (dm-120)** — implemented its missing effects plus the remaining discard-on-move and tap-fetch clauses
- **Certified Fifteen Birds in Five Firtrees (dm-129)** — implemented cancel-attack and the remaining clauses
- Implemented Paths of the Dead (tw-302) special movement and hazard restriction
- Implemented Pallando's top-of-discard-pile reveal (CRF 22)
- Wired up Healing Herbs' heal-company-character grant-action
- Starting-site selection now auto-resolves when only one legal site exists
- Fixed move-to-company offering moves the reducer then refused, including moves that would empty the source company
- Fixed Rescue Prisoners checking the site-duplication limit against the bearer's current site instead of the play site
- Fixed The White Tree being playable outside the site phase
- Fixed Safe from the Shadow's storing window being restricted to the active player only
- Fixed Echo of All Joy silently attaching to the wrong long-event

### Guided Tutorial

- Tutorial chapter 1: concepts, UI bubbles, direct-influence lesson, resume support, and a chapter picker
- Re-enabled the play-tutorial lobby button and moved it to the top of the Begin a Quest panel, marked as unfinished
- Fixed the tutorial script for auto-resolved starting-site selection

### Lobby & Web Client

- Added search by message ID to the admin requests tab
- Keyboard-shortcut hints are now suppressed while spectating

### AI & Simulation

- The modular AI's fallback is now a parameter (including the Monte-Carlo agent), with near-ties handed to the fallback via a decisive-margin threshold
- Divergences from the fallback are now priced (bucketed by unit) instead of only counted, with the noise floor measured
- Gates can now vary a tunable; gated tapTempoCost
- The modular AI plays its argmax and reports its distribution and head-to-head gap to the Monte-Carlo agent

### Documentation

- Added a link to the dev server in the README
- Refreshed project status metrics in the README

## 0.69.0 — 2026-07-31

Changelog etc

### Game Engine

- **Implemented rule 2.07** — a dissolved company's tapped site now goes to the site discard pile
- Resource plays and support are now offered during Free Council corruption checks
- Certified World Gnawed by the Nameless (as-110), Denethor II (tw-140), Where There's a Whip (le-254), and Goblin Earth-plumb (as-125)
- Fixed Thrór's Map untap-site ability missing from the site phase
- Hazard-event boosts are now sequenced before the creatures they'd strengthen
- Fixed Shield of Iron-bound Ash (tw-327) missing its 1 corruption point
- Fixed Cram/Gwaihir movement grants expiring during the long-event phase
- Fixed the Roll button not appearing for Flatter a Foe's flattery attempt
- Added an `orderedDecks` flag so scripted games keep the configured deck order

### Guided Tutorial

- Added the guided tutorial module: fixed decks, a 45-step script, state matcher, and driver
- Wired the tutorial end-to-end: controller, game session, lobby integration, and browser panel
- Tutorial spec: three-round curriculum (Barrow-downs, Old Forest, Edoras) with implementation notes
- The lobby's "Play the Tutorial" button is hidden until the tutorial is ready for players

### Lobby & Web Client

- Added a Changelog page to the lobby UI
- Requests can now be filed without credits; they are parked until the next top-up
- Fixed the alerting URL

## 0.68.0 — 2026-07-30

More Features

### Game Engine

- **Implemented Reforging (tw-314)** play-time conditions and effects, with a single shared reader for the board's attack modifiers so both players see the same numbers
- **Implemented the play/storage mechanic for Andúril (tw-192)** and certified the card
- Certified Echo of All Joy (td-110), which protects an attached resource long-event
- Fixed company-targeting resource permanent-events being unplayable outside the organization phase (e.g. during the site phase)
- Fixed hazard short-events swallowing the on-guard placement choice
- Fixed any-phase granted actions (e.g. Cram's untap-bearer) being unreachable during combat
- Fixed the Choking Shadows on-guard reveal never being offered or applied (rule 2.V.i)
- Fixed the -3 stay-untapped modifier being ignored on strike ties
- Fixed Noble Steed's +2 region bonus not applying in the movement/hazard phase
- Fixed The White Tree incorrectly enabling character recruiting at Minas Tirith
- Wired opponent-influence targeting for bearer-less cards in play, so opposing factions can be clicked as influence targets

### Lobby & Web Client

- Added an admin yell broadcast: system API, admin-page button, and update-dev announcements
- Dev-menu actions now ask for confirmation, and games where cheats were used are never recorded (the confirmation is skipped once a game is already marked cheated)
- Changed the admin top-up formula to 1.5× consumption rounded up to the nearest 100

### Infrastructure

- Sim hazard-planner iterations 7–9 measured at 58.8% win rate (+62 Elo) over the previous baseline
- Made the whole-vs-one ablation runnable and used it to reject the draft-value model
- Added a guided tutorial plan spec

## 0.67.0 — 2026-07-30

Various Improvements

### Game Engine

- **Implemented CoE 3.II.4** — Nazgul attacks against minion companies are now detainment
- **Implemented the Ringwraith-follower reclaim grace period** (CoE rule 3.08) with a shared follower-dispersal helper
- Fixed the defending player to roll creature and agent body checks (previously rolled by the wrong player)
- Fixed attack keying to use the hazard player's declared match instead of the full card union
- Strikes are now assigned to allies in "each character faces 1 strike" attacks, and the strike arrow renders when the defender is an ally
- Fixed a pre-assignment race that let the defender skip the attacker's modify-attack window
- Fixed Free Council auto-picking a character for corruption checks
- Fixed Flatter a Foe leaving the chain stuck in `resolving`
- Fixed Lost in Free-domains being playable without a Free-domain in the site path
- Fixed Star of High Hope (td-154) not granting its prowess bonus
- Implemented Token of Goodwill (dm-160), which had no DSL effects
- Fixed the general-influence summary ignoring in-play general-influence bonuses

### Lobby & Web Client

- AI games now appear as watchable rows instead of a bare busy label, and watchers are listed in a hover tooltip
- The game server exits once no human player is connected
- Deck import recognizes more apostrophe-like characters when matching GCCG deck lists
- Added Users/Requests tabs to the admin page, with low-balance accounts highlighted

### Rule Tests

- Implemented rule 3.14 restricted direct influence tests
- Implemented the rule 8.03 faced-attack test and print-order tests for rules 10.30 and 10.29.4 (stale todos)

### Infrastructure

- The sim hazard planner prices support events by running the plan twice, treats in-play hazard events as part of every plan, and charges for sideboard access and deck-exhaust exchanges
- Calibration runs every module that has a classifier and reports which ones ran
- Added a `--pr-check` option to `bin/run-ai`

## 0.66.0 — 2026-07-30

More UI features

### Lobby & Web Client

- **Display requests in the mail page** — the mail screen now shows the request queue alongside messages
- **Show a Detainment marker on the combat situation banner** so detainment attacks are visible at a glance
- Show the unadjusted MP total in parentheses in the MP tooltip
- Show a loading cover until the first full game state renders, avoiding a flash of partial UI
- Fixed the full-map company label to use the company's title character instead of array order
- Admin screen shows the non-system user count, and top-ups grant a 200-credit bonus
- The player guide now explains credit replenishment instead of pointing to admin top-ups

### Game Engine

- Fixed Ready to His Will (le-220) being wrongly offered as a generic playable event

### Infrastructure

- Measured the flat Monte-Carlo playout horizon in the sim harness: longer playouts buy nothing
- Fixed a pre-existing markdown lint error in the card-effects DSL docs

## 0.65.0 — 2026-07-30

Admin screen

### Lobby & Web Client

- **Added an admin screen** for user administration: lists all user accounts with their credit balances, shows each account's credit history and played games, and lets the admin top up credits. Backed by new admin-only HTTP routes and player-store queries, with the admin user configured via lobby config
- Shared the JSON-toggle helper between the pseudo-AI and player action lists, removing two divergent copies
- Shared the combat column scaffolding between attack columns and reused `createCardImageFromDefId` in the company site renderer

### Game Engine

- Centralized Movement/Hazard phase-state construction into a dedicated `mh-phase-state` module, replacing duplicated inline construction in hazard play and event reduction

### Infrastructure

- The AI reviewer now resolves its review-request mail from the PR outcome (merged/closed) instead of leaving requests dangling

## 0.64.0 — 2026-07-30

Nightly Build

### Game Engine

- **Fixed le-193 (Hoarmûrath Unleashed) being wrongly offered outside combat.** The combat-only short-event detector required every effect on a card to be in a known allowlist to skip offering it as a generic play; adding the deck-restriction effect (excluded-from-deck) to the card's effects list made the allowlist check fail, so it leaked through as playable outside its cancel-attack combat window
- **Fixed Tormented Earth (as-102) silently skipping its cancel option.** The combat view's cancel-attack scout map keyed actions only by scout instance ID, so when the engine legally offered two actions naming the same scout (cancel vs. reduce-prowess, per the card's dual-mode text), the second overwrote the first and clicking cancel always applied the prowess reduction instead
- Implemented rule 9.18 — item movement restrictions (bearer-company-moves gains a threshold gate on the moving company's size, covering the two remaining movement-restricted items)
- Implemented rules 3.42 (Fallen-wizard location-deck site usage) and 3.06 (Ringwraith minion play), the last two rule tests with no deferral rationale
- Verified rule 1.35's agent-hazard clause and its CRF carve-out — hazards requiring an agent as an active condition cannot be played against a Ringwraith opponent; already enforced per agent-effect type, now covered by a regression test
- Card certifications: tw-326 (Shadowfax), as-12 (Knights of the Prince), tw-34 (Fell Turtle), le-70 (Elves upon Errantry)
- Deduplicated the CvCC participant-resolution and hazard-limit gate clone clusters in combat legal actions, and extracted a shared `cvccSides()` helper used by six copies of the same side-resolution logic
- Collapsed the four alignment-parallel site-card and four resource-card interfaces onto shared base types, removing ~300 lines of byte-identical fields
- Unified the two company-purge helpers (`purgeCompanyAlliesAndFollowers` / `purgeCompanyFollowers`) and extracted a shared character-replacement helper used by manifestation swaps and discard-to-recruit
- Moved the deck-construction ban/restriction lists (Fallen-wizard bans, Balrog bans, designated Balrog sites, minion-site replacements) from hardcoded engine lists into the card DSL, so new expansions can declare their own restrictions
- Collapsed 30 activate-granted-action object literals into a shared builder
- Shared the view-widening core between the two search determinizers

### Lobby & Web Client

- **Fixed items with both a granted action and a transfer/store option being unclickable for the latter.** The board UI's item click handler picked granted-action-or-transfer/store exclusively, so a granted action always won and items like Cram (td-105) could never be transferred while the action was available
- **Fixed the missing Roll button for generic dice-check resolutions**, hidden because the pass-button whitelist omitted `resolve-dice-check` — affecting Muster Disperses and every other card whose effect resolves through a generic dice check
- Added a spectator-count badge to the toolbar, listing watchers by name on click; hidden outright when nobody is watching
- Stopped a finished game's autosave from blocking the next game between the same two players — the disconnect/shutdown paths wrote the autosave back unconditionally even after saves had been deleted post-acknowledgment
- Unified the marshalling-point category list and its tooltip builder, previously duplicated across five separate tables in shared, sim, and two browser renderers
- Fixed the hand sliding in from the viewport origin when returning from the all-companies overview, caused by the FLIP animation reading a display:none element's zero rect as a real position
- Shared the map marker helpers between the radar and full-screen map, removing five clone pairs of coordinate/marker logic

### Testing & Internals

- Rule tests: 283 of 336 (84.2%); card tests: 1025 of 1027 (99.8%); cards certified: 1083 of 1683 (64.3%)

## 0.63.0 — 2026-07-29

Nightly Build

### Game Engine

- **Every over-limit hazard now fizzles at resolution, not just long-events.** CoE 2.IV.iii.1 makes the hazard limit an active condition for the whole movement/hazard phase — "there must be no more declared actions that count against the hazard limit when compared to that hazard limit at resolution" — and the CRF 22 ruling on Many Turns and Doublings (td-132) spells out the consequence: with Gates of Morning in play it can cancel hazards by dropping the limit below what is resolving. The engine only checked this in `resolveLongEvent`, so a creature, hazard short-event, permanent-event or corruption card declared at the limit still resolved after the limit fell. The check is hoisted into `resolveEntry` ahead of any of the entry's effects, so a creature never reaches combat, a short event never fires its triggers, and a permanent event never enters play. Because exemptions (a no-hazard-limit play flag, or a race exempt at the destination site) are only knowable at declaration, `countsAgainstHazardLimit` is recorded on the chain entry when the count is incremented and only flagged entries are checked — which also stops the old check from firing on resource-player entries that were never subject to the limit
- **Dragon-sickness (td-18) is no longer a corruption card.** CoE 7.2 defines a corruption card as one carrying the printed *Corruption keyword*, not merely any card that forces a corruption check. Dragon-sickness only forces a check on a character bearing a major/greater item, but the stray keyword in its card data made CoE 7.2.1 (one corruption card per character per turn) treat it as one — so it both blocked, and was blocked by, a real corruption card on the same character. Keyword dropped, both directions covered by regression tests
- Fixed deck exhaustion not triggering immediately during the End-of-Turn reset-hand draw. When the draw filled the hand to size and emptied the play deck in the same step, the "hand size reached" shortcut marked the player done without starting the deck-exhaust/reshuffle sub-flow, leaving the deck empty and un-reshuffled until a later End-of-Turn cycle happened to need a card. CoE 2.4 requires exhaustion to happen the moment the last card is drawn

### Lobby & Web Client

- **On-guard placement is offered for character-targeting hazards.** CoE 2.IV.vii.4 lets the hazard player place any hand card on-guard, and the engine has always offered it, but the hand renderer's character-targeting branch swallowed the option: clicking e.g. Lure of Expedience went straight to "click a character", leaving on-guard reachable only by clicking the opponent company's site card — an unlabelled shortcut that reads as "play the hazard here". Clicking such a hazard now opens a disambiguation menu, matching the fix already applied to agent cards; the site-click shortcut still works and the targeting instruction says what it does
- **The scoreboard shows the avatar and both deck names.** The per-game table's "Wizard" and "Deck" rows were always empty. `PlayerState.wizard` is never assigned by the engine — an avatar is just a character card with no mind cost — so the record now recovers the avatar from the cards themselves (in play first, then every zone the player's cards can rest in, restricted to the player's own alignment so a Nazgûl held as a hazard creature is not mistaken for an avatar). That covers Ringwraiths, fallen Istari and the Balrog, so the row is labelled "Avatar". Deck names were missing on AI seats because lobby-spawned clients join through `loadDeckJoin`, which sent only flat card lists; it now forwards the catalog deck as `JoinMessage.deckList`, which also means an AI seat's deck-legality verdict comes from the catalog deck rather than a re-bucketed reconstruction. Records written before this keep their nulls

### Testing & Internals

- Card tests: 1021 of 1023 (99.8%); cards certified: 1079 of 1683 (64.1%)

## 0.62.0 — 2026-07-29

Nightly Build

### Lobby & Web Client

- **Per-player game history from the scoreboard.** Clicking a player name drills into their completed games — one card per game with outcome, how it was decided, turns, duration and game id, plus a side-by-side scoring table comparing both seats across every marshalling-point category, totals, stage points and final score. Where CoE 10.3 doubling/capping changed a category, the cell shows both the raw and the tournament-adjusted value. No new data is written: `playerGames` projects the same completed-game records `loadScoreboard` already aggregates, and fields older records lack stay null rather than being invented

### Game Engine

- **CoE 10.40 — the raw MP total is displayed alongside the adjusted one.** The Short Game calling threshold is checked against the unmodified total, but the display only showed the tournament-adjusted score (doubling + diversity cap), so players could not tell whether they had actually reached 25. `callableMarshallingPoints` is now plumbed through `PlayerView` and printed as e.g. `33 MP (25 unmodified)`
- Fixed strike-reduction effects (Dark Quarrels' halve-strikes and friends) cancelling a whole multi-attack creature attack instead of halving the strikes of the attack they apply to
- Implemented Little Snuffler's ranger body-reduction clause (dm-108), with a new effect type for it in the card-effects DSL

### Infrastructure

- `bin/nightly-release` releases master only when there are commits since the current version tag, driving `/release "Nightly Build"` through a headless run and verifying afterwards that the version changed and the tag exists. Exit status is chainable (0 released, 10 nothing to release, 1 error, 2 bad usage)
- `bin/update-dev` pulls `dataplug/meccg-dev:latest` on the dev host and restarts the stack, so `bin/nightly-release && bin/update-dev` deploys only on a new version

### Testing & Internals

- Card tests: 1021 of 1023 (99.8%); cards certified: 1079 of 1683 (64.1%)

## 0.61.0 — 2026-07-29

Spectators

### Lobby & Web Client

- **Game watching (spectator mode).** In-progress human games are listed as "P1 vs. P2" with a Watch button; watching mints a spectator game token (refused for a game's own players) and connects to the running game server as a spectator
- The spectator view forces the debug menu and debug-view toggle off, hides the "Waiting…" box, renders the bottom player's hand as face-down backs (identities stay hidden, no hover lift) and reveals both players' planned movement destinations, so the region paths are visible during the Organization phase
- Challenge handling: players busy in an AI game show a muted "In game" status instead of a Challenge button, every pending challenge involving a player is cancelled when they enter a game (a stale challenge can no longer be accepted against someone already playing), and a sent challenge can be withdrawn with a new Cancel button

### Game Engine

- **CoE 10.13 — play the revealed card after a successful influence attempt.** The success path of the rule 10.11 reveal variant returned the card to hand and stopped; it now enqueues an `influence-reveal-play-offer` resolution and a `play-revealed-card` action, placing the card without tapping the site, without spending the resource-per-site allowance and without the card's own playability restrictions — the exemptions the rule grants. Influence is the one cost kept, so a revealed character is offered once per controller that can actually pay
- **CoE 9.16 — item switching.** A character bearing several items in one slot was stuck with the first one it picked up. A new `use-item` organization action declares which borne item is in use; the declared item is promoted ahead of its slot-mates and the item it displaces stops contributing its effects at the same moment, on top of the existing per-slot capacity modifiers and exclusions
- **CoE 3.47 — end-of-organization-phase influence overflow.** Excess general influence (from an eliminated controller, a departed bonus, a raised mind) is now settled when the player leaves their organization phase, via an `influence-overflow-discard` resolution that removes one item at a time in the rule's priority order: characters played this phase return to hand, then characters that silently lost direct-influence control are discarded, then free choice
- **CoE 3.07 — Ringwraith company composition** is enforced on `play-character`, `move-to-company` and `merge-companies`, lifted only at a Darkhaven, with the forced end-of-movement combine discarding non-Ringwraith companies sharing the site instead of merging them; **3.33** makes fallen-wizard stored Stage resources visible to both halves of the rule, and **10.11** is covered
- Fixed a card being offered again while its own play was still pending behind an on-guard window — repeated declarations queued duplicate windows and the second one failed with "Card not found in hand". `hasPendingPlay` now suppresses it across every emitter with a `not-playable` explanation. Found in a 320-game gate run; both heuristic agents did it and neither knew
- Fixed Muster Disperses (tw-67 / le-126) and reprints being targetable on the hazard player's own faction — hazard events may only target the resource player's entities (CoE 2.IV.vii.3)
- Fixed site ownership not transferring to a sibling company when the owning company departs a shared site: the site card stayed in play but unowned, rendering as an unowned copy instead of the real card
- Environment-target collection is consolidated into one module; the three copies had drifted, and only one applied the MEAS §1 set-aside guard, which now holds uniformly on the movement/hazard and chain paths too

### Testing & Internals

- Old Forest's healing-affects-all site rule (tw-417) is now covered — the extension follows the site, not the healing card's targeting, with Rivendell as the control
- The ~90-line card-triggered-attack continuation, duplicated byte-for-byte between combat finalize and combat cancel, is extracted to a shared `continueOrDisposeCardTriggeredAttack`
- Deck validation gets one source of truth for its section lists (previously spelled out seven times) and one copies-per-card tally instead of two; region-type keying helpers are deduplicated into `reducer-utils`
- Rule tests: 280 of 336 (83.3%), up from 273

## 0.60.0 — 2026-07-29

More cards and AI

### Card Certification

- 21 further cards certified, bringing the pool to 1079 of 1683 (64.1%): Pallando the Soul-keeper, Radagast the Tamer, Saruman the Wise, Returned Beyond All Hope, Thong of Fire, Orcs of Dol Guldur, Challenge the Power, Twisted Tales, Chill Them with Fear, Plague, Hoarmûrath Unleashed, While the Yellow Face Sleeps, True Fire-drake, Wild Fell Beast, Bard Bowman, Balrog of Moria, Morgul Night, Sting, Gollum's Fate, Wizard's Voice and A New Ringlord
- New effect primitives behind them: elimination-instead-of-discard (Pallando the Soul-keeper), site-wide end-of-turn wound rolls (Plague), a named-avatar play gate in the combat window (Hoarmûrath Unleashed), race-keyed attack boosts that also cover agent attacks (Chill Them with Fear), agent-tap faction influence (Twisted Tales) and an environment region-type remap (Morgul Night)
- Card-data corrections: Wild Fell Beast's `{s}{s}` keying and True Fire-drake's playable regions, with the rule 5.09 fixtures updated to match

### AI & Training

- Heuristics 2 gains four new decision owners — `grants` (prices a granted action by its family of effect rather than card by card), `fetching` (search-and-retrieve, including both setup pools), `events` (prices an event by what its action targets) and a shared `hazard-plan` service that assigns every hazard in hand a standing purpose
- `combat` now owns strike ordering and excess-strike assignment, `travel` owns the enter-site decision, and `corruption` can shed a corruption card
- Fixed the agent handing decisions to Heuristics 1 whenever its scores were close: the partial-coverage margin now applies only when candidates are genuinely unscored, and a complete ranking acts on any strict preference. H2 now decides roughly two-thirds to three-quarters of contested decisions, up from 33.1% when the coverage CLI was written
- Measured against Heuristics 1 over 319 rated games: **+40 Elo [+3, +79]** — probably somewhat stronger, certainly not weaker. Earlier single-sample claims in the sim README were corrected downward after larger runs failed to replicate them; the horizon test shows no measurable per-module signal in either direction
- `calibrate` now checks module assumptions against the reducer, `horizon` reports when a module's number is measuring how busy it was, and new scenarios cover draft picks, enter-or-pass, strike order, excess-strike assignment and shedding corruption
- Action field spellings are consolidated in one place with a test that keeps them honest

### Game Engine

- Fixed a crash when a Forewarned-selected automatic-attack index went stale
- Fixed from-hand modify-attack short events (Unabated in Malice, Black Vapour) being offered as an open movement/hazard play and then resolving as a no-op — the buff never reached the target attack. They remain playable on the active attack, or as an on-guard card revealed against a site's automatic-attack
- Self-play surfaced an engine defect (seed 599: `engine rejected 'pass' — Card not found in hand`), now reported for investigation

### Lobby & Web Client

- The Real-AI model picker moved out of the deck row into a panel revealed by the **Play vs Real-AI** button, with its own Start button; Real-AI is now marked experimental alongside MC-AI and Modular AI
- Fixed rejoining a Real-AI game: the model file is remembered alongside the deck ID and passed back on reconnect, instead of silently seating the heuristic under a different save key

### Documentation

- Card-effects DSL guide expanded by ~300 lines; certification engine-support catalog gains the named-avatar-gate precedent
- Player guide documents the deck lifecycle and what the star on a sample deck means

## 0.59.0 — 2026-07-28

Scoreboard

### Lobby & Web Client

- New **Scores** page in the lobby: per-player tallies over every completed game — games played, wins, losses, draws, last played, with AI opponents badged. Ordered by games played until ratings arrive (`GET /api/scoreboard`)
- Every finished game now writes a complete statistics record to `~/.meccg/games/<gameId>.json` the moment the game ends — both players' raw and tournament-adjusted marshalling-point breakdowns, stage points, deck identity, human/AI flag, win reason, turns and RNG seed — so closing the tab on the result screen no longer loses the result
- Join messages carry an explicit AI marker, persisted through saved games; older AI clients are recognised by their `AI-` names
- MC-AI is promoted from a trial button to a permanent lobby opponent, and a `Play vs Modular AI` button exposes the new Heuristics 2 agent
- Fixed the missing card image when a single-card attack (e.g. Eärcaraxë Ahunt) reached the combat board

### AI & Training

- The Monte-Carlo opponent searches in parallel: `mc:jobs=N` distributes rollout rounds across worker threads with bit-identical results at a fixed rollout budget, and the lobby opponent now uses all cores but two — about 7× more rollouts inside the same 2-second think time on a 24-core host
- Heuristics 2, a modular explainable agent, built out across shared services (hazard budget, exposure, character value, corruption pricing, an opponent belief model) and decision modules (combat, travel, resources, factions, corruption, health, characters, hand, kill, endgame) — every module prices real actions in a common currency and can explain its choice
- New sim CLIs to hold it accountable: `coverage`, `compare`, `explain`, `sweep`, `horizon`, `calibrate` and a watchable `headtohead`, with calibration measured against the reducer rather than assumed

### Game Engine

- Fixed The Moon Is Dead's automatic-attack duplication persisting after the card left play: any card leaving play now sheds the lingering effects it granted, however it left
- Fixed a skipped movement/hazard phase after a company dissolved mid-phase
- Play-option short events that set character status are routed through the chain like the rest, and a company split can no longer be offered that would empty its source

### Card Certification

- 12 further cards certified: Alatar the Hunter, Akhôrahil, Bróin, Náin, Threlin, Dwarven Travelers, Hiding, Master of Esgaroth, Cracks of Doom, Test of Form, Wizard's River-horses and Wizard's Test

## 0.58.0 — 2026-07-28

Introducing more AI

### AI & Training

- New `@meccg/sim` headless harness: in-process self-play over the real engine with seeded, reproducible games, agent registry, Glicko-2 tournaments and paired-seed side-swapped rating gates
- Trained neural opponents — an action-conditioned policy/value network (behavioural cloning, then PPO self-play against a frozen league) with a pure-TypeScript forward pass, so no native runtime is needed to play against a model
- `Play vs Real-AI` in the lobby: pick any model from `~/.meccg/models`; the previous built-in opponent is now labelled `Heuristic-AI`
- New flat Monte-Carlo rollout agent (`mc`), which searches by playing the real engine forward. It is the strongest opponent available — +152 Elo over the heuristic at 8 rollouts, +352 at 16 — and unlike tree search it converts extra compute into strength
- Determinizing PUCT search agent and hidden-state determinizer, with the measured post-mortem recorded: it never separated from the raw policy at any budget
- Rollout sampling temperature is now configurable (`TEMP`), so exploration can be varied per generation and judged on the promotion gate
- Decks carry a manual `approved` flag, and a new `qualify` CLI plays every deck pairing to report which matchups the engine can actually finish
- Value head reads the global vector directly, fixing mid-game evaluations that had been no better than chance

### Game Engine

- Fixed a deadlock where a faction influence attempt whose influencer left play offered no actions at all, hanging the game for both players
- Fixed a hang when a forced-strike target was an avatar the attack excluded, and another when the active company dissolved mid-site-phase
- A character can no longer be listed twice as a follower, which previously corrupted every company built from that list
- The duplicated automatic-attack index is bounded below as well as above, fixing a crash while a site's base attacks were still resolving
- Free Council now resolves the reactive short events it offers, and an absent instance id no longer matches a company with no site
- Splitting a company can no longer empty its source; region movement, hazard limits and on-guard reveals corrected across several cards
- Corruption checks, agent withdrawal, item transfer and strike assignment fixes; race handling unified behind a single vocabulary

### Card Certification

- 74 further cards certified across all sets, taking card-test coverage to 99.7% and certified card data to 62.2% of the pool

### Web Client

- Item corruption-point badges reflect in-play modifiers, Sauron's granted actions highlight correctly, and the text log records dice rolls before the action they resolve

### Infrastructure

- Agents reset per-game state at the start of every game, so a failing seed is reproducible and tournament results are no longer contaminated by earlier games
- Action-type indices are append-only and locked by a test — inserting one mid-list silently re-labels actions for every trained model
- Weights files are rejected when their architecture does not match, instead of silently producing NaN

## 0.57.0 — 2026-07-22

All Sites Certified

### Game Engine

- Certified the remaining site cards across the sets — every site in the card pool is now certified
- Against the Shadow minion sites: Edhellond, Framsburg (new `first-minor-item-no-tap` site-rule + hoard), Grey Havens (hazard-limit +2, minion CvCC ban, Ringwraith move ban), Himring and Isles of the Dead That Live (overt/covert reveal-tap mirrors with auto-attacks), Isle of the Ulond, Lórien, Old Forest, Ovir Hollow, Rhosgobel, Rivendell (new `deny-company-move` / `deny-company-attack` site-rules), Tolfalas, and the Under-deeps chain — The Gem-deeps, The Iron-deeps, The Pûkel-deeps, The Sulfur-deeps, The Under-courts, The Under-galleries, The Under-gates, The Under-grottos, The Under-leas and The Under-vaults
- Lidless Eye minion sites: Blue Mountain Dwarf-hold, Drúadan Forest, Dunharrow, Dunnish Clan-hold, Haudh-in-Gwanûr, Henneth Annûn, Hermit's Hill, Lake-town, Lond Galen, Lossadan Cairn, Lossadan Camp, Stone-circle, The Stones, Tharbad, Urlurtsu Nurn (reanimate an Orc/Troll from discard), Vale of Erech and Wose Passage-hold
- A tied strike no longer defeats the creature or awards kill marshalling points; Balrog (tw-12) defeat tests updated for the corrected rule
- Open to the Summons now enables the agent draft when the enabler is in the pool and requires drafting the enabler before an agent
- Generalized the corruption-check target keyword to a DSL filter and migrated play-character eligibility gates to the declarative rules engine
- Combat and corruption-check internals deduplicated: extracted an `advanceStrikeOrFinalize` helper, collapsed the corruption-check discard/eliminate branches, and reused `resetCompanyMHFields` in the Gangways offer handler

### Bug Fixes

- Server deck validation now matches the deck editor's rules
- Shared site cards no longer jump between companies in the all-companies view

### AI

- The AI no longer enters a site to play an item the engine won't actually let it play there

### Infrastructure

- run-ai: PRs with UNKNOWN mergeability are polled until GitHub resolves them instead of being skipped as healthy

## 0.56.0 — 2026-07-20

Challenge Deck U

### Game Engine

- Completed the card pool for challenge deck (U) "Come by Night upon them" — all 110 cards are now certified, making the deck playable end to end
- Certified The Lidless Eye (le-203) with a Sauron play-mode: a `play-as-sauron` marker, `discard-named-in-play`, and a dual-mode organization grant (sideboard-fetch / peek-hand)
- Certified Come By Night Upon Them (le-176) with a persistent site-scoped `auto-attack-prowess-boost` (-1 prowess to all automatic-attacks at the site, -2 with Doors of Night) and a `firstItemNoTapAvailable` site-phase flag so the first item played at the site does not tap it
- Certified Faithless Steward (as-83) with a new `agent-home-site-faction-lock` effect — while the unwounded agent bearer stands at a Border-/Free-hold home site, factions are locked at any version of that site and the controller gains the card's marshalling points
- Certified The Dark Power (as-79): `player.playsAsSauron` play-condition context, an `isInfluencing` play-target pin to the character making the live influence check, and an `onFailure: shuffle-faction-into-deck` variant on the influence-check modifier
- Certified Eye Never Sleeping (as-82), a Sauron-gated costless cancel of one hazard creature attack; play-condition gates now hold on the from-hand combat cancel paths and gated cancel cards are no longer offered as do-nothing generic short events outside combat
- Certified Nobody's Friend (dm-76), the Border-hold/Free-hold sibling of Inner Cunning (dm-68), reusing the `agent-reveal-site-override` + `fetch-agent-to-hand` primitives with no new engine code
- Migrated hardcoded card logic into DSL declarations: opponent-alignment play bans (vs-Balrog / vs-Ringwraith lists) became a generic `unplayable-when` play-restriction, the Ringwraith One Ring win at Barad-dûr became an `end-of-turn-win` site-rule, A New Ringlord's roll gate moved into its own `when` condition, and the Balrog ring-test skip became a `skipForAlignments` field

### Infrastructure

- run-ai: fixed the `gh` timeout wrapper that silently broke every `gh` call (`timeout … command gh` looked up a binary named `command` and exited 127), which had prevented the open-PR sweep from ever resolving merge conflicts
- run-ai: the worker no longer dies on recoverable errors — network calls (`gh`/`curl`/`git pull`) are bounded by timeouts, an unusable OAuth token backs off and retries, a failed mail handler marks its message terminal and continues, and a dirty working tree pauses instead of exiting

## 0.55.0 — 2026-07-20

Challenge Deck T

### Game Engine

- Completed the card pool for challenge deck (T) "Feel Free" — all 110 cards are now certified, making the deck playable end to end
- Certified Await the Advent of Allies (dm-117) with two new marker effects (`general-influence-exempt`, `own-mp-not-counted`), a `resource-taps-or-requires-site` on-event trigger, and an extension of the bearer-wounded combat-finalization scan to attached items and permanent-events
- Certified Alliance of Free Peoples (as-45) with a `faction-mp-bonus` (race-diversity-gated +1 MP per in-play faction) and a new `discard-on-card-leaves-play` reactive-diff effect
- Certified Red Arrow (tw-312) with a new `auto-influence-faction` primitive — faction influence succeeds with no 2d6 check, no RNG consumed — plus a +5 direct-influence bonus against characters with Edoras as home site
- Certified Folco Boffin (dm-180) with a new `discard-to-recruit` primitive that generalizes manifestation-swap: discard the bearer at a Haven to play a filter-matching character into its company, transferring attachments and control without consuming the one-character-per-turn slot
- Certified Saw Further and Deeper (dm-156) with unrevealed-Wizard support: a `player.avatarInPlay` play-condition, an `avatar-home-site-restriction` marker, and a new `avatar-enters-play` on-event trigger
- Certified Tookish Blood (tw-104) as a dual hazard/resource card, adding a `protect-from-removal` effect and a turn-scoped `character-removal-protected` constraint that fizzles returns-to-hand and discards
- Certified The Sun Unveiled (as-56) with a new `hazards-on-target` MoveZone that removes every hazard permanent-event from a character and routes each to its owner's discard
- Certified Times Are Evil (td-76) with a new `all-in-play` check-modifier scope penalising both players' influence and offering attempts
- Certified Houses of Healing (td-125) with a healing-only variant of `site-type-override` — the site counts as a Haven for the untap-phase healing sweep only
- Certified Nenseldë the Wingild (td-142) and Marsh-drake (td-47) from existing primitives; the latter also fixed an invalid `coastal-sea` region type in its keying data
- Implemented a corruption-check cost variant of `cancel-strike` for The One Ring (tw-347), alongside coverage for Sting (tw-333) and Bard Bowman (tw-124)

### Bug Fixes

- Crown of Flowers (dm-121) no longer blocks the rest of the organization phase — resource pairing is modelled as a non-blocking organization action instead of a blocking pending resolution, and the unused `resource-play-offer` pending kind was removed
- Gates of Morning may now be replayed in response to a Twilight (CRF 22 Annotation 11): resource permanent-events are offered during movement/hazard and organization chains, and the game-scope duplication check excludes copies already targeted for discard
- A pending fetch queued above a creature entry on a collapsing chain now resolves before combat, so Smoke Rings (dm-159) is no longer silently skipped
- Fallen-wizard avatar-specific Stage resources are playable before the avatar is first brought into play (CoE 2.2.F2) — the gate now resolves the declared avatar rather than requiring it in play
- The General Influence tooltip no longer counts characters exempted by Await the Advent of Allies, matching the engine's calculation
- Ported pending-effects hazards (Despair of the Heart, Greed, Weariness of the Heart) to their previously inert sibling printings, with parity tests guarding the regression

### AI

- The heuristic AI no longer treats unusable heal/untap cards as untap sources — a restore card counts only when it can actually target a company character in the relevant status
- The AI no longer idles a healthy company in the Organization phase when a movement target hosts a directly-playable hand resource

### Web Client

- The inbox "Delete Read" button is always rendered, disabled until at least one message is read, with its state recomputed live as messages are read, deleted, or reviews resolved
- Disabled inbox action buttons are visually muted and no longer highlight on hover

### Card Data

- 11 newly certified cards (915 → 926 of 1683), completing challenge deck (T) "Feel Free" at 110/110
- Removed a phantom "cancel corruption check" todo from the Lesser Ring (tw-266) test — the card has no such printed ability

## 0.54.0 — 2026-07-19

Challenge Deck S

### Game Engine

- Completed the card pool for challenge deck (S) "Await the Onset" — all 110 cards are now certified, making the deck playable end to end
- Certified Await the Onset (wh-96), the Fallen-wizard permanent event the deck is built around: both of its marshalling-point clauses are modelled as pin-to-1 overrides (a `played-after-faction-mp-pin` and a `nonhaven-company-mp-pin`), carried per-instance via a new `mpPinned` tag. Factions are never stored on characters, so no faction-location model was needed
- Certified Gandalf as a Fallen-wizard (wh-4) with a new `fw-char-mp-full` primitive (the Fallen-wizard avatar scores full character marshalling points), alongside Gandalf's Friend (wh-98), a Gandalf-specific stage companion
- Certified Fireworks (dm-130) with a `roll-untap-site` primitive (a dice-check whose on-pass verb untaps a site) plus a skip-next-untap-on-play constraint reusing the ba-18 machinery
- Certified Peril Returned (td-54) with an environment-override primitive that locks Doors of Night / Gates of Morning, and A Pack at the Door (tw-497) with a `grant-creature-keying` region-type primitive
- Certified Grey Embassy (wh-100) and Give Welcome to the Unexpected (wh-99) with a `noncharacter-mp-override`, plus Chambers in the Royal Court (wh-97) as an "Any <site-type>" homesite
- Certified Dol Amroth (le-366) and Pelargir (le-398) MELE free-hold guardian sites, mirroring the existing le-391 detainment/overt structure
- Certified Mischief in a Mean Way (wh-77) — a site-phase Border-hold Wizardhaven conversion gated on 10+ stage points, reusing the wh-65/wh-70/wh-75 primitives

### Card Data

- 19 newly certified cards (896 → 915 of 1683), completing challenge deck (S) "Await the Onset" at 110/110
- Certified The Great Eagles (tw-344) after repairing a truncated `playableAt` list (also affecting tw-258/369/370), No Strangers at this Time (as-51), Beornings (le-261), Bill the Pony (tw-198, a run-home-to-haven ally ability), Elwen (dm-8) and Herion (dm-16), and Freca (dm-182, +1 direct influence against Riders of Rohan and Dunlendings)

### Testing & Infrastructure

- Adjusted the le-303 test to reflect the newly certified guardian sites: Pelargir now allows a gold-ring play, Dol Amroth now offers a gold-ring, and Blue Mountain Dwarf-hold is used as the free-hold-without-gold-ring fixture
- Cleaned up unused test imports flagged by lint across the dm-130, tw-497, wh-4, and wh-77 certifications

## 0.53.0 — 2026-07-17

Challenge Deck R

### Game Engine

- Completed the card pool for challenge deck (R) "The Ally-Armada" — all 110 cards are now certified, making the deck playable end to end
- Certified Radagast (wh-8), the Fallen-wizard avatar the deck is built around, with a new `ally-movement-restriction-exemption` effect (his allies ignore the normal "allies may not move" restriction) layered on the existing `faction-mp-override`, `fw-ally-mp-full`, and `draw-modifier` primitives. Note for future card data: a `$not` written as a sibling of field keys is silently dropped by the condition matcher — wrap it in an explicit `$and`
- Certified Shifter of Hues (wh-115), Radagast's Shapeshifter form: stat effects gain an `op: "set"` mode for absolute (rather than relative) values, plus `override-skills` threaded through `getEffectiveSkills`, `bearer-cannot-move` / `bearer-cannot-use-items` restrictions, and a lasting `check-modifier` scoped to the next organization phase
- Certified Radagast's Black Bird (wh-114) with two new play-flags — `no-tap-on-play` and `influences-factions` (an ally contributing direct influence to faction checks) — a `return-to-hand` effect, and `partitionLeavingAllies` so allies are correctly separated across the four leave-play sites
- Certified Girdle of Radagast (wh-110) with a new persistent `region-type-conversion` effect (named regions re-key as Wilderness) and a `supporters-in-region` play-condition
- Certified Rhosgobel (wh-57) with a new inherently-protected-Wizardhaven site-rule and an `isSiteProtectedForPlayer` helper; deck validation for rule 1.07 now also scans the sites section, which it previously skipped
- Certified Stormcrow (td-73) with a new `prohibit-company-events` primitive (discarding/prohibiting Fellowship-style company events on Wizard companies) plus the Wizard direct-influence -2/-4 modifier
- Certified Glove of Radagast (wh-111) with a new `grant-ally-play` primitive: a non-unique 1-mind ally playable at the bearer's site, supporting `fromDiscard` and `excludeBearerControlsCopy`
- Certified An Untimely Brood (wh-62), a Wizardhaven-keyed variant of `grant-ally-play` adding `atProtectedWizardhavens`, `allowTappedSite`, and `oncePerSitePhase`

### Card Data

- 11 newly certified cards (885 → 896 of 1683), concentrated on the challenge deck (R) "The Ally-Armada" pool, which reached 110/110
- Certified Barliman Butterbur (tw-125) as a dual `check-modifier` (corruption -1 and faction-influence -1), reusing the existing primitive with no engine work
- Certified Lure of Nature (tw-58) and Lure of Expedience (tw-57) as data-fix siblings of le-123 and le-122 (identical card text). Lure of Nature needed `keywords: ["corruption"]` so rule 10.08's no-tap removal applies

### Testing & Infrastructure

- Adapted the Girdle of Radagast (wh-110) tests to Rhosgobel's newly inherent protection and stage point. Gotcha worth remembering: `buildTestState` with `recompute: true` resets `stagePoints` to 0

## 0.52.0 — 2026-07-16

Challenge Deck N

### Game Engine

- Completed the card pool for challenge deck (N) "Smoke on the Water" — all 110 cards are now certified, making the deck playable end to end
- Certified Enchanted Stream (as-27), a permanent hazard-event bound to the opponent's moving company, introducing a new `company-movement-tax` effect: the company may not voluntarily split or move until it taps up to two of its untapped characters during its organization phase (new `pay-movement-tax` action, reducer, and per-org counter gating both `planMovementActions` and `splitCompanyActions`). A ranger in the company may tap to cancel it before it resolves, via a static `grant-action cancel-chain-entry` offered during movement/hazard chain declaration. Also fixed the long/permanent-event branch of `playHazardsActions`, which previously skipped the `play-condition requires: site-path` check that the short-event branch already enforced
- Certified The Ring Leaves Its Mark (le-223), a dual-mode minion short event: either fetch a Black Rider / Fell Rider / Heralded Lord from the sideboard or discard into the play deck and reshuffle, or play it on your tapped Ringwraith and roll to untap. Legal-actions emits both modes and the reducer discriminates them by the presence of `targetCharacterId`
- Certified Mechanical Bow (wh-53): the `enemy-modifier` body reduction can now gate on the bearer tapping to face a strike. `StrikeAssignment` gains a `strikeMode` field, recorded in `resolveStrikeCore` and threaded through the creature body-check path into `resolveEnemyBody`, where it is exposed as `combat.strikeMode`
- Certified Khamûl the Ringwraith (le-55) by reusing existing primitives — a race-gated intrinsic `enemy-modifier` (Elf body -2 against his strikes in character-vs-character combat) and `ringwraith-follower-slots` count 1, the single-slot sibling of The Witch-king's two-slot ability

### Card Data

- 8 newly certified cards (877 → 885 of 1683), concentrated on the challenge deck (N) "Smoke on the Water" pool
- Certified Cameth Brin (le-358), a data-twin of Raider-hold (le-399): filled in empty playable resources and the Men each-character automatic attack, plus covert-gated detainment and a `deny-item` site rule — all engine support pre-existed
- Certified Blackbole (le-152), the minion Ringwraith counterpart of the Ent ally Quickbeam: replaced the free-text `playableAt` placeholder with a structured Mirkwood-except-Dol-Guldur condition, added the `no-attack-site-keyed` play-flag, and restored the missing `mind: 3`
- Certified Smoke on the Wind (le-230), a data-only sibling of Burning Rick, Cot, and Tree (le-173) keyed to a Free-hold instead of a Border-hold; corrected printed marshalling points 0 → 3
- Certified Lieutenant of Angmar (le-20) as a data-fix sibling of le-21

### Testing & Infrastructure

- Added `bin/update-readme.mjs`, a generator that regenerates the rules and card test READMEs plus the top-level Project Status and Deck Catalog tables from the tests and card data (supports `--check` for CI-style verification)
- Fixed two rule/card tests whose premises were invalidated by new certifications: rule-9.20 now uses a warrior bearer for the Mechanical Bow's warrior-gated prowess, and the le-58 test uses Dwar as its follower-less avatar now that Khamûl has follower slots

## 0.51.0 — 2026-07-16

Challenge Deck M

### Game Engine

- Completed the card pool for challenge deck (M) "It's magic!" — all 110 cards are now certified, making the deck playable end to end
- Certified Geann a-Lisch (le-374), a dangerous minion Haven introducing two new site-rules: `no-storage` ("resources may never be stored here") and `hazard-site-type-override` (the site counts as a Ruins & Lairs with Carn Dûm's site path for hazard keying only, re-exposing companies to hazards that a Haven would otherwise block emergently); its "no characters unless this is their home site" rule needed data only, via the existing `deny-character` rule with an empty filter
- Certified Bree (le-356) with a new `allow-agent-play` site-rule, letting agent characters be brought into play under a controlling character's *direct* influence (overriding rule 2.II.2.2.5's home-site confinement) while leaving Ringwraith/Fallen-wizard alignment gating unchanged; also filled in Bree's materially incomplete data (playable resources, Dúnedain auto-attack, covert-gated detainment)
- Certified The Balance of Things (tw-93) with a new `corruption-source-multiplier` effect: a game-wide long-event that doubles each character's *smallest* corruption source (the controlling player minimises), with N in-play copies scaling the N smallest sources; the Balrog avatar is excluded
- Certified Forced March (le-185) with a new `grant-extra-mh-phase` primitive, granting an extra movement/hazard phase to a company that moved to a Darkhaven
- Certified Akhôrahil the Ringwraith (le-51) with a new magic-discard-to-deck passive, recycling the caster's magic cards to the play deck instead of the discard pile
- Certified Akhôrahil Unleashed (le-162): the move fetch now accepts a `deck` source, enabling a magic-card self-tutor across play deck and discard with a reshuffle
- Certified A Malady Without Healing (le-159), adding a cross-player play-target, a standalone body check, and hero kill MP via `bonusKillMarshallingPoints`
- Certified Shadow-cloak (le-344) with a cancel-strike attack-keying when-context primitive

### Card Data

- 12 newly certified cards (865 → 877 of 1683), concentrated on the challenge deck (M) "It's magic!" pool
- Certified Half-trolls (le-267), an Orcs-of-Udûn leader-control faction sibling of le-262 — data fix only
- Certified Cave-drake (le-66) as a data-fix sibling of tw-020: added the `combat-attacker-chooses-defenders` effect and corrected its keying to `{w}{w}` (two wildernesses)
- Certified Ice-drake (td-32), a plain region-name-keyed hazard Drake encoded via a single `keyedTo.regionNames` entry — no engine work
- Certified Belegorn (le-2) — restored the missing "can use spirit-magic" skill

## 0.50.0 — 2026-07-15

Challenge Deck L

### Game Engine

- Completed the card pool for challenge deck (L) "Wolves!" — all 110 cards are now certified, making the deck playable end to end
- Certified Black Rider (le-170), a Ringwraith-mode card introducing a new `alsoDiscardCompanyFollowers` purge primitive
- Certified Words of Menace and Deceit (le-258), a spirit-magic short event granting +5 direct influence for the rest of the turn and −4 corruption (unless a Ringwraith); extended the duplication-limit character scope to cover non-attaching short events
- Certified Smaug Roused (le-285), adding Dragons "Roused" faction primitives: influence modification (discard an item for +N), cancel-manifestation-attacks, and faction `manifestId` uniqueness
- Certified Dunlending Raiders (td-19), a region-keyed vanilla creature with R&L-in-regions folded into `regionNames`

## 0.49.0 — 2026-07-15

Challenge Deck K

### Game Engine

- Complete the card pool for challenge deck (K) "Lord of Rings" — all 110 cards are now certified, making the deck playable end to end; also corrected illegal/unplayable card counts in decks K and Q against the source PDFs
- New gold-ring and ring-item primitives: `enqueue-gold-ring-test` active org-phase sage ring test (Test of Fire le-239), a game-wide `in-play-item-modifier` boosting CP/MP on filtered ring items (Rumor of the One le-224), and support for the special ring cards Bright Gold Ring (le-303), Gold Ring that Sauron Fancies (le-312), The Oracle's Ring (le-327), and Trifling Ring (le-346, "+3 direct influence against characters")
- New auto-attack manipulation primitives: `auto-attack-boost` (Arouse Defenders le-101), doubled auto-attack strikes at Shadow/Dark-holds (Awaken Minions tw-10, Awaken Defenders le-103 with detainment→normal at Free/Border-holds), and dual-mode auto-attack control (FEAR! FIRE! FOES! as-29)
- New site and creature behaviours: region-type remap plus permanent-event auto-attack (Fell Winter le-111), gold-ring-only site with wound-corruption check (Gladden Fields le-375), Amon Hen (le-349) Barrow-downs-style Info+minor test, Dúnedain region-keyed creatures (Arthadan Rangers le-60), and Incite Denizens (le-116)
- New dual-mode tap-character short hazard-event with a region/site arrival override (New Moon tw-68)
- Direct-influence and combat modifiers: Súrion +2 DI vs Dúnedain/Southern-Gondor (dm-24), Gulla +1 prowess against Orcs and Elves (le-13), Mine or No One's +10 Balrog opponent-influence booster (ba-68), People Diminished (ba-72), Ren the Ringwraith (le-56), Woodmen manifestation uniqueness (le-295), Variags of Khand Standard Modifications + manifestation uniqueness (le-292), and Woodmen-town (le-414)

### Card Data

- 24 newly certified cards (837 → 861 of 1683), concentrated on the challenge deck (K) "Lord of Rings" pool plus supporting Lidless Eye gold-ring, ring-item, and faction cards

### Infrastructure

- Regenerate card-test and rule-test coverage reports (card tests 781 → 805 of 813)

## 0.48.0 — 2026-07-15

Balrog Deck #2

### Game Engine

- Complete the card pool for challenge deck #2 "Balrog's Host" — 119 of its 121 cards are now certified, making the Balrog's second challenge deck playable end to end
- New capture mechanic: `press-gang-capture` (Press-gang ba-22) holds a captured character outside any company in a new `character-pressed` state, with `engine/press-gang.ts` providing `findCapturingPressGang` and `sweepPressGang`
- New Balrog site and Under-deeps primitives: `eddy-lock` site-locking permanent-event with a pay-site-tax action (Eddy in Fate's Tide ba-57), `site-storm-devastation` CvCC devastation (Crowned with Storm ba-54), `site-path-reduction` active constraint (Roam the Waste ba-73), dynamic Under-deeps adjacency rolls (Ancient Deep-hold ba-83), and the remaining Under-deeps sites ba-90, ba-94, ba-96, ba-104
- New combat primitives: `combat-cancel-weapon` (Whip of Many Thongs ba-82), `combat-discard-opponent-item` (Scourge of Fire ba-75), `flee-from-strike` with a one-shot `skip-next-untap` (Fled into Darkness ba-18), a strike-mode prowess gate (Stabbing Tongue of Fire ba-81), Demon fána company-untap (Strangling Coils ba-76), and a roller-agnostic `wound-or-eliminate` dice-check verb
- New `cvcc-attack-permission` effect: an in-play permanent can grant company-vs-company attacks (Invade Their Domain ba-64, Lord and Usurper ba-65)
- Direct-influence and corruption support: attach-to-leader DI with body checks (Obey Him or Die ba-69), `discardBodyCheck` and DI effects for Umagaur (ba-9) and Old Troll (le-29), Bolg's +2 DI against Balrog-specific characters (ba-4), Uchel's +4 DI against the Hillmen (le-47), and faction influence-check modifiers (Orcs of Angmar le-274)
- New card behaviours from the wider pool: environment discard of all resource environments (Doors of Night le-110), self-granting Ringwraith followers with recall-to-deck (Ûvatha le-57), R\&L-gated creature-keying restrictions (Down Down to Goblin-town le-181), detainment with a prowess penalty vs. hero (Durin's Folk as-8), and a limit-1 M/H combat window split out as its own phase (Left Behind td-41)
- Fixes: Balrog starting resources no longer vanish from the starting company; Great Fissure (ba-61) is no longer offered as a plain short-event outside its combat modes; Flatter a Foe is no longer playable outside combat; the combat trophy-offer phase no longer stalls the game when no valid actions exist; the eliminated-avatar −5 MP penalty is now reflected in the running total

### Card Data

- 38 newly certified cards (799 → 837 of 1683), concentrated on the Balrog's Host pool plus supporting Lidless Eye, Against the Shadow, and Dark Minions cards
- Complete missing data on Wellinghall (as-170) and the Iron Hill Dwarf-hold (le-383)

### Web Client

- Add a rename control to the deck editor title

### Infrastructure

- `run-ai` now serves the request queue by topic priority and resets an interrupted request back to `new` on Ctrl+C/SIGTERM
- Pass the skill prompt to headless Claude on stdin rather than argv
- Move the certify engine-support catalog out of the skill prompt into its own document

## 0.47.0 — 2026-07-12

Balrog Deck #1

### Game Engine

- Complete the card pool for challenge deck #1 "The Shadow-deeps" — every card in the deck is now certified, making the Balrog's Great Shadow form fully playable
- New Balrog and Under-deeps primitives: `balrog-surface-region-movement` (Out He Sprang ba-71), `join-combat-force-strike` (Vanguard of Might ba-79), `surface-site-roll-zero` (Breach the Hold ba-50), `site-instance-transform` for the Darkhaven/Shadow-hold split (Roots of the Earth ba-74), `surface-region-adjacency` (Caverns Unchoked ba-51), repeated Under-deeps M/H phases (Gangways over the Fire ba-60), and Balrog self-attack events with lingering buffs (Descent through Fire ba-56)
- New combat primitives: bearer-combat body-check modifiers for parrying defenders and CvCC attackers (Flame of Udûn ba-58), one-strike-per-wounded with tap-to-cancel-strike (Carrion Feeders ba-11), attacker-attack-option with Spawn auto-attack (Ungoliant's Progeny ba-27), dynamic-race trigger attacks (Tempest of Fire ba-77), counter-cancel of Under-deeps attacks (Great Fissure ba-61), and the weapons-ineffective rule (Dwarven Light-stone dm-168)
- New resource/hazard primitives: `reveal-deck-choose-penalty` (Desire All for Thy Belly ba-16), `reveal-remove-from-discard` (Aware of their Ways dm-46), `convert-creature-to-ally` (Memories of Old Torture ba-67), `reveal-and-attack` with ongoing discard triggers (The Great Hunt wh-91), `company-tap-characters` on a Spawn-count threshold (The Reek ba-23), dual-mode from-hand modify/cancel combat short-events (Darkness Wielded ba-55), sideboard self-relocation with player-scoped influence modifiers (Terror Heralds Doom ba-78), company-scoped corruption-check modifiers (I'll Be At Your Heels le-195), and end-of-org hazard-limit modifiers (Cloaked by Darkness ba-53)
- Add Fallen-Wizard support for Alatar (wh-1) and Pallando (wh-7): full-kill MP, detainment-as-normal attacks, Wizardhaven joining, FW faction-MP override, and the associated squire/item family (wh-90, wh-92, wh-93, wh-95, wh-104, wh-105)
- Add agent recruitment via Open to the Summons (wh-46) and coastal keying-bypass for the Drowning-deeps (ba-89) and Remains of Thangorodrim (ba-95)
- Enforce the starting-company pool restriction (rule 1.7) in `validateDeck`

### Card Data

- 100 newly certified cards (699 → 799 of 1683), including the full Balrog Under-deeps site set (ba-84 through ba-101), Ungoliant/Spawn creature line, Trolls, and the White Hand hunt cycle
- Fix illegal sample-deck pools: relocate excess and start-company-forbidden characters
- Add the seven missing challenge decks (#1, #2, K–N, T, U); the deck catalog now covers all 24

### AI Player

- Fix the AI getting stuck by accepting resource short-events during site select-company and enter-or-skip
- Offer on-guard placement for agent cards held in hand
- Make character placement monotonic to stop endless company shuffling

### Infrastructure

- Fix `run-ai` silently abandoning broken PRs forever; bound PR-fix retries

## 0.46.0 — 2026-07-07

More Cards

### Game Engine

- Add creature↔event dual-mode play: creature↔permanent-event (Adûnaphel tw-2, Ûvatha tw-107) and creature↔short-event with return-to-origin (Mouth of Sauron tw-65, Beorning Skin-changers ba-10)
- Model event-based agent deployment: re-cast mis-typed hazard-event cards as deployable agents (Lobelia dm-28, My Precious dm-29) and implement agent-attack-outcome rules (§5–6)
- New DSL primitives shipped with certifications: `agent-tap-return-character` (Pilfer as-33), `reveal-choose-shuffle` dig (Eyes of Mandos dm-126), `cycle-hand` + arrange-deck-top (Revealed to all Watchers dm-85), `cancel-card-effects` with Under-deeps return (The Way is Shut dm-98), ally self-tap chain cancellation (Tom Bombadil tw-350), grouped ahunt attacks + faction-influence-restriction (Mordor in Arms dm-72), displace-stored-item (dm-73), force-opponent-discard (Rolled down to the Sea wh-29), withdraw-agent (Withdrawn to Mordor dm-165), and agent-discard-return-to-origin (Baduila dm-2)
- Add corruption failure downgrade (eliminate → discard) for The Roving Eye (le-135)
- Count agent-manifestation hazards as half a creature per rule 1.5.1, and fix deck validation to match
- Combat fixes: wound (and remove) an agent when its strike is defeated; allow revealing on-guard modify-attack hazards on automatic attacks; preserve fresh phaseState when clearing ahunt group outcomes
- Route influence-check-boost short events through the chain of effects; reject Withdrawn to Mordor (dm-165) with no valid target
- Resolve raw player/company/instance codes in legal-action text so action labels read naturally

### Web Client

- Add a setup-step instruction banner for deck-draft clarity and a select-company prompt banner in the all-companies view
- Add GCCG `.deck` file import and Markdown deck notes (type, challenge-deck data) to the decks page
- Hide face-down deck-top order after "Revealed to all Watchers" (dm-85); show revealed opponent hand cards to the viewing player
- Board UI fixes: tap Adûnaphel/Ûvatha permanent-events, make item-borne cancel-attack (Torque of Hues) clickable in combat, fix the combat arena collapsing the site card onto defenders, and fix Daelomin at Home (td-11) discard button and hazard-limit display
- Fix strange `p1`-style code labels on deck-arranging actions

### Cards

- Certify ~35 more cards across all sets — characters, factions, items, agents, and hazards — including Strider (ba-1), Khamûl the Easterling (tw-47), Círdan (tw-137), Merry (tw-170), Elves of Lindon (tw-226), Palantír of Minas Tirith (tw-299), Southrons (tw-329), Variags of Khand (tw-357), Smaug Ahunt (td-70), Inner Cunning (dm-68), Longbottom Leaf (ba-30), To Fealty Sworn (ba-33), and Unabated in Malice (ba-26)

### Infrastructure

- run-ai: retry transient outages instead of dying silently, reset (not burn) requests on API capacity/usage limits, and sweep open PRs each loop to fix conflicts, comments, and failing CI, with a visible heartbeat
- Mail: add success/failed end states and finalize processed messages by PR outcome
- Resolve PR merge/close state via the `state` field; preserve unknown fields in `secrets.json` across lobby-server restarts
- Test policy: run only changed tests locally; full suites move to PR review

## 0.45.0 — 2026-07-02

Challenge Deck V

### Game Engine

- Implement the MEBA (The Balrog) rules spec: The Balrog bears but cannot use items (§3), Balrog movement restrictions with Barad-dûr exceptions (§6/§7), Challenge the Power 9–10 band and per-turn limit (§8), destination-based card draws even at Darkhavens (§11), Balrog organization-phase rules (§12–16), the opponent ban on Balrog-banned cards (§17), and ignoring Balrog automatic-attacks once the Balrog is in play or defeated (§18)
- Add avatar-specific sweep-and-gather (rule 3.09), follower influence protection (3.08), and the mid-strike hazard limit (8.12)
- Add the mirror-match ban exemption (3.10), Fallen-wizard avatar declaration (1.37), and a discard-character organization action (3.22)
- Defer follower general-influence subtraction while the follower relationship is suspended in combat (3.13/3.46/8.21)
- Real engine fixes uncovered by rules work: end-of-turn site replacement (7.02), combat fixes for rescue attacks and prisoner handling (8.31/8.36), and alignment-based item usage (9.20) with fixture fixes for as-122/le-304
- Add movement/hazard engine work for illegal movement, region-modification effects, and hazard-limit rules (5.04/5.09/5.21)
- Add the balrog-specific keyword to BA cards marked as such in their text
- Refuse to start an AI game without a selected deck

### Rules & Tests

- Rule-test coverage rises to 267/330 (80.9%): remaining deck-construction tests (section 01), the last untap-phase tests (02, now 100%), twelve more organization-phase tests (03), eleven movement/hazard tests (05), seven site-phase tests (06), end-of-turn (07, now 100%), combat tests (08), agents/events/items tests (09), and the corruption/influence/actions-timing/endgame suite (10)
- Add MEBA confirmation tests for item bearing (§3) and automatic attacks (§18)

### Card Certifications & Data

- Certify 20 cards: The Balrog's avatars and Under-deeps sites — Bûthrakaur (ba-5), Crook-legged Orc (ba-6), Great Shadow (ba-62), Orders from the Great Demon (ba-70), Moria (ba-93), The Under-gates (ba-100), The Under-leas (ba-102), The Under-vaults (ba-103) — plus Ancient Black Axe (as-122), Iron Shield of Old (as-127), Thrall-ring (as-133), Troll Lout (le-44), Barrow-wight (le-61), Wild Trolls (le-100), Call of Home (le-105), Muster Disperses (le-126), War-warg (le-156), Catch an Elusive Scent (le-175), Broad-headed Spear (le-304), and Glittering Caves (le-376)
- Add the Balrog challenge deck V (Great Shadow) from the CCG Challenge Decks Guide, fully data-complete and certified
- Remove the development-only decks and the sample all-hero-sites deck
- Move Ill-favoured Fellow to characters in challenge deck O
- Fix Cracks of Doom (tw-205) image filename casing

### Infrastructure

- Stop gating card certification on the full test suite
- Make certify-card's PR title and verified-status update mandatory and self-checked

## 0.44.0 — 2026-07-01

Challenge Deck O

### Game Engine

- Restrict Fallen-wizard avatar play to its declared home site (rule 2.II.2.1.F1) and count a Fallen-wizard as their declared avatar before it enters play
- Treat Fallen-wizard companies as hero for detainment purposes (rule 2.IV.vii.F1)
- Fix Fallen-wizard movement across mixed-alignment sites
- Hidden Haven: pair its Ruins & Lairs site at draft time, force site selection before the draft proceeds, auto-skip starting-site selection when it set the site, keep factions/allies naming the site playable, and cancel M/H keyed-creature attacks at Hidden Haven sites
- Thrall of the Voice: gate one drafted character per recruitment vehicle and draft it without spending a separate character pick
- Draft a Fallen-wizard Stage resource as the round's action so the game proceeds, and play site-targeting Stage resources during the organization phase (rule 5.F1)
- Restrict stage-resource permanent events to the organization phase
- Implement Fallen-wizard free general influence and surface stage points in the player metrics
- Add a generic dice-check resolution and collapse muster, glamour, cvcc ally-discards, call-of-home, and body-check onto it (P08); add a return-character-to-hand verb
- Route long-event and permanent-event enters-play and the discard-self verb through the move primitive; add in-play destinations and a chain source (P06)
- Generalize prisoner rescue to take-prisoner cards (Troll-purse dm-95, Flies and Spiders dm-58)
- Offer a cancel window for each-character automatic attacks; fix The Worthy Hills (le-415) each-character auto-attack
- Fix the trophy no-disappear bug and complete `resolveInstanceId` plus the no-card-disappears invariant check (P03)
- Fix influenced characters' hazards being dropped instead of discarded, and Free Council corruption checks discarding attached hazards twice
- Fix Brigands offering non-item cards as discard targets and Stone Trolls' leader-control influence variant
- Default site-targeting permanent events (Double-dealing) to the focused company

### Card Certifications & Data

- Certify Eyes of the Shadow (dm-56), Troll-purse (dm-95), and Variag Camp (le-411)
- Add the remaining 81 The Balrog (BA) cards via `add-card.mjs`

### Web Client

- Highlight the name of the player whose turn it is and fix browser focus when the opponent has the first turn
- Add a stage-points (SP) breakdown tooltip to the view header and show effective mind in the GI tooltip with printed mind in parentheses
- Fix the GI info-box tooltip ignoring the control-restriction cost (Wizard's Myrmidon)
- Render on-guard cards above the site-attachment strip and site-bound cards beneath their site
- Surface Power Built by Waiting tap/untap on the game board and render Thrall of the Voice beside its drafted character
- Fix resolve-strike button labels for wounded and untapped characters
- Reveal drafted Hidden Haven and its paired site to the opponent in the draft projection

### Text Client

- Emit body-check outcomes as text notifications so they show in the log

### Infrastructure

- Gate the card tests in CI (P01) and add an architecture roadmap planning doc
- Break the engine↔barrel import cycle with a lint guard (P02) and invert the chain↔movement-hazard cycle (P09)
- Close `TriggeredAction`'s `type` discriminant into a literal union and discriminate its verb families (P05)
- Brand id-keyed state records with `ById<V>` (P12) and split the site-rule effect family out of `types/effects.ts` (P04)
- Split `test-helpers` into a pure re-export barrel over focused modules (P13)
- Extract combat, movement/hazard, agent, and prisoner subsystems out of the monolithic reducers (P09); colocate pending-resolution kinds in a registry (P07)
- Delete dead engine code and consolidate many duplicated constraint, factory, and rendering helpers across engine and client
- Make commit/push/PR deterministic so a skill can't leave work unpushed; harden `run-ai` and `handle-mail` against headless-auth (401) failures

## 0.43.0 — 2026-06-24

The White Hand Rules

### Game Engine

- Implement The White Hand (MEWH) Fallen-wizard rules: stage points and Wizardhavens (§1, §3), Fallen-wizard marshalling points (§4), corruption-class resolution (§6), forced region movement (§7), attack permissions (§8), site-tap alignment matching (§10), Fallen-wizard mind-5 character limit (§11), and Fallen-wizard-leaves-play discard (§12)
- Implement MEWH Orc/Troll company composition and the no-hero-permanent-event / hero-item-on-Orc-Troll-bearer restrictions (§9)
- Implement the MEWH stage-resource discard action (§2), confirm the One Ring victory gate (§5), and apply the gold-ring −1 corruption modifier (§10)
- Add the White Hand (MEWH) rules implementation spec; mark §13 optional rules out of scope
- Add the anti-Fallen-wizard sideboard (MEWH, 10 cards) with combined deck limits
- Implement Fallen-wizard free general influence (CoE 3.09)
- Draft Stage resources during the character draft and enforce the agent-draft restrictions (rules 1.41, 1.42, 1.44, 1.45)
- Reveal drafted Stage resources simultaneously with the opponent's pick; keep them draftable while a character pick is pending
- Hidden Haven: pair a Ruins & Lairs site at draft time (CRF 22) and allow pairing while a character pick is pending
- Route fetch-to-deck and draw-cards short events (e.g. Dark Tryst) through the chain of effects
- Make site movement alignment-aware for multi-printing locations
- Announce both players' alignments in the text log when the game begins

### Card Certifications

- Certify the core White Hand cards: Saruman (wh-9), Isengard (wh-56), The White Towers (wh-58), A Strident Spawn (wh-61), Double-dealing (wh-66), The Fortress of Isen (wh-68), Fortress of the Towers (wh-69), Gatherer of Loyalties (wh-70), Great Patron (wh-72), Guarded Haven (wh-74), Hidden Haven (wh-75), Thrall of the Voice (wh-82), Wizard's Myrmidon (wh-84), Half-orcs (wh-87), The Forge-master (wh-117), Man of Skill (wh-119), Saruman's Machinery (wh-120), and The White Hand (wh-122)
- Certify additional hero, minion, and dragon cards across TW, LE, DM, TD, and AS sets (Swordmaster, Ambusher, Old Man Willow, Slayer, Vôteli, Wacho, A Chance Meeting, Dark Tryst, Misty Mountain Wargs, Stone Trolls, Hall of Fire, Redoubled Force, and more)
- Build the recruitment-vehicle and Wizardhaven-conversion mechanics behind Thrall of the Voice and Hidden Haven

### Card Data

- Port the full Against the Shadow (AS) card set into the engine data
- Define the remaining White Hand (WH) cards

### Web Client

- Scale the hand arc to fit so large hands stay on-screen
- Give UI card copies a distinct id so FLIP animations don't slide them from the original
- Show general influence and stage points for Fallen-wizard avatars in the card-zoom info; use a dash for missing values
- Show drafted Stage resources during the draft and clear the stale Hidden Haven hint
- Add a deck-editor error for uncertified cards; rename the editor section to "FW Sideboard" and support stage-card browsing
- Resolve card names in the reserve-creature action description

### Infrastructure

- Make card certification robust against a dirty working tree blocking the loop

## 0.42.0 — 2026-06-21

Against the Shadow

### Game Engine

- Implement Against the Shadow (MEAS) rule mechanics: creature-as-auto-attack, hoard items, off-to-the-side cards, region movement limits, and under-deeps sites
- Add the Against the Shadow rules implementation spec
- Enforce the hazards-equal-resources play-deck rule (CoE 1.5)
- Make site movement alignment-aware for multi-printing locations
- Fix item click forcing store over transfer in the browser UI

### Card Data

- Define all Against the Shadow (AS) cards
- Define all The Lidless Eye (LE) cards
- Define all The Dragons (DM) cards
- Define all The Dark Minions (TD) cards

### Web Client

- Add a phase progress meter to the game board
- Remove the instruction-text slot and relocate hints to the phase meter
- Use action wording for the strike tap choice
- Brighten company-nav arrows and label them in the shift overlay

### Infrastructure

- Add bug-report / feature-request icons to the lobby nav

## 0.41.0 — 2026-06-20

Challenge Deck J

### Card Certification

- Certify the full Challenge Deck J (Seducing Nations of Men) minion pool to 100%
- Certify the Easterling/Southron faction set: Easterlings (le-264), Southrons (le-287), Haradrim (as-63), Wain-easterlings (as-66), Corsairs of Rhûn (as-114), Balchoth (le-260), and Asdriags' Southron Oasis (le-404)
- Certify minion leaders Jerrek (le-17), Odoacer (le-28), Hador (le-14), and Indûr the Ringwraith (le-54)
- Certify minion resources Ready to His Will (le-220), Isengard (le-384), Crooked Promptings (le-178), The Tormented Earth (as-102), Hold Rebuilt and Repaired (as-88), Skies of Fire (le-228), Weariness of the Heart (le-149), and Focus Palantír (le-184)
- Certify minion items Palantír of Orthanc (le-334) and Secret Book (as-131)
- Certify Corpse-candle (le-67) and minion sites Easterling Camp (le-371) and The Wind Throne (le-413)

### Game Engine

- Fix off-by-one influence numbers on 9 factions and refresh stale influence-need expectations
- Fix Rebel-talk to defer general-influence subtraction to the next organization phase
- Record canceled attacks as faced (e.g. Orc-lieutenant +4 prowess)
- Allow sage allies (e.g. Treebeard) to tap for skill-only cards
- Fix The White Tree to find a stored Sapling in the marshalling-point pile
- Fix Little Snuffler (dm-108) body check
- Fix organization phase locking out movement after an end-of-org play

### Web Client

- Fix Marvels Told discard tooltip showing "?" for the target card
- Fix Poisonous Despair magic skill and allow searching skills in the deck editor

### Card Data

- Add the missing The Wizards (TW) cards, completing the set at 500/500
- Mark magic on the relevant cards

## 0.40.0 — 2026-06-15

Challenge Deck I

### Card Certification

- Certify the full Challenge Deck I (Morgul Rallying Cry) minion pool to 100%
- Certify The Witch-king (le-58), Orc Brawler (le-30), and Horseman in the Night (le-16)
- Certify leader-controlled factions le-262/275/279/281/282/291, including Orcs of Udûn (le-282) and Nûrniags (le-273)
- Certify Asdriags (as-111), That Ain't No Secret (le-240), Gifts as Given of Old (le-188), and Awaiting the Call (le-165)
- Certify Last Child of Ungoliant (le-153)
- Certify Doors-of-Night hazards Foul Fumes (tw-36), Long Winter (le-117), and Snowstorm (tw-91)
- Certify Cruel Caradhras (td-9), Scatha Ahunt (td-61), Withered Lands (td-85), and Above the Abyss (as-77)
- Certify minion sites Minas Tirith (le-391), Cirith Gorgor (le-361), Cirith Ungol (le-362), and Nûrniag Camp (le-396)
- Certify Helm of Fear (as-126) and Great Bats (as-74)

### Game Engine

- Implement CoE rule 5.31 force-return-to-origin and the Doors of Night site-tap subsystems
- Expose the owning player's alignment to tap-sites-in-play effects
- Allow `buildForceReturnMHState` to accept the moving player's alignment
- Improve site validation

### Text Client

- Share the `parseServerMessage` helper across text clients

### Web Client

- Share `escapeHtml` across lobby browser modules

### Infrastructure

- Consolidate duplicated rule-test fixtures into `test-helpers` (`buildTwoCompaniesAt` and others)
- Unify duplicate `resolvePath` into a shared path-resolver module
- Reduce duplication and unsafe casts in `recompute-derived`
- Add typed effect-finder helpers, an `asViable` helper, and a `notPlayable()` builder for legal-actions

## 0.39.0 — 2026-06-11

Deck Editor and Validator

### Web Client

- Add a card browser to the deck editor with [+] buttons on the Pool, Resources, Hazards, and Sideboard sections
- Card browser filters: alignment and type groups, character category icons, resource category toggles, starting-item toggles, and a clear-all button
- Card browser search matches card name, card text, and keywords
- Add a starting-items selector and an Add All button to the card browser
- Add site browsing to the deck editor with distinct hero/minion site colors
- Add a new-deck button to My Decks with a pre-filled sites section
- Run deck validation in the deck editor
- Add clear-section buttons to deck editor sections and always confirm section clears
- Unify ally/faction colors, split the minion resource palette, and render The Balrog avatar in deep red
- Card browser polish: corner X close button, "Add a card" title, uncut hover outline, fixed collapsing name boxes, and the target section named in the browser title
- Re-enable deck editing buttons and reserve preview image space while loading

### Game Engine

- Announce deck legality to both players when a game starts
- Fix minion challenge deck pools exceeding the 10-character limit

### Card Data

- Add The Balrog and fallen-wizard avatar card data
- Add the starting-item keyword and tag eligible cards, narrowing the category per card rules
- Fix card data per CoE database checks
- Mark all region cards as certified

### Infrastructure

- Code-quality refactors (PRs #918–#926): shared tooltip-menu helper, browser JSON API helpers, shared dialog builder, company-count helpers, shared text-client plumbing, lobby route auth/error scaffolding, attachment reducer helpers, server connection/child-process dedup, and logEvaluated consolidation

## 0.38.0 — 2026-06-10

Challenge Deck H

### Card Certification

- Certify the Uruk-hai and Half-orc characters: Ill-favoured Fellow (wh-5), Lugdush (wh-6), Sly Southerner (wh-10), Grishnákh (le-12), Orc Tracker (le-34), Ufthak (le-48) — race keywords plus body-check discard rules
- Certify Hoarmûrath the Ringwraith (le-53) — Darkhaven hand-size bonus and per-mode stats
- Certify the Undead creatures: Ghouls (le-73), Stirring Bones (le-92), Wisp of Pale Sheen (dm-113), Plague of Wights (le-130), Ghosts (le-72) — and Orcs of Mirkwood (le-277)
- Certify minion sites: Dead Marshes (le-364), Mount Doom (le-393), Mount Gram (le-394), Sarn Goriwing (le-401), Shelob's Lair (le-402)
- Certify Strange Rations (le-345), Blasting Fire (wh-51), Records Unread (as-130), Snaga-hai (le-286), Sneakin' (le-231), War-wolf (le-157), Great Lord of Goblin-gate (as-75)
- Certify Fell Rider (le-183), Vile Fumes (wh-54), Exhalation of Decay (dm-55)
- Challenge Deck H (Stealthy Tribe) is now 100% certified

### Game Engine

- Implement The One Ring win conditions for all four alignments
- Wire Ringwraith avatars' per-mode stat modifiers
- Fix Orc-scout half-size omission; read Barad-dûr gold-ring modifier from card data

### Web Client

- Deck editor: add +/− quantity buttons to card rows and a near-fullscreen character card browser with name search, hover preview, and deck-alignment filtering (temporarily hidden behind a CSS flag)

### Infrastructure

- Deduplicate company/character text rendering, in-play checks, and site-grouping logic; extract item/ally context-building helpers

## 0.37.0 — 2026-06-08

Challenge Deck G

### Card Certification

- Certify Dwar the Ringwraith (le-52), Bold Thrust (le-172), Burning Rick, Cot, and Tree (le-173), Diversion (le-180), I'll Report You (le-196), Under His Blow (le-247), Swarm of Bats (le-237), Swift Strokes (le-238)
- Certify Grey Mountain Goblins (le-266), Ice-orcs (le-270), Orcs of Gundabad (le-276)
- Certify Gleaming Gold Ring (le-311), The Arkenstone (le-418), Thrór's Map (as-134)
- Certify Dire Wolves (le-68), Giant Spiders (le-75), Wargs (le-98), Watcher in the Water (le-99), Wolves (tw-114)
- Certify Summons from Long Sleep (as-39), Stay Her Appetite (le-140), Bûrat (as-1), Orders from Lugbúrz (as-94)

### Game Engine

- Fix a large class of "card disappearance" bugs: dispatch hazards attached to characters that are eliminated, discarded, influenced away, or removed during combat (including CvCC) to the hazard player's discard pile
- Revert followers to general influence (or discard their hazards) when their controlling character dies or is discarded
- Return the destination site to the location deck when a moving company is merged into another
- Stored items now go to the marshalling-point (kill) pile
- Add missing `findIndex`/`-1` guards across site, organization, untap, movement-hazard, event, influence, and sideboard reducers to prevent crashes
- Implement `validateDeck()` with structured per-section `DeckValidationError`, covering deck-construction rules (unique/mind limits, avatar alignment, banned cards, faction race, location-deck site types, pool limits)

### Rules Tests

- Implement rule tests across deck construction (1.04, 1.05, 1.09, 1.10, 1.12, 1.13, 1.14, 1.16, 1.17, 1.19, 1.20, 1.26, 1.27, 1.28, 1.50), organization (3.04, 3.05, 3.41), combat (8.25, 8.27, 8.39), and events (9.09, 9.11)
- Specs for the One Ring win condition across every alignment, plus result recording

### Web Client

- Show "no tap, −3 to roll" label for the noTap grant-action variant
- Remove the "You have NEW mail" system notification on mail delivery

### Decks

- Remove unplayable Palantír/Scroll resources from Challenge Deck F; fix incorrect site card IDs in minion challenge decks

### Infrastructure

- Guard the pseudo-AI launcher against `ERR_IPC_CHANNEL_CLOSED`
- Add a Game Saving section to the player guide

## 0.36.0 — 2026-06-04

Challenge Deck F

### Card Certification

- Certify Lagduf (le-18), Lieutenant of Morgul (le-22), Muzgash (le-25), Tros Hesnef (le-46), Radbug (le-38), Orc Veteran (le-35)
- Certify Tûma (as-5), Wûluag (as-6): implement troll-trio buddy mechanics
- Certify Dancing Spire (as-143), Gold Hill (as-148), Irerock (as-151)
- Certify Caves of Ûlund (le-360), Dale (le-363), Gondmaeglom (le-379), The Lonely Mountain (le-387), Mount Gundabad (le-395), Raider-hold (le-399)
- Certify Minor Ring (le-324), Sable Shield (le-341): implement absorb-wound effect
- Certify Stench of Mordor (le-141), By the Ringwraith's Word (le-174)
- Partial implementation: Bûrat (as-1), Orders from Lugbúrz (as-94)

### Game Engine

- Implement absorb-wound DSL effect for Sable Shield
- Implement troll-trio buddy-play mechanics for Tûma, Wûluag, and Bûrat characters
- Recognize `play-deck` as a valid source token in fetch-from-pile actions
- Remove duplicate effects arrays from troll trio character data

### Web Client

- CvCC combat UI improvements
- Add End key shortcut to toggle full-screen map
- Show Pass button in relevant combat step

### Infrastructure

- Remove snapshot and reset features from dev mode
- Add player guide with instructions for credits, bug reports, and feature requests

## 0.35.0 — 2026-06-02

The Liddless Eye

### Game Engine

- Implement company composition rules 3.24–3.26: company size limits, race-mixing restriction, and leader restriction
- Implement rule 9.23: gold ring EOT automatic test at darkhavens
- Implement rule 2.09: both piles empty triggers play-deck exhaustion check
- Implement rule 8.22: creature MP awarded by alignment of defeating company
- Implement rule 2.07: permanent events discarded when company loses all characters
- Implement 6 missing MELE (Lidless Eye) features: Ringwraith body check, covert/overt modes, trophies, item MP by alignment, One Ring win condition, and audience reveal at darkhavens
- Extend `cancel-influence` DSL effect with `requiredSkill` and `targetKindFilter` fields
- Add site-phase gold ring auto-test DSL support
- Fix CvCC: use site-name comparison for declare-company-attack reducer
- Fix CvCC: match opponent companies by site name for initiation check
- Fix CvCC: Eagles' Eyrie attacker-chooses-defenders rule not applied
- Fix combat: treat `modify-attack` as combat-only in short-event playability checks
- Fix le-174: enforce ringwraith-at-same-site condition for By the Ringwraith's Word
- Fix le-174: require character target for play
- Fix sideboard: prevent card identity leak via lastActionCardDefs on exchange

### Web Client

- Add Attack button for declare-company-attack step in CvCC
- Fix cancel-river tooltip to include character name when multiple rangers can act
- Add two-step target selection for character-targeting permanent events

### Card Certification

- Certify le-7: Dôgrib
- Certify le-219: Poisonous Despair
- Certify le-278: Orcs of Moria
- Certify le-333: Palantír of Minas Tirith
- Certify le-339: Red Book of Westmarch (minion)
- Certify le-343: Scroll of Isildur (minion)
- Certify le-352: Barad-dûr
- Certify as-68: Bow of the Galadhrim
- Certify as-76: Regiment of Black Crows
- Certify as-123: Dwarven Ring of Thélor's Tribe
- Certify as-124: Dwarven Ring of Thrár's Tribe
- Certify dm-109: Nameless Thing
- Certify td-27: From the Pits of Angband
- Certify wh-43: Crept Along Cleverly
- Certify wh-47: Piercing All Shadows

### Card Data

- Add card data for le-334: Palantír of Orthanc

### Infrastructure

- Fix challenge decks F, I, J: correct card counts and wrong-alignment palantírs/scrolls
- Fix AI runner: log and retry on next_request_id failure instead of silent exit

## 0.34.0 — 2026-05-31

Company vs Company Combat

### Game Engine

- Implement Company vs Company Combat (CvCC) — rules 8.38–8.42: declare company attack, three-phase strike assignment (defender-untapped → attacker-untapped → defender-any), attacker rolls and can be wounded, CvCC strike sequence, alignment restrictions, and hazard restrictions
- Implement company covert/overt status computed from company composition (Orc/Troll/Balrog-avatar presence)
- Block wizard/balrog players from playing agent characters (rules 1.3.W2, 2.II.2.2.5)
- Fix: wizard avatar eliminated (not discarded) on corruption-check roll equal to CP
- Split victory pile into separate MP pile and eliminated pile
- Scale unhandled roll actions by dice success probability (AI improvement)
- Fix: `company.moving` filter incorrectly true for stationary companies
- Add Under-deeps / surface map schematic with level-based company visibility
- Fix: agent character restoration — default agents to `[]` when restoring older saves

### Card Certification

- Certify le-179: Deeper Shadow (site-path transform, hazard-limit, conditional corruption check)
- Certify le-212: Not Slay Needlessly
- Certify le-225: Ruse (diplomat/covert cancel-attack)
- Certify le-226: Secrets of Their Forging
- Certify le-241: That's Been Heard Before Tonight (partial; general-influence permanent-event)
- Certify le-246: To Satisfy the Questioner
- Certify le-253: Weigh All Things to a Nicety
- Certify le-296: Woses of the Eryn Vorn
- Certify as-90: Join With That Power
- Certify as-101: Tokens to Show (new faction card)
- Certify as-108: Well-preserved

### Documentation & Specs

- Add local CRF 22 copy; use it in bug-report skill
- Add MELE missing-features spec (`specs/2026-05-31-mele-missing-features.md`)
- Update CvCC plan to match current codebase file structure

## 0.33.0 — 2026-05-27

Map

### Web Client

- Add Middle-Earth map image stitched from Heinrich-Barth tile set
- Implement radar minimap overlay (fixed bottom-right, matches map aspect ratio)
- Implement full-screen map overlay with zoom, pan, and keyboard dismiss
- Show current company locations and destination dots on both radar and full map
- Show opponent company locations and destinations on full map
- Show agents on map radar and full-screen overlay
- Add Under-deeps schematic and movement overlay
- Add two-line tooltip (company name + site name) on full-map dots
- Spread overlapping company dots radially
- Generalize visual-mode action buttons into a panel above the radar
- Fix radar not appearing; fix keyboard crash on undefined `e.code`

### Game Engine

- Fix: faction-influence-roll free DI not available when follower is present
- Fix: Muster (and influence-boost events) shown as playable before influence attempt declared
- Fix: Torque of Hues in hand must not be offered for cancel-attack
- Fix: summon-card collision — scan characters/agents when minting instance ID
- Fix: `activeConstraints` not included in faction-influence-roll need calculation

### Infrastructure

- Unify `dodge-strike`, `modify-strike`, `reroll-strike` into `strike-modifier` DSL effect
- Unify `modify-attack-from-hand` into `modify-attack` with `fromHand` flag
- Replace hardcoded palantír text/name checks with `can-use-palantir` flag
- Merge `tap/untap-hazard-limit` into `hazard-limit-swap`; keyword-based One Ring check
- Fold three zero-field effects into `play-flag`
- Generalize two single-use DSL types to reduce engine special-cases
- Add 17 named engine helpers (`defById`, `playerById`, `findById`, `companyById`, `hazardPlayer`, `activePlayerState`, `setupStepContext`, `diceRollEffect`, `companySubphaseScope`, `matchesDefinition`, `matchesContext`, `resolveDef`, `cardName`, `characterEntries`, `characterIds`, `characterEntries`, `countConstraintsFromDefinition`)
- Remove dead engine exports; simplify redundant double casts on branded IDs

### AI

- Fix: AI scores movement toward sites where resource events can be played
- Fix: AI movement score boost to fix AI staying idle with playable items

## 0.32.0 — 2026-05-25

Challenge Deck E

### Card Certification

- Certify tw-122 (Arwen): +7 DI usable only against Aragorn II
- Certify tw-129 (Bergil): character with no special effects
- Certify tw-149 (Faramir): +2 DI against Rangers of Ithilien faction
- Certify tw-151 (Forlong): check-modifier effects
- Certify tw-166 (Imrahil): +2 DI against Knights of Dol Amroth
- Certify tw-196 (Beautiful Gold Ring): fix corruptionPoints, add test
- Certify tw-224 (Elf-stone): +2 DI vs Elf character/faction, no duplication per character
- Certify tw-266, tw-274 (grant-skill effect)
- Certify tw-289 (Narsil): +1 prowess and +1 direct influence, 2 CP
- Certify tw-316 (Return of the King): Aragorn II only, Minas Tirith, +3 DI, blocked by Denethor II
- Certify tw-330 (Star-glass): cancel-attack/modify-attack with bearer-tap cost
- Certify tw-349 (Thorough Search): extra scout item play without site tap
- Certify tw-352 (Tower Guard of Minas Tirith): +1 DI vs Dúnedain, influenceNumber 8
- Certify tw-82 (Pûkel-men): base keying {S}{D}, alt keying 10 named Pûkel regions
- Certify le-71 (Ent in Search of the Entwives): detainment vs hero/covert
- Certify le-91 (Sons of Kings): playable only against minion companies
- Certify le-128 (Nothing to Eat or Drink): company-targeting permanent hazard with -1 prowess/body
- Certify as-34 (Power Built by Waiting): tap for +1 hazard limit, no-auto-untap
- Certify td-4 (Bairanax Ahunt): ahunt Dragon attack, base regions + Doors of Night extension
- Certify td-34 (Incite Denizens): duplicate auto-attack at R&L sites

### Game Engine

- Implement grant-skill DSL effect (tw-266, tw-274)
- Implement gold ring test replacement mechanic (Rules 9.21/9.22)
- Auto-advance through set-hazard-limit and order-effects steps in MH phase
- Fix: Muster (tw-288) not playable during movement-hazard phase
- Fix: game hang when corruption checks queued for eliminated character
- Fix: Tidings of Bold Spies incorrectly offered against stationary companies
- Fix: Noble Steed cannot cancel strike when it is itself the strike target
- Fix: New Friendship shown as playable during movement-hazard phase
- Fix: Goldberry cancel-attack not offered when card is in hand
- Fix: ally play-target site filter not evaluated during site phase
- Fix: correct all straight-apostrophe mismatches in card data
- Fix: correct card name accents and punctuation (Bert/Tom/William troll trio)

### Web Client

- Toggle between all-companies view and combat arena during battle

### AI

- Recognize DSL-based items as playable at movement destinations
- Preserve AI deck selection when lobby deck list refreshes
- Use hero Beorn's House in Radagast challenge deck

### Infrastructure

- Fix: show opponent sideboard count instead of always zero
- Docs: add game map visualization spec

## 0.31.0 — 2026-05-23

Challenge Deck D

### Card Certification

- Certify tw-119 (Annalena): unique elf character with no special effects
- Certify le-143 (Tidings of Bold Spies): implement duplicate-site-auto-attacks effect
- Scaffold le-142 (Thrice Outnumbered) and as-68 (Bow of the Galadhrim)

### Game Engine

- Implement duplicate-site-auto-attacks DSL effect (le-143)
- Fix A Friend or Three to allow DI boost during influence-attempt chain
- Fix Great-road haven-return to properly handle site card lifecycle
- Fix Great-road to use `targetCompanyId` for company-targeted short events
- Fix Hundreds of Butterflies to restrict to characters in the active moving company
- Fix Dwarves Are upon You! to not be offered as chain response before combat starts
- Fix Lucky Search: enforce play-window `siteTypes` restriction at haven
- Generalize 5 single-card DSL effect types into shared primitives (removes ~240 LOC)
- Extract `getOnEventEffects` helper to eliminate on-event scanning boilerplate
- Remove duplicate and orphaned JSDoc blocks across engine reducers

### Rules Tests

- Implement rules 1.04 (unique card limits), 1.05 (agent mind limit), 1.57 (dice rolling)

### AI

- Use MP-based scoring in AI movement planner
- Skip store-item action when it yields no additional marshalling points
- Improve Foolish Words play strategy (target character with highest free DI)

### Infrastructure

- Fix set haven/darkhaven site qty to 1 in all deck files
- Restore missing 2nd Promptings of Wisdom in challenge-deck-d sideboard
- Improve test readability across rules tests

## 0.30.0 — 2026-05-19

Challenge Deck C

### Card Certification

- Certify (hazard creatures): Abductor (tw-1), Brigands (tw-17), Lawless Men (le-82), Stout Men of Gondor (as-21), Sellswords Between Charters (le-89), Rank upon Rank (dm-80), Horse-lords (le-78), Thrice Outnumbered (le-142), Wain-easterlings (as-60)
- Certify (hazard events): Glamour of Surpassing Excellance (as-49)
- Certify (resources): Bow of the Galadhrim (as-68), Torque of Hues (tw-351), Beornings (tw-197), Easterlings (tw-222), New Friendship (tw-292), A Friend or Three (tw-189), Men of Dorwinion (tw-278), Hundreds of Butterflies (dm-142), Fellowship (tw-240), Quickbeam (tw-307), Thranduil (tw-184), Halbarad (tw-162), Háma (tw-165), Beorn (tw-126)
- Certify (items): Noble Steed (wh-33), Bow of Dragon-horn (td-102), Thrór's Map (td-158), Wormsbane (td-172), Bounty of the Hoard (td-101), Lucky Search (tw-269), Great-road (tw-249), Flatter a Foe (td-116), Men of Dale (td-138)
- Certify (hazard/event): The Under-galleries (dm-37)

### Game Engine

- Implement `force-discard-one-company-item` effect (Brigands tw-17)
- Implement `discard-on-wound` engine support (Abductor tw-1)
- Implement `cancel-attack` for items with self-and-bearer cost (Torque of Hues tw-351)
- Implement `cancel-strike` for mounts (Noble Steed wh-33)
- Implement `check-modifier` for Dúnedain influence (Easterlings tw-222)
- Implement `no-attack-site-keyed` flag (Quickbeam tw-307)
- Implement `deck-search-attack` engine (Lucky Search tw-269)
- Implement `ahunt-attack` effect (Scorba Ahunt td-64)
- Implement `flattery-cancel-attack` mechanic (Flatter a Foe td-116)
- Implement `stolen-knowledge` site rule (The Under-galleries dm-37)
- Implement `discard` on Thrór's Map to untap Dragon lair site
- Implement `company-modifier` and membership-change discard (Fellowship tw-240)
- Implement `hoard-bounty` site-phase event (Bounty of the Hoard td-101)
- Implement taking-prisoner rules (CoE 8.35/8.36), certify Flies and Spiders hazards (dm-58, dm-179)
- Implement `company.containsDiplomat` for New Friendship (tw-292)
- Implement `subtract` op for `enemy-modifier` (Wormsbane td-172)
- Implement `strikesModifier` on `modify-attack` (Bow of Dragon-horn td-102)
- Implement `end-of-org` haven restriction and movement bonus (Great-road tw-249)
- Implement rule 1.53 hand-size-modification tests
- Fix: `players` field changed to tuple — fix type error
- Fix: `perf` incremental TypeScript build cache (5s → 0.4s on no-op)
- Fix: creatureRace test assertions normalized to 'man' for Men creature cards

### Infrastructure

- `run-ai`: add `max-iterations` argument and fail-fast on handle-mail error

## 0.29.0 — 2026-05-12

Dark Minions Rules

### Game Engine

- Implement under-deeps movement: organization actions, M/H reveal, roll step, and Balrog sites (rules 10.1–10.3)
- Implement generalized auto-attack system: dynamic second auto-attacks from hand (DM Under-deeps), permanent-event-sourced attacks (Balrog, Spawn), and Nazgûl permanent-event attacks
- Implement `discard-item` strike effect (dm-43 An Article Missing)
- Implement `discard-minors-for-major` site rule (dm-32 Hermit's Hill)
- Implement `cancel-first-attack-if-in-play` effect (dm-38 The Under-gates)
- Implement short-event `on-event: self-enters-play → add-constraint` for `site-phase-do-nothing` (tw-53 Lost in Free-domains)
- Fix: faction influence using full DI instead of free DI
- Fix: under-deeps sites incorrectly offered via region movement
- Fix: strike-event and reroll-strike cards resolve immediately (no spurious sub-chain)
- Fix: `play-short-event` routing when both chain and combat are active (hazard chain responses now reach correct handler)
- Fix: nightly test failures from uncomputed effectiveStats and stale baseline
- Fix: Unicode hazard name matching in creature DSL conditions (curly quotes, û)
- Refactor: remove `corruptionModifier` field — replaced by generic `check-modifier` DSL effect
- Add Roll button and dice feedback UI for under-deeps movement
- Certify: Lost in Free-domains (tw-53), An Article Missing (dm-43), The Gem-deeps (dm-30), The Iron-deeps (dm-33), The Pûkel-deeps (dm-34), The Sulfur-deeps (dm-35), The Under-courts (dm-36), The Under-gates (dm-38), The Under-grottos (dm-39), The Under-leas (dm-40), The Under-vaults (dm-41), Urlurtsu Nûrn (dm-42), Hermit's Hill (dm-32), Haudh-in-Gwanûr (dm-31), The Dwarves Are upon You! (dm-124)
- Certify (hazard creatures): Cave Worm (td-8), Giant Spiders (tw-40), Lesser Spiders (td-42), Neeker-breekers (tw-493), Wargs (tw-109), Watcher in the Water (tw-110)
- Certify (hazard events): Despair of the Heart (tw-27), Full of Froth and Rage (as-30), Cunning Foes (dm-50), The Dwarves Are upon You! (dm-124)
- Certify (characters): Boromir II (tw-134), Dori (tw-141), Fíli (tw-150), Gimli (tw-159), Glóin (tw-160), Kíli (tw-167), Óin (tw-172), Pallando (tw-175), Thorin II (tw-183), Drór (dm-6), Bill Ferny (dm-3), Wormtongue (dm-27), The Grimburgoth (dm-15), Fori the Beardless (dm-11)
- Certify (resources): Durin's Axe (tw-212), Iron Hill Dwarves (tw-261), The Old Thrush (tw-346), Not at Home (td-143)
- Certify (sites, 30+): multiple TW hero sites, AS minion sites, DM sites, TD sites

### Bug Fixes

- Fix: dodge reveal card identity to opponent when played
- Fix: hide fetched card identity from opponent toast for fetch-from-pile
- Fix: hazard short event incorrectly placed in cardsInPlay during fetch resolution
- Fix: bearer-cannot-untap must not block healing at a haven
- Fix: allow regular items to be stored at Havens
- Fix: short events not accepted during end-of-turn discard and signal-end steps
- Fix: wire tap-item-for-strike action to combat UI item click handler
- Fix: Halfling Strength heal option incorrectly offered outside organization phase
- Fix: reclassify Alone and Unadvised as hazard-event so Marvels Told can target it
- Fix: Orc-lieutenant on-guard +4 prowess not applied when site auto-attack already faced
- Fix: bearer-cannot-untap inverted — blocked healing instead of allowing it

## 0.28.0 — 2026-05-08

Agent Basics

### Game Engine

- Implement full agent hazard lifecycle: state model, play-agent-hazard, reveal-agent, turn actions (move, return-home, heal, untap, face-down, key-creatures), agent combat with face-down prowess/body modifiers, and agent discarded at end of turn (rules 9.01–9.08)
- Implement agent influence attempt during M/H phase (rule 10.14)
- Implement agent-tapped-for-hazard-effect (rule 9.06) and alignment-specific movement (rule 9.08)
- Implement creature hazard playing and combat resolution via creature-race-choice (rules 5.18–5.19)
- Fix: agent movement limited to same/adjacent region (rule 9.02); haven restriction on reveal (rule 9.07)
- Fix: Choking Shadows not playable when no effect can trigger (rule 5.1.2)
- Fix: Slayer cancel-by-tap allows the defending character to tap ("any one character")
- Fix: rule 2.II.7.1 same-origin check uses site definition ID, not instance ID
- Fix: short events can be discarded during end-of-turn phase
- Fix: Vilya and resource short-events playable during combat
- Fix: sideboardAccessedDuringUntap reset at start of each new turn
- Fix: decrement multiAttackCount when cancelling a multi-attack strike (Assassin)
- Fix: on-guard creature reveal requires site-type keying, not region-type
- Fix: agents untap during active player's untap phase
- Refactor: replace underDeeps boolean flag with `under-deeps` keyword on all sites
- Refactor: consolidate 4 single-use DSL effect types into `play-flag` / `stat-modifier`
- Certify: Great Need or Purpose (dm-62) + AgentInPlay remainingActions

### Card Data

- Add all 31 Dark Minions characters to card data
- Add 3 agent hazard events; fix `unique`/`eventType`/`name` across 14 data files
- Add `agent` keyword to DM characters; seed dm-characters with sample agents
- Add 31 new sites: 22 Under-deeps (DM set), 9 hero sites (TW/AS/TD sets)

### Web Client

- Render agents as virtual company blocks in all-companies view
- Highlight agent cards in hand when play-agent-hazard action is legal
- Show both players' actions in the game log panel
- Show dimmed "Waiting…" indicator in action panel when no viable actions exist
- Fix: combat arena z-index so battle info renders above opponent arc
- Fix: AI opponent no longer stuck in setup after game-server rejoin
- Fix: hide hazard limit chip in all-companies view; restore debug scrolling

### Infrastructure

- Add sample agent deck (dwarf characters for development testing)
- Add sample deck containing all 97 hero sites

## 0.27.0 — 2026-04-28

Test Coverage

### Game Engine

- Implement rules 2.07/5.27/5.28/6.17: same-site company cleanup, hazard-player resume, skip empty M/H and site phases
- Fix: allow resource short events in M/H chain; fizzle hazards exceeding limit at resolution
- Fix The Windlord Found Me not tapping the site on play
- Fix The Cock Crows discarding hazard to wrong player's pile

### Web Client

- All-companies view: hide hand arcs, deck boxes, text log, and action buttons; reclaim vertical space
- View toggle button fixed-positioned for consistent placement across modes
- Text log hidden when switching to debug view
- Highlight select-card-bearer characters in company view
- Use highlight-and-click flow for discard-target short events
- Show card-triggered-attack source in combat view
- Increase AI delay for combat actions for better followability
- Correct challenge deck card counts to match official 119-card format

### Rules Tests

- Implement rule tests batch 1: convert 57 `test.todo()` stubs to passing tests (rules 1.x, 2.x, 3.x, 5.x, 6.x, 8.x, 9.x, 10.x)

### Docs

- Glossary: add Score Box entry
- Clarify AI roles and MECCG complexity in README intro

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
