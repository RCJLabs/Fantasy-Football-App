import type { League } from '../domain/types';
import { Badge, ErrorBox, Problems, Spinner } from './components';
import { loadLeagueBundle, loadOverview } from './data';
import { ago, pct, pts, signed } from './format';
import { useAsync } from './hooks';
import type { Session } from './session';

export function Home({ session }: { session: Session }) {
  const overview = useAsync((force) => loadOverview(session, force), [session.userId]);

  return (
    <section>
      <div class="page-head">
        <div>
          <h1>Leagues</h1>
          <p class="muted">
            {session.displayName}
            {overview.data ? ` · ${overview.data.season} · Week ${overview.data.week}` : ''}
          </p>
        </div>
        <button type="button" class="btn" onClick={() => overview.reload(true)} disabled={overview.loading}>
          Refresh
        </button>
      </div>
      {overview.error ? <ErrorBox error={overview.error} onRetry={() => overview.reload(true)} /> : null}
      {overview.loading && !overview.data ? <Spinner label="Finding your leagues…" /> : null}
      {overview.data && overview.data.leagues.length === 0 ? (
        <div class="card">
          <p>No {overview.data.season} leagues found for this account.</p>
        </div>
      ) : null}
      {overview.data?.seasonType && overview.data.seasonType !== 'regular' ? (
        <p class="note">
          Sleeper reports the season as “{overview.data.seasonType}”. Lineup help covers the regular season and playoffs.
        </p>
      ) : null}
      <div class="cards">
        {overview.data?.leagues.map((l) => (
          <LeagueCard key={l.id} league={l} week={overview.data!.week} session={session} />
        ))}
      </div>
    </section>
  );
}

function LeagueCard({ league, week, session }: { league: League; week: number; session: Session }) {
  const active = league.status === 'in_season' || league.status === 'post_season';
  const bundle = useAsync((force) => (active ? loadLeagueBundle(league, week, session, force) : Promise.resolve(null)), [league.id, week]);
  const a = bundle.data?.lineup;
  const roster = bundle.data?.myRoster;

  return (
    <article class="card league-card">
      <a class="card-link" href={`#/league/${league.id}`}>
        <div class="league-title">
          <h2>{league.name}</h2>
          <span class="muted small">
            {league.rules.numTeams} teams · {league.rules.type}
            {league.rules.bestBall ? ' · best ball' : ''}
            {roster ? ` · ${roster.wins}-${roster.losses}${roster.ties ? `-${roster.ties}` : ''}` : ''}
          </span>
        </div>
        {!active ? <Badge kind="muted">{league.status.replace('_', ' ')}</Badge> : null}
      </a>
      {active && bundle.loading && !bundle.data ? <Spinner label="Checking lineup…" /> : null}
      {bundle.error ? <ErrorBox error={bundle.error} onRetry={() => bundle.reload(true)} /> : null}
      {active && bundle.data && !roster ? <p class="muted">You don't have a team in this league.</p> : null}
      {a ? (
        <>
          <div class="stats-row">
            <div>
              <span class="muted small">Expected</span>
              <strong>{pts(a.expectedRecommended)}</strong>
              {a.gain >= 0.05 ? <span class="gain">{signed(a.gain)}</span> : null}
            </div>
            {a.opponent ? (
              <div>
                <span class="muted small">vs {a.opponent.name}</span>
                <strong>{pct(a.winProbRecommended)}</strong>
              </div>
            ) : null}
            {a.medianProb !== undefined ? (
              <div>
                <span class="muted small">Median</span>
                <strong>{pct(a.medianProb)}</strong>
              </div>
            ) : null}
          </div>
          {league.rules.bestBall ? <p class="muted small">Best ball: Sleeper sets your lineup automatically.</p> : <Problems problems={a.problems} limit={3} />}
          <p class="muted small">Updated {ago(bundle.data!.data.savedAt)}</p>
        </>
      ) : null}
    </article>
  );
}
