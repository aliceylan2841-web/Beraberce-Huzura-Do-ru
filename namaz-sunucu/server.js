// ═══════════════════════════════════════════════════════
// Namaz Takip — Sunucu (Node.js + Express + SQLite)
// Render.com'da ücretsiz çalışır
// ═══════════════════════════════════════════════════════

const express  = require('express');
const cors     = require('cors');
const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');
const fetch    = require('node-fetch'); // AI isteği için

// ── Uygulama Oluşturma (Sıralama Düzeltildi) ───────────
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Veritabanı ────────────────────────────────────────
const DB_PATH = process.env.DB_PATH || path.join('/tmp', 'namaz.db');
const db = new Database(DB_PATH);

// Tabloları oluştur
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id        TEXT PRIMARY KEY,
    name      TEXT,
    city      TEXT,
    lat       REAL,
    lon       REAL,
    cfg       TEXT DEFAULT '{}',
    alarms    TEXT DEFAULT '{}',
    done      TEXT DEFAULT '{}',
    sozler    TEXT DEFAULT '[]',
    updated   INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS groups_t (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    emoji       TEXT DEFAULT '🕌',
    invite_code TEXT UNIQUE NOT NULL,
    chat        TEXT DEFAULT '[]',
    day_key     TEXT DEFAULT '',
    created     INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS members (
    group_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    user_name TEXT NOT NULL,
    done      TEXT DEFAULT '{}',
    kildi_at  TEXT DEFAULT '',
    joined    INTEGER DEFAULT 0,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups_t(id) ON DELETE CASCADE
  );
`);

// ── Middleware ────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

function getUser(req) {
  return req.headers['x-user-id'] || null;
}

// ── Yardımcılar ───────────────────────────────────────
function tkey() {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
function genCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 karakter
}

// ═══════════════════════════════════════════════════════
// KULLANICI ENDPOINT'LERİ
// ═══════════════════════════════════════════════════════

app.post('/api/user', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const { name, city, lat, lon, cfg, alarms, done, sozler } = req.body;

  db.prepare(`
    INSERT INTO users (id, name, city, lat, lon, cfg, alarms, done, sozler, updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name    = excluded.name,
      city    = excluded.city,
      lat     = excluded.lat,
      lon     = excluded.lon,
      cfg     = excluded.cfg,
      alarms  = excluded.alarms,
      done    = excluded.done,
      sozler  = excluded.sozler,
      updated = excluded.updated
  `).run(
    uid,
    name || '',
    city || '',
    lat  || null,
    lon  || null,
    JSON.stringify(cfg    || {}),
    JSON.stringify(alarms || {}),
    JSON.stringify(done   || {}),
    JSON.stringify(sozler || []),
    Date.now()
  );

  res.json({ ok: true });
});

app.get('/api/user', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!row) return res.json(null);

  res.json({
    name:   row.name,
    city:   row.city,
    lat:    row.lat,
    lon:    row.lon,
    cfg:    JSON.parse(row.cfg    || '{}'),
    alarms: JSON.parse(row.alarms || '{}'),
    done:   JSON.parse(row.done   || '{}'),
    sozler: JSON.parse(row.sozler || '[]'),
  });
});

// ═══════════════════════════════════════════════════════
// GRUP ENDPOINT'LERİ
// ═══════════════════════════════════════════════════════

function getGroupFull(groupId) {
  const g = db.prepare('SELECT * FROM groups_t WHERE id = ?').get(groupId);
  if (!g) return null;
  const members = db.prepare('SELECT * FROM members WHERE group_id = ?').all(groupId);
  return {
    id:         g.id,
    name:       g.name,
    emoji:      g.emoji,
    inviteCode: g.invite_code,
    chat:       JSON.parse(g.chat || '[]'),
    _dd:        g.day_key,
    members:    members.map(m => ({
      userId:  m.user_id,
      name:    m.user_name,
      done:    JSON.parse(m.done || '{}'),
      kildiAt: m.kildi_at,
    })),
  };
}

app.get('/api/groups', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const rows = db.prepare(`
    SELECT g.id FROM groups_t g
    INNER JOIN members m ON m.group_id = g.id
    WHERE m.user_id = ?
  `).all(uid);

  const groups = rows.map(r => getGroupFull(r.id)).filter(Boolean);
  res.json(groups);
});

app.post('/api/groups', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const { name, emoji, userName } = req.body;
  if (!name) return res.status(400).json({ error: 'Grup adı gerekli' });

  const id   = 'g' + Date.now() + Math.random().toString(36).slice(2, 6);
  const code = genCode();
  const now  = Date.now();
  const day  = tkey();

  db.prepare(`
    INSERT INTO groups_t (id, name, emoji, invite_code, chat, day_key, created)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, emoji || '🕌', code, JSON.stringify([
    { type: 'event', txt: `🕌 "${name}" grubu oluşturuldu!`, time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) }
  ]), day, now);

  db.prepare(`
    INSERT INTO members (group_id, user_id, user_name, done, kildi_at, joined)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, uid, userName || 'Anonim', JSON.stringify({}), '', now);

  res.json(getGroupFull(id));
});

app.post('/api/groups/join', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const { inviteCode, userName } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'Davet kodu gerekli' });

  const g = db.prepare('SELECT * FROM groups_t WHERE invite_code = ?').get(inviteCode.toUpperCase());
  if (!g) return res.status(404).json({ error: 'Grup bulunamadı. Kod yanlış olabilir.' });

  const existing = db.prepare('SELECT 1 FROM members WHERE group_id = ? AND user_id = ?').get(g.id, uid);
  if (existing) return res.json({ alreadyMember: true, group: getGroupFull(g.id) });

  const now = Date.now();
  db.prepare(`
    INSERT INTO members (group_id, user_id, user_name, done, kildi_at, joined)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(g.id, uid, userName || 'Anonim', JSON.stringify({}), '', now);

  const chat = JSON.parse(g.chat || '[]');
  chat.push({ type: 'event', txt: `👤 ${userName || 'Anonim'} gruba katıldı!`, time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) });
  db.prepare('UPDATE groups_t SET chat = ? WHERE id = ?').run(JSON.stringify(chat), g.id);

  res.json({ alreadyMember: false, group: getGroupFull(g.id) });
});

