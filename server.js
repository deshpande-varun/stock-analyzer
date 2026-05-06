require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.static('.'));

const BEDROCK_BASE = process.env.ANTHROPIC_BEDROCK_BASE_URL;
const AUTH_TOKEN   = process.env.ANTHROPIC_AUTH_TOKEN;
const MODEL        = 'us.anthropic.claude-sonnet-4-6';

async function callClaude(messages, maxTokens = 1500) {
  const res = await fetch(`${BEDROCK_BASE}/model/${MODEL}/invoke`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${AUTH_TOKEN}`,
    },
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${res.status} ${err}`);
  }

  const json = await res.json();
  return json.content.filter(b => b.type === 'text').map(b => b.text).join('');
}

// ─── Subagent prompts ─────────────────────────────────────────────────────────

function growthPrompt(ticker) {
  return `You are a quantitative research analyst. Analyze ${ticker} on Growth & Momentum.

Score /35 based on:
- Revenue YoY growth rate and sequential acceleration/deceleration
- Earnings surprise history (last 4 quarters)
- Forward guidance — raised, in-line, or cut?
- Rule: acceleration > absolute level (8%→14% beats 30%→25%)

Output format:
SCORE: [X/35]
VERDICT: [ACCELERATING / STABLE / DECELERATING]

KEY FINDINGS:
- [finding 1]
- [finding 2]
- [finding 3]

RISKS: [1-2 sentences]`;
}

function moatPrompt(ticker) {
  return `You are a competitive intelligence analyst. Analyze ${ticker} on Moat & Quality.

Score /25 based on:
- Top 3 competitors and differentiation
- Moat type: network effects, switching costs, IP, cost advantage, or none
- Gross margin level + trend (last 4 quarters)
- Customer concentration: any customer >25% revenue? Top 3 >50%?

Output format:
SCORE: [X/25]
MOAT TYPE: [Network Effects / Switching Costs / IP / Cost Advantage / Weak / None]

KEY FINDINGS:
- [finding 1]
- [finding 2]
- [finding 3]

MOAT VERDICT: [WIDE / NARROW / NONE] — [1 sentence]`;
}

function downsidePrompt(ticker) {
  return `You are a balance sheet analyst. Analyze ${ticker} on Downside Protection.

Score /25 based on:
- Net cash vs net debt
- FCF margin % (>15% strong, <5% survival risk)
- Price/FCF (<15x cheap, >40x premium)
- Insider Form 4 activity — unscheduled only, ignore 10b5-1

Output format:
SCORE: [X/25]
BALANCE SHEET: [FORTRESS / HEALTHY / STRETCHED / DISTRESSED]

KEY FINDINGS:
- [finding 1]
- [finding 2]
- [finding 3]

FCF VERDICT: [FCF margin %, Price/FCF, 1-sentence interpretation]`;
}

function sentimentPrompt(ticker) {
  return `You are a market sentiment analyst. Analyze ${ticker} on Sentiment & Timing.

Score /15 based on:
- Top-rated analyst stance (track-record analysts only, not broad consensus)
- Short interest as % of float
- Institutional accumulation or distribution (13F filings)
- Contrarian setup vs crowded trade

Output format:
SCORE: [X/15]
SETUP TYPE: [CONTRARIAN / NEUTRAL / CROWDED]

KEY FINDINGS:
- [finding 1]
- [finding 2]
- [finding 3]

TIMING VERDICT: [GOOD ENTRY / WAIT / AVOID] — [1 sentence]`;
}

function bearPrompt(ticker) {
  return `You are a skeptical short-seller. Build the bear case for ${ticker}.

Score narrative decay /100:
1. Growth Deterioration (35pts): revenue decel, guidance cuts, backlog shrinking
2. Margin & Cash Flow Erosion (25pts): margin compression, FCF decay, capex into a slowdown
3. Valuation Disconnect (25pts): premium valuation while fundamentals deteriorate
4. Insider & Behavioral (15pts): unscheduled selling, GAAP vs non-GAAP gap, narrative inflation

Output format:
DECAY SCORE: [X/100]
DECAY VELOCITY: [ACCELERATING / STABLE / DECELERATING]

TOP 3 BEAR ARGUMENTS:
1. [argument]
2. [argument]
3. [argument]

KILL CRITERIA TRIGGERED: [YES / NO] — [which ones if yes]
INVALIDATION TRIGGER: [what single event kills the short thesis]`;
}

