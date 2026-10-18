import { describe, expect, it } from 'vitest';
import { compactPlayers, csvRecords, easternToUtcIso, gamesFromCsv, isEasternDst, latestInjuryReport, missedLastGame, parseCsv, practiceStatus, projectionAccuracy, sleeperToEspn, sleeperToGsis, toSleeperTeam } from './lib';

describe('csv', () => {
  it('handles quotes, escaped quotes, empty quoted fields and CRLF', () => {
    expect(parseCsv('a,b,c\r\n1,"x, y",""\n2,"say ""hi""",z')).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', ''],
      ['2', 'say "hi"', 'z'],
    ]);
  });
  it('maps rows to records and skips blank lines', () => {
    expect(csvRecords('h1,h2\nv1,v2\n\n')).toEqual([{ h1: 'v1', h2: 'v2' }]);
  });
});

describe('time zones', () => {
  it('knows US Eastern DST boundaries for 2026', () => {
    expect(isEasternDst(2026, 9, 18)).toBe(true); // Oct 18
    expect(isEasternDst(2026, 10, 1)).toBe(false); // Nov 1: DST ends that morning
    expect(isEasternDst(2026, 9, 31)).toBe(true); // Oct 31
    expect(isEasternDst(2026, 2, 8)).toBe(true); // Mar 8: second Sunday
    expect(isEasternDst(2026, 2, 7)).toBe(false);
    expect(isEasternDst(2026, 11, 25)).toBe(false);
  });
  it('converts nflverse ET kickoffs to UTC', () => {
    expect(easternToUtcIso('2026-10-15', '20:15')).toBe('2026-10-16T00:15:00.000Z'); // TNF, EDT
    expect(easternToUtcIso('2026-10-18', '09:30')).toBe('2026-10-18T13:30:00.000Z'); // London
    expect(easternToUtcIso('2026-11-01', '13:00')).toBe('2026-11-01T18:00:00.000Z'); // EST
    expect(easternToUtcIso('2026-12-25', '16:30')).toBe('2026-12-25T21:30:00.000Z');
  });
});

describe('schedule', () => {
  const csv = [
    'game_id,season,game_type,week,gameday,weekday,gametime,away_team,home_team,spread_line,total_line,roof',
    '2026_06_SEA_DEN,2026,REG,6,2026-10-15,Thursday,20:15,SEA,DEN,-2.5,40.5,outdoors',
    '2026_06_LA_SF,2026,REG,6,2026-10-18,Sunday,16:25,LA,SF,3,47,""',
    '2025_01_X_Y,2025,REG,1,2025-09-07,Sunday,13:00,X,Y,1,40,dome',
  ].join('\n');
  it('builds games with Sleeper team codes and implied totals (spread positive = home favored)', () => {
    const games = gamesFromCsv(csvRecords(csv), '2026');
    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({ id: '2026_06_SEA_DEN', away: 'SEA', home: 'DEN', homeImplied: 19, awayImplied: 21.5, kickoff: '2026-10-16T00:15:00.000Z' });
    expect(games[1]).toMatchObject({ away: 'LAR', home: 'SF', homeImplied: 25, awayImplied: 22 });
    expect(games[1]!.roof).toBeUndefined();
  });
  it('maps team codes', () => {
    expect(toSleeperTeam('LA')).toBe('LAR');
    expect(toSleeperTeam('KC')).toBe('KC');
  });
});

