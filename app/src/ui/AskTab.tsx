import { useRef, useState } from 'preact/hooks';
import { ANALYST_RULES, answerCost, buildFacts, checkAnswer, sheetText, type CheckedAnswer, type FactSheet, type Usage } from '../analysis/analyst';
import { teamName } from '../analysis/analyze';
import { waiverBoard } from '../analysis/outlook';
import { loadTrending } from '../data/repo';
import { loadSeason, type LeagueBundle } from './data';
import { logError } from './errorLog';
import { dateTime } from './format';

// Ask the analyst (docs/analyst.md): the manager's own Anthropic API key, kept on this device, and a call straight from
// the browser to Anthropic. No server of ours sees the key or the questions.

const KEY_STORE = 'ff:anthropic-key';
const MODEL = 'claude-opus-5-5';
/** Earlier questions and answers sent with a new one, for follow-ups. [design] */
const HISTORY = 4;

const EXAMPLES = ['Who should I start this week, and why?', 'How likely am I to win this week?', 'Which free agent should I claim?', 'How are my playoff odds?'];

function storedKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORE);
  } catch {
    return null;
  }
}

function storeKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_STORE, key);
    else localStorage.removeItem(KEY_STORE);
  } catch {
    /* private mode: the key lasts this visit only */
  }
}

export function AskTab({ bundle }: { bundle: LeagueBundle }) {
  const [key, setKey] = useState<string | null>(storedKey);
  if (!key)
    return (
      <KeyCard
        onSave={(k) => {
          storeKey(k);
          setKey(k);
        }}
      />
    );
  return (
    <Analyst
      bundle={bundle}
      apiKey={key}
      onForget={() => {
        storeKey(null);
        setKey(null);
      }}
    />
  );
}

function KeyCard({ onSave }: { onSave: (key: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div class="card ask">
      <h2>Ask the analyst</h2>
      <p>
        Ask about this league in plain words. Claude (Anthropic&apos;s Opus 5.5) answers from the app&apos;s own figures, and the app puts in every number
        itself, so they match the other tabs.
      </p>
      <p class="muted small">
        It runs on your own Anthropic API key, which stays on this device. Each question sends this league&apos;s figures (team and player names, projections
        and odds) and your question from your browser to Anthropic, and costs a few cents on your account; each answer shows what it cost. Get a key at{' '}
        <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">
          console.anthropic.com
        </a>
        .
      </p>
      <form
        class="connect-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (value.trim()) onSave(value.trim());
        }}
      >
        <label for="anthropic-key">Anthropic API key</label>
        <input
          id="anthropic-key"
          type="password"
          autoComplete="off"
          spellcheck={false}
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          placeholder="sk-ant-…"
          required
        />
        <button class="btn btn-primary" type="submit">
          Save key
        </button>
      </form>
    </div>
  );
}

interface Turn {
  question: string;
  pending: boolean;
  /** The model's answer as written, fact ids and all: sent back with follow-ups. */
  raw?: string;
  answer?: CheckedAnswer;
  cost?: number;
  note?: string;
  error?: string;
}

