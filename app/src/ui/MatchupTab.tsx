import { useEffect, useMemo, useState } from 'preact/hooks';
import type { LineupAnalysis, Objective, PlayerRow } from '../analysis/analyze';
import { gameState, liveMatchup, type LiveSide } from '../analysis/liveMatchup';
import { projectionPositions } from '../analysis/ros';
import { type LeagueData, loadLeagueData, loadWeekStats, type WeekStats } from '../data/repo';
import { Badge, InjuryBadge, slotLabel } from './components';
import { type LeagueBundle, lineupFor } from './data';
import { ago, kickoffLabel, pct, pts } from './format';
import { statLine } from './statLine';

/** How often the Matchup tab checks Sleeper's scores while a starter's game is on and the page is open. [design] */
const LIVE_POLL = 60_000;

/** "J. Jefferson" (a defense by its team) so two lineups fit side by side on a phone. */
function shortName(row: PlayerRow): string {
  if (row.pos === 'DEF') return row.team ? `${row.team} DEF` : row.name;
  const [first, ...rest] = row.name.split(' ');
  return rest.length && first ? `${first[0]}. ${rest.join(' ')}` : row.name;
}

/**
 * Both lineups slot by slot: Sleeper's points so far with each starter's projection, stat lines once games start, and
 * each side's expected final. While a starter's game is on it checks Sleeper every minute (stat lines refresh about
 * every 5).
 */
