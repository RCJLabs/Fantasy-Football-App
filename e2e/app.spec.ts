import { expect, test, type Page } from '@playwright/test';
import * as fx from './fixtures';

/** The keeper (1001) and dynasty (1003) leagues share teams, schedule and claims; only the dynasty one has traded picks. */
const leagueBody = (id: string, rest: string): unknown =>
  rest === 'rosters' ? fx.rosters
  : rest === 'users' ? fx.users
  : rest === 'matchups/6' ? fx.matchups
  : rest.startsWith('matchups/') ? (Number(rest.split('/').pop()) < 6 ? fx.pastMatchups : fx.futureMatchups)(Number(rest.split('/').pop()))
  : rest.startsWith('transactions/') ? fx.transactions.filter((t) => t.leg === Number(rest.split('/').pop()))
  : rest === 'traded_picks' ? (id === '1003' ? fx.tradedPicks : [])
  : rest === 'drafts' ? (id === '1001' ? fx.drafts : [])
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
      : path === '/draft/d2026/picks' ? fx.draftPicks
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
  await page.route('**/data/nextseason.json', (route) => route.fulfill({ json: fx.nextSeason }));
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
  // The app's lineup pick for week 3, as an earlier visit would have saved it: the lineup that turned out best.
  await page.addInitScript(() =>
    localStorage.setItem('ff:advice:1001:3', JSON.stringify({ at: 0, starters: ['q1', 'r1', 'r2', 'w1', 'w2', 't1', 'w3', 'k1', 'd1'] })),
  );
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
  await expect(card.locator('.next-lock')).toHaveText(/^Next lock .+: 2 changes due, 1 Questionable to check at inactives\.$/);
  // Across leagues: the keeper and dynasty test leagues share one roster, so every starter is in both lineups.
  const across = page.locator('.card.across');
  const lists = across.locator('.across-list');
  await expect(lists.nth(0).locator('li').first()).toContainText('Drew Flanker WR·DDD · 2 leagues · 74% to play'); // the likeliest to miss first
  await expect(lists.nth(0)).toContainText('and 3 more');
  await expect(lists.nth(1).locator('li').first()).toContainText(
    /CCC@DDD .+ · 8 starter spots: Avery Tightend \(2\), Casey Quarterback \(2\), Drew Flanker \(2\), Kai Kicker \(2\)/,
  );
  await across.getByRole('button', { name: 'Compare waiver boards' }).click();
  const shared = lists.nth(2).locator('li').first();
  await expect(shared).toContainText('Free Agent Runner RB·EEE');
  await expect(shared).toContainText('About the same in each:');
  await expect(shared).toContainText('Saturday Night Gridiron +72.0 ($21)');
  await expect(shared).toContainText('Gridiron Dynasty +72.0 ($21)');
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });

  // Lineup: bench the Out RB, keep the locked WR, explain a player.
  await card.getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Make these changes' })).toBeVisible();
  await expect(page.locator('.changes')).toContainText('over Riley Runner');
  await expect(page.locator('.changes')).toContainText('Start Morgan Halfback');
  // Before lock: the lineup set in Sleeper, kickoff by kickoff.
  const lock = page.locator('.card.before-lock');
  await expect(lock).toContainText('1 starter is already playing.');
  await expect(lock.locator('ul.problems').first()).toHaveText('Start Casey Depth over Jordan Back, who has no game this week.');
  await expect(lock.locator('h3').nth(1)).toContainText('· 5 starters lock');
  await expect(lock.locator('ul.problems').nth(1)).toContainText('Start Morgan Halfback over Riley Runner, who is Out.');
  await expect(lock.locator('ul.problems').nth(1)).toContainText(
    /Drew Flanker is Questionable \(74% to play\)\. Inactives come out about .+\. Nobody on your bench can fill WR if he's out\./,
  );
  await expect(lock.locator('h3').nth(2)).toContainText('· 2 starters lock');
  await expect(lock).toContainText('Nothing to change.');
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
  // Points against what his usage was worth: context only.
  await expect(flanker).toContainText('Running hot: 19.4 PPR points a game over 3 recent games, against 13.1 his usage was worth (4 TDs, 1.2 expected).');
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
  // The board flags the next man up behind a starter who's out now.
  await expect(board.locator('tbody tr', { hasText: 'Next Man Runner' })).toContainText('next up: Riley Runner is Out');
  // Handcuffs: the next men up behind my QB and my RB, both free agents. No other QB is free, so the QB's backup would fill an empty slot.
  const cuffs = page.locator('.card', { has: page.getByRole('heading', { name: 'Handcuffs' }) });
  await expect(cuffs.locator('li')).toHaveCount(2);
  await expect(cuffs.locator('li').first()).toContainText(
    'Casey Quarterback QB → Backup Passer, a free agent. If Casey Quarterback misses a week, Backup Passer projects 15.5 instead of 0.9. Insurance: +15.2',
  );
  await expect(cuffs.locator('li').nth(1)).toContainText(/^Riley Runner RB → Next Man Runner, a free agent\. .*projects 11\.8 instead of 5\.5\. Insurance: \+\d+\.\d over the rest of the season\.$/);
  // Claim plan: with two open roster spots, the best free agent goes into one, bid from the league's prices.
  const plan = page.locator('.card', { has: page.getByRole('heading', { name: 'Claim plan' }) });
  await expect(plan.locator('ol > li').first()).toContainText('Add Free Agent Runner RB·EEE into an open spot · bid $21');
  // My IR slot is taken (Pat Injured), so no IR stash card.
  await expect(page.getByRole('heading', { name: 'IR stash' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('waivers.png'), fullPage: true });

  // Season: team grades, standings with playoff odds and my remaining schedule.
  await page.getByRole('tab', { name: 'Season' }).click();
  const grades = page.locator('.card', { has: page.getByRole('heading', { name: 'Team grades' }) });
  await expect(grades.locator('thead')).toContainText('Grade');
  await expect(grades.locator('thead')).toContainText('Playoffs');
  await expect(grades.locator('tbody tr')).toHaveCount(4);
  await expect(grades.locator('tbody tr.mine td').nth(1)).toHaveText(/^[SABCDF]$/);
  // My team is the only full roster: S overall and first in every part; its lowest grade is an A on playoff odds, where the rival is close.
  await expect(grades.locator('p').first()).toHaveText('Your team: S (1st of 4). Highest grade: bench depth (S, 1st); lowest: playoff odds (A, 1st).');
  const standings = page.locator('.card', { has: page.getByRole('heading', { name: 'Standings outlook' }) }).locator('table');
  await expect(standings.locator('thead')).toContainText('Playoffs');
  await expect(standings.locator('thead')).toContainText('Title');
  await expect(standings.locator('tr.mine')).toContainText('Test Titans');
  // Weeks ahead: the Out RB is back in week 7; week 8's bye opens a hole a free agent fills; the final is labelled.
  const ahead = page.locator('.card', { has: page.getByRole('heading', { name: 'Weeks ahead' }) });
  await expect(ahead.locator('p').first()).toHaveText('Holes in your lineup: week 8. In the playoff week your best lineup ranks 1st of 4.');
  await expect(ahead.locator('tbody tr')).toHaveCount(12); // weeks 7–15, three with notes
  await expect(ahead.locator('tr.plan-note').first()).toHaveText('Back: Riley Runner');
  await expect(ahead.locator('tr.hole')).toContainText('Rival Raiders');
  await expect(ahead.locator('tr.hole + tr.plan-note')).toHaveText(/^Bye: Jordan Back · Best pickup: Free Agent Runner \(RB\) \+\d+\.\d$/);
  await expect(ahead.locator('tbody tr').nth(-2)).toContainText('Playoffs, final');
  await expect(ahead.locator('tbody tr').last()).toHaveText('Your lineup ranks 1st of 4');
  // Season so far, from weeks 1–5's final scores: luck, lineups against the best in hindsight, and the saved pick for week 3.
  const sofar = page.locator('.card', { has: page.getByRole('heading', { name: 'Season so far' }) });
  await expect(sofar.locator('p').first()).toHaveText(
    "Record 4-1 (3-2 against the league median). Your weekly scores beat 67% of the others' (all-play 10-5), worth 3.3 wins on an average schedule: the schedule has given you about 0.7 more. Points against: 510.0, the fewest in the league.",
  );
  await expect(sofar.locator('p').nth(1)).toHaveText('Your lineups scored 595.0 of a possible 611.0 (97%), leaving 16.0 on the bench. The league averages 99%; you rank 4th of 4.');
  await expect(sofar.locator('p').nth(2)).toHaveText('The app saved its lineup pick on this device in 1 of these weeks: its lineups scored 132.0, yours 119.0 (−13.0).');
  const weeks = sofar.locator('table.review tbody tr');
  await expect(weeks).toHaveCount(5);
  await expect(weeks.nth(2).locator('td')).toHaveText(['3', 'W 119.0–105.0', '132.0', '3rd /4', '132.0']);
  await expect(weeks.nth(1).locator('td').nth(1)).toHaveClass(/bad/);
  // Players against their projections: the WR running hot first, the depth RB last.
  const vs = sofar.locator('table.review-players tbody tr');
  await expect(vs.first()).toContainText('Taylor Wideout');
  await expect(vs.first().locator('td').last()).toHaveText('+7.4');
  await expect(vs.last()).toContainText('Casey Depth');
  // Keeper league: long-term outlook from (mocked) FantasyCalc dynasty values, with my two likely keepers.
  await expect(page.getByRole('heading', { name: 'Long-term outlook' })).toBeVisible();
  await expect(page.locator('ol.core li')).toHaveCount(2);
  await expect(page.locator('ol.core li').first()).toContainText('Casey Quarterback');
  await page.screenshot({ path: testInfo.outputPath('season.png'), fullPage: true });

  // Trade ideas: in this league no trade helps both lineups enough (the other rosters are nearly empty).
  await page.getByRole('tab', { name: 'Trade' }).click();
  await page.locator('.card.ideas').getByRole('button', { name: 'Find trades' }).click();
  await expect(page.locator('.card.ideas')).toContainText('No trade found that helps both lineups by enough to matter.');
  // Buy low, sell high: my receiver is running hot; their running back is running cold and would start for me.
  const streaks = page.locator('.card.streaks .streak-list');
  await expect(streaks.first()).toContainText('Drew Flanker');
  await expect(streaks.first()).toContainText('19.4 a game over 3 games, usage worth 13.1 · 4 TDs, 1.2 expected');
  await expect(streaks.nth(1)).toContainText('Opp Rusher');
  await expect(streaks.nth(1)).toContainText('Rival Raiders');
  await expect(streaks.nth(1)).toContainText('8.2 a game over 4 games, usage worth 13.6 · 0 TDs, 2.1 expected');

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
  // A buy-low target opens in the builder against his team.
  await streaks.nth(1).getByRole('button', { name: 'Open in the builder' }).click();
  await expect(page.getByLabel('Trade with')).toHaveValue('2');
  await expect(page.locator('fieldset', { hasText: 'You get' }).getByRole('checkbox', { name: /Opp Rusher/ })).toBeChecked();
  await expect(page.locator('fieldset', { hasText: 'You give' }).getByRole('checkbox', { checked: true })).toHaveCount(0);
  // What would it take: the buy-low running back, priced in packages of my players.
  await streaks.nth(1).getByRole('button', { name: 'What would it take?' }).click();
  const takes = page.locator('.card.takes');
  await expect(takes.getByLabel('Player you want')).toHaveValue('o2');
  await expect(takes).toContainText('Opp Rusher would start for you in every week ahead.');
  const best = takes.locator('ol.idea-list li').first();
  await expect(best).toContainText('Give Jordan Back + Casey Depth');
  await expect(best).toContainText(/You \+[\d.]+ pts \(80%: [−+][\d.]+ to [−+][\d.]+\) · them \+[\d.]+ pts/);
  // Neither has a FantasyCalc value in the mocked market.
  await expect(best).toContainText('Market value: you give 0 (2 players have no value), you get 3.4k (they may see it as lopsided)');
  await best.getByRole('button', { name: 'Open in the builder' }).click();
  await expect(page.getByLabel('Trade with')).toHaveValue('2');
  const giving = page.locator('fieldset', { hasText: 'You give' }).getByRole('checkbox', { checked: true });
  await expect(giving).toHaveCount(2);
  await expect(page.locator('fieldset', { hasText: 'You get' }).getByRole('checkbox', { name: /Opp Rusher/ })).toBeChecked();
  // Their quarterback would sit behind mine: nothing of mine helps both lineups, so the card shows what it would cost.
  await takes.getByLabel('Player you want').selectOption('o1');
  await expect(takes).toContainText("Opp Passer wouldn't start for you in any week ahead.");
  await expect(takes).toContainText('No package helps both lineups. These help theirs at the least cost to yours:');
  await expect(takes.locator('ol.idea-list li').first()).toContainText(/Give Casey Quarterback\s*You −[\d.]+ pts/);
  await takes.screenshot({ path: testInfo.outputPath('what-it-takes.png') });
});

