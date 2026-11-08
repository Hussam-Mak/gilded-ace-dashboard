"""Pre-aggregate the Dashboard Royale data for the static dashboard.

Writes dashboard/data.js, which sets window.DATA. Every table is additive, so the
page can re-sum it for any month range and zone/bank/guest filter:
  machine_month  one row per machine x month (sums: hours, coin-in, win, theo,
                 luck variance, hits, expected hits, location-expected coin-in)
  zone_day       coin-in, available hours and location-expected coin-in per zone x day
  guests         player-month sums per month x tier x region x age band
  downtime       fault repairs per month x manufacturer x zone x shift

Run after forecast.py, checks.py and plan_options.py:
    python analysis/build_dashboard_data.py
Needs: duckdb.
"""
import json
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "dashboard-royale" / "data"
OUT = ROOT.parent / "dashboard" / "data.js"


def p(rel: str) -> str:
    return f"'{(DATA / rel).as_posix()}.parquet'"


con = duckdb.connect()
con.sql("SET enable_progress_bar=false")


def rows(sql: str) -> list:
    """Return query rows as lists of plain JSON-safe values."""
    out = []
    for r in con.sql(sql).fetchall():
        clean = []
        for v in r:
            if v is None or isinstance(v, (int, str, bool)):
                clean.append(v)
            elif isinstance(v, float):
                clean.append(round(v, 4))
            else:
                try:
                    clean.append(round(float(v), 4))
                except (TypeError, ValueError):
                    clean.append(str(v))
        out.append(clean)
    return out


PDV, MD, GM, CAL = p("1_prepared_views/prepared_daily_view"), p("2_machine_decision/machine_day"), p("2_machine_decision/game_math"), p("2_machine_decision/calendar_day")
MACH, OPS, FL, WALK = p("2_machine_decision/machines"), p("2_machine_decision/operations"), p("2_machine_decision/floor_locations"), p("2_machine_decision/floor_walkways")

# ---------- base machine-day table ----------
con.sql(f"""CREATE TABLE d AS
SELECT v.machine_id, v.gaming_date, strftime(v.gaming_date, '%Y-%m') mon, v.zone_id, v.bank_id, v.config_id,
       v.available_hours avail_h, c.scheduled_seconds / 3600.0 sched_h, v.occupied_hours occ_h,
       v.coin_in_usd::DOUBLE coin, v.house_win_usd::DOUBLE win, v.theo_usd::DOUBLE theo, v.faults_opened faults,
       v.carded_coin_in_usd::DOUBLE carded,
       m.paid_spins spins, m.payout_positive_spins hits, g.hit_probability::DOUBLE hp,
       m.sum_bet_squared * g.payout_multiplier_variance::DOUBLE / 10000.0 var_usd2
FROM {PDV} v
JOIN {MD} m USING (machine_id, gaming_date)
JOIN {GM} g ON g.config_id = v.config_id
JOIN {CAL} c ON c.gaming_date = v.gaming_date
WHERE v.location_id IS NOT NULL""")
# Location-expected coin-in: what this machine's game earned per available hour
# across the whole floor that day, times this machine's available hours.
con.sql("""CREATE TABLE cfg AS SELECT gaming_date, config_id, SUM(coin) / nullif(SUM(avail_h), 0) cfg_rate FROM d GROUP BY 1, 2""")
con.sql("""CREATE TABLE d2 AS SELECT d.*, coalesce(cfg.cfg_rate * d.avail_h, 0) exp_coin FROM d JOIN cfg USING (gaming_date, config_id)""")

months = [r[0] for r in rows("SELECT DISTINCT mon FROM d ORDER BY 1")]

machine_month = rows("""
SELECT machine_id, mon, mode(zone_id), mode(bank_id), COUNT(*),
       round(SUM(avail_h), 2), round(SUM(sched_h), 2), round(SUM(occ_h), 2),
       round(SUM(coin)), round(SUM(win)), round(SUM(theo), 1), round(SUM(var_usd2)),
       SUM(spins), SUM(hits), round(SUM(spins * hp), 1), round(SUM(spins * hp * (1 - hp)), 1),
       round(SUM(exp_coin)), SUM(faults), round(SUM(carded))
FROM d2 GROUP BY 1, 2 ORDER BY 1, 2""")