function synthPrompt(ticker, subagentResults) {
  const { growth, moat, downside, sentiment, bear } = subagentResults;
  return `You are a chief investment officer. Synthesize this full research into a final verdict.

TICKER: ${ticker}

━━━ SUBAGENT REPORTS ━━━

[Agent 1 — Growth & Momentum]
${growth}

[Agent 2 — Moat & Quality]
${moat}

[Agent 3 — Downside Protection]
${downside}

[Agent 4 — Sentiment & Timing]
${sentiment}

[Bear Case]
${bear}

━━━ YOUR TASK ━━━

1. Sum the scores from each report.
2. Apply kill criteria — FAIL if: Moat ≤13/25, OR Bear decay ≥65 with ACCELERATING velocity, OR Downside <10/25.
3. Output the final verdict EXACTLY in this format:

═══════════════════════════════════════
FINAL VERDICT: ${ticker}
═══════════════════════════════════════

COMPOSITE SCORE: [X/100]
TIER: [HIGH CONVICTION 80+ / MEDIUM 65-79 / WATCHLIST 50-64 / REJECT <50]
VERDICT: [STRONG BUY / BUY / WATCHLIST / PASS / SELL / STRONG SELL]

Verdict rules:
- STRONG BUY: score ≥85, no kill criteria, bear decay <35
- BUY: score 70-84, no kill criteria
- WATCHLIST: score 55-69, or BUY signal but timing not ideal
- PASS: score 45-54, or mixed signals
- SELL: score 35-44, or kill criteria triggered, bear decay ≥55
- STRONG SELL: score <35, or multiple kill criteria, bear decay ≥70 with ACCELERATING velocity

DIMENSION SCORES:
  Growth & Momentum:   [X/35]
  Moat & Quality:      [X/25]
  Downside Protection: [X/25]
  Sentiment & Timing:  [X/15]

KILL CRITERIA: [NONE TRIGGERED / list triggered ones]

THE BULL CASE (3 sentences):
[only if STRONG BUY, BUY, or WATCHLIST — skip this section for PASS/SELL/STRONG SELL]

THE BEAR CASE SUMMARY (2 sentences):
[key risks + decay score]

POSITION SIZING:
[FULL SIZE — high conviction | HALF SIZE — wait for catalyst | NO POSITION | EXIT — reduce to zero | URGENT EXIT — sell immediately]

WHAT TO WATCH:
- [metric or event]
- [metric or event]
- [metric or event]
═══════════════════════════════════════`;
}

// ─── Portfolio decision prompt ────────────────────────────────────────────────

function portfolioDecisionPrompt(holdings) {
  const list = holdings.map(h =>
    `${h.ticker}: Score ${h.score}/100, Verdict ${h.verdict}, Kill Criteria: ${h.killCriteria}\nBull: ${h.bull}\nBear: ${h.bear}`
  ).join('\n\n');

  return `You are a portfolio manager reviewing an existing portfolio. Based on the 4-agent analysis below, give a clear action for each holding.

CURRENT MARKET CONTEXT (live as of today):
- S&P 500: 7,259 (+0.81%), Nasdaq: 25,326 (+1.03%), Russell 2000: +1.75%
- VIX: 17.38 — low fear, risk-on environment
- 10-yr yield: 4.42%, declining — mild tailwind for growth stocks
- Leading sectors: Semiconductors, Technology, Basic Materials
- Lagging: Energy, Communication Services

HOLDINGS ANALYSIS:
${list}

ACTION RULES:
- KEEP: Verdict STRONG BUY or BUY, score ≥70, no kill criteria — conviction hold
- TRIM: Verdict BUY/WATCHLIST but score 55-69, or up >50% and overextended — take 30-50% profits
- PASS: Verdict WATCHLIST, score 50-54 — hold but don't add; re-evaluate next quarter
- SELL: Verdict PASS or score 40-49, or kill criteria triggered — exit 75%+ of position
- STRONG SELL: Verdict SELL/STRONG SELL, score <40, multiple kill criteria — exit immediately

Output format — one line per holding:
TICKER | ACTION | REASON (1 crisp sentence)

Then:
PORTFOLIO SUMMARY: [2-3 sentences: overall health, what to do with any freed cash]`;
}

