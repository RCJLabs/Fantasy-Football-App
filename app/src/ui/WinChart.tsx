import { useEffect, useRef, useState } from 'preact/hooks';
import type { LiveFeed } from '../analysis/liveFeed';
import { pct, pts } from './format';

// Win chance through the day (the Matchup tab, docs/gameday.md): one point per check while the page was open, the line
// broken where it was closed. Single series: no legend; the card names it. Hover or arrow keys show each check.

/** Checks further apart than this were made with the page closed: the line breaks there. */
const GAP = 3 * 60_000;
const HEIGHT = 132;
const PAD = { left: 36, right: 40, top: 10, bottom: 22 };

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const time = (ms: number) => timeFmt.format(new Date(ms));

interface Point {
  t: number;
  win: number;
  me: number;
  opp: number | null;
}

export function WinChart({ timeline }: { timeline: LiveFeed['timeline'] }) {
  const points: Point[] = timeline.flatMap(([t, win, me, opp]) => (win === null ? [] : [{ t, win, me, opp }]));
  const ready = points.length >= 2;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => setWidth(Math.max(240, Math.round(el.clientWidth)));
    update();
    const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [ready]);
  if (!ready) return null;

  const t0 = points[0]!.t;
  const t1 = points.at(-1)!.t;
  const x = (t: number) => PAD.left + ((t - t0) / Math.max(1, t1 - t0)) * (width - PAD.left - PAD.right);
  const y = (p: number) => PAD.top + (1 - p) * (HEIGHT - PAD.top - PAD.bottom);
  const path = points.map((p, i) => `${i === 0 || p.t - points[i - 1]!.t > GAP ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.win).toFixed(1)}`).join('');
  const last = points.at(-1)!;
  const high = points.reduce((a, p) => (p.win > a.win ? p : a));
  const low = points.reduce((a, p) => (p.win < a.win ? p : a));
  const shown = at === null ? undefined : points[Math.min(at, points.length - 1)];
  const nearest = (px: number) => {
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i]!.t) - px) < Math.abs(x(points[best]!.t) - px)) best = i;
    return best;
  };
  const onKey = (e: KeyboardEvent) => {
    const i = at ?? points.length - 1;
    const next = e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? points.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setAt(Math.max(0, Math.min(points.length - 1, next)));
  };
  // Changes of a point or more, for the table (all checks would be a row a minute).
  const rows = points.filter((p, i) => i === 0 || i === points.length - 1 || Math.abs(p.win - points[i - 1]!.win) >= 0.01).reverse();

  return (
    <figure class="winchart">
      <div
        ref={box}
        class="wc-box"
        tabIndex={0}
        role="group"
        aria-label={`Win chance from ${time(t0)} to ${time(t1)}: ${pct(points[0]!.win)} at the start, ${pct(last.win)} now, high ${pct(high.win)}, low ${pct(low.win)}. Arrow keys step through the checks.`}
        onKeyDown={onKey}
        onFocus={() => setAt((a) => a ?? points.length - 1)}
        onBlur={() => setAt(null)}
      >
        <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
          {[0, 0.5, 1].map((p) => (
            <g>
              <line class={p === 0.5 ? 'wc-mid' : 'wc-grid'} x1={PAD.left} x2={width - PAD.right} y1={y(p)} y2={y(p)} />
              <text class="wc-tick" x={PAD.left - 6} y={y(p) + 4} text-anchor="end">
                {Math.round(p * 100)}%
              </text>
            </g>
          ))}
          <text class="wc-tick" x={PAD.left} y={HEIGHT - 6} text-anchor="start">
            {time(t0)}
          </text>
          {time(t1) !== time(t0) ? (
            <text class="wc-tick" x={width - PAD.right} y={HEIGHT - 6} text-anchor="end">
              {time(t1)}
            </text>
          ) : null}
          <path class="wc-line" d={path} />
          {shown ? (
            <>
              <line class="wc-cross" x1={x(shown.t)} x2={x(shown.t)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
              <circle class="wc-dot" cx={x(shown.t)} cy={y(shown.win)} r={4} />
            </>
          ) : null}
          <circle class="wc-dot" cx={x(last.t)} cy={y(last.win)} r={4} />
          <text class="wc-end" x={x(last.t) + 8} y={y(last.win) + 4}>
            {pct(last.win)}
          </text>
          <rect
            class="wc-hit"
            x={PAD.left}
            y={0}
            width={Math.max(0, width - PAD.left - PAD.right)}
            height={HEIGHT}
            onPointerMove={(e) => setAt(nearest(e.offsetX))}
            onPointerLeave={() => setAt(null)}
          />
        </svg>
        {shown ? (
          <div class="wc-tip" style={{ left: `${Math.min(Math.max(0, x(shown.t) - 70), width - 150)}px` }} role="status">
            <strong>{pct(shown.win)}</strong> <span class="muted">win chance · {time(shown.t)}</span>
            <br />
            <span class="muted">
              {pts(shown.me)}
              {shown.opp !== null ? `–${pts(shown.opp)}` : ''}
            </span>
          </div>
        ) : null}
      </div>
      <figcaption class="muted small">
        Win chance at each check while this page was open; the line breaks where it was closed. High {pct(high.win)} at {time(high.t)}, low{' '}
        {pct(low.win)} at {time(low.t)}.
      </figcaption>
      <details class="small">
        <summary>As a table</summary>
        <table class="wc-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Win chance</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.t}>
                <td>{time(p.t)}</td>
                <td>{pct(p.win)}</td>
                <td>
                  {pts(p.me)}
                  {p.opp !== null ? `–${pts(p.opp)}` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
