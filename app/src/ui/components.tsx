import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { PlayerRow, Problem } from '../analysis/analyze';
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
          RotoWire projection (via Sleeper), rescored to your league: <strong>{pts(row.mu)} pts</strong> if he plays.
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
      <p>
        Chance to play: <strong>{pct(row.p)}</strong>
        {row.injury ? ` — ${row.injury}${row.injuryBody ? ` (${row.injuryBody})` : ''}` : ' — no injury designation'}
        {row.practice ? `, ${row.practice === 'DNP' ? 'did not practice' : `${row.practice.toLowerCase()} practice`} on the ${row.practiceFinal ? 'final' : 'latest'} report` : ''}.
      </p>
      {row.injury === 'Questionable' && row.practice && !row.practiceFinal ? (
        <p class="muted">The final injury report isn't out yet, so this is the rate for all Questionable players.</p>
      ) : null}
      {row.teamImplied !== undefined ? <p>Vegas implied team total: {row.teamImplied.toFixed(1)}.</p> : null}
      <p class="muted">
        Expected {pts(row.ev)} = {pts(row.mu)} × {pct(row.p)}. Weekly spread ±{pts(row.sd)}.
      </p>
    </div>
  );
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
