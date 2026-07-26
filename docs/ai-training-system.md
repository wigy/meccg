# Training a MECCG Player: System, Algorithms, and Results

*Status: 2026-07-26. Describes what is implemented and measured in
`packages/sim`. Numbers are from the runs cited; unverified claims are
marked as such.*

## 1. Summary

We train a Middle-earth CCG player by imitation followed by gated
self-play reinforcement learning, on top of the existing pure game
engine. The current champion beats the imitation baseline by **+157 Elo
[+122, +194]** and the hand-written heuristic AI by **+36 Elo [+2, +70]**
(400 paired-seed games each, zero engine failures).

Every strength claim in this document comes from paired-seed,
side-swapped matches with 95% confidence intervals, because early in the
project several "improvements" that looked good on point estimates did
not survive interval testing.

Two components are explicitly **not** yet working: determinized search
does not beat the bare policy, and the RL loop has plateaued. Both are
analysed in §8 and §9.

## 2. Why MECCG is hard

Four properties drive every design decision.

- **Imperfect information.** Hands, decks, sideboards, face-down
  on-guard cards and agent identities are hidden. Agents observe only
  `projectPlayerView(state, playerId)`, never `GameState`.
- **Variable, large action space.** ~158 action types parameterised by
  card instance ids. Branching is ~8.9 on average but ranges from 1 to
  over 1300, and **~52% of decisions are forced** (a single legal
  action).
- **Long episodes, sparse reward.** A game runs 600–2000 decisions per
  player and yields one ternary outcome.
- **Privately constructed decks.** The opponent's deck is chosen and
  ordered by them, so the hidden "range" is not a small common-knowledge
  universe. This is why whole-game CFR was rejected as a backbone.

## 3. Simulation substrate

`playGame()` loops `projectPlayerView → agent → reduce` in process. The
engine is a pure reducer with all randomness threaded through a seeded
Mulberry32 `RngState`, so a game is bit-reproducible from
`(seed, decks, agents)`. Each agent draws from its own derived stream, so
agent sampling never perturbs engine randomness.

Measured throughput (random vs random, 1000 games, full recording):
0.70 games/sec and 1391 decisions/sec on one core; mean 2001 decisions
and 74.6 turns per game. Data export runs at ~630 examples/sec serially
and scales near-linearly with `--jobs` (112,419 examples from 60 games in
80 s at 12 jobs), since games are independent and seeded: a batch splits
into contiguous seed slices whose merged output is bit-identical to a
serial run.

**Self-play as an engine test.** Random and heuristic self-play are run
as an invariant: any `deadlock` or `engine-error` outcome is an engine
bug. This has found and fixed 19 distinct engine defects to date,
including five during multi-deck training data generation. The dominant
recurring class is *offer/validate asymmetry* — the legal-action
generator offers an action the reducer then rejects — which no
hand-written test had caught.

## 4. Evaluation methodology

Evaluation is the backbone of the project, built before any learning.

- **Paired seeds with side-swap.** Every scheduled seed is played twice
  with seats exchanged, cancelling seat, deck, and shuffle luck.
- **Glicko-2 ratings** with rating periods per round, verified against
  the worked example in Glickman's paper.
- **Score-rate Elo with a 95% interval**, which is the promotion
  statistic.
- **A gate** passes only when the Elo-difference lower bound clears a
  threshold *and* every game completes; it exits non-zero for CI.

The gate is deliberately conservative, and this mattered: it blocked a
deliberately weakened agent (14.4% score, −310 Elo), passed an
equal-strength control (50.0% over 400 games, +0 [−34, +34]), and later
rejected several RL candidates whose point estimates looked positive but
whose intervals did not exclude zero.

## 5. Representation

A single feature spec (versioned; `FEATURE_SPEC_VERSION`) serves
imitation, RL, and search. It consumes only the projected view.

- **Global vector, 54 dimensions**: turn, phase one-hot, pile sizes,
  influence, stage points, deck exhaustions, marshalling points by
  category for both players, tournament scores, and combat/chain flags.
- **Entity rows, 13 dimensions each**, one per visible card in a
  structured zone (hand, characters with their items/allies/hazards,
  company sites, permanents, on-guard cards, agents, own site deck):
  zone id, owner, card-vocabulary index, tap status, company grouping,
  bearer, live effective stats, and a zone-specific flag.
- **Action vectors, 9 dimensions each**, one per candidate from
  `computeLegalActions`: action-type index, viability mask, up to four
  referenced card-vocabulary indices resolved through the instance
  lookup, and numeric parameters.

The action encoding is what makes the variable action space tractable:
the policy scores each candidate, so branching is a runtime set size
rather than an architecture constant.

