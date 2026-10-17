import { useMemo, useState } from 'preact/hooks';
import { teamName } from '../analysis/analyze';
import {
  type Board,
  type BoardPlayer,
  buildBoard,
  compareSlots,
  type DraftSetup,
  type DraftStyle,
  fillLineup,
  type Keeper,
  type KeeperCost,
  type KeeperRules,
  lineupValue,
  nextPick,
  pickOrder,
  placeKeepers,
  predictKeepers,
  simulateRest,
  type SlotValue,
  suggest,
} from '../analysis/draft';
import { mulberry32 } from '../analysis/season';
import type { NextSeasonFile } from '../data/contracts';
import { loadDraftPicks, loadDrafts, loadNextSeason } from '../data/repo';
import type { League, Roster } from '../domain/types';
import type { RawDraft, RawDraftPick } from '../sleeper/raw';
import { Badge, ErrorBox, slotLabel, Spinner } from './components';
import type { LeagueBundle } from './data';
import { ordinal, pct } from './format';
import { useAsync } from './hooks';
import { draftPrefs, type DraftPrefs, setDraftPrefs } from './prefs';

// Draft helper (docs/draft.md): next season's board for this league, predicted keepers, the draft order, and a mock
// draft against the other teams drafting from the same board with noise.

interface DraftInputs {
  next: NextSeasonFile;
  /** Sleeper's coming draft for this league, once it exists. */
  upcoming?: RawDraft;
  /** The last finished draft's picks: the round each keeper was drafted in. */
  lastPicks: RawDraftPick[];
}

const latestComplete = (ds: readonly RawDraft[]) => [...ds].filter((d) => d.status === 'complete').sort((a, b) => Number(b.season) - Number(a.season))[0];

async function loadDraftInputs(b: LeagueBundle, force: boolean): Promise<DraftInputs> {
  let next: NextSeasonFile;
  try {
    next = await loadNextSeason(force);
  } catch {
    throw new Error("Next season's projections aren't available yet. They're published with the app's daily data.");
  }
  const drafts = await loadDrafts(b.league.id, force).catch(() => [] as RawDraft[]);
  const upcoming = drafts.find((d) => d.status === 'pre_draft' || d.status === 'drafting');
  // Keeper costs: this league's last finished draft, or last season's league's if Sleeper renewed it.
  let done = latestComplete(drafts);
  if (!done && b.league.previousLeagueId) done = latestComplete(await loadDrafts(b.league.previousLeagueId, force).catch(() => []));
  const lastPicks = done ? await loadDraftPicks(done.draft_id, force).catch(() => []) : [];
  return { next, ...(upcoming ? { upcoming } : {}), lastPicks };
}

/** An order that names every team once. */
function validOrder(order: readonly number[] | undefined, rosterIds: readonly number[]): number[] | undefined {
  if (!order || order.length !== rosterIds.length || new Set(order).size !== order.length || !order.every((r) => rosterIds.includes(r))) return undefined;
  return [...order];
}

/** Round 1's order from Sleeper's draft, once the commissioner sets it. */
function sleeperOrder(d: RawDraft | undefined, rosterIds: readonly number[]): number[] | undefined {
  const slots = d?.slot_to_roster_id;
  if (!slots) return undefined;
  return validOrder(
    Object.entries(slots)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, r]) => r),
    rosterIds,
  );
}

const sleeperStyle = (d: RawDraft | undefined): DraftStyle | undefined => (!d ? undefined : d.type === 'linear' ? 'linear' : d.settings?.reversal_round === 3 ? '3rr' : 'snake');

