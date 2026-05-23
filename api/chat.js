export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!apiKey) return res.status(500).json({ error: 'API key non configurata' });

  const { userId, aliasId, messages, system } = req.body;

  // Salva conversazione su Supabase se disponibile
  if (supabaseUrl && supabaseKey && userId) {
    try {
      // Assicura che l'utente esista
      await fetch(`${supabaseUrl}/rest/v1/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'ignore-duplicates'
        },
        body: JSON.stringify({ id: userId })
      });

      // Salva la conversazione
      await fetch(`${supabaseUrl}/rest/v1/conversations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Prefer': 'resolution=merge-duplicates'
        },
        body: JSON.stringify({
          user_id: userId,
          alias_id: aliasId,
          messages: messages,
          updated_at: new Date().toISOString()
        })
      });
    } catch(e) {
      console.error('Supabase error:', e);
    }
  }

  // Chiama Anthropic
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: system,
        messages: messages.slice(-10),
      }),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}