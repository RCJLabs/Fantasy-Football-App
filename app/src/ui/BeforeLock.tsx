import type { LineupAnalysis, PlayerRow } from '../analysis/analyze';
import { beforeLock, type FillIn, type LockItem } from '../analysis/beforeLock';
import { slotLabel } from './components';
import { kickoffLabel, pct } from './format';

// Before lock (docs/before-lock.md): what to change before each kickoff, and when to look again for Questionable starters.

const status = (p: PlayerRow) => (p.kickoff === null ? 'has no game this week' : `is ${p.injury ?? 'out'}`);

function itemText(item: LockItem, now: number): string {
  if (item.kind === 'change') {
    const { in: inn, out } = item;
    if (!inn) return `Bench ${out!.name}.`;
    if (item.why === 'move') return `Move ${inn.name} to ${slotLabel(item.slot)}.`;
    if (item.why === 'empty' || !out) return `Start ${inn.name} in your empty ${slotLabel(item.slot)} spot.`;
    return item.why === 'better' ? `Start ${inn.name} over ${out.name}.` : `Start ${inn.name} over ${out.name}, who ${status(out)}.`;
  }
  if (item.kind === 'stranded') {
    const fix = `nobody on your bench can play ${slotLabel(item.slot)}: add a free agent (Waivers tab).`;
    return item.out ? `${item.out.name} ${status(item.out)}, and ${fix}` : `Your ${slotLabel(item.slot)} spot is empty, and ${fix}`;
  }
  const p = item.player;
  const fill = (f: FillIn) =>
    f.via ? `move ${f.via.player.name} to ${slotLabel(item.slot)} and start ${f.player.name} at ${slotLabel(f.via.slot)}` : `start ${f.player.name}`;
  // The moment a fill-in stops being possible: the earlier of his kickoff and the moved starter's.
  const locks = (f: FillIn) => Math.min(f.player.kickoff!, f.via?.player.kickoff ?? Infinity);
  const parts = [`${p.name} is ${p.injury ?? 'uncertain'} (${pct(p.p)} to play). Inactives come out about ${kickoffLabel(item.inactivesAt, now)}.`];
  if (item.backup) parts.push(`If he's out, ${fill(item.backup)} (${kickoffLabel(item.backup.player.kickoff, now)}).`);
  if (item.earlier) {
    const better = fill(item.earlier);
    parts.push(`To ${better} instead would be better, but that locks ${kickoffLabel(locks(item.earlier), now)}, before the news: decide by then.`);
  }
  if (!item.backup && !item.earlier) parts.push(`Nobody on your bench can fill ${slotLabel(item.slot)} if he's out.`);
  return parts.join(' ');
}

const itemClass = (item: LockItem) => (item.kind === 'watch' ? 'problem problem-warn' : 'problem problem-error');

/** The lineup set in Sleeper, kickoff by kickoff: what to change before each lock and when to look again. */
export function BeforeLockCard({ a, now }: { a: LineupAnalysis; now: number }) {
  const check = beforeLock(a);
  if (!check.now.length && !check.windows.length) return null;
  return (
    <div class="card before-lock">
      <h2>Before lock</h2>
      <p class="muted small">
        Your lineup as set in Sleeper, kickoff by kickoff. The app can&apos;t alert you when a starter is ruled out, so this says what to change before each
        game starts and when to look again.
        {check.locked ? ` ${check.locked} starter${check.locked === 1 ? ' is' : 's are'} already playing.` : ''}
      </p>
      {check.now.length ? (
        <>
          <h3>Now</h3>
          <ul class="problems">
            {check.now.map((item) => (
              <li class={itemClass(item)}>{itemText(item, now)}</li>
            ))}
          </ul>
        </>
      ) : null}
      {check.windows.map((w) => (
        <>
          <h3>
            {kickoffLabel(w.kickoff, now)}
            <span class="muted small">
              {' '}
              · {w.starters.length} starter{w.starters.length === 1 ? '' : 's'} lock
            </span>
          </h3>
          {w.items.length ? (
            <ul class="problems">
              {w.items.map((item) => (
                <li class={itemClass(item)}>{itemText(item, now)}</li>
              ))}
            </ul>
          ) : (
            <p class="muted small">Nothing to change.</p>
          )}
        </>
      ))}
    </div>
  );
}

/** One line for the Home card: the next kickoff that locks a starter, and how much is due before it. */
export function NextLock({ a, now }: { a: LineupAnalysis; now: number }) {
  const check = beforeLock(a);
  const next = check.windows[0];
  if (!next) return null;
  const todo = check.now.length + next.items.filter((i) => i.kind !== 'watch').length;
  const watch = next.items.filter((i) => i.kind === 'watch').length;
  const parts = [todo ? `${todo} change${todo === 1 ? '' : 's'} due` : 'nothing to change'];
  if (watch) parts.push(`${watch} Questionable to check at inactives`);
  return (
    <p class="small next-lock">
      Next lock {kickoffLabel(next.kickoff, now)}: {parts.join(', ')}.
    </p>
  );
}
