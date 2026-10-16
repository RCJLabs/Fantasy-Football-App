import { expect, test, type Page } from '@playwright/test';
import * as fx from './fixtures';

/** The keeper (1001) and dynasty (1003) leagues share teams, schedule and claims; only the dynasty one has traded picks. */
const leagueBody = (id: string, rest: string): unknown =>
  rest === 'rosters' ? fx.rosters
  : rest === 'users' ? fx.users
  : rest === 'matchups/6' ? fx.matchups
  : rest.startsWith('matchups/') ? fx.futureMatchups(Number(rest.split('/').pop()))
  : rest.startsWith('transactions/') ? fx.transactions.filter((t) => t.leg === Number(rest.split('/').pop()))
  : rest === 'traded_picks' ? (id === '1003' ? fx.tradedPicks : [])
  : undefined;

async function mockBackends(page: Page) {
  await page.route('https://api.sleeper.app/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/v1/', '/');
    const league = /^\/league\/(1001|1003)\/(.+)$/.exec(path);
    const body =
      path === '/state/nfl' ? fx.state
      : path === '/user/testuser' ? fx.user
      : path === '/user/nobody' ? null
      : path === '/user/u1/leagues/nfl/2026' ? [fx.league, fx.otherLeague, fx.dynastyLeague]
      : league ? leagueBody(league[1]!, league[2]!)
      : path.startsWith('/players/nfl/trending/add') ? fx.trending
      : undefined;
    return body === undefined ? route.fulfill({ status: 404, body: 'not mocked' }) : route.fulfill({ json: body });
  });
  await page.route(/^https:\/\/api\.sleeper\.com\/projections\/nfl\/2026\/\d+\?/, (route) => {
    const week = Number(new URL(route.request().url()).pathname.split('/').pop());
    return route.fulfill({ json: week === 6 ? fx.projections : fx.futureProjections(week) });
  });
  await page.route('https://api.fantasycalc.com/**', (route) => {
    const dynasty = new URL(route.request().url()).searchParams.get('isDynasty') === 'true';
    return route.fulfill({ json: dynasty ? [...fx.marketValues, ...fx.pickValues] : fx.marketValues });
  });
  await page.route('**/data/players.json', (route) => route.fulfill({ json: fx.playersFile }));
  await page.route('**/data/schedule.json', (route) => route.fulfill({ json: fx.schedule }));
  await page.route('**/data/manifest.json', (route) => route.fulfill({ json: fx.manifest }));
  await page.route('**/data/usage.json', (route) => route.fulfill({ json: fx.usage }));
  await page.route('**/data/matchups.json', (route) => route.fulfill({ json: fx.matchupContext }));
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
  // Recent usage from nflverse: weeks 2–5, a missed game shown as a dash.
  const usage = flanker.locator('table.usage');
  await expect(usage).toContainText('Recent usage');
  await expect(usage.locator('tr', { hasText: 'Snaps' })).toContainText('80%85%–90%');
  await expect(usage.locator('tr', { hasText: 'Targets' })).toContainText('9 (25%)');
  await expect(usage).not.toContainText('Carries');
  // Matchup context: CCC against WRs, and its regular cornerback who's out.
  await expect(flanker).toContainText('WRs facing CCC have scored 2.3 PPR more a game than their usual (5 games');
  await expect(flanker).toContainText('CCC cornerbacks out: Corner Back (92% of snaps, Out).');
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
  await expect(first).toContainText('snaps 45→61→84% · 62% of carries');
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

test('dynasty league: draft picks in trades and the long-term outlook', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('testuser');
  await page.getByRole('button', { name: 'Find my leagues' }).click();
  await page.locator('.league-card').filter({ hasText: 'Gridiron Dynasty' }).getByRole('link').first().click();

  // Trade: I own Rival Raiders' 2027 1st, priced by their projected finish. A picks-only deal still gets a value.
  await page.getByRole('tab', { name: 'Trade' }).click();
  await page.getByLabel('Trade with').selectOption({ label: 'Rival Raiders' });
  const give = page.locator('fieldset', { hasText: 'You give' });
  const theirFirst = give.locator('label').filter({ hasText: '2027 1st' }).filter({ hasText: 'Rival Raiders' });
  await expect(theirFirst).toContainText(/proj\. (Early|Mid|Late)/);
  await expect(theirFirst).toContainText(/LT \d/);
  await theirFirst.click();
  const card = page.locator('.card[aria-live]');
  await expect(card).toContainText("Picks only: no change to this season's lineups");
  await expect(card.locator('.market')).toContainText('This season: picks have no value');
  await expect(card.locator('.market')).toContainText(/Long term \(dynasty values\): you give \d/);
  // They hold my 2028 2nd (FantasyCalc's flat price for the round).
  const get = page.locator('fieldset', { hasText: 'You get' });
  await expect(get.locator('label').filter({ hasText: '2028 2nd' }).filter({ hasText: 'Test Titans' })).toContainText('LT 1.3k');
  // Adding a player brings back the lineup verdict.
  await get.getByText('Opp Rusher').click();
  await expect(card).toContainText(/for you/);
  await page.screenshot({ path: testInfo.outputPath('dynasty-trade.png'), fullPage: true });

  // Season: the long-term ranking counts each team's picks.
  await page.getByRole('tab', { name: 'Season' }).click();
  await expect(page.getByRole('heading', { name: 'Long-term outlook' })).toBeVisible();
  await expect(page.locator('table.table thead').filter({ hasText: 'Picks' })).toBeVisible();
  await expect(page.getByText('Your picks:')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('dynasty-season.png'), fullPage: true });
});
