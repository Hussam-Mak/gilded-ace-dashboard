"""Recompute every headline number in the write-up straight from the challenge data.

Each block prints one claim's evidence; the appendix (submission/APPENDIX.md) cites
these outputs by claim number. Run after forecast.py and checks.py:
    python analysis/claims_check.py
Needs: duckdb. Writes analysis/claims_check_results.json.
"""
import json
import math
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent
DATA = ROOT.parent / "dashboard-royale" / "data"
con = duckdb.connect()
con.sql("SET enable_progress_bar=false")


def p(rel: str) -> str:
    return f"'{(DATA / rel).as_posix()}.parquet'"


def one(sql: str):
    return con.sql(sql).fetchone()


PDV, MD, GM = p("1_prepared_views/prepared_daily_view"), p("2_machine_decision/machine_day"), p("2_machine_decision/game_math")
out = {}

# Machine totals with luck variance (sum of bet^2 x payout-multiplier variance) and hit counts.
con.sql(f"""CREATE TABLE m AS
SELECT d.machine_id, mode(v.zone_name) zname, COUNT(*) ndays, SUM(d.house_win_cents) / 100.0 win, SUM(d.theo_cents::DOUBLE) / 100 theo,
       SUM(d.sum_bet_squared * g.payout_multiplier_variance::DOUBLE) / 10000.0 var, SUM(d.paid_spins) spins, SUM(d.payout_positive_spins) hits,
       SUM(d.paid_spins * g.hit_probability::DOUBLE) exp_hits, SUM(d.paid_spins * g.hit_probability::DOUBLE * (1 - g.hit_probability::DOUBLE)) hit_var
FROM {MD} d JOIN {GM} g USING (config_id) JOIN {PDV} v USING (machine_id, gaming_date)
WHERE d.meter_status = 'reported' AND v.location_id IS NOT NULL GROUP BY 1""")
con.sql("CREATE TABLE z AS SELECT *, (win - theo) / sqrt(var) luck_z, (hits - exp_hits) / sqrt(hit_var) hit_z FROM m")

# C1 luck scores across 310 machines look like pure chance
n, mean, sd, gt2, gt3 = one("SELECT COUNT(*), avg(luck_z), stddev(luck_z), SUM(CASE WHEN abs(luck_z) > 2 THEN 1 ELSE 0 END), SUM(CASE WHEN abs(luck_z) > 3 THEN 1 ELSE 0 END) FROM z")
out["C1_luck_distribution"] = dict(machines=n, mean=round(mean, 3), sd=round(sd, 3), beyond_2=gt2, expected_beyond_2=round(n * 0.0455, 1), beyond_3=gt3)

# C2 bottom ten by raw house win: zone and luck score
b10 = con.sql("SELECT machine_id, zname, ndays, round(win), round(luck_z, 2), round(hit_z, 1) FROM z ORDER BY win LIMIT 10").fetchall()
out["C2_bottom_ten"] = dict(rows=b10, in_back_forty=sum(1 for r in b10 if r[1] == "Back Forty"),
                            within_2_luck_and_normal_hits=sum(1 for r in b10 if abs(r[4]) < 2.5 and abs(r[5]) < 5))

# C3 M-1158 hit rate vs published and vs other Desert Gold machines
h = one("SELECT hits, spins, exp_hits / spins, hit_z FROM z WHERE machine_id = 'M-1158'")
other = one(f"SELECT SUM(payout_positive_spins)::DOUBLE / SUM(paid_spins), COUNT(DISTINCT machine_id) FROM {MD} WHERE config_id = 'G-STD90' AND machine_id <> 'M-1158' AND meter_status = 'reported'")
monthly = con.sql(f"SELECT strftime(gaming_date, '%m'), round(SUM(payout_positive_spins)::DOUBLE / SUM(paid_spins), 4) FROM {MD} WHERE machine_id = 'M-1158' AND meter_status = 'reported' GROUP BY 1 ORDER BY 1").fetchall()
out["C3_m1158"] = dict(spins=h[1], hit_rate=round(h[0] / h[1], 4), published=round(h[2], 4), standard_errors=round(h[3], 1),
                       other_desert_gold_rate=round(other[0], 4), other_machines=other[1], monthly=monthly)

# C4 Back Forty earns ~0.65x the same game elsewhere (game-and-day adjusted)
con.sql(f"""CREATE TABLE dd AS SELECT gaming_date, config_id, zone_name, coin_in_usd::DOUBLE coin, available_hours FROM {PDV} WHERE location_id IS NOT NULL AND available_hours > 0""")
con.sql("CREATE TABLE cfg AS SELECT gaming_date, config_id, SUM(coin) / SUM(available_hours) r FROM dd GROUP BY 1, 2")
idx = dict(con.sql("SELECT zone_name, round(SUM(coin) / SUM(r * available_hours), 3) FROM dd JOIN cfg USING (gaming_date, config_id) GROUP BY 1").fetchall())
out["C4_zone_index"] = idx

