const BACKEND = 'http://localhost:3000';

// ── Agent metadata ────────────────────────────────────────────────────────────
const agentMap = {
  1: { label: 'Growth & Momentum',   emoji: '📈' },
  2: { label: 'Moat & Quality',      emoji: '🏰' },
  3: { label: 'Downside Protection', emoji: '🛡️' },
  4: { label: 'Sentiment & Timing',  emoji: '📡' },
  5: { label: 'Bear Case',           emoji: '🐻' },
};

// ── State ─────────────────────────────────────────────────────────────────────
let subagentResults      = {};
let singleResultsVisible = false;
let picksStarted         = false;
let portfolioMode        = 'csv';
let csvFile              = null;
let screenshotFiles      = [];
let portfolioStarted     = false;
let cryptoStarted        = false;
let cryptoPicksStarted   = false;
let iraStarted           = false;

// ── DOM helpers ───────────────────────────────────────────────────────────────
function qs(id) { return document.getElementById(id); }

function setText(id, val)    { qs(id).textContent = val; }
function setDisplay(id, val) { qs(id).style.display = val; }

// Build an element safely without innerHTML on user data
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'id')   node.id = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

// ── Verdict helpers ───────────────────────────────────────────────────────────
function detectVerdict(text) {
  const u = text.toUpperCase();
  if (/\bVERDICT:\s*STRONG SELL\b/.test(u)) return 'strongsell';
  if (/\bVERDICT:\s*STRONG BUY\b/.test(u))  return 'strongbuy';
  if (/\bVERDICT:\s*SELL\b/.test(u))        return 'sell';
  if (/\bVERDICT:\s*BUY\b/.test(u))         return 'buy';
  if (/\bVERDICT:\s*WATCHLIST\b/.test(u))   return 'watchlist';
  if (/\bVERDICT:\s*PASS\b/.test(u))        return 'pass';
  return 'watchlist';
}

const verdictLabels = {
  strongbuy: '⚡ STRONG BUY', buy: '✓ BUY', watchlist: '◎ WATCHLIST',
  pass: '— PASS', sell: '✗ SELL', strongsell: '⚠ STRONG SELL',
};
function verdictLabel(v) { return verdictLabels[v] || '◎ WATCHLIST'; }

// ── SSE stream reader ─────────────────────────────────────────────────────────
async function readSSE(response, handler) {
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', eventType = null, dataLine = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (line.startsWith('event: '))     { eventType = line.slice(7).trim(); }
      else if (line.startsWith('data: ')) { dataLine  = line.slice(6).trim(); }
      else if (line === '' && eventType && dataLine) {
        try { handler({ eventType, payload: JSON.parse(dataLine) }); }
        catch (e) { if (eventType === 'error') throw e; }
        eventType = null; dataLine = null;
      }
    }
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  ['single', 'portfolio', 'picks', 'crypto', 'ira'].forEach(t => {
    const id = 'tab' + t.charAt(0).toUpperCase() + t.slice(1);
    qs(id)?.classList.toggle('active', t === tab);
  });
  setDisplay('singlePanel',    tab === 'single'    ? '' : 'none');
  setDisplay('portfolioPanel', tab === 'portfolio' ? '' : 'none');
  setDisplay('picksPanel',     tab === 'picks'     ? '' : 'none');
  setDisplay('cryptoPanel',    tab === 'crypto'    ? '' : 'none');
  setDisplay('iraPanel',       tab === 'ira'       ? '' : 'none');

  if (tab !== 'single') setDisplay('results', 'none');
  else if (singleResultsVisible) setDisplay('results', 'block');

  setDisplay('portfolioResults', tab === 'portfolio' ? (portfolioStarted ? '' : 'none') : 'none');
  setDisplay('picksResults',     tab === 'picks'     ? (picksStarted     ? '' : 'none') : 'none');
  setDisplay('cryptoResults',       tab === 'crypto' ? (cryptoStarted      ? '' : 'none') : 'none');
  setDisplay('cryptoPicksResults',  tab === 'crypto' ? (cryptoPicksStarted ? '' : 'none') : 'none');
  setDisplay('iraResults',       tab === 'ira'       ? (iraStarted       ? '' : 'none') : 'none');
}

// ── Single stock analysis ─────────────────────────────────────────────────────
function setAgentState(id, state) {
  const card   = qs(`agent-${id}`);
  const status = qs(`agent-${id}-status`);
  if (!card) return;
  card.className = 'agent-card ' + state;
  if (state === 'running') {
    status.textContent = id === 'synth' ? 'Synthesizing...' : (agentMap[id]?.label || '') + '...';
  } else if (state === 'done') {
    status.textContent = id === 'synth' ? '✓ Done' : '✓ ' + (agentMap[id]?.label || 'Done');
  }
}

