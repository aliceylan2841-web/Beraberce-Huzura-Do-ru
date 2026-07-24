const express = require('express');
const cors = require('cors');

const app = express();

// Middleware (Arayüz ve JSON Desteği)
app.use(cors());
app.use(express.json());

// 1. Ana Sayfa / Sağlık Kontrolü (Render için)
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Beraberce Huzura Doğru API Çalışıyor.' });
});

// 2. AI DUA / SURE DOLDURMA (GOOGLE GEMINI - OTOMATİK YEDEKLİ MODEL DÖNGÜSÜ)
app.post('/api/ai/dua-fill', async (req, res) => {
  try {
    const title = (req.body?.title || req.body?.baslik || '').toString().trim().slice(0, 120);
    if (!title) {
      return res.status(400).json({ error: 'Başlık gerekli.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('HATA: GEMINI_API_KEY tanımlı değil!');
      return res.status(500).json({ error: 'GEMINI_API_KEY ortam değişkeni tanımlı değil.' });
    }

    const prompt = `Sen İslami bir dua/sure/ayet veritabanı asistanısın. Kullanıcı şu başlığı verdi: "${title}".
Bu bir Kur'an suresi, ayeti veya bilinen bir dua/hadis olabilir.
SADECE aşağıdaki JSON formatında, başka hiçbir açıklama eklemeden cevap ver:
{"arabic":"<doğru harekeli Arapça metin>","meaning":"<sade, doğru Türkçe anlamı/meali>","src":"<kaynak, örn. 'Kur'an-ı Kerim · Bakara 255' veya 'Hadis-i Şerif'>"}
Eğer başlık tanınmıyorsa veya emin değilsen, {"error":"bulunamadı"} döndür. Metinleri uydurma, sadece kesin bildiğin, doğru ve yaygın kabul gören metinleri ver.`;

    // Denenecek Gemini modelleri (Sırasıyla)
    const candidateModels = [
      'gemini-2.0-flash',
      'gemini-1.5-flash-latest',
      'gemini-1.5-flash',
      'gemini-pro'
    ];

    let data = null;
    let lastErrorText = '';

    for (const model of candidateModels) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json'
            }
          })
        });

        if (r.ok) {
          data = await r.json();
          console.log(`✅ Çalışan Gemini Modeli Bulundu: ${model}`);
          break; // Başarılı model bulunduğunda döngüden çık
        } else {
          lastErrorText = await r.text().catch(() => '');
          console.warn(`⚠️ Model ${model} (${r.status}) hata verdi, sonraki deneniyor...`);
        }
      } catch (fetchErr) {
        console.warn(`⚠️ Model ${model} istek hatası:`, fetchErr.message);
      }
    }

    if (!data) {
      console.error('Tüm modeller başarısız oldu. Son hata:', lastErrorText);
      return res.status(502).json({ error: 'AI servisi yanıt vermedi.' });
    }

    const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '')
      .replace(/^```json\s*|```\s*$/g, '')
      .trim();

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
    console.error('dua-fill genel hata:', e);
    return res.status(500).json({ error: 'Sunucu iç hatası.' });
  }
});

// 3. Sunucu Port Ayarı ve Başlatma
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`🚀 Sunucu port ${PORT} üzerinde sorunsuz çalışıyor.`);
});