# C5 walkway closure: Back Forty share of floor rate before/during/after; floor total vs forecast
con.sql(f"""CREATE TABLE zr AS SELECT gaming_date,
  SUM(CASE WHEN zone_name = 'Back Forty' THEN coin END) / SUM(CASE WHEN zone_name = 'Back Forty' THEN available_hours END) b,
  SUM(CASE WHEN zone_name NOT IN ('Back Forty', 'High-Limit Room') THEN coin END) / SUM(CASE WHEN zone_name NOT IN ('Back Forty', 'High-Limit Room') THEN available_hours END) o
  FROM dd GROUP BY 1""")
per = con.sql("""SELECT CASE WHEN gaming_date < DATE '2025-03-03' THEN '1 before' WHEN gaming_date <= DATE '2025-04-06' THEN '2 closed' ELSE '3 after' END p,
  round(avg(b / o), 3) FROM zr GROUP BY 1 ORDER BY 1""").fetchall()
fc = json.loads((ROOT / "forecast_results.json").read_text())
resid = lambda a, b: round(sum(x["coin"] - x["m2"] for x in fc["daily"] if a <= x["d"] <= b) / max(1, sum(1 for x in fc["daily"] if a <= x["d"] <= b)))
out["C5_closure"] = dict(back_forty_share=per, floor_forecast_residual_per_day=dict(before=resid("2025-01-01", "2025-03-02"), closed=resid("2025-03-03", "2025-04-06")))

# C6 downtime: repair time and fault rate by manufacturer
fr = con.sql(f"""SELECT m.manufacturer, COUNT(*), round(avg((epoch(o.available_at_utc) - epoch(o.work_started_at_utc)) / 3600), 2)
  FROM {p('2_machine_decision/operations')} o JOIN {p('2_machine_decision/machines')} m USING (machine_id) WHERE o.event_type = 'fault_repair' GROUP BY 1 ORDER BY 1""").fetchall()
mdays = dict(con.sql(f"SELECT manufacturer, COUNT(*) FROM {PDV} WHERE location_id IS NOT NULL GROUP BY 1").fetchall())
rates = {r[0]: round(r[1] / (mdays[r[0]] / 30.4), 3) for r in fr}
out["C6_downtime"] = dict(faults=[list(r) for r in fr], faults_per_machine_month=rates, ridgeline_vs_halcyon=round(rates["Ridgeline"] / rates["Halcyon"], 2))

# C7 tracked players: concentration and share ahead
PP = p("1_prepared_views/player_period")
con.sql(f"CREATE TABLE pl AS SELECT player_id, SUM(theo_usd)::DOUBLE theo, SUM(tracked_net_usd)::DOUBLE net, SUM(tracked_coin_in_usd)::DOUBLE coin FROM {PP} GROUP BY 1")
top, ahead, totnet, tottheo = one("""WITH q AS (SELECT *, ntile(10) OVER (ORDER BY theo DESC) d FROM pl)
  SELECT SUM(CASE WHEN d = 1 THEN theo END) / SUM(theo), avg(CASE WHEN net > 0 THEN 1.0 ELSE 0 END), SUM(net), SUM(theo) FROM q""")
out["C7_players"] = dict(top_decile_theo_share=round(top, 4), share_ahead=round(ahead, 4), total_net=round(totnet), total_theo=round(tottheo))

# C8 May 1 comp points price by tier
cp = con.sql(f"""WITH r AS (SELECT *, CAST(event_at_utc - INTERVAL 13 HOUR AS DATE) gd FROM {p('3_guests/loyalty_ledger')} WHERE event_type = 'redeem')
  SELECT tier_before, CASE WHEN gd < DATE '2025-05-01' THEN 'before' ELSE 'after' END, round(SUM(-points_delta) / (SUM(face_value_cents) / 100.0), 2)
  FROM r WHERE gd BETWEEN DATE '2025-01-01' AND DATE '2025-06-30' GROUP BY 1, 2 ORDER BY 1, 2""").fetchall()
out["C8_comp_price"] = cp

# C9-C10 from the saved model and check outputs
ck = json.loads((ROOT / "checks_results.json").read_text())
out["C9_forecast_mae"] = {k: v["mae"] for k, v in fc["holdout"].items()}
out["C10_tournament"] = dict(pre_event=ck["tournament_pre_event"], placebo_rank=ck["fake_promotion"]["tournament_rank"],
                             placebo_max=ck["fake_promotion"]["max_lift"], placebo_weekends=ck["fake_promotion"]["n_weekends"])

(ROOT / "claims_check_results.json").write_text(json.dumps(out, indent=1, default=str))
for k, v in out.items():
    print(k, json.dumps(v, default=str)[:400])
