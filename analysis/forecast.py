"""Daily floor coin-in forecast for The Gilded Ace (Dashboard Royale).

Train: gaming dates Jan 1 - Apr 30, 2025. Holdout: May 1 - Jun 30, 2025.
Both forecasts are frozen from training data before the holdout is scored.

Models
  B0  constant:  training-period mean daily coin-in.
  B1  weekday:   training mean coin-in for each weekday.
  M2  weekday + calendar: B1 fitted on "normal" training days, then multiplied by
      factors for citywide events, casino promotions and federal holidays, each
      learned from training days. Only events announced before Apr 30 are used,
      so nothing from the holdout leaks in.

Run from anywhere:  python analysis/forecast.py
Needs: duckdb (pip install duckdb). Writes analysis/forecast_results.json.
"""
import json
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "dashboard-royale" / "data"
TRAIN_END = "2025-04-30"
FREEZE_DATE = "2025-04-30"  # information cut-off for the forecast

con = duckdb.connect()
con.sql("SET enable_progress_bar=false")

days = con.sql(f"""
    SELECT p.gaming_date, strftime(p.gaming_date, '%Y-%m-%d') d, c.local_weekday wd,
           p.coin_in_usd::DOUBLE coin, c.federal_holiday hol
    FROM '{(DATA / "1_prepared_views/property_day.parquet").as_posix()}' p
    JOIN '{(DATA / "2_machine_decision/calendar_day.parquet").as_posix()}' c USING (gaming_date)
    ORDER BY gaming_date
""").fetchall()

# Event calendar as it was known on the freeze date.
events = con.sql(f"""
    SELECT name, local_scope, start_date, end_date
    FROM '{(DATA / "4_context/events.parquet").as_posix()}'
    WHERE announced_date <= DATE '{FREEZE_DATE}'
""").fetchall()


def day_flags(gdate, hol):
    city = any(s == "citywide" and a <= gdate <= b for _, s, a, b in events)
    prop = any(s == "property" and a <= gdate <= b for _, s, a, b in events)
    return city, prop, hol is not None


rows = []
for gdate, d, wd, coin, hol in days:
    city, prop, holiday = day_flags(gdate, hol)
    rows.append(dict(d=d, wd=wd, coin=coin, city=city, prop=prop, hol=holiday, train=d <= TRAIN_END))

train = [r for r in rows if r["train"]]
test = [r for r in rows if not r["train"]]
mean = lambda xs: sum(xs) / len(xs)
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

# B0 and B1
b0 = mean([r["coin"] for r in train])
b1 = {w: mean([r["coin"] for r in train if r["wd"] == w]) for w in WEEKDAYS}

# M2: weekday level from normal days only, then calendar multipliers.
normal = [r for r in train if not (r["city"] or r["prop"] or r["hol"])]
base = {w: mean([r["coin"] for r in normal if r["wd"] == w]) for w in WEEKDAYS}


def factor(flag):
    sel = [r for r in train if r[flag]]
    return mean([r["coin"] / base[r["wd"]] for r in sel]), len(sel)


f_city, n_city = factor("city")
f_prop, n_prop = factor("prop")
f_hol, n_hol = factor("hol")


def m2(r, use_prop=True):
    f = 1.0
    if r["city"]:
        f *= f_city
    if r["prop"] and use_prop:
        f *= f_prop
    if r["hol"]:
        f *= f_hol
    return base[r["wd"]] * f


for r in rows:
    r["b0"] = b0
    r["b1"] = b1[r["wd"]]
    r["m2"] = m2(r)
    r["m2_no_promo"] = m2(r, use_prop=False)


def score(key, subset):
    errs = [r["coin"] - r[key] for r in subset]
    mae = mean([abs(e) for e in errs])
    return dict(mae=round(mae), bias=round(mean(errs)), mape=round(100 * mean([abs(e) / r["coin"] for e, r in zip(errs, subset)]), 2))


results = {
    "train_days": len(train), "test_days": len(test),
    "factors": {"citywide_event": round(f_city, 4), "n_city_days": n_city,
                "property_promo": round(f_prop, 4), "n_promo_days": n_prop,
                "holiday": round(f_hol, 4), "n_holiday_days": n_hol},
    "holdout": {k: score(k, test) for k in ("b0", "b1", "m2")},
    "holdout_event_days": {k: score(k, [r for r in test if r["city"] or r["prop"] or r["hol"]]) for k in ("b0", "b1", "m2")},
    "holdout_normal_days": {k: score(k, [r for r in test if not (r["city"] or r["prop"] or r["hol"])]) for k in ("b0", "b1", "m2")},
    "train_fit": {k: score(k, train) for k in ("b0", "b1", "m2")},
}

# Promotion lift, measured after the fact: actual vs. the frozen forecast with the
# promo factor switched off. This uses the full event list (including promotions
# announced after the freeze), because it evaluates the past rather than forecasting.
# Uncertainty: daily residual SD of M2 on normal holdout days, scaled by sqrt(days).
resid = [r["coin"] - r["m2"] for r in test if not (r["city"] or r["prop"] or r["hol"])]
sd = (sum((e - mean(resid)) ** 2 for e in resid) / (len(resid) - 1)) ** 0.5
all_events = con.sql(f"""SELECT name, local_scope, start_date, end_date
    FROM '{(DATA / "4_context/events.parquet").as_posix()}' WHERE local_scope = 'property'""").fetchall()
promos = {}
for name, scope, a, b in all_events:
    sel = [r for r in rows if a.isoformat() <= r["d"] <= b.isoformat()]
    actual = sum(r["coin"] for r in sel)
    expected = sum(r["m2_no_promo"] for r in sel)
    promos[name] = dict(start=a.isoformat(), days=len(sel), actual=round(actual), expected_without_promo=round(expected),
                        lift=round(actual - expected), lift_pct=round(100 * (actual / expected - 1), 2),
                        lift_95ci=round(1.96 * sd * len(sel) ** 0.5))
results["residual_sd_normal_day"] = round(sd)
results["promotion_lift"] = promos

results["daily"] = [{k: (round(v) if isinstance(v, float) else v) for k, v in r.items()} for r in rows]
(ROOT / "forecast_results.json").write_text(json.dumps(results, indent=1))

print(json.dumps({k: v for k, v in results.items() if k != "daily"}, indent=1))