describe('injury report', () => {
  const csv = [
    'season,season_type,game_type,team,week,gsis_id,position,full_name,report_primary_injury,report_status,practice_primary_injury,practice_status',
    '2026,REG,REG,SEA,5,00-1,WR,A,Hamstring,Questionable,Hamstring,Limited Participation in Practice',
    '2026,REG,REG,SEA,6,00-1,WR,A,Hamstring,Questionable,Hamstring,Did Not Participate In Practice',
    '2026,REG,REG,DEN,6,00-2,RB,B,,,Ankle,Full Participation in Practice',
    '2026,REG,REG,DEN,7,00-3,RB,C,,,Knee,Full Participation in Practice',
  ].join('\n');
  it('takes the latest week up to the current week', () => {
    const rep = latestInjuryReport(csvRecords(csv), 6)!;
    expect(rep.week).toBe(6);
    expect(rep.byGsis.get('00-1')).toEqual({ prac: 'DNP', rpt: 'Questionable', body: 'Hamstring' });
    expect(rep.byGsis.get('00-2')).toEqual({ prac: 'Full', body: 'Ankle' });
    expect(rep.byGsis.has('00-3')).toBe(false);
  });
  it('maps practice wording', () => {
    expect(practiceStatus('Limited Participation in Practice')).toBe('Limited');
    expect(practiceStatus('')).toBeUndefined();
  });
  it('joins practice status to Sleeper players by gsis_id and drops free agents', () => {
    const rep = latestInjuryReport(csvRecords(csv), 6);
    const players = compactPlayers(
      {
        '10': { player_id: '10', full_name: 'A', position: 'WR', team: 'SEA', injury_status: 'Questionable', gsis_id: ' 00-1 ', search_rank: 50 },
        '11': { player_id: '11', full_name: 'Retired', position: 'WR', team: null },
        SEA: { player_id: 'SEA', first_name: 'Seattle', last_name: 'Seahawks', position: 'DEF', team: 'SEA', fantasy_positions: ['DEF'] },
      },
      rep,
    );
    expect(players.map((p) => p.id)).toEqual(['10', 'SEA']);
    expect(players[0]).toMatchObject({ n: 'A', inj: 'Questionable', prac: 'DNP', rpt: 'Questionable', gsis: '00-1', rk: 50 });
    expect(players[1]).toMatchObject({ n: 'Seattle Seahawks', pos: 'DEF' });
    expect(players[1]!.fp).toBeUndefined();
  });
  it('bridges gsis ids through nflverse weekly rosters (sleeper_id, then espn_id)', () => {
    const dump = {
      '20': { player_id: '20', full_name: 'B', position: 'RB', team: 'DEN' },
      '30': { player_id: '30', full_name: 'C', position: 'RB', team: 'DEN', espn_id: 777 },
    };
    const rosters = csvRecords('gsis_id,sleeper_id,espn_id\n00-2,20,1\n00-3,NA,777\nNA,99,5');
    const map = sleeperToGsis(dump, rosters);
    expect(map.get('20')).toBe('00-2');
    expect(map.get('30')).toBe('00-3');
    const players = compactPlayers(dump, latestInjuryReport(csvRecords(csv), 6), map);
    expect(players.find((p) => p.id === '20')).toMatchObject({ gsis: '00-2', prac: 'Full' });
    // The ESPN id rides along for the app's news: Sleeper's own, else nflverse's weekly rosters (by sleeper_id, then gsis).
    expect(players.find((p) => p.id === '30')!.espn).toBe('777');
    expect(players.find((p) => p.id === '20')!.espn).toBeUndefined();
    const espn = sleeperToEspn(dump, rosters, map);
    expect(espn).toEqual(new Map([['30', '777'], ['20', '1'], ['99', '5']]));
    expect(compactPlayers(dump, undefined, map, undefined, espn).find((p) => p.id === '20')!.espn).toBe('1');
    const byGsis = sleeperToEspn({ '40': { player_id: '40', full_name: 'D', position: 'WR', team: 'DEN', espn_id: 'NA' } }, csvRecords('gsis_id,sleeper_id,espn_id\n00-4,NA,444'), new Map([['40', '00-4']]));
    expect(byGsis.get('40')).toBe('444');
  });
  it("flags players who weren't active in their team's last game", () => {
    // SEA played weeks 4 and 5 (week 6 not yet); DEN was on bye in week 5.
    const games = csvRecords(
      ['season,game_type,week,home_team,away_team,home_score', '2026,REG,4,SEA,DEN,24', '2026,REG,5,SEA,KC,17', '2026,REG,6,DEN,SEA,NA'].join('\n'),
    );
    const rosters = csvRecords(
      [
        'season,game_type,week,team,gsis_id,status',
        '2026,REG,4,SEA,00-1,ACT',
        '2026,REG,5,SEA,00-1,INA', // missed week 5
        '2026,REG,6,SEA,00-1,ACT', // week 6 not played yet: ignored
        '2026,REG,4,DEN,00-2,INA',
        '2026,REG,5,DEN,00-2,ACT', // DEN's bye: not a game
        '2026,REG,4,SEA,00-3,RES', // on a reserve list
        '2026,REG,5,SEA,00-3,ACT',
      ].join('\n'),
    );
    expect([...missedLastGame(rosters, games, '2026', 6)].sort()).toEqual(['00-1', '00-2']);
    expect([...missedLastGame(rosters, games, '2026', 5)].sort()).toEqual(['00-2', '00-3']);
    const players = compactPlayers({ '10': { player_id: '10', full_name: 'A', position: 'WR', team: 'SEA', gsis_id: '00-1' } }, undefined, undefined, new Set(['00-1']));
    expect(players[0]!.ml).toBe(1);
  });
});

describe('accuracy ledger', () => {
  const row = (id: string, pos: string, stats: Record<string, number>) => ({ player_id: id, stats, player: { position: pos } });
  it('scores projections of players who played, by position, against the app spread', () => {
    const rows = projectionAccuracy([
      {
        // Offense is rescored from stat lines; Sleeper's own projected pts_ppr is ignored for it.
        proj: [row('a', 'WR', { rec: 5, rec_yd: 50, pts_ppr: 1 }), row('b', 'WR', { rec: 10, rec_yd: 100 }), row('c', 'WR', { rec: 6, rec_yd: 60 }), row('d', 'WR', { rec: 1, rec_yd: 20, pts_ppr: 9 }), row('e', 'DEF', { pts_ppr: 8 })],
        stats: [row('a', 'WR', { pts_ppr: 14, gp: 1 }), row('b', 'WR', { pts_ppr: 10, gp: 1 }), row('c', 'WR', { pts_ppr: 0 }), row('d', 'WR', { pts_ppr: 30, gp: 1 }), row('e', 'DEF', { pts_ppr: 8, pts_allow: 17 })],
      },
    ]);
    // c didn't play and d was projected under 5: both excluded.
    const wr = rows.find((r) => r.pos === 'WR')!;
    expect(wr).toMatchObject({ n: 2, mae: 7, bias: -3, rmse: Math.round(Math.sqrt((16 + 100) / 2) * 100) / 100 });
    // a: |4| ≤ sd(10)=6.6 ✓; b: |10| ≤ sd(20)=13.2 ✓.
    expect(wr.within1).toBe(1);
    expect(rows.find((r) => r.pos === 'DEF')).toMatchObject({ n: 1, mae: 0 });
    expect(rows.at(-1)).toMatchObject({ pos: 'ALL', n: 3 });
  });

  it("rescores QB projections instead of trusting Sleeper's pts_ppr (2022–25 rows counted INTs as +2)", () => {
    const [qb] = projectionAccuracy([{ proj: [row('q', 'QB', { pass_yd: 250, pass_td: 1, pass_int: 1, pts_ppr: 16 })], stats: [row('q', 'QB', { pts_ppr: 13, gp: 1 })] }]);
    expect(qb).toMatchObject({ pos: 'QB', n: 1, mae: 0, bias: 0 }); // 10 + 4 − 1 = 13
  });
});