function addSubagentCard(agentNum, label, result) {
  const id    = `detail-${agentNum}`;
  const emoji = agentMap[agentNum]?.emoji || '🔍';

  const bodyDiv = el('div', { className: 'detail-body', id });
  const pre     = el('div', { className: 'detail-text' });
  pre.textContent = result;
  bodyDiv.appendChild(pre);

  const headerDiv = el('div', { className: 'detail-header', onclick: () => bodyDiv.classList.toggle('open') });
  const titleSpan = document.createElement('span');
  titleSpan.textContent = `${emoji} ${label}`;
  const statusSpan = el('span', { style: 'color:var(--accent2);font-size:0.78rem;' }, '✓ complete — click to expand');
  headerDiv.appendChild(titleSpan);
  headerDiv.appendChild(statusSpan);

  const card = el('div', { className: 'detail-card' });
  card.appendChild(headerDiv);
  card.appendChild(bodyDiv);
  qs('subagentDetails').appendChild(card);
}

function toggleDetail(id) { qs(id).classList.toggle('open'); }

function renderLiveBanner(ticker, d) {
  const fmt = (n, pct) => {
    if (n == null) return 'N/A';
    if (pct) return (n * 100).toFixed(1) + '%';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    return Number(n).toFixed(2);
  };
  const changeSign = d.change1dPct >= 0 ? '+' : '';
  const changeClass = d.change1dPct >= 0 ? 'live-up' : 'live-down';

  const banner = el('div', { className: 'live-banner', id: 'liveBanner' },
    el('div', { className: 'live-price' },
      el('span', { className: 'live-ticker-label' }, ticker + ' '),
      el('span', { className: 'live-price-num' }, '$' + fmt(d.price)),
      el('span', { className: changeClass }, ` ${changeSign}${fmt(d.change1dPct, true)} today`)
    ),
    el('div', { className: 'live-chips' },
      d.pe    != null ? el('div', { className: 'live-chip' }, el('span', { className: 'chip-label' }, 'P/E '), el('span', { className: 'chip-val' }, fmt(d.pe))) : null,
      d.forwardPE != null ? el('div', { className: 'live-chip' }, el('span', { className: 'chip-label' }, 'Fwd P/E '), el('span', { className: 'chip-val' }, fmt(d.forwardPE))) : null,
      d.mktCap != null ? el('div', { className: 'live-chip' }, el('span', { className: 'chip-label' }, 'MCap '), el('span', { className: 'chip-val' }, '$' + fmt(d.mktCap))) : null,
      d.revenueGrowth != null ? el('div', { className: 'live-chip' }, el('span', { className: 'chip-label' }, 'Rev Growth '), el('span', { className: 'chip-val' }, fmt(d.revenueGrowth, true))) : null,
      d.recommendationKey ? el('div', { className: 'live-chip' }, el('span', { className: 'chip-label' }, 'Analysts '), el('span', { className: 'chip-val' }, d.recommendationKey.toUpperCase())) : null,
      d.targetMeanPrice != null ? el('div', { className: 'live-chip' }, el('span', { className: 'chip-label' }, 'Target '), el('span', { className: 'chip-val' }, '$' + fmt(d.targetMeanPrice))) : null,
    ),
    el('div', { className: 'live-source' }, '⚡ Live data · Yahoo Finance')
  );

  const resultsDiv = qs('results');
  const statusBar  = resultsDiv.querySelector('.status-bar');
  resultsDiv.insertBefore(banner, statusBar ? statusBar.nextSibling : resultsDiv.firstChild);
}