// ─── Top Picks prompts (live market data baked in) ────────────────────────────

const LIVE_MARKET_CONTEXT = `
LIVE MARKET DATA (as of today, May 2026):
Indices: S&P 500 at 7,259 (+0.81%), Nasdaq at 25,326 (+1.03%), Russell 2000 at 2,845 (+1.75%), Dow at 49,298 (+0.73%)
VIX: 17.38 (LOW FEAR — risk-on)
10-yr Treasury yield: 4.42% (declining), 30-yr: 4.98%
Sector performance this week: Technology +1.34%, Basic Materials +1.47%, Industrials +1.21% leading; Energy +0.09% lagging
Today's big movers: INTC +12.99%, MU +11.06%, STRL +52%, DOCN +40%
Strong Buy screener standouts (high ROE, gross margin >30%, EPS growth): MU, AMAT, TSM, ANET, AVGO, GOOGL, NVMI
Current macro: bull market, semiconductors leading, rates declining = tailwind for high-duration growth stocks
`;

function macroScreenPrompt() {
  return `You are a macro strategist. Using the live market data below, analyze the current investment environment.

${LIVE_MARKET_CONTEXT}

Based on this real data:
- Confirm the market regime
- Identify the 3 sectors with the strongest tailwinds
- Identify 2 sectors to avoid
- Highlight any specific catalysts or themes to position around

Output format:
MARKET REGIME: [BULL / BEAR / RANGE]
VIX REGIME: [FEAR / NEUTRAL / COMPLACENCY]
RATE ENVIRONMENT: [RISING / FALLING / STABLE]

TOP SECTORS TO BUY:
1. [Sector] — [1-line reason tied to live data]
2. [Sector] — [1-line reason]
3. [Sector] — [1-line reason]

SECTORS TO AVOID:
1. [Sector] — [1-line reason]
2. [Sector] — [1-line reason]

MACRO SUMMARY: [2 sentences tying it all together]`;
}

function growthScreenPrompt() {
  return `You are a growth equity analyst. Using the live market data below, identify the best high-growth stocks to buy RIGHT NOW.

${LIVE_MARKET_CONTEXT}

Screen criteria:
- Revenue growth >20% YoY AND accelerating
- Expanding margins or near profitability
- Large TAM with dominant position
- Benefits from current macro (low VIX, declining rates, semiconductor/tech leadership)
- Prioritize names in leading sectors: Semiconductors, Technology, Industrials

Identify 6-8 specific stocks. For each:
TICKER | COMPANY | SECTOR | WHY NOW (1 sentence referencing live context) | KEY RISK (1 sentence)`;
}

function valueScreenPrompt() {
  return `You are a value and quality investor. Using the live market data below, identify the best undervalued quality stocks to buy RIGHT NOW.

${LIVE_MARKET_CONTEXT}

Screen criteria:
- FCF yield >4% or Price/FCF <25x
- Wide moat: switching costs, network effects, IP, or brand
- Trading at a discount to peers or intrinsic value
- Catalyst for re-rating in the next 6-12 months
- From the screener, focus on: MU (P/E 30), GOOGL (P/E 30), TSM (P/E 33), ANET, AVGO — evaluate which are genuinely undervalued

Identify 5-7 specific stocks. For each:
TICKER | COMPANY | SECTOR | WHY UNDERVALUED (1 sentence) | CATALYST (1 sentence)`;
}

