#!/usr/bin/env python3
"""Behavioral-cloning trainer for the MECCG action-conditioned policy/value net (P3).

Consumes the JSONL produced by `npm run export-training -w @meccg/sim`
(feature spec v1: header line, decision lines, per-game result lines) and
trains a small action-conditioned network:

- embeddings for card definitions, action types, and entity zones;
- a mean-pooled set encoder over the variable entity rows plus an encoding
  of the fixed global vector -> a state vector;
- a per-candidate scorer (state x candidate -> logit) with the viability
  mask applied inside the softmax -- branching factor is a runtime set
  size, never an architecture constant;
- a tanh value head trained on the final game outcome from the acting
  player's perspective.

The policy target is the teacher's normalized candidate weights (soft
targets; falls back to one-hot on the chosen index). Only decisions with
at least two viable candidates train the network -- forced decisions carry
no signal. The last `--holdout` fraction of games is held out and top-1
accuracy is reported both on contested decisions and overall (forced
decisions count as trivially correct, matching the P3 plan metric).

Weights are exported as JSON (shapes + flat row-major data) for the pure
TypeScript forward pass in `src/agents/bc-agent.ts`, together with a
self-test block (one real example's inputs and outputs) that the TS side
asserts against, guarding the two runtimes from drifting.

Usage:
  python3 train_bc.py --data training.jsonl --out bc-weights.json
    [--epochs 3] [--batch 64] [--lr 1e-3] [--holdout 0.2] [--seed 0]
    [--dims full|mini] [--value-weight 0.5] [--limit N]
"""

import argparse
import json
import math
import random

import torch
import torch.nn as nn
import torch.nn.functional as F

# Column layout of feature spec v1 (see packages/sim/src/features/).
ENTITY_ZONE_COL = 0
ENTITY_CARD_COL = 2
ENTITY_BEARER_COL = 5
# Numeric entity columns fed to the encoder besides the embedded ones.
ENTITY_NUMERIC_COLS = [1, 3, 4, 6, 7, 8, 9, 10, 11, 12]
CAND_TYPE_COL = 0
CAND_REF_COLS = [3, 4, 5, 6]
CAND_NUMERIC_COLS = [1, 2, 7, 8]
MAX_ZONE_ROWS = 16  # zone ids are small integers; leave headroom

DIM_PRESETS = {
    # d_card, d_type, d_zone, d_entity, d_global, d_state, d_cand, d_score
    "full": (16, 16, 8, 32, 32, 64, 32, 64),
    "mini": (4, 4, 2, 8, 8, 16, 8, 16),
}


