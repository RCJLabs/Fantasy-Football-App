import { useState } from 'preact/hooks';
import { exposure, gameStacks, sharedTargets, type SharedTarget } from '../analysis/across';
import type { PlayerRow } from '../analysis/analyze';
import { rootingGuide, type RootingGame, type RootingSide } from '../analysis/rooting';
import { waiverBoard } from '../analysis/outlook';
import { loadTrending } from '../data/repo';
import type { League } from '../domain/types';
import { NextLock } from './BeforeLock';
import { Badge, ErrorBox, Problems, Spinner } from './components';
import { loadOverview, loadSeason, sharedBundle } from './data';
import { logError } from './errorLog';
import { ago, kickoffLabel, pct, pts, shortName, signed } from './format';
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
      {overview.data ? <RootingGuide leagues={overview.data.leagues} week={overview.data.week} session={session} /> : null}
      {overview.data ? <AcrossLeagues leagues={overview.data.leagues} week={overview.data.week} session={session} /> : null}
    </section>
  );
}

function LeagueCard({ league, week, session }: { league: League; week: number; session: Session }) {
  const active = league.status === 'in_season' || league.status === 'post_season';
  const bundle = useAsync((force) => (active ? sharedBundle(league, week, session, force) : Promise.resolve(null)), [league.id, week]);
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
          {league.rules.bestBall ? (
            <p class="muted small">Best ball: Sleeper sets your lineup automatically.</p>
          ) : (
            <>
              <Problems problems={a.problems} limit={3} />
              <NextLock a={a} now={Date.now()} />
            </>
          )}
          <p class="muted small">Updated {ago(bundle.data!.data.savedAt)}</p>
        </>
      ) : null}
    </article>
  );
}

/** Players listed before "and N more". */
const SHOWN = 6;

/**
 * Your leagues together (docs/across-leagues.md): players you start in more than one, NFL games where your starters
 * bunch up, and, on request, free agents worth claiming in more than one. Best-ball leagues set their own lineups and
 * are left out.
 */
