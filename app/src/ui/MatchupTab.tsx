import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { LineupAnalysis, Objective, PlayerRow, WeekContext } from '../analysis/analyze';
import { currentDists, leagueMatchups, weekStartDists, type TeamNow } from '../analysis/aroundLeague';
import { awaitingStats, checkPlan, emptyFeed, feedPlayers, feedSnapshot, stepFeed, type FeedEvent, type FeedGroup, type LiveFeed } from '../analysis/liveFeed';
import { gameState, liveMatchup, type LiveSide } from '../analysis/liveMatchup';
import { oddsWithWeek } from '../analysis/outlook';
import { projectionPositions } from '../analysis/ros';
import { swingPlayers, type SwingPlayer } from '../analysis/swing';
import { loadStored, saveStored } from '../data/cache';
import { type LeagueData, LIVE_STATS_TTL, loadLeagueData, loadLiveScores, loadWeekStats, newerStats, type WeekStats } from '../data/repo';
import { loadGamePlays, playsFor, playsVersion, type ScoringPlay } from '../data/plays';
import { loadScoreboard } from '../data/scoreboard';
import type { GameClock } from '../domain/types';
import { Badge, ChangeLine, InjuryBadge, slotLabel } from './components';
import { type LeagueBundle, lineupFor, loadSeason } from './data';
import { ago, kickoffLabel, pct, pts, shortName } from './format';
import { useAsync } from './hooks';
import { buzzPref, setBuzzPref } from './prefs';
import { statChange, statLine } from './statLine';
import { WinChart } from './WinChart';

/**
 * How often the Matchup tab checks Sleeper's scores while a starter's game is on and the page is open; lineups and stat
 * lines load once a minute, and stat lines at every check while one trails its points (checkPlan). [design]
 */
const LIVE_POLL = 20_000;
/** Coming back to the page checks right away when the last check is this old. [design] */
const RESUME_CHECK = 15_000;
/** A gap this long between checks means the page was closed or in the background: a catch-up, not plays just made. [design] */
const AWAY = 2 * 60_000;
/** Entries shown before "Show all". */
const FEED_SHOWN = 6;
/** Swing players shown, and the least a player must move your win chance to be one. [design] */
const SWING_SHOWN = 6;
const MIN_SWING = 0.01;
/** Entries this big may be a touchdown or field goal: they look for ESPN's scoring play. [design] */
const SCORE_POINTS = 3.5;
/** Sleeper's points can trail the play by a few minutes: an entry's plays can be this much older than the check before it. [design] */
const PLAY_LAG = 5 * 60_000;
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

  // A check under way (a second one waits for the next tick), when the last one started, and when the last full one did.
  const checking = useRef(false);
  const lastCheck = useRef(0);
  const lastFull = useRef(0);
  /**
   * Scores fresh from Sleeper; lineups and stat lines too when the check is a full one (once a minute, `full`, or `force`),
   * and stat lines whenever a starter's line trails his points; game clocks from the copy kept 30 seconds. `force` reloads
   * them all.
   */
  const refresh = async (force: boolean, full = force) => {
    if (checking.current) return;
    checking.current = true;
    const at = Date.now();
    lastCheck.current = at;
    const plan = checkPlan(at, lastFull.current, awaitingStats(feed ?? emptyFeed(), at).size > 0, full);
    setBusy(true);
    try {
      const [scores, st, sb] = await Promise.all([
        plan.full ? loadLeagueData(b.league.id, b.week, true) : loadLiveScores(b.league.id, b.week),
        plan.stats ? loadWeekStats(b.league.season, b.week, positions, force, LIVE_STATS_TTL).catch(() => null) : null,
        loadScoreboard(b.week, force).catch(() => null),
      ]);
      if (plan.full) lastFull.current = at;
      setLive((cur) => ({ data: { ...(cur?.data ?? b.data), ...scores }, at: Date.now() }));
      if (st) setStats((held) => newerStats(held, st));
      if (sb) setClock(sb);
      setError(scores.stale ? "Sleeper didn't answer: showing the last scores saved." : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      checking.current = false;
      setBusy(false);
    }
  };
  // The timers below call the latest refresh: it reads this render's feed and league.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  // A reload of the whole page brings newer data than the last live check.
  useEffect(() => setLive(null), [b]);
  // Stat lines and game clocks once any starter's game has kicked off (the week's final ones afterwards).
  useEffect(() => {
    if (!started) return;
    if (!stats) void loadWeekStats(b.league.season, b.week, positions).then((st) => setStats((held) => newerStats(held, st)), () => undefined);
    if (!clock) void loadScoreboard(b.week).then(setClock, () => undefined);
  }, [started]);
  // Live scores while a starter's game is on and the page is open, and right away on coming back to it (from Sleeper's app,
  // say) rather than at the next tick.
  useEffect(() => {
    if (!view.playing) return;
    void refreshRef.current(false, true);
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRef.current(false);
    }, LIVE_POLL);
    const back = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck.current >= RESUME_CHECK) void refreshRef.current(false, true);
    };
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', back);
    };
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
    if (!buzz || g.at - g.since > AWAY) return;
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
  // Starters whose points have moved but whose stat lines haven't yet ("updating").
  const pending = useMemo(() => (feed ? awaitingStats(feed, Math.max(now, live?.at ?? 0)) : new Set<string>()), [feed, now, live]);
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
          {view.playing ? 'Live: checks Sleeper every 20 seconds while games are on. ' : ''}Updated {ago(live?.at ?? b.data.savedAt, now)}.{' '}
          <button type="button" class="link" disabled={busy} onClick={() => void refresh(true)}>
            {busy ? 'Refreshing…' : 'Refresh'}
          </button>
        </p>
        {error ? <p class="problem problem-error">{error}</p> : null}
        {feed && a.winProbCurrent !== undefined ? <WinChart timeline={feed.timeline} /> : null}
      </div>

      <LateSwaps a={a} leagueId={b.league.id} />

      {started && feed ? (
        <FeedCard
          feed={feed}
          clocks={clock}
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
              <Cell row={me.slots[s] ?? null} now={now} line={line} pending={pending} />
              <span class="slot">{slotLabel(slot)}</span>
              {opp ? <Cell row={opp.slots[s] ?? null} now={now} line={line} pending={pending} right assumed={opp.assumed} /> : <span />}
            </div>
          ))}
        </div>
        <p class="muted small">
          Points so far are Sleeper&apos;s. Before a game, a starter shows his projection (times his chance to play); once it starts, his points and
          his projection. Projected final: points so far plus what&apos;s left of each starter&apos;s projection, by the game clock (ESPN&apos;s
          scoreboard; time since kickoff when it doesn&apos;t load). Stat lines come from Sleeper&apos;s stats, loaded every minute and at every check
          while one trails its points (marked “updating”). Win chance treats players
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

