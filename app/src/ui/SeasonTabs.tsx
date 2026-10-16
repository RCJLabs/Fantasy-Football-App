import { useMemo, useState } from 'preact/hooks';
import { analyzeWaivers, type PlayerRow } from '../analysis/analyze';
import { marketPrice } from '../analysis/faab';
import { evaluateTrade, freeAgentPool, scheduleOutlook, streamers, waiverBoard, type ByeWeek, type LeagueOutlook, type TradeSideResult } from '../analysis/outlook';
import { carriedForward, longTermRanking } from '../analysis/longterm';
import { pickAssets, pickLabel, pickTotals, type PickAsset } from '../analysis/picks';
import { FANTASYCALC_URL, horizons, loadMarketValues, marketParams, marketTotals, type Horizon, type Market } from '../data/fantasycalc';
import { loadTrending } from '../data/repo';
import { InjuryBadge, ErrorBox, Spinner, usageNote } from './components';
import { loadSeason, type LeagueBundle, type SeasonBundle } from './data';
import { logError } from './errorLog';
import { kickoffLabel, pct, pts, signed } from './format';
import { useAsync } from './hooks';

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
      return { season, board: waiverBoard(season.outlook, bundle.myRoster!, bundle.ctx, trending, season.claims) };
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

  const { season, board } = w.data;
  const o = season.outlook;
  const me = o.teams.get(bundle.myRoster!.rosterId)!;
  const playoffWeight = bundle.league.rules.playoffWeekStart ? me.weights.at(-1) : undefined;
  const budget = bundle.league.rules.waiverBudget ?? 0;
  const showBids = board.remaining !== undefined;
  return (
    <div class="stack">
      <div class="card">
        <h2>Free agents</h2>
        <p class="muted small">
          Ranked by what each player adds to your best lineups: this week (<strong>Wk</strong>) plus {weekSpan(o.weeks)} (<strong>ROS</strong>, after
          dropping the player shown)
          {playoffWeight !== undefined ? `. Playoff weeks count at your ${pct(playoffWeight)} playoff odds` : ''}.
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
                  <PlayerCell row={r.player} now={now} extra={r.drop && r.rosGain >= 0.05 ? `drop ${r.drop.name}` : undefined} />
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
      <Streamers bundle={bundle} outlook={o} now={now} />
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
  const teams = [...o.teams.values()].sort(
    (a, b) =>
      (o.odds?.get(a.rosterId)?.avgSeed ?? 0) - (o.odds?.get(b.rosterId)?.avgSeed ?? 0) ||
      b.roster.wins - a.roster.wins ||
      b.roster.pointsFor - a.roster.pointsFor,
  );
  const schedule = scheduleOutlook(o, myId).filter((x) => x.week <= (rules.playoffWeekStart ? rules.playoffWeekStart - 1 : 18));
  return (
    <div class="stack">
      <div class="card">
        <h2>Standings outlook</h2>
        {!o.odds ? <p class="muted small">The regular season is over.</p> : null}
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Team</th>
                <th class="num">W-L</th>
                <th class="num">PF</th>
                {o.odds ? <th class="num">Proj</th> : null}
                {o.odds && playoffs ? <th class="num">Playoffs</th> : null}
                {o.odds && byes ? <th class="num">Bye</th> : null}
                {o.odds ? <th class="num">1st</th> : null}
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
                    </td>
                    <td class="num">{Math.round(r.pointsFor)}</td>
                    {odds ? (
                      <td class="num">
                        {odds.expWins.toFixed(1)}-{odds.expLosses.toFixed(1)}
                      </td>
                    ) : null}
                    {odds && playoffs ? <td class="num">{pct(odds.pPlayoffs)}</td> : null}
                    {odds && byes ? <td class="num">{pct(odds.pBye)}</td> : null}
                    {odds ? <td class="num">{pct(odds.pFirst)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p class="muted small">
          {o.sims.toLocaleString()} simulations of {weekSpan(o.regularWeeks)}
          {rules.medianGame ? ' (head-to-head plus the league-median game)' : ''}: every team plays its best projected lineup each week; ties go to points
          for.
          {playoffs ? ` Top ${rules.playoffTeams} make the playoffs.` : ' This league has no playoffs.'} Trades and pickups aren't predicted.
        </p>
        <MissingWeeks season={s.data} />
      </div>
      {schedule.length ? (
        <div class="card">
          <h2>Your schedule</h2>
          <table class="table">
            <thead>
              <tr>
                <th>Week</th>
                <th>Opponent</th>
                <th class="num">Proj</th>
                <th class="num">Win</th>
              </tr>
            </thead>
            <tbody>
              {schedule.map((x) => (
                <tr>
                  <td>{x.week}</td>
                  <td>{x.opponent === null ? '–' : (o.teams.get(x.opponent)?.name ?? '?')}</td>
                  <td class="num">{pts(x.mean)}</td>
                  <td class="num">{x.winProb === null ? '–' : pct(x.winProb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {bundle.league.rules.type !== 'redraft' ? <LongTermCard bundle={bundle} season={s.data} /> : null}
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
  // This season: average best-lineup points over the remaining regular season.
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
        {bundle.league.rules.type === 'keeper' ? ' (keeper costs aren’t in Sleeper’s data, so they aren’t counted)' : ''}. “Now” ranks projected lineup
        strength for the rest of the regular season.
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
              <th class="num">Now</th>
              <th>Outlook</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((t) => (
              <tr class={t.rosterId === myId ? 'mine' : ''}>
                <td>{outlook.teams.get(t.rosterId)?.name ?? t.rosterId}</td>
                <td class="num">{shortValue(t.total)}</td>
                {picks ? <td class="num">{shortValue(t.picks)}</td> : null}
                <td class="num">{t.rank}</td>
                <td class="num">{nowRank.get(t.rosterId)}</td>
                <td class="muted small">{outlookOf(t.rosterId)}</td>
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
  const freeAgents = useMemo(() => freeAgentPool(o, bundle.ctx), [o, bundle.ctx]);
  const market = useAsync(async () => {
    const hs = horizons(bundle.league);
    const loaded = await Promise.all(hs.map((h) => loadMarketValues(marketParams(bundle.league, h))));
    return hs.flatMap((h, i) => (loaded[i] ? [{ horizon: h, values: loaded[i]! }] : []));
  }, [bundle.league.id]);
  const markets = market.data ?? [];
  const values = markets.find((m) => m.horizon === 'season')?.values.players ?? null;
  const longMarket = markets.find((m) => m.horizon === 'long')?.values ?? null;
  const longValues = longMarket?.players ?? null;
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
    () => (partnerId >= 0 && (give.length || get.length) ? evaluateTrade(o, bundle.ctx, myId, partnerId, give, get, freeAgents) : null),
    [o, bundle.ctx, myId, partnerId, give, get, freeAgents],
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

  return (
    <div class="stack">
      {passed ? <p class="note">This league's trade deadline (week {deadline}) has passed.</p> : null}
      <div class="card">
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
                Rest-of-season points from each team's best lineup by week (playoff weeks weighted by that team's playoff odds), including the drops a full
                roster forces and free agents for spots the trade opens.
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

function TradeSide({ label, side, name }: { label: string; side: TradeSideResult; name: (id: string) => string }) {
  const odds =
    side.pBefore !== undefined
      ? `playoff odds ${pct(side.pBefore)} → ${pct(side.pAfter)}`
      : side.firstBefore !== undefined
        ? `chance of 1st ${pct(side.firstBefore)} → ${pct(side.firstAfter)}`
        : '';
  return (
    <div class="trade-side">
      <p>
        <strong>{label}:</strong>{' '}
        <span class={side.delta >= 0 ? 'good' : 'bad'}>{signed(side.delta)} pts</span> rest of season
        {odds ? ` · ${odds}` : ''}
      </p>
      {side.drops.length ? <p class="muted small">Must drop {side.drops.map(name).join(', ')} to make room.</p> : null}
      {side.adds.length ? <p class="muted small">Fills the open spot with {side.adds.map(name).join(', ')} from free agency.</p> : null}
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
