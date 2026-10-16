import { describe, expect, it } from 'vitest';
import { scoreStats } from '../app/src/engine/scoring';
import { nflverseStatLine } from './nflverse-stats';

describe('nflverse → Sleeper stat line', () => {
  it('maps passing, rushing and receiving, with first downs net of touchdowns as Sleeper counts them', () => {
    const qb = nflverseStatLine(
      { completions: '26', attempts: '38', passing_yards: '412', passing_tds: '3', passing_interceptions: '1', sacks_suffered: '2', passing_first_downs: '22', passing_2pt_conversions: '1', carries: '4', rushing_yards: '18', rushing_tds: '0', rushing_first_downs: '2', fumbles_lost_total: '1' },
      'QB',
    );
    expect(qb).toMatchObject({ pass_cmp: 26, pass_att: 38, pass_yd: 412, pass_td: 3, pass_int: 1, pass_sack: 2, pass_2pt: 1, rush_att: 4, rush_yd: 18, fum_lost: 1 });
    expect(qb.pass_fd).toBe(19); // 22 first downs, 3 of them touchdowns
    expect(qb.rush_fd).toBe(2);
    expect(qb.bonus_fd_qb).toBe(21);
    // Exclusive tiers: 412 yards earns the 400-yard bonus only; 26 completions the 25-completion one.
    expect(qb.bonus_pass_yd_400).toBe(1);
    expect(qb.bonus_pass_yd_300).toBeUndefined();
    expect(qb.bonus_pass_cmp_25).toBe(1);
  });

  it('adds position reception bonuses and the combined-yards tier', () => {
    const te = nflverseStatLine({ receptions: '9', targets: '11', receiving_yards: '96', receiving_tds: '1', receiving_first_downs: '6', carries: '1', rushing_yards: '7', rushing_first_downs: '1' }, 'TE');
    expect(te).toMatchObject({ rec: 9, rec_tgt: 11, rec_yd: 96, rec_td: 1, rec_fd: 5, rush_fd: 1, bonus_rec_te: 9, bonus_fd_te: 6, rush_rec_yd: 103, bonus_rush_rec_yd_100: 1 });
    expect(te.bonus_rec_yd_100).toBeUndefined();
    expect(nflverseStatLine({ receptions: '3' }, 'QB').bonus_rec_qb).toBeUndefined();
  });

  it('sums fumbles lost by play type when the total column is missing, and skips NA', () => {
    expect(nflverseStatLine({ sack_fumbles_lost: '1', rushing_fumbles_lost: '1', receiving_fumbles_lost: 'NA' }, 'QB').fum_lost).toBe(2);
    expect(nflverseStatLine({ fumbles_lost_total: '0', rushing_fumbles_lost: '1' }, 'RB').fum_lost).toBeUndefined();
  });

  it("scores like Sleeper's own line under a league's settings", () => {
    const line = nflverseStatLine({ receptions: '5', receiving_yards: '62', receiving_tds: '1', special_teams_tds: '1' }, 'WR');
    expect(scoreStats(line, { rec: 1, rec_yd: 0.1, rec_td: 6, st_td: 6 })).toBeCloseTo(5 + 6.2 + 6 + 6, 9);
  });
});