zone_day = rows("""SELECT strftime(gaming_date, '%Y-%m-%d'), zone_id, round(SUM(coin)), round(SUM(avail_h), 1), round(SUM(exp_coin))
FROM d2 GROUP BY 1, 2 ORDER BY 1, 2""")

daily = rows(f"""
SELECT strftime(p.gaming_date, '%Y-%m-%d'), c.local_weekday, coalesce(p.events_active, ''), coalesce(c.federal_holiday, ''),
       round(p.coin_in_usd), round(p.house_win_usd), round(p.theo_usd), round(p.available_machine_hours, 1),
       round(p.occupied_machine_hours, 1), p.total_zone_entries_observed, round(p.counter_coverage_share, 3),
       p.faults_opened, round(p.comp_cost_usd), round(p.pos_cash_usd), round(p.carded_coin_in_share, 4),
       round(c.scheduled_seconds / 3600.0, 2), p.active_machines
FROM {p('1_prepared_views/property_day')} p JOIN {CAL} c USING (gaming_date) ORDER BY p.gaming_date""")

machines = rows(f"""SELECT m.machine_id, m.manufacturer, m.theme, any_value(d.config_id), any_value(g.volatility_class),
       any_value(g.configured_rtp), strftime(m.install_date, '%Y-%m-%d'), coalesce(strftime(m.retire_date, '%Y-%m-%d'), ''), m.lease_class,
       any_value(g.hit_probability)
FROM {MACH} m JOIN d USING (machine_id) JOIN {GM} g ON g.config_id = d.config_id GROUP BY m.machine_id, m.manufacturer, m.theme, m.install_date, m.retire_date, m.lease_class""")

zones = rows(f"SELECT location_id, name, x_m, y_m FROM {FL} WHERE node_type = 'zone' ORDER BY 1")
zone_names = dict(rows("SELECT DISTINCT zone_id, zone_name FROM " + PDV + " WHERE zone_id IS NOT NULL"))
zones = [[z[0], zone_names.get(z[0], z[1]), z[2], z[3]] for z in zones]
banks = rows(f"SELECT location_id, zone_id, x_m, y_m, capacity FROM {FL} WHERE node_type = 'bank' ORDER BY 1")
points = rows(f"SELECT location_id, node_type, zone_id, coalesce(name, location_id), x_m, y_m FROM {FL} WHERE node_type IN ('entrance', 'outlet')")
slots = rows(f"SELECT location_id, zone_id, bank_id, x_m, y_m FROM {FL} WHERE node_type = 'slot' ORDER BY 1")
# Placement intervals as gaming dates: [from, to). Gaming days start 06:00 local (13:00-14:00 UTC).
placements = rows(f"""SELECT machine_id, location_id, strftime(CAST(effective_from_utc - INTERVAL 13 HOUR AS DATE), '%Y-%m-%d'),
       coalesce(strftime(CAST(effective_to_utc - INTERVAL 13 HOUR AS DATE), '%Y-%m-%d'), '')
FROM {p('2_machine_decision/placements')} ORDER BY machine_id, effective_from_utc""")
walkways = rows(f"""SELECT walkway_id, zone_a, zone_b, length_m, coalesce(strftime(closed_from_utc, '%Y-%m-%d'), ''),
       coalesce(strftime(closed_to_utc - INTERVAL 13 HOUR, '%Y-%m-%d'), ''), coalesce(closure_reason, '') FROM {WALK}""")
events = rows(f"SELECT name, event_type, local_scope, strftime(start_date, '%Y-%m-%d'), strftime(end_date, '%Y-%m-%d'), strftime(announced_date, '%Y-%m-%d') FROM {p('4_context/events')} ORDER BY start_date")

