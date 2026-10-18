import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LineupAnalysis, Objective, PlayerRow, WeekContext } from '../analysis/analyze';
import { currentDists, leagueMatchups, weekStartDists, type TeamNow } from '../analysis/aroundLeague';
import { emptyFeed, feedPlayers, feedSnapshot, stepFeed, type FeedEvent, type FeedGroup, type LiveFeed } from '../analysis/liveFeed';
import { gameState, liveMatchup, type LiveSide } from '../analysis/liveMatchup';
import { oddsWithWeek } from '../analysis/outlook';
import { projectionPositions } from '../analysis/ros';
import { swingPlayers, type SwingPlayer } from '../analysis/swing';
import { loadStored, saveStored } from '../data/cache';
import { type LeagueData, loadLeagueData, loadWeekStats, type WeekStats } from '../data/repo';
import { loadScoreboard } from '../data/scoreboard';
import type { GameClock } from '../domain/types';
import { Badge, InjuryBadge, slotLabel } from './components';
import { type LeagueBundle, lineupFor, loadSeason } from './data';
import { ago, kickoffLabel, pct, pts, shortName } from './format';
import { useAsync } from './hooks';
import { buzzPref, setBuzzPref } from './prefs';
import { statChange, statLine } from './statLine';
import { WinChart } from './WinChart';

/** How often the Matchup tab checks Sleeper's scores while a starter's game is on and the page is open. [design] */
const LIVE_POLL = 60_000;
/** Entries shown before "Show all". */
const FEED_SHOWN = 6;
/** Swing players shown, and the least a player must move your win chance to be one. [design] */
const SWING_SHOWN = 6;
const MIN_SWING = 0.01;
/** A buzz for your player's 6+ points at once, or a 10-point move in your win chance. [design] */
const BIG_POINTS = 6;
const BIG_WIN = 0.1;

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const clockTime = (ms: number) => timeFmt.format(new Date(ms));

/** A stored feed from this or an older version of the app, or a fresh one. */
function asFeed(x: unknown): LiveFeed {
  const f = x as Partial<LiveFeed> | undefined;
  return f && Array.isArray(f.groups) && Array.isArray(f.timeline) && typeof f.described === 'object' && f.described ? (f as LiveFeed) : emptyFeed();
}

/** Good news for you: your player gaining, or theirs losing. */
const goodForYou = (e: FeedEvent) => (e.side === 'me') === e.pts > 0;

function vibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

/**
 * Both lineups slot by slot: Sleeper's points so far with each starter's projection, stat lines once games start, each
 * game's clock from ESPN's scoreboard, and each side's expected final. While a starter's game is on it checks every
 * minute, and the live feed records what changed between checks.
 */
