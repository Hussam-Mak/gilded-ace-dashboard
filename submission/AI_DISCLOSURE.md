# AI-use disclosure

Gilded Ace · TAMU Datathon 2026 · Dashboard Royale

## Tools

- **Claude (Anthropic), used through Claude Code** in the Claude desktop app, as a pair analyst and engineer throughout the project.
- **Everything Claude Code skills** (`dashboard-builder`, `frontend-design-direction`) as checklists for dashboard structure and rendered design review.
- A public Dribbble shot ("HR Management Dashboard Design" by Bogdan Nikitin for Nixtio) was used only as a **color and layout reference**; no images or assets were copied. An AI-generated casino floor image we considered was **not** used; the 3D floor is drawn from the dataset's own coordinates.

## What the AI did

- Explored the dataset and documentation, and proposed analyses (luck scores from bet variance, a game-adjusted location index, the walkway-closure comparison, the hit-rate check, the downtime queue analysis).
- Wrote the SQL (DuckDB) and Python in `analysis/`, and the HTML, CSS and JavaScript for the dashboard and 3D floor.
- Built the forecast, placebo test, pre-event baseline and plan simulation, and ran the checks.
- Drafted the write-up, this appendix and the plan text.

## What we decided

- The questions to pursue, the dashboard design (floor page first, Dribbble palette, 3D floor with data-driven guests), and the final plan.
- We first chose a larger plan (two promotion weekends plus maintenance, $40,200). After an external review, we adopted a smaller plan ($16,200: one inspection and one conditional promotion), because the larger plan relied on assumptions the data could not support.
- We chose not to republish LVCVA and Missouri figures after reading the organizers' source-terms review.

## How we checked the AI's work

- Every number in the write-up is recomputed from the raw tables by `analysis/claims_check.py`; outputs are saved in the repository.
- Errors caught and corrected during the project:
  - The bottom-ten zone count was first reported as 7 of 10 in Back Forty; it is 9 of 10. An early query split machines that moved between zones.
  - The first tournament estimate ($803K) used a baseline that included months after the event; it was replaced with a pre-event baseline ($566K–$884K).
  - A claim about M-1158's carded share was stated without being checked; it was corrected to 66%.
  - The floor view first drew four relocated machines twice; it now shows the floor as of one date.
  - Simulated probabilities were first presented as if observed; they are now labeled as conditional on assumptions.
- Visual checks of the dashboard were done in a browser at desktop and phone widths; 3D performance could not be measured reliably in the development browser.
