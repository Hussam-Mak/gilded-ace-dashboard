"""Robustness checks for the July budget plan (Dashboard Royale).

1. Fake-promotion test: measure "lift" on ordinary Fri-Sun weekends with no event,
   holiday or promotion, using the same frozen forecast as the real promotion. If
   ordinary weekends rarely reach the slot tournament's +$803K, the lift is real.
2. Detection checks: could July data show whether each funded action worked?
   - Inspection: one-day hit-rate test on M-1158.
   - Maintenance: Poisson test on Ridgeline fault counts over the 23 days after the lead time.
   - Promotion: chance a true lift clears the fake-promotion noise band.

Run after analysis/forecast.py:  python analysis/checks.py
Needs: duckdb. Writes analysis/checks_results.json.
"""
import json
import math
from datetime import date, timedelta
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "dashboard-royale" / "data"
fc = json.loads((ROOT / "forecast_results.json").read_text())
days = {d["d"]: d for d in fc["daily"]}
out = {}

# ---------- 1. Fake-promotion test ----------
TOURNAMENT_LIFT = fc["promotion_lift"]["Gilded Ace Winter Slot Tournament"]["lift"]
fake = []
start, end = date(2025, 1, 1), date(2025, 6, 30)
d = start
while d <= end - timedelta(days=2):
    if d.weekday() == 4:  # Friday
        wk = [days.get((d + timedelta(i)).isoformat()) for i in range(3)]
        if all(wk) and not any(x["city"] or x["prop"] or x["hol"] for x in wk):
            lift = sum(x["coin"] - x["m2_no_promo"] for x in wk)
            fake.append(dict(friday=d.isoformat(), lift=round(lift), holdout=not wk[0]["train"]))
    d += timedelta(1)

lifts = sorted(x["lift"] for x in fake)
n = len(lifts)
mean_l = sum(lifts) / n
sd_l = (sum((x - mean_l) ** 2 for x in lifts) / (n - 1)) ** 0.5
p95 = lifts[min(n - 1, math.ceil(0.95 * n) - 1)]
out["fake_promotion"] = dict(
    n_weekends=n,
    n_holdout_weekends=sum(x["holdout"] for x in fake),
    mean_lift=round(mean_l), sd_lift=round(sd_l), max_lift=max(lifts), min_lift=min(lifts),
    p95_lift=p95, tournament_lift=TOURNAMENT_LIFT,
    weekends_at_or_above_tournament=sum(1 for x in lifts if x >= TOURNAMENT_LIFT),
    tournament_z=round((TOURNAMENT_LIFT - mean_l) / sd_l, 2),
    weekends=fake,
)


out["fake_promotion"]["tournament_rank"] = f"{1 + sum(1 for x in lifts if x >= TOURNAMENT_LIFT)} of {n + 1}"
out["fake_promotion"]["rank_p_value"] = round((1 + sum(1 for x in lifts if x >= TOURNAMENT_LIFT)) / (n + 1), 3)
out["fake_promotion"]["exclusion_rule"] = ("Fri-Sun weekends Jan 1 - Jun 30 with no citywide event, casino promotion "
                                           "or federal holiday on any of the three days.")

# ---------- 1b. Pre-event event study for the February tournament ----------
# Baseline = weekday means from Jan 1 - Feb 20 only, so nothing after the event
# enters it. Two variants: all pre-event days (includes CES, Super Bowl and
# holidays, so the baseline runs high and the lift low) and normal days only.
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
pre_days = [x for x in fc["daily"] if x["d"] <= "2025-02-20"]


def event_study(pool):
    base = {w: sum(x["coin"] for x in pool if x["wd"] == w) / len([x for x in pool if x["wd"] == w]) for w in WEEKDAYS}
    dev = lambda a, b: sum(x["coin"] - base[x["wd"]] for x in fc["daily"] if a <= x["d"] <= b)
    ev, after = dev("2025-02-21", "2025-02-23"), dev("2025-02-24", "2025-03-02")
    return dict(event_3d=round(ev), next_7d=round(after), net=round(ev + after), net_theo_at_9_5pct=round((ev + after) * 0.095))


