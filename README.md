# AI Stock Analyzer

A locally-hosted stock analysis tool powered by Claude AI (via AWS Bedrock). Uses a 5-subagent "zone out / zone in" architecture to deliver BUY / WATCHLIST / PASS / SELL verdicts backed by live market data from Yahoo Finance.

## Features

- **Single Stock Analysis** — Enter any ticker or company name; 5 AI agents run in parallel and a synthesizer produces a scored verdict
- **Portfolio from CSV** — Upload a Robinhood Consolidated Transactions CSV or screenshots of your Robinhood app; every holding is analyzed in batches and you get a KEEP / TRIM / SELL decision per position
- **Top 25 Picks** — 3 parallel market screens (macro regime, growth, value/quality) followed by a synthesizer that selects the 25 highest-conviction buys with position-sizing guidance
- **Live Market Data** — Real-time price, P/E, revenue growth, analyst targets, short interest, insider sells, and FCF from Yahoo Finance are injected into every agent prompt before analysis runs
- **6-Tier Verdict System** — STRONG BUY / BUY / WATCHLIST / PASS / SELL / STRONG SELL with kill-criteria logic

## Architecture

```
User Input
   │
   ▼
fetchLiveData() ──► Yahoo Finance (real-time)
   │
   ├─► Agent 1: Growth & Momentum      (scores /35)
   ├─► Agent 2: Moat & Quality         (scores /25)  ← parallel
   ├─► Agent 3: Downside Protection    (scores /25)
   ├─► Agent 4: Sentiment & Timing     (scores /15)
   └─► Agent 5: Bear Case              (decay /100)
          │
          ▼
   Synthesizer — composite score /100 → Verdict
```

Kill criteria (auto-downgrades verdict):
- Moat score ≤ 13/25
- Bear decay ≥ 65 with ACCELERATING velocity
- Downside Protection score < 10/25

## Verdict Rules

| Verdict | Score | Conditions |
|---------|-------|------------|
| STRONG BUY | ≥ 85 | No kill criteria, bear decay < 35 |
| BUY | 70–84 | No kill criteria |
| WATCHLIST | 55–69 | — |
| PASS | 45–54 | Mixed signals |
| SELL | 35–44 | Kill criteria triggered or bear decay ≥ 55 |
| STRONG SELL | < 35 | Multiple kill criteria, bear decay ≥ 70 accelerating |

## Setup

### Prerequisites

- Node.js 18+
- AWS Bedrock access with `us.anthropic.claude-sonnet-4-6` enabled
- A `.env` file in the project root

### Environment Variables

```
ANTHROPIC_BEDROCK_BASE_URL=https://bedrock-runtime.<region>.amazonaws.com/v1
ANTHROPIC_AUTH_TOKEN=<your-bedrock-auth-token>
```

### Install & Run

```bash
npm install
node server.js
# Open http://localhost:3000
```

## Data Sources

| Source | What it provides |
|--------|-----------------|
| Yahoo Finance (`yahoo-finance2`) | Live price, P/E, forward P/E, EPS, PEG, P/B, 52-week range, market cap, beta, revenue/earnings growth, gross/operating margins, analyst estimates, FCF, balance sheet, analyst ratings & targets, short interest, insider transactions |
| Claude AI knowledge | Company background, competitive positioning, industry trends, qualitative moat analysis |

## Usage Notes

- **Single stock**: enter a ticker (e.g. `NVDA`) or a company name (e.g. `Apple`). The ticker is uppercased automatically.
- **Portfolio CSV**: export from Robinhood → Account → History → Download. The tool reads `1099-B` rows and uses AI to map descriptions to ticker symbols.
- **Portfolio Screenshots**: take screenshots of your Robinhood positions screen. Claude Vision extracts the holdings directly from the images.
- **Top 25 Picks**: uses a hardcoded live market snapshot baked into the prompts (S&P level, VIX, sector leaders, screener standouts). Re-run any time for fresh picks.

## Tech Stack

- **Backend**: Node.js + Express, SSE streaming
- **AI**: Anthropic Claude Sonnet 4.6 via AWS Bedrock
- **Market Data**: `yahoo-finance2` v3 (ESM, dynamic import)
- **Frontend**: Vanilla JS + CSS (no framework)