function Analyst({ bundle, apiKey, onForget }: { bundle: LeagueBundle; apiKey: string; onForget: () => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  // One fact sheet per visit to the tab: the same text on every question, so Anthropic's prompt cache can reuse it.
  const sheet = useRef<Promise<FactSheet> | null>(null);
  const busy = turns.some((t) => t.pending);

  const ask = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = turns.filter((t) => t.raw).slice(-HISTORY);
    const index = turns.length;
    const update = (patch: Partial<Turn>) => setTurns((ts) => ts.map((t, i) => (i === index ? { ...t, ...patch } : t)));
    setTurns((ts) => [...ts, { question: q, pending: true }]);
    setQuestion('');
    try {
      sheet.current ??= buildSheet(bundle);
      const facts = await sheet.current;
      const reply = await askClaude(apiKey, facts, dateTime(bundle.data.savedAt), history, q);
      update({
        pending: false,
        raw: reply.raw,
        answer: checkAnswer(reply.raw, facts),
        cost: answerCost(reply.usage),
        ...(reply.note ? { note: reply.note } : {}),
      });
    } catch (e) {
      logError(e);
      update({ pending: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div class="card ask">
      <h2>Ask the analyst</h2>
      <p class="muted small">
        Claude answers from this league&apos;s figures in the app. Numbers in an answer are put in by the app; any the model typed itself that don&apos;t match
        the app&apos;s figures are <mark class="unchecked">marked</mark>.
      </p>
      {turns.map((t) => (
        <div class="turn">
          <p class="question">
            <strong>You:</strong> {t.question}
          </p>
          {t.pending ? <p class="muted">Thinking…</p> : null}
          {t.error ? (
            <p class="problem problem-error" role="alert">
              {t.error}
            </p>
          ) : null}
          {t.answer ? <AnswerView answer={t.answer} /> : null}
          {t.note ? <p class="note">{t.note}</p> : null}
          {t.answer ? (
            <p class="muted small">
              {t.answer.unchecked
                ? `${t.answer.unchecked} number${t.answer.unchecked === 1 ? '' : 's'} marked: not from the app's figures.`
                : "Every number comes from the app's figures."}
              {t.cost !== undefined ? ` Cost about $${t.cost.toFixed(3)}.` : ''}
            </p>
          ) : null}
        </div>
      ))}
      <form
        class="connect-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <label for="analyst-question">Your question</label>
        <textarea
          id="analyst-question"
          rows={2}
          value={question}
          onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask(question);
            }
          }}
          placeholder="e.g. Should I start my flex or the free agent?"
        />
        <button class="btn btn-primary" type="submit" disabled={busy || !question.trim()}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      {turns.length ? null : (
        <div class="row">
          {EXAMPLES.map((ex) => (
            <button type="button" class="btn btn-small" disabled={busy} onClick={() => void ask(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}
      <p class="muted small">
        Your key stays on this device. Each question sends this league&apos;s figures and your question to Anthropic.{' '}
        <button type="button" class="link" onClick={onForget}>
          Remove key
        </button>
      </p>
    </div>
  );
}

function AnswerView({ answer }: { answer: CheckedAnswer }) {
  return (
    <p class="answer">
      {answer.pieces.map((p) =>
        p.kind === 'text' ? (
          p.text
        ) : p.kind === 'fact' ? (
          <span class="fact" title={p.fact.label}>
            {p.text}
          </span>
        ) : (
          <mark class="unchecked" title={p.kind === 'unknown' ? 'Refers to a figure the app doesn’t have' : 'Typed by the model, not one of the app’s figures'}>
            {p.text}
          </mark>
        ),
      )}
    </p>
  );
}

/** The fact sheet for this league: this week's lineup, and the rest of the season and free agents when they load. */
async function buildSheet(b: LeagueBundle): Promise<FactSheet> {
  const me = b.myRoster!;
  const name = (rosterId: number) => teamName(b.data.rosters.find((r) => r.rosterId === rosterId), b.data.users);
  let extra = {};
  try {
    const season = await loadSeason(b);
    const trending = await loadTrending();
    extra = { outlook: season.outlook, waivers: waiverBoard(season.outlook, me, b.ctx, trending, season.claims).rows };
  } catch (e) {
    // This week's figures still answer most questions.
    logError(e);
  }
  return buildFacts({ league: b.league, week: b.week, myRoster: me, rosters: b.data.rosters, teamName: name, lineup: b.lineup!, ...extra });
}

/** One question to Claude: the rules and the fact sheet (cached), earlier questions for context, then the new one. */
async function askClaude(apiKey: string, sheet: FactSheet, asOf: string, history: readonly Turn[], question: string): Promise<{ raw: string; usage: Usage; note?: string }> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  // Earlier turns go in as context inside the new question, so every request is a single user turn.
  const context = history.map((t) => `Q: ${t.question}\nA: ${t.raw}`).join('\n\n');
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'medium' },
      // If Opus 5.5 declines, Anthropic retries on its default fallback model inside the same call.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [
        { type: 'text', text: ANALYST_RULES },
        { type: 'text', text: sheetText(sheet, asOf), cache_control: { type: 'ephemeral' } },
      ],
      messages: [{ role: 'user', content: context ? `Earlier in this conversation:\n\n${context}\n\nNew question: ${question}` : question }],
    });
    const raw = response.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('')
      .trim();
    const note =
      response.stop_reason === 'refusal'
        ? 'Claude declined to answer this question.'
        : response.stop_reason === 'max_tokens'
          ? 'The answer was cut off.'
          : !raw
            ? 'Claude returned no answer.'
            : undefined;
    return { raw, usage: response.usage, ...(note ? { note } : {}) };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Anthropic rejected the API key. Check it, or remove it and add it again.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error("This API key isn't allowed to use Claude Opus 5.5.");
    if (e instanceof Anthropic.RateLimitError) throw new Error('Anthropic is limiting requests on this key. Try again in a minute.');
    if (e instanceof Anthropic.BadRequestError) throw new Error(`Anthropic couldn't take the request: ${e.message}`);
    if (e instanceof Anthropic.APIConnectionError) throw new Error("Couldn't reach Anthropic. Check your connection and try again.");
    if (e instanceof Anthropic.APIError) throw new Error(`Anthropic error${e.status ? ` ${e.status}` : ''}: ${e.message}`);
    throw e;
  }
}
