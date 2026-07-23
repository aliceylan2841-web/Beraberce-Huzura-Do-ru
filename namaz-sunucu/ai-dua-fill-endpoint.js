// ═══════════════════════════════════════════════════════════
// AI DESTEKLİ DUA/SURE DOLDURMA (ÜCRETSİZ GOOGLE GEMINI)
// ═══════════════════════════════════════════════════════════

const fetch = require('node-fetch');

function registerDuaFillRoute(app) {
  app.post('/api/ai/dua-fill', async (req, res) => {
    try {
      const title = (req.body && req.body.title || '').toString().trim().slice(0, 120);
      if (!title) return res.status(400).json({ error: 'Başlık gerekli.' });

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY tanımlı değil.' });
      }

      const prompt = `Sen İslami bir dua/sure/ayet veritabanı asistanısın. Kullanıcı şu başlığı verdi: "${title}".
Bu bir Kur'an suresi, ayeti veya bilinen bir dua/hadis olabilir.
SADECE aşağıdaki JSON formatında, başka hiçbir açıklama eklemeden cevap ver:
{"arabic":"<doğru harekeli Arapça metin>","meaning":"<sade, doğru Türkçe anlamı/meali>","src":"<kaynak, örn. 'Kur'an-ı Kerim · Bakara 255' veya 'Hadis-i Şerif'>"}
Eğer başlık tanınmıyorsa veya emin değilsen, {"error":"bulunamadı"} döndür. Metinleri uydurma, sadece kesin bildiğin, doğru ve yaygın kabul gören metinleri ver.`;

      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      });

      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        console.error('Gemini API hata:', r.status, errText);
        return res.status(502).json({ error: 'AI servisi yanıt vermedi.' });
      }

      const data = await r.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return res.status(502).json({ error: 'AI cevabı ayrıştırılamadı.' });
      }

      if (parsed.error || !parsed.arabic) {
        return res.status(404).json({ error: 'Bu başlık için güvenilir bir metin bulunamadı.' });
      }

      return res.json({
        arabic: parsed.arabic,
        meaning: parsed.meaning || '',
        src: parsed.src || title
      });
    } catch (e) {
      console.error('dua-fill hata:', e);
      return res.status(500).json({ error: 'Sunucu hatası.' });
    }
  });
}

module.exports = { registerDuaFillRoute };
