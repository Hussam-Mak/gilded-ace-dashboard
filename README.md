# Gilded Ace Floor Review — dashboard

A static, two-page site for the TAMU Datathon 2026 *Dashboard Royale* challenge. No server code: HTML, CSS and JavaScript plus pre-aggregated data.

| File | What it is |
| --- | --- |
| `index.html` + `floor.js` | **Floor** (landing page): every slot machine at its real position, colored by play, luck, payout check or uptime. Click a machine to see its numbers. Toggle between the 3D floor and a flat plan view. |
| Status lights | The beacon on each machine replays the last day of the selected period at the clock time: green = in play that hour (real hourly occupancy, dimmer for part-hour play), yellow = fault reported and waiting for a technician, red (blinking) = under repair (real repair tickets), off = idle. The dataset has no paper or coin levels, so those states are not shown. |
| Cameras | "3D" is a perspective view you can orbit; "Top-down" is a true orthographic plan with north up. "Go to" jumps smoothly to the full floor or any zone. |
| `floor3d.js` | The 3D floor (three.js 0.128 from jsDelivr): green-felt floor painted to the real layout, one cabinet per occupied slot, and walking guests. Guests enter through the three real entrances, choose zones in proportion to each zone's counted entries for the period, follow the real walkways (avoiding the Back Forty walkway when the period falls mostly inside its Mar 3 – Apr 6 closure), and their number follows the average hourly traffic on a simulated clock. Falls back to the plan view without WebGL; starts paused for reduced-motion users. |
| `dashboard.html` + `views.js` | **Dashboard**: global filters and seven tabs (Answer, Machines, Floor & demand, Downtime, Guests & comps, Model, July plan) |
| `styles.css` | Shared theme (light and dark) for both pages |
| `core.js` | Shared filter state, aggregation (re-sums data for any month range and zone/bank), verdicts, chart helpers |
| `data.js` | Pre-aggregated data (`window.DATA`), built by `analysis/build_dashboard_data.py` |

The pages link to each other. "Open in dashboard" on the floor passes the machine and period (`dashboard.html?machine=M-1158&from=2025-01&to=2025-06#machines`), and the dashboard's "Floor" link passes them back.

## Rebuild the data

From the project root (`TamuDatathon2026/`), with Python 3.11+ and DuckDB (`pip install duckdb`):

```sh
python analysis/forecast.py
python analysis/checks.py
python analysis/plan_options.py
python analysis/build_dashboard_data.py
```

## View it locally

```sh
python -m http.server 8765 --directory dashboard
```

Then open http://localhost:8765. (Opening `index.html` directly also works in most browsers, since data loads from a script tag.)

## Publish on GitHub Pages (public link for Devpost)

1. Create a new public GitHub repository (for example `gilded-ace-dashboard`).
2. Copy the contents of this `dashboard/` folder to the repository root and push.
3. In the repository: **Settings → Pages → Build and deployment → Deploy from a branch**, pick `main` and `/ (root)`, then **Save**.
4. After about a minute the site is live at `https://<your-username>.github.io/gilded-ace-dashboard/`.
5. Test the link in a private browser window, as the participant guide asks.

Chart.js loads from cdnjs and fonts from Google Fonts; everything else ships with the page.

## What judges can do

- **Change the analysis period:** From/To at the top; every tab re-sums.
- **Drill into one machine, bank or guest group:** click any machine on the Floor page; Zone and Bank filters on the dashboard (or click a bank on its map); tier, region and age filters on the Guests tab.
- **Find how the model was validated:** Model tab (holdout chart, error table, placebo test).
- **Trace a recommendation:** July plan tab; each action has a "Show the evidence" button that opens the supporting chart.

Data note: the casino is fictional and its data synthetic. LVCVA, NOAA and Missouri Gaming Commission figures are real public data, shown as context only.