# ---------- downtime ----------
con.sql(f"""CREATE TABLE f AS
SELECT o.operation_id, o.machine_id, m.manufacturer mf, o.opened_at_utc, o.work_started_at_utc, o.available_at_utc, o.direct_cost_cents / 100.0 repair_cost,
       CAST(o.opened_at_local - INTERVAL 6 HOUR AS DATE) gd, hour(o.opened_at_local) h,
       (epoch(o.work_started_at_utc) - epoch(o.opened_at_utc)) / 3600 wait_h, (epoch(o.available_at_utc) - epoch(o.work_started_at_utc)) / 3600 fix_h
FROM {OPS} o JOIN {MACH} m USING (machine_id) WHERE o.event_type = 'fault_repair'""")
con.sql(f"""CREATE TABLE fr AS SELECT f.*, r.shift, r.actual_headcount techs,
  (SELECT COUNT(*) FROM f g WHERE g.opened_at_utc < f.opened_at_utc AND g.available_at_utc > f.opened_at_utc) open_before,
  (SELECT any_value(zone_id) FROM d WHERE d.machine_id = f.machine_id AND d.gaming_date = f.gd) zone_id
  FROM f LEFT JOIN {p('5_optional/shift_roster')} r ON r.role = 'slot_tech' AND f.opened_at_utc >= r.start_utc AND f.opened_at_utc < r.end_utc""")
con.sql(f"""CREATE TABLE rate AS SELECT machine_id, local_hour, SUM(coin_in_cents) / 100.0 / nullif(SUM(available_seconds), 0) usd_per_s
  FROM {p('5_optional/machine_hour')} WHERE active GROUP BY 1, 2""")
con.sql(f"""CREATE TABLE mh AS SELECT machine_id, hour_start_utc, local_hour FROM {p('5_optional/machine_hour')} WHERE active AND available_seconds < 3600""")
con.sql("""CREATE TABLE lost AS SELECT fr.operation_id,
  SUM(greatest(0, least(epoch(fr.work_started_at_utc), epoch(mh.hour_start_utc) + 3600) - greatest(epoch(fr.opened_at_utc), epoch(mh.hour_start_utc))) * r.usd_per_s) lw,
  SUM(greatest(0, least(epoch(fr.available_at_utc), epoch(mh.hour_start_utc) + 3600) - greatest(epoch(fr.work_started_at_utc), epoch(mh.hour_start_utc))) * r.usd_per_s) lf
  FROM fr JOIN mh ON mh.machine_id = fr.machine_id AND mh.hour_start_utc < fr.available_at_utc AND mh.hour_start_utc + INTERVAL 1 HOUR > fr.opened_at_utc
  JOIN rate r ON r.machine_id = fr.machine_id AND r.local_hour = mh.local_hour GROUP BY 1""")
downtime = rows("""SELECT strftime(gd, '%Y-%m'), mf, coalesce(zone_id, ''), shift, COUNT(*), round(SUM(wait_h), 2), round(SUM(fix_h), 2),
  round(SUM(coalesce(l.lw, 0))), round(SUM(coalesce(l.lf, 0))), round(SUM(repair_cost))
  FROM fr LEFT JOIN lost l USING (operation_id) GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4""")
queue = rows("SELECT techs, least(open_before, 2), COUNT(*), round(avg(wait_h), 2) FROM fr GROUP BY 1, 2 ORDER BY 1, 2")
fault_hours = rows("SELECT h, COUNT(*), round(avg(wait_h), 2), round(avg(fix_h), 2) FROM fr GROUP BY 1 ORDER BY 1")
roster = rows(f"""SELECT strftime(gaming_date, '%Y-%m'), shift, round(avg(planned_headcount), 2), round(avg(actual_headcount), 2)
  FROM {p('5_optional/shift_roster')} WHERE role = 'slot_tech' GROUP BY 1, 2 ORDER BY 1, 2""")

# ---------- guests ----------
PP = p("1_prepared_views/player_period")
guests = rows(f"""SELECT period_month, opening_tier, home_region, coalesce(age_band, 'Unknown'), COUNT(*),
  round(SUM(tracked_coin_in_usd)), round(SUM(tracked_payout_usd)), round(SUM(tracked_net_usd)), round(SUM(theo_usd)),
  round(SUM(comp_cost_usd)), round(SUM(comp_face_value_usd)), SUM(observed_visits), SUM(CASE WHEN tracked_net_usd > 0 THEN 1 ELSE 0 END),
  SUM(points_earned), SUM(points_redeemed), round(SUM(linked_pos_cash_usd)), round(SUM(linked_pos_cogs_usd)), round(SUM(tracked_contribution_usd))
  FROM {PP} GROUP BY 1, 2, 3, 4 ORDER BY 1, 2, 3, 4""")
