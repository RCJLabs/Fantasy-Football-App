// Recent news for player details (docs/news.md): ESPN's unofficial fantasy news for one player, loaded by the browser
// when his details open and never republished by the pipeline. Items of type "Rotowire" are RotoWire's, licensed to
// ESPN; the rest are ESPN's own stories. Checked from Actions on 2026-10-18 (scripts/spike/espn-news-spike.mjs).
import { getJson } from '../sleeper/api';
import { cached } from './cache';

const MIN = 60_000;
const NEWS_URL = 'https://site.api.espn.com/apis/fantasy/v2/games/ffl/news/players';
/** Items fetched per player: the endpoint's responses carry full story text (about 8–16 KB an item). */
const LIMIT = 6;

export interface NewsItem {
  id: string;
  headline: string;
  /** A second line when it says more than the headline. */
  text?: string;
  published: number;
  source: 'RotoWire via ESPN' | 'ESPN';
  /** The story on espn.com, when there is one. */
  url?: string;
}

interface RawNewsItem {
  id?: number | string;
  headline?: string;
  description?: string;
  published?: string;
  lastModified?: string;
  type?: string;
  links?: { web?: { href?: string } };
}

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", '#39': "'", lt: '<', gt: '>', nbsp: ' ' };
const decode = (s: string) => s.replace(/&(amp|quot|apos|#39|lt|gt|nbsp);/g, (_, e: string) => ENTITIES[e]!).replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** Only links to espn.com pages (no other hosts or schemes). */
function espnLink(href: string | undefined): string | undefined {
  if (!href) return undefined;
  try {
    const u = new URL(href);
    return u.protocol === 'https:' && (u.hostname === 'espn.com' || u.hostname.endsWith('.espn.com')) ? u.href : undefined;
  } catch {
    return undefined;
  }
}

/** ESPN's response → news items, newest first. */
export function parseNews(body: unknown): NewsItem[] {
  const feed = (body as { feed?: unknown } | null)?.feed;
  if (!Array.isArray(feed)) return [];
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const raw of feed as RawNewsItem[]) {
    const headline = decode(raw.headline ?? '');
    const published = Date.parse(raw.published ?? raw.lastModified ?? '');
    const id = String(raw.id ?? `${headline}|${published}`);
    if (!headline || !Number.isFinite(published) || seen.has(id)) continue;
    seen.add(id);
    const description = decode(raw.description ?? '');
    const url = espnLink(raw.links?.web?.href);
    out.push({
      id,
      headline: clip(headline, 220),
      ...(description && description !== headline ? { text: clip(description, 300) } : {}),
      published,
      source: raw.type === 'Rotowire' ? 'RotoWire via ESPN' : 'ESPN',
      ...(url ? { url } : {}),
    });
  }
  return out.sort((a, b) => b.published - a.published);
}

/** A player's recent news (kept 15 minutes, or a saved copy when ESPN doesn't answer). */
export async function loadPlayerNews(espnId: string, force = false): Promise<NewsItem[]> {
  const url = `${NEWS_URL}?limit=${LIMIT}&playerId=${encodeURIComponent(espnId)}`;
  return (await cached(`news:${espnId}`, 15 * MIN, async () => parseNews(await getJson(url, { timeoutMs: 15_000, retries: 1 })), { force })).value;
}

/** His player page on espn.com, for more news. */
export const espnPlayerPage = (espnId: string): string => `https://www.espn.com/nfl/player/_/id/${encodeURIComponent(espnId)}`;
