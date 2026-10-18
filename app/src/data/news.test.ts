import { describe, expect, it } from 'vitest';
import { espnPlayerPage, parseNews } from './news';

// Shaped like ESPN's fantasy news response (fields from the 2026-10-18 spike); the text is invented.
const body = {
  resultsCount: 3,
  feed: [
    {
      id: 101,
      type: 'Rotowire',
      headline: 'Invented Receiver: Limited in practice Thursday',
      description: 'Invented Receiver: Limited in practice Thursday',
      published: '2026-10-16T21:00:00Z',
      links: { web: {} },
    },
    {
      id: 102,
      type: 'Story',
      headline: 'Invented team&#39;s receivers &amp; the bye week',
      description: 'A longer   look at the depth chart.',
      published: '2026-10-17T12:00:00Z',
      links: { web: { href: 'https://www.espn.com/nfl/story/_/id/1/invented' } },
    },
    { id: 103, type: 'Story', headline: 'Off-site link', published: '2026-10-15T12:00:00Z', links: { web: { href: 'javascript:alert(1)' } } },
    { id: 101, type: 'Rotowire', headline: 'Duplicate', published: '2026-10-16T21:00:00Z' },
    { id: 104, type: 'Story', headline: '', published: '2026-10-17T12:00:00Z' },
  ],
};

describe('player news', () => {
  it('keeps headlines newest first, labels the source and only links to espn.com', () => {
    const items = parseNews(body);
    expect(items.map((n) => n.id)).toEqual(['102', '101', '103']);
    expect(items[0]).toMatchObject({ headline: "Invented team's receivers & the bye week", text: 'A longer look at the depth chart.', source: 'ESPN', url: 'https://www.espn.com/nfl/story/_/id/1/invented' });
    // RotoWire's blurb repeats its headline as the description: shown once, without a link.
    expect(items[1]).toEqual({ id: '101', headline: 'Invented Receiver: Limited in practice Thursday', published: Date.parse('2026-10-16T21:00:00Z'), source: 'RotoWire via ESPN' });
    expect(items[2]!.url).toBeUndefined();
  });

  it('copes with an error or an unexpected shape', () => {
    expect(parseNews({ code: 500, detail: 'x' })).toEqual([]);
    expect(parseNews(null)).toEqual([]);
    expect(espnPlayerPage('3139477')).toBe('https://www.espn.com/nfl/player/_/id/3139477');
  });
});
