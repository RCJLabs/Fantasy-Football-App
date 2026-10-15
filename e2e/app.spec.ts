import { expect, test, type Page } from '@playwright/test';
import * as fx from './fixtures';

async function mockBackends(page: Page) {
  await page.route('https://api.sleeper.app/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/v1/', '/');
    const body =
      path === '/state/nfl' ? fx.state
      : path === '/user/testuser' ? fx.user
      : path === '/user/nobody' ? null
      : path === '/user/u1/leagues/nfl/2026' ? [fx.league, fx.otherLeague]
      : path === '/league/1001/rosters' ? fx.rosters
      : path === '/league/1001/users' ? fx.users
      : path === '/league/1001/matchups/6' ? fx.matchups
      : path.startsWith('/players/nfl/trending/add') ? fx.trending
      : undefined;
    return body === undefined ? route.fulfill({ status: 404, body: 'not mocked' }) : route.fulfill({ json: body });
  });
  await page.route('https://api.sleeper.com/projections/nfl/2026/6**', (route) => route.fulfill({ json: fx.projections }));
  await page.route('**/data/players.json', (route) => route.fulfill({ json: fx.playersFile }));
  await page.route('**/data/schedule.json', (route) => route.fulfill({ json: fx.schedule }));
  await page.route('**/data/manifest.json', (route) => route.fulfill({ json: fx.manifest }));
}

test.beforeEach(async ({ page }) => {
  await mockBackends(page);
});

test('unknown username shows an error', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('nobody');
  await page.getByRole('button', { name: 'Find my leagues' }).click();
  await expect(page.getByRole('alert')).toContainText('No Sleeper user named');
});

test('username import → league dashboard → lineup, matchup and waivers', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('testuser');
  await page.getByRole('button', { name: 'Find my leagues' }).click();

  // Dashboard: one in-season league with problems, one pre-draft league.
  await expect(page.getByRole('heading', { name: 'Leagues' })).toBeVisible();
  const card = page.locator('.league-card').filter({ hasText: 'Saturday Night Gridiron' });
  await expect(card).toContainText('4-1');
  await expect(card).toContainText('Riley Runner (RB) is Out');
  await expect(card).toContainText('Better lineup available');
  await expect(page.locator('.league-card').filter({ hasText: 'Dynasty Startup' })).toContainText('pre draft');
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });

  // Lineup: bench the Out RB, keep the locked WR, explain a player.
  await card.getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Make these changes' })).toBeVisible();
  await expect(page.locator('.changes')).toContainText('over Riley Runner');
  await expect(page.locator('.changes')).toContainText('Start Morgan Halfback');
  const flanker = page.locator('.pl').filter({ hasText: 'Drew Flanker' }).first();
  await expect(flanker).toContainText('Q · L');
  await flanker.getByRole('button').click();
  await expect(flanker).toContainText('Chance to play: 65%');
  await expect(flanker).toContainText('limited practice');
  await expect(page.locator('.pl').filter({ hasText: 'Taylor Wideout' }).first()).toContainText('Live');
  await page.screenshot({ path: testInfo.outputPath('lineup.png'), fullPage: true });

  // Matchup
  await page.getByRole('tab', { name: 'Matchup' }).click();
  await expect(page.locator('.versus')).toContainText('Rival Raiders');
  await expect(page.getByText('Win chance with the recommended lineup')).toBeVisible();

  // Waivers: the free-agent RB improves this week's lineup most.
  await page.getByRole('tab', { name: 'Waivers' }).click();
  const first = page.locator('table.table tbody tr').first();
  await expect(first).toContainText('Free Agent Runner');
  await expect(page.locator('table.table')).toContainText('1520');
  await page.screenshot({ path: testInfo.outputPath('waivers.png'), fullPage: true });
});
