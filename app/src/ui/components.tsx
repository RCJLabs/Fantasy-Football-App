import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { PlayerRow, Problem } from '../analysis/analyze';
import { injuryDuration } from '../engine/injuries';
import { kickoffLabel, pct, pts, statLabel } from './format';

export function Badge({ kind, children }: { kind: 'ok' | 'warn' | 'error' | 'info' | 'muted'; children: ComponentChildren }) {
  return <span class={`badge badge-${kind}`}>{children}</span>;
}

export function InjuryBadge({ row }: { row: PlayerRow }) {
  if (!row.injury) return null;
  const kind = row.p === 0 ? 'error' : row.p < 0.95 ? 'warn' : 'muted';
  const short: Record<string, string> = { Questionable: 'Q', Doubtful: 'D', Out: 'OUT', Sus: 'SUS' };
  return (
    <Badge kind={kind}>
      {short[row.injury] ?? row.injury}
      {row.practice ? ` · ${row.practice === 'DNP' ? 'DNP' : row.practice[0]}` : ''}
    </Badge>
  );
}

export function Problems({ problems, limit }: { problems: readonly Problem[]; limit?: number }) {
  const shown = limit ? problems.slice(0, limit) : problems;
  if (!shown.length) return <p class="ok-line">Lineup looks set.</p>;
  return (
    <ul class="problems">
      {shown.map((p) => (
        <li class={`problem problem-${p.level}`}>{p.text}</li>
      ))}
      {limit && problems.length > limit ? <li class="muted">+{problems.length - limit} more</li> : null}
    </ul>
  );
}

/** One player in a lineup/bench list; tap to see why. */
export function PlayerLine({ row, slot, now, highlight, note }: { row: PlayerRow | null; slot?: string; now: number; highlight?: 'in' | 'out'; note?: string }) {
  const [open, setOpen] = useState(false);
  if (!row) {
    return (
      <div class="pl pl-empty">
        {slot ? <span class="slot">{slotLabel(slot)}</span> : null}
        <span class="muted">Empty</span>
      </div>
    );
  }
  const game = row.kickoff === null ? 'BYE' : `${row.home ? 'vs' : '@'} ${row.opponent ?? '?'} · ${kickoffLabel(row.kickoff, now)}`;
  return (
    <div class={`pl ${highlight ? `pl-${highlight}` : ''}`}>
      <button type="button" class="pl-main" aria-expanded={open} onClick={() => setOpen(!open)}>
        {slot ? <span class="slot">{slotLabel(slot)}</span> : null}
        <span class="pl-name">
          <strong>{row.name}</strong>
          <span class="muted">
            {' '}
            {row.pos}
            {row.team ? `·${row.team}` : ''}
          </span>{' '}
          <InjuryBadge row={row} />
          {note ? <Badge kind="info">{note}</Badge> : null}
          <span class="pl-game muted">{game}</span>
        </span>
        <span class="pl-num">
          {row.locked ? (
            <>
              <strong>{pts(row.actual ?? 0)}</strong>
              <span class="muted">{kickoffLabel(row.kickoff, now)}</span>
            </>
          ) : (
            <>
              <strong>{pts(row.ev)}</strong>
              <span class="muted">{row.p < 0.95 ? `${pts(row.mu)} × ${pct(row.p)}` : 'proj'}</span>
            </>
          )}
        </span>
      </button>
      {open ? <Explain row={row} /> : null}
    </div>
  );
}