out["tournament_pre_event"] = dict(
    all_pre_event_days=event_study(pre_days),
    normal_pre_event_days=event_study([x for x in pre_days if not (x["city"] or x["prop"] or x["hol"])]),
    break_even_coin_in=round(15_000 / 0.095),
)


def norm_cdf(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


# Detection for the July promotion: a lift is "confirmed" if it beats the 95th
# percentile of ordinary weekends. Noise taken as normal with the fake-weekend SD.
threshold = mean_l + 1.645 * sd_l
out["promotion_detection"] = dict(
    confirm_threshold=round(threshold),
    chance_confirmed={str(L): round(1 - norm_cdf((threshold - L - mean_l) / sd_l), 3)
                      for L in (200_000, 300_000, 500_000, 717_000, 803_000)},
)

# ---------- 2. Detection checks ----------
con = duckdb.connect()
con.sql("SET enable_progress_bar=false")

# Inspection: M-1158 daily spins and one-day hit-rate test.
spins_day, = con.sql(f"""SELECT AVG(paid_spins) FROM '{(DATA / "2_machine_decision/machine_day.parquet").as_posix()}'
    WHERE machine_id = 'M-1158' AND meter_status = 'reported'""").fetchone()
p_pub, p_now = 0.315440, 0.3857
se = math.sqrt(p_pub * (1 - p_pub) / spins_day)
out["inspection_detection"] = dict(spins_per_day=round(spins_day), published_hit_rate=p_pub, current_hit_rate=p_now,
                                   one_day_se=round(se, 4), gap_in_se_one_day=round((p_now - p_pub) / se, 1))

# Maintenance: Ridgeline weekly fault counts (check the Poisson assumption), then a
# one-sided Poisson test over 23 days at the recent (Apr-Jun) fault rate.
weekly = [r[0] for r in con.sql(f"""
    SELECT COUNT(*) FROM '{(DATA / "2_machine_decision/operations.parquet").as_posix()}' o
    JOIN '{(DATA / "2_machine_decision/machines.parquet").as_posix()}' m USING (machine_id)
    WHERE o.event_type = 'fault_repair' AND m.manufacturer = 'Ridgeline'
      AND o.opened_at_utc >= TIMESTAMP '2025-04-07' AND o.opened_at_utc < TIMESTAMP '2025-06-30'
    GROUP BY date_trunc('week', o.opened_at_utc)""").fetchall()]
wm = sum(weekly) / len(weekly)
wv = sum((x - wm) ** 2 for x in weekly) / (len(weekly) - 1)
recent, = con.sql(f"""SELECT COUNT(*) FROM '{(DATA / "2_machine_decision/operations.parquet").as_posix()}' o
    JOIN '{(DATA / "2_machine_decision/machines.parquet").as_posix()}' m USING (machine_id)
    WHERE o.event_type = 'fault_repair' AND m.manufacturer = 'Ridgeline'
      AND o.opened_at_utc >= TIMESTAMP '2025-04-01 13:00' AND o.opened_at_utc < TIMESTAMP '2025-07-01 13:00'""").fetchone()
lam = recent / 91 * 23  # expected Ridgeline faults in 23 days with no effect


def pois_cdf(k, mu):
    term, total = math.exp(-mu), math.exp(-mu)
    for i in range(1, k + 1):
        term *= mu / i
        total += term
    return total


k_crit = 0
while pois_cdf(k_crit + 1, lam) <= 0.05:
    k_crit += 1
out["maintenance_detection"] = dict(
    weekly_mean=round(wm, 1), weekly_variance=round(wv, 1), dispersion_ratio=round(wv / wm, 2),
    expected_faults_23d_no_effect=round(lam, 1),
    significant_if_at_most=k_crit,
    chance_detected={f"{int(r * 100)}%": round(pois_cdf(k_crit, lam * (1 - r)), 3) for r in (0.2, 0.3, 0.5, 0.75)},
)

(ROOT / "checks_results.json").write_text(json.dumps(out, indent=1))
print(json.dumps({k: (v if k != "fake_promotion" else {kk: vv for kk, vv in v.items() if kk != "weekends"}) for k, v in out.items()}, indent=1))
print("fake weekend lifts ($K):", [round(x / 1000) for x in lifts])
