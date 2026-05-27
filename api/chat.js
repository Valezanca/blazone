export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;

  if (!apiKey) return res.status(500).json({ error: 'API key non configurata' });

  const { userId, aliasId, messages, system, extractMemory } = req.body;

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
    if (!response.ok) return res.status(response.status).json(data);

    const reply = data.content?.[0]?.text;

    // Salva su Supabase in background
    if (supabaseUrl && supabaseKey && userId && reply) {
      const sbHeaders = {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      };

      // Salva conversazione
      fetch(`${supabaseUrl}/rest/v1/conversations`, {
        method: 'POST',
        headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates' },
        body: JSON.stringify({
          user_id: userId,
          alias_id: aliasId,
          messages: messages,
          updated_at: new Date().toISOString()
        })
      }).catch(() => {});

      // Estrai fatti dalla conversazione se richiesto
      if (extractMemory) {
        const lastUserMsg = messages.filter(m => m.role === 'user').slice(-1)[0]?.content || '';
        const memoryPrompt = `Analizza questo messaggio dell utente e estrai fatti importanti su di lui (nome, lavoro, famiglia, hobby, situazioni, emozioni ricorrenti). Rispondi SOLO con un JSON array di stringhe brevi in italiano. Se non ci sono fatti rilevanti rispondi con []. Messaggio: "${lastUserMsg}"`;
        
        fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 200,
            messages: [{ role: 'user', content: memoryPrompt }]
          })
        }).then(r => r.json()).then(memData => {
          const memText = memData.content?.[0]?.text || '[]';
          let newFacts = [];
          try { newFacts = JSON.parse(memText.replace(/```json|```/g, '').trim()); } catch(e) {}
          
          if (newFacts.length > 0) {
            // Carica memoria esistente e aggiorna
            fetch(`${supabaseUrl}/rest/v1/memory?user_id=eq.${userId}&alias_id=eq.${aliasId}&select=id,facts,user_name,conversation_count`, {
              headers: sbHeaders
            }).then(r => r.json()).then(existing => {
              const current = existing[0] || {};
              const currentFacts = current.facts || [];
              const merged = [...new Set([...currentFacts, ...newFacts])].slice(-20);
              
              // Estrai nome se presente
              let userName = current.user_name || '';
              const nameMatch = newFacts.find(f => f.toLowerCase().includes('si chiama') || f.toLowerCase().includes('nome'));
              if (nameMatch && !userName) {
                const match = nameMatch.match(/si chiama\s+(\w+)|nome[:\s]+(\w+)/i);
                if (match) userName = match[1] || match[2] || '';
              }

              const method = current.id ? 'PATCH' : 'POST';
              const url = current.id 
                ? `${supabaseUrl}/rest/v1/memory?id=eq.${current.id}`
                : `${supabaseUrl}/rest/v1/memory`;

              fetch(url, {
                method,
                headers: { ...sbHeaders, 'Prefer': current.id ? 'return=minimal' : 'return=minimal' },
                body: JSON.stringify({
                  user_id: userId,
                  alias_id: aliasId,
                  facts: merged,
                  user_name: userName,
                  conversation_count: (current.conversation_count || 0) + 1,
                  updated_at: new Date().toISOString()
                })
              }).catch(() => {});
            }).catch(() => {});
          }
        }).catch(() => {});
      }
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}