import { describe, expect, it } from 'vitest';
import { parseLeague, parseRoster } from '../sleeper/parse';
import type { RawLeague, RawTradedPick } from '../sleeper/raw';
import { draftPicks, draftSlotProbs, ordinal, pickAssets, pickLabel, pickSeasons, pickTotals, slotTier, valuePick, type DraftPick } from './picks';
import type { TeamOdds } from './season';

const raw = (status: string, settings: Record<string, number> = {}): RawLeague => ({
  league_id: 'D',
  name: 'Dynasty',
  season: '2026',
  status,
  total_rosters: 4,
  roster_positions: ['QB', 'RB', 'WR', 'BN'],
  scoring_settings: { rec: 1 },
  settings: { type: 2, num_teams: 4, draft_rounds: 2, ...settings },
});
const league = parseLeague(raw('in_season'));
const traded: RawTradedPick[] = [
  { season: '2027', round: 1, roster_id: 2, owner_id: 1, previous_owner_id: 2 }, // I got team 2's 1st
  { season: '2028', round: 2, roster_id: 1, owner_id: 3, previous_owner_id: 1 }, // team 3 got my 2028 2nd
  { season: '2027', round: 4, roster_id: 4, owner_id: 1, previous_owner_id: 4 }, // a round past draft_rounds
  { season: '2026', round: 1, roster_id: 3, owner_id: 2, previous_owner_id: 3 }, // already drafted
];
// FantasyCalc-style prices: next year's by third of the round, later years flat.
const prices = new Map([
  ['2027:1:Early', 4000],
  ['2027:1:Mid', 3000],
  ['2027:1:Late', 2000],
  ['2027:1', 2800],
  ['2027:2', 1500],
  ['2028:1', 2100],
  ['2028:2', 1300],
]);
const rosters = [1, 2, 3, 4].map((id, i) => parseRoster({ roster_id: id, owner_id: `u${id}`, players: [], starters: [], settings: { wins: 4 - i, losses: 1 + i, fpts: 500 } }));
const pick = (season: string, round: number, original = 1): DraftPick => ({ key: `${season}:${round}:${original}`, season, round, originalRosterId: original, ownerRosterId: original });

describe('draft picks', () => {
  it('labels picks and lists the next three drafts', () => {
    expect([1, 2, 3, 4, 11, 21].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '21st']);
    expect(pickLabel({ season: '2027', round: 2 })).toBe('2027 2nd');
    expect(pickSeasons(league)).toEqual(['2027', '2028', '2029']);
    expect(pickSeasons(parseLeague(raw('pre_draft')))).toEqual(['2026', '2027', '2028']);
    expect(league.rules).toMatchObject({ pickTrading: true, draftRounds: 2 }); // dynasty default when pick_trading is missing
    expect(parseLeague(raw('in_season', { pick_trading: 0 })).rules.pickTrading).toBe(false);
  });

  it("keeps each team's own picks unless Sleeper lists them as traded", () => {
    const picks = draftPicks(league, [1, 2, 3, 4], traded);
    const owner = (key: string) => picks.find((p) => p.key === key)?.ownerRosterId;
    expect(owner('2027:1:2')).toBe(1);
    expect(owner('2027:1:1')).toBe(1);
    expect(owner('2028:2:1')).toBe(3);
    expect(owner('2027:4:4')).toBe(1);
    expect(owner('2027:3:2')).toBe(2); // the traded 4th extends 2027 to four rounds for everyone
    expect(picks.filter((p) => p.season === '2028').length).toBe(2 * 4);
    expect(picks.some((p) => p.season === '2026')).toBe(false);
    expect(picks.filter((p) => p.ownerRosterId === 1).map((p) => p.key)).toContain('2027:1:2');
  });

  it('maps finishes to draft slots, worst record first', () => {
    // Without simulated odds the standings decide: team 4 (1-4) picks first, team 1 (4-1) last.
    const fixed = draftSlotProbs(rosters);
    expect(fixed.get(4)).toEqual([1, 0, 0, 0]);
    expect(fixed.get(1)).toEqual([0, 0, 0, 1]);
    const odds = new Map(rosters.map((r) => [r.rosterId, { rankProbs: r.rosterId === 1 ? [0.5, 0.5, 0, 0] : [0, 0, 0.5, 0.5] } as unknown as TeamOdds]));
    expect(draftSlotProbs(rosters, odds).get(1)).toEqual([0, 0, 0.5, 0.5]);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((s) => slotTier(s, 10))).toEqual(['Early', 'Early', 'Early', 'Early', 'Mid', 'Mid', 'Mid', 'Late', 'Late', 'Late']);
    expect([1, 4, 5, 8, 9, 12].map((s) => slotTier(s, 12))).toEqual(['Early', 'Early', 'Mid', 'Mid', 'Late', 'Late']);
  });

  it("blends next year's thirds by the projected slot and prices later years flat", () => {
    expect(valuePick(pick('2027', 1), prices, [1, 0, 0, 0])).toEqual({ value: 4000, valued: true, tier: 'Early', tierProb: 1 });
    const blended = valuePick(pick('2027', 1), prices, [0, 0, 0.5, 0.5]); // n = 4: slot 3 is Mid, slot 4 Late
    expect(blended.value).toBeCloseTo(2500, 9);
    expect(blended.tier).toBe('Mid'); // a tie keeps the earlier third
    expect(valuePick(pick('2027', 1), prices)).toEqual({ value: 2800, valued: true }); // no projection: the round's price
    expect(valuePick(pick('2027', 2), prices, [1, 0, 0, 0])).toEqual({ value: 1500, valued: true }); // no thirds priced
    expect(valuePick(pick('2028', 1), prices)).toEqual({ value: 2100, valued: true });
    expect(valuePick(pick('2027', 4), prices)).toEqual({ value: 0, valued: false });
  });

  it('values every pick and totals what each team owns', () => {
    const assets = pickAssets(league, rosters, traded, prices);
    const mine = assets.filter((p) => p.ownerRosterId === 1);
    // Team 2 (3-2) finishes 2nd: its 1st is the 3rd pick of 4 (Mid); mine is the 4th (Late).
    expect(mine.find((p) => p.key === '2027:1:2')).toMatchObject({ value: 3000, tier: 'Mid' });
    expect(mine.find((p) => p.key === '2027:1:1')).toMatchObject({ value: 2000, tier: 'Late' });
    expect(assets.find((p) => p.key === '2028:1:1')?.tier).toBeUndefined();
    const totals = pickTotals(assets);
    expect(totals.get(1)).toBe(3000 + 2000 + 1500 + 2100); // two 2027 1sts, 2027 2nd, 2028 1st (2028 2nd traded away)
    expect(totals.get(3)).toBe(4000 + 1500 + 2100 + 1300 + 1300); // own picks plus my 2028 2nd
    // Before a league's draft the order is set by the league, not standings: no thirds.
    expect(pickAssets(parseLeague(raw('pre_draft')), rosters, [], prices).every((p) => p.tier === undefined)).toBe(true);
  });
});