export function MatchupTab({ b, base, objective, now }: { b: LeagueBundle; base: LineupAnalysis; objective: Objective | undefined; now: number }) {
  const [live, setLive] = useState<{ data: LeagueData; at: number } | null>(null);
  const [stats, setStats] = useState<WeekStats | null>(null);
  const [clock, setClock] = useState<ReadonlyMap<string, GameClock> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The league as of the last check: Sleeper's scores and lineups, and the game clocks.
  const data = live?.data ?? b.data;
  const ctx = useMemo(() => ({ ...b.ctx, now: live?.at ?? b.ctx.now, ...(clock ? { clock } : {}) }), [b, live, clock]);
  const a = useMemo(() => {
    if (!live && !clock) return base;
    const myRoster = data.rosters.find((r) => r.rosterId === b.myRoster!.rosterId) ?? b.myRoster!;
    return lineupFor({ ...b, data, myRoster, ctx }, objective ?? base.objective) ?? base;
  }, [b, base, data, ctx, objective]);
  const view = useMemo(() => liveMatchup(a, now), [a, now]);
  const positions = useMemo(() => projectionPositions(b.league), [b.league]);
  const started = [...view.me.slots, ...(view.opponent?.slots ?? [])].some((r) => r && r.kickoff !== null && r.kickoff <= now);

  /** Scores and lineups fresh from Sleeper; stat lines and game clocks from the copies kept a few minutes unless `force`. */
  const refresh = async (force: boolean) => {
    setBusy(true);
    try {
      const [data, st, sb] = await Promise.all([
        loadLeagueData(b.league.id, b.week, true),
        loadWeekStats(b.league.season, b.week, positions, force).catch(() => null),
        loadScoreboard(b.week, force).catch(() => null),
      ]);
      setLive({ data, at: Date.now() });
      if (st) setStats(st);
      if (sb) setClock(sb);
      setError(data.stale ? "Sleeper didn't answer: showing the last scores saved." : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  // A reload of the whole page brings newer data than the last live check.
  useEffect(() => setLive(null), [b]);
  // Stat lines and game clocks once any starter's game has kicked off (the week's final ones afterwards).
  useEffect(() => {
    if (!started) return;
    if (!stats) void loadWeekStats(b.league.season, b.week, positions).then(setStats, () => undefined);
    if (!clock) void loadScoreboard(b.week).then(setClock, () => undefined);
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

  // The live feed: each check compared with the one before, kept on this device for the week.
  const feedKey = `feed:${b.league.id}:${b.league.season}:${b.week}`;
  const [feed, setFeed] = useState<LiveFeed | null>(null);
  const feedRef = useRef<{ key: string; feed: LiveFeed } | null>(null);
  const queue = useRef(Promise.resolve());
  const [buzz, setBuzz] = useState(buzzPref);
  const [toast, setToast] = useState<FeedGroup | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const announce = (g: FeedGroup) => {
    setToast(g);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 6000);
    // Only for plays just made, not a catch-up after time away.
    if (!buzz || g.at - g.since > 3 * LIVE_POLL) return;
    const swing = g.win ? g.win[1] - g.win[0] : 0;
    const mine = g.events.some((e) => e.side === 'me' && e.pts >= BIG_POINTS);
    if (mine || swing >= BIG_WIN) vibrate(200);
    else if (swing <= -BIG_WIN) vibrate([90, 70, 90]);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (!started) return;
    const players = feedPlayers(a);
    const snap = feedSnapshot(a, players, stats?.stats, live?.at ?? b.data.savedAt);
    queue.current = queue.current
      .then(async () => {
        const held = feedRef.current?.key === feedKey ? feedRef.current.feed : asFeed(await loadStored<LiveFeed>(feedKey));
        const { feed: next, group } = stepFeed(held, snap, players);
        feedRef.current = { key: feedKey, feed: next };
        setFeed(next);
        if (next !== held) await saveStored(feedKey, next);
        if (group && document.visibilityState === 'visible') announce(group);
      })
      .catch(() => undefined);
  }, [a, stats, started, feedKey]);

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
        {feed && a.winProbCurrent !== undefined ? <WinChart timeline={feed.timeline} /> : null}
      </div>

      {started && feed ? (
        <FeedCard
          feed={feed}
          buzz={buzz}
          onBuzz={(on) => {
            setBuzz(on);
            setBuzzPref(on);
          }}
        />
      ) : null}

      {opp ? <SwingCard a={a} now={now} /> : null}

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
          his projection. Projected final: points so far plus what&apos;s left of each starter&apos;s projection, by the game clock (ESPN&apos;s
          scoreboard; time since kickoff when it doesn&apos;t load). Stat lines come from Sleeper and can lag its scores. Win chance treats players
          in the same NFL game as linked (a QB and his receivers rise and fall together).
          {opp?.assumed.size ? ` ${opp.name} is assumed to replace starters who can't play (marked “assumed”).` : ''}
        </p>
      </div>
      <AroundCard b={b} data={data} ctx={ctx} />
      {toast ? <Toast g={toast} onClose={() => setToast(null)} /> : null}
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

/** "Q2 8:43 · 17–10" with his team's score first, or the kickoff time before the game. */
function gameText(row: PlayerRow, now: number): string {
  const c = row.clock;
  if (!c || c.state === 'pre' || !row.team) return kickoffLabel(row.kickoff, now);
  const [mine, theirs] = c.home === row.team ? [c.homeScore, c.awayScore] : [c.awayScore, c.homeScore];
  return `${c.label} · ${mine}–${theirs}`;
}

function Cell({ row, now, line, right, assumed }: { row: PlayerRow | null; now: number; line: (r: PlayerRow) => string | undefined; right?: boolean; assumed?: ReadonlySet<string> }) {
  const cls = `mu-cell${right ? ' mu-right' : ''}`;
  if (!row) return <div class={`${cls} muted`}>Empty</div>;
  const state = gameState(row, now);
  const stat = state === 'upcoming' || state === 'bye' ? undefined : line(row);
  const game = row.kickoff === null ? 'BYE' : `${row.home ? 'vs' : '@'} ${row.opponent ?? '?'} · ${gameText(row, now)}`;
  // His offense has the ball (a defense's opponent having it isn't news for the defense).
  const ball = row.clock?.state === 'in' && row.pos !== 'DEF' && row.clock.possession === row.team;
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
      {ball ? (
        <div class="mu-ball" title={row.clock!.down}>
          {row.clock!.redZone ? <Badge kind="warn">red zone</Badge> : <Badge kind="info">has the ball</Badge>}
          {row.clock!.down ? <span class="muted"> {row.clock!.down}</span> : null}
        </div>
      ) : null}
      {stat ? <div class="mu-line">{stat}</div> : null}
    </div>
  );
}

function FeedLine({ e }: { e: FeedEvent }) {
  const what = statChange(e.pos, e.stats);
  return (
    <li class={goodForYou(e) ? 'feed-good' : 'feed-bad'}>
      <strong class="feed-pts">
        {e.pts > 0 ? '+' : '−'}
        {pts(Math.abs(e.pts))}
      </strong>{' '}
      {shortName(e)} <span class="muted small">{e.side === 'me' ? 'yours' : 'theirs'}</span>
      {what ? <span> · {what}</span> : null}
    </li>
  );
}

function FeedHead({ g }: { g: FeedGroup }) {
  // A gap of more than a few checks: the app was closed or in the background.
  const away = g.at - g.since > 3 * LIVE_POLL;
  return (
    <div class="feed-head">
      <span class="muted">
        {clockTime(g.at)}
        {away ? ` (since ${clockTime(g.since)})` : ''}
      </span>
      {g.win ? (
        <span>
          win chance {pct(g.win[0])} → <strong>{pct(g.win[1])}</strong>
        </span>
      ) : null}
    </div>
  );
}

function FeedCard({ feed, buzz, onBuzz }: { feed: LiveFeed; buzz: boolean; onBuzz: (on: boolean) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? feed.groups : feed.groups.slice(0, FEED_SHOWN);
  return (
    <div class="card">
      <h2>Live feed</h2>
      {feed.groups.length ? (
        <ol class="feed" role="log" aria-live="polite">
          {shown.map((g) => (
            <li key={g.at}>
              <FeedHead g={g} />
              <ul class="feed-lines">
                {g.events.map((e) => (
                  <FeedLine e={e} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <p class="muted">Scores show up here as Sleeper records them, checked every minute while this page is open.</p>
      )}
      <p class="small feed-foot">
        {feed.groups.length > FEED_SHOWN ? (
          <button type="button" class="link" onClick={() => setAll(!all)}>
            {all ? 'Show fewer' : `Show all ${feed.groups.length}`}
          </button>
        ) : null}
        <label class="feed-buzz">
          <input type="checkbox" checked={buzz} onChange={(e) => onBuzz((e.currentTarget as HTMLInputElement).checked)} /> Buzz on big plays
        </label>
      </p>
      <p class="muted small">
        One entry per check: every minute while this page is open, longer when it was closed, so an entry can hold several plays. What happened
        comes from Sleeper&apos;s stat line, which can lag the score. Buzz: your player scoring {BIG_POINTS}+ at once, or your win chance moving{' '}
        {Math.round(BIG_WIN * 100)} points (phones that support it).
      </p>
    </div>
  );
}

function Toast({ g, onClose }: { g: FeedGroup; onClose: () => void }) {
  const top = g.events[0]!;
  const what = statChange(top.pos, top.stats);
  return (
    <div class={`toast ${goodForYou(top) ? 'feed-good' : 'feed-bad'}`} role="status">
      <span>
        <strong>
          {top.pts > 0 ? '+' : '−'}
          {pts(Math.abs(top.pts))}
        </strong>{' '}
        {shortName(top)}
        {what ? ` · ${what}` : ''}
        {g.events.length > 1 ? ` · +${g.events.length - 1} more` : ''}
        {g.win ? ` · win chance ${pct(g.win[1])}` : ''}
      </span>
      <button type="button" class="link" aria-label="Dismiss" onClick={onClose}>
        ×
      </button>
    </div>
  );
}

function SwingCard({ a, now }: { a: LineupAnalysis; now: number }) {
  const all = useMemo(() => swingPlayers(a, now), [a, now]);
  const [open, setOpen] = useState<string | null>(null);
  if (!all.length) return null; // every game is over
  const swing = all.filter((s) => s.swing >= MIN_SWING).slice(0, SWING_SHOWN);
  return (
    <div class="card">
      <h2>Swing players</h2>
      {swing.length ? (
        <>
          <p class="muted small">Who&apos;s left to play on both sides, by how much their game moves your win chance ({pct(a.winProbCurrent)} now). Tap one to try a final score.</p>
          <ul class="swing">
            {swing.map((s) => (
              <li key={s.row.id}>
                <button type="button" class="swing-row" aria-expanded={open === s.row.id} onClick={() => setOpen(open === s.row.id ? null : s.row.id)}>
                  <span class="swing-who">
                    <strong>{shortName(s.row)}</strong>{' '}
                    <span class="muted small">
                      {s.row.pos}
                      {s.row.team ? `·${s.row.team}` : ''} · {s.side === 'me' ? 'yours: root for him' : 'theirs: root against him'}
                    </span>
                  </span>
                  <span class="swing-odds small">
                    big game {pct(s.boom)} · quiet one {pct(s.bust)}
                  </span>
                </button>
                {open === s.row.id ? <WhatIf s={s} /> : null}
              </li>
            ))}
          </ul>
          <p class="muted small">
            A big game is one SD above his expected points, a quiet one one SD below (about 1 game in 6 each way). Teammates move with him: a QB&apos;s big
            game lifts his receivers too.
          </p>
        </>
      ) : (
        <p class="muted">Nobody still to play moves your win chance ({pct(a.winProbCurrent)}) by a point or more.</p>
      )}
    </div>
  );
}

function WhatIf({ s }: { s: SwingPlayer }) {
  const lo = Math.floor(s.floor * 2) / 2;
  const hi = Math.max(lo + 1, Math.ceil((s.mean + 2.5 * s.sd) * 2) / 2);
  const [x, setX] = useState(Math.min(hi, Math.max(lo, Math.round(s.mean * 2) / 2)));
  return (
    <div class="whatif">
      <label class="small">
        If {s.row.name} finishes with <strong>{pts(x)}</strong> points (expected {pts(s.mean)}): your win chance <strong>{pct(s.winIf(x))}</strong>
        <input type="range" min={lo} max={hi} step={0.5} value={x} onInput={(e) => setX(Number((e.currentTarget as HTMLInputElement).value))} />
      </label>
    </div>
  );
}

/** Both teams of a matchup with their win chances (one row without an opponent). */
const sidesOf = (p: { a: TeamNow; b?: TeamNow; winA?: number }): Array<{ t: TeamNow; win: number | undefined }> => [
  { t: p.a, win: p.winA },
  ...(p.b ? [{ t: p.b, win: p.winA === undefined ? undefined : 1 - p.winA }] : []),
];

/** Every matchup this week as it stands, and the playoff odds now against the start of the week. */
function AroundCard({ b, data, ctx }: { b: LeagueBundle; data: LeagueData; ctx: WeekContext }) {
  const myId = b.myRoster?.rosterId;
  const pairs = useMemo(() => leagueMatchups(b.league, data.rosters, data.users, data.matchups, ctx, myId), [b.league, data, ctx, myId]);
  const season = useAsync(() => loadSeason(b), [b]);
  const outlook = season.data?.outlook;
  // The start of the week from the lineups as the page loaded them; now from the last check.
  const start = useMemo(() => (outlook ? oddsWithWeek(outlook, weekStartDists(b.league, b.data.rosters, b.data.users, b.data.matchups, b.ctx)) : undefined), [outlook, b]);
  const odds = useMemo(() => (outlook ? oddsWithWeek(outlook, currentDists(pairs)) : undefined), [outlook, pairs]);
  if (pairs.length < 2) return null;
  const records = new Map(data.rosters.map((r) => [r.rosterId, `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`]));
  const table = odds && start ? [...odds.values()].sort((x, y) => y.pPlayoffs - x.pPlayoffs) : [];
  const name = (id: number) => pairs.flatMap((p) => [p.a, ...(p.b ? [p.b] : [])]).find((t) => t.rosterId === id)?.name ?? `Team ${id}`;
  return (
    <div class="card">
      <h2>Around the league</h2>
      <table class="around">
        <thead>
          <tr>
            <th>Team</th>
            <th class="num">Points</th>
            <th class="num">Proj</th>
            <th class="num">Win</th>
          </tr>
        </thead>
        {pairs.map((p) => (
          <tbody key={p.a.rosterId} class={p.a.rosterId === myId ? 'around-mine' : undefined}>
            {sidesOf(p).map(({ t, win }) => (
              <tr>
                <td>{t.rosterId === myId ? <strong>{t.name}</strong> : t.name}</td>
                <td class="num">{pts(t.points)}</td>
                <td class="num muted">{pts(t.dist.mean)}</td>
                <td class="num">{win === undefined ? '–' : pct(win)}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      {table.length ? (
        <>
          <h3>Playoff odds</h3>
          <table class="around">
            <thead>
              <tr>
                <th>Team</th>
                <th class="num">Record</th>
                <th class="num">Start of week</th>
                <th class="num">Now</th>
              </tr>
            </thead>
            <tbody>
              {table.map((t) => (
                <tr key={t.rosterId} class={t.rosterId === myId ? 'around-mine' : undefined}>
                  <td>{t.rosterId === myId ? <strong>{name(t.rosterId)}</strong> : name(t.rosterId)}</td>
                  <td class="num muted">{records.get(t.rosterId) ?? ''}</td>
                  <td class="num muted">{pct(start!.get(t.rosterId)?.pPlayoffs)}</td>
                  <td class="num">{pct(t.pPlayoffs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p class="muted small">
            The Season tab&apos;s simulation of the rest of the season, with this week&apos;s games as they stand now (points so far plus what&apos;s
            left of each lineup) against before this week&apos;s first kickoff. Later weeks are as on the Season tab.
          </p>
        </>
      ) : season.loading ? (
        <p class="muted small">Loading playoff odds…</p>
      ) : season.error ? (
        <p class="muted small">Playoff odds didn&apos;t load: {season.error.message}</p>
      ) : null}
    </div>
  );
}
