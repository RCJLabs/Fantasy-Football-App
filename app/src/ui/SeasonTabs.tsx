import { useEffect, useMemo, useState } from 'preact/hooks';
import { analyzeWaivers, type PlayerRow } from '../analysis/analyze';
import { handcuffs, nextUpForOut, type Handcuff } from '../analysis/handcuffs';
import { irStash } from '../analysis/irStash';
import { marketPrice } from '../analysis/faab';
import { GRADE_WEIGHTS, leagueGrades, type LeagueGrades, type Part } from '../analysis/grades';
import type { Claim } from '../analysis/claims';
import { claimPlan, evaluateTrade, streamers, waiverBoard, type ByeWeek, type LeagueOutlook, type TradeSideResult } from '../analysis/outlook';
import { carriedForward, longTermRanking } from '../analysis/longterm';
import { buyLowSellHigh, STREAK_GAP, type StreakPick } from '../analysis/luck';
import { pickAssets, pickLabel, pickTotals, type PickAsset } from '../analysis/picks';
import { teamIds } from '../analysis/ros';
import { findPackages, findTrades, LOPSIDED, TRADED, type TargetPackage, type TargetSearch, type TradeIdea } from '../analysis/tradeFinder';
import { FANTASYCALC_URL, horizons, loadMarketValues, marketParams, marketTotals, type Horizon, type Market } from '../data/fantasycalc';
import { loadTrending } from '../data/repo';
import { GradeMark, InjuryBadge, ErrorBox, Spinner, touchdowns, usageNote } from './components';
import { loadSeason, type LeagueBundle, type SeasonBundle } from './data';
import { logError } from './errorLog';
import { kickoffLabel, ordinal, pct, pts, roundName, signed } from './format';
import { useAsync } from './hooks';
import { SeasonSoFarCard, WeeksAheadCard } from './WeeksCards';

const money = (n: number) => `$${Math.round(n)}`;
const weekSpan = (weeks: readonly number[]) => (weeks.length ? (weeks.length > 1 ? `weeks ${weeks[0]}–${weeks.at(-1)}` : `week ${weeks[0]}`) : 'no weeks');

function PlayerCell({ row, now, extra }: { row: PlayerRow; now: number; extra?: string }) {
  const usage = usageNote(row);
  return (
    <>
      <strong>{row.name}</strong>{' '}
      <span class="muted small">
        {row.pos}
        {row.team ? `·${row.team}` : ''}
      </span>{' '}
      <InjuryBadge row={row} />
      <div class="muted small">
        {row.kickoff === null ? 'BYE this week' : `${row.home ? 'vs' : '@'} ${row.opponent ?? '?'} ${kickoffLabel(row.kickoff, now)}`}
        {extra ? ` · ${extra}` : ''}
      </div>
      {usage ? <div class="muted small">{usage}</div> : null}
    </>
  );
}

function MissingWeeks({ season }: { season: SeasonBundle }) {
  if (!season.missingWeeks.length) return null;
  return <p class="note">Projections for {weekSpan(season.missingWeeks)} didn't load; those weeks count as zero.</p>;
}

// ---- Waivers -------------------------------------------------------------------------------------

