# Team grades

Built 2026-10-16. Code: `app/src/analysis/grades.ts`; shown in the Season tab (`app/src/ui/SeasonTabs.tsx`, `GradesCard`).

## What the app shows

A **Team grades** card at the top of the Season tab grades every team in the league S, A, B, C, D or F: overall, and on each part
below, with the number behind each grade under it. A line above the table gives your team's grade, its rank, and its highest and lowest
graded part.

## The parts

- **Week:** this week's best lineup, in expected points. It's the lineup optimizer's max-points lineup, with chance to play from the
  injury report. Points already scored count, and players whose games have started are locked.
- **ROS:** the best lineup's expected points per week over the rest of the season, playoff weeks included. Byes and the chance each
  player is still active that week are built in, as in the rest-of-season values (`ros.ts`).
- **Depth:** points per week the bench adds by covering byes and absences. It's the team's best lineups from the whole roster, less those
  from its core: the starting lineup of its most valuable players over the season.
- **Odds:** playoff odds from the season simulation. Once the playoffs start, title odds from Sleeper's bracket; in a league without
  playoffs, odds of finishing 1st.

A part is left out when it doesn't apply: no weeks left for ROS and depth, or no odds. Leagues with fewer than three teams, or before the
draft, get no grades.

## Grades `[design]`

Each part is a z-score within the league: how many standard deviations a team is from the league average.
- **S:** 1.5 or more, clearly above the rest. A league can have none.
- **A:** 0.75 or more.
- **B:** 0.25 or more.
- **C:** within ±0.25.
- **D:** down to −0.75.
- **F:** below −0.75.

The standard deviation has a floor, so teams that are nearly level stay near C instead of spreading over every grade: 3% of the league
average for Week and ROS, 1 point a week for depth, 5 points for odds.

**Overall:** the parts' z-scores weighted ROS 45%, odds 25%, Week 15%, depth 15% (renormalized when a part is missing). The blend is then
re-scaled to a z-score (floor 0.5), so the same bands apply.
- **Why not add up starters, weekly projections and rankings separately?** They all come from the same projections, so the sum would
  count lineup strength three times. The weights stand in for that judgment.
- **Why these weights:** strength over the rest of the season matters most; the odds bring in the record and the schedule; one week, and
  insurance, count less. The weights are a choice, not a fitted model: there's no outcome to fit a "grade" to.

## On the owner's leagues (2026-10-16, week 6)

Aggregates only.
- **10-team keeper league:** four A, two B, one D, three F; the owner's team A, 1st.
- **12-team redraft league:** one S, one A, one B, five C, one D, three F; the owner's team C, 4th. With this week weighted 20% at
  first, the same team was a B: one strong week lifted a 4-6 team. That's why this week now counts 15%.
- **Dynasty league before its draft:** no grades.
- **Time:** grades take 35–60 ms once the season simulation has run.

## Limits

- **Relative:** grades compare teams within one league. A C in a strong league can be stronger than an A in a weak one.
- **Design, not evidence:** the bands and weights are choices. Nothing here was backtested.
- **Inherited:** the parts inherit the app's projections, injury odds and simulation, with their limits ([ros-uncertainty.md](ros-uncertainty.md),
  [calibration.md](calibration.md)). Odds carry simulation noise of about a point.
- **This season only:** long-term (dynasty) value isn't in the grade; the Long-term outlook card covers it.
