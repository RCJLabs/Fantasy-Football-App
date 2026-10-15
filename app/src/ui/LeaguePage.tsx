import { useMemo, useState } from 'preact/hooks';
import type { LineupAnalysis, LineupChange, Objective } from '../analysis/analyze';
import { ErrorBox, PlayerLine, Problems, slotLabel, Spinner } from './components';
import { findLeague, lineupFor, loadLeagueBundle, type LeagueBundle } from './data';
import { ago, pct, pts, signed } from './format';
import { useAsync, useTick } from './hooks';
import { setObjectivePref } from './prefs';
import { SeasonTab, TradeTab, WaiversTab } from './SeasonTabs';
import type { Session } from './session';

const TABS = [
  ['lineup', 'Lineup'],
  ['matchup', 'Matchup'],
  ['waivers', 'Waivers'],
  ['trade', 'Trade'],
  ['season', 'Season'],
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
        <LineupArea b={b} tab="matchup" now={now} />
      ) : tab === 'waivers' ? (
        <WaiversTab bundle={b} now={now} />
      ) : tab === 'trade' ? (
        <TradeTab bundle={b} />
      ) : tab === 'season' ? (
        <SeasonTab bundle={b} />
      ) : (
        <LineupArea b={b} tab="lineup" now={now} />
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

/** Lineup and Matchup tabs share one analysis, re-run when you switch between max points and win chance. */
function LineupArea({ b, tab, now }: { b: LeagueBundle; tab: 'lineup' | 'matchup'; now: number }) {
  const [choice, setChoice] = useState<Objective | undefined>(undefined);
  const a = useMemo(() => (choice ? lineupFor(b, choice) : b.lineup) ?? b.lineup!, [b, choice]);
  const choose = (o: Objective) => {
    setObjectivePref(b.league.id, b.phase, o);
    setChoice(o);
  };
  return tab === 'matchup' ? <MatchupTab a={a} now={now} /> : <LineupTab a={a} bestBall={b.league.rules.bestBall} now={now} onObjective={choose} />;
}

function ObjectiveToggle({ a, onObjective }: { a: LineupAnalysis; onObjective: (o: Objective) => void }) {
  if (a.winProbRecommended === undefined && a.medianProb === undefined) return null;
  return (
    <div class="seg" role="group" aria-label="Optimize lineup for">
      <button type="button" aria-pressed={a.objective === 'points'} onClick={() => onObjective('points')}>
        Max points
      </button>
      <button type="button" aria-pressed={a.objective === 'win'} onClick={() => onObjective('win')}>
        Win chance
      </button>
    </div>
  );
}

function ObjectiveNote({ a }: { a: LineupAnalysis }) {
  const p = a.playoff;
  const round = p ? `Playoffs, round ${p.round} of ${p.rounds}${p.roundWeeks === 2 ? ` (week ${p.weekInRound} of 2: the two-week total decides it)` : ''}. ` : '';
  if (a.objective === 'points') {
    if (a.winProbRecommended === undefined && a.medianProb === undefined) return round ? <p class="muted small">{round}</p> : null;
    return (
      <p class="muted small">
        {round}
        {p ? 'Showing the max-points lineup; Win chance tunes it for this matchup.' : 'Lineup maximizes expected points. Win chance also weighs how much your score can swing against this opponent.'}
      </p>
    );
  }
  const mp = a.maxPoints;
  if (!mp || mp.same) return <p class="muted small">{round}The max-points lineup is also your best shot to win{p ? ' this round' : ''}.</p>;
  const median = a.medianProb !== undefined;
  const favored = (mp.winProb ?? 0.5) >= 0.5;
  const tuned = median ? `${((a.winProbRecommended ?? 0) + (a.medianProb ?? 0)).toFixed(2)} expected wins` : `${pct(a.winProbRecommended)} to win`;
  const plain = median ? ((mp.winProb ?? 0) + (mp.medianProb ?? 0)).toFixed(2) : pct(mp.winProb);
  return (
    <p class="small">
      {round}Tuned for win chance: {tuned} vs {plain} with the max-points lineup, for {pts(mp.expected - a.expectedRecommended)} fewer expected points. As
      the {favored ? 'favorite' : 'underdog'}, it {favored ? 'narrows' : 'widens'} the range of outcomes{mp.reasons.length ? `: ${mp.reasons.join('; ')}` : ''}.
    </p>
  );
}

function LineupTab({ a, bestBall, now, onObjective }: { a: LineupAnalysis; bestBall: boolean; now: number; onObjective: (o: Objective) => void }) {
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
        {bestBall ? (
          <p class="muted small">Best ball league: Sleeper picks your highest scorers automatically, so these are informational.</p>
        ) : (
          <>
            <ObjectiveToggle a={a} onObjective={onObjective} />
            <ObjectiveNote a={a} />
          </>
        )}
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
        <p class="muted small">
          Totals include points already scored; games in progress are prorated. Players in the same NFL game are treated as correlated (a QB and his
          receivers rise and fall together; a QB and the defense he faces move in opposite directions).
        </p>
        {a.opponent?.assumed?.length ? (
          <p class="muted small">Assumes {a.opponent.name} replaces starters who can't play (marked “assumed”).</p>
        ) : null}
      </div>
      {a.opponent ? (
        <div class="card">
          <h2>{a.opponent.name}</h2>
          <div class="list">
            {a.opponent.rows.map((row) => (
              <PlayerLine row={row} now={now} note={row && a.opponent!.assumed?.includes(row.id) ? 'assumed' : undefined} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

