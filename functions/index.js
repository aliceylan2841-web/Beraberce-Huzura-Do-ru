// ═══════════════════════════════════════════════════════
// Namaz Takip — Cloud Functions
// Şu an tek bir fonksiyon var: duaFill (AI ile dua/sure doldurma).
// Gemini API anahtarı SADECE burada, sunucu tarafında kalır — tarayıcıya
// hiçbir zaman gönderilmez.
//
// Kurulum:
//   firebase functions:secrets:set GEMINI_API_KEY
// (Anahtarı yapıştırmanız istenecek — Google AI Studio'dan alınır:
//  https://aistudio.google.com/app/apikey)
// ═══════════════════════════════════════════════════════

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');

const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');

exports.duaFill = onCall(
  { secrets: [GEMINI_API_KEY], region: 'europe-west1', cors: true },
  async (request) => {
    const title = (request.data?.title || '').toString().trim().slice(0, 120);
    if (!title) {
      throw new HttpsError('invalid-argument', 'Başlık gerekli.');
    }

    const apiKey = GEMINI_API_KEY.value();
    if (!apiKey) {
      throw new HttpsError('failed-precondition', 'GEMINI_API_KEY tanımlı değil.');
    }

    const prompt = `Sen İslami bir dua/sure/ayet veritabanı asistanısın. Kullanıcı şu başlığı verdi: "${title}".
Bu bir Kur'an suresi, ayeti veya bilinen bir dua/hadis olabilir.
SADECE aşağıdaki JSON formatında, başka hiçbir açıklama eklemeden cevap ver:
{"arabic":"<doğru harekeli Arapça metin>","meaning":"<sade, doğru Türkçe anlamı/meali>","src":"<kaynak, örn. 'Kur'an-ı Kerim · Bakara 255' veya 'Hadis-i Şerif'>"}
Eğer başlık tanınmıyorsa veya emin değilsen, {"error":"bulunamadı"} döndür. Metinleri uydurma, sadece kesin bildiğin, doğru ve yaygın kabul gören metinleri ver.`;

    // Sırayla denenecek Gemini modelleri — ilk çalışan kullanılır.
    const candidateModels = [
      'gemini-2.5-flash-lite',
      'gemini-2.5-flash',
      'gemini-3.5-flash-lite',
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
            generationConfig: { responseMimeType: 'application/json' },
          }),
        });
        if (r.ok) {
          data = await r.json();
          console.log(`✅ Çalışan Gemini modeli: ${model}`);
          break;
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
      throw new HttpsError('unavailable', 'AI servisi yanıt vermedi.');
    }

    const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || '')
      .replace(/^```json\s*|```\s*$/g, '')
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new HttpsError('internal', 'AI cevabı ayrıştırılamadı.');
    }

    if (parsed.error || !parsed.arabic) {
      return { error: 'Bu başlık için güvenilir bir metin bulunamadı.' };
    }

    return {
      arabic: parsed.arabic,
      meaning: parsed.meaning || '',
      src: parsed.src || title,
    };
  }
);
