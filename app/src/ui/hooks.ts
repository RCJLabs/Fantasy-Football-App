import { useCallback, useEffect, useState } from 'preact/hooks';
import { logError } from './errorLog';

export interface AsyncState<T> {
  data?: T;
  error?: Error;
  loading: boolean;
  /** Re-run the loader; `force` bypasses caches. */
  reload: (force?: boolean) => void;
}

export function useAsync<T>(load: (force: boolean) => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<{ data?: T; error?: Error; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState<{ n: number; force: boolean }>({ n: 0, force: false });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    load(nonce.force).then(
      (data) => alive && setState({ data, loading: false }),
      (e: unknown) => {
        logError(e);
        if (alive) setState((s) => ({ ...s, error: e instanceof Error ? e : new Error(String(e)), loading: false }));
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce.n]);
  const reload = useCallback((force = false) => setNonce((x) => ({ n: x.n + 1, force })), []);
  return { ...state, reload };
}

/** Current hash route split into segments: "#/league/123/waivers" → ["league", "123", "waivers"]. */
export function useRoute(): string[] {
  const parse = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

/** Re-render every `ms` (keeps "locked"/"live" states and timestamps current). */
export function useTick(ms: number): number {
  const [t, setT] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setT(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return t;
}
