// ═══════════════════════════════════════════════════════
// Namaz Takip — Sunucu (Node.js + Express + SQLite)
// Render.com'da ücretsiz çalışır
// ═══════════════════════════════════════════════════════

const express  = require('express');
const cors     = require('cors');
const Database = require('better-sqlite3');
const crypto   = require('crypto');
const path     = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Veritabanı ────────────────────────────────────────
// Render.com'da /tmp kalıcıdır (disk planı olmadan)
// Kalıcı depolama için Render "Disk" özelliği veya PlanetScale/Turso kullan
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
app.use(cors({ origin: '*' }));          // Güvenlik için production'da origin kısıtla
app.use(express.json({ limit: '2mb' }));

// Basit kimlik doğrulama: her istek x-user-id header'ı taşır
// Gerçek projede JWT kullan
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

// Kullanıcı verisi kaydet / güncelle
// POST /api/user
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

// Kullanıcı verisi getir
// GET /api/user
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

// Grubu getir (üyelerle birlikte)
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

// Kullanıcının gruplarını getir
// GET /api/groups
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

// Grup oluştur
// POST /api/groups
app.post('/api/groups', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const { name, emoji, userName } = req.body;
  if (!name) return res.status(400).json({ error: 'Grup adı gerekli' });

  const id   = 'g' + Date.now() + Math.random().toString(36).slice(2, 6);
  const code = genCode();
  const now  = Date.now();
  const day  = tkey();

  // Grubu oluştur
  db.prepare(`
    INSERT INTO groups_t (id, name, emoji, invite_code, chat, day_key, created)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, emoji || '🕌', code, JSON.stringify([
    { type: 'event', txt: `🕌 "${name}" grubu oluşturuldu!`, time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) }
  ]), day, now);

  // Kurucuyu üye olarak ekle
  db.prepare(`
    INSERT INTO members (group_id, user_id, user_name, done, kildi_at, joined)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, uid, userName || 'Anonim', JSON.stringify({}), '', now);

  res.json(getGroupFull(id));
});

// Gruba davet koduyla katıl
// POST /api/groups/join
app.post('/api/groups/join', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const { inviteCode, userName } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'Davet kodu gerekli' });

  const g = db.prepare('SELECT * FROM groups_t WHERE invite_code = ?').get(inviteCode.toUpperCase());
  if (!g) return res.status(404).json({ error: 'Grup bulunamadı. Kod yanlış olabilir.' });

  // Zaten üye mi?
  const existing = db.prepare('SELECT 1 FROM members WHERE group_id = ? AND user_id = ?').get(g.id, uid);
  if (existing) return res.json({ alreadyMember: true, group: getGroupFull(g.id) });

  // Üye ekle
  const now = Date.now();
  db.prepare(`
    INSERT INTO members (group_id, user_id, user_name, done, kildi_at, joined)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(g.id, uid, userName || 'Anonim', JSON.stringify({}), '', now);

  // Katılım mesajı chat'e ekle
  const chat = JSON.parse(g.chat || '[]');
  chat.push({ type: 'event', txt: `👤 ${userName || 'Anonim'} gruba katıldı!`, time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) });
  db.prepare('UPDATE groups_t SET chat = ? WHERE id = ?').run(JSON.stringify(chat), g.id);

  res.json({ alreadyMember: false, group: getGroupFull(g.id) });
});

// Grubu getir (tek grup)
// GET /api/groups/:id
app.get('/api/groups/:id', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  // Üye mi kontrol et
  const isMember = db.prepare('SELECT 1 FROM members WHERE group_id = ? AND user_id = ?').get(req.params.id, uid);
  if (!isMember) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz' });

  const g = getGroupFull(req.params.id);
  if (!g) return res.status(404).json({ error: 'Grup bulunamadı' });
  res.json(g);
});

// Namaz durumu güncelle (tek üye)
// PATCH /api/groups/:id/done
app.patch('/api/groups/:id/done', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const { done, kildiAt } = req.body; // done: { sabah: true, ogle: false, ... }

  db.prepare(`
    UPDATE members SET done = ?, kildi_at = ? WHERE group_id = ? AND user_id = ?
  `).run(JSON.stringify(done || {}), kildiAt || '', req.params.id, uid);

  // Günlük reset — eğer gün değiştiyse tüm üyelerin done'unu sıfırla
  const g = db.prepare('SELECT day_key FROM groups_t WHERE id = ?').get(req.params.id);
  if (g && g.day_key !== tkey()) {
    db.prepare('UPDATE members SET done = ? WHERE group_id = ?').run(JSON.stringify({}), req.params.id);
    db.prepare('UPDATE groups_t SET day_key = ? WHERE id = ?').run(tkey(), req.params.id);
  }

  res.json({ ok: true });
});
// ── Grup Sohbet ve Üyelik API'leri ──────────────────────────────────

// Sohbet mesajı gönder
// POST /api/groups/:id/chat
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

  // Son 200 mesajı sakla
  const trimmed = chat.slice(-200);
  db.prepare('UPDATE groups_t SET chat = ? WHERE id = ?').run(JSON.stringify(trimmed), req.params.id);

  res.json({ ok: true, msg });
});

// Sohbet mesajlarını getir (son 100)
// GET /api/groups/:id/chat
app.get('/api/groups/:id/chat', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  const isMember = db.prepare('SELECT 1 FROM members WHERE group_id = ? AND user_id = ?').get(req.params.id, uid);
  if (!isMember) return res.status(403).json({ error: 'Bu grubun üyesi değilsiniz' });

  const g = db.prepare('SELECT chat FROM groups_t WHERE id = ?').get(req.params.id);
  const chat = JSON.parse(g?.chat || '[]');
  res.json(chat.slice(-100));
});

// Gruptan çık
// DELETE /api/groups/:id/leave
app.delete('/api/groups/:id/leave', (req, res) => {
  const uid = getUser(req);
  if (!uid) return res.status(401).json({ error: 'x-user-id header gerekli' });

  db.prepare('DELETE FROM members WHERE group_id = ? AND user_id = ?').run(req.params.id, uid);

  // Üye kalmadıysa grubu sil
  const count = db.prepare('SELECT COUNT(*) as c FROM members WHERE group_id = ?').get(req.params.id);
  if (count.c === 0) db.prepare('DELETE FROM groups_t WHERE id = ?').run(req.params.id);

  res.json({ ok: true });
});

// ── Sağlık kontrolü ──────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', time: new Date().toISOString() }));


// ── ARAYÜZ (HTML) SERVİS ETME AYARI (Beyaz Ekran Çözümü) ─────────────
// NOT: const path satırı yukarıda zaten olduğu için buradan silindi.

// 'namaz-sunucu' klasörünü ve ana dizini dışarıya açıyoruz (CSS, JS ve diğer varlıklar için)
app.use(express.static(path.join(__dirname, 'namaz-sunucu')));
app.use(express.static(__dirname));

// Birisi doğrudan siteye girdiğinde ("/") index_server.html dosyasını açıyoruz
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'namaz-sunucu', 'index_server.html'));
});


// ── Sunucuyu başlat ──────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Namaz Takip sunucusu çalışıyor: http://localhost:${PORT}`);
});
