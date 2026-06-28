
// ─────────────────────────────────────────────────────────────────────
// /api/stocks.js  —  Massive API proxy for stock watchlist data
//
// This replaces the broken client-side fetch to api.massive.com.
// The browser can't call Massive directly (CORS). This runs on Vercel
// server-side, fetches a batch of tickers, and returns clean JSON.
//
// Called as:  GET /api/stocks?symbols=AAPL,MSFT,NVDA
// Returns:  { quotes: { AAPL: { price, changePct, volRatio }, ... } }
// ─────────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=60');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const MASSIVE_KEY = process.env.MASSIVE_KEY;
  if (!MASSIVE_KEY) {
    return res.status(500).json({ ok: false, error: 'MASSIVE_KEY not set', quotes: {} });
  }

  const raw = (req.query?.symbols || '').toString();
  const symbols = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 100);
  if (!symbols.length) return res.status(400).json({ ok: false, error: 'No symbols' });

  try {
    // Massive batch snapshot endpoint — works on Starter plan (15-min delayed)
    const url =
      `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers` +
      `?tickers=${encodeURIComponent(symbols.join(','))}&apiKey=${MASSIVE_KEY}`;

    const r = await fetch(url);
    if (!r.ok) {
      const txt = await r.text().catch(() => r.status.toString());
      throw new Error(`Massive ${r.status}: ${txt.slice(0, 200)}`);
    }

    const data = await r.json();
    // Massive returns: { tickers: [ { ticker, day, prevDay, todaysChange, todaysChangePerc, lastTrade, min }, ...] }
    const list = data.tickers || [];
    const quotes = {};

    for (const t of list) {
      const sym = t.ticker;
      if (!sym) continue;

      // Best price: lastTrade.p > min.c > day.c
      const price =
        t.lastTrade?.p ||
        t.min?.c ||
        t.day?.c ||
        0;

      // Massive gives us todaysChangePerc directly — use it
      const changePct =
        t.todaysChangePerc != null
          ? parseFloat(t.todaysChangePerc.toFixed(2))
          : t.prevDay?.c && price
          ? parseFloat((((price - t.prevDay.c) / t.prevDay.c) * 100).toFixed(2))
          : 0;

      // Volume ratio: today's vol / yesterday's vol
      const vol = t.day?.v || 0;
      const avgVol = t.prevDay?.v || vol || 1;
      const volRatio = avgVol > 0 ? parseFloat((vol / avgVol).toFixed(2)) : 1;

      quotes[sym] = {
        price: parseFloat(price.toFixed(2)),
        changePct,
        change: t.todaysChange || 0,
        volume: vol,
        avgVolume: avgVol,
        volRatio: Math.max(0.1, volRatio),
        prevClose: t.prevDay?.c || 0,
      };
    }

    return res.status(200).json({ ok: true, quotes, ts: Date.now(), count: list.length });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message, quotes: {} });
  }
}
