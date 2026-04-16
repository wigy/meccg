# Roadmap

Derived from the mission (`mission.md`), current `TODO`, and shipped work
through `0.21.0` (see `CHANGELOG.md`). Organised by mission pillar. Each
pillar lists what's already in place and what remains.

## 1. Fully Playable MECCG

A complete implementation of the official CoE ruleset for all alignments.

### Done

- Pure-reducer engine with the full phase machine: untap, organization,
  long-event, M/H, site, combat, end-of-turn, Free Council end-game.
- Chain of effects, on-guard placement and reveal, automatic attacks,
  opponent influence attempts.
- Sideboard access (organization tap, untap hazard access, deck exhaustion).
- Card effects DSL with condition matcher, stat modifiers, play-targets,
  check modifiers, combat rules, grant-action, etc.
- First hero demo deck (Stewards of Gondor) and **Challenge Deck A** fully
  certified.

### Next

- **Finish Challenge Decks B–J** — certify every card in the nine remaining
  challenge decks (currently unsorted items (B)–(J) in `TODO`).
- **Rules-test coverage** — promote each `test.todo()` into a real test.
  Sections 00–10 are all listed in `TODO` as "Finalise tests section NN".
- **DSL generalization** — keep replacing hardcoded keywords with generic
  filter/condition expressions, per the plan referenced in `TODO`.

### Expansion rules (EPICs in `TODO`)

- **The Wizards:** Stewards of Gondor, Spies and Traitors.
- **The Dragons:** Hoard.
- **Dark Minions:** Agents.
- **The Lidless Eye:** Company-vs-Company, Detainment attack.
- **Against the Shadow:** minion-specific rules.
- **The White Hand:** fallen-wizard-specific rules.
- **The Balrog:** Under-deeps movement.

## 2. Decent AI Opponent

A challenging solo experience and a driver for automated testing.

### Done

- Smart AI heuristic strategy with movement planning and a council
  heuristic (replaces earlier Random AI).
- Heuristics: always draw max, skip entry when no playable cards, only
  travel when there's something to play at the destination.
- Pseudo-AI panel in the web client for stepping/inspecting AI choices.

### Next

- **Stronger evaluation** — deck-aware planning, hazard baiting, company
  composition, sideboard use.
- **Alignment coverage** — AI for minion, fallen-wizard, and balrog
  alignments (currently hero-centric).
- **Difficulty tiers** — pick from easy/medium/hard when starting an AI
  game.
- **Self-play harness** — full games played by 2 Cypress robots in
  parallel, with `--seed` support on game-server and clients and roll
  checks to detect RNG divergence (see unsorted item in `TODO`).

## 3. Spectating Games

Watch live games played by others.

### Done

- Game server supports spectator sessions (since 0.1.0).

### Next

- **Lobby spectate flow** — browse ongoing games in the lobby UI and join
  as a spectator via the lobby's `/game/<port>` proxy.
- **Per-side reveal rules** — spectators see the public projection, with
  an optional "god view" for finished / training games.
- **Replay** — scrub through a finished game using the `.jsonl` game log
  as the source of truth.

## 4. Good Deck Editor

First-class deck construction inside the browser UI.

### Done

- Personal deck browser, save/load, catalog decks, quick-copy, favourites.
- Card preview panel with type-coloured names and bronze-star badge for
  certified cards.
- Missing-card warnings for decks containing uncertified cards.
- Card request button for adding missing cards via the mail workflow.

### Next

- **Full edit flow** — the editor still surfaces a "not yet implemented"
  notice; finish add/remove/quantity editing and persistence.
- **Deck validation** — enforce uniqueness (1 unique / 3 non-unique),
  sideboard size, alignment rules, starting-site legality, pool rules
  (listed as "Deck Validation" in `TODO`).
- **GCCG import** — parse the GCCG deck format so existing collections
  can be brought in (listed as "Uploading Gccg deck format" in `TODO`).
- **Preview / playtest** — spin up a solo draft-&-test loop directly from
  the editor.

## 5. Tournament System

Run organised, multi-round events with the lobby as the host.

### Done

- Lobby with auth, online presence, matchmaking, credits, mail, and game
  lifecycle management.
- Game results are persisted per player (`~/.meccg/players/<name>/games.json`).

### Next (all greenfield; "Tournaments" is one line in `TODO`)

- **Event objects** — create/join/close tournaments from the lobby.
- **Formats** — Swiss, round-robin, single-elim; configurable deck-lock
  rules.
- **Pairing & standings** — automatic pairings each round; live standings
  view.
- **Deck registration** — locked deck lists per event, using the deck
  editor's validation.

## 6. Learning Tool

Leverage the engine's knowledge of every rule to teach the game.

### Done (latent support)

- Engine logs every decision with values via `logHeading` / `logDetail` /
  `logResult`.
- Non-viable hand cards already show a reason tooltip.
- Active constraints render on companies; situation banner explains
  waiting states.

### Next (greenfield)

- **"Why?" on every legal / illegal action** — surface the logged
  reasoning in the UI on demand.
- **Guided tutorials** — scripted scenarios that walk through drafts,
  movement, combat, corruption, influence, chain of effects.
- **Rule lookup** — click any game concept to jump to the relevant CoE
  rule, with the engine highlighting which clauses applied to the current
  state.
- **Puzzle mode** — preset states with a "find the best play" goal,
  scored by the engine.

## 7. Cross-Cutting Quality

Items that support every pillar above.

- **Keyboard support** — Shift/Ctrl reveals shortcuts; numbers + a–z map
  to hand cards (listed under `FEATS` in `TODO`).
- **Release discipline** — continue the per-release changelog format and
  the pre-push checklist (build / test / test:nightly / lint / lint:md).
- **Docker** — keep the production + dev image variants current.
- **Docs** — keep `docs/coe-rules.md`, `docs/card-effects-dsl.md`, and
  `docs/testing-plan.md` in sync with the engine.
