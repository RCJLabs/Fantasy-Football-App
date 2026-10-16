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
  await page.route('**/data/baseline.json', (route) => route.fulfill({ json: fx.baseline }));
}

test.beforeEach(async ({ page }) => {
  await mockBackends(page);
});

test('About: the scored prediction ledger, once three weeks are in', async ({ page }, testInfo) => {
  await page.route('**/data/ledger.json', (route) => route.fulfill({ json: fx.ledger }));
  await page.goto('./#/about');
  const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: "How did the app's own predictions do?" }) });
  await expect(card).toContainText('2026 weeks 6–8, 42 games');
  // Limited-practice Questionable players pooled over the three weeks: 7 + 9 + 5 of 30 played.
  await expect(card.locator('tr').filter({ hasText: 'Questionable, limited practice' })).toContainText(/30\s*71%\s*70%/);
  await expect(card).toContainText('Points if active: 450 players projected for 5+ PPR who played. Average miss 4.4 points, bias −0.2; 67%');
  await card.screenshot({ path: testInfo.outputPath('ledger.png') });
  // Nothing on the page scrolls sideways (a phone in the mobile project).
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
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
  // Questionable WR, hamstring, limited Friday, played last week (the v1 model): 74%.
  await expect(flanker).toContainText('Chance to play: 74%');
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
  // The in-house baseline, labelled as a second opinion (half PPR: 4 × 0.5 + 5 + 0.3 × 6).
  await expect(flanker).toContainText('Second opinion, not used: 8.8 pts if he plays');
  await expect(flanker).toContainText('games through week 5');
  // An injured player: how long absences with his injury have lasted (2019–2025 history, not a forecast).
  const runner = page.locator('.pl').filter({ hasText: 'Riley Runner' }).first();
  await runner.getByRole('button').click();
  await expect(runner).toContainText('Knee absences (QB/RB/WR/TE, 2019–2025, 213): 28% lasted one game, 46% two or fewer, 70% four or fewer.');
  const defense = page.locator('.pl').filter({ hasText: 'Fff Defense' }).first();
  await defense.getByRole('button').click();
  await expect(defense).toContainText("Second opinion, not used:");
  await expect(defense).toContainText('about as accurate as RotoWire for defenses');
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
  await expect(standings.locator('thead')).toContainText('Title');
  await expect(standings.locator('tr.mine')).toContainText('Test Titans');
  await expect(page.getByRole('heading', { name: 'Your schedule' })).toBeVisible();
  // Keeper league: long-term outlook from (mocked) FantasyCalc dynasty values, with my two likely keepers.
  await expect(page.getByRole('heading', { name: 'Long-term outlook' })).toBeVisible();
  await expect(page.locator('ol.core li')).toHaveCount(2);
  await expect(page.locator('ol.core li').first()).toContainText('Casey Quarterback');
  await page.screenshot({ path: testInfo.outputPath('season.png'), fullPage: true });

  // Trade ideas: in this league no trade helps both lineups enough (the other rosters are nearly empty).
  await page.getByRole('tab', { name: 'Trade' }).click();
  await page.locator('.card.ideas').getByRole('button', { name: 'Find trades' }).click();
  await expect(page.locator('.card.ideas')).toContainText('No trade found that helps both lineups by enough to matter.');

  // Trade: give a WR for their RB and see both sides.
  await page.getByLabel('Trade with').selectOption({ label: 'Rival Raiders' });
  await page.locator('fieldset', { hasText: 'You give' }).getByText('Sam Slot').click();
  await page.locator('fieldset', { hasText: 'You get' }).getByText('Opp Rusher').click();
  await expect(page.locator('.trade-side').first()).toContainText('rest of season');
  await expect(page.locator('.trade-side').first()).toContainText(/playoff odds \S+% → \S+% · title odds \S+% → \S+%/);
  await expect(page.locator('.trade-side').first()).toContainText(/80% range [−+][\d.]+ to [−+][\d.]+ pts; \S+% chance it adds points/);
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

test('a week without Sleeper projections falls back to the baseline, labelled', async ({ page }) => {
  await page.route(/^https:\/\/api\.sleeper\.com\/projections\/nfl\/2026\/6\?/, (route) => route.fulfill({ json: [] }));
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('testuser');
  await page.getByRole('button', { name: 'Find my leagues' }).click();
  await page.locator('.league-card').filter({ hasText: 'Saturday Night Gridiron' }).getByRole('link').first().click();
  await expect(page.getByText("Sleeper's projections aren't available for week 6")).toBeVisible();
  const flanker = page.locator('.pl').filter({ hasText: 'Drew Flanker' }).first();
  await flanker.getByRole('button').click();
  await expect(flanker).toContainText("Our baseline (Sleeper's projections are missing this week), rescored to your league: 8.8 pts");
  await expect(flanker).not.toContainText('Second opinion');
});

