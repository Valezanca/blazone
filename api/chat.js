export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!apiKey) return res.status(500).json({ error: 'API key non configurata' });

  const { userId, aliasId, messages, system, extractMemory } = req.body;

  try {
    // Chiamata principale
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
    if (!response.ok) return res.status(response.status).json(data);

    const reply = data.content?.[0]?.text;

    // Salva memoria in background
    if (supabaseUrl && supabaseKey && userId && reply && extractMemory) {
      const sbHeaders = {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      };

      // Carica memoria esistente
      const memRes = await fetch(
        `${supabaseUrl}/rest/v1/memory?user_id=eq.${userId}&alias_id=eq.${aliasId}&select=id,facts,user_name,conversation_count,last_seen`,
        { headers: sbHeaders }
      ).catch(() => null);

      const memData = memRes ? await memRes.json().catch(() => []) : [];
      const current = memData[0] || {};

      // Estrai nuovi fatti dall'ultimo messaggio utente
      const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
      
      let newFacts = [];
      try {
        const memExtract = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 150,
            messages: [{
              role: 'user',
              content: `Analizza questo messaggio e estrai fatti importanti sulla persona (lavoro, famiglia, hobby, situazioni, emozioni ricorrenti, problemi). Rispondi SOLO con JSON array di stringhe brevi in italiano, senza markdown. Se non ci sono fatti rilevanti rispondi []. Messaggio: "${lastUserMsg}"`
            }]
          })
        });
        const memJson = await memExtract.json();
        const memText = memJson.content?.[0]?.text || '[]';
        newFacts = JSON.parse(memText.trim());
      } catch(e) {
        newFacts = [];
      }

      // Merge fatti
      const currentFacts = current.facts || [];
      const merged = [...new Set([...currentFacts, ...newFacts])].slice(-20);

      // Estrai nome se presente
      let userName = current.user_name || '';
      if (!userName) {
        const nameFact = newFacts.find(f => 
          f.toLowerCase().includes('si chiama') || 
          f.toLowerCase().includes('nome è') ||
          f.toLowerCase().includes('sono ')
        );
        if (nameFact) {
          const match = nameFact.match(/(?:si chiama|nome è|sono)\s+([A-Z][a-z]+)/i);
          if (match) userName = match[1];
        }
      }

      // Salva/aggiorna memoria
      const now = new Date().toISOString();
      const method = current.id ? 'PATCH' : 'POST';
      const url = current.id
        ? `${supabaseUrl}/rest/v1/memory?id=eq.${current.id}`
        : `${supabaseUrl}/rest/v1/memory`;

      await fetch(url, {
        method,
        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          alias_id: aliasId,
          facts: merged,
          user_name: userName || current.user_name || '',
          conversation_count: (current.conversation_count || 0) + 1,
          last_seen: now,
          updated_at: now
        })
      }).catch(() => {});
    }

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}