export function MatchupTab({ b, base, objective, now }: { b: LeagueBundle; base: LineupAnalysis; objective: Objective | undefined; now: number }) {
  const [live, setLive] = useState<{ data: LeagueData; at: number } | null>(null);
  const [stats, setStats] = useState<WeekStats | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const a = useMemo(() => {
    if (!live) return base;
    const myRoster = live.data.rosters.find((r) => r.rosterId === b.myRoster!.rosterId) ?? b.myRoster!;
    return lineupFor({ ...b, data: live.data, myRoster, ctx: { ...b.ctx, now: live.at } }, objective ?? base.objective) ?? base;
  }, [b, base, live, objective]);
  const view = useMemo(() => liveMatchup(a, now), [a, now]);
  const positions = useMemo(() => projectionPositions(b.league), [b.league]);
  const started = [...view.me.slots, ...(view.opponent?.slots ?? [])].some((r) => r && r.kickoff !== null && r.kickoff <= now);

  /** Scores and lineups fresh from Sleeper; stat lines from the copy kept 4 minutes unless `forceStats`. */
  const refresh = async (forceStats: boolean) => {
    setBusy(true);
    try {
      const [data, st] = await Promise.all([loadLeagueData(b.league.id, b.week, true), loadWeekStats(b.league.season, b.week, positions, forceStats).catch(() => null)]);
      setLive({ data, at: Date.now() });
      if (st) setStats(st);
      setError(data.stale ? "Sleeper didn't answer: showing the last scores saved." : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  // A reload of the whole page brings newer data than the last live check.
  useEffect(() => setLive(null), [b]);
  // Stat lines once any starter's game has kicked off (the week's final ones afterwards).
  useEffect(() => {
    if (started && !stats) void loadWeekStats(b.league.season, b.week, positions).then(setStats, () => undefined);
  }, [started]);
  // Live scores while a starter's game is on and the page is open.
  useEffect(() => {
    if (!view.playing) return;
    void refresh(false);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(false);
    }, LIVE_POLL);
    return () => clearInterval(id);
  }, [view.playing]);

  const me = view.me;
  const opp = view.opponent;
  const line = (r: PlayerRow) => statLine(r.pos, stats?.stats.get(r.id));
  const changes = a.changes.length > 0 && a.winProbRecommended !== undefined && a.winProbCurrent !== undefined && a.winProbRecommended - a.winProbCurrent >= 0.005;
  return (
    <div class="stack">
      <div class="card">
        <div class="versus">
          <Score side={me} />
          <div class="vs">vs</div>
          {opp ? (
            <Score side={opp} right />
          ) : (
            <div>
              <span class="muted small">No opponent</span>
              <strong>–</strong>
            </div>
          )}
        </div>
        {a.winProbCurrent !== undefined || a.medianProbCurrent !== undefined ? (
          <p>
            {a.winProbCurrent !== undefined ? (
              <>
                Win chance with your lineup as set: <strong>{pct(a.winProbCurrent)}</strong>
                {changes ? (
                  <>
                    {' '}
                    (<strong>{pct(a.winProbRecommended)}</strong> with the Lineup tab&apos;s changes)
                  </>
                ) : null}
              </>
            ) : null}
            {a.medianProbCurrent !== undefined ? (
              <>
                {a.winProbCurrent !== undefined ? ' · ' : ''}beat the league median: <strong>{pct(a.medianProbCurrent)}</strong>
              </>
            ) : null}
          </p>
        ) : null}
        <p class="muted small">
          {view.playing ? 'Live: checks Sleeper every minute while games are on. ' : ''}Updated {ago(live?.at ?? b.data.savedAt, now)}.{' '}
          <button type="button" class="link" disabled={busy} onClick={() => void refresh(true)}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </p>
        {error ? <p class="problem problem-error">{error}</p> : null}
      </div>

      <div class="card">
        <h2>Lineups</h2>
        <div class="mu">
          <div class="mu-row mu-head">
            <span>{me.name}</span>
            <span />
            <span>{opp?.name ?? ''}</span>
          </div>
          {view.slots.map((slot, s) => (
            <div class="mu-row">
              <Cell row={me.slots[s] ?? null} now={now} line={line} />
              <span class="slot">{slotLabel(slot)}</span>
              {opp ? <Cell row={opp.slots[s] ?? null} now={now} line={line} right assumed={opp.assumed} /> : <span />}
            </div>
          ))}
        </div>
        <p class="muted small">
          Points so far are Sleeper&apos;s. Before a game, a starter shows his projection (times his chance to play); once it starts, his points and
          his projection. Projected final: points so far plus what&apos;s left of each starter&apos;s projection, by time played. Stat lines come from
          Sleeper and lag its scores by up to 5 minutes. Win chance treats players in the same NFL game as linked (a QB and his receivers rise
          and fall together).
          {opp?.assumed.size ? ` ${opp.name} is assumed to replace starters who can't play (marked “assumed”).` : ''}
        </p>
      </div>
    </div>
  );
}

function Score({ side, right }: { side: LiveSide; right?: boolean }) {
  const g = side.games;
  const where = [g.live ? `${g.live} playing` : '', g.upcoming ? `${g.upcoming} to play` : ''].filter(Boolean).join(' · ') || 'all played';
  return (
    <div class={right ? 'score-right' : undefined}>
      <span class="muted small">{side.name}</span>
      <strong>{pts(side.points)}</strong>
      <span class="small">proj {pts(side.projected)}</span>
      <span class="muted small">{where}</span>
    </div>
  );
}

function Cell({ row, now, line, right, assumed }: { row: PlayerRow | null; now: number; line: (r: PlayerRow) => string | undefined; right?: boolean; assumed?: ReadonlySet<string> }) {
  const cls = `mu-cell${right ? ' mu-right' : ''}`;
  if (!row) return <div class={`${cls} muted`}>Empty</div>;
  const state = gameState(row, now);
  const stat = state === 'upcoming' || state === 'bye' ? undefined : line(row);
  const game = row.kickoff === null ? 'BYE' : `${row.home ? 'vs' : '@'} ${row.opponent ?? '?'} · ${kickoffLabel(row.kickoff, now)}`;
  return (
    <div class={`${cls} mu-${state}`}>
      <div class="mu-name">
        <strong title={row.name}>{shortName(row)}</strong>
      </div>
      <div class="mu-pts">
        {state === 'live' || state === 'final' ? (
          <>
            <strong>{pts(row.actual ?? 0)}</strong> <span class="muted">/ {pts(row.mu)}</span>
          </>
        ) : (
          <>
            <span>{pts(row.ev)}</span> <span class="muted">proj</span>
          </>
        )}
      </div>
      <div class="mu-meta muted">
        {row.pos}
        {row.team ? `·${row.team}` : ''} {game} <InjuryBadge row={row} />
        {assumed?.has(row.id) ? <Badge kind="info">assumed</Badge> : null}
      </div>
      {stat ? <div class="mu-line">{stat}</div> : null}
    </div>
  );
}
