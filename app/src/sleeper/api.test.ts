import { afterEach, describe, expect, it, vi } from 'vitest';
import { getJson, sleeperApi } from './api';

afterEach(() => vi.unstubAllGlobals());

/** The fetch options of each request the call makes. */
async function initsOf(call: () => Promise<unknown>): Promise<Array<RequestInit | undefined>> {
  const fetch = vi.fn(async () => new Response('[]', { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  await call();
  return fetch.mock.calls.map((c) => (c as unknown[])[1] as RequestInit | undefined);
}

describe('Sleeper requests and the browser cache', () => {
  it("asks Sleeper every time for what the app checks again and again, instead of the browser's copy", async () => {
    // Sleeper's game-day headers (s-maxage, stale-while-revalidate, no max-age) would otherwise hand back the copy from the
    // request before (docs/gameday.md).
    for (const call of [
      () => sleeperApi.stats('2026', 6, ['QB']),
      () => sleeperApi.matchups('1001', 6),
      () => sleeperApi.rosters('1001'),
      () => sleeperApi.draft('d1'),
      () => sleeperApi.draftPicks('d1'),
    ]) {
      expect((await initsOf(call))[0]?.cache).toBe('no-cache');
    }
  });

  it('leaves the rest to the browser', async () => {
    for (const call of [() => sleeperApi.league('1001'), () => sleeperApi.users('1001'), () => sleeperApi.projections('2026', 6, ['QB']), () => getJson('https://example.test/x')]) {
      expect((await initsOf(call))[0]?.cache).toBeUndefined();
    }
  });
});