function Cell({
  row,
  now,
  line,
  pending,
  right,
  assumed,
}: {
  row: PlayerRow | null;
  now: number;
  line: (r: PlayerRow) => string | undefined;
  pending: ReadonlySet<string>;
  right?: boolean;
  assumed?: ReadonlySet<string>;
}) {
  const cls = `mu-cell${right ? ' mu-right' : ''}`;
  if (!row) return <div class={`${cls} muted`}>Empty</div>;
  const state = gameState(row, now);
  const stat = state === 'upcoming' || state === 'bye' ? undefined : line(row);
  // His points have moved and his stat line hasn't yet: say so rather than show a line that looks wrong.
  const updating = state !== 'upcoming' && state !== 'bye' && pending.has(row.id);
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
      {stat || updating ? (
        <div class="mu-stat">
          {stat ? <span class="mu-line">{stat}</span> : null}
          {updating ? (
            <span class="mu-updating" title="Sleeper's points have moved; its stat line hasn't caught up yet">
              updating
            </span>
          ) : null}
        </div>
      ) : null}
      {(state === 'live' || state === 'final') && row.pos !== 'DEF' && row.clock?.event ? <ScoringPlays row={row} clock={row.clock} /> : null}
    </div>
  );
}

function FeedLine({ e, g, clock }: { e: FeedEvent; g: FeedGroup; clock: GameClock | undefined }) {
  const what = statChange(e.pos, e.stats);
  return (
    <li class={goodForYou(e) ? 'feed-good' : 'feed-bad'}>
      <strong class="feed-pts">
        {e.pts > 0 ? '+' : '−'}
        {pts(Math.abs(e.pts))}
      </strong>{' '}
      {shortName(e)} <span class="muted small">{e.side === 'me' ? 'yours' : 'theirs'}</span>
      {what ? <span> · {what}</span> : null}
      {Math.abs(e.pts) >= SCORE_POINTS && e.pos !== 'DEF' && clock?.event ? <FeedPlay e={e} g={g} clock={clock} /> : null}
    </li>
  );
}