test("a missed daily data update is called out on the league page", async ({ page }) => {
  // The daily build didn't run: players.json is two and a half days old.
  const old = new Date(Date.now() - 60 * 3_600_000).toISOString();
  await page.route('**/data/players.json', (route) => route.fulfill({ json: { ...fx.playersFile, generatedAt: old } }));
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('testuser');
  await page.getByRole('button', { name: 'Find my leagues' }).click();
  await page.locator('.league-card').filter({ hasText: 'Saturday Night Gridiron' }).getByRole('link').first().click();
  await expect(
    page.getByText('The daily data update is overdue: practice reports, the official injury report and usage are 2 days old'),
  ).toBeVisible();
});

test("playoffs: odds from Sleeper's bracket, for the final under way", async ({ page }, testInfo) => {
  // Week 16, the final: Test Titans and Rival Raiders won round 1 (week 15) in Sleeper's bracket.
  await page.route('https://api.sleeper.app/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/v1/', '/');
    const body =
      path === '/state/nfl' ? { ...fx.state, week: 16, leg: 16, display_week: 16 }
      : path === '/user/u1/leagues/nfl/2026' ? [fx.playoffLeague]
      : path === '/league/1001/winners_bracket' ? fx.bracket
      : path === '/league/1001/matchups/15' || path === '/league/1001/matchups/16' ? fx.playoffMatchups(Number(path.split('/').pop()))
      : undefined;
    return body === undefined ? route.fallback() : route.fulfill({ json: body });
  });
  await page.route('**/data/schedule.json', (route) => route.fulfill({ json: fx.playoffSchedule }));
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('testuser');
  await page.getByRole('button', { name: 'Find my leagues' }).click();
  await page.locator('.league-card').filter({ hasText: 'Saturday Night Gridiron' }).getByRole('link').first().click();

  await page.getByRole('tab', { name: 'Season' }).click();
  await expect(page.getByText('The regular season is over; the playoffs are below.')).toBeVisible();
  const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Playoffs: final' }) });
  const mine = card.locator('tr.mine');
  await expect(mine).toContainText('Test Titans');
  await expect(mine).toContainText('vs Rival Raiders');
  await expect(card.locator('tbody tr')).toHaveCount(2);
  // In the final, winning the round is winning the title; the two finalists' odds add up to 100%.
  const cells = async (row: number) => (await card.locator('tbody tr').nth(row).locator('td.num').allTextContents()).map((t) => parseFloat(t.replace(/[<>]/g, '')));
  const [a, b] = [await cells(0), await cells(1)];
  expect(a[0]).toBe(a[1]);
  expect(a[1]! + b[1]!).toBeGreaterThanOrEqual(98);
  expect(a[1]! + b[1]!).toBeLessThanOrEqual(101);
  await expect(card).toContainText('Out: Three (semifinals), Four (semifinals).');
  await expect(card).toContainText("From Sleeper's bracket");
  await page.screenshot({ path: testInfo.outputPath('playoffs.png'), fullPage: true });

  // Waivers: still alive, so the rest of the bracket counts in full (here there's no week after this one).
  await page.getByRole('tab', { name: 'Waivers' }).click();
  await expect(page.getByText(/In the playoffs, each round you could still play counts in full/)).toBeVisible();
});

test('phone layout: nothing pushes the page sideways, and a 10-team standings table fits', async ({ page }, testInfo) => {
  // Ten teams with long names, as real leagues have; rosters 3–10 are empty.
  const names = [
    'Test Titans',
    'Rival Raiders',
    'The Gridiron Gladiators',
    'Supercalifragilisticteam',
    'Brockton Mountain Goats',
    'Sunday Funday Squad',
    'Waiver Wire Warriors',
    'Bakers Dozen Plus One',
    'Fourth And Long Shots',
    'Hail Mary Hopefuls',
  ];
  const rosters = names.map((_, i) => fx.rosters[i] ?? { roster_id: i + 1, owner_id: `u${i + 1}`, players: [], starters: [], settings: { wins: i % 5, losses: 5 - (i % 5) } });
  const users = names.map((n, i) => ({ user_id: `u${i + 1}`, display_name: `user${i + 1}`, metadata: { team_name: n } }));
  const pairings = (week: number) =>
    Array.from({ length: 10 }, (_, i) => {
      const m = week === 6 ? fx.matchups.find((x) => x.roster_id === i + 1) : undefined;
      return m ?? { roster_id: i + 1, matchup_id: Math.floor(((i + week) % 10) / 2) + 1, starters: [], players: [], points: 0 };
    });
  const tenTeams = { ...fx.league, total_rosters: 10, settings: { ...fx.league.settings, num_teams: 10, playoff_teams: 6 } };
  await page.route('https://api.sleeper.app/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/v1/', '/');
    const week = /^\/league\/1001\/matchups\/(\d+)$/.exec(path);
    const body =
      path === '/user/u1/leagues/nfl/2026' ? [tenTeams]
      : path === '/league/1001/rosters' ? rosters
      : path === '/league/1001/users' ? users
      : week ? pairings(Number(week[1]))
      : undefined;
    return body === undefined ? route.fallback() : route.fulfill({ json: body });
  });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('testuser');
  await page.getByRole('button', { name: 'Find my leagues' }).click();
  await page.locator('.league-card').filter({ hasText: 'Saturday Night Gridiron' }).getByRole('link').first().click();
  for (const tab of ['Lineup', 'Matchup', 'Waivers', 'Trade', 'Season']) {
    await page.getByRole('tab', { name: tab }).click();
    await expect(page.locator('.card').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    expect(await overflow(), `${tab} tab scrolls sideways`).toBeLessThanOrEqual(0);
  }
  // Season: every column of the standings, Title included, fits without scrolling.
  const standings = page.locator('.card', { has: page.getByRole('heading', { name: 'Standings outlook' }) }).locator('table');
  await expect(standings.locator('thead')).toContainText('Title');
  const fits = async () => {
    const fit = await standings.evaluate((t) => ({ table: t.scrollWidth, wrap: t.parentElement!.clientWidth }));
    expect(fit.table, `standings ${fit.table}px wide in ${fit.wrap}px`).toBeLessThanOrEqual(fit.wrap);
  };
  await fits();
  await page.screenshot({ path: testInfo.outputPath('phone-season.png'), fullPage: true });
  // A smaller phone (360px): still no sideways page, and the standings still fit.
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 360, height: 780 });
    expect(await overflow(), 'Season tab scrolls sideways at 360px').toBeLessThanOrEqual(0);
    await fits();
    for (const tab of ['Waivers', 'Trade', 'Lineup']) {
      await page.getByRole('tab', { name: tab }).click();
      await page.waitForLoadState('networkidle');
      expect(await overflow(), `${tab} tab scrolls sideways at 360px`).toBeLessThanOrEqual(0);
    }
    await page.getByRole('tab', { name: 'Season' }).click();
    await expect(page.getByRole('heading', { name: 'Standings outlook' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('phone-season-360.png'), fullPage: true });
  }
});