class BcNet(nn.Module):
    """Action-conditioned policy + value network over feature spec v1."""

    def __init__(self, vocab_size, action_types, global_width, dims):
        super().__init__()
        d_card, d_type, d_zone, d_ent, d_glob, d_state, d_cand, d_score = dims
        self.emb_card = nn.Embedding(vocab_size + 1, d_card)
        self.emb_type = nn.Embedding(action_types + 1, d_type)
        self.emb_zone = nn.Embedding(MAX_ZONE_ROWS, d_zone)
        self.ent_lin = nn.Linear(d_zone + 2 * d_card + len(ENTITY_NUMERIC_COLS), d_ent)
        self.glob_lin = nn.Linear(global_width, d_glob)
        self.torso = nn.Linear(d_ent + d_glob, d_state)
        self.cand_lin = nn.Linear(d_type + d_card + len(CAND_NUMERIC_COLS), d_cand)
        self.score1 = nn.Linear(d_state + d_cand, d_score)
        self.score2 = nn.Linear(d_score, 1)
        self.value1 = nn.Linear(d_state, d_score // 2)
        self.value2 = nn.Linear(d_score // 2, 1)

    def encode_state(self, glob, entities, entity_mask):
        """glob [B,G]; entities [B,E,13]; entity_mask [B,E] -> state [B,S]."""
        zone = self.emb_zone(entities[:, :, ENTITY_ZONE_COL].long())
        card = self.emb_card(entities[:, :, ENTITY_CARD_COL].long())
        bearer = self.emb_card(entities[:, :, ENTITY_BEARER_COL].long())
        nums = entities[:, :, ENTITY_NUMERIC_COLS]
        rows = F.relu(self.ent_lin(torch.cat([zone, card, bearer, nums], dim=2)))
        rows = rows * entity_mask.unsqueeze(2)
        denom = entity_mask.sum(dim=1, keepdim=True).clamp(min=1.0)
        pooled = rows.sum(dim=1) / denom
        g = F.relu(self.glob_lin(glob))
        return F.relu(self.torso(torch.cat([g, pooled], dim=1)))

    def score_candidates(self, state, candidates):
        """state [B,S]; candidates [B,C,9] -> logits [B,C]."""
        act = self.emb_type(candidates[:, :, CAND_TYPE_COL].long())
        refs = self.emb_card(candidates[:, :, CAND_REF_COLS].long()).mean(dim=2)
        nums = candidates[:, :, CAND_NUMERIC_COLS]
        cand = F.relu(self.cand_lin(torch.cat([act, refs, nums], dim=2)))
        expanded = state.unsqueeze(1).expand(-1, cand.shape[1], -1)
        hidden = F.relu(self.score1(torch.cat([expanded, cand], dim=2)))
        return self.score2(hidden).squeeze(2)

    def forward(self, glob, entities, entity_mask, candidates):
        state = self.encode_state(glob, entities, entity_mask)
        logits = self.score_candidates(state, candidates)
        value = torch.tanh(self.value2(F.relu(self.value1(state))))
        return logits, value.squeeze(1)


def parse_data_spec(spec):
    """Splits a `path[@seat]` data spec into (path, allowed seats)."""
    at = spec.rfind("@")
    if at > 0 and spec[at + 1 :] in ("0", "1"):
        return spec[:at], {int(spec[at + 1 :])}
    return spec, {0, 1}


def load_dataset(specs, limit):
    """Parses one or more export JSONL files -> (header, examples).

    Each spec is `path[@seat]`: with a seat suffix only that player's
    decisions are kept — used for league rollouts where the learner sits in
    a known seat and the opponent's decisions must not enter the gradient
    (their recorded behavior probabilities belong to a different policy).
    Game outcomes are joined per file; game identity is namespaced per file
    so ids never collide across files. All headers must agree on the
    feature spec and card vocabulary.
    """
    header = None
    examples = []
    for file_index, spec in enumerate(specs):
        path, seats = parse_data_spec(spec)
        file_header = None
        decisions = []
        outcomes = {}
        with open(path, "r", encoding="utf-8") as handle:
            for line in handle:
                record = json.loads(line)
                kind = record.get("k")
                if kind == "h":
                    file_header = record
                elif kind == "d":
                    decisions.append(record)
                    if limit and len(decisions) >= limit:
                        break
                elif kind == "r":
                    outcomes[record["game"]] = record
        if file_header is None:
            raise SystemExit(f"no header line in {path}")
        if header is None:
            header = file_header
        elif (file_header.get("vocabHash") != header.get("vocabHash")
              or file_header.get("featureSpecVersion") != header.get("featureSpecVersion")):
            raise SystemExit(f"{path}: vocab/feature-spec mismatch with {specs[0]}")
        for d in decisions:
            if d["player"] not in seats:
                continue
            result = outcomes.get(d["game"])
            if result is None or result.get("outcome") != "completed":
                continue
            winner = result.get("winnerIndex")
            z = 0.0 if winner is None else (1.0 if winner == d["player"] else -1.0)
            # Namespace the game id so holdout splitting and reporting never
            # conflate games from different rollout files.
            d["game"] = file_index * 1_000_000 + d["game"]
            examples.append((d, z))
    return header, examples


def contested(example):
    """True when at least two candidates are viable (policy signal exists)."""
    return sum(example[0]["mask"]) >= 2


def collate(batch, global_width):
    """Pads a list of examples into batch tensors.

    Items are `(decision, z)` pairs, optionally extended to
    `(decision, z, advantage)` by the PPO pre-pass. Also derives the
    behavior policy's log-probability of the chosen action from the
    recorded candidate weights (valid for temperature-1 rollouts, where
    the stored policy distribution *is* the sampling distribution).
    """
    size = len(batch)
    max_e = max(len(item[0]["entities"]) for item in batch)
    max_c = max(len(item[0]["candidates"]) for item in batch)
    glob = torch.zeros(size, global_width)
    entities = torch.zeros(size, max_e, 13)
    entity_mask = torch.zeros(size, max_e)
    candidates = torch.zeros(size, max_c, 9)
    cand_mask = torch.zeros(size, max_c)
    target = torch.zeros(size, max_c)
    chosen = torch.zeros(size, dtype=torch.long)
    value = torch.zeros(size)
    old_logp = torch.zeros(size)
    advantage = torch.zeros(size)
    for i, item in enumerate(batch):
        d, z = item[0], item[1]
        glob[i] = torch.tensor(d["global"])
        ents = torch.tensor(d["entities"])
        entities[i, : ents.shape[0]] = ents
        entity_mask[i, : ents.shape[0]] = 1.0
        cands = torch.tensor(d["candidates"])
        candidates[i, : cands.shape[0]] = cands
        cand_mask[i, : cands.shape[0]] = torch.tensor([float(m) for m in d["mask"]])
        weights = [(int(j), float(w)) for j, w in d.get("weights", []) if w > 0]
        total = sum(w for _, w in weights)
        chosen_prob = 0.0
        if total > 0:
            for j, w in weights:
                target[i, j] = w / total
                if j == d["chosen"]:
                    chosen_prob = w / total
        else:
            target[i, d["chosen"]] = 1.0
            chosen_prob = 1.0
        old_logp[i] = math.log(max(chosen_prob, 1e-8))
        chosen[i] = d["chosen"]
        value[i] = z
        advantage[i] = item[2] if len(item) > 2 else 0.0
    return glob, entities, entity_mask, candidates, cand_mask, target, chosen, value, old_logp, advantage


def masked_log_softmax(logits, mask):
    masked = logits.masked_fill(mask < 0.5, -1e9)
    return F.log_softmax(masked, dim=1)


def evaluate(net, examples, global_width, batch_size):
    """Top-1 vs the teacher's choice on contested and on all decisions."""
    net.eval()
    contested_hit = contested_n = 0
    forced_n = 0
    value_se = 0.0
    with torch.no_grad():
        pool = [e for e in examples if contested(e)]
        forced_n = len(examples) - len(pool)
        for start in range(0, len(pool), batch_size):
            batch = pool[start : start + batch_size]
            glob, ents, emask, cands, cmask, _, chosen, z, *_ = collate(batch, global_width)
            logits, value = net(glob, ents, emask, cands)
            pred = logits.masked_fill(cmask < 0.5, -1e9).argmax(dim=1)
            contested_hit += int((pred == chosen).sum())
            contested_n += len(batch)
            value_se += float(((value - z) ** 2).sum())
    contested_acc = contested_hit / contested_n if contested_n else 0.0
    overall_acc = (contested_hit + forced_n) / (contested_n + forced_n) if examples else 0.0
    value_mse = value_se / contested_n if contested_n else 0.0
    return contested_acc, overall_acc, value_mse


def tensor_json(tensor):
    return {"shape": list(tensor.shape), "data": [round(v, 7) for v in tensor.reshape(-1).tolist()]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--data", required=True, nargs="+",
        help="export JSONL file(s); a path@0 / path@1 suffix keeps only that seat's "
             "decisions (league rollouts: train only on the learner's moves)")
    parser.add_argument("--out", required=True)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch", type=int, default=64)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--holdout", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--dims", choices=sorted(DIM_PRESETS), default="full")
    parser.add_argument("--value-weight", type=float, default=0.5)
    parser.add_argument("--limit", type=int, default=0, help="cap parsed decisions (debug)")
    parser.add_argument(
        "--mode", choices=["bc", "reinforce", "ppo"], default="bc",
        help="bc: imitate teacher soft targets; reinforce: 1-epoch policy gradient on game "
             "outcome; ppo: clipped-ratio surrogate over multiple epochs (both RL modes need "
             "temperature-1 rollouts generated by the --init policy)")
    parser.add_argument("--init", help="weights JSON to warm-start from (dims taken from the file)")
    parser.add_argument("--entropy", type=float, default=0.01, help="entropy bonus (RL modes)")
    parser.add_argument("--clip", type=float, default=0.2, help="PPO ratio clip epsilon")
    parser.add_argument(
        "--kl-target", type=float, default=0.02,
        help="PPO early-stop: end the update when the mean approximate KL from the "
             "behavior policy exceeds this (0 disables)")
    parser.add_argument(
        "--value-prefit", type=int, default=1,
        help="PPO: epochs of value-head-only fitting on the new rollouts before "
             "computing advantages (0 disables). The warm-started value head is "
             "mis-calibrated on states shaped by unfamiliar opponents; advantages "
             "from it carry a systematic bias that poisons the policy update.")
    args = parser.parse_args()

    if args.mode in ("reinforce", "ppo") and not args.init:
        raise SystemExit(f"{args.mode} mode requires --init (the policy that generated the rollouts)")
    if args.mode == "reinforce" and args.epochs != 1:
        print(f"warning: reinforce without importance correction is on-policy — "
              f"{args.epochs} epochs over the same rollouts biases the gradient (use --mode ppo)")

    torch.manual_seed(args.seed)
    random.seed(args.seed)

    header, examples = load_dataset(args.data, args.limit)
    if header.get("featureSpecVersion") != 1:
        raise SystemExit(f"unsupported feature spec {header.get('featureSpecVersion')}")
    global_width = header["globalWidth"]

    games = sorted({d["game"] for d, _ in examples})
    holdout_games = set(games[int(len(games) * (1 - args.holdout)) :]) if len(games) > 1 else set()
    train_all = [e for e in examples if e[0]["game"] not in holdout_games]
    held_all = [e for e in examples if e[0]["game"] in holdout_games]
    train = [e for e in train_all if contested(e)]
    print(
        f"data: {len(examples)} examples / {len(games)} games "
        f"(train {len(train_all)} [{len(train)} contested], holdout {len(held_all)} over {len(holdout_games)} games)"
    )

    if args.init:
        with open(args.init, "r", encoding="utf-8") as handle:
            init_payload = json.load(handle)
        if init_payload.get("vocabHash") != header.get("vocabHash"):
            raise SystemExit(
                f"--init vocab hash {init_payload.get('vocabHash')} does not match data {header.get('vocabHash')}")
        dims = tuple(init_payload["dims"]["values"])
        dims_label = init_payload["dims"]["preset"]
    else:
        dims = DIM_PRESETS[args.dims]
        dims_label = args.dims
    net = BcNet(header["vocabSize"], header["actionTypeCount"], global_width, dims)
    if args.init:
        net.load_state_dict({
            name: torch.tensor(tensor["data"]).reshape(tensor["shape"])
            for name, tensor in init_payload["weights"].items()
        })
        print(f"warm start: loaded {args.init}")
    params = sum(p.numel() for p in net.parameters())
    print(f"model: mode={args.mode}, dims={dims_label} {dims}, {params} parameters")
    optimizer = torch.optim.Adam(net.parameters(), lr=args.lr)

    if args.mode == "ppo":
        # Calibrate the value head to the NEW rollout distribution before it
        # is used as the advantage baseline. The warm-started head was fit
        # on earlier data; on states shaped by unfamiliar opponents its
        # estimates carry a systematic bias, and biased advantages suppress
        # (or inflate) every action from those games regardless of merit —
        # measured 2026-07-25: heuristic-dominant rollouts produced updates
        # that lost ~-113 Elo on ALL axes purely from this. Only the value
        # head's own parameters are updated; the shared torso and the
        # policy stay frozen.
        if args.value_prefit > 0:
            value_params = list(net.value1.parameters()) + list(net.value2.parameters())
            prefit_opt = torch.optim.Adam(value_params, lr=1e-3)
            net.train()
            for prefit_epoch in range(args.value_prefit):
                total = steps = 0
                random.shuffle(train)
                for start in range(0, len(train), args.batch):
                    batch = train[start : start + args.batch]
                    glob, ents, emask, cands, _, _, _, z, _, _ = collate(batch, global_width)
                    _, value = net(glob, ents, emask, cands)
                    loss = F.mse_loss(value, z)
                    prefit_opt.zero_grad()
                    loss.backward()
                    prefit_opt.step()
                    total += float(loss.detach())
                    steps += 1
                print(f"value prefit {prefit_epoch + 1}/{args.value_prefit}: mse {total / max(steps, 1):.4f}")

        # Fix the advantages once with the calibrated value head (standard
        # PPO: advantages stay constant across the update epochs), then
        # normalize them to zero mean / unit variance PER ROLLOUT FILE.
        # Per-file (i.e. per opponent family) normalization removes any
        # remaining family-level baseline bias: within each family only
        # relative credit assignment survives, so games against one
        # opponent can never blanket-suppress the actions learned against
        # another. Global normalization is the degenerate single-file case.
        net.eval()
        with_adv = []
        with torch.no_grad():
            for start in range(0, len(train), args.batch):
                batch = train[start : start + args.batch]
                glob, ents, emask, cands, _, _, _, z, _, _ = collate(batch, global_width)
                _, value = net(glob, ents, emask, cands)
                adv = z - value
                with_adv.extend((d, zi, float(a)) for (d, zi), a in zip(batch, adv))
        by_file = {}
        for d, _, a in with_adv:
            by_file.setdefault(d["game"] // 1_000_000, []).append(a)
        file_stats = {}
        for file_index, values in sorted(by_file.items()):
            tensor = torch.tensor(values)
            file_stats[file_index] = (float(tensor.mean()), float(tensor.std()))
            print(f"advantages[file {file_index}]: n {len(values)}, mean {file_stats[file_index][0]:.4f}, "
                  f"std {file_stats[file_index][1]:.4f} (normalized per file)")
        train = [
            (d, zi, (a - file_stats[d["game"] // 1_000_000][0]) / (file_stats[d["game"] // 1_000_000][1] + 1e-8))
            for d, zi, a in with_adv
        ]

    stop_early = False
    for epoch in range(args.epochs):
        net.train()
        random.shuffle(train)
        policy_loss_sum = value_loss_sum = kl_sum = steps = 0
        for start in range(0, len(train), args.batch):
            batch = train[start : start + args.batch]
            glob, ents, emask, cands, cmask, target, chosen, z, old_logp, fixed_adv = collate(batch, global_width)
            logits, value = net(glob, ents, emask, cands)
            log_probs = masked_log_softmax(logits, cmask)
            value_loss = F.mse_loss(value, z)
            if args.mode == "reinforce":
                # REINFORCE with the value head as baseline: push the chosen
                # action's log-probability by the outcome advantage, plus an
                # entropy bonus against premature collapse.
                chosen_logp = log_probs.gather(1, chosen.unsqueeze(1)).squeeze(1)
                advantage = (z - value).detach()
                policy_loss = -(advantage * chosen_logp).mean()
                probs = torch.exp(log_probs) * cmask
                entropy = -(probs * log_probs.masked_fill(cmask < 0.5, 0.0)).sum(dim=1).mean()
                loss = policy_loss + args.value_weight * value_loss - args.entropy * entropy
            elif args.mode == "ppo":
                # Clipped-surrogate PPO: importance ratio against the recorded
                # behavior probability lets the same rollouts train multiple
                # epochs without off-policy bias running away.
                chosen_logp = log_probs.gather(1, chosen.unsqueeze(1)).squeeze(1)
                ratio = torch.exp(chosen_logp - old_logp)
                unclipped = ratio * fixed_adv
                clipped = torch.clamp(ratio, 1 - args.clip, 1 + args.clip) * fixed_adv
                policy_loss = -torch.min(unclipped, clipped).mean()
                probs = torch.exp(log_probs) * cmask
                entropy = -(probs * log_probs.masked_fill(cmask < 0.5, 0.0)).sum(dim=1).mean()
                loss = policy_loss + args.value_weight * value_loss - args.entropy * entropy
                # k3 estimator of KL(behavior ‖ current) on the chosen actions.
                with torch.no_grad():
                    kl_sum += float(((ratio - 1) - torch.log(ratio.clamp(min=1e-8))).mean())
            else:
                policy_loss = -(target * log_probs).sum(dim=1).mean()
                loss = policy_loss + args.value_weight * value_loss
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            policy_loss_sum += float(policy_loss.detach())
            value_loss_sum += float(value_loss.detach())
            steps += 1
        contested_acc, overall_acc, value_mse = evaluate(net, held_all, global_width, args.batch)
        mean_kl = kl_sum / max(steps, 1)
        kl_note = f", kl {mean_kl:.4f}" if args.mode == "ppo" else ""
        print(
            f"epoch {epoch + 1}/{args.epochs}: policy {policy_loss_sum / max(steps, 1):.4f}, "
            f"value {value_loss_sum / max(steps, 1):.4f}{kl_note} | holdout top-1 contested {contested_acc:.3f}, "
            f"overall {overall_acc:.3f}, value mse {value_mse:.3f}"
        )
        if args.mode == "ppo" and args.kl_target > 0 and mean_kl > args.kl_target:
            print(f"early stop: mean KL {mean_kl:.4f} > target {args.kl_target} after epoch {epoch + 1}")
            stop_early = True
            break

    # Self-test block: a real example's inputs and the net's outputs, so the
    # TypeScript forward pass can prove bit-compatibility (within float eps).
    net.eval()
    probe_pool = held_all if held_all else train_all
    probe = next((e for e in probe_pool if contested(e)), probe_pool[0])
    glob, ents, emask, cands, cmask, *_ = collate([probe], global_width)
    with torch.no_grad():
        logits, value = net(glob, ents, emask, cands)
        probs = torch.exp(masked_log_softmax(logits, cmask))
    self_test = {
        "global": probe[0]["global"],
        "entities": probe[0]["entities"],
        "candidates": probe[0]["candidates"],
        "mask": probe[0]["mask"],
        "expectedProbs": [round(float(p), 6) for p in probs[0]],
        "expectedValue": round(float(value[0]), 6),
    }

    contested_acc, overall_acc, value_mse = evaluate(net, held_all, global_width, args.batch)
    weights = {name: tensor_json(tensor) for name, tensor in net.state_dict().items()}
    payload = {
        "kind": "meccg-bc-weights",
        "formatVersion": 1,
        "featureSpecVersion": header["featureSpecVersion"],
        "vocabSize": header["vocabSize"],
        "vocabHash": header["vocabHash"],
        "actionTypeCount": header["actionTypeCount"],
        "globalWidth": global_width,
        "dims": {"preset": dims_label, "values": list(dims)},
        "training": {
            "mode": args.mode,
            "init": args.init,
            "earlyStop": stop_early,
            "data": args.data,
            "examples": len(examples),
            "games": len(games),
            "epochs": args.epochs,
            "holdoutTop1Contested": round(contested_acc, 4),
            "holdoutTop1Overall": round(overall_acc, 4),
            "holdoutValueMse": round(value_mse, 4),
        },
        "weights": weights,
        "selfTest": self_test,
    }
    with open(args.out, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)
    size_kb = math.ceil(len(json.dumps(payload)) / 1024)
    print(f"wrote {args.out} ({size_kb} KB): holdout top-1 contested {contested_acc:.3f}, overall {overall_acc:.3f}")


if __name__ == "__main__":
    main()
