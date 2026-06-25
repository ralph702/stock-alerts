
export default async function handler(req, res) {
  // Security check - only allow Vercel cron calls
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const MASSIVE_KEY = process.env.MASSIVE_KEY;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  const alertPhone = process.env.ALERT_PHONE;

  const watchlist = [
    'NVDA','TSM','MU','ANET','CRWV','CEG','IREN',
    'TEM','ISRG','LLY','GEHC','RXRX','SYK','SDGR'
  ];

  const VOL_THRESH = 2;
  const PRICE_THRESH = 5;

  async function fetchQuote(sym) {
    try {
      const r = await fetch(
        `https://api.massivedata.io/v1/last/trade/${sym}?apikey=${MASSIVE_KEY}`
      );
      if (!r.ok) throw new Error('API error');
      return await r.json();
    } catch(e) {
      return null;
    }
  }

  async function sendSMS(to, message) {
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const body = new URLSearchParams({ To: to, From: fromNumber, Body: message });
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${credentials}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: body.toString()
      }
    );
  }

  const alerts = [];

  for (const sym of watchlist) {
    const q = await fetchQuote(sym);
    if (!q) continue;

    const chg = q.chg || 0;
    const vol = q.vol_ratio || 1;
    const price = q.price || 0;
    const triggered = [];

    if (vol >= VOL_THRESH) triggered.push(`Vol ${vol.toFixed(1)}x avg`);
    if (Math.abs(chg) >= PRICE_THRESH) triggered.push(`${chg > 0 ? '+' : ''}${chg.toFixed(1)}%`);

    if (triggered.length > 0) {
      alerts.push(`${sym} — ${triggered.join(' · ')} — $${price.toFixed(2)}`);
    }
  }

  if (alerts.length > 0 && alertPhone) {
    const message = `📈 Stock Alert:\n${alerts.join('\n')}`;
    await sendSMS(alertPhone, message);
  }

  return res.status(200).json({ 
    checked: watchlist.length, 
    alerts: alerts.length,
    fired: alerts 
  });
}