test("claim plan: a full roster gets drops, a backup for the same drop, and bids from what's left", async ({ page }, testInfo) => {
  // Two more bench players fill my roster; two good receivers are free agents.
  const rosters = fx.rosters.map((r) => (r.roster_id === 1 ? { ...r, players: [...(r.players ?? []), 'fa2', 'q2'] } : r));
  const wr = (id: string, name: string, recYd: number) => ({
    player_id: id,
    stats: { rec: recYd / 13, rec_yd: recYd, rec_td: recYd / 160, pts_ppr: 10 },
    team: 'HHH',
    company: 'rotowire',
    player: { first_name: name.split(' ')[0], last_name: name.split(' ')[1], position: 'WR', fantasy_positions: ['WR'], team: 'HHH', injury_status: null },
  });
  const receivers = [wr('x1', 'Deep Threat', 95), wr('x2', 'Route Runner', 85)];
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
  await page.getByRole('tab', { name: 'Waivers' }).click();
  const claims = page.locator('.card', { has: page.getByRole('heading', { name: 'Claim plan' }) }).locator('ol > li');
  await expect(claims).toHaveCount(3);
  await expect(claims.nth(0)).toContainText('Add Free Agent Runner RB·EEE, drop Waiver Receiver · bid $21');
  // If the runner goes elsewhere, the IR stash takes the same roster spot, for no more than the claim's bid.
  await expect(claims.nth(0)).toContainText(/If that fails: Stash Runner RB·HHH, same drop · bid \$(\d+)/);
  const backupBid = Number(/same drop · bid \$(\d+)/.exec((await claims.nth(0).textContent()) ?? '')![1]);
  expect(backupBid).toBeLessThanOrEqual(21);
  // The next claims assume the first went through: new drops, and bids from the $49 left.
  await expect(claims.nth(1)).toContainText('Add Deep Threat WR·HHH, drop Backup Passer · bid $17');
  await expect(claims.nth(2)).toContainText('Add Route Runner WR·HHH, drop Sam Slot · bid $11');
  await page.locator('.card', { has: page.getByRole('heading', { name: 'Claim plan' }) }).screenshot({ path: testInfo.outputPath('claims.png') });
});