con.sql(f"""CREATE TABLE pl AS SELECT player_id, any_value(opening_tier) tier, any_value(home_region) region, coalesce(any_value(age_band), 'Unknown') age,
  SUM(theo_usd)::DOUBLE theo, SUM(tracked_net_usd)::DOUBLE net, SUM(tracked_coin_in_usd)::DOUBLE coin FROM {PP} GROUP BY 1""")


def deciles(where: str = "TRUE") -> dict:
    r = con.sql(f"""WITH q AS (SELECT theo, net, ntile(10) OVER (ORDER BY theo DESC) dcl FROM pl WHERE {where})
      SELECT dcl, SUM(theo), COUNT(*), SUM(CASE WHEN net > 0 THEN 1 ELSE 0 END), avg(net) FROM q GROUP BY 1 ORDER BY 1""").fetchall()
    total = sum(x[1] for x in r) or 1
    return dict(share=[round(x[1] / total, 4) for x in r], ahead=[round(x[3] / x[2], 4) for x in r], avg_net=[round(x[4], 1) for x in r],
                players=sum(x[2] for x in r))


concentration = {"all": deciles()}
for col in ("tier", "region", "age"):
    for (val,) in con.sql(f"SELECT DISTINCT {col} FROM pl ORDER BY 1").fetchall():
        safe = str(val).replace("'", "''")
        concentration[f"{col}:{val}"] = deciles(f"{col} = '{safe}'")

# ---------- comps and F&B ----------
LL = p("3_guests/loyalty_ledger")
comp_weekly = rows(f"""WITH r AS (SELECT *, CAST(event_at_utc - INTERVAL 13 HOUR AS DATE) gd FROM {LL} WHERE event_type = 'redeem')
  SELECT strftime(date_trunc('week', gd), '%Y-%m-%d'), tier_before, round(SUM(-points_delta) / (SUM(face_value_cents) / 100.0), 2), COUNT(*)
  FROM r WHERE gd BETWEEN DATE '2025-01-06' AND DATE '2025-06-29' GROUP BY 1, 2 ORDER BY 1, 2""")
fnb = rows(f"""WITH t AS (SELECT *, CAST(event_at_local - INTERVAL 6 HOUR AS DATE) gd,
    CASE WHEN comp_id IS NOT NULL THEN 'comp' WHEN player_id IS NOT NULL THEN 'carded' ELSE 'uncarded' END kind,
    item IN ('burger', 'pasta', 'salad', 'steak') meal FROM {p('3_guests/fnb_transactions')})
  SELECT strftime(gd, '%Y-%m-%d'), kind, meal, COUNT(*), round(SUM(cash_receipt_cents) / 100.0), round(SUM(face_value_cents) / 100.0), round(SUM(cogs_cents) / 100.0)
  FROM t WHERE gd BETWEEN DATE '2025-01-01' AND DATE '2025-06-30' GROUP BY 1, 2, 3 ORDER BY 1, 2, 3""")

# ---------- foot traffic (drives the walking guests on the floor page) ----------
ZT = p("4_context/zone_traffic_hourly")
traffic_day = rows(f"""SELECT strftime(CAST(hour_start_local - INTERVAL 6 HOUR AS DATE), '%Y-%m-%d') gd, zone_id,
  SUM(entries_count), COUNT(*) FROM {ZT} WHERE counter_status = 'ok' GROUP BY 1, 2 ORDER BY 1, 2""")
traffic_hour = rows(f"""SELECT zone_id, local_hour, round(avg(entries_count), 1) FROM {ZT} WHERE counter_status = 'ok' GROUP BY 1, 2 ORDER BY 1, 2""")

# ---------- context ----------
# LVCVA and Missouri Gaming Commission tables are not cleared for redistribution
# (dashboard-royale/reference/SOURCE_TERMS.md), so the public build leaves them out.
# Set INCLUDE_RESTRICTED=1 for a local-only build that shows them.
import os
if os.environ.get("INCLUDE_RESTRICTED") == "1":
    city = rows(f"SELECT month, visitor_volume, convention_attendance, hotel_occupancy_ratio FROM {p('4_context/real_sources/city_visitation_monthly')} ORDER BY 1")
    missouri = rows(f"SELECT month, slot_units, handle_usd, agr_usd FROM {p('4_context/real_sources/benchmark_state_monthly')} ORDER BY 1")
