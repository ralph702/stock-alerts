// ─────────────────────────────────────────────────────────────────────
// /api/stocks.js  —  Massive API proxy for stock watchlist data
//
// Handles the fact that Massive snapshots CLEAR at 3:30 AM EST daily
// and only repopulate when exchanges open. On weekends/holidays the
// snapshot is empty. This file falls back to the Previous Day endpoint
// so you always see real prices.
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
  const symbols = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 100);
  if (!symbols.length) return res.status(400).json({ ok: false, error: 'No symbols' });

  const quotes = {};

  // ── ATTEMPT 1: Batch snapshot (works when market is open/recently closed) ──
  try {
    const url =
      `https://api.massive.com/v2/snapshot/locale/us/markets/stocks/tickers` +
      `?tickers=${symbols.join(',')}&apiKey=${MASSIVE_KEY}`;

    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      const list = data.tickers || [];

      for (const t of list) {
        const sym = t.ticker;
        if (!sym) continue;

        // Price priority: lastTrade > min > day close > prevDay close
        const price =
          (t.lastTrade && t.lastTrade.p) ||
          (t.min && t.min.c) ||
          (t.day && t.day.c) ||
          (t.prevDay && t.prevDay.c) ||
          0;

        // Change: use Massive's built-in field, fall back to manual calc
        let changePct = 0;
        if (t.todaysChangePerc != null && t.todaysChangePerc !== 0) {
          changePct = parseFloat(t.todaysChangePerc.toFixed(2));
        } else if (t.prevDay && t.prevDay.c && price) {
          changePct = parseFloat((((price - t.prevDay.c) / t.prevDay.c) * 100).toFixed(2));
        }

        // Volume ratio
        const vol = (t.day && t.day.v) || 0;
        const avgVol = (t.prevDay && t.prevDay.v) || vol || 1;
        const volRatio = avgVol > 0 ? parseFloat((vol / avgVol).toFixed(2)) : 1;

        if (price > 0) {
          quotes[sym] = {
            price: parseFloat(price.toFixed ? price.toFixed(2) : price),
            changePct,
            change: t.todaysChange || 0,
            volume: vol,
            avgVolume: avgVol,
            volRatio: Math.max(0.1, volRatio),
            prevClose: (t.prevDay && t.prevDay.c) || 0,
            source: 'snapshot',
          };
        }
      }
    }
  } catch (e) {
    console.error('Snapshot error:', e.message);
  }

  // ── ATTEMPT 2: Fill gaps with Previous Day endpoint (always has data) ──
  const missing = symbols.filter(s => !quotes[s]);
  if (missing.length > 0) {
    await Promise.all(
      missing.map(async (sym) => {
        try {
          const url =
            `https://api.massive.com/v2/aggs/ticker/${encodeURIComponent(sym)}/prev` +
            `?apiKey=${MASSIVE_KEY}`;
          const r = await fetch(url);
          if (!r.ok) return;
          const data = await r.json();
          const bar = data.results && data.results[0];
          if (!bar) return;

          quotes[sym] = {
            price: bar.c || 0,
            changePct: bar.o ? parseFloat((((bar.c - bar.o) / bar.o) * 100).toFixed(2)) : 0,
            change: bar.c - bar.o || 0,
            volume: bar.v || 0,
            avgVolume: bar.v || 1,
            volRatio: 1,
            prevClose: bar.o || 0,
            source: 'prevDay',
          };
        } catch (e) {}
      })
    );
  }

  return res.status(200).json({
    ok: Object.keys(quotes).length > 0,
    quotes,
    ts: Date.now(),
    count: Object.keys(quotes).length,
    missing: symbols.filter(s => !quotes[s]),
  });
}