function topPicksSynthPrompt(macro, growth, value) {
  return `You are a chief investment officer. Select the 25 best stocks to buy RIGHT NOW.

${LIVE_MARKET_CONTEXT}

━━━ MACRO ANALYSIS ━━━
${macro}

━━━ GROWTH SCREEN ━━━
${growth}

━━━ VALUE/QUALITY SCREEN ━━━
${value}

Select the 25 highest-conviction buys. Mix growth and value. Prioritize sectors with macro tailwinds.
Kill criteria — EXCLUDE any stock with: weak moat, distressed balance sheet, or narrative decay ≥65 with accelerating velocity.
Favor stocks where declining rates + low VIX = favorable setup.

For each pick, also include a "positionSize" recommendation — how many shares a typical retail investor with a $10,000–$25,000 portfolio should buy to stay safe and diversified. Base it on:
- Conviction level: HIGH = up to 5-8% of portfolio, MEDIUM = 2-4%, LOW = 1-2%
- Volatility: more volatile stocks (beta >1.5, speculative) = fewer shares
- Price level: suggest a dollar amount (e.g. "$500-$800 worth") AND approximate share count at current price
- Include a risk note if position sizing requires extra caution

Output ONLY a valid JSON array, no markdown fences, no explanation:
[{"rank":1,"ticker":"NVDA","company":"Nvidia Corp","sector":"Technology","conviction":"HIGH","thesis":"2-3 sentences on why buy now","catalyst":"key upcoming event or trigger","risk":"biggest risk in 1 sentence","timeframe":"3-12 months","positionSize":"Buy $600-$800 worth (~4-5 shares at ~$160). High conviction, limit to 5% of portfolio."},...]`;
}

// ─── Portfolio decision endpoint ──────────────────────────────────────────────

