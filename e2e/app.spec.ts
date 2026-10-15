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
      : path.startsWith('/league/1001/matchups/') ? fx.futureMatchups(Number(path.split('/').pop()))
      : path.startsWith('/league/1001/transactions/') ? fx.transactions.filter((t) => t.leg === Number(path.split('/').pop()))
      : path.startsWith('/players/nfl/trending/add') ? fx.trending
      : undefined;
    return body === undefined ? route.fulfill({ status: 404, body: 'not mocked' }) : route.fulfill({ json: body });
  });
  await page.route(/^https:\/\/api\.sleeper\.com\/projections\/nfl\/2026\/\d+\?/, (route) => {
    const week = Number(new URL(route.request().url()).pathname.split('/').pop());
    return route.fulfill({ json: week === 6 ? fx.projections : fx.futureProjections(week) });
  });
  await page.route('https://api.fantasycalc.com/**', (route) => route.fulfill({ json: fx.marketValues }));
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
  await expect(flanker).toContainText('Chance to play: 71%');
  await expect(flanker).toContainText('limited practice on the final report');
  await expect(page.locator('.pl').filter({ hasText: 'Taylor Wideout' }).first()).toContainText('Live');
  await page.screenshot({ path: testInfo.outputPath('lineup.png'), fullPage: true });

  // Lineup mode: switch to win chance and back; the choice is explained either way.
  const mode = page.getByRole('group', { name: 'Optimize lineup for' });
  await expect(mode.getByRole('button', { name: 'Max points' })).toHaveAttribute('aria-pressed', 'true');
  await mode.getByRole('button', { name: 'Win chance' }).click();
  await expect(mode.getByRole('button', { name: 'Win chance' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Tuned for win chance|max-points lineup is also your best shot/)).toBeVisible();
  await mode.getByRole('button', { name: 'Max points' }).click();

  // Matchup
  await page.getByRole('tab', { name: 'Matchup' }).click();
  await expect(page.locator('.versus')).toContainText('Rival Raiders');
  await expect(page.getByText('Win chance with the recommended lineup')).toBeVisible();

  // Waivers: the free-agent RB helps most this week and for the rest of the season, with a FAAB bid.
  await page.getByRole('tab', { name: 'Waivers' }).click();
  const board = page.locator('table.table').first();
  const first = board.locator('tbody tr').first();
  await expect(first).toContainText('Free Agent Runner');
  await expect(board.locator('thead')).toContainText('ROS');
  await expect(board.locator('thead')).toContainText('Bid');
  await expect(first.locator('td').nth(3)).toHaveText(/^\$\d+$/);
  await expect(board).toContainText('1520');
  await expect(page.getByText('FAAB: you have $70 of $100 left.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Streaming' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('waivers.png'), fullPage: true });

  // Season: standings with playoff odds and my remaining schedule.
  await page.getByRole('tab', { name: 'Season' }).click();
  const standings = page.locator('table.table').first();
  await expect(standings.locator('thead')).toContainText('Playoffs');
  await expect(standings.locator('tr.mine')).toContainText('Test Titans');
  await expect(page.getByRole('heading', { name: 'Your schedule' })).toBeVisible();
  // Keeper league: long-term outlook from (mocked) FantasyCalc dynasty values, with my two likely keepers.
  await expect(page.getByRole('heading', { name: 'Long-term outlook' })).toBeVisible();
  await expect(page.locator('ol.core li')).toHaveCount(2);
  await expect(page.locator('ol.core li').first()).toContainText('Casey Quarterback');
  await page.screenshot({ path: testInfo.outputPath('season.png'), fullPage: true });

  // Trade: give a WR for their RB and see both sides.
  await page.getByRole('tab', { name: 'Trade' }).click();
  await page.getByLabel('Trade with').selectOption({ label: 'Rival Raiders' });
  await page.locator('fieldset', { hasText: 'You give' }).getByText('Sam Slot').click();
  await page.locator('fieldset', { hasText: 'You get' }).getByText('Opp Rusher').click();
  await expect(page.locator('.trade-side').first()).toContainText('rest of season');
  await expect(page.locator('.trade-side').nth(1)).toContainText('Rival Raiders');
  await expect(page.locator('.card[aria-live]')).toContainText(/for you/);
  // Market value (FantasyCalc, mocked) shown apart from the lineup verdict, and the week-by-week bye grid.
  await expect(page.locator('.card[aria-live] .market')).toContainText('This season: you give 2.1k, you get 3.4k');
  await expect(page.locator('.card[aria-live] .market')).toContainText('Long term (dynasty values): you give 2.1k, you get 3.4k');
  await expect(page.getByRole('link', { name: 'FantasyCalc' }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your weeks after the trade' })).toBeVisible();
  await expect(page.locator('table.byes tbody tr')).toHaveCount(9); // weeks 7–15
  await page.screenshot({ path: testInfo.outputPath('trade.png'), fullPage: true });
});
