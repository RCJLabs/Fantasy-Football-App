import type { LineupAnalysis, LineupChange } from '../analysis/analyze';
import { ErrorBox, PlayerLine, Problems, slotLabel, Spinner } from './components';
import { findLeague, loadLeagueBundle, loadWaivers, type LeagueBundle } from './data';
import { ago, kickoffLabel, pct, pts, signed } from './format';
import { useAsync, useTick } from './hooks';
import type { Session } from './session';

const TABS = [
  ['lineup', 'Lineup'],
  ['matchup', 'Matchup'],
  ['waivers', 'Waivers'],
] as const;

export function LeaguePage({ session, leagueId, tab }: { session: Session; leagueId: string; tab: string }) {
  const now = useTick(60_000);
  const bundle = useAsync(
    async (force) => {
      const { overview, league } = await findLeague(session, leagueId, force);
      return loadLeagueBundle(league, overview.week, session, force);
    },
    [leagueId],
  );

  if (bundle.error) return <ErrorBox error={bundle.error} onRetry={() => bundle.reload(true)} />;
  if (!bundle.data) return <Spinner label="Loading league…" />;
  const b = bundle.data;

  return (
    <section>
      <div class="page-head">
        <div>
          <a href="#/" class="muted small">
            ← Leagues
          </a>
          <h1>{b.league.name}</h1>
          <p class="muted small">
            Week {b.week} · updated {ago(b.data.savedAt, now)}
            {b.data.stale ? ' · offline copy' : ''}
          </p>
        </div>
        <button type="button" class="btn" onClick={() => bundle.reload(true)} disabled={bundle.loading}>
          {bundle.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      {b.ctx.notes.map((n) => (
        <p class="note">{n}</p>
      ))}
      <nav class="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <a role="tab" aria-selected={tab === id} class={tab === id ? 'tab active' : 'tab'} href={`#/league/${leagueId}/${id}`}>
            {label}
          </a>
        ))}
      </nav>
      {!b.myRoster ? (
        <p class="card">You don't have a team in this league.</p>
      ) : !b.lineup ? (
        <p class="card">This league isn't in season ({b.league.status.replace('_', ' ')}).</p>
      ) : tab === 'matchup' ? (
        <MatchupTab a={b.lineup} now={now} />
      ) : tab === 'waivers' ? (
        <WaiversTab bundle={b} now={now} />
      ) : (
        <LineupTab a={b.lineup} bestBall={b.league.rules.bestBall} now={now} />
      )}
    </section>
  );
}

function ChangeLine({ c }: { c: LineupChange }) {
  const slot = <span class="slot">{slotLabel(c.slot)}</span>;
  if (c.kind === 'swap')
    return (
      <li>
        {slot} Start <strong>{c.in!.name}</strong> over <strong>{c.out!.name}</strong>
      </li>
    );
  if (c.kind === 'start')
    return (
      <li>
        {slot} Start <strong>{c.in!.name}</strong>
      </li>
    );
  if (c.kind === 'bench')
    return (
      <li>
        <span class="slot">BN</span> Bench <strong>{c.out!.name}</strong>
      </li>
    );
  return (
    <li>
      {slot} Move <strong>{c.in!.name}</strong> to {slotLabel(c.slot)}
    </li>
  );
}

