import { describe, expect, it } from 'vitest';
import { statChange, statLine } from './statLine';

describe('stat lines', () => {
  it('prints each position the way box scores do, leading with its main job', () => {
    expect(statLine('QB', { pass_cmp: 21, pass_att: 30, pass_yd: 248, pass_td: 2, pass_int: 1, rush_att: 4, rush_yd: 12 })).toBe(
      '21/30, 248 yd, 2 TD, 1 INT · 4 car, 12 yd',
    );
    expect(statLine('RB', { rush_att: 14, rush_yd: 63, rush_td: 1, rec: 2, rec_tgt: 3, rec_yd: 11, fum_lost: 1 })).toBe('14 car, 63 yd, TD · 2/3 rec, 11 yd · 1 fum lost');
    expect(statLine('WR', { rec: 5, rec_tgt: 7, rec_yd: 89 })).toBe('5/7 rec, 89 yd');
    // Targets without a catch still show.
    expect(statLine('TE', { rec_tgt: 2 })).toBe('0/2 rec, 0 yd');
    expect(statLine('K', { fgm: 2, fga: 3, xpm: 1, xpa: 1 })).toBe('FG 2/3, XP 1/1');
    expect(statLine('DEF', { pts_allow: 13, sack: 3, int: 1 })).toBe('13 pts allowed, 3 sacks, 1 INT');
    expect(statLine('LB', { idp_tkl_solo: 5, idp_tkl_ast: 2, idp_sack: 1 })).toBe('7 tkl, 1 sack');
  });

  it('shows nothing before a player has stats', () => {
    expect(statLine('WR', undefined)).toBeUndefined();
    expect(statLine('WR', {})).toBeUndefined();
    expect(statLine('K', { pass_yd: 0 })).toBeUndefined();
  });
});

describe('stat line changes (the live feed)', () => {
  it('says what a change in a stat line was', () => {
    expect(statChange('WR', { rec: 1, rec_tgt: 1, rec_yd: 34, rec_td: 1 })).toBe('TD catch, 34 yd');
    expect(statChange('WR', { rec: 2, rec_tgt: 3, rec_yd: 21 })).toBe('2 catches, 21 yd');
    expect(statChange('RB', { rush_att: 1, rush_yd: -3 })).toBe('carry, -3 yd');
    expect(statChange('QB', { pass_att: 1, pass_cmp: 1, pass_yd: 22, pass_td: 1 })).toBe('TD pass, 22 yd');
    expect(statChange('QB', { pass_att: 1, pass_int: 1 })).toBe('INT thrown');
    expect(statChange('K', { fga: 1, fgm: 1, fgm_yds: 52, fgm_50p: 1 })).toBe('FG, 52 yd');
    expect(statChange('DEF', { sack: 1, pts_allow: 7 })).toBe('sack, 7 pts allowed');
    expect(statChange('LB', { idp_tkl_solo: 1, idp_tkl_ast: 1 })).toBe('2 tackles');
  });

  it('calls a drop in a count a correction, and says nothing about plays that add nothing to show', () => {
    expect(statChange('WR', { rec: -1, rec_yd: -12 })).toBe('stat correction');
    expect(statChange('QB', { pass_att: 1 })).toBeUndefined();
    expect(statChange('WR', {})).toBeUndefined();
    expect(statChange('WR', undefined)).toBeUndefined();
  });
});
