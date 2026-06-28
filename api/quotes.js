// ─────────────────────────────────────────────────────────────────────
// /api/quotes.js  —  Yahoo Finance proxy for ETFs, sectors, indices
//
// This handles everything Massive doesn't cover on the Starter plan:
//  • Index tickers  (^GSPC, ^DJI, ^IXIC, ^VIX)
//  • ETF tickers    (QQQ, XLK, SPY, SMH, etc.)
//  • Sector tickers (SOXX, XLV, XLF, etc.)
//
// Called as:  GET /api/quotes?symbols=QQQ,SPY,^GSPC
// Returns:  { quotes: { QQQ: { price, changePct, volume }, ... } }
// ─────────────────────────────────────────────────────────────────────
const UA = 'Mozilla/5.0 (compatible; StockTerminal/1.0)';

async function fetchYahoo(symbols) {
  const enc = symbols.map(encodeURIComponent).join(',');
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${enc}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketVolume,regularMarketPreviousClose,shortName`;

  // Yahoo needs a crumb+cookie for v7 — try without first, fallback to chart API
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (r.ok) {
      const d = await r.json();
      const list = d?.quoteResponse?.result || [];
      const out = {};
      for (const q of list) {
        out[q.symbol] = {
          price: q.regularMarketPrice || 0,
          changePct: parseFloat((q.regularMarketChangePercent || 0).toFixed(2)),
          volume: q.regularMarketVolume || 0,
          prevClose: q.regularMarketPreviousClose || 0,
          name: q.shortName || q.symbol,
        };
      }
      return out;
    }
  } catch (_) {}

  // Fallback: chart endpoint (no crumb needed, one at a time)
  const out = {};
  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const r = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`,
          { headers: { 'User-Agent': UA } }
        );
        if (!r.ok) return;
        const d = await r.json();
        const m = d?.chart?.result?.[0]?.meta;
        if (!m) return;
        const prev = m.chartPreviousClose || m.previousClose || m.regularMarketPrice;
        const price = m.regularMarketPrice;
        out[sym] = {
          price,
          changePct: prev ? parseFloat((((price - prev) / prev) * 100).toFixed(2)) : 0,
          volume: m.regularMarketVolume || 0,
          prevClose: prev,
          name: m.shortName || sym,
        };
      } catch (_) {}
    })
  );
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const raw = (req.query?.symbols || '').toString();
  const symbols = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (!symbols.length) return res.status(400).json({ ok: false, error: 'No symbols' });

  try {
    const quotes = await fetchYahoo(symbols);
    return res.status(200).json({ ok: true, quotes, ts: Date.now() });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, quotes: {} });
  }
}
