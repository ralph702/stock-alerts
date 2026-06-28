// ─────────────────────────────────────────────────────────────────────
// /api/stocks.js  —  Massive API proxy for stock watchlist data
//
// Handles the fact that Massive snapshots CLEAR at 3:30 AM EST daily
// and only repopulate when exchanges open. On weekends/holidays the
// snapshot returns prevDay only. This code detects that and calculates
// change% from prevDay's open→close so you never see flat 0.0%.
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

  // ── ATTEMPT 1: Batch snapshot ──
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

        // Check if "today" data exists (market is/was open)
        const hasToday = (t.day && t.day.c > 0) || (t.lastTrade && t.lastTrade.p > 0) || (t.min && t.min.c > 0);
        const hasPrev = t.prevDay && t.prevDay.c > 0;

        let price = 0;
        let changePct = 0;
        let vol = 0;
        let avgVol = 1;

        if (hasToday) {
          // Market open or recently closed — use live data
          price = (t.lastTrade && t.lastTrade.p) || (t.min && t.min.c) || (t.day && t.day.c) || 0;
          changePct = (t.todaysChangePerc != null) ? parseFloat(t.todaysChangePerc.toFixed(2)) : 0;
          vol = (t.day && t.day.v) || 0;
          avgVol = (t.prevDay && t.prevDay.v) || vol || 1;
        } else if (hasPrev) {
          // Market closed / weekend — use last trading day's data
          price = t.prevDay.c;
          // Show that day's open→close change (not 0%)
          const prevOpen = t.prevDay.o || t.prevDay.c;
          changePct = prevOpen > 0 ? parseFloat((((t.prevDay.c - prevOpen) / prevOpen) * 100).toFixed(2)) : 0;
          vol = t.prevDay.v || 0;
          avgVol = vol || 1;
        }

        if (price > 0) {
          const volRatio = avgVol > 0 ? parseFloat((vol / avgVol).toFixed(2)) : 1;
          quotes[sym] = {
            price: parseFloat(typeof price === 'number' ? price.toFixed(2) : price),
            changePct,
            change: t.todaysChange || (price - (t.prevDay && t.prevDay.o || price)),
            volume: vol,
            avgVolume: Math.round(avgVol),
            volRatio: Math.max(0.1, volRatio),
            prevClose: (t.prevDay && t.prevDay.c) || 0,
            source: hasToday ? 'snapshot-live' : 'snapshot-prevDay',
          };
        }
      }
    }
  } catch (e) {
    console.error('Snapshot error:', e.message);
  }

  // ── ATTEMPT 2: Fill gaps with Previous Day endpoint ──
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
          if (!bar || !bar.c) return;

          const prevOpen = bar.o || bar.c;
          quotes[sym] = {
            price: bar.c,
            changePct: prevOpen > 0 ? parseFloat((((bar.c - prevOpen) / prevOpen) * 100).toFixed(2)) : 0,
            change: bar.c - prevOpen,
            volume: bar.v || 0,
            avgVolume: bar.v || 1,
            volRatio: 1,
            prevClose: prevOpen,
            source: 'prevDay-endpoint',
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
