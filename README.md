# Gilded Ace: luck, location, or a leak?

Submission for the TAMU Datathon 2026 **Dashboard Royale** challenge. The Gilded Ace is a fictional 300-machine casino with synthetic data for January–June 2025.

**Live dashboard:** https://hussam-mak.github.io/gilded-ace-dashboard/

- **Floor** (`index.html`): the casino floor in 3D (or a flat plan view). Every machine sits at its real slot; color it by play, luck, payout check or uptime and click any machine to see its numbers. Guests walking the floor follow the casino's real foot-traffic counts.
- **Dashboard** (`dashboard.html`): seven tabs — Answer, Machines, Floor & demand, Downtime, Guests & comps, Model, July plan — with global period and zone/bank filters.

## The answer in one paragraph

The manager wants to replace the ten machines that earned the least. Nine of those ten earned what their bets predict (a luck test across all 310 machines matches pure chance), and nine sit in Back Forty, a zone where the same games earn about 0.65× what they earn elsewhere. One machine, **M-1158**, pays out on 38.6% of spins against a published 31.5% on 674,454 spins — a gap luck cannot produce. The July plan commits **$16,200**: inspect M-1158 ($1,200) and run one tournament-style promotion weekend ($15,000) only if it passes go/no-go checks; **$83,800** is kept.

## Repository layout

| Path | What it is |
| --- | --- |
| `dashboard/` | The static site (also published from the `gh-pages` branch) |
| `analysis/forecast.py` | Daily coin-in forecast: weekday + calendar model vs. weekday and flat baselines, trained Jan–Apr, scored May–Jun |
| `analysis/checks.py` | Placebo weekends, pre-event tournament baseline, detection checks |
| `analysis/plan_options.py` | Alternative $100K plans simulated under stated assumptions, plus promotion downside scenarios |
| `analysis/build_dashboard_data.py` | Pre-aggregates the data into `dashboard/data.js` |
| `analysis/budget-plan.html` | The July plan as a standalone page, with the claims-and-evidence appendix |
| `analysis/*_results.json` | Saved outputs of the scripts above |

## Reproduce

Requires Python 3.11+ and DuckDB (`pip install duckdb`).

```sh
git clone https://github.com/Hussam-Mak/gilded-ace-dashboard.git
cd gilded-ace-dashboard
git clone --depth 1 https://github.com/tamu-datathon-org/dashboard-royale.git   # organizer data, not redistributed here
python analysis/forecast.py
python analysis/checks.py
python analysis/plan_options.py
python analysis/build_dashboard_data.py
python -m http.server 8765 --directory dashboard   # then open http://localhost:8765
```

## Data notes

- The casino and its data are fictional and synthetic (Dashboard Royale release 0.9.0-draft).
- The challenge also ships real public tables. LVCVA visitation and Missouri Gaming Commission figures are **not** republished here because their publishers have not cleared redistribution (see the organizers' `reference/SOURCE_TERMS.md`); neither was a model input. NOAA weather is public domain.
- Money figures are expected house win (coin-in × configured payout rate) unless labeled otherwise; simulated plan results are conditional on the stated assumption ranges.

## AI use

Built with Claude (Anthropic) via Claude Code as a pair analyst and engineer: exploring the data, writing and checking the SQL/Python analyses, building the dashboard and 3D floor, and drafting text. Every number shown was produced by the scripts in `analysis/` and checked against the data; an external review prompted corrections that are reflected in the plan.