function AcrossLeagues({ leagues, week, session }: { leagues: League[]; week: number; session: Session }) {
  const active = leagues.filter((l) => (l.status === 'in_season' || l.status === 'post_season') && !l.rules.bestBall);
  const bundles = useAsync(
    async () =>
      (await Promise.allSettled(active.map((l) => sharedBundle(l, week, session, false)))).flatMap((r) =>
        r.status === 'fulfilled' && r.value.myRoster && r.value.lineup ? [r.value] : [],
      ),
    [active.map((l) => l.id).join(','), week],
  );
  const [targets, setTargets] = useState<{ running: boolean; list?: SharedTarget[]; error?: string }>({ running: false });
  if (active.length < 2 || !bundles.data || bundles.data.length < 2) return null;
  const now = Date.now();
  const lineups = bundles.data.map((b) => ({ leagueId: b.league.id, name: b.league.name, starters: b.lineup!.recommended.filter((r): r is PlayerRow => r !== null) }));
  const ex = exposure(lineups);
  const stacks = gameStacks(lineups).slice(0, 3);
  const label = (p: PlayerRow) => `${p.pos}${p.team ? `·${p.team}` : ''}`;

  const compare = async () => {
    setTargets({ running: true });
    try {
      const trending = await loadTrending();
      const boards = (
        await Promise.allSettled(
          bundles.data!.map(async (b) => {
            const season = await loadSeason(b);
            return { leagueId: b.league.id, name: b.league.name, rows: waiverBoard(season.outlook, b.myRoster!, b.ctx, trending, season.claims).rows };
          }),
        )
      ).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      if (boards.length < 2) throw new Error("couldn't value free agents in two or more leagues");
      setTargets({ running: false, list: sharedTargets(boards) });
    } catch (e) {
      logError(e);
      setTargets({ running: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div class="card across">
      <h2>Across your leagues</h2>
      <p class="muted small">From the lineups the app recommends this week in your {bundles.data.length} leagues.</p>
      <h3>In more than one lineup</h3>
      {ex.length ? (
        <ul class="across-list">
          {ex.slice(0, SHOWN).map((e) => (
            <li>
              <strong>{e.player.name}</strong> <span class="muted small">{label(e.player)}</span> · {e.leagues.length} leagues
              {e.player.p < 0.95 ? <span class="warn-text"> · {pct(e.player.p)} to play</span> : null}
            </li>
          ))}
          {ex.length > SHOWN ? <li class="muted small">and {ex.length - SHOWN} more</li> : null}
        </ul>
      ) : (
        <p class="muted small">No player starts for you in more than one league.</p>
      )}
      <h3>Games with several of your starters</h3>
      {stacks.length ? (
        <ul class="across-list">
          {stacks.map((g) => (
            <li>
              <strong>{g.game}</strong> <span class="muted small">{kickoffLabel(g.kickoff, now)}</span> · {g.slots} starter spots:{' '}
              {g.players.map((x) => `${x.player.name}${x.leagues > 1 ? ` (${x.leagues})` : ''}`).join(', ')}
            </li>
          ))}
        </ul>
      ) : (
        <p class="muted small">No game holds three or more of your starter spots.</p>
      )}
      <p class="muted small">One injury or one bad game moves all of these together: worth knowing, not a reason to bench anyone.</p>
      <h3>Free agents for more than one league</h3>
      {targets.list ? (
        targets.list.length ? (
          <ul class="across-list">
            {targets.list.slice(0, SHOWN).map((t) => (
              <li>
                <strong>{t.player.name}</strong> <span class="muted small">{label(t.player)}</span>
                <br />
                <span class="small">
                  {t.leagues[0]!.gain - t.leagues[1]!.gain < 1 ? 'About the same in each' : `Adds most in ${t.leagues[0]!.name}`}:{' '}
                  {t.leagues.map((l) => `${l.name} ${signed(l.gain)}${l.bid !== undefined ? ` ($${l.bid})` : ''}`).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p class="muted small">No free agent is a top-10 waiver target in more than one of your leagues.</p>
        )
      ) : (
        <button type="button" class="btn btn-small" onClick={compare} disabled={targets.running}>
          {targets.running ? 'Valuing free agents…' : 'Compare waiver boards'}
        </button>
      )}
      {targets.error ? <p class="note">The comparison failed: {targets.error}</p> : null}
      {targets.list?.length ? (
        <p class="muted small">
          Points this week plus the rest of the season, after each league's suggested drop; suggested FAAB bids in brackets. Waiver order and budgets are
          per league, so claim him where he adds more, or in both.
        </p>
      ) : null}
    </div>
  );
}

/** Games shown before "Show all". */
const ROOT_SHOWN = 5;

/** "your P. Mahomes (2), T. Kelce" or "their J. Allen". */
function who(list: RootingSide['yours'], whose: string): string {
  return list.length ? `${whose} ${list.map((p) => `${shortName(p.row)}${p.leagues > 1 ? ` (${p.leagues})` : ''}`).join(', ')}` : '';
}

function RootingLine({ s }: { s: RootingSide }) {
  const label = `${s.team} ${s.unit}`;
  const players = [who(s.yours, 'your'), who(s.theirs, 'their')].filter(Boolean).join('; ');
  return (
    <li>
      {s.net > 0 ? 'Root for' : 'Root against'} <strong>{label}</strong> <span class="muted small">{signed(s.net)} pts left for you · {players}</span>
    </li>
  );
}

function RootingItem({ g, now }: { g: RootingGame; now: number }) {
  return (
    <li>
      <div>
        <strong>{g.game}</strong> <span class="muted small">{g.live ? 'Live' : kickoffLabel(g.kickoff, now)}</span>
      </div>
      <ul class="root-sides">
        {g.sides.map((s) => (
          <RootingLine s={s} />
        ))}
      </ul>
      {g.stakes.length ? (
        <p class="small muted">
          {g.stakes.map((st) => `${st.name}: ${pct(st.now)} now, ${pct(st.good)} if it goes your way, ${pct(st.bad)} if not`).join(' · ')}
        </p>
      ) : null}
    </li>
  );
}

/** For each NFL game not over yet: whom to root for across your leagues, and how much it can swing each one. */
function RootingGuide({ leagues, week, session }: { leagues: League[]; week: number; session: Session }) {
  const active = leagues.filter((l) => (l.status === 'in_season' || l.status === 'post_season') && !l.rules.bestBall);
  const bundles = useAsync(
    async () =>
      (await Promise.allSettled(active.map((l) => sharedBundle(l, week, session, false)))).flatMap((r) =>
        r.status === 'fulfilled' && r.value.myRoster && r.value.lineup ? [r.value] : [],
      ),
    [active.map((l) => l.id).join(','), week],
  );
  const [all, setAll] = useState(false);
  if (!bundles.data?.length) return null;
  const now = Date.now();
  const guide = rootingGuide(
    bundles.data.map((b) => ({ leagueId: b.league.id, name: b.league.name, a: b.lineup! })),
    now,
  );
  if (!guide.length) return null;
  const shown = all ? guide : guide.slice(0, ROOT_SHOWN);
  return (
    <div class="card rooting">
      <h2>Rooting guide</h2>
      <p class="muted small">
        This week&apos;s games still to finish, the most at stake first: whom to root for across your {bundles.data.length === 1 ? 'league' : `${bundles.data.length} leagues`},
        and your win chance if the game goes your way or against you.
      </p>
      <ol class="root-games">
        {shown.map((g) => (
          <RootingItem key={g.game} g={g} now={now} />
        ))}
      </ol>
      {guide.length > ROOT_SHOWN ? (
        <button type="button" class="link small" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${guide.length} games`}
        </button>
      ) : null}
      <p class="muted small">
        Points left: your starters&apos; expected points still to come in that game minus your opponents&apos;, over all your leagues. Going your way:
        your starters in it beating your opponents&apos; by one SD more than expected (about 1 game in 6), teammates moving together. As of the
        lineups loaded {ago(Math.min(...bundles.data.map((b) => b.data.savedAt)), now)}; Refresh for newer scores.
      </p>
    </div>
  );
}