test('IR stash: with an open IR slot, an injured free agent who comes back in week 10', async ({ page }, testInfo) => {
  const rosters = fx.rosters.map((r) => (r.roster_id === 1 ? { ...r, reserve: [] } : r));
  await page.route('https://api.sleeper.app/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/v1/', '/');
    return path === '/league/1001/rosters' ? route.fulfill({ json: rosters }) : route.fallback();
  });
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('testuser');
  await page.getByRole('button', { name: 'Find my leagues' }).click();
  await page.locator('.league-card').filter({ hasText: 'Saturday Night Gridiron' }).getByRole('link').first().click();
  await page.getByRole('tab', { name: 'Waivers' }).click();
  const card = page.locator('.card', { has: page.getByRole('heading', { name: 'IR stash' }) });
  await expect(card.locator('p').first()).toHaveText("You have 1 open IR slot. Injured free agents who can go straight into one, by what they add once they're back:");
  const row = card.locator('tbody tr').first();
  await expect(row).toContainText('Stash Runner');
  await expect(row).toContainText('IR · 12.5 a game when back');
  await expect(row.locator('td').nth(1)).toHaveText('wk 10');
  await expect(row.locator('td').nth(2)).toHaveText(/^\+\d+\.\d$/);
  await expect(card.locator('thead')).toContainText('Playoffs');
  await card.screenshot({ path: testInfo.outputPath('ir-stash.png') });
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
  // Weeks 1–5 are scored (my team's from the shared fixture), so the season review has ten teams to compare.
  const pairings = (week: number) =>
    Array.from({ length: 10 }, (_, i) => {
      const matchup_id = Math.floor(((i + week) % 10) / 2) + 1;
      if (week < 6) return i === 0 ? { ...fx.pastMatchups(week)[0]!, matchup_id } : { roster_id: i + 1, matchup_id, starters: [], players: [], points: 80 + ((i * 7 + week * 3) % 50) };
      const m = week === 6 ? fx.matchups.find((x) => x.roster_id === i + 1) : undefined;
      return m ?? { roster_id: i + 1, matchup_id, starters: [], players: [], points: 0 };
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
  // The team grades table too: all ten teams, every column in view.
  const grades = page.locator('.card', { has: page.getByRole('heading', { name: 'Team grades' }) }).locator('table');
  await expect(grades.locator('tbody tr')).toHaveCount(10);
  // Weeks ahead and the season so far (weekly results, players against projections).
  const plan = page.locator('table.plan');
  const review = page.locator('table.review');
  const players = page.locator('table.review-players');
  await expect(review.locator('tbody tr')).toHaveCount(5);
  await expect(players.locator('tbody tr').first()).toBeVisible();
  const fits = async () => {
    for (const [label, table] of [['standings', standings], ['grades', grades], ['weeks ahead', plan], ['season so far', review], ['players', players]] as const) {
      const fit = await table.evaluate((t) => ({ table: t.scrollWidth, wrap: t.parentElement!.clientWidth }));
      expect(fit.table, `${label} ${fit.table}px wide in ${fit.wrap}px`).toBeLessThanOrEqual(fit.wrap);
    }
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

test('draft helper: next season\'s board, keepers, a changeable order and a mock draft', async ({ page }, testInfo) => {
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('testuser');
  await page.getByRole('button', { name: 'Find my leagues' }).click();
  await page.locator('.league-card').filter({ hasText: 'Saturday Night Gridiron' }).getByRole('link').first().click();
  await page.getByRole('tab', { name: 'Draft' }).click();
  await expect(page.getByRole('heading', { name: 'Draft helper · 2027' })).toBeVisible();
  await expect(page.locator('.card').first()).toContainText('2027 projections from 2026 through week 6 and the two seasons before');

  // Board: ranked by value; my WR has no 2027 contract; the rookie placeholder is there.
  const board = page.locator('.card', { has: page.getByRole('heading', { name: 'Board' }) });
  await expect(board.locator('tbody tr').first().locator('td').first()).toHaveText('1');
  await expect(board.locator('tr', { hasText: 'Taylor Wideout' })).toContainText('No contract · 54% move');
  await board.getByRole('button', { name: 'Rookies' }).click();
  await expect(board.locator('tbody tr')).toHaveCount(1);
  await expect(board.locator('tbody tr')).toContainText('Rookie RB: the first taken');
  await board.getByRole('button', { name: 'All' }).click();

  // Keepers: two per team (the league's setting); priced at the last round until the rule says otherwise.
  const keepers = page.locator('.card', { has: page.getByRole('heading', { name: 'Keepers' }) });
  await expect(keepers.getByLabel('Keepers per team')).toHaveValue('2');
  const mine = keepers.locator('tr.mine');
  await expect(mine).toContainText('round 13');
  const lastRule = await mine.textContent();
  await keepers.getByLabel('A keeper costs').selectOption('drafted');
  await expect(mine).not.toHaveText(lastRule!);
  await expect(board.locator('tr.mine').first()).toContainText('Kept · you');

  // Order: random until set; worst record first puts me (4-1) last, picking 4th and 5th.
  const order = page.locator('.card', { has: page.getByRole('heading', { name: 'Draft order' }) });
  await expect(order).toContainText('Random until the league sets it');
  await order.getByRole('button', { name: 'Worst record first' }).click();
  await expect(order).toContainText('Set here, on this device.');
  await expect(order).toContainText('You pick 4th: picks 4, 5, 12, 13…');
  await order.getByRole('button', { name: 'Compare slots' }).click();
  const slots = order.locator('table tbody tr');
  await expect(slots).toHaveCount(4);
  await expect(order.locator('table')).toContainText('best');
  await expect(order.locator('table tr.mine')).toContainText('4th');

  // Mock draft: the three teams ahead pick, I'm on the clock at 1.04, then again at 2.01 (snake).
  const mock = page.locator('.card', { has: page.getByRole('heading', { name: 'Mock draft' }) });
  await mock.getByRole('button', { name: 'Start a mock draft' }).click();
  await expect(mock).toContainText("Pick 1.04 (4th overall): you're on the clock.");
  await expect(mock.locator('table tbody tr').first()).toContainText('%');
  await mock.locator('table tbody tr').first().getByRole('button', { name: 'Draft' }).click();
  await expect(mock).toContainText("Pick 2.01 (5th overall): you're on the clock.");
  await expect(mock.locator('.draft-recent li').first()).toContainText('1.04 You:');
  await mock.getByRole('button', { name: 'Finish for me' }).click();
  await expect(mock).toContainText('Draft complete.');
  await expect(mock.locator('.draft-team li')).toHaveCount(13);
  await expect(mock.locator('.draft-team')).not.toContainText('—');
  await page.screenshot({ path: testInfo.outputPath('draft.png'), fullPage: true });
  await mock.getByRole('button', { name: 'Undo' }).click();
  await expect(mock).toContainText("Pick 2.01 (5th overall): you're on the clock.");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  // Dynasty leagues: not yet.
  await page.goto('./#/league/1003/draft');
  await expect(page.locator('.card').filter({ hasText: 'Draft helper' })).toContainText('covers redraft and keeper leagues for now');
});

test('live draft: Sleeper\'s order and picks as they happen, with a traded pick', async ({ page }, testInfo) => {
  // The 2027 draft is under way: order Three, me, Rival Raiders, Four; I own Four's 3rd-rounder.
  const live = { ...fx.drafts[0]!, draft_id: 'd2027', season: '2027', status: 'drafting', draft_order: { u3: 1, u1: 2, u2: 3, u4: 4 } };
  const traded = [{ season: '2027', round: 3, roster_id: 4, owner_id: 1, previous_owner_id: 4 }];
  const made: Array<[string, number]> = [['r1', 3], ['w1', 1], ['fa1', 2], ['r2', 4], ['w3', 4]];
  let picks = made.map(([player_id, roster_id], i) => ({ player_id, roster_id, pick_no: i + 1, round: Math.floor(i / 4) + 1, is_keeper: null }));
  await page.route('https://api.sleeper.app/v1/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace('/v1/', '/');
    const body =
      path === '/league/1001/drafts' ? [fx.drafts[0], live]
      : path === '/league/1001/traded_picks' ? traded
      : path === '/draft/d2027' ? live
      : path === '/draft/d2027/picks' ? picks
      : path === '/draft/d2027/traded_picks' ? traded
      : undefined;
    return body === undefined ? route.fallback() : route.fulfill({ json: body });
  });
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('testuser');
  await page.getByRole('button', { name: 'Find my leagues' }).click();
  await page.locator('.league-card').filter({ hasText: 'Saturday Night Gridiron' }).getByRole('link').first().click();
  await page.getByRole('tab', { name: 'Draft' }).click();

  const card = page.locator('.card.live-draft');
  await expect(card).toContainText('Pick 2.02 (6th overall): Rival Raiders on the clock. Your next pick: 2.03, 1 pick away.');
  await expect(card).toContainText('5 picks made');
  await expect(card.locator('th').first()).toHaveText('Best for your lineup at 2.03');
  await expect(card.locator('th').nth(2)).toHaveText('Still there');
  await expect(card.locator('.draft-recent li').first()).toContainText('2.01 Four: Sam Slot');
  // The order comes from Sleeper, and the traded 3rd-rounder is mine.
  const order = page.locator('.card', { has: page.getByRole('heading', { name: 'Draft order' }) });
  await expect(order).toContainText("From Sleeper's draft settings.");
  await expect(order).toContainText('You pick 2nd: picks 2, 7, 10, 12, 15… (traded picks: 1 in)');

  // Rival Raiders pick; on refresh I'm on the clock.
  picks = [...picks, { player_id: 'q1', roster_id: 2, pick_no: 6, round: 2, is_keeper: null }];
  await card.getByRole('button', { name: 'Refresh' }).click();
  await expect(card).toContainText("Pick 2.03 (7th overall): you're on the clock.");
  await expect(card.locator('th').nth(2)).toHaveText('Back at your next');
  await expect(card.locator('.draft-recent li').first()).toContainText('2.02 Rival Raiders: Casey Quarterback');
  await card.screenshot({ path: testInfo.outputPath('live-draft.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test('ask the analyst: Claude answers from the app\'s figures, which the app puts in and checks', async ({ page }, testInfo) => {
  const bodies: Array<Record<string, any>> = [];
  // The values the app sent for the two facts the answer quotes (they move with the fixture's kickoff times).
  const sent: Record<string, string> = {};
  const headers: Array<Record<string, string>> = [];
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST, OPTIONS' };
  await page.route(/^https:\/\/api\.anthropic\.com\/v1\/messages/, (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const body = req.postDataJSON() as Record<string, any>;
    bodies.push(body);
    headers.push(req.headers());
    // Quote the app's own fact ids, plus one id that doesn't exist and one number typed by hand.
    const sheet = body.system[1].text as string;
    const id = (key: string, label: string) => {
      const m = new RegExp(`^\\{(F\\d+)\\} ${label}: (.+)$`, 'm').exec(sheet)!;
      sent[key] = m[2]!;
      return m[1];
    };
    const points = id('points', "This week: Test Titans's expected points with the app's recommended lineup");
    const win = id('win', 'This week: chance Test Titans wins with the recommended lineup');
    const text =
      bodies.length === 1
        ? `Start the recommended lineup: it projects {${points}} points with a {${win}} chance to win. {F999} Sam Slot adds 3.77 points.`
        : `Because {${points}} is the most points any lineup gets.`;
    return route.fulfill({
      headers: cors,
      json: {
        id: `msg_${bodies.length}`,
        type: 'message',
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 300, output_tokens: 400, cache_creation_input_tokens: bodies.length === 1 ? 4200 : 0, cache_read_input_tokens: bodies.length === 1 ? 0 : 4200 },
      },
    });
  });
  await page.goto('./');
  await page.getByLabel('Sleeper username').fill('testuser');
  await page.getByRole('button', { name: 'Find my leagues' }).click();
  await page.locator('.league-card').filter({ hasText: 'Saturday Night Gridiron' }).getByRole('link').first().click();
  await page.getByRole('tab', { name: 'Ask' }).click();

  // The manager's own key, kept on this device.
  await page.getByLabel('Anthropic API key').fill('sk-ant-test-key');
  await page.getByRole('button', { name: 'Save key' }).click();
  await page.getByLabel('Your question').fill('Who should I start at flex?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const first = page.locator('.ask .turn').first();
  await expect(first.locator('.answer')).toContainText('Start the recommended lineup');
  expect(sent.points).toMatch(/^\d+\.\d$/);
  expect(sent.win).toMatch(/%$/);
  await expect(first.locator('.answer')).toHaveText(
    `Start the recommended lineup: it projects ${sent.points} points with a ${sent.win} chance to win. {F999} Sam Slot adds 3.77 points.`,
  );
  await expect(first.locator('.answer mark.unchecked')).toHaveText(['{F999}', '3.77']);
  await expect(first).toContainText("2 numbers marked: not from the app's figures. Cost about $0.030.");

  // A follow-up carries the first exchange as context, with the same fact sheet (so the prompt cache can reuse it).
  await page.getByLabel('Your question').fill('Why?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.locator('.ask .turn').nth(1).locator('.answer')).toHaveText(`Because ${sent.points} is the most points any lineup gets.`);
  await expect(page.locator('.ask .turn').nth(1)).toContainText("Every number comes from the app's figures. Cost about $0.010.");
  await page.screenshot({ path: testInfo.outputPath('ask.png'), fullPage: true });

  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'medium' }, fallbacks: 'default' });
  expect(bodies[0]!.system[1].cache_control).toEqual({ type: 'ephemeral' });
  expect(bodies[1]!.system[1].text).toBe(bodies[0]!.system[1].text);
  expect(bodies[1]!.messages).toHaveLength(1);
  expect(bodies[1]!.messages[0].content).toContain('Earlier in this conversation:\n\nQ: Who should I start at flex?\nA: Start the recommended lineup');
  expect(headers[0]!['x-api-key']).toBe('sk-ant-test-key');
  expect(headers[0]!['anthropic-dangerous-direct-browser-access']).toBe('true');
  expect(headers[0]!['anthropic-beta']).toContain('server-side-fallback-2026-07-01');

  // Removing the key brings back the key form.
  await page.getByRole('button', { name: 'Remove key' }).click();
  await expect(page.getByLabel('Anthropic API key')).toBeVisible();
});