function shuffled(ids: readonly number[], seed: number): number[] {
  const rand = mulberry32(seed);
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

/** Worst record first, then fewest points: the usual order for a league that drafts by standings. */
const reverseStandings = (rosters: readonly Roster[]) =>
  [...rosters].sort((a, b) => a.wins + a.ties / 2 - (b.wins + b.ties / 2) || a.pointsFor - b.pointsFor).map((r) => r.rosterId);

const STYLES: Array<[DraftStyle, string]> = [
  ['snake', 'Snake'],
  ['linear', 'Same order every round'],
  ['3rr', 'Snake, round 3 reversed'],
];
const COSTS: Array<[KeeperCost, string]> = [
  ['last', "One of the team's last picks"],
  ['drafted', 'The round he was drafted in last year'],
  ['earlier', 'A round earlier than last year'],
];

const whole = (n: number) => Math.round(n).toString();
const pickLabel = (i: number, n: number) => `${Math.floor(i / n) + 1}.${String((i % n) + 1).padStart(2, '0')}`;

export function DraftTab({ bundle }: { bundle: LeagueBundle }) {
  if (bundle.league.rules.type === 'dynasty')
    return (
      <div class="card">
        <h2>Draft helper</h2>
        <p>The draft helper covers redraft and keeper leagues for now. Dynasty startup and rookie drafts come before the 2027 season.</p>
      </div>
    );
  return <DraftLoader bundle={bundle} />;
}

function DraftLoader({ bundle }: { bundle: LeagueBundle }) {
  const inputs = useAsync((force) => loadDraftInputs(bundle, force), [bundle]);
  if (inputs.error) return <ErrorBox error={inputs.error} onRetry={() => inputs.reload(true)} />;
  if (!inputs.data) return <Spinner label="Loading next season's projections…" />;
  return <DraftHelper bundle={bundle} inputs={inputs.data} />;
}

function DraftHelper({ bundle, inputs }: { bundle: LeagueBundle; inputs: DraftInputs }) {
  const { league, data, ctx, myRoster } = bundle;
  const board = useMemo(() => buildBoard(league, inputs.next, ctx.players), [league, inputs.next, ctx.players]);
  const [prefs, setPrefs] = useState<DraftPrefs>(() => draftPrefs(league.id));
  const update = (p: Partial<DraftPrefs>) => {
    const v = { ...prefs, ...p };
    setPrefs(v);
    setDraftPrefs(league.id, v);
  };
  const rosterIds = data.rosters.map((r) => r.rosterId);
  const mine = validOrder(prefs.order, rosterIds);
  const fromSleeper = sleeperOrder(inputs.upcoming, rosterIds);
  const order = mine ?? fromSleeper ?? shuffled(rosterIds, hash(league.id));
  const source = mine ? 'yours' : fromSleeper ? 'sleeper' : 'random';
  const rounds = prefs.rounds ?? inputs.upcoming?.settings?.rounds ?? league.rosterPositions.length;
  const style = prefs.style ?? sleeperStyle(inputs.upcoming) ?? 'snake';
  const rules: KeeperRules | undefined = league.rules.type === 'keeper' ? { count: prefs.keepers ?? league.rules.maxKeepers ?? 3, cost: prefs.cost ?? 'last' } : undefined;
  const drafted = useMemo(() => new Map(inputs.lastPicks.map((p) => [p.player_id, p.round])), [inputs.lastPicks]);
  const keepers = useMemo(
    () => (rules ? predictKeepers(board, data.rosters, rules, rounds, drafted) : []),
    [board, data.rosters, rules?.count, rules?.cost, rounds, drafted],
  );
  const name = (rosterId: number) => teamName(data.rosters.find((r) => r.rosterId === rosterId), data.users);
  const me = myRoster?.rosterId;
  return (
    <div class="stack draft">
      <DraftIntro board={board} league={league} />
      <BoardCard board={board} keepers={keepers} name={name} me={me} />
      {rules ? (
        <KeepersCard board={board} keepers={keepers} rules={rules} rosters={data.rosters} me={me} name={name} hasLastDraft={inputs.lastPicks.length > 0} onRules={(r) => update({ keepers: r.count, cost: r.cost })} />
      ) : null}
      <OrderCard
        board={board}
        order={order}
        source={source}
        sleeperOrder={fromSleeper}
        style={style}
        rounds={rounds}
        rosters={data.rosters}
        me={me}
        name={name}
        keepers={keepers}
        onChange={update}
      />
      {me !== undefined ? (
        <MockDraft key={`${order.join(',')}|${style}|${rounds}|${keepers.map((k) => k.id).join(',')}`} board={board} order={order} style={style} rounds={rounds} keepers={keepers} me={me} name={name} />
      ) : null}
    </div>
  );
}

function DraftIntro({ board, league }: { board: Board; league: League }) {
  const b = board.basis;
  const from = b.weeks >= 18 ? `the ${b.season} season` : `${b.season} through week ${b.weeks}`;
  const idp = league.rosterPositions.some((s) => ['DL', 'LB', 'DB', 'IDP_FLEX'].includes(s));
  return (
    <div class="card">
      <h2>Draft helper · {board.target}</h2>
      <p>
        {board.target} projections from {from} and the two seasons before, scored by this league&apos;s settings. Value is points over the best player
        left once every team&apos;s starters are filled.
      </p>
      <ul class="muted small draft-notes">
        <li>
          Each player&apos;s production a game is pulled toward his position&apos;s average and adjusted for age (peak 26–27) and contract; games come from
          age, games missed this season and contract. On 2015–2025 this ranked next season&apos;s players better than &quot;same as this year&quot;, but a
          draftable player&apos;s season still missed by 56–96 points on average. It&apos;s a first look, updated daily.
        </li>
        <li>
          Rookies of the {board.target} NFL draft are placeholders by the order their position is taken until April&apos;s draft names them. The first RB
          taken averaged 224 PPR points as a rookie (2012–2025), with busts and stars either side.
        </li>
        <li>
          Players are on their current teams. &quot;No {board.target} contract&quot; means none on record; about half of such running backs and receivers,
          and a quarter of such quarterbacks, changed teams in past offseasons.
        </li>
        <li>Kickers and defenses barely carry over from one season to the next, so they sit near average.</li>
        <li>No {board.target} ADP exists yet: in the mock draft the other teams pick from this board with noise.</li>
        {idp ? <li>Defensive players (IDP) aren&apos;t projected; their slots are left out.</li> : null}
      </ul>
    </div>
  );
}

function PlayerMeta({ p }: { p: BoardPlayer }) {
  return (
    <span class="muted small">
      {' '}
      {p.pos}
      {p.team ? `·${p.team}` : ''}
      {p.age !== undefined ? ` · ${Math.floor(p.age)}` : ''}
    </span>
  );
}

function PlayerBadges({ p, keptBy }: { p: BoardPlayer; keptBy?: string }) {
  return (
    <>
      {p.rookie ? <Badge kind="info">Rookie</Badge> : null}
      {p.fa ? (
        <span title={p.chg !== undefined ? `Players like him changed teams ${pct(p.chg)} of the time` : undefined}>
          <Badge kind="warn">No contract{p.chg !== undefined ? ` · ${pct(p.chg)} move` : ''}</Badge>
        </span>
      ) : null}
      {keptBy ? <Badge kind="muted">Kept · {keptBy}</Badge> : null}
    </>
  );
}

const PAGE = 60;

function BoardCard({ board, keepers, name, me }: { board: Board; keepers: readonly Keeper[]; name: (r: number) => string; me: number | undefined }) {
  const [pos, setPos] = useState('ALL');
  const [shown, setShown] = useState(PAGE);
  const kept = new Map(keepers.map((k) => [k.id, k.rosterId]));
  const positions = ['ALL', ...['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].filter((p) => board.players.some((x) => x.pos === p)), 'ROOKIE'];
  const rows = board.players.filter((p) => pos === 'ALL' || (pos === 'ROOKIE' ? p.rookie : p.pos === pos));
  return (
    <div class="card">
      <h2>Board</h2>
      <div class="seg draft-filter" role="group" aria-label="Position">
        {positions.map((p) => (
          <button
            type="button"
            aria-pressed={pos === p}
            onClick={() => {
              setPos(p);
              setShown(PAGE);
            }}
          >
            {p === 'ALL' ? 'All' : p === 'ROOKIE' ? 'Rookies' : p}
          </button>
        ))}
      </div>
      <div class="table-wrap">
        <table class="table draft-board">
          <thead>
            <tr>
              <th class="num">#</th>
              <th>Player</th>
              <th class="num">Pos</th>
              <th class="num">Points</th>
              <th class="num">Value</th>
              <th class="num wide-only">Likely range</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, shown).map((p) => {
              const by = kept.get(p.id);
              return (
                <tr class={by !== undefined ? (by === me ? 'mine' : 'kept') : undefined}>
                  <td class="num">{p.rank}</td>
                  <td>
                    <strong>{p.name}</strong>
                    <PlayerMeta p={p} /> <PlayerBadges p={p} {...(by !== undefined ? { keptBy: by === me ? 'you' : name(by) } : {})} />
                  </td>
                  <td class="num">
                    {p.pos}
                    {p.posRank}
                  </td>
                  <td class="num">
                    {whole(p.points)}
                    <span class="phone-only">{p.games.toFixed(0)} g</span>
                  </td>
                  <td class="num">{whole(p.vor)}</td>
                  <td class="num wide-only">{p.range ? `${whole(p.range[0])}–${whole(p.range[1])}` : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > shown ? (
        <button type="button" class="btn btn-small" onClick={() => setShown(shown + PAGE)}>
          Show more
        </button>
      ) : null}
      <p class="muted small">
        Points: expected for the season, games missed included. Value: points over replacement level, which sets the order. Likely range: the 10th to
        90th percentile of how players projected like this finished, 2015–2025.
      </p>
    </div>
  );
}

function KeepersCard({
  board,
  keepers,
  rules,
  rosters,
  me,
  name,
  hasLastDraft,
  onRules,
}: {
  board: Board;
  keepers: readonly Keeper[];
  rules: KeeperRules;
  rosters: readonly Roster[];
  me: number | undefined;
  name: (r: number) => string;
  hasLastDraft: boolean;
  onRules: (r: KeeperRules) => void;
}) {
  const byId = new Map(board.players.map((p) => [p.id, p]));
  const teams = rosters.map((r) => ({ rosterId: r.rosterId, kept: keepers.filter((k) => k.rosterId === r.rosterId) }));
  return (
    <div class="card">
      <h2>Keepers</h2>
      <div class="row draft-settings">
        <label class="field">
          <span class="muted small">Keepers per team</span>
          <input type="number" min={0} max={20} value={rules.count} onInput={(e) => onRules({ ...rules, count: Math.max(0, Math.min(20, Number((e.target as HTMLInputElement).value) || 0)) })} />
        </label>
        <label class="field">
          <span class="muted small">A keeper costs</span>
          <select value={rules.cost} onChange={(e) => onRules({ ...rules, cost: (e.target as HTMLSelectElement).value as KeeperCost })}>
            {COSTS.map(([v, label]) => (
              <option value={v}>{label}</option>
            ))}
          </select>
        </label>
      </div>
      {rules.cost !== 'last' && !hasLastDraft ? <p class="note">Last year&apos;s draft isn&apos;t available from Sleeper, so every keeper is priced at the last round.</p> : null}
      <p class="muted small">
        Sleeper doesn&apos;t store keeper costs: set your league&apos;s rule here. Each team is predicted to keep the players whose value beats the pick
        they cost by the most. Managers who keep for other reasons will differ.
      </p>
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Team</th>
              <th>Likely keepers</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr class={t.rosterId === me ? 'mine' : undefined}>
                <td>{t.rosterId === me ? 'You' : name(t.rosterId)}</td>
                <td>
                  {t.kept.length
                    ? t.kept.map((k, i) => {
                        const p = byId.get(k.id)!;
                        return (
                          <span>
                            {i ? ', ' : ''}
                            {p.name} <span class="muted small">({p.pos}{p.posRank}, round {k.round})</span>
                          </span>
                        );
                      })
                    : <span class="muted">None worth the pick</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderCard({
  board,
  order,
  source,
  sleeperOrder: fromSleeper,
  style,
  rounds,
  rosters,
  me,
  name,
  keepers,
  onChange,
}: {
  board: Board;
  order: number[];
  source: 'yours' | 'sleeper' | 'random';
  sleeperOrder: number[] | undefined;
  style: DraftStyle;
  rounds: number;
  rosters: readonly Roster[];
  me: number | undefined;
  name: (r: number) => string;
  keepers: readonly Keeper[];
  onChange: (p: Partial<DraftPrefs>) => void;
}) {
  const [slots, setSlots] = useState<{ key: string; values: SlotValue[] } | 'busy' | null>(null);
  const key = `${order.join(',')}|${style}|${rounds}|${keepers.map((k) => k.id).join(',')}`;
  const move = (i: number, d: number) => {
    const o = [...order];
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j]!, o[i]!];
    onChange({ order: o });
  };
  const mySlot = me === undefined ? undefined : order.indexOf(me) + 1;
  const myPicks = me === undefined ? [] : pickOrder(order, Math.min(rounds, 4), style).flatMap((r, i) => (r === me ? [i + 1] : []));
  const compare = () => {
    if (me === undefined) return;
    setSlots('busy');
    // Let the button repaint before the simulation runs.
    setTimeout(() => setSlots({ key, values: compareSlots({ board, order, rounds, style, me, keepers }, { sims: 30 }) }), 20);
  };
  const values = slots && slots !== 'busy' && slots.key === key ? slots.values : undefined;
  const best = values ? Math.max(...values.map((v) => v.value)) : 0;
  return (
    <div class="card">
      <h2>Draft order</h2>
      <p class="muted small">
        {source === 'sleeper'
          ? "From Sleeper's draft settings. Change it here to try other orders."
          : source === 'yours'
            ? 'Set here, on this device.'
            : "Random until the league sets it: reorder it here, randomize it again, or use last season's standings."}
      </p>
      <div class="row">
        <button type="button" class="btn btn-small" onClick={() => onChange({ order: shuffled(order, Math.floor(Math.random() * 2 ** 31)) })}>
          Randomize
        </button>
        <button type="button" class="btn btn-small" onClick={() => onChange({ order: reverseStandings(rosters) })}>
          Worst record first
        </button>
        {fromSleeper && source !== 'sleeper' ? (
          <button type="button" class="btn btn-small" onClick={() => onChange({ order: undefined })}>
            Use Sleeper&apos;s
          </button>
        ) : null}
      </div>
      <ol class="draft-order">
        {order.map((r, i) => (
          <li class={r === me ? 'mine' : undefined}>
            <span>{r === me ? 'You' : name(r)}</span>
            <span class="row">
              <button type="button" class="btn btn-small" aria-label={`Move ${r === me ? 'you' : name(r)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" class="btn btn-small" aria-label={`Move ${r === me ? 'you' : name(r)} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div class="row draft-settings">
        <label class="field">
          <span class="muted small">Order each round</span>
          <select value={style} onChange={(e) => onChange({ style: (e.target as HTMLSelectElement).value as DraftStyle })}>
            {STYLES.map(([v, label]) => (
              <option value={v}>{label}</option>
            ))}
          </select>
        </label>
        <label class="field">
          <span class="muted small">Rounds</span>
          <input type="number" min={1} max={40} value={rounds} onInput={(e) => onChange({ rounds: Math.max(1, Math.min(40, Number((e.target as HTMLInputElement).value) || 1)) })} />
        </label>
      </div>
      {mySlot ? (
        <p class="small">
          You pick {ordinal(mySlot)}: picks {myPicks.join(', ')}
          {rounds > 4 ? '…' : ''}
        </p>
      ) : null}
      {me !== undefined ? (
        <>
          <h3>Which slot is best?</h3>
          <p class="muted small">Your lineup value after a simulated draft from each first-round slot, with the other teams in this order.</p>
          <button type="button" class="btn btn-small" disabled={slots === 'busy'} onClick={compare}>
            {slots === 'busy' ? 'Simulating…' : values ? 'Run again' : 'Compare slots'}
          </button>
          {values ? (
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th class="num">Lineup value</th>
                    <th class="num">vs best</th>
                  </tr>
                </thead>
                <tbody>
                  {values.map((v) => (
                    <tr class={v.slot === mySlot ? 'mine' : undefined}>
                      <td>{ordinal(v.slot)}</td>
                      <td class="num">{whole(v.value)}</td>
                      <td class="num">{v.value === best ? 'best' : `−${whole(best - v.value)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

interface MockState {
  taken: Array<string | undefined>;
  history: Array<Array<string | undefined>>;
  round: number;
}

function MockDraft({ board, order, style, rounds, keepers, me, name }: { board: Board; order: number[]; style: DraftStyle; rounds: number; keepers: readonly Keeper[]; me: number; name: (r: number) => string }) {
  const n = order.length;
  const picks = useMemo(() => pickOrder(order, rounds, style), [order, rounds, style]);
  const fixed = useMemo(() => placeKeepers(picks, n, keepers), [picks, n, keepers]);
  const [mock, setMock] = useState<MockState | null>(null);
  const [search, setSearch] = useState('');
  const byId = useMemo(() => new Map(board.players.map((p) => [p.id, p])), [board]);
  const setupFor = (taken: ReadonlyArray<string | undefined>): DraftSetup => ({ board, picks, numTeams: n, taken });
  // The other teams pick up to your next open pick.
  const advance = (taken: Array<string | undefined>, round: number): Array<string | undefined> => {
    const at = taken.findIndex((t, i) => t === undefined && i < picks.length);
    if (at < 0) return taken;
    const mineAt = picks.findIndex((r, i) => i >= at && r === me && taken[i] === undefined);
    return simulateRest(setupFor(taken), me, { seed: 100 * round + at, to: mineAt < 0 ? picks.length : mineAt });
  };
  const start = () => {
    const taken = picks.map((_, i) => fixed.get(i));
    setMock({ taken: advance(taken, 1), history: [], round: 1 });
  };
  const current = mock ? mock.taken.findIndex((t, i) => t === undefined && i < picks.length) : -1;
  const done = !!mock && current < 0;
  const suggestions = useMemo(() => (mock && current >= 0 && picks[current] === me ? suggest(setupFor(mock.taken), current, { sims: 150 }) : []), [mock, current]);
  const draft = (id: string) => {
    if (!mock || current < 0) return;
    const taken = [...mock.taken];
    taken[current] = id;
    setMock({ taken: advance(taken, mock.round + 1), history: [...mock.history, mock.taken], round: mock.round + 1 });
    setSearch('');
  };
  const undo = () => mock?.history.length && setMock({ taken: mock.history.at(-1)!, history: mock.history.slice(0, -1), round: mock.round + 1 });
  const finish = () => mock && setMock({ taken: simulateRest(setupFor(mock.taken), me, { seed: 100 * mock.round + current }), history: [...mock.history, mock.taken], round: mock.round + 1 });

  if (!mock)
    return (
      <div class="card">
        <h2>Mock draft</h2>
        <p class="muted small">
          You pick; the other teams draft from the board with noise and the limits managers keep (two QBs, a kicker and a defense last).
          {keepers.length ? ' Predicted keepers take their picks first.' : ''}
        </p>
        <button type="button" class="btn btn-primary" onClick={start}>
          Start a mock draft
        </button>
      </div>
    );

  const taken = new Set(mock.taken.filter(Boolean));
  const myTeam = mock.taken.flatMap((id, i) => (picks[i] === me && id ? (byId.get(id) ? [byId.get(id)!] : []) : []));
  const lineup = fillLineup(myTeam, board.slots);
  const recent = mock.taken
    .map((id, i) => ({ id, i }))
    .filter((x) => x.id && x.i < (current < 0 ? picks.length : current) && !fixed.has(x.i))
    .slice(-8)
    .reverse();
  const next = current >= 0 ? nextPick(setupFor(mock.taken), me, current) : undefined;
  const matches = search.trim().length >= 2 ? board.players.filter((p) => !taken.has(p.id) && p.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 6) : [];
  return (
    <div class="card mock">
      <h2>Mock draft</h2>
      {done ? (
        <p>
          <strong>Draft complete.</strong> Your lineup value: {whole(lineupValue(myTeam, board.slots))} over replacement, bench counted at a share.
        </p>
      ) : (
        <p>
          Pick {pickLabel(current, n)} ({ordinal(current + 1)} overall): <strong>you&apos;re on the clock.</strong>
          {next !== undefined ? <span class="muted small"> Your next pick: {pickLabel(next, n)}.</span> : null}
        </p>
      )}
      {suggestions.length ? (
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Best for your lineup</th>
                <th class="num">Adds</th>
                <th class="num">Back at your next</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {suggestions.map((s) => (
                <tr>
                  <td>
                    <strong>{s.player.name}</strong>
                    <PlayerMeta p={s.player} /> <PlayerBadges p={s.player} />
                  </td>
                  <td class="num">{whole(s.gain)}</td>
                  <td class="num">{s.nextAvailable === undefined ? '–' : pct(s.nextAvailable)}</td>
                  <td class="num">
                    <button type="button" class="btn btn-small" onClick={() => draft(s.player.id)}>
                      Draft
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {!done ? (
        <>
          <label class="field">
            <span class="muted small">Or draft someone else</span>
            <input type="search" value={search} placeholder="Player name" onInput={(e) => setSearch((e.target as HTMLInputElement).value)} />
          </label>
          {matches.length ? (
            <ul class="draft-matches">
              {matches.map((p) => (
                <li>
                  <button type="button" class="link" onClick={() => draft(p.id)}>
                    {p.name}
                  </button>
                  <PlayerMeta p={p} />
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
      <div class="row">
        <button type="button" class="btn btn-small" disabled={!mock.history.length} onClick={undo}>
          Undo
        </button>
        {!done ? (
          <button type="button" class="btn btn-small" onClick={finish}>
            Finish for me
          </button>
        ) : null}
        <button type="button" class="btn btn-small" onClick={start}>
          Restart
        </button>
      </div>
      <h3>Your team</h3>
      <ul class="draft-team">
        {board.slots.map((slot, i) => (
          <li>
            <span class="slot">{slotLabel(slot)}</span> {lineup.starters[i] ? lineup.starters[i]!.name : <span class="muted">—</span>}
          </li>
        ))}
        {lineup.bench.map((p) => (
          <li>
            <span class="slot">BN</span> {p.name}
          </li>
        ))}
      </ul>
      {recent.length ? (
        <>
          <h3>Latest picks</h3>
          <ul class="draft-recent">
            {recent.map(({ id, i }) => {
              const p = byId.get(id!);
              return (
                <li>
                  <span class="muted small">{pickLabel(i, n)}</span> {picks[i] === me ? 'You' : name(picks[i]!)}: {p ? `${p.name} (${p.pos})` : id}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
