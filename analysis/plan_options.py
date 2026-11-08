"""Compare alternative $100K July plans under uncertainty (Dashboard Royale).

Every action is valued in expected house win (theo) plus avoided repair bills, for
July 1-30 only, after its catalog lead time. Uncertain inputs are drawn at random
(10,000 draws, fixed seed) from the ranges below, which come from the earlier
analyses. A plan may use at most 3 action types and must cost <= $100,000.

Inputs (all monthly figures are for 30 days):
  Inspect M-1158       recover ~$6.1K/month of house win; chance the fix works 50-100%.
  Promotion weekend    first weekend lift = $68K x s, s ~ U(0.2, 1.0)
                       (Locals Week-like result up to a repeat of the Feb tournament);
                       second weekend = first x U(0.5, 1.0) for fatigue.
  Ridgeline sweep      fault cut r ~ U(0, 0.75); ~97 faults/month x $254 each;
                       plus ~$700 of play lost during 90-minute sweeps.
  Leased new title     uplift $150-300/day of house win per unit vs. the machine it
                       replaces, times net-new share U(0, 1); 16 operating days.
  Extra technician     waits cost ~$4.1K/month; one more tech removes 30-70% of that.
  Comp rate revert     saves ~$1.35K/month of comp cost; play effect U(-0.5%, +0.2%)
                       of carded coin-in (~$27M/month) at 9.5% hold.
  Comp pilot / survey  information only in July (no July cash effect).
  Signs / moves        Back Forty play is displaced from other zones; net ~0 +/- small.

Run:  python analysis/plan_options.py   (no extra packages needed)
"""
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent
N = 10_000
HOLD = 0.0946


def draw_world(rng):
    s = rng.uniform(0.2, 1.0)
    return dict(
        inspect_ok=rng.uniform(0.5, 1.0),
        promo1=68_000 * s,
        promo_fatigue=rng.uniform(0.5, 1.0),
        pm_cut=rng.uniform(0.0, 0.75),
        lease_uplift=rng.uniform(150, 300),
        lease_netnew=rng.uniform(0.0, 1.0),
        tech_cut=rng.uniform(0.3, 0.7),
        comp_play=rng.uniform(-0.005, 0.002),
        signs=rng.uniform(-1_000, 3_000),
    )


# Each action: cost(qty), July value(world, qty), monthly run-rate after July(world, qty)
ACTIONS = {
    "inspect": dict(label="Inspect M-1158", cost=lambda q: 1_200 * q,
                    july=lambda w, q: 6_100 * 29 / 30 * w["inspect_ok"],
                    run=lambda w, q: 6_100 * w["inspect_ok"]),
    "promo": dict(label="Promotion weekend", cost=lambda q: 15_000 * q,
                  july=lambda w, q: w["promo1"] + (w["promo1"] * w["promo_fatigue"] if q == 2 else 0),
                  run=lambda w, q: 0),
    "pm": dict(label="Ridgeline maintenance", cost=lambda q: 9_000,
               july=lambda w, q: 97 * 254 * 23 / 30 * w["pm_cut"] - 700,
               run=lambda w, q: 97 * 254 * w["pm_cut"]),
    "lease": dict(label="Leased new titles", cost=lambda q: q * (2_500 + 55 * 16),
                  july=lambda w, q: q * 16 * w["lease_uplift"] * w["lease_netnew"],
                  run=lambda w, q: q * 30 * (w["lease_uplift"] * w["lease_netnew"] - 55)),
    "tech": dict(label="Extra technician", cost=lambda q: 11_520 * q,
                 july=lambda w, q: 4_100 * 23 / 30 * w["tech_cut"] * min(1, q * 0.6),
                 run=lambda w, q: 0),
    "comp_revert": dict(label="Revert comp price cut", cost=lambda q: 1_500,
                        july=lambda w, q: (1_350 + 27e6 * w["comp_play"] * HOLD) * 27 / 30,
                        run=lambda w, q: 1_350 + 27e6 * w["comp_play"] * HOLD),
    "comp_pilot": dict(label="Comp pilot", cost=lambda q: 4_000, july=lambda w, q: 0, run=lambda w, q: 0),
    "signs": dict(label="Back Forty signs", cost=lambda q: 7_500, july=lambda w, q: w["signs"] * 20 / 30, run=lambda w, q: w["signs"]),
}