test('trade ideas: a team with four WRs and no RB takes one of my running backs', async ({ page }, testInfo) => {
  // Team "Three" gets four receivers (x1–x4) and no running back; I have RBs to spare.
  const wr = (id: string, name: string, recYd: number) => ({
    player_id: id,
    stats: { rec: recYd / 13, rec_yd: recYd, rec_td: recYd / 160, pts_ppr: 10 },
    team: 'HHH',
    company: 'rotowire',
    player: { first_name: name.split(' ')[0], last_name: name.split(' ')[1], position: 'WR', fantasy_positions: ['WR'], team: 'HHH', injury_status: null },
  });
  const receivers = [wr('x1', 'Deep Threat', 95), wr('x2', 'Route Runner', 85), wr('x3', 'Slot Specialist', 78), wr('x4', 'Fourth Option', 74)];
  const rosters = fx.rosters.map((r) => (r.roster_id === 3 ? { ...r, players: receivers.map((x) => x.player_id), starters: [] } : r));
  await page.route('https://api.sleeper.app/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/v1/', '/');
    return path === '/league/1001/rosters' ? route.fulfill({ json: rosters }) : route.fallback();
  });
  await page.route(/^https:\/\/api\.sleeper\.com\/projections\/nfl\/2026\/\d+\?/, (route) => {
    const week = Number(new URL(route.request().url()).pathname.split('/').pop());
    return route.fulfill({ json: [...(week === 6 ? fx.projections : fx.futureProjections(week)), ...receivers] });
  });
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('testuser');
  await page.getByRole('button', { name: 'Find my leagues' }).click();
  await page.locator('.league-card').filter({ hasText: 'Saturday Night Gridiron' }).getByRole('link').first().click();
  await page.getByRole('tab', { name: 'Trade' }).click();

  const ideas = page.locator('.card.ideas');
  await ideas.getByRole('button', { name: 'Find trades' }).click();
  const first = ideas.locator('.idea-list li').first();
  await expect(first).toBeVisible();
  // Every idea goes to "Three", and every one sends them a running back.
  for (const idea of await ideas.locator('.idea-list li').all()) {
    await expect(idea).toContainText('(Three)');
    await expect(idea).toContainText(/Give .*(Runner|Halfback|Back|Depth).* for /);
  }
  await expect(first).toContainText(/You \+[\d.]+ pts \(80%: [−+][\d.]+ to [−+][\d.]+\) · them \+[\d.]+ pts · your playoff odds \S+% → \S+%/);
  await page.screenshot({ path: testInfo.outputPath('trade-ideas.png'), fullPage: true });

  // Opening an idea fills the builder and shows the full evaluation.
  await first.getByRole('button', { name: 'Open in the builder' }).click();
  await expect(page.getByLabel('Trade with')).toHaveValue('3');
  await expect(page.locator('fieldset', { hasText: 'You give' }).locator('label.picked')).not.toHaveCount(0);
  await expect(page.locator('fieldset', { hasText: 'You get' }).locator('label.picked')).not.toHaveCount(0);
  await expect(page.locator('.card[aria-live]')).toContainText(/Good for you, and good for them|for you/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
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