else:
    city, missouri = [], []
weather = rows(f"SELECT strftime(source_date, '%Y-%m-%d'), tmax_c, prcp_mm FROM {p('4_context/real_sources/weather_daily')} ORDER BY 1")

# ---------- model and plan outputs ----------
fc = json.loads((ROOT / "forecast_results.json").read_text())
ck = json.loads((ROOT / "checks_results.json").read_text())
po = json.loads((ROOT / "plan_options_results.json").read_text())
model = dict(
    holdout={k: v for k, v in fc["holdout"].items()},
    holdout_event_days=fc["holdout_event_days"], holdout_normal_days=fc["holdout_normal_days"],
    factors=fc["factors"], train_days=fc["train_days"], test_days=fc["test_days"],
    daily=[[x["d"], x["coin"], x["b0"], x["b1"], x["m2"], x["train"]] for x in fc["daily"]],
    placebo=[[w["friday"], w["lift"], w["holdout"]] for w in ck["fake_promotion"]["weekends"]],
    placebo_summary={k: v for k, v in ck["fake_promotion"].items() if k != "weekends"},
    tournament_pre_event=ck["tournament_pre_event"], detection=dict(inspection=ck["inspection_detection"], promotion=ck["promotion_detection"]),
)
plan = dict(plans=po["plans"], scenarios=po["promo_scenarios"], break_even=po["promo_break_even"], note=po["note"])

DATA_OUT = dict(
    generated_from="dashboard-royale data release 0.9.0-draft",
    months=months,
    machine_month_cols=["machine", "month", "zone", "bank", "days", "avail_h", "sched_h", "occ_h", "coin", "win", "theo", "var",
                        "spins", "hits", "exp_hits", "hit_var", "exp_coin", "faults", "carded"],
    machine_month=machine_month,
    zone_day_cols=["date", "zone", "coin", "avail_h", "exp_coin"], zone_day=zone_day,
    daily_cols=["date", "weekday", "events", "holiday", "coin", "win", "theo", "avail_mh", "occ_mh", "entries", "coverage",
                "faults", "comp_cost", "pos_cash", "carded_share", "sched_h", "active_machines"], daily=daily,
    machines_cols=["machine", "manufacturer", "theme", "config", "volatility", "rtp", "install", "retire", "lease", "hit_prob"], machines=machines,
    zones=zones, banks=banks, points=points, walkways=walkways, events=events,
    slots_cols=["slot", "zone", "bank", "x", "y"], slots=slots,
    traffic_day_cols=["date", "zone", "entries", "ok_hours"], traffic_day=traffic_day,
    traffic_hour_cols=["zone", "hour", "avg_entries"], traffic_hour=traffic_hour,
    placements_cols=["machine", "slot", "from", "to"], placements=placements,
    downtime_cols=["month", "manufacturer", "zone", "shift", "faults", "wait_h", "fix_h", "lost_wait_coin", "lost_fix_coin", "repair_cost"],
    downtime=downtime, queue=queue, fault_hours=fault_hours, roster=roster,
    guests_cols=["month", "tier", "region", "age", "player_months", "coin", "payout", "net", "theo", "comp_cost", "comp_face", "visits",
                 "ahead", "pts_earned", "pts_redeemed", "pos_cash", "pos_cogs", "contribution"], guests=guests,
    concentration=concentration, comp_weekly=comp_weekly,
    fnb_cols=["date", "kind", "meal", "tickets", "cash", "face", "cogs"], fnb=fnb,
    city=city, missouri=missouri, weather=weather, model=model, plan=plan,
)
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text("window.DATA = " + json.dumps(DATA_OUT, separators=(",", ":")) + ";\n", encoding="utf-8")
print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.0f} KB)")
for k in ("machine_month", "zone_day", "daily", "guests", "downtime", "fnb", "comp_weekly"):
    print(k, len(DATA_OUT[k]))