app.post('/api/portfolio-decision', async (req, res) => {
  const { holdings } = req.body;
  if (!holdings?.length) return res.status(400).json({ error: 'No holdings' });
  try {
    const result = await callClaude([{ role: 'user', content: portfolioDecisionPrompt(holdings) }], 2000);
    res.json({ decision: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Top 10 Picks endpoint ─────────────────────────────────────────────────────

app.post('/api/top-picks', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    send('status', { message: 'Running 3 parallel market screens...' });

    const [macro, growth, value] = await Promise.all([
      callClaude([{ role: 'user', content: macroScreenPrompt() }], 1000).then(r => {
        send('screen', { agent: 'macro', label: 'Macro & Sector Analysis', result: r });
        return r;
      }),
      callClaude([{ role: 'user', content: growthScreenPrompt() }], 1200).then(r => {
        send('screen', { agent: 'growth', label: 'Growth Stock Screen', result: r });
        return r;
      }),
      callClaude([{ role: 'user', content: valueScreenPrompt() }], 1200).then(r => {
        send('screen', { agent: 'value', label: 'Value/Quality Screen', result: r });
        return r;
      }),
    ]);

    send('status', { message: 'Synthesizing top 25 picks...' });

    const raw = await callClaude([{ role: 'user', content: topPicksSynthPrompt(macro, growth, value) }], 5000);

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Could not parse picks from response: ' + raw.slice(0, 200));
    const picks = JSON.parse(match[0]);

    send('picks', { picks });
    send('done', {});
  } catch (err) {
    console.error('Top picks error:', err);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

// ─── Extract holdings from screenshots via Vision ─────────────────────────────

app.post('/api/extract-from-screenshots', async (req, res) => {
  const { images } = req.body; // [{mediaType, base64}]
  if (!images?.length) return res.status(400).json({ error: 'No images provided' });

  const imageBlocks = images.map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
  }));

  const prompt = {
    type: 'text',
    text: `These are screenshots from the Robinhood app showing a user's portfolio or stock positions.

Extract EVERY stock/ETF holding you can see. For each one identify:
- Ticker symbol (e.g. AAPL, NVDA, TSLA)
- Company name
- Number of shares (if visible)
- Current value or price (if visible)

Ignore cash positions, cash management, and crypto.

Return ONLY a valid JSON array, no markdown, no explanation:
[{"ticker":"AAPL","company":"Apple Inc","shares":"10","value":"$1,820"},...]

If you cannot find any holdings, return an empty array: []`,
  };

  try {
    const apiRes = await fetch(`${BEDROCK_BASE}/model/${MODEL}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1000,
        messages: [{ role: 'user', content: [...imageBlocks, prompt] }],
      }),
    });

    if (!apiRes.ok) {
      const err = await apiRes.text();
      throw new Error(`${apiRes.status} ${err}`);
    }

    const json = await apiRes.json();
    const text = json.content.filter(b => b.type === 'text').map(b => b.text).join('');
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Could not parse holdings from screenshots');
    res.json({ holdings: JSON.parse(match[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Extract tickers from company descriptions ────────────────────────────────

app.post('/api/extract-tickers', async (req, res) => {
  const { descriptions } = req.body;
  if (!descriptions?.length) return res.status(400).json({ error: 'No descriptions' });

  const prompt = `Map these stock/security descriptions from a Robinhood 1099 tax form to standard US stock ticker symbols.
Return ONLY a valid JSON object mapping each description exactly to its ticker symbol.

Descriptions:
${descriptions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

Return ONLY JSON, no explanation or markdown:
{"EXACT DESCRIPTION": "TICKER", ...}`;

  try {
    const result = await callClaude([{ role: 'user', content: prompt }], 600);
    const match = result.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Could not parse ticker mapping from response');
    res.json({ mapping: JSON.parse(match[0]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Analyze (non-streaming, for portfolio batch mode) ────────────────────────

app.post('/api/analyze-simple', async (req, res) => {
  const { ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: 'Ticker required' });
  const t = ticker.trim().toUpperCase();

  try {
    const [growth, moat, downside, sentiment, bear] = await Promise.all([
      callClaude([{ role: 'user', content: growthPrompt(t) }]),
      callClaude([{ role: 'user', content: moatPrompt(t) }]),
      callClaude([{ role: 'user', content: downsidePrompt(t) }]),
      callClaude([{ role: 'user', content: sentimentPrompt(t) }]),
      callClaude([{ role: 'user', content: bearPrompt(t) }]),
    ]);

    const verdict = await callClaude(
      [{ role: 'user', content: synthPrompt(t, { growth, moat, downside, sentiment, bear }) }],
      2500
    );

    res.json({ ticker: t, verdict, subagents: { growth, moat, downside, sentiment, bear } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Analyze endpoint (streaming SSE, for single stock mode) ──────────────────

app.post('/api/analyze', async (req, res) => {
  const { ticker } = req.body;
  if (!ticker) return res.status(400).json({ error: 'Ticker is required' });

  const t = ticker.trim().toUpperCase();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  function send(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    send('status', { message: 'Zone Out: launching 4 parallel research agents...' });

    // Mark all agents running
    [1,2,3,4,5].forEach(n => send('agent_start', { agent: n }));

    // Run 5 agents in parallel
    const [growth, moat, downside, sentiment, bear] = await Promise.all([
      callClaude([{ role: 'user', content: growthPrompt(t) }]).then(r => {
        send('subagent', { agent: 1, label: 'Growth & Momentum', result: r });
        return r;
      }),
      callClaude([{ role: 'user', content: moatPrompt(t) }]).then(r => {
        send('subagent', { agent: 2, label: 'Moat & Quality', result: r });
        return r;
      }),
      callClaude([{ role: 'user', content: downsidePrompt(t) }]).then(r => {
        send('subagent', { agent: 3, label: 'Downside Protection', result: r });
        return r;
      }),
      callClaude([{ role: 'user', content: sentimentPrompt(t) }]).then(r => {
        send('subagent', { agent: 4, label: 'Sentiment & Timing', result: r });
        return r;
      }),
      callClaude([{ role: 'user', content: bearPrompt(t) }]).then(r => {
        send('subagent', { agent: 5, label: 'Bear Case', result: r });
        return r;
      }),
    ]);

    // Zone in: synthesizer
    send('status', { message: 'Zone In: synthesizing final verdict...' });
    send('agent_start', { agent: 'synth' });

    const verdict = await callClaude(
      [{ role: 'user', content: synthPrompt(t, { growth, moat, downside, sentiment, bear }) }],
      2500
    );

    // Stream verdict word by word for live effect
    const words = verdict.split(' ');
    for (const word of words) {
      send('token', { text: word + ' ' });
    }

    send('done', { message: 'Analysis complete' });
  } catch (err) {
    console.error('Analysis error:', err);
    send('error', { message: err.message });
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Stock analyzer running on http://localhost:${PORT}`));