export function WaiversTab({ bundle, now }: { bundle: LeagueBundle; now: number }) {
  const w = useAsync(async () => {
    const trending = await loadTrending();
    try {
      const season = await loadSeason(bundle);
      const board = waiverBoard(season.outlook, bundle.myRoster!, bundle.ctx, trending, season.claims);
      return { season, board, plan: claimPlan(season.outlook, bundle.myRoster!, bundle.ctx, board), nextUp: nextUpForOut(bundle.ctx.players) };
    } catch (e) {
      logError(e);
      return { fallback: analyzeWaivers(bundle.league, bundle.data.rosters, bundle.myRoster!, bundle.ctx, trending), reason: e instanceof Error ? e.message : String(e) };
    }
  }, [bundle]);
  if (w.error) return <ErrorBox error={w.error} />;
  if (!w.data) return <Spinner label="Valuing free agents for the rest of the season…" />;

  if ('fallback' in w.data) {
    const rows = w.data.fallback ?? [];
    return (
      <div class="card">
        <h2>Free agents for week {bundle.week}</h2>
        <p class="note">Rest-of-season values unavailable ({w.data.reason}). Showing this week only.</p>
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
            {rows.map((r) => (
              <tr>
                <td>
                  <PlayerCell row={r.player} now={now} />
                </td>
                <td class="num">{pts(r.player.ev)}</td>
                <td class="num">{r.gainThisWeek >= 0.05 ? signed(r.gainThisWeek) : '–'}</td>
                <td class="num">{r.trendingAdds ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const { season, board, plan, nextUp } = w.data;
  const o = season.outlook;
  const notes = (r: (typeof board.rows)[number]) => {
    const starter = nextUp.get(r.player.id);
    const parts = [r.drop && r.rosGain >= 0.05 ? `drop ${r.drop.name}` : '', starter ? `next up: ${starter.name} is ${starter.injury}` : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : undefined;
  };
  const me = o.teams.get(bundle.myRoster!.rosterId)!;
  const playoffWeight = bundle.league.rules.playoffWeekStart && !o.bracket ? me.weights.at(-1) : undefined;
  const firstRound = o.playoffRounds?.[0]?.[0];
  const byeWeight = playoffWeight !== undefined && firstRound !== undefined ? me.weights[firstRound] : undefined;
  const budget = bundle.league.rules.waiverBudget ?? 0;
  const showBids = board.remaining !== undefined;
  return (
    <div class="stack">
      <ClaimPlanCard bundle={bundle} outlook={o} plan={plan} bids={showBids} />
      <div class="card">
        <h2>Free agents</h2>
        <p class="muted small">
          Ranked by what each player adds to your best lineups: this week (<strong>Wk</strong>)
          {o.weeks.length ? (
            <>
              {' '}
              plus {weekSpan(o.weeks)} (<strong>ROS</strong>, after dropping the player shown)
            </>
          ) : (
            '; no weeks are left after this one'
          )}
          {playoffWeight !== undefined ? `. Playoff weeks count at your ${pct(playoffWeight)} playoff odds` : ''}
          {byeWeight !== undefined && playoffWeight !== undefined && byeWeight < playoffWeight - 0.005
            ? ` (round 1 at ${pct(byeWeight)}: you may have a bye)`
            : ''}
          {o.bracket
            ? o.bracket.state.alive.has(me.rosterId)
              ? '. In the playoffs, each round you could still play counts in full'
              : ". You're out of the title race, so later weeks count for nothing"
            : ''}
          .
        </p>
        <MissingWeeks season={season} />
        <table class="table">
          <thead>
            <tr>
              <th>Player</th>
              <th class="num">Wk</th>
              <th class="num">ROS</th>
              {showBids ? <th class="num">Bid</th> : null}
              <th class="num">Adds</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((r) => (
              <tr>
                <td>
                  <PlayerCell row={r.player} now={now} extra={notes(r)} />
                </td>
                <td class="num">{r.gainThisWeek >= 0.05 ? signed(r.gainThisWeek) : '–'}</td>
                <td class="num">{r.rosGain >= 0.05 ? signed(r.rosGain) : '–'}</td>
                {showBids ? (
                  <td class="num" title={r.bid?.reason}>
                    {r.bid ? money(r.bid.bid) : '–'}
                  </td>
                ) : null}
                <td class="num">{r.trendingAdds ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {showBids ? (
          <p class="muted small">
            FAAB: you have {money(board.remaining!)} of {money(budget)} left.{' '}
            {board.market
              ? `Bids follow what this league paid at each position (${board.market.claims} winning claims this season; RB top add ≈ ${money(marketPrice(board.market, 'RB', 0))}, WR ≈ ${money(marketPrice(board.market, 'WR', 0))}), scaled by your budget against the league's. Under +2 ROS, bid the minimum.`
              : 'Not enough winning claims yet to price bids.'}
          </p>
        ) : null}
      </div>
      <Handcuffs bundle={bundle} outlook={o} />
      <IrStashCard bundle={bundle} outlook={o} />
      <Streamers bundle={bundle} outlook={o} now={now} />
    </div>
  );
}

/** Waiver claims in order, with drops, backups and bids (analysis/claims.ts). */
function ClaimPlanCard({ bundle, outlook, plan, bids }: { bundle: LeagueBundle; outlook: LeagueOutlook; plan: readonly Claim[]; bids: boolean }) {
  if (!plan.length) return null;
  const player = (id: string) => bundle.ctx.players.get(id) ?? outlook.model.player(id);
  const name = (id: string) => player(id)?.name ?? id;
  const tag = (id: string) => {
    const p = player(id);
    return p ? `${p.pos}${p.team ? `·${p.team}` : ''}` : '';
  };
  const bid = (b: number | undefined) => (bids && b !== undefined ? ` · bid ${money(b)}` : '');
  return (
    <div class="card">
      <h2>Claim plan</h2>
      <ol class="claims">
        {plan.map((c) => (
          <li>
            Add <strong>{name(c.add)}</strong> <span class="muted small">{tag(c.add)}</span>
            {c.drop ? (
              <>
                , drop <strong>{name(c.drop)}</strong>
              </>
            ) : (
              ' into an open spot'
            )}
            {bid(c.bid)}
            <div class="muted small">
              {signed(c.rosGain)} over the rest of the season{c.now >= 0.05 ? `, ${signed(c.now)} this week` : ''}
            </div>
            {c.backup ? (
              <div class="small">
                If that fails: <strong>{name(c.backup.add)}</strong> <span class="muted small">{tag(c.backup.add)}</span>, same drop{bid(c.backup.bid)}{' '}
                <span class="muted small">({signed(c.backup.rosGain)})</span>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <p class="muted small">
        Each claim assumes the ones above it went through: its drop{bids ? ' and bid come from the roster and budget' : ' comes from the roster'} they&apos;d
        leave. A backup uses the same drop, so once that player is gone it can&apos;t go through: it lands only if the claim above it fails.
        {bids ? ' A backup never bids more than its claim.' : ''}
      </p>
    </div>
  );
}

/** The next man up behind your QB and RB starters, and what he's worth as insurance (analysis/handcuffs.ts). */
function Handcuffs({ bundle, outlook }: { bundle: LeagueBundle; outlook: LeagueOutlook }) {
  const rows = useMemo(() => handcuffs(outlook, bundle.myRoster!.rosterId, bundle.ctx.players), [bundle, outlook]);
  if (!rows.length) return null;
  const player = (id: string) => bundle.ctx.players.get(id) ?? outlook.model.player(id);
  const name = (id: string) => player(id)?.name ?? id;
  const held = (h: Handcuff) => (h.owner === 'mine' ? 'yours' : h.owner === 'free' ? 'a free agent' : `on ${outlook.teams.get(h.owner)?.name ?? 'another team'}`);
  const miss = rows.reduce((s, h) => s + h.missChance, 0) / rows.length;
  return (
    <div class="card">
      <h2>Handcuffs</h2>
      <ul class="handcuffs">
        {rows.map((h) => (
          <li>
            <strong>{name(h.starter)}</strong> <span class="muted small">{player(h.starter)?.pos}</span> → <strong>{name(h.backup)}</strong>, {held(h)}. If{' '}
            {name(h.starter)} misses a week, {name(h.backup)} projects {pts(h.elevated)} instead of {pts(h.normal)}. Insurance:{' '}
            <strong>{signed(h.bonus)}</strong> over the rest of the season{h.owner === 'free' || h.owner === 'mine' ? '' : ' if you traded for him'}.
          </li>
        ))}
      </ul>
      <p class="muted small">
        Next man up: the depth chart&apos;s No. 2 behind your regular QB and RB starters. In 2019–2025 games a starter sat, his backup gained 76% (QBs)
        or 40% (RBs) of the starter&apos;s points on top of his own; TE and WR backups gained less, and not reliably, so they aren&apos;t listed.
        Insurance: each week ahead, the chance the starter misses it (about {pct(miss)} a week on average) times what the backup adds to that
        week&apos;s best lineup beyond your bench and the best free agent at the position, who you could add instead. Compare it with the ROS
        values above.
      </p>
    </div>
  );
}

/** Injured free agents who could fill an open IR slot now and help later (analysis/irStash.ts). */
function IrStashCard({ bundle, outlook }: { bundle: LeagueBundle; outlook: LeagueOutlook }) {
  const stash = useMemo(() => irStash(outlook, bundle.myRoster!.rosterId, bundle.ctx.players), [bundle, outlook]);
  if (!stash.openSlots || !stash.rows.length) return null;
  const player = (id: string) => bundle.ctx.players.get(id) ?? outlook.model.player(id);
  const playoffs = stash.rows.some((r) => r.playoffGain > 0);
  return (
    <div class="card">
      <h2>IR stash</h2>
      <p class="muted small">
        You have {stash.openSlots} open IR slot{stash.openSlots > 1 ? 's' : ''}. Injured free agents who can go straight into one, by what they add once
        they&apos;re back:
      </p>
      <table class="table stash">
        <thead>
          <tr>
            <th>Player</th>
            <th class="num">Back</th>
            <th class="num">ROS</th>
            {playoffs ? <th class="num">Playoffs</th> : null}
          </tr>
        </thead>
        <tbody>
          {stash.rows.map((r) => {
            const p = player(r.id);
            return (
              <tr>
                <td>
                  <strong>{p?.name ?? r.id}</strong>{' '}
                  <span class="muted small">
                    {p?.pos}
                    {p?.team ? `·${p.team}` : ''}
                  </span>
                  <div class="muted small">
                    {p?.injury}
                    {p?.injuryBody ? ` (${p.injuryBody})` : ''} · {pts(r.perWeek)} a game when back
                  </div>
                </td>
                <td class="num">wk {r.back}</td>
                <td class="num">{signed(r.gain)}</td>
                {playoffs ? <td class="num">{signed(r.playoffGain)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="muted small">
        Back: the first week Sleeper projects him again. ROS: what he adds to your best lineups from then on, playoff weeks counted at your playoff
        odds{playoffs ? '; Playoffs: the part from playoff weeks' : ''}. On IR he takes no bench spot; he&apos;ll need one when he comes back.
      </p>
    </div>
  );
}

function Streamers({ bundle, outlook, now }: { bundle: LeagueBundle; outlook: LeagueOutlook; now: number }) {
  const lists = (['DEF', 'K'] as const).map((pos) => ({ pos, rows: streamers(outlook, bundle.myRoster!, bundle.ctx, pos) })).filter((l) => l.rows.length);
  if (!lists.length) return null;
  const next = outlook.weeks.slice(0, 2);
  return (
    <div class="card">
      <h2>Streaming</h2>
      <p class="muted small">Your DEF/K and the best free agents, by this week and the next {next.length}.</p>
      {lists.map(({ pos, rows }) => (
        <table class="table stream">
          <thead>
            <tr>
              <th>{pos}</th>
              <th class="num">Wk {bundle.week}</th>
              {next.map((w) => (
                <th class="num">Wk {w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr class={r.mine ? 'mine' : ''}>
                <td>
                  <PlayerCell row={r.player} now={now} extra={r.mine ? 'yours' : undefined} />
                </td>
                <td class="num">{r.player.locked ? 'locked' : pts(r.player.ev)}</td>
                {r.next.map((v) => (
                  <td class="num" title={v ? undefined : 'No projection (bye or not expected to play)'}>
                    {v ? pts(v) : '–'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

// ---- Season --------------------------------------------------------------------------------------

export function SeasonTab({ bundle }: { bundle: LeagueBundle }) {
  const s = useAsync(() => loadSeason(bundle), [bundle]);
  if (s.error) return <ErrorBox error={s.error} />;
  if (!s.data) return <Spinner label="Simulating the rest of the season…" />;
  const o = s.data.outlook;
  const myId = bundle.myRoster!.rosterId;
  const rules = bundle.league.rules;
  const playoffs = !!rules.playoffWeekStart;
  const byes = playoffs && (o.odds ? [...o.odds.values()].some((x) => x.pBye > 0) : false);
  const titles = playoffs && (o.odds ? [...o.odds.values()].some((x) => x.pTitle !== undefined) : false);
  const teams = [...o.teams.values()].sort(
    (a, b) =>
      (o.odds?.get(a.rosterId)?.avgSeed ?? 0) - (o.odds?.get(b.rosterId)?.avgSeed ?? 0) ||
      b.roster.wins - a.roster.wins ||
      b.roster.pointsFor - a.roster.pointsFor,
  );
  return (
    <div class="stack">
      <GradesCard bundle={bundle} o={o} />
      <div class="card">
        <h2>Standings outlook</h2>
        {!o.odds ? <p class="muted small">The regular season is over{o.bracket ? '; the playoffs are below' : ''}.</p> : null}
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Team</th>
                <th class="num">
                  W-L<span class="phone-only">PF</span>
                </th>
                <th class="num wide-only">PF</th>
                {o.odds ? <th class="num">Proj</th> : null}
                {o.odds && playoffs ? <th class="num">Playoffs</th> : null}
                {o.odds && byes ? <th class="num">Bye</th> : null}
                {o.odds ? <th class="num">1st</th> : null}
                {titles ? <th class="num">Title</th> : null}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => {
                const odds = o.odds?.get(t.rosterId);
                const r = t.roster;
                return (
                  <tr class={t.rosterId === myId ? 'mine' : ''}>
                    <td>{t.name}</td>
                    <td class="num">
                      {r.wins}-{r.losses}
                      {r.ties ? `-${r.ties}` : ''}
                      <span class="phone-only">{Math.round(r.pointsFor)}</span>
                    </td>
                    <td class="num wide-only">{Math.round(r.pointsFor)}</td>
                    {odds ? (
                      <td class="num">
                        {odds.expWins.toFixed(1)}-{odds.expLosses.toFixed(1)}
                      </td>
                    ) : null}
                    {odds && playoffs ? <td class="num">{pct(odds.pPlayoffs)}</td> : null}
                    {odds && byes ? <td class="num">{pct(odds.pBye)}</td> : null}
                    {odds ? <td class="num">{pct(odds.pFirst)}</td> : null}
                    {titles ? <td class="num">{pct(odds?.pTitle)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {o.odds ? (
          <p class="muted small">
            {o.sims.toLocaleString()} simulations of {weekSpan(o.regularWeeks)}
            {rules.medianGame ? ' (head-to-head plus the league-median game)' : ''}: every team plays its best projected lineup each week, and can
            drift from its projection as the season goes on, as much as teams did in 2022–25 (injuries, role changes, pickups); ties go to points
            for.
            {playoffs ? ` Top ${rules.playoffTeams} make the playoffs.` : ' This league has no playoffs.'}
            {titles
              ? ` Title odds play the bracket out the same way${byes ? ', top seeds on byes' : ''}${rules.playoffSeedType === 1 ? ', re-seeded each round' : ''}.`
              : ''}{' '}
            Trades and pickups aren't predicted.
          </p>
        ) : null}
        <MissingWeeks season={s.data} />
      </div>
      {o.bracket ? <BracketCard o={o} myId={myId} /> : null}
      <WeeksAheadCard bundle={bundle} o={o} />
      <SeasonSoFarCard bundle={bundle} />
      {bundle.league.rules.type !== 'redraft' ? <LongTermCard bundle={bundle} season={s.data} /> : null}
    </div>
  );
}

const oddsName = (g: LeagueGrades) => (g.odds === 'title' ? 'Title' : g.odds === 'first' ? '1st' : 'Playoffs');
const PART_SHORT: Record<Part, string> = { week: 'Week', ros: 'ROS', depth: 'Depth', odds: 'Odds' };
const PART_LONG: Record<Part, string> = { week: "this week's lineup", ros: 'rest of the season', depth: 'bench depth', odds: 'odds' };

/** Every team graded S–F against the rest of the league, overall and on each part (analysis/grades.ts). */
function GradesCard({ bundle, o }: { bundle: LeagueBundle; o: LeagueOutlook }) {
  const grades = useMemo(() => leagueGrades(o, bundle.data.matchups, bundle.ctx), [o, bundle]);
  if (!grades) return null;
  const myId = bundle.myRoster?.rosterId;
  const odds = oddsName(grades);
  const short = (p: Part) => (p === 'odds' ? odds : PART_SHORT[p]);
  const long = (p: Part) => (p === 'odds' ? (grades.odds === 'title' ? 'title odds' : grades.odds === 'first' ? '1st-place odds' : 'playoff odds') : PART_LONG[p]);
  const value = (p: Part, v: number) => (p === 'odds' ? pct(v) : p === 'depth' ? signed(v) : v.toFixed(0));
  const mine = grades.teams.find((t) => t.rosterId === myId);
  const n = grades.teams.length;
  const byZ = mine ? grades.parts.map((p) => [p, mine.parts[p]!] as const).sort((a, b) => b[1].z - a[1].z) : [];
  const best = byZ[0];
  const worst = byZ.at(-1);
  const weights = grades.parts
    .map((p) => [p, GRADE_WEIGHTS[p]] as const)
    .sort((a, b) => b[1] - a[1])
    .map(([p, w]) => `${long(p)} ${Math.round((100 * w) / grades.parts.reduce((s, q) => s + GRADE_WEIGHTS[q], 0))}%`)
    .join(', ');
  return (
    <div class="card">
      <h2>Team grades</h2>
      {mine && best && worst ? (
        <p>
          Your team: <GradeMark grade={mine.grade} /> ({ordinal(mine.rank)} of {n}). Highest grade: {long(best[0])} (<GradeMark grade={best[1].grade} />,{' '}
          {ordinal(best[1].rank)})
          {worst[0] !== best[0] ? (
            <>
              ; lowest: {long(worst[0])} (<GradeMark grade={worst[1].grade} />, {ordinal(worst[1].rank)})
            </>
          ) : null}
          .
        </p>
      ) : null}
      <div class="table-wrap">
        <table class="table grades">
          <thead>
            <tr>
              <th>Team</th>
              <th class="num">Grade</th>
              {grades.parts.map((p) => (
                <th class="num">{short(p)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grades.teams.map((t) => (
              <tr class={t.rosterId === myId ? 'mine' : ''}>
                <td>{o.teams.get(t.rosterId)?.name ?? t.rosterId}</td>
                <td class="num">
                  <GradeMark grade={t.grade} />
                </td>
                {grades.parts.map((p) => {
                  const g = t.parts[p]!;
                  return (
                    <td class="num">
                      <GradeMark grade={g.grade} />
                      <span class="grade-value">{value(p, g.value)}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p class="muted small">
        Each team against the rest of this league: S stands clearly above the rest, and A to F step half a standard deviation from the league
        average. {grades.parts.includes('week') ? 'Week: this week’s best lineup, in expected points (points already scored count). ' : ''}
        {grades.parts.includes('ros') ? 'ROS: the best lineup’s points per week over the rest of the season, with byes and injury chances. ' : ''}
        {grades.parts.includes('depth') ? 'Depth: points per week the bench adds by covering byes and injuries. ' : ''}
        {odds}: {grades.odds === 'title' ? 'title odds from the bracket below' : `${long('odds')} from the simulation below`}. Overall weighs {weights}.
      </p>
    </div>
  );
}

/** In the playoffs: Sleeper's bracket as it stands, this round's games, and title odds from playing out the rest. */
function BracketCard({ o, myId }: { o: LeagueOutlook; myId: number }) {
  const { state, odds, seeds } = o.bracket!;
  const name = (id: number | null) => (id === null ? 'TBD' : (o.teams.get(id)?.name ?? '?'));
  const current = state.games.filter((g) => g.round === state.currentRound);
  const alive = [...state.alive].sort((a, b) => (odds.get(b)?.pTitle ?? 0) - (odds.get(a)?.pTitle ?? 0) || (seeds.get(a) ?? 99) - (seeds.get(b) ?? 99));
  const out = [...state.outIn].sort((a, b) => b[1] - a[1] || (seeds.get(a[0]) ?? 99) - (seeds.get(b[0]) ?? 99));
  if (state.champion !== undefined) {
    return (
      <div class="card">
        <h2>Champion: {name(state.champion)}</h2>
        <p class="muted small">From Sleeper's bracket.</p>
      </div>
    );
  }
  return (
    <div class="card">
      <h2>Playoffs: {roundName(state.currentRound, state.rounds)}</h2>
      <table class="table">
        <thead>
          <tr>
            <th>Team</th>
            <th>This round</th>
            <th class="num">Win it</th>
            <th class="num">Title</th>
          </tr>
        </thead>
        <tbody>
          {alive.map((id) => {
            const x = odds.get(id);
            const game = current.find((g) => g.teams.includes(id));
            const opp = game?.teams.find((t) => t !== id) ?? null;
            return (
              <tr class={id === myId ? 'mine' : ''}>
                <td>
                  {name(id)} <span class="muted small">#{seeds.get(id)}</span>
                </td>
                <td>{!game ? 'bye' : game.winner !== null ? (game.winner === id ? 'won' : 'lost') : `vs ${name(opp)}`}</td>
                <td class="num">{game ? pct(x?.pWin[state.currentRound - 1]) : '–'}</td>
                <td class="num">{pct(x?.pTitle)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {out.length ? <p class="muted small">Out: {out.map(([id, r]) => `${name(id)} (${roundName(r, state.rounds)})`).join(', ')}.</p> : null}
      <p class="muted small">
        From Sleeper's bracket: {o.sims.toLocaleString()} simulations of the games left. Each team scores its final points for weeks already
        played, its set lineup this week (points so far included), then its best projected lineups, which can drift as in the regular season. A
        tied game goes to the better seed (#: regular-season finish by record, then points for).
      </p>
    </div>
  );
}

/** Keeper and dynasty leagues: who's built for beyond this season, and which of your players (and picks) carry forward. */
function LongTermCard({ bundle, season }: { bundle: LeagueBundle; season: SeasonBundle }) {
  const outlook = season.outlook;
  const lt = useAsync(() => loadMarketValues(marketParams(bundle.league, 'long')), [bundle.league.id]);
  if (lt.data === undefined) return lt.error ? null : <Spinner label="Loading long-term values…" />;
  if (!lt.data) return <p class="muted small">Long-term values unavailable (FantasyCalc didn't respond).</p>;
  const values = lt.data.players;
  const keep = carriedForward(bundle.league);
  const rosters = [...outlook.teams.values()].map((t) => t.roster);
  const picks = season.tradedPicks ? pickAssets(bundle.league, rosters, season.tradedPicks, lt.data.picks, outlook.odds) : null;
  const ranking = longTermRanking(rosters, values, keep, picks ? pickTotals(picks) : undefined);
  // This season: average best-lineup points over the remaining regular season (no ranking once it's over).
  const showNow = outlook.regularWeeks.length > 0;
  const nowScore = (rosterId: number) => {
    const t = outlook.teams.get(rosterId);
    const weeks = t?.future.slice(0, Math.max(1, outlook.regularWeeks.length)) ?? [];
    return weeks.length ? weeks.reduce((a, d) => a + d.mean, 0) / weeks.length : 0;
  };
  const nowRank = new Map([...rosters].sort((a, b) => nowScore(b.rosterId) - nowScore(a.rosterId)).map((r, i) => [r.rosterId, i + 1]));
  const myId = bundle.myRoster!.rosterId;
  const mine = ranking.find((t) => t.rosterId === myId);
  const name = (id: string) => bundle.ctx.players.get(id)?.name ?? outlook.model.player(id)?.name ?? id;
  const pos = (id: string) => bundle.ctx.players.get(id)?.pos ?? '';
  const myPicks = (picks ?? []).filter((p) => p.ownerRosterId === myId && p.valued).sort((a, b) => b.value - a.value);
  const n = rosters.length;
  const outlookOf = (rid: number) => {
    const now = nowRank.get(rid)! <= n / 2;
    const later = ranking.find((t) => t.rosterId === rid)!.rank <= n / 2;
    return now && later ? 'strong both' : now ? 'win now' : later ? 'built for later' : 'rebuild';
  };
  return (
    <div class="card">
      <h2>Long-term outlook</h2>
      <p class="muted small">
        {keep === undefined ? `Whole rosters${picks ? ' and draft picks' : ''}` : `Each team's best ${keep} keeper${keep > 1 ? 's' : ''}`} valued with
        FantasyCalc dynasty values, a proxy for worth beyond this season
        {bundle.league.rules.type === 'keeper' ? ' (keeper costs aren’t in Sleeper’s data, so they aren’t counted)' : ''}.
        {showNow ? ' “Now” ranks projected lineup strength for the rest of the regular season.' : ''}
      </p>
      {season.tradedPicks === null ? <p class="note">Draft picks didn't load from Sleeper, so they aren't counted.</p> : null}
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Team</th>
              <th class="num">Value</th>
              {picks ? <th class="num">Picks</th> : null}
              <th class="num">Later</th>
              {showNow ? <th class="num">Now</th> : null}
              {showNow ? <th>Outlook</th> : null}
            </tr>
          </thead>
          <tbody>
            {ranking.map((t) => (
              <tr class={t.rosterId === myId ? 'mine' : ''}>
                <td>{outlook.teams.get(t.rosterId)?.name ?? t.rosterId}</td>
                <td class="num">{shortValue(t.total)}</td>
                {picks ? <td class="num">{shortValue(t.picks)}</td> : null}
                <td class="num">{t.rank}</td>
                {showNow ? <td class="num">{nowRank.get(t.rosterId)}</td> : null}
                {showNow ? <td class="muted small">{outlookOf(t.rosterId)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {mine?.core.length ? (
        <>
          <h3>{keep === undefined ? 'Your most valuable players' : 'Your likely keepers'}</h3>
          <ol class="core">
            {mine.core.slice(0, keep ?? 8).map((p) => (
              <li>
                <strong>{name(p.id)}</strong> <span class="muted small">{pos(p.id)}{p.age !== undefined ? ` · age ${Math.floor(p.age)}` : ''}</span>
                <span class="num muted small">{shortValue(p.value)}</span>
              </li>
            ))}
          </ol>
        </>
      ) : null}
      {myPicks.length ? (
        <p class="small">
          <strong>Your picks:</strong> {myPicks.map((p) => `${pickLabel(p)}${p.originalRosterId !== myId ? ` (${outlook.teams.get(p.originalRosterId)?.name ?? 'other'})` : ''} ${shortValue(p.value)}`).join(' · ')}
        </p>
      ) : null}
      <p class="muted small">
        {picks ? `${PICK_NOTE} ` : ''}Values from{' '}
        <a href={FANTASYCALC_URL} target="_blank" rel="noopener">
          FantasyCalc
        </a>
        .
      </p>
    </div>
  );
}

// ---- Trade ---------------------------------------------------------------------------------------

export function TradeTab({ bundle }: { bundle: LeagueBundle }) {
  const s = useAsync(() => loadSeason(bundle), [bundle]);
  if (s.error) return <ErrorBox error={s.error} />;
  if (!s.data) return <Spinner label="Loading rest-of-season values…" />;
  return <TradeBuilder bundle={bundle} season={s.data} />;
}

/** Points threshold (weighted rest-of-season) for calling a trade a win or a loss. [design] */
const TRADE_EDGE = 5;

function TradeBuilder({ bundle, season }: { bundle: LeagueBundle; season: SeasonBundle }) {
  const o = season.outlook;
  const myId = bundle.myRoster!.rosterId;
  const partners = useMemo(() => [...o.teams.values()].filter((t) => t.rosterId !== myId).sort((a, b) => a.name.localeCompare(b.name)), [o, myId]);
  const [partnerId, setPartnerId] = useState(partners[0]?.rosterId ?? -1);
  const [give, setGive] = useState<string[]>([]);
  const [get, setGet] = useState<string[]>([]);
  const [givePicks, setGivePicks] = useState<string[]>([]);
  const [getPicks, setGetPicks] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const market = useAsync(async () => {
    const hs = horizons(bundle.league);
    const loaded = await Promise.all(hs.map((h) => loadMarketValues(marketParams(bundle.league, h))));
    return hs.flatMap((h, i) => (loaded[i] ? [{ horizon: h, values: loaded[i]! }] : []));
  }, [bundle.league.id]);
  const markets = market.data ?? [];
  const values = markets.find((m) => m.horizon === 'season')?.values.players ?? null;
  const longMarket = markets.find((m) => m.horizon === 'long')?.values ?? null;
  const longValues = longMarket?.players ?? null;
  // The market a league's managers trade on: dynasty values in dynasty leagues, this season's otherwise.
  const tradeMarket = bundle.league.rules.type === 'dynasty' ? (longValues ?? values) : values;
  // Dynasty leagues: every team's future picks, valued on the long-term market once it loads.
  const picks = useMemo(
    () => (season.tradedPicks ? pickAssets(bundle.league, [...o.teams.values()].map((t) => t.roster), season.tradedPicks, longMarket?.picks ?? new Map(), o.odds) : []),
    [bundle.league, o, season.tradedPicks, longMarket],
  );
  const picksOf = (rosterId: number) =>
    picks.filter((p) => p.ownerRosterId === rosterId).sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round || b.value - a.value);
  const chosen = (keys: string[]) => picks.filter((p) => keys.includes(p.key));
  const anyPicks = givePicks.length + getPicks.length > 0;
  const result = useMemo(
    () => (partnerId >= 0 && (give.length || get.length) ? evaluateTrade(o, bundle.ctx, myId, partnerId, give, get) : null),
    [o, bundle.ctx, myId, partnerId, give, get],
  );
  const deadline = bundle.league.rules.tradeDeadline;
  const passed = deadline !== undefined && deadline > 0 && bundle.week > deadline;
  const perWeek = (id: string) => (o.weeks.length ? o.model.total(id) / o.weeks.length : 0);
  const name = (id: string) => o.model.player(id)?.name ?? bundle.ctx.players.get(id)?.name ?? id;
  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const roster = (rosterId: number) =>
    [...(o.teams.get(rosterId)?.roster.players ?? [])].filter((id) => !o.teams.get(rosterId)!.roster.taxi.includes(id)).sort((a, b) => perWeek(b) - perWeek(a));

  // A render helper, not a component: a component defined here would remount (and drop focus) on every render.
  const picker = (title: string, rosterId: number, picked: string[], onPick: (id: string) => void, pickedPicks: string[], onPickPick: (key: string) => void) => (
    <fieldset class="picker">
      <legend>{title}</legend>
      {roster(rosterId).map((id) => {
        const p = o.model.player(id) ?? bundle.ctx.players.get(id);
        return (
          <label class={picked.includes(id) ? 'picked' : ''}>
            <input type="checkbox" checked={picked.includes(id)} onChange={() => onPick(id)} />
            <span>
              {name(id)} <span class="muted small">{p ? `${p.pos}${p.team ? `·${p.team}` : ''}` : ''}</span>
            </span>
            <span class="muted small num">
              {pts(perWeek(id))}/wk
              {values?.get(id) ? <span class="mv"> · {shortValue(values.get(id)!.value)}</span> : null}
              {longValues?.get(id) ? <span class="mv"> · LT {shortValue(longValues.get(id)!.value)}</span> : null}
            </span>
          </label>
        );
      })}
      {picksOf(rosterId).length ? <p class="muted small picks-head">Draft picks</p> : null}
      {picksOf(rosterId).map((p) => (
        <label class={pickedPicks.includes(p.key) ? 'picked' : ''}>
          <input type="checkbox" checked={pickedPicks.includes(p.key)} onChange={() => onPickPick(p.key)} />
          <span>
            {pickLabel(p)}{' '}
            <span class="muted small">
              {p.originalRosterId === rosterId ? 'own' : (o.teams.get(p.originalRosterId)?.name ?? 'other team')}
              {p.tier ? ` · proj. ${p.tier}` : ''}
            </span>
          </span>
          <span class="muted small num">{p.valued ? <span class="mv">LT {shortValue(p.value)}</span> : '–'}</span>
        </label>
      ))}
    </fieldset>
  );

  const open = (partner: number, giving: string[], getting: string[]) => {
    setPartnerId(partner);
    setGive(giving);
    setGet(getting);
    setGivePicks([]);
    setGetPicks([]);
    document.getElementById('trade-builder')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div class="stack">
      {passed ? <p class="note">This league's trade deadline (week {deadline}) has passed.</p> : null}
      {passed ? null : <TradeIdeas bundle={bundle} o={o} values={values} name={name} onOpen={(idea) => open(idea.partner, idea.give, idea.get)} />}
      {passed ? null : (
        <BuyLowSellHigh
          bundle={bundle}
          o={o}
          name={name}
          onBuy={(p) => open(p.rosterId, [], [p.id])}
          onSell={(p) => open(partnerId, [p.id], [])}
          onPrice={(p) => {
            setTarget(p.id);
            document.getElementById('what-it-takes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
        />
      )}
      {passed ? null : (
        <WhatItTakes
          bundle={bundle}
          o={o}
          market={tradeMarket}
          name={name}
          target={target}
          onTarget={setTarget}
          onOpen={(p) => open(p.partner, p.give, p.get)}
        />
      )}
      <div class="card" id="trade-builder">
        <h2>Build a trade</h2>
        <label class="field">
          <span class="muted small">Trade with</span>
          <select
            value={partnerId}
            onChange={(e) => {
              setPartnerId(Number((e.target as HTMLSelectElement).value));
              setGet([]);
              setGetPicks([]);
            }}
          >
            {partners.map((t) => (
              <option value={t.rosterId}>{t.name}</option>
            ))}
          </select>
        </label>
        <p class="muted small">
          Expected points per week over {weekSpan(o.weeks)} on their own{values ? ', then FantasyCalc market value' : ''}
          {longValues ? ' and long-term (LT, dynasty) value' : ''}. The verdict below accounts for each lineup
          {picks.length ? '; draft picks only carry long-term value' : ''}.
        </p>
        {season.tradedPicks === null ? <p class="note">Draft picks didn't load from Sleeper.</p> : null}
        <div class="pickers">
          {picker('You give', myId, give, (id) => toggle(give, setGive, id), givePicks, (k) => toggle(givePicks, setGivePicks, k))}
          {picker('You get', partnerId, get, (id) => toggle(get, setGet, id), getPicks, (k) => toggle(getPicks, setGetPicks, k))}
        </div>
      </div>
      {result || anyPicks ? (
        <div class="card" aria-live="polite">
          {result ? (
            <>
              <h2>{verdict(result.me.delta, result.them.delta)}</h2>
              <TradeSide label="You" side={result.me} name={name} />
              <TradeSide label={result.them.name} side={result.them} name={name} />
            </>
          ) : (
            <h2>Picks only: no change to this season's lineups</h2>
          )}
          {markets.length ? <MarketLine markets={markets} give={give} get={get} picks={{ give: chosen(givePicks), get: chosen(getPicks) }} /> : null}
          {result ? (
            <>
              <WeeklyBars weeks={o.weeks} deltas={result.me.weekly} />
              <p class="muted small">
                Rest-of-season points from each team's best lineup by week (
                {o.bracket
                  ? 'in the playoffs, each round a team could still play counts in full, and a team that is out counts nothing'
                  : "playoff weeks weighted by that team's playoff odds, a first-round bye week by its chance of playing it"}
                ), including the drops a full roster forces. A spot the trade opens isn't filled from free agency, since you could make that pickup
                anyway. Ranges allow for players' weekly swings and
                season-long misses of their projections (sized on 2022–25). Title odds play out {o.bracket ? "Sleeper's bracket from here" : 'the bracket'};
                changes of a point or less can be simulation noise.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
      {result ? (
        <div class="card">
          <h2>Your weeks after the trade</h2>
          <ByeGrid weeks={result.me.byes} name={name} incoming={new Set(get)} />
        </div>
      ) : anyPicks ? null : (
        <p class="muted small">Pick players{picks.length ? ' or draft picks' : ''} on either side to see how the trade changes both teams.</p>
      )}
      <MissingWeeks season={season} />
    </div>
  );
}

function verdict(me: number, them: number): string {
  const mine = me >= TRADE_EDGE ? 'Good for you' : me <= -TRADE_EDGE ? 'Bad for you' : 'About even for you';
  const theirs = them >= TRADE_EDGE ? 'and good for them' : them <= -TRADE_EDGE ? 'but bad for them — expect a no' : 'and about even for them';
  return `${mine}, ${theirs}`;
}

/** "playoff odds 87% → 88% · title odds 12% → 13%", or chance of 1st in leagues without playoffs. */
function oddsText(side: TradeSideResult): string {
  return [
    side.pBefore !== undefined
      ? `playoff odds ${pct(side.pBefore)} → ${pct(side.pAfter)}`
      : side.firstBefore !== undefined
        ? `chance of 1st ${pct(side.firstBefore)} → ${pct(side.firstAfter)}`
        : '',
    side.titleBefore !== undefined ? `title odds ${pct(side.titleBefore)} → ${pct(side.titleAfter)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

type MarketValues = ReadonlyMap<string, { value: number }> | null;

/** Trade ideas: a search for trades that improve both teams' best lineups over the rest of the season. */
function TradeIdeas({
  bundle,
  o,
  values,
  name,
  onOpen,
}: {
  bundle: LeagueBundle;
  o: LeagueOutlook;
  values: MarketValues;
  name: (id: string) => string;
  onOpen: (idea: TradeIdea) => void;
}) {
  const [state, setState] = useState<{ running: boolean; done: number; total: number; ideas?: TradeIdea[]; error?: string }>({ running: false, done: 0, total: 0 });
  const myId = bundle.myRoster!.rosterId;
  const run = async () => {
    setState({ running: true, done: 0, total: o.teams.size - 1 });
    try {
      const ideas = await findTrades(o, bundle.ctx, myId, { onProgress: (done, total) => setState((s) => ({ ...s, done, total })) });
      setState({ running: false, done: 0, total: 0, ideas });
    } catch (e) {
      logError(e);
      setState({ running: false, done: 0, total: 0, error: e instanceof Error ? e.message : String(e) });
    }
  };
  const market = (ids: readonly string[]) => ids.reduce((a, id) => a + (values?.get(id)?.value ?? 0), 0);
  const list = (ids: readonly string[]) => ids.map(name).join(' + ');
  return (
    <div class="card ideas">
      <h2>Trade ideas</h2>
      <p class="muted small">
        Trades that improve both your best lineups and theirs over {weekSpan(o.weeks)}: one for one, or two for one either way, among each team's
        8 most valuable QBs, RBs, WRs and TEs. Best for you first.
      </p>
      {state.ideas === undefined ? (
        <button type="button" class="btn" onClick={run} disabled={state.running}>
          {state.running ? `Searching… ${state.done}/${state.total} teams` : 'Find trades'}
        </button>
      ) : null}
      {state.error ? <p class="note">The search failed: {state.error}</p> : null}
      {state.ideas && !state.ideas.length ? <p>No trade found that helps both lineups by enough to matter.</p> : null}
      {state.ideas?.length ? (
        <ol class="idea-list">
          {state.ideas.map((idea) => {
            const them = o.teams.get(idea.partner)?.name ?? '?';
            const me = idea.result.me;
            const odds = oddsText(me);
            const [give, get] = [market(idea.give), market(idea.get)];
            return (
              <li>
                <p>
                  Give <strong>{list(idea.give)}</strong> for <strong>{list(idea.get)}</strong> <span class="muted">({them})</span>
                </p>
                <p class="small">
                  <span class="good">You {signed(idea.mine)} pts</span>
                  {me.range ? ` (80%: ${signed(me.range[0])} to ${signed(me.range[1])})` : ''} · them {signed(idea.theirs)} pts
                  {odds ? ` · your ${odds}` : ''}
                </p>
                {values && give && get ? (
                  <p class="muted small">
                    Market value: you give {shortValue(give)}, you get {shortValue(get)}
                    {get > give * LOPSIDED ? ' (they may see it as lopsided)' : ''}
                  </p>
                ) : null}
                <button type="button" class="btn btn-small" onClick={() => onOpen(idea)}>
                  Open in the builder
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
      {state.ideas ? (
        <p class="muted small">
          Lineup math only: whether they say yes also depends on how they rank players. Ranges are wide because a season of points is
          uncertain; open a trade for its odds, byes and drops.{' '}
          <button type="button" class="link" onClick={run} disabled={state.running}>
            Search again
          </button>
        </p>
      ) : null}
    </div>
  );
}

/** Your players running hot and other teams' running cold who'd start for you (docs/luck.md). Values don't change. */
function BuyLowSellHigh({
  bundle,
  o,
  name,
  onBuy,
  onSell,
  onPrice,
}: {
  bundle: LeagueBundle;
  o: LeagueOutlook;
  name: (id: string) => string;
  onBuy: (pick: StreakPick) => void;
  onSell: (pick: StreakPick) => void;
  onPrice: (pick: StreakPick) => void;
}) {
  const usage = bundle.ctx.usage?.players;
  const myId = bundle.myRoster!.rosterId;
  // Nothing to say until the usage file carries points against usage.
  const picks = useMemo(() => (usage && [...usage.values()].some((u) => u.luck) ? buyLowSellHigh(o, myId, usage) : null), [o, myId, usage]);
  if (!picks) return null;
  const list = (rows: readonly StreakPick[], buying: boolean) =>
    rows.length ? (
      <ul class="streak-list">
        {rows.map((p) => {
          const pl = o.model.player(p.id) ?? bundle.ctx.players.get(p.id);
          const s = p.streak;
          return (
            <li>
              <p>
                <strong>{name(p.id)}</strong>{' '}
                <span class="muted small">
                  {pl ? `${pl.pos}${pl.team ? `·${pl.team}` : ''}` : ''}
                  {buying ? ` · ${o.teams.get(p.rosterId)?.name ?? 'other team'}` : ''}
                </span>
              </p>
              <p class="small">
                {s.pts.toFixed(1)} a game over {s.games} games, usage worth {s.expected.toFixed(1)} · {touchdowns(s)} · {pts(p.perWeek)}/wk ahead
              </p>
              <button type="button" class="btn btn-small" onClick={() => (buying ? onBuy(p) : onSell(p))}>
                Open in the builder
              </button>
              {buying ? (
                <>
                  {' '}
                  <button type="button" class="btn btn-small" onClick={() => onPrice(p)}>
                    What would it take?
                  </button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    ) : (
      <p class="muted small">None right now.</p>
    );
  return (
    <div class="card streaks">
      <h2>Buy low, sell high</h2>
      <p class="muted small">
        Players whose PPR points over recent games ran {STREAK_GAP}+ a game ahead of or behind what their usage was worth (expected points from ffopportunity).
        Values here don't change: projections already price streaks in (in 2022–25 one didn't predict how players did against their projections afterwards).
        The opening is a manager who goes by recent points.
      </p>
      <h3>Sell high: yours running hot</h3>
      {list(picks.sell, false)}
      <h3>Buy low: theirs running cold who'd start for you</h3>
      {list(picks.buy, true)}
    </div>
  );
}

/** What it would take to get one player from another team: the trade finder turned around (docs/trade-finder.md). */
function WhatItTakes({
  bundle,
  o,
  market,
  name,
  target,
  onTarget,
  onOpen,
}: {
  bundle: LeagueBundle;
  o: LeagueOutlook;
  market: MarketValues;
  name: (id: string) => string;
  target: string | null;
  onTarget: (id: string | null) => void;
  onOpen: (p: TargetPackage) => void;
}) {
  const myId = bundle.myRoster!.rosterId;
  const [state, setState] = useState<{ running: boolean; search?: TargetSearch | null; error?: string }>({ running: false });
  const perWeek = (id: string) => (o.weeks.length ? o.model.total(id) / o.weeks.length : 0);
  // Other teams' QBs, RBs, WRs and TEs, team by team, most valuable first.
  const teams = useMemo(
    () =>
      [...o.teams.values()]
        .filter((t) => t.rosterId !== myId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ team: t, ids: teamIds(t.roster).filter((id) => TRADED.has(o.model.player(id)?.pos ?? '')).sort((a, b) => o.model.total(b) - o.model.total(a)) }))
        .filter((t) => t.ids.length),
    [o, myId],
  );
  useEffect(() => {
    if (!target) {
      setState({ running: false });
      return;
    }
    let live = true;
    setState({ running: true });
    findPackages(o, bundle.ctx, myId, target, { market }).then(
      (search) => live && setState({ running: false, search }),
      (e) => {
        logError(e);
        if (live) setState({ running: false, error: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => {
      live = false;
    };
  }, [o, bundle.ctx, myId, target, market]);

  const list = (ids: readonly string[]) => ids.map(name).join(' + ');
  const marketNote = (p: TargetPackage) => {
    if (!p.market) return null;
    const { give, get, unvalued } = p.market;
    const note = get > give * LOPSIDED ? ' (they may see it as lopsided)' : give > get * LOPSIDED ? ' (well above his market value)' : '';
    return (
      <p class="muted small">
        Market value: you give {shortValue(give)}
        {unvalued ? ` (${unvalued === 1 ? 'one player has' : `${unvalued} players have`} no value)` : ''}, you get {shortValue(get)}
        {note}
      </p>
    );
  };
  const packageList = (ps: readonly TargetPackage[]) => (
    <ol class="idea-list">
      {ps.map((p) => (
        <li>
          <p>
            Give <strong>{list(p.give)}</strong>
          </p>
          <p class="small">
            <span class={p.mine >= 0 ? 'good' : 'bad'}>You {signed(p.mine)} pts</span>
            {p.result.me.range ? ` (80%: ${signed(p.result.me.range[0])} to ${signed(p.result.me.range[1])})` : ''} · them {signed(p.theirs)} pts
          </p>
          {p.result.them.drops.length ? <p class="muted small">They drop {list(p.result.them.drops)} to make room.</p> : null}
          {marketNote(p)}
          <button type="button" class="btn btn-small" onClick={() => onOpen(p)}>
            Open in the builder
          </button>
        </li>
      ))}
    </ol>
  );
  const s = state.search;
  return (
    <div class="card takes" id="what-it-takes">
      <h2>What would it take?</h2>
      <label class="field">
        <span class="muted small">Player you want</span>
        <select value={target ?? ''} onChange={(e) => onTarget((e.target as HTMLSelectElement).value || null)}>
          <option value="">Choose a player…</option>
          {teams.map(({ team, ids }) => (
            <optgroup label={team.name}>
              {ids.map((id) => (
                <option value={id}>
                  {name(id)} · {o.model.player(id)?.pos ?? ''} · {pts(perWeek(id))}/wk
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <p class="muted small">
        Packages of one or two of your QBs, RBs, WRs and TEs (your 12 most valuable) for him that improve both best lineups over {weekSpan(o.weeks)}, best for
        you first{market ? '. Ones that give his team under 1/1.4 of his market value go last' : ''}.
      </p>
      {target && s && !state.running ? (
        <p class="small">
          {s.starts === 0
            ? `${name(target)} wouldn't start for you in any week ahead.`
            : `${name(target)} would start for you in ${s.starts === s.weeks ? 'every week ahead' : `${s.starts} of the ${s.weeks} weeks ahead`}.`}
        </p>
      ) : null}
      {state.running ? <p class="muted">Searching…</p> : null}
      {state.error ? <p class="note">The search failed: {state.error}</p> : null}
      {target && s && !state.running ? (
        s.packages.length ? (
          packageList(s.packages)
        ) : s.closest.length ? (
          <>
            <p>No package helps both lineups. These help theirs at the least cost to yours:</p>
            {packageList(s.closest)}
          </>
        ) : (
          <p>No package of one or two of your players helps their lineup. It would take more, or a different position.</p>
        )
      ) : null}
      {target && s && !state.running ? (
        <p class="muted small">
          Lineup math only, as with trade ideas: whether they say yes also depends on how they rank players. A two-for-one&apos;s open spot isn&apos;t filled
          from free agency, since you could make that pickup anyway. Open a package for its odds, byes and drops.
        </p>
      ) : null}
    </div>
  );
}

function TradeSide({ label, side, name }: { label: string; side: TradeSideResult; name: (id: string) => string }) {
  const odds = oddsText(side);
  return (
    <div class="trade-side">
      <p>
        <strong>{label}:</strong>{' '}
        <span class={side.delta >= 0 ? 'good' : 'bad'}>{signed(side.delta)} pts</span> rest of season
        {odds ? ` · ${odds}` : ''}
      </p>
      {side.range ? (
        <p class="muted small">
          80% range {signed(side.range[0])} to {signed(side.range[1])} pts; {pct(side.pBetter)} chance it adds points.
        </p>
      ) : null}
      {side.drops.length ? <p class="muted small">Must drop {side.drops.map(name).join(', ')} to make room.</p> : null}
    </div>
  );
}

/** Your change in best-lineup points per week: bars up for gains, down for losses. */
function WeeklyBars({ weeks, deltas }: { weeks: readonly number[]; deltas: readonly number[] }) {
  const max = Math.max(1, ...deltas.map((d) => Math.abs(d)));
  return (
    <div>
      <p class="muted small">Your change by week</p>
      <div class="bars" role="img" aria-label={`Your weekly change: ${weeks.map((w, i) => `week ${w} ${signed(deltas[i]!)}`).join(', ')}`}>
        {weeks.map((w, i) => {
          const d = deltas[i]!;
          return (
            <div class="bar" title={`Week ${w}: ${signed(d)}`}>
              <span class={d >= 0 ? 'up' : 'down'} style={{ height: `${(Math.abs(d) / max) * 50}%` }} />
              <small>{w}</small>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** FantasyCalc values read like 4,512: show 4.5k. */
const shortValue = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${Math.round(n)}`);

const PICK_NOTE =
  "Next year's picks are priced by the original team's projected finish (worst record picks first, as in many leagues; yours may differ), later years at FantasyCalc's price for the round.";

const HORIZON_LABEL: Record<Horizon, string> = { season: 'This season', long: 'Long term (dynasty values)' };

/** Market value of each side, per horizon, shown apart from what the trade does for your lineup. Picks count long term only. */
function MarketLine({
  markets,
  give,
  get,
  picks = { give: [], get: [] },
}: {
  markets: ReadonlyArray<{ horizon: Horizon; values: Market }>;
  give: string[];
  get: string[];
  picks?: { give: PickAsset[]; get: PickAsset[] };
}) {
  const credit = (
    <>
      Values from{' '}
      <a href={FANTASYCALC_URL} target="_blank" rel="noopener">
        FantasyCalc
      </a>
      .
    </>
  );
  const pickSum = (ps: readonly PickAsset[]) => ps.reduce((a, p) => a + p.value, 0);
  const anyPicks = picks.give.length + picks.get.length > 0;
  const lines = markets.map(({ horizon, values }) => {
    const t = marketTotals(values.players, give, get);
    const long = horizon === 'long';
    const giveTotal = t.give + (long ? pickSum(picks.give) : 0);
    const getTotal = t.get + (long ? pickSum(picks.get) : 0);
    if (!giveTotal && !getTotal) {
      const text = !give.length && !get.length ? 'picks have no value' : 'no values for these players';
      return { horizon, text, unvalued: t.unvalued.length };
    }
    const diff = getTotal - giveTotal;
    const share = Math.abs(diff) / Math.max(giveTotal, getTotal);
    const lean = share < 0.05 ? 'about even' : `${Math.round(share * 100)}% in ${diff > 0 ? 'your' : 'their'} favor`;
    return { horizon, text: `you give ${shortValue(giveTotal)}, you get ${shortValue(getTotal)}, ${lean}`, unvalued: t.unvalued.length };
  });
  const unvalued = Math.max(...lines.map((l) => l.unvalued));
  const unpricedPicks = [...picks.give, ...picks.get].filter((p) => !p.valued).length;
  return (
    <div class="small market">
      <p>
        <strong>Market value</strong>
      </p>
      <ul>
        {lines.map((l) => (
          <li>
            {HORIZON_LABEL[l.horizon]}: {l.text}.
          </li>
        ))}
      </ul>
      <p class="muted">
        {unvalued ? `${unvalued} player${unvalued > 1 ? 's have' : ' has'} no value (FantasyCalc doesn't value K, DEF or deep reserves). ` : ''}
        {unpricedPicks ? `${unpricedPicks} pick${unpricedPicks > 1 ? 's have' : ' has'} no FantasyCalc price (it prices rounds 1–4). ` : ''}
        {anyPicks ? `${PICK_NOTE} ` : ''}Simple sums: FantasyCalc's own calculator adds a premium for the best player in uneven trades. {credit}
      </p>
    </div>
  );
}

/** Week by week: lineup points before and after, empty slots, and which regular starters are on bye. */
function ByeGrid({ weeks, name, incoming }: { weeks: readonly ByeWeek[]; name: (id: string) => string; incoming: ReadonlySet<string> }) {
  const open = (n: number) => (n ? <span class="bad"> · {n} empty</span> : null);
  return (
    <>
      <table class="table byes">
        <thead>
          <tr>
            <th>Wk</th>
            <th class="num">Before</th>
            <th class="num">After</th>
            <th>Starters on bye</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            const d = w.after - w.before;
            const tone = w.openAfter > w.openBefore || d <= -2 ? 'worse' : w.openAfter < w.openBefore || d >= 2 ? 'better' : '';
            return (
              <tr class={tone}>
                <td>{w.week}</td>
                <td class="num">
                  {pts(w.before)}
                  {open(w.openBefore)}
                </td>
                <td class="num">
                  {pts(w.after)}
                  {open(w.openAfter)}
                </td>
                <td>
                  {w.byes.length ? (
                    w.byes.map((id, k) => (
                      <>
                        {k ? ', ' : ''}
                        {incoming.has(id) ? <strong>{name(id)}</strong> : name(id)}
                      </>
                    ))
                  ) : (
                    <span class="muted">–</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="muted small">
        Best-lineup expected points each week. Red rows get 2+ points worse or leave a starting slot empty; green rows improve. Byes list players who
        start most weeks; those arriving in the trade are in bold.
      </p>
    </>
  );
}