async function runAnalysis() {
  const ticker = qs('ticker').value.trim();
  if (!ticker) {
    qs('ticker').focus();
    qs('ticker').style.borderColor = '#ff6b6b';
    setTimeout(() => { qs('ticker').style.borderColor = ''; }, 1500);
    return;
  }

  singleResultsVisible = true;
  subagentResults = {};
  setDisplay('results', 'block');
  qs('subagentDetails').innerHTML = '';
  setDisplay('verdictBox', 'none');
  qs('verdictContent').textContent = '';
  qs('verdictTicker').textContent  = ticker;
  setDisplay('spinner', '');
  qs('analyzeBtn').disabled    = true;
  qs('analyzeBtn').textContent = 'Analyzing...';
  [1,2,3,4,5,'synth'].forEach(id => setAgentState(id, 'running'));
  setText('statusText', 'Zone Out: launching 4 parallel research agents...');

  // Clear live banner from any prior run
  const oldBanner = qs('liveBanner');
  if (oldBanner) oldBanner.remove();

  let verdictText = '', verdictShown = false;
  const doneAgents = new Set();

  try {
    const response = await fetch(`${BACKEND}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
    });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    await readSSE(response, ({ eventType, payload }) => {
      if (eventType === 'live') {
        renderLiveBanner(ticker.toUpperCase(), payload);

      } else if (eventType === 'status') {
        setText('statusText', payload.message);
        if (payload.message.includes('Zone In')) setAgentState('synth', 'running');

      } else if (eventType === 'subagent') {
        doneAgents.add(payload.agent);
        setAgentState(payload.agent, 'done');
        addSubagentCard(payload.agent, payload.label, payload.result);
        const remaining = [1,2,3,4,5].filter(n => !doneAgents.has(n));
        setText('statusText', remaining.length === 0
          ? 'Zone In: synthesizing final verdict...'
          : `Zone Out: ${remaining.length} agent(s) still running...`);

      } else if (eventType === 'token') {
        if (!verdictShown) { setDisplay('verdictBox', 'block'); verdictShown = true; }
        verdictText += payload.text;
        const content = qs('verdictContent');
        content.textContent = verdictText;
        content.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      } else if (eventType === 'done') {
        const v   = detectVerdict(verdictText);
        const box = qs('verdictBox');
        const bdg = qs('verdictBadge');
        box.className   = 'verdict-box ' + v;
        bdg.className   = 'verdict-badge ' + v;
        bdg.textContent = verdictLabel(v);
        qs('verdictContent').textContent = verdictText;
        setAgentState('synth', 'done');
        setText('statusText', 'Analysis complete');
        setDisplay('spinner', 'none');

      } else if (eventType === 'error') {
        throw new Error(payload.message);
      }
    });
  } catch (err) {
    setText('statusText', 'Error: ' + err.message);
    setDisplay('spinner', 'none');
    const errBox = el('div', { className: 'error-box' },
      '⚠️ ' + err.message + '\n\nMake sure the backend server is running: node server.js');
    qs('subagentDetails').prepend(errBox);
  } finally {
    qs('analyzeBtn').disabled    = false;
    qs('analyzeBtn').textContent = 'Analyze Stock — AI Deep Dive →';
  }
}

qs('ticker').addEventListener('keydown', e => { if (e.key === 'Enter') runAnalysis(); });

// ── Portfolio: mode toggle ────────────────────────────────────────────────────
function switchMode(mode) {
  portfolioMode = mode;
  qs('modeCSV').classList.toggle('active', mode === 'csv');
  qs('modeScreenshot').classList.toggle('active', mode === 'screenshot');
  setDisplay('csvMode',        mode === 'csv'        ? '' : 'none');
  setDisplay('screenshotMode', mode === 'screenshot' ? '' : 'none');
  checkPortfolioBtnReady();
}

function checkPortfolioBtnReady() {
  qs('portfolioBtn').disabled =
    portfolioMode === 'csv' ? !csvFile : screenshotFiles.length === 0;
}

// ── Portfolio: CSV handling ───────────────────────────────────────────────────
function handleFileSelect(e) { csvFile = e.target.files[0]; onFileChosen(); }

function handleDrop(e) {
  e.preventDefault();
  qs('dropZone').classList.remove('drag-over');
  csvFile = e.dataTransfer.files[0];
  onFileChosen();
}

function onFileChosen() {
  if (!csvFile) return;
  setText('fileChosen', '✓ ' + csvFile.name);
  checkPortfolioBtnReady();
}

function parseCSV(text) {
  // Normalize line endings and split, handling quoted fields that may contain newlines
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // ── Format 1: Robinhood Account Activity CSV ──────────────────────────────
  // Header: "Activity Date","Process Date","Settle Date","Instrument","Description","Trans Code","Quantity","Price","Amount"
  if (normalised.includes('"Activity Date"') || normalised.includes('Activity Date')) {
    const tickers = new Set();
    // Split on newlines but skip rows that are continuations of quoted fields
    const rows = [];
    let current = '';
    let inQuote = false;
    for (const ch of normalised) {
      if (ch === '"') inQuote = !inQuote;
      if (ch === '\n' && !inQuote) { rows.push(current); current = ''; }
      else current += ch;
    }
    if (current.trim()) rows.push(current);

    for (const row of rows) {
      if (!row.trim()) continue;
      // Split CSV fields respecting quotes
      const fields = [];
      let f = '', q = false;
      for (const ch of row) {
        if (ch === '"') { q = !q; continue; }
        if (ch === ',' && !q) { fields.push(f.trim()); f = ''; }
        else f += ch;
      }
      fields.push(f.trim());

      const instrument = fields[3];
      const transCode  = fields[5];
      if (!instrument || !instrument.match(/^[A-Z]{1,5}$/)) continue;
      // Only include actual stock buys and holds — skip dividends, transfers, ACH
      const skip = ['CDIV', 'ACH', 'ITRF', 'DTRF', 'JNLS', 'JNLC', 'RTP', 'ACATS'];
      if (skip.includes(transCode)) continue;
      tickers.add(instrument);
    }
    return { format: 'activity', tickers: [...tickers] };
  }

  // ── Format 2: Robinhood 1099 Tax CSV ─────────────────────────────────────
  // Rows start with "1099-B," and description is at index 5
  const descriptions = new Set();
  for (const line of normalised.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (!line.startsWith('1099-B,')) continue;
    const desc = line.split(',')[5]?.trim();
    if (desc && desc !== 'DESCRIPTION') descriptions.add(desc);
  }
  return { format: '1099', descriptions: [...descriptions] };
}

// ── Portfolio: screenshot handling ────────────────────────────────────────────
function handleScreenshotSelect(e) { addScreenshots([...e.target.files]); e.target.value = ''; }

function handleScreenshotDrop(e) {
  e.preventDefault();
  qs('screenshotZone').classList.remove('drag-over');
  addScreenshots([...e.dataTransfer.files].filter(f => f.type.startsWith('image/')));
}

function addScreenshots(files) {
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      const dataUrl = ev.target.result;
      const [meta, base64] = dataUrl.split(',');
      const mediaType = meta.match(/:(.*?);/)[1];
      screenshotFiles.push({ file, dataUrl, mediaType, base64 });
      renderScreenshotPreviews();
      checkPortfolioBtnReady();
    };
    reader.readAsDataURL(file);
  });
}

function renderScreenshotPreviews() {
  const container = qs('screenshotPreviews');
  container.innerHTML = '';
  screenshotFiles.forEach((entry, i) => {
    const img = el('img', { src: entry.dataUrl, alt: `Screenshot ${i + 1}` });
    const btn = el('button', { className: 'remove-thumb', onclick: () => removeScreenshot(i) }, '✕');
    container.appendChild(el('div', { className: 'screenshot-thumb' }, img, btn));
  });
}

function removeScreenshot(i) {
  screenshotFiles.splice(i, 1);
  renderScreenshotPreviews();
  checkPortfolioBtnReady();
}

// ── Portfolio: analysis ───────────────────────────────────────────────────────
function extractScore(text) {
  const m = text.match(/COMPOSITE SCORE:\s*(\d+)\s*\/\s*100/i);
  return m ? m[1] + '/100' : '';
}
function extractKill(text) {
  const m = text.match(/KILL CRITERIA:\s*(.+)/i);
  return m ? m[1].trim() : '';
}

function addPortfolioRow(ticker, state) {
  if (qs('prow-' + ticker)) return;

  const summaryDiv = el('div', { className: 'p-summary', id: 'psummary-' + ticker }, 'Analyzing...');
  const expandBtn  = el('button', { className: 'p-expand-btn', id: 'pexpbtn-' + ticker,
    onclick: () => togglePDetail(ticker), style: 'display:none' }, 'show full analysis');
  const badge      = el('div', { className: `p-badge ${state}`, id: 'pbadge-' + ticker }, '⟳ Running');
  const detail     = el('div', { className: 'p-detail', id: 'pdetail-' + ticker });

  const row = el('div', { className: 'portfolio-row ' + state, id: 'prow-' + ticker },
    el('div', { className: 'p-ticker' }, ticker),
    el('div', {}, summaryDiv, expandBtn),
    badge,
    detail
  );
  qs('portfolioGrid').appendChild(row);
}

function updatePortfolioRow(ticker, state, verdict, hasDetail) {
  const row = qs('prow-' + ticker);
  if (!row) return;
  row.className = 'portfolio-row ' + state;

  const badge = qs('pbadge-' + ticker);
  badge.className   = 'p-badge ' + state;
  badge.textContent = verdictLabel(state);

  const score = extractScore(verdict);
  const kill  = extractKill(verdict);
  const summary = qs('psummary-' + ticker);
  summary.textContent = '';
  if (score) { const s = el('strong', {}, 'Score:'); summary.appendChild(s); summary.appendChild(document.createTextNode(' ' + score)); }
  if (kill)  { summary.appendChild(document.createTextNode('  |  ')); const k = el('strong', {}, 'Kill:'); summary.appendChild(k); summary.appendChild(document.createTextNode(' ' + kill)); }

  if (hasDetail) {
    qs('pdetail-' + ticker).textContent = verdict;
    qs('pexpbtn-' + ticker).style.display = '';
  }
  updateSummaryCounts();
}

function togglePDetail(ticker) {
  const detail = qs('pdetail-' + ticker);
  const btn    = qs('pexpbtn-' + ticker);
  const open   = detail.style.display === 'block';
  detail.style.display = open ? 'none' : 'block';
  btn.textContent      = open ? 'show full analysis' : 'hide';
}

function updateSummaryCounts() {
  let buy = 0, watch = 0, pass = 0, total = 0;
  document.querySelectorAll('.portfolio-row').forEach(r => {
    const c = r.className;
    if      (c.includes('strongbuy') || (c.includes('buy') && !c.includes('strong')))   { buy++;   total++; }
    else if (c.includes('watchlist'))                                                    { watch++; total++; }
    else if (c.includes('strongsell') || c.includes('sell') || c.includes('pass'))      { pass++;  total++; }
  });
  setText('countBuy',   String(buy));
  setText('countWatch', String(watch));
  setText('countPass',  String(pass));
  setText('countTotal', String(total));
}

function portfolioError(msg) {
  setText('portfolioStatusText', msg);
  setDisplay('portfolioSpinner', 'none');
  qs('portfolioBtn').disabled    = false;
  qs('portfolioBtn').textContent = 'Analyze Portfolio — Run All Agents →';
}

async function runPortfolioAnalysis() {
  portfolioStarted = true;
  setDisplay('portfolioResults',  '');
  qs('portfolioGrid').innerHTML          = '';
  setDisplay('portfolioDecision', 'none');
  setDisplay('portfolioSummary',  'none');
  qs('portfolioBtn').disabled            = true;
  qs('portfolioBtn').textContent         = 'Analyzing...';
  setDisplay('portfolioSpinner',  '');

  let tickers = [];

  if (portfolioMode === 'screenshot') {
    if (!screenshotFiles.length) return;
    setText('portfolioStatusText', `Reading ${screenshotFiles.length} screenshot(s) with AI Vision...`);
    try {
      const res  = await fetch(`${BACKEND}/api/extract-from-screenshots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: screenshotFiles.map(s => ({ mediaType: s.mediaType, base64: s.base64 })) }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const holdings = data.holdings || [];
      if (!holdings.length) throw new Error('No holdings found. Try clearer screenshots of your Robinhood positions.');
      tickers = [...new Set(holdings.map(h => h.ticker.toUpperCase()))].filter(Boolean);
      setText('portfolioStatusText', `AI Vision found ${tickers.length} holding(s): ${tickers.join(', ')}`);
    } catch (err) { return portfolioError(err.message); }

  } else {
    if (!csvFile) return;
    setText('portfolioStatusText', 'Reading CSV...');
    const parsed = parseCSV(await csvFile.text());

    if (parsed.format === 'activity') {
      // Account Activity CSV — tickers extracted directly
      tickers = parsed.tickers;
      if (!tickers.length) return portfolioError('No stock positions found. The CSV had no Buy/Sell transactions — only dividends or transfers.');
      setText('portfolioStatusText', `Found ${tickers.length} holding(s): ${tickers.join(', ')}`);

    } else {
      // 1099 tax CSV — descriptions need AI mapping to tickers
      if (!parsed.descriptions.length) return portfolioError('No stock transactions found. Upload a Robinhood Account Activity CSV (Account → Statements → Activity) or the 1099 tax CSV.');
      setText('portfolioStatusText', `Found ${parsed.descriptions.length} position(s) — resolving tickers...`);
      try {
        const res  = await fetch(`${BACKEND}/api/extract-tickers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ descriptions: parsed.descriptions }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        tickers = [...new Set(Object.values(data.mapping || {}))].filter(Boolean);
        if (!tickers.length) throw new Error('Could not resolve any tickers from the tax CSV.');
      } catch (err) { return portfolioError(err.message); }
    }
  }

  setText('portfolioStatusText', `Analyzing ${tickers.length} stock(s)...`);
  setDisplay('portfolioSummary', '');
  tickers.forEach(t => addPortfolioRow(t, 'analyzing'));

  const results = [];
  for (let i = 0; i < tickers.length; i += 3) {
    const batch = tickers.slice(i, i + 3);
    setText('portfolioStatusText', `Analyzing ${Math.min(i + 3, tickers.length)}/${tickers.length}...`);

    await Promise.all(batch.map(async ticker => {
      try {
        const res  = await fetch(`${BACKEND}/api/analyze-simple`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        const v = detectVerdict(data.verdict);
        updatePortfolioRow(ticker, v, data.verdict, !!data.subagents);
        results.push({ ticker, verdict: v, verdictText: data.verdict });
      } catch (err) {
        updatePortfolioRow(ticker, 'pass', `Error: ${err.message}`, false);
      }
    }));
  }

  setText('portfolioStatusText', 'Generating KEEP/TRIM/SELL decisions...');
  const holdings = results.map(r => {
    const vt = r.verdictText || '';
    return {
      ticker:       r.ticker,
      verdict:      r.verdict,
      score:        (vt.match(/COMPOSITE SCORE:\s*(\d+)/i) || [])[1] || '?',
      killCriteria: ((vt.match(/KILL CRITERIA:\s*(.+)/i) || [])[1] || 'none').trim().slice(0, 120),
      bull:         ((vt.match(/THE BULL CASE.*?:\s*([\s\S]*?)(?=THE BEAR|$)/i) || [])[1] || '').trim().slice(0, 200),
      bear:         ((vt.match(/THE BEAR CASE.*?:\s*([\s\S]*?)(?=POSITION|$)/i) || [])[1] || '').trim().slice(0, 200),
    };
  });

  try {
    const r = await fetch(`${BACKEND}/api/portfolio-decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ holdings }),
    });
    const d = await r.json();
    if (d.decision) renderPortfolioDecision(d.decision);
  } catch (_) { /* best-effort */ }

  setText('portfolioStatusText', `Done — ${tickers.length} stock(s) analyzed`);
  setDisplay('portfolioSpinner', 'none');
  qs('portfolioBtn').disabled    = false;
  qs('portfolioBtn').textContent = 'Analyze Portfolio — Run All Agents →';
}