function LineupTab({ a, bestBall, now }: { a: LineupAnalysis; bestBall: boolean; now: number }) {
  const inIds = new Set(a.changes.filter((c) => c.kind === 'swap' || c.kind === 'start').map((c) => c.in?.id));
  return (
    <div class="stack">
      <div class="card">
        <div class="stats-row">
          <div>
            <span class="muted small">Your lineup</span>
            <strong>{pts(a.expectedCurrent)}</strong>
          </div>
          <div>
            <span class="muted small">Best lineup</span>
            <strong>{pts(a.expectedRecommended)}</strong>
            {a.gain >= 0.05 ? <span class="gain">{signed(a.gain)}</span> : null}
          </div>
          {a.winProbRecommended !== undefined ? (
            <div>
              <span class="muted small">Win chance</span>
              <strong>{pct(a.winProbRecommended)}</strong>
              {a.winProbCurrent !== undefined && a.winProbRecommended - a.winProbCurrent >= 0.005 ? (
                <span class="gain">from {pct(a.winProbCurrent)}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        {bestBall ? <p class="muted small">Best ball league: Sleeper picks your highest scorers automatically, so these are informational.</p> : null}
        <Problems problems={a.problems} />
      </div>

      {a.changes.length ? (
        <div class="card">
          <h2>Make these changes</h2>
          <ul class="changes">
            {a.changes.map((c) => (
              <ChangeLine c={c} />
            ))}
          </ul>
          <p class="muted small">
            Expected points include the option to swap a Questionable starter for a later-kickoff backup if he's ruled out. Re-check about 90 minutes before
            kickoff, when inactives are announced.
          </p>
        </div>
      ) : null}

      <div class="card">
        <h2>Recommended lineup</h2>
        <div class="list">
          {a.recommended.map((row, s) => (
            <PlayerLine row={row} slot={a.slots[s]!} now={now} highlight={row && inIds.has(row.id) ? 'in' : undefined} />
          ))}
        </div>
      </div>

      <div class="card">
        <h2>Bench</h2>
        <div class="list">
          {a.bench.map((row) => (
            <PlayerLine row={row} now={now} highlight={a.changes.some((c) => c.out?.id === row.id) ? 'out' : undefined} />
          ))}
        </div>
        {a.reserve.length ? (
          <>
            <h3>IR / Taxi</h3>
            <div class="list">
              {a.reserve.map((row) => (
                <PlayerLine row={row} now={now} />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function MatchupTab({ a, now }: { a: LineupAnalysis; now: number }) {
  const sd = (v: number) => Math.sqrt(Math.max(0, v));
  return (
    <div class="stack">
      <div class="card">
        <div class="versus">
          <div>
            <span class="muted small">{a.me.name}</span>
            <strong>{pts(a.me.dist.mean)}</strong>
            <span class="muted small">±{pts(sd(a.me.dist.variance))}</span>
          </div>
          <div class="vs">vs</div>
          <div>
            <span class="muted small">{a.opponent?.name ?? 'No opponent'}</span>
            <strong>{a.opponent ? pts(a.opponent.dist.mean) : '–'}</strong>
            {a.opponent ? <span class="muted small">±{pts(sd(a.opponent.dist.variance))}</span> : null}
          </div>
        </div>
        <p>
          Win chance with the recommended lineup: <strong>{pct(a.winProbRecommended)}</strong>
          {a.medianProb !== undefined ? (
            <>
              {' '}
              · beat the league median: <strong>{pct(a.medianProb)}</strong>
            </>
          ) : null}
        </p>
        <p class="muted small">Totals include points already scored; games in progress are prorated. Spreads assume players score independently.</p>
      </div>
      {a.opponent ? (
        <div class="card">
          <h2>{a.opponent.name}</h2>
          <div class="list">
            {a.opponent.rows.map((row) => (
              <PlayerLine row={row} now={now} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WaiversTab({ bundle, now }: { bundle: LeagueBundle; now: number }) {
  const w = useAsync(() => loadWaivers(bundle), [bundle]);
  if (w.error) return <ErrorBox error={w.error} />;
  if (!w.data) return <Spinner label="Scanning free agents…" />;
  return (
    <div class="card">
      <h2>Free agents for week {bundle.week}</h2>
      <p class="muted small">Ranked by how much each player would add to this week's best lineup. Trending = Sleeper adds in the last 24 h.</p>
      <table class="table">
        <thead>
          <tr>
            <th>Player</th>
            <th class="num">Proj</th>
            <th class="num">Gain</th>
            <th class="num">Adds</th>
          </tr>
        </thead>
        <tbody>
          {w.data.map((r) => (
            <tr>
              <td>
                <strong>{r.player.name}</strong>{' '}
                <span class="muted small">
                  {r.player.pos}
                  {r.player.team ? `·${r.player.team}` : ''} {r.player.injury ? `(${r.player.injury})` : ''}
                </span>
                <div class="muted small">
                  {r.player.opponent ? `${r.player.home ? 'vs' : '@'} ${r.player.opponent}` : ''} {kickoffLabel(r.player.kickoff, now)}
                </div>
              </td>
              <td class="num">{pts(r.player.ev)}</td>
              <td class="num">{r.gainThisWeek >= 0.05 ? signed(r.gainThisWeek) : '–'}</td>
              <td class="num">{r.trendingAdds ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p class="muted small">Rest-of-season value and FAAB bid suggestions are next on the roadmap.</p>
    </div>
  );
}