/** ESPN's description of the scoring play behind an entry: his plays between the check before (less Sleeper's lag) and this one. */
function FeedPlay({ e, g, clock }: { e: FeedEvent; g: FeedGroup; clock: GameClock }) {
  // Asked again with each check's clock: a copy that trailed the scoreboard loads again (loadGamePlays).
  const game = useAsync(() => loadGamePlays(clock.event!, playsVersion(clock)), [clock]);
  if (!game.data) return null;
  const plays = playsFor(game.data, { name: e.name, ...(e.espn ? { espnId: e.espn } : {}) }).filter((p) => p.at !== undefined && p.at > g.since - PLAY_LAG && p.at <= g.at);
  return plays.length ? (
    <span class="feed-play muted small">
      {plays.map((p) => (
        <q key={p.id}>{p.text}</q>
      ))}
    </span>
  ) : null;
}

const quarter = (n: number) => (n > 4 ? 'OT' : `Q${n}`);

/** His scoring plays in this game (ESPN's game summary), loaded when opened. */
function ScoringPlays({ row, clock }: { row: PlayerRow; clock: GameClock }) {
  const [open, setOpen] = useState(false);
  return (
    <div class="mu-plays">
      <button type="button" class="link small" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? 'Hide scoring plays' : 'Scoring plays'}
      </button>
      {open ? <PlaysList row={row} clock={clock} /> : null}
    </div>
  );
}

function PlaysList({ row, clock }: { row: PlayerRow; clock: GameClock }) {
  // Asked again with each check's clock: a copy that trailed the scoreboard loads again (loadGamePlays).
  const game = useAsync(() => loadGamePlays(clock.event!, playsVersion(clock)), [clock]);
  if (game.error && !game.data) return <p class="muted small">ESPN&apos;s plays didn&apos;t load.</p>;
  if (!game.data) return <p class="muted small">Loading…</p>;
  const plays: ScoringPlay[] = playsFor(game.data, { name: row.name, ...(row.espnId ? { espnId: row.espnId } : {}) });
  return plays.length ? (
    <ul class="mu-play-list small">
      {plays.map((p) => (
        <li key={p.id}>
          <span class="muted">
            {quarter(p.period)} {p.clock}
          </span>{' '}
          {p.text}
        </li>
      ))}
    </ul>
  ) : (
    <p class="muted small">No scoring plays for him yet.</p>
  );
}

/** The Lineup tab's changes for the lineup as it stands, with what they're worth: a shortcut, since lineups are set in Sleeper. */
function LateSwaps({ a, leagueId }: { a: LineupAnalysis; leagueId: string }) {
  const winGain = a.winProbRecommended !== undefined && a.winProbCurrent !== undefined ? a.winProbRecommended - a.winProbCurrent : undefined;
  // Worth a card by what the advice aims for: win chance, or expected points.
  if (!a.changes.length || (a.objective === 'win' ? (winGain ?? 0) < 0.005 : a.gain < 0.5)) return null;
  const late = a.current.some((r) => r?.locked);
  return (
    <div class="card late-swaps">
      <h2>{late ? 'Late swaps' : 'Lineup changes'}</h2>
      <ul class="changes">
        {a.changes.map((c) => (
          <ChangeLine c={c} />
        ))}
      </ul>
      <p>
        <strong>
          {a.gain >= 0 ? '+' : '−'}
          {Math.abs(a.gain).toFixed(1)}
        </strong>{' '}
        expected points
        {winGain !== undefined ? (
          <>
            {' '}
            · win chance {pct(a.winProbCurrent)} → <strong>{pct(a.winProbRecommended)}</strong>
          </>
        ) : null}{' '}
        <span class="muted small">({a.objective === 'win' ? 'aiming for win chance' : 'aiming for max points'})</span>
      </p>
      <p class="muted small">
        Make them in Sleeper before each player&apos;s kickoff: this app can&apos;t set lineups. The <a href={`#/league/${leagueId}/lineup`}>Lineup tab</a>{' '}
        explains each one{late ? '; players whose games have started stay put' : ''}.
      </p>
    </div>
  );
}

function FeedHead({ g }: { g: FeedGroup }) {
  // The app was closed or in the background in between.
  const away = g.at - g.since > AWAY;
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

function FeedCard({ feed, clocks, buzz, onBuzz }: { feed: LiveFeed; clocks: ReadonlyMap<string, GameClock> | null; buzz: boolean; onBuzz: (on: boolean) => void }) {
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
                  <FeedLine e={e} g={g} clock={e.team ? clocks?.get(e.team) : undefined} />
                ))}
              </ul>
            </li>
          ))}
        </ol>
      ) : (
        <p class="muted">Scores show up here as Sleeper records them, checked every 20 seconds while this page is open.</p>
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
        One entry per check: every 20 seconds while this page is open, longer when it was closed, so an entry can hold several plays. What happened
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