function renderPortfolioDecision(text) {
  const decisionDiv = qs('portfolioDecision');
  setDisplay('portfolioDecision', '');

  const panel = el('div', { className: 'decision-panel' });
  panel.appendChild(el('h3', {}, 'Portfolio Actions — What to Do Now'));

  let summary = '';
  for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (line.startsWith('PORTFOLIO SUMMARY:')) {
      summary = line.replace('PORTFOLIO SUMMARY:', '').trim();
      continue;
    }
    const parts = line.split('|').map(p => p.trim());
    if (parts.length >= 3) {
      const [ticker, action, reason] = parts;
      const cls = action.toLowerCase().replace(/\s+/g, '');
      const row = el('div', { className: 'decision-row' },
        el('span', { className: 'decision-ticker' }, ticker),
        el('span', { className: `decision-action ${cls}` }, action),
        el('span', { className: 'decision-reason' }, reason)
      );
      panel.appendChild(row);
    }
  }
  if (summary) {
    const s = el('div', { className: 'decision-summary' }, summary);
    panel.appendChild(s);
  }
  decisionDiv.innerHTML = '';
  decisionDiv.appendChild(panel);
}

// ── Top 25 Picks ──────────────────────────────────────────────────────────────
async function runTopPicks() {
  picksStarted = true;
  setDisplay('picksResults', '');
  qs('picksGrid').innerHTML   = '';
  qs('screenCards').innerHTML = '';
  qs('picksBtn').disabled     = true;
  qs('picksBtn').textContent  = 'Scanning market...';
  setDisplay('picksSpinner', '');
  setText('picksStatusText', 'Launching 3 market screen agents...');

  [
    { id: 'macro',  emoji: '🌍', label: 'Macro & Sector Analysis' },
    { id: 'growth', emoji: '📈', label: 'Growth Stock Screen' },
    { id: 'value',  emoji: '💎', label: 'Value/Quality Screen' },
  ].forEach(s => {
    const bodyDiv = el('div', { className: 'screen-card-body', id: 'scardbody-' + s.id });
    bodyDiv.appendChild(el('div', { className: 'detail-text', id: 'scardtext-' + s.id }));

    const statusSpan = el('span', { id: 'scardstatus-' + s.id, style: 'color:var(--accent);font-size:0.78rem;' }, '⟳ Running...');
    const titleSpan  = document.createTextNode(`${s.emoji} ${s.label}`);
    const header = el('div', { className: 'screen-card-header', onclick: () => toggleScreenCard(s.id) });
    header.appendChild(document.createTextNode(`${s.emoji} ${s.label}`));
    header.appendChild(statusSpan);

    const card = el('div', { className: 'screen-card', id: 'scard-' + s.id }, header, bodyDiv);
    qs('screenCards').appendChild(card);
  });

  try {
    const response = await fetch(`${BACKEND}/api/top-picks`, { method: 'POST' });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    await readSSE(response, ({ eventType, payload }) => {
      if (eventType === 'status') {
        setText('picksStatusText', payload.message);

      } else if (eventType === 'screen') {
        qs('scard-' + payload.agent)?.classList.add('done');
        const statusEl = qs('scardstatus-' + payload.agent);
        if (statusEl) { statusEl.textContent = '✓ complete — click to expand'; statusEl.style.color = 'var(--accent2)'; }
        const textEl = qs('scardtext-' + payload.agent);
        if (textEl) textEl.textContent = payload.result;

      } else if (eventType === 'picks') {
        renderTopPicks(payload.picks);

      } else if (eventType === 'done') {
        setText('picksStatusText', 'Market scan complete — top 25 picks ready');
        setDisplay('picksSpinner', 'none');

      } else if (eventType === 'error') {
        throw new Error(payload.message);
      }
    });
  } catch (err) {
    setText('picksStatusText', 'Error: ' + err.message);
    setDisplay('picksSpinner', 'none');
  } finally {
    qs('picksBtn').disabled    = false;
    qs('picksBtn').textContent = 'Re-run Market Scan →';
  }
}