PLANS = {
    "R. Revised: inspect + one weekend": {"inspect": 1, "promo": 1},
    "A. Current plan": {"inspect": 1, "promo": 1, "pm": 1},
    "B. Two promo weekends + inspect + maintenance": {"inspect": 1, "promo": 2, "pm": 1},
    "C. Two promo weekends + inspect": {"inspect": 1, "promo": 2},
    "D. Inspect + one promo + comp pilot": {"inspect": 1, "promo": 1, "comp_pilot": 1},
    "E. Two promos + inspect + comp revert": {"inspect": 1, "promo": 2, "comp_revert": 1},
    "F. Two promos + inspect + 5 leased new titles": {"inspect": 1, "promo": 2, "lease": 5},
    "G. Manager-style: lease 10 replacements": {"lease": 10},
    "H. Technician + signs + inspect": {"tech": 1, "signs": 1, "inspect": 1},
    "I. Keep the whole budget": {},
}


def evaluate(plan, worlds):
    cost = sum(ACTIONS[a]["cost"](q) for a, q in plan.items())
    assert len(plan) <= 3 and cost <= 100_000, plan
    nets, runs = [], []
    for w in worlds:
        v = sum(ACTIONS[a]["july"](w, q) for a, q in plan.items())
        nets.append(v - cost)
        runs.append(sum(ACTIONS[a]["run"](w, q) for a, q in plan.items()))
    nets.sort()
    pct = lambda p: nets[int(p * (len(nets) - 1))]
    return dict(cost=round(cost), july_net_mean=round(sum(nets) / len(nets)), july_net_p10=round(pct(0.10)),
                july_net_p90=round(pct(0.90)), chance_july_loss=round(sum(1 for x in nets if x < 0) / len(nets), 3),
                monthly_after_july=round(sum(runs) / len(runs)))


rng = random.Random(2025)
worlds = [draw_world(rng) for _ in range(N)]
results = {name: evaluate(p, worlds) for name, p in PLANS.items()}

# Each action alone, for the comparison table
single = {}
for key, qty in [("inspect", 1), ("promo", 1), ("promo", 2), ("pm", 1), ("lease", 1), ("tech", 1), ("comp_revert", 1), ("comp_pilot", 1), ("signs", 1)]:
    single[f"{ACTIONS[key]['label']} x{qty}"] = evaluate({key: qty}, worlds)

# Deterministic downside scenarios for one promotion weekend (July net, house win).
# Net extra coin-in over the event plus the following week, times 9.5% hold,
# minus the $15,000 package and any extra cost not covered by the package.
PROMO_COST, EXTRA_COST = 15_000, 5_000
july_weekend_forecast = 1_611_000 + 1_759_000 + 1_409_000  # frozen Fri+Sat+Sun forecast
scenarios = {
    "Feb tournament, normal-day pre-event baseline": 883_713,
    "Feb tournament, all-day pre-event baseline": 566_032,
    "Half the conservative February result": 283_016,
    "Locals Week-like result (+3.2% of a July weekend)": round(0.032 * july_weekend_forecast),
    "Zero uplift": 0,
    "Zero uplift, next week dips as in February": -138_915,
}
promo_scenarios = {
    name: dict(net_extra_coin_in=lift,
               july_net=round(lift * HOLD - PROMO_COST),
               july_net_with_5k_extra_cost=round(lift * HOLD - PROMO_COST - EXTRA_COST))
    for name, lift in scenarios.items()
}
promo_break_even = dict(package_only=round(PROMO_COST / HOLD), with_5k_extra=round((PROMO_COST + EXTRA_COST) / HOLD))

out = dict(plans=results, single_actions=single, promo_scenarios=promo_scenarios, promo_break_even=promo_break_even,
           note="Simulated probabilities are conditional on the assumed input ranges above; they are not observed frequencies.")
(ROOT / "plan_options_results.json").write_text(json.dumps(out, indent=1))
for title, block in (("SINGLE ACTIONS", single), ("PLANS", results)):
    print("\n" + title)
    print(f"{'':52s}{'cost':>9s}{'mean':>9s}{'p10':>9s}{'p90':>9s}{'P(loss)':>9s}{'run/mo':>9s}")
    for k, v in block.items():
        print(f"{k:52s}{v['cost']:>9,}{v['july_net_mean']:>9,}{v['july_net_p10']:>9,}{v['july_net_p90']:>9,}{v['chance_july_loss']:>9.0%}{v['monthly_after_july']:>9,}")
print("\nPROMOTION SCENARIOS (one weekend)")
for k, v in promo_scenarios.items():
    print(f"{k:52s}{v['net_extra_coin_in']:>11,}{v['july_net']:>9,}{v['july_net_with_5k_extra_cost']:>9,}")
print("break-even coin-in:", promo_break_even)