The card vocabulary (1683 definitions, index 0 reserved for
hidden/unknown) is hashed with FNV-1a; the hash travels with every
exported dataset and every weights file, and inference refuses to run on
a mismatch.

## 6. Network and imitation learning

An action-conditioned policy/value network, 46,738 parameters:
embeddings for cards, action types and zones; a mean-pooled set encoder
over entity rows; a torso combining that with the encoded global vector;
a per-candidate scorer producing logits with the viability mask applied
inside the softmax; and a tanh value head.

Behavioural cloning trains the policy against the heuristic teacher's
normalised candidate weights as soft targets, and the value head against
the final game outcome.

**Top-1 agreement: 72.1% overall, 42.2% on contested decisions.** The
contested figure must be read against a ceiling: the teacher *samples*
from its weight distribution, so the expected maximum achievable
agreement is 47.0% (mean of the teacher's max normalised weight). BC
therefore captured ~92% of what imitation can capture, and more data
barely moved this number.

Play strength, however, kept improving with data well after top-1
saturated: a 40-game teacher dataset produced 35.8% against the teacher,
while a 400-game dataset reached parity (50.0% over 200 games,
+0 [−47, +47]). Agreement on individual decisions and strength over full
games are only loosely coupled.

**Inference runs in TypeScript**, mirroring the PyTorch forward pass over
weights exported as JSON. Every weights file embeds a self-test (a real
example's inputs and the trainer's outputs); the agent replays it on load
and refuses to play if the runtimes deviate by more than 2e-4. This
guards against silent featurizer or architecture drift, and caught an
architecture-compatibility bug during development.

## 7. Self-play reinforcement learning

The RL loop is: roll out games with the champion **sampling** at
temperature 1, update, then gate.

**Update.** PPO with a clipped ratio against the behaviour probabilities
recorded in the rollout (at temperature 1 the stored policy distribution
*is* the sampling distribution, so no extra bookkeeping is needed),
advantages fixed once from the value head, entropy bonus, and KL
early-stopping. Learning rate 3e-5 over 4 epochs.

Three stabilisers were each added in response to a measured failure:

1. **Advantage normalisation per rollout file.** Without it, batches
   dominated by same-sign advantages produced updates that collapsed the
   policy (a distinctive draw-spike failure mode).
2. **Value pre-fit before advantage computation.** The warm-started value
   head is mis-calibrated on states shaped by unfamiliar opponents; the
   resulting bias blanket-suppressed every action from those games. With
   heuristic-dominated rollouts this cost ~−113 Elo on *all* axes.
3. **KL early-stop** (target 0.02) as a runaway guard.

**League.** Pure self-play measurably overfits to its own family: an
early candidate gained ~+26 Elo on its parent while *losing* ~−77 Elo to
the heuristic. Rollouts therefore mix self-play with games against frozen
league members, with the learner alternating seats, and only the
learner's decisions enter the gradient (the opponents' recorded
probabilities belong to different policies, so PPO ratios against them
would be invalid). Promotion requires beating the champion *and* not
regressing against any league member. The league gate demonstrably works:
it rejected a candidate that beat its champion by +47 Elo while
regressing −47 against the heuristic.

**Accumulation.** Since a strict 200-game gate can rarely confirm a true
+30 Elo edge, learning continues from the latest candidate whether or not
it was promoted; gates decide only what is *recorded* as champion. A
drift valve resets the line if a candidate fails a league gate badly.

**Result.** Two chained promotions, each independently gated:
`bc-400g → runA-it5 (+74) → gen2-it3 (+72)`. Against the P3 baseline the
champion scores 71.1% (+157 [+122, +194], 400 games); against the
heuristic 55.1% (+36 [+2, +70], 400 games).

**Plateau.** Two subsequent generations (8 and 12 iterations, larger
rollouts, rotating learning rates) produced no promotion against a
three-member league. The recipe has reached its level; §9 identifies the
most likely cause.

## 8. Determinized search

The search layer sits behind the same agent interface.

**Determinizer.** Given a view, it samples a full `GameState` by assigning
each hidden card slot a definition drawn without replacement from the
owner's *unseen pool* (deck list plus draft pool, minus every identity
already observed). Engine internals absent from the view are synthesised,
including a fresh seeded RNG — re-seeding per determinization is how
chance is marginalised. The load-bearing property, verified on real
mid-game positions, is that re-projecting a sampled world reproduces the
searching player's original candidate list exactly.

**PUCT.** For each of K sampled worlds, a tree search over the real
reducer with net priors and leaf values, aggregating root visit counts
across worlds by canonical action id. Forced nodes are auto-advanced
without consuming budget — essential, given that ~52% of decisions are
forced. States with an open chain, active combat, or pending effects are
out of scope in v1; the agent falls back to the policy there.

