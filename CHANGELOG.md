# Changelog

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
