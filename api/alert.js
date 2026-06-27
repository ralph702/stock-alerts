export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { phone, message, prompt, max_tokens, type } = req.body;

  // Claude AI handler
  if (type === 'claude' || prompt) {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'Anthropic key not configured' });
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: max_tokens || 1000,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const d = await r.json();
      const text = d.content?.[0]?.text || 'Analysis unavailable';
      return res.status(200).json({ text });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // SMS handler
  if (!phone || !message) return res.status(400).json({ error: 'Missing phone or message' });
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return res.status(500).json({ error: 'Twilio not configured' });
  try {
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const body = new URLSearchParams({ To: phone, From: fromNumber, Body: message });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    const data = await response.json();
    if (!response.ok) return res.status(500).json({ error: data.message || 'Twilio error' });
    return res.status(200).json({ success: true, sid: data.sid });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