**Result: search does not yet beat the policy** — 50.5%, +3 Elo
[−61, +69] over 100 games at 192 simulations per decision. §9 explains
why, and the fix is in progress.

## 9. Value function analysis

Search truncates games that run 600–2000 decisions after a few dozen
plies, so a leaf's evaluation is almost entirely the value head's
opinion. A diagnostic (`train/eval_value.py`) scores a value head by game
stage in minutes, versus an hour for a search gate.

The champion's value head turned out to be **at or below chance through
the entire middle game**, which is exactly where search leaves land:

| stage | champion | rebuilt head |
|---|---|---|
| early | 0.637 | 0.666 |
| mid-early | 0.486 | 0.839 |
| mid-late | 0.482 | 0.763 |
| late | 0.784 | 0.908 |
| overall MSE | 1.089 | 0.561 |

*(sign accuracy = fraction of decisions where the value's sign matches
the eventual winner; measured on 190 fully held-out games)*

Notably, the raw tournament-score differential — a feature the network
already receives — predicts the winner at 0.56/0.63/0.68/0.79 by quarter.
The old head was losing to one of its own inputs, so this was an
engineering failure, not an intrinsic property of the game.

Three changes fixed it:

1. **Train on all decisions.** Forced decisions carry full outcome signal
   but no policy gradient (a masked softmax over one candidate is
   identically 1), so filtering to contested decisions cost the value
   head half its data for nothing.
2. **A skip connection** feeding the global vector directly to the value
   head. The shared torso is optimised almost entirely by the policy loss
   (≈1.5 versus ≈0.2), so the value head had been reading a
   representation shaped for a different objective.
3. **Many more games.** *Value sample size is games, not decisions*: all
   decisions in a game share one target, so a 60-game dataset lets the
   head memorise (training loss 0.04 against holdout 1.1) and produces a
   head that is confidently wrong on unseen games. Training on 1286 games
   dropped holdout MSE from ~1.04 to 0.41.

This also explains the RL plateau: PPO advantages are computed from this
value head, so mid-game advantages were largely noise.

## 10. Negative results

Recorded because they cost real time and are easy to repeat.

- **Blending the score differential into search leaf values is harmful.**
  It predicts better than the old value head mid-game, so it looked like
  free signal — but at weight 0.5 search fell to 2 wins in 12 games.
  Maximising immediate score spread is greedy in a game where
  marshalling points are bought with corruption risk and capped by the
  doubling rule.
- **More imitation data does not beat RL.** A 1520-game, multi-deck BC
  model lost to the RL champion (−81 Elo). Imitation is bounded by the
  teacher.
- **Self-play strength is non-transitive.** Candidates repeatedly gained
  against their own lineage while losing to the heuristic. Elo is only
  meaningful relative to a stated opponent pool.
- **Costless no-op loops.** Some cards permit a zero-cost cycle (*I'll
  Report You*: return to hand during any organization phase, no cost). A
  deterministic argmax policy rides such a loop forever — two agents
  burned a 25,000-decision budget inside turn 1. Agents now track a
  coarse state signature and prefer an action not yet tried from that
  signature.

## 11. Limitations

- Trained and evaluated almost entirely on hero-vs-hero challenge decks;
  9 of 12 deck pairs are currently free of engine errors. Generalisation
  across decks is measured but not optimised.
- Minion, Fallen-wizard, and Balrog play are untested by training.
- Search is unproven; the rebuilt value head has not yet been paired with
  the RL policy, and that combination is the immediate next experiment.
- PIMC-style determinization cannot represent bluffing over on-guard
  cards or hidden agent identities. This ceiling is accepted for now.
- All ratings are relative to a small pool (heuristic, BC, prior
  champions). No human-strength calibration exists; the lobby now
  supports playing against a trained model, which is the intended way to
  obtain one.

## 12. Reproducing

```sh
npm run bench -w @meccg/sim -- --games 100 --seed 1        # throughput + engine invariant
npm run tournament -w @meccg/sim -- --agents random,heuristic
npm run export-training -w @meccg/sim -- --games 400 --jobs 12 --out train.jsonl
python3 packages/sim/train/train_bc.py --data train.jsonl --out bc.json --epochs 3
python3 packages/sim/train/eval_value.py --weights bc.json --data holdout.jsonl
npm run gate -w @meccg/sim -- --challenger bc:bc.json --champion heuristic
packages/sim/train/selfplay_loop.sh bc.json /tmp/run 8    # league RL with gated promotion
```

The original design document is `specs/2026-06-29-ai-training-system-plan.md`.
