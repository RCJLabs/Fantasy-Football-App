import { Fragment } from 'preact';
import { useMemo } from 'preact/hooks';
import type { LeagueOutlook } from '../analysis/outlook';
import { planWeeks, type PlanWeek } from '../analysis/planner';
import type { Record3, SeasonReview, WeekReview } from '../analysis/review';
import { Spinner } from './components';
import { loadReview, type LeagueBundle } from './data';
import { ordinal, pct, pts, roundName, signed } from './format';
import { useAsync } from './hooks';

/** "a", "a and b", "a, b and c". */
function and(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

const hasHole = (w: PlanWeek) => w.byes.length > 0 || w.unprojected.length > 0 || w.open > 0;

/** Week by week to the end of the season: the matchup, who's missing, who's back, and a pickup for weeks with a hole. */
export function WeeksAheadCard({ bundle, o }: { bundle: LeagueBundle; o: LeagueOutlook }) {
  const myId = bundle.myRoster!.rosterId;
  const plan = useMemo(() => planWeeks(o, myId), [o, myId]);
  if (!plan.length) return null;
  const player = (id: string) => bundle.ctx.players.get(id) ?? o.model.player(id);
  const name = (id: string) => player(id)?.name ?? id;
  const team = (id: number | null) => (id === null ? '–' : (o.teams.get(id)?.name ?? '?'));
  const holes = plan.filter(hasHole).map((w) => w.week);
  const playoffs = plan.filter((w) => w.playoff);
  const ranks = playoffs.map((w) => ordinal(w.rank));
  const sameRank = ranks.length > 1 && ranks.every((r) => r === ranks[0]);
  const notes = (w: PlanWeek): string[] => [
    ...(w.byes.length ? [`Bye: ${w.byes.map(name).join(', ')}`] : []),
    ...(w.unprojected.length ? [`Not projected: ${w.unprojected.map((id) => (player(id)?.injury ? `${name(id)} (${player(id)!.injury})` : name(id))).join(', ')}`] : []),
    ...(w.open ? [`${w.open} starting slot${w.open > 1 ? 's' : ''} nobody can fill`] : []),
    ...(w.back.length ? [`Back: ${w.back.map(name).join(', ')}`] : []),
    ...(w.pickup ? [`Best pickup: ${name(w.pickup.id)} (${player(w.pickup.id)?.pos ?? '?'}) ${signed(w.pickup.gain)}`] : []),
    ...(w.playoff ? [`Your lineup ranks ${ordinal(w.rank)} of ${w.teams}`] : []),
  ];
  return (
    <div class="card">
      <h2>Weeks ahead</h2>
      <p class="small">
        {holes.length ? `Holes in your lineup: week${holes.length > 1 ? 's' : ''} ${and(holes.map(String))}.` : 'No byes or injuries among your regular starters in the weeks ahead.'}
        {playoffs.length
          ? ` In the playoff week${playoffs.length > 1 ? 's' : ''} your best lineup ranks ${sameRank ? ranks[0] : and(ranks)} of ${playoffs[0]!.teams}${sameRank ? ' in each' : ''}.`
          : ''}
      </p>
      <table class="table plan">
        <thead>
          <tr>
            <th>Week</th>
            <th>Opponent</th>
            <th class="num">Proj</th>
            <th class="num">Win</th>
          </tr>
        </thead>
        <tbody>
          {plan.map((w) => {
            const lines = notes(w);
            const p = w.playoff;
            return (
              <Fragment key={w.week}>
                <tr class={hasHole(w) ? 'hole' : ''}>
                  <td>{w.week}</td>
                  <td>{p ? `Playoffs, ${roundName(p.round, p.rounds)}${p.roundWeeks === 2 ? ` (${p.weekInRound} of 2)` : ''}` : team(w.opponent)}</td>
                  <td class="num">{pts(w.mean)}</td>
                  <td class="num">{w.winProb === null ? '–' : pct(w.winProb)}</td>
                </tr>
                {lines.length ? (
                  <tr class="plan-note">
                    <td colSpan={4}>{lines.join(' · ')}</td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p class="muted small">
        Proj: your best lineup&apos;s expected points, chances to play included. Holes are byes and missing projections among your regular
        starters (players who start in at least half the weeks they play). Not projected: Sleeper has no projection for him that week (injury,
        suspension or release); Back: the first week Sleeper projects an injured player again. Best pickup: the free agent who adds most to that
        week&apos;s lineup, before any drop he needs (Waivers weighs the drop over the whole season).
      </p>
    </div>
  );
}

const rec = (r: Record3) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;

function score(w: WeekReview): string {
  return w.result === null || w.oppPoints === null ? pts(w.points) : `${w.result} ${pts(w.points)}–${pts(w.oppPoints)}`;
}

/** The weeks played: results, the lineup you could have started, luck of the schedule, and your players against their projections. */
export function SeasonSoFarCard({ bundle }: { bundle: LeagueBundle }) {
  const r = useAsync(() => loadReview(bundle), [bundle]);
  if (r.error)
    return (
      <div class="card">
        <h2>Season so far</h2>
        <p class="muted small">{r.error.message}</p>
      </div>
    );
  if (!r.data)
    return r.loading ? (
      <div class="card">
        <h2>Season so far</h2>
        <Spinner label="Loading past weeks…" />
      </div>
    ) : null;
  return <Review bundle={bundle} rev={r.data} />;
}

function Review({ bundle, rev }: { bundle: LeagueBundle; rev: SeasonReview }) {
  const bestBall = bundle.league.rules.bestBall;
  const games = rev.allPlay.w + rev.allPlay.l + rev.allPlay.t;
  const share = games ? (rev.allPlay.w + rev.allPlay.t / 2) / games : 0;
  const luck =
    rev.luck >= 0.5
      ? `the schedule has given you about ${rev.luck.toFixed(1)} more`
      : rev.luck <= -0.5
        ? `the schedule has cost you about ${(-rev.luck).toFixed(1)}`
        : 'your record is about what your scores earned';
  const against =
    rev.pointsAgainstRank === 1 ? 'the most in the league' : rev.pointsAgainstRank === rev.teams ? 'the fewest in the league' : `the ${ordinal(rev.pointsAgainstRank)} most of ${rev.teams} teams`;
  const withApp = rev.weeks.filter((w) => w.app !== undefined);
  const appTotal = withApp.reduce((s, w) => s + w.app!, 0);
  const yoursThen = withApp.reduce((s, w) => s + w.points, 0);
  const name = (id: string) => bundle.ctx.players.get(id)?.name ?? id;
  return (
    <div class="card">
      <h2>Season so far</h2>
      <p class="small">
        Record {rec(rev.record)}
        {rev.median ? ` (${rec(rev.median)} against the league median)` : ''}. Your weekly scores beat {pct(share)} of the others&apos; (all-play{' '}
        {rec(rev.allPlay)}), worth {rev.expectedWins.toFixed(1)} wins on an average schedule: {luck}. Points against: {pts(rev.pointsAgainst)}, {against}.
      </p>
      {!bestBall ? (
        <p class="small">
          Your lineups scored {pts(rev.points)} of a possible {pts(rev.best)} ({pct(rev.efficiency)}), leaving {pts(rev.best - rev.points)} on the bench. The
          league averages {pct(rev.leagueEfficiency)}; you rank {ordinal(rev.efficiencyRank)} of {rev.efficiencyTeams}.
        </p>
      ) : null}
      {withApp.length ? (
        <p class="small">
          The app saved its lineup pick on this device in {withApp.length} of these weeks: its lineups scored {pts(appTotal)}, yours {pts(yoursThen)} (
          {signed(yoursThen - appTotal)}).
        </p>
      ) : null}
      <table class="table review">
        <thead>
          <tr>
            <th>Week</th>
            <th>Result</th>
            {!bestBall ? <th class="num">Best</th> : null}
            <th class="num">Rank</th>
            {withApp.length ? <th class="num">App</th> : null}
          </tr>
        </thead>
        <tbody>
          {rev.weeks.map((w) => (
            <tr>
              <td>{w.week}</td>
              <td class={w.result === 'W' ? 'good' : w.result === 'L' ? 'bad' : ''}>{score(w)}</td>
              {!bestBall ? <td class="num">{pts(w.best)}</td> : null}
              <td class="num">
                {ordinal(w.rank)}
                <span class="muted"> /{w.teams}</span>
              </td>
              {withApp.length ? <td class="num">{w.app === undefined ? '–' : pts(w.app)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted small">
        Final scores of the weeks played. {!bestBall ? 'Best: the most any lineup from that week’s roster could have scored, knowing the results. ' : ''}
        Rank: your score&apos;s place in the league that week; all-play counts it against every team.
        {withApp.length ? ' App: the lineup the app recommended, as last saved before the main Sunday kickoff.' : ''}
      </p>
      {rev.players.length ? (
        <>
          <h3>Your players vs projections</h3>
          <table class="table review-players">
            <thead>
              <tr>
                <th>Player</th>
                <th class="num">G</th>
                <th class="num">Proj</th>
                <th class="num">Pts</th>
                <th class="num">±</th>
              </tr>
            </thead>
            <tbody>
              {rev.players.map((p) => {
                const gap = p.actual - p.projected;
                const clear = Math.abs(p.z) >= 2;
                return (
                  <tr>
                    <td>{name(p.id)}</td>
                    <td class="num">{p.games}</td>
                    <td class="num">{pts(p.projected)}</td>
                    <td class="num">{pts(p.actual)}</td>
                    <td class={`num${clear ? (gap > 0 ? ' good' : ' bad') : ''}`}>{signed(gap)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="muted small">
            Per game, in weeks Sleeper projected him to play and he was on a roster in this league (a late scratch counts as 0). Highlighted: further
            from the projection than weekly swings explain (2 SD). Projections already move with results, so this looks back; it isn&apos;t a forecast.
          </p>
        </>
      ) : null}
    </div>
  );
}