export function Explain({ row }: { row: PlayerRow }) {
  return (
    <div class="explain">
      {row.hasProjection ? (
        <p>
          {row.fallback ? "Our baseline (Sleeper's projections are missing this week)" : 'RotoWire projection (via Sleeper)'}, rescored to your
          league: <strong>{pts(row.mu)} pts</strong> if he plays.
        </p>
      ) : (
        <p>No projection for this player this week.</p>
      )}
      {row.breakdown.length ? (
        <ul class="breakdown">
          {row.breakdown.map((b) => (
            <li>
              <span>{statLabel(b.key)}</span>
              <span>{(b.points >= 0 ? '+' : '') + b.points.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {row.baseline ? <BaselineNote row={row} baseline={row.baseline} /> : null}
      <p>
        Chance to play: <strong>{pct(row.p)}</strong>
        {row.injury ? ` — ${row.injury}${row.injuryBody ? ` (${row.injuryBody})` : ''}` : ' — no injury designation'}
        {row.practice ? `, ${row.practice === 'DNP' ? 'did not practice' : `${row.practice.toLowerCase()} practice`} on the ${row.practiceFinal ? 'final' : 'latest'} report` : ''}.
      </p>
      {row.injury === 'Questionable' && row.practice && !row.practiceFinal ? (
        <p class="muted">The final injury report isn't out yet, so this is the rate for all Questionable players.</p>
      ) : null}
      {row.injury && ABSENT.has(row.injury) ? <InjuryDurationNote body={row.injuryBody} /> : null}
      {row.teamImplied !== undefined ? <p>Vegas implied team total: {row.teamImplied.toFixed(1)}.</p> : null}
      {row.matchup && row.opponent ? <MatchupNote opponent={row.opponent} pos={row.pos} matchup={row.matchup} /> : null}
      <p class="muted">
        Expected {pts(row.ev)} = {pts(row.mu)} × {pct(row.p)}. Weekly spread ±{pts(row.sd)}.
      </p>
      {row.usage ? <UsageTable usage={row.usage} /> : null}
    </div>
  );
}

/** Designations that mean he's missing games (Questionable players usually play). */
const ABSENT = new Set(['Out', 'Doubtful', 'IR', 'PUP']);

/** How long absences with this injury have lasted (docs/injuries.md): history for context, not a forecast for him. */
function InjuryDurationNote({ body }: { body?: string | undefined }) {
  const info = injuryDuration(body);
  if (!info) return null;
  const d = info.duration;
  const what = info.own ? `${info.category} absences` : `Too few ${info.category.toLowerCase()} absences to break out. All injury absences`;
  return (
    <p class="muted">
      {what} (QB/RB/WR/TE, 2019–2025, {d.n.toLocaleString('en-US')}): {pct(d.oneGame)} lasted one game, {pct(d.twoOrFewer)} two or fewer,{' '}
      {pct(d.fourOrFewer)} four or fewer.
      {d.seasonEndingN >= 30 ? ` ${pct(d.seasonEnding)} of those that began by week 10 lasted the rest of the season.` : ''} Counted from the first
      game missed; he may have missed some already.
    </p>
  );
}

/** Backtest accuracy of the in-house baseline next to RotoWire's, by position (docs/baseline.md, docs/dst.md). */
const BASELINE_ACCURACY: Record<string, string> = {
  QB: 'less accurate than RotoWire, by about 20% for QBs',
  DEF: 'about as accurate as RotoWire for defenses (within 1%)',
};

/** The in-house baseline as a labelled second opinion; the projection above stays RotoWire's. */
function BaselineNote({ row, baseline }: { row: PlayerRow; baseline: NonNullable<PlayerRow['baseline']> }) {
  const def = row.pos === 'DEF';
  const games = baseline.through ? `games through week ${baseline.through}` : 'last season’s games';
  return (
    <p class="small">
      Second opinion, not used: <strong>{pts(baseline.pts)} pts</strong>
      {def ? '' : ' if he plays'}, from our baseline (
      {def ? `the opponent's implied total and league-average sacks and takeaways, ${games}` : `his recent expected usage × this week's implied team total, ${games}`}).{' '}
      <span class="muted">
        In backtests it was {BASELINE_ACCURACY[row.pos] ?? 'less accurate than RotoWire, by about 1–5% for RBs, WRs and TEs'}, and averaging the two gained
        little and not every season.
      </span>
    </p>
  );
}

/** The opponent's record against this position beyond players' usual, and its regular cornerbacks who are out. Context only. */
function MatchupNote({ opponent, pos, matchup }: { opponent: string; pos: string; matchup: NonNullable<PlayerRow['matchup']> }) {
  const d = matchup.defense;
  return (
    <p class="small">
      {d ? (
        <>
          Matchup: {pos}s facing {opponent} have scored{' '}
          <strong>
            {Math.abs(d.pg).toFixed(1)} PPR {d.pg >= 0 ? 'more' : 'fewer'}
          </strong>{' '}
          a game than their usual ({d.n} game{d.n === 1 ? '' : 's'}, pulled toward average while the sample is small).{' '}
        </>
      ) : null}
      {matchup.cbsOut?.length ? `${opponent} cornerbacks out: ${matchup.cbsOut.map((c) => `${c.name} (${c.snap}% of snaps, ${c.status})`).join(', ')}.` : null}
    </p>
  );
}

/** Recent weeks' snap share, targets and carries (share of the team's in brackets). Context only. */
function UsageTable({ usage }: { usage: NonNullable<PlayerRow['usage']> }) {
  const lines: Array<[label: string, values: Array<number | null>, share: Array<number | null> | null, unit: string]> = [
    ['Snaps', usage.snap, null, '%'],
    ['Targets', usage.tgt, usage.tshare, ''],
    ['Carries', usage.car, usage.cshare, ''],
  ];
  const shown = lines.filter(([, values]) => values.some((v) => v));
  if (!shown.length) return null;
  return (
    <div class="table-wrap">
      <table class="table usage">
        <caption class="muted small">Recent usage (nflverse; share of team in brackets)</caption>
        <thead>
          <tr>
            <th />
            {usage.weeks.map((w) => (
              <th class="num">Wk {w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map(([label, values, share, unit]) => (
            <tr>
              <td>{label}</td>
              {values.map((v, i) => (
                <td class="num">
                  {v === null ? '–' : `${v}${unit}`}
                  {v && share?.[i] ? <span class="muted small"> ({share[i]}%)</span> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One line for lists: the last three snap shares and last week's share of targets (carries for RBs). */
export function usageNote(row: PlayerRow): string | undefined {
  const u = row.usage;
  if (!u || row.pos === 'QB') return undefined;
  const snaps = u.snap.filter((s): s is number => s !== null).slice(-3);
  if (!snaps.length) return undefined;
  const rb = row.pos === 'RB';
  const share = [...(rb ? u.cshare : u.tshare)].reverse().find((x) => x !== null);
  return `snaps ${snaps.join('→')}%${share ? ` · ${share}% of ${rb ? 'carries' : 'targets'}` : ''}`;
}

export function slotLabel(slot: string): string {
  const map: Record<string, string> = { SUPER_FLEX: 'SF', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', IDP_FLEX: 'IDP', FLEX: 'FLX' };
  return map[slot] ?? slot;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div class="spinner" role="status">
      <span class="spin" aria-hidden="true" />
      {label ?? 'Loading…'}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div class="card error-box" role="alert">
      <p>
        <strong>Something went wrong.</strong> {error.message}
      </p>
      {onRetry ? (
        <button type="button" class="btn" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