app.get('/api/groups/:id', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const isMember = db.prepare('SELECT 1 FROM members WHERE group_id = ? AND user_id = ?').get(req.params.id, uid);
  if (!isMember) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz' });

  const g = getGroupFull(req.params.id);
  if (!g) return res.status(404).json({ error: 'Grup bulunamadı' });
  res.json(g);
});

app.patch('/api/groups/:id/done', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const { done, kildiAt } = req.body;
  const groupId = req.params.id;

  // 1) Önce gün değişmiş mi kontrol et — değiştiyse HERKESİ sıfırla
  const g = db.prepare('SELECT day_key FROM groups_t WHERE id = ?').get(groupId);
  if (g && g.day_key !== tkey()) {
    db.prepare('UPDATE members SET done = ? WHERE group_id = ?').run(JSON.stringify({}), groupId);
    db.prepare('UPDATE groups_t SET day_key = ? WHERE id = ?').run(tkey(), groupId);
  }

  // 2) SONRA bu kullanıcının güncel durumunu yaz
  db.prepare(`
    UPDATE members SET done = ?, kildi_at = ? WHERE group_id = ? AND user_id = ?
  `).run(JSON.stringify(done || {}), kildiAt || '', groupId, uid);

  res.json({ ok: true });
});

// ── Grup Sohbet ve Üyelik API'leri ──────────────────────────────────

app.post('/api/groups/:id/chat', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const member = db.prepare('SELECT user_name FROM members WHERE group_id = ? AND user_id = ?').get(req.params.id, uid);
  if (!member) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz' });

  const { txt } = req.body;
  if (!txt || !txt.trim()) return res.status(400).json({ error: 'Mesaj boş olamaz' });

  const g = db.prepare('SELECT chat FROM groups_t WHERE id = ?').get(req.params.id);
  if (!g) return res.status(404).json({ error: 'Grup bulunamadı' });

  const chat = JSON.parse(g.chat || '[]');
  const msg = {
    type:      'msg',
    sender:    member.user_name,
    userId:    uid,
    txt:       txt.trim(),
    time:      new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    reactions: [],
  };
  chat.push(msg);

  const trimmed = chat.slice(-200);
  db.prepare('UPDATE groups_t SET chat = ? WHERE id = ?').run(JSON.stringify(trimmed), req.params.id);

  res.json({ ok: true, msg });
});

app.get('/api/groups/:id/chat', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const isMember = db.prepare('SELECT 1 FROM members WHERE group_id = ? AND user_id = ?').get(req.params.id, uid);
  if (!isMember) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz' });

  const g = db.prepare('SELECT chat FROM groups_t WHERE id = ?').get(req.params.id);
  const chat = JSON.parse(g?.chat || '[]');
  res.json(chat.slice(-100));
});

app.delete('/api/groups/:id/leave', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  db.prepare('DELETE FROM members WHERE group_id = ? AND user_id = ?').run(req.params.id, uid);

  const count = db.prepare('SELECT COUNT(*) as c FROM members WHERE group_id = ?').get(req.params.id);
  if (count.c === 0) db.prepare('DELETE FROM groups_t WHERE id = ?').run(req.params.id);

  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════
// AI DUA / SURE DOLDURMA (ÜCRETSİZ GOOGLE GEMINI)
// ═══════════════════════════════════════════════════════

app.post('/api/ai/dua-fill', async (req, res) => {
  try {
    const title = (req.body?.title || req.body?.baslik || '').toString().trim().slice(0, 120);
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

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

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

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error('Gemini API hata:', r.status, errText);
      return res.status(502).json({ error: 'AI servisi yanıt vermedi.' });
    }

    const data = await r.json();
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
    console.error('dua-fill hata:', e);
    return res.status(500).json({ error: 'Sunucu hatası.' });
  }
});

// ── Sağlık kontrolü ──────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── ARAYÜZ (HTML) SERVİS ETME AYARI ─────────────
app.use(express.static(path.join(__dirname, 'namaz-sunucu')));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'namaz-sunucu', 'index_server.html'));
});

// ── Sunucuyu başlat ──────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Namaz Takip sunucusu çalışıyor: http://localhost:${PORT}`);
});
