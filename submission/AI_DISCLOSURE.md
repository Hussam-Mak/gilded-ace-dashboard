# AI-use disclosure

Gilded Ace · TAMU Datathon 2026 · Dashboard Royale

## Who decided what

I made the project's main decisions: which questions to pursue, how to frame the answer (luck, location, downtime or a payout leak), the dashboard's design, which findings to trust, and the final $100,000 plan. I directed the AI throughout and reviewed its output before using it.

Key decisions I made:

- Test *why* the bottom ten machines earn little before accepting the manager's replacement plan.
- Lead with the casino floor page, using a Dribbble shot ("HR Management Dashboard Design" by Bogdan Nikitin for Nixtio) only as a color and layout reference, and build a 3D floor drawn from the dataset's own coordinates instead of a generated image.
- Cut my first plan (two promotion weekends plus maintenance, $40,200) to $16,200 after an external review showed it relied on assumptions the data could not support.
- Leave LVCVA and Missouri figures out of the public dashboard after reading the organizers' source-terms review.

## How I used AI

I used **Claude (Anthropic) through Claude Code** as an assistant for implementation:

- Writing the DuckDB SQL and Python in `analysis/`, and the HTML, CSS and JavaScript for the dashboard and 3D floor.
- Suggesting statistical methods for the questions I set (luck scores from bet variance, a game-adjusted location index, hit-rate checks, the forecast and its baselines).
- Drafting text for the write-up and appendix, which I edited.

I also used two Everything Claude Code skills (`dashboard-builder`, `frontend-design-direction`) as checklists for dashboard structure and design review.

The product itself uses no AI model or API.

## How I checked the work

- Every number in the write-up is recomputed from the raw tables by `analysis/claims_check.py`. Its outputs are saved in the repository.
- Errors I caught and corrected:
  - The bottom-ten zone count was first reported as 7 of 10 in Back Forty; it is 9 of 10.
  - The first tournament estimate used a baseline that included months after the event; I replaced it with a pre-event baseline.
  - The floor view first drew four relocated machines twice; it now shows the floor as of one date.
  - Simulated probabilities were first presented as if observed; they are now labeled as conditional on assumptions.
- I checked the dashboard in a browser at desktop and phone widths.