function toggleScreenCard(id) { qs('scardbody-' + id).classList.toggle('open'); }

function renderTopPicks(picks) {
  const grid = qs('picksGrid');
  grid.innerHTML = '';
  picks.forEach(p => {
    const meta = el('div', { className: 'pick-meta' },
      `⚡ Catalyst: ${p.catalyst}  |  ⚠ Risk: ${p.risk}  |  ⏱ ${p.timeframe}`);

    const body = el('div', { className: 'pick-body' },
      el('div', { className: 'pick-company' }, p.company),
      el('div', { className: 'pick-sector'  }, p.sector),
      el('div', { className: 'pick-thesis'  }, p.thesis),
      meta
    );
    if (p.positionSize) {
      const pos = el('div', { className: 'pick-position' }, p.positionSize);
      body.appendChild(pos);
    }

    const card = el('div', { className: 'pick-card' },
      el('div', { className: `pick-rank ${p.rank <= 3 ? 'top3' : ''}` }, `#${p.rank}`),
      el('div', { className: 'pick-ticker' }, p.ticker),
      body,
      el('div', { className: `pick-conviction ${p.conviction}` }, p.conviction)
    );
    grid.appendChild(card);
  });
}

// ── Crypto Analysis ───────────────────────────────────────────────────────────
async function runCryptoAnalysis() {
  const symbol = qs('cryptoSymbol').value.trim().toUpperCase();
  if (!symbol) {
    qs('cryptoSymbol').focus();
    qs('cryptoSymbol').style.borderColor = '#ff6b6b';
    setTimeout(() => { qs('cryptoSymbol').style.borderColor = ''; }, 1500);
    return;
  }

  cryptoStarted = true;
  setDisplay('cryptoResults', 'block');
  setDisplay('cryptoVerdict', 'none');
  qs('cryptoVerdictContent').textContent = '';
  qs('cryptoVerdictTicker').textContent  = symbol;
  setDisplay('cryptoSpinner', '');
  qs('cryptoBtn').disabled    = true;
  qs('cryptoBtn').textContent = 'Analyzing...';
  setText('cryptoStatusText', `Fetching live data for ${symbol}...`);

  let verdictText = '', verdictShown = false;

  try {
    const response = await fetch(`${BACKEND}/api/crypto-analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol }),
    });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    await readSSE(response, ({ eventType, payload }) => {
      if (eventType === 'live') {
        const fmt = (n, pct) => {
          if (n == null) return 'N/A';
          if (pct) return (n * 100).toFixed(1) + '%';
          if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
          if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
          return Number(n).toFixed(2);
        };
        const oldBanner = qs('cryptoLiveBanner');
        if (oldBanner) oldBanner.remove();
        const changeSign  = payload.change1dPct >= 0 ? '+' : '';
        const changeClass = payload.change1dPct >= 0 ? 'live-up' : 'live-down';
        const banner = el('div', { className: 'live-banner', id: 'cryptoLiveBanner' },
          el('div', { className: 'live-price' },
            el('span', { className: 'live-ticker-label' }, symbol + ' '),
            el('span', { className: 'live-price-num' }, '$' + fmt(payload.price)),
            el('span', { className: changeClass }, ` ${changeSign}${fmt(payload.change1dPct)}% today`)
          ),
          el('div', { className: 'live-chips' },
            payload.mktCap != null ? el('div', { className: 'live-chip' }, el('span', { className: 'chip-label' }, 'MCap '), el('span', { className: 'chip-val' }, '$' + fmt(payload.mktCap))) : null,
            payload.pricePct52w != null ? el('div', { className: 'live-chip' }, el('span', { className: 'chip-label' }, '52w pos '), el('span', { className: 'chip-val' }, fmt(payload.pricePct52w) + '%')) : null,
            payload.low52w != null ? el('div', { className: 'live-chip' }, el('span', { className: 'chip-label' }, '52w low '), el('span', { className: 'chip-val' }, '$' + fmt(payload.low52w))) : null,
            payload.high52w != null ? el('div', { className: 'live-chip' }, el('span', { className: 'chip-label' }, '52w high '), el('span', { className: 'chip-val' }, '$' + fmt(payload.high52w))) : null,
          ),
          el('div', { className: 'live-source' }, '⚡ Live data · Yahoo Finance')
        );
        qs('cryptoResults').insertBefore(banner, qs('cryptoStatus').nextSibling);

      } else if (eventType === 'status') {
        setText('cryptoStatusText', payload.message);

      } else if (eventType === 'token') {
        if (!verdictShown) { setDisplay('cryptoVerdict', 'block'); verdictShown = true; }
        verdictText += payload.text;
        qs('cryptoVerdictContent').textContent = verdictText;

      } else if (eventType === 'done') {
        const v   = detectVerdict(verdictText);
        const box = qs('cryptoVerdict');
        const bdg = qs('cryptoVerdictBadge');
        box.className   = 'verdict-box ' + v;
        bdg.className   = 'verdict-badge ' + v;
        bdg.textContent = verdictLabel(v);
        setText('cryptoStatusText', 'Analysis complete');
        setDisplay('cryptoSpinner', 'none');

      } else if (eventType === 'error') {
        throw new Error(payload.message);
      }
    });
  } catch (err) {
    setText('cryptoStatusText', 'Error: ' + err.message);
    setDisplay('cryptoSpinner', 'none');
  } finally {
    qs('cryptoBtn').disabled    = false;
    qs('cryptoBtn').textContent = 'Analyze Crypto — AI Deep Dive →';
  }
}

qs('cryptoSymbol').addEventListener('keydown', e => { if (e.key === 'Enter') runCryptoAnalysis(); });

function switchCryptoMode(mode) {
  qs('cryptoModeSingle').classList.toggle('active', mode === 'single');
  qs('cryptoModeTop25').classList.toggle('active',  mode === 'top25');
  setDisplay('cryptoSingleMode', mode === 'single' ? '' : 'none');
  setDisplay('cryptoTop25Mode',  mode === 'top25'  ? '' : 'none');
}

async function runCryptoTopPicks() {
  cryptoPicksStarted = true;
  setDisplay('cryptoPicksResults', '');
  qs('cryptoPicksGrid').innerHTML   = '';
  qs('cryptoScreenCards').innerHTML = '';
  qs('cryptoPicksBtn').disabled     = true;
  qs('cryptoPicksBtn').textContent  = 'Scanning market...';
  setDisplay('cryptoPicksSpinner', '');
  setText('cryptoPicksStatusText', 'Launching 3 crypto screen agents...');

  [
    { id: 'macro',    emoji: '🌍', label: 'Crypto Macro & Narrative Analysis' },
    { id: 'bluechip', emoji: '₿',  label: 'Blue Chip Screen (BTC, ETH, SOL...)' },
    { id: 'growth',   emoji: '🚀', label: 'High Growth & Narrative Screen' },
  ].forEach(s => {
    const bodyDiv = el('div', { className: 'screen-card-body', id: 'cscardbody-' + s.id });
    bodyDiv.appendChild(el('div', { className: 'detail-text', id: 'cscardtext-' + s.id }));
    const statusSpan = el('span', { id: 'cscardstatus-' + s.id, style: 'color:var(--accent);font-size:0.78rem;' }, '⟳ Running...');
    const header = el('div', { className: 'screen-card-header', onclick: () => toggleCryptoScreenCard(s.id) });
    header.appendChild(document.createTextNode(`${s.emoji} ${s.label}`));
    header.appendChild(statusSpan);
    const card = el('div', { className: 'screen-card', id: 'cscard-' + s.id }, header, bodyDiv);
    qs('cryptoScreenCards').appendChild(card);
  });

  try {
    const response = await fetch(`${BACKEND}/api/crypto-top-picks`, { method: 'POST' });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    await readSSE(response, ({ eventType, payload }) => {
      if (eventType === 'status') {
        setText('cryptoPicksStatusText', payload.message);

      } else if (eventType === 'screen') {
        qs('cscard-' + payload.agent)?.classList.add('done');
        const statusEl = qs('cscardstatus-' + payload.agent);
        if (statusEl) { statusEl.textContent = '✓ complete — click to expand'; statusEl.style.color = 'var(--accent2)'; }
        const textEl = qs('cscardtext-' + payload.agent);
        if (textEl) textEl.textContent = payload.result;

      } else if (eventType === 'picks') {
        renderCryptoTopPicks(payload.picks);

      } else if (eventType === 'done') {
        setText('cryptoPicksStatusText', 'Crypto scan complete — top 25 picks ready');
        setDisplay('cryptoPicksSpinner', 'none');

      } else if (eventType === 'error') {
        throw new Error(payload.message);
      }
    });
  } catch (err) {
    setText('cryptoPicksStatusText', 'Error: ' + err.message);
    setDisplay('cryptoPicksSpinner', 'none');
  } finally {
    qs('cryptoPicksBtn').disabled    = false;
    qs('cryptoPicksBtn').textContent = 'Re-run Crypto Scan →';
  }
}

function toggleCryptoScreenCard(id) { qs('cscardbody-' + id).classList.toggle('open'); }

function renderCryptoTopPicks(picks) {
  const grid = qs('cryptoPicksGrid');
  grid.innerHTML = '';
  picks.forEach(p => {
    const meta = el('div', { className: 'pick-meta' },
      `⚡ Catalyst: ${p.catalyst}  |  ⚠ Risk: ${p.risk}  |  ⏱ ${p.timeframe}`);

    const body = el('div', { className: 'pick-body' },
      el('div', { className: 'pick-company' }, p.name),
      el('div', { className: 'pick-sector'  }, p.category),
      el('div', { className: 'pick-thesis'  }, p.thesis),
      meta
    );
    if (p.positionSize) {
      body.appendChild(el('div', { className: 'pick-position' }, p.positionSize));
    }

    const card = el('div', { className: 'pick-card' },
      el('div', { className: `pick-rank ${p.rank <= 3 ? 'top3' : ''}` }, `#${p.rank}`),
      el('div', { className: 'pick-ticker' }, p.symbol),
      body,
      el('div', { className: `pick-conviction ${p.conviction}` }, p.conviction)
    );
    grid.appendChild(card);
  });
}

