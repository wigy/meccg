#!/usr/bin/env bash
# Self-play RL loop (P4: PPO by default, REINFORCE via MODE=reinforce),
# with league rollouts and league-wide promotion gates.
#
# Motivation (measured 2026-07-23): pure self-play rollouts overfit to
# exploiting the policy's own family — a candidate gained ~+26 Elo over
# the BC champion while LOSING ~-77 Elo to the heuristic. The fix is the
# classic frozen-baseline league: part of every rollout batch is played
# against frozen league opponents (learner alternating seats, and only the
# learner's decisions enter the gradient — the opponents' recorded
# behavior probabilities belong to different policies), and promotion
# requires beating the champion AND not regressing against any league
# member.
#
# Each iteration:
#   1) rollouts: GAMES self-play games (champion@1 both seats) plus, per
#      LEAGUE member, GAMES_OPP games in each seat against it;
#   2) update: PPO (EPOCHS clipped-ratio passes) or REINFORCE on the
#      learner's decisions only;
#   3) gates: candidate (argmax) vs champion at GATE_MIN_ELO, then vs each
#      LEAGUE member at GATE_LEAGUE_MIN_ELO (a no-regression tolerance).
#      All gates must pass for promotion; rejected candidates stay on disk.
#
# Usage:
#   train/selfplay_loop.sh <champion-weights.json> <workdir> [iterations]
#
# Env overrides: LEAGUE (comma-separated agent specs, default "heuristic";
# e.g. "heuristic,bc:/path/frozen.json"), GAMES (self-play games/iter,
# default 60), GAMES_OPP (games per league member per seat, default 30),
# MODE (ppo|reinforce, default ppo), EPOCHS (default 4 for ppo, 1 for
# reinforce), CLIP (default 0.2), LR (default 1e-4), ENTROPY (default
# 0.01), GATE_PAIRS (default 15), GATE_ROUNDS (default 2), GATE_MIN_ELO
# (default 0), GATE_LEAGUE_MIN_ELO (default -25), SEED0 (default 50000).
set -euo pipefail

CHAMPION=$(realpath "$1")
WORKDIR=$(realpath "$2")
ITERS=${3:-5}
LEAGUE=${LEAGUE:-heuristic}
MODE=${MODE:-ppo}
if [ "$MODE" = "ppo" ]; then EPOCHS=${EPOCHS:-4}; else EPOCHS=${EPOCHS:-1}; fi
CLIP=${CLIP:-0.2}
KL_TARGET=${KL_TARGET:-0.02}
GAMES=${GAMES:-60}
GAMES_OPP=${GAMES_OPP:-30}
# 3e-5 after the 2026-07-24 runs: 1e-4 x 4 epochs produced candidate swings
# from -141 to +47 Elo, including repeated draw-spike collapses.
LR=${LR:-3e-5}
ENTROPY=${ENTROPY:-0.01}
GATE_PAIRS=${GATE_PAIRS:-15}
GATE_ROUNDS=${GATE_ROUNDS:-2}
GATE_MIN_ELO=${GATE_MIN_ELO:-0}
GATE_LEAGUE_MIN_ELO=${GATE_LEAGUE_MIN_ELO:--25}
SEED0=${SEED0:-50000}

cd "$(dirname "$0")/.."
mkdir -p "$WORKDIR"
IFS=',' read -r -a LEAGUE_MEMBERS <<< "$LEAGUE"

for ((i = 1; i <= ITERS; i++)); do
  seed=$((SEED0 + (i - 1) * 10000))
  candidate="$WORKDIR/candidate-$i.json"
  data_specs=()

  echo "=== iteration $i/$ITERS: self-play rollout $GAMES games (seeds $seed..) ==="
  rollout="$WORKDIR/rollout-$i-self.jsonl"
  npm run --silent export-training -- \
    --agents "bc:$CHAMPION@1,bc:$CHAMPION@1" --games "$GAMES" --seed "$seed" --out "$rollout"
  data_specs+=("$rollout")
  seed=$((seed + GAMES))

  m=0
  for member in "${LEAGUE_MEMBERS[@]}"; do
    m=$((m + 1))
    echo "=== iteration $i: league rollout vs $member ($GAMES_OPP games per seat) ==="
    rollout="$WORKDIR/rollout-$i-league$m-s0.jsonl"
    npm run --silent export-training -- \
      --agents "bc:$CHAMPION@1,$member" --games "$GAMES_OPP" --seed "$seed" --out "$rollout"
    data_specs+=("$rollout@0")
    seed=$((seed + GAMES_OPP))
    rollout="$WORKDIR/rollout-$i-league$m-s1.jsonl"
    npm run --silent export-training -- \
      --agents "$member,bc:$CHAMPION@1" --games "$GAMES_OPP" --seed "$seed" --out "$rollout"
    data_specs+=("$rollout@1")
    seed=$((seed + GAMES_OPP))
  done

  echo "=== iteration $i: $MODE update ($EPOCHS epoch(s)) over ${#data_specs[@]} rollout file(s) ==="
  python3 train/train_bc.py --mode "$MODE" --init "$CHAMPION" \
    --data "${data_specs[@]}" --out "$candidate" --epochs "$EPOCHS" --lr "$LR" \
    --entropy "$ENTROPY" --clip "$CLIP" --kl-target "$KL_TARGET" --holdout 0

  promote=1
  echo "=== iteration $i: gate candidate vs champion (min-elo $GATE_MIN_ELO) ==="
  if ! npm run --silent gate -- --challenger "bc:$candidate" --champion "bc:$CHAMPION" \
    --pairs "$GATE_PAIRS" --rounds "$GATE_ROUNDS" --seed $((seed + 700000)) --min-elo "$GATE_MIN_ELO"; then
    promote=0
  fi
  for member in "${LEAGUE_MEMBERS[@]}"; do
    [ "$promote" = 1 ] || break
    echo "=== iteration $i: gate candidate vs league member $member (min-elo $GATE_LEAGUE_MIN_ELO) ==="
    if ! npm run --silent gate -- --challenger "bc:$candidate" --champion "$member" \
      --pairs "$GATE_PAIRS" --rounds "$GATE_ROUNDS" --seed $((seed + 800000)) --min-elo "$GATE_LEAGUE_MIN_ELO"; then
      promote=0
    fi
  done

  if [ "$promote" = 1 ]; then
    echo "=== iteration $i: PROMOTED $candidate ==="
    CHAMPION=$(realpath "$candidate")
  else
    echo "=== iteration $i: candidate rejected, champion stays ==="
  fi
  rm -f "$WORKDIR/rollout-$i-"*.jsonl
done

echo "final champion: $CHAMPION"
