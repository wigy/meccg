# AI Opponent Implementation Plan

## Context

The game currently has a random AI that picks uniformly from legal actions. We want a competent AI opponent that makes strategic decisions. The infrastructure already exists (AiStrategy interface, ai-client.ts process, lobby integration) -- we just need a smarter strategy.

## Approach: Heuristic/Rule-Based with Phase-Specific Evaluators

**Why not LLM?** 1-5s latency per decision, hundreds of decisions per game, high token cost, most decisions have clear optimal plays needing arithmetic not reasoning.

**Why not MCTS?** Imperfect information game, no client-side forward simulator, enormous branching factor.

**Why heuristic?** The `AiStrategy.weighActions()` interface is designed for exactly this. Legal actions are pre-computed by the server. Heuristics are fast, debuggable, and incrementally improvable. Anything unhandled falls through to random play.

## Module Structure

All new files under `packages/text-client/src/ai/`:

```text
ai/
  index.ts                    # (modify) Add 'heuristic' to STRATEGIES map
  strategy.ts                 # (unchanged) AiStrategy interface
  random.ts                   # (unchanged)
  heuristic.ts                # Main strategy - dispatches to phase evaluators
  evaluators/
    types.ts                  # ActionEvaluator interface
    common.ts                 # Shared scoring utilities
    setup.ts                  # Draft, item assignment, site selection, placement
    organization.ts           # Character play, company mgmt, movement planning
    movement-hazard.ts        # Path declaration (resource), hazard play (hazard)
    combat.ts                 # Strike assignment, resolve-strike, support
    site-phase.ts             # Enter site, resource play, influence attempts
    end-of-turn.ts            # Discard selection, free council, sideboard
  card-knowledge.ts           # Static card evaluation helpers
```

### ActionEvaluator Interface

```typescript
interface ActionEvaluator {
  readonly phases: readonly string[];
  score(action: GameAction, context: AiContext): number | null;
}
```

Returns a weight for an action, or `null` to fall through to default scoring.

## Phase-by-Phase Scoring

### Setup (`setup.ts`)

- **Draft picks**: Score by `MP*3 + prowess + body + DI*2`. Prioritize avatars. Bonus for homesite overlap with deck.
- **Item assignment**: Weapons to highest-prowess characters, protection to low-body.
- **Site selection**: Prefer havens.
- **Placement**: Group avatar with strongest characters, 2+ per company.

### Organization (`organization.ts`)

- **Play character**: `MP*5 + prowess + DI*2`, penalty for mind strain.
- **Movement planning**: Cross-reference hand resources with destination site types. Score = `playable_count * 10 + site_MP_potential`. Penalty for dangerous regions.
- **Company management**: Merge weak companies, split large ones with two destinations. Generally conservative.
- **Pass**: Baseline 3-5, higher when movement is set and no playable characters in hand.

### Movement/Hazard (`movement-hazard.ts`)

- **As resource player**: Process safer companies first, prefer shorter paths.
- **As hazard player**: Score creatures by `prowess * strikes - company_prowess/2`. Prefer creatures exceeding weakest defender. Target high-corruption characters with corruption hazards. On-guard: keyable creature > event > bluff.

### Combat (`combat.ts`)

- **Strike assignment**: Highest prowess characters first, excess strikes to tapped characters.
- **Resolve strike**: Tap to fight when need > 7 and untapped.
- **Support**: Support when target's need > 7 and supporter isn't in danger.

### Site Phase (`site-phase.ts`)

- **Enter site**: Enter if hand has playable resource AND company prowess exceeds automatic attack.
- **Play resource**: `MP*10 + prowess_mod*2 - corruption*3`. Factions score highest.
- **Influence attempt**: `faction_MP*8 - (need-7)*3`. Bonus when need <= 7.

### End of Turn (`end-of-turn.ts`)

- **Discard**: Drop unplayable cards first: duplicate uniques > non-keyable creatures > untargetable events.
- **Call Free Council**: Only when significantly ahead in MP.

### Shared Utilities (`common.ts`)

- `mpValue(defId)` -- marshalling point value
- `corruptionRisk(character, additionalCP)` -- failure probability
- `companyProwess(company)` -- total effective prowess
- `handResourcesForSite(hand, siteType)` -- playable resource count
- `diceSuccessProb(need)` -- 2d6 probability table

## Changes to Existing Files

1. **`packages/text-client/src/ai/index.ts`** -- Add `heuristic: heuristicStrategy` to STRATEGIES map.
2. **`packages/lobby-server/src/games/ai-client.ts`** -- Add `--strategy` flag, load card pool, build `AiContext`, call strategy instead of inline random logic.
3. **`packages/lobby-server/src/games/launcher.ts`** -- Pass `--strategy heuristic` in AI client spawn args.

## Incremental Implementation Order

### Phase 1: Skeleton + Combat

Create dispatcher, evaluator interface, common utilities, and combat evaluator. AI fights competently while remaining random elsewhere.

### Phase 2: Site Phase + End of Turn

Smart resource play and discard selection. AI enters sites intelligently and maximizes MP.

### Phase 3: Organization + Movement

Character play and movement planning. AI moves toward sites where it can play hand resources.

### Phase 4: Hazard Play

Creature keying and hazard selection. AI plays hazards effectively.

### Phase 5: Setup

Draft, item assignment, site selection. AI builds coherent starting positions.

### Phase 6: Integration

Update ai-client.ts and launcher.ts so lobby-spawned AI games use the heuristic strategy.

## Future Extensions

- **LLM advisor**: Optional async consultation for complex decisions (movement planning) with timeout fallback to heuristic.
- **Deck-aware planning**: Load AI deck at startup, build a "game plan" of which sites to visit and resources to play.
- **Opponent modeling**: Track played hazards to estimate remaining threats.
- **Learning weights**: Store scoring constants in JSON config, adjust via policy gradient on win/loss.

## Verification

1. Run `npm run build` to type-check after each evaluator is added.
2. Use text-client `--ai heuristic` mode to observe probability distributions.
3. Play test games via lobby (Random-AI with heuristic strategy) and verify sensible decisions in server logs.
4. Compare win rates: heuristic vs random over multiple games.

## Key Files

- `packages/text-client/src/ai/strategy.ts` -- AiStrategy interface (contract)
- `packages/text-client/src/ai/index.ts` -- Strategy registry
- `packages/lobby-server/src/games/ai-client.ts` -- Headless AI process
- `packages/shared/src/types/actions.ts` -- GameAction union
- `packages/shared/src/types/player-view.ts` -- PlayerView structure