// ── IRA Advisor ───────────────────────────────────────────────────────────────
async function runIraAdvisor() {
  const profile = {
    accountType:      qs('iraType').value,
    totalValue:       qs('iraTotalValue').value.trim() || '0',
    cashValue:        qs('iraCashValue').value.trim() || '0',
    stocksValue:      String((parseFloat(qs('iraTotalValue').value) || 0) - (parseFloat(qs('iraCashValue').value) || 0)).slice(0, 10),
    age:              qs('iraAge').value.trim(),
    income:           qs('iraIncome').value.trim(),
    yearsToRetirement: qs('iraYears').value.trim(),
    holdings:         qs('iraHoldings').value.trim(),
    riskTolerance:    qs('iraRisk').value,
  };

  if (!profile.totalValue || profile.totalValue === '0') {
    qs('iraTotalValue').focus();
    qs('iraTotalValue').style.borderColor = '#ff6b6b';
    setTimeout(() => { qs('iraTotalValue').style.borderColor = ''; }, 1500);
    return;
  }

  iraStarted = true;
  setDisplay('iraResults', 'block');
  setDisplay('iraVerdict', 'none');
  qs('iraVerdictContent').textContent = '';
  setDisplay('iraSpinner', '');
  qs('iraBtn').disabled    = true;
  qs('iraBtn').textContent = 'Analyzing...';
  setText('iraStatusText', 'Analyzing your IRA...');

  let verdictText = '', verdictShown = false;

  try {
    const response = await fetch(`${BACKEND}/api/ira-advisor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile }),
    });
    if (!response.ok) throw new Error(`Server error: ${response.status}`);

    await readSSE(response, ({ eventType, payload }) => {
      if (eventType === 'token') {
        if (!verdictShown) { setDisplay('iraVerdict', 'block'); verdictShown = true; }
        verdictText += payload.text;
        qs('iraVerdictContent').textContent = verdictText;
        qs('iraVerdictContent').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

      } else if (eventType === 'done') {
        // IRA box always uses a neutral teal border
        qs('iraVerdict').className = 'verdict-box buy';
        setText('iraStatusText', 'Your personalized IRA plan is ready');
        setDisplay('iraSpinner', 'none');

      } else if (eventType === 'error') {
        throw new Error(payload.message);
      }
    });
  } catch (err) {
    setText('iraStatusText', 'Error: ' + err.message);
    setDisplay('iraSpinner', 'none');
  } finally {
    qs('iraBtn').disabled    = false;
    qs('iraBtn').textContent = 'Get IRA Advice — Personalized Plan →';
  }
}
