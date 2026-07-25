// ═══════════════════════════════════════════
// SES SİSTEMİ (GERÇEK MP3 + SENTETİK YEDEK)
// ═══════════════════════════════════════════

const SOUNDS = [
  // 🕌 GERÇEK EZAN SESLERİ
  { id: 'ezan_istanbul', name: 'İstanbul Ezanı',   sub: 'Klasik Türk ezanı',     ico: '🕌', url: 'sounds/ezan_istanbul.mp3' },
  { id: 'ezan_mekke',    name: 'Mekke Ezanı',      sub: 'Mescid-i Haram tonu',   ico: '🕋', url: 'sounds/ezan_mekke.mp3' },
  { id: 'ezan_hicaz',    name: 'Hicaz Ezanı (Kısa)', sub: 'Kısa ve net ezan',     ico: '🕌', url: 'sounds/ezan_hicaz_kisa.mp3' },
  { id: 'ezan_sabah',    name: 'Sabah Ezanı',      sub: 'Saba makamı ezan',      ico: '🌅', url: 'sounds/ezan_sabah.mp3' },

  // 🎵 GERÇEK NEY VE TASAVVUF SESLERİ
  { id: 'ney_taksim',   name: 'Ney Taksimi',      sub: 'Huzurlu sufi ney',      ico: '🎵', url: 'sounds/ney_taksim.mp3' },
  { id: 'salavat',      name: 'Kısa Salavat',     sub: 'Allahümme Salli...',   ico: '📿', url: 'sounds/salavat.mp3' },

  // 🔔 KISA UYARICI BİLDİRİM SESLERİ
  { id: 'tekbir_kisa',  name: 'Kısa Tekbir',      sub: 'Allahu Ekber (1-2 sn)', ico: '☝️', url: 'sounds/tekbir_kisa.mp3' },
  { id: 'ney_kisa',     name: 'Kısa Ney Üfleme',   sub: '3 saniyelik ney sesi',  ico: '🌾', url: 'sounds/ney_kisa.mp3' },
  { id: 'bip_dijital',  name: 'Dijital Bip',      sub: 'Net saat uyarısı',      ico: '⏰', url: 'sounds/bip_dijital.mp3' },
  { id: 'soft_chime',   name: 'Yumuşak Çan',      sub: 'Hafif hatırlatma',      ico: '🔔', url: 'sounds/soft_chime.mp3' },
  { id: 'su_damlasi',   name: 'Su Damlası',        sub: 'Doğal uyarı tonu',      ico: '💧', url: 'sounds/su_damlasi.mp3' },

  // 🎼 SENTETİK MAKAM SESLERİ (Çevrimdışı / Kod Üretimi)
  { id: 'hicaz',        name: 'Hicaz Sentetik',   sub: 'Web Audio sentez',      ico: '🎹' },
  { id: 'usshak',       name: 'Uşşak Sentetik',   sub: 'Web Audio sentez',      ico: '🌙' },
  { id: 'saba',         name: 'Saba Sentetik',    sub: 'Web Audio sentez',      ico: '🕋' },

  { id: 'silent',       name: 'Sessiz',           sub: 'Yalnız görsel uyarı',   ico: '🔕' }
];

let customAudioUrl = null, customAudioName = null, previewAudio = null, alarmAudio = null, alarmLoop = null;

// ── Web Audio API Sentetik Makam Tanımları (Yedek) ────────────────────────
const MAQAM = {
  hicaz: { bpm: 52, phrases: [[{f:293.66,d:.55},{f:311.13,d:.3},{f:369.99,d:.65,v:.7},{f:392,d:.45}],[{f:369.99,d:.5},{f:311.13,d:.7,v:.8},{f:293.66,d:.9}]], type:'sine' },
  usshak: { bpm: 46, phrases: [[{f:220,d:.6},{f:246.94,d:.45,v:.4},{f:293.66,d:.7,v:.6}],[{f:246.94,d:.55},{f:220,d:1.1,v:.9}]], type:'sine' },
  saba: { bpm: 44, phrases: [[{f:293.66,d:.6},{f:311.13,d:.4},{f:277.18,d:.7,v:.6}],[{f:261.63,d:.4},{f:293.66,d:.9,v:.8}]], type:'sine' }
};

function playMaqam(id) {
  if (id === 'silent') return 0;
  const m = MAQAM[id] || MAQAM.hicaz;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const masterGain = ctx.createGain(); masterGain.gain.value = 0.42;
    masterGain.connect(ctx.destination);
    let t = ctx.currentTime + 0.05;

    m.phrases.forEach(phrase => {
      phrase.forEach(note => {
        if (!note.f) { t += note.d; return; }
        const osc = ctx.createOscillator(); const g = ctx.createGain();
        osc.type = m.type || 'sine'; osc.frequency.setValueAtTime(note.f, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.38, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, t + note.d + 0.05);
        osc.connect(g); g.connect(masterGain); osc.start(t); osc.stop(t + note.d + 0.1);
        t += note.d + 0.04;
      });
      t += 0.15;
    });
    return (t - ctx.currentTime) * 1000 + 600;
  } catch (e) { return 4000; }
}

// ── Genel Ses Çalma (MP3 veya Sentetik) ────────────────
function playSoundItem(soundId, isPreview = false) {
  // Önce çalan sesi durdur
  stopAllAudio();

  if (soundId === 'silent') {
    if (isPreview) toast('Sessiz mod — Yalnızca görsel uyarı', 'fa-volume-xmark');
    return;
  }

  // 1. Özel Yüklenen Ses
  if (soundId === 'custom' && customAudioUrl) {
    const audio = new Audio(customAudioUrl);
    audio.volume = 0.85;
    if (isPreview) previewAudio = audio; else alarmAudio = audio;
    audio.play().catch(() => toast('Özel ses çalınamadı.', false));
    return;
  }

  const soundConfig = SOUNDS.find(s => s.id === soundId);

  // 2. Gerçek MP3 Dosyası
  if (soundConfig && soundConfig.url) {
    const audio = new Audio(soundConfig.url);
    audio.volume = 0.85;

    if (isPreview) previewAudio = audio; else alarmAudio = audio;

    audio.play().catch(() => {
      console.warn('MP3 bulunamadı, sentetik sese geçiliyor:', soundConfig.url);
      playMaqam(soundId);
    });

    if (isPreview) toast('🎵 ' + soundConfig.name + ' çalınıyor');
    return;
  }

  // 3. Sentetik Makam Sesi (Yedek)
  playMaqam(soundId);
  if (isPreview) {
    const nm = SOUNDS.find(x => x.id === soundId);
    toast('🎵 ' + (nm ? nm.name : soundId) + ' önizleniyor');
  }
}

function stopAllAudio() {
  if (previewAudio) { previewAudio.pause(); previewAudio = null; }
  if (alarmAudio) { alarmAudio.pause(); alarmAudio = null; }
  if (alarmLoop) { clearInterval(alarmLoop); alarmLoop = null; }
}

function playSound(type) {
  if (alarmLoop) return;
  playSoundItem(type, false);
  // Kısa uyarı değilse 10 saniyede bir döngüye al
  if (!type.includes('kisa') && !type.includes('bip') && type !== 'silent') {
    alarmLoop = setInterval(() => playSoundItem(type, false), 10000);
  }
}

function previewSound(type) {
  playSoundItem(type, true);
}

// ── Ses Seçim Menüsü Render ─────────────────────────────
function renderSoundGrid() {
  const grid = document.getElementById('sound-grid'); if (!grid) return;
  grid.innerHTML = '';
  const cur = (S && S.cfg && S.cfg.sound) ? S.cfg.sound : 'ezan_istanbul';

  SOUNDS.forEach(s => {
    const div = document.createElement('div');
    div.className = 'sound-opt' + (cur === s.id ? ' sel' : '');
    div.onclick = () => selectSound(s.id);
    div.innerHTML = `
      <div class="sound-opt-check"><i class="fa-solid fa-check"></i></div>
      <div class="sound-opt-ico">${s.ico}</div>
      <div class="sound-opt-name">${s.name}</div>
      <div class="sound-opt-sub">${s.sub}</div>
      <i class="fa-solid fa-play play-ico"></i>`;
    div.querySelector('.play-ico').addEventListener('click', e => { e.stopPropagation(); previewSound(s.id); });
    grid.appendChild(div);
  });

  // Özel yüklenen ses varsa listeye ekle
  if (customAudioName) {
    const div = document.createElement('div');
    const isCur = cur === 'custom';
    div.className = 'sound-opt' + (isCur ? ' sel' : '');
    div.onclick = () => selectSound('custom');
    div.innerHTML = `
      <div class="sound-opt-check"><i class="fa-solid fa-check"></i></div>
      <div class="sound-opt-ico">🎶</div>
      <div class="sound-opt-name" style="font-size:10px">${customAudioName.length > 14 ? customAudioName.slice(0, 12) + '…' : customAudioName}</div>
      <div class="sound-opt-sub">Kişisel Ses</div>
      <i class="fa-solid fa-play play-ico"></i>`;
    div.querySelector('.play-ico').addEventListener('click', e => { e.stopPropagation(); testCustomSound(); });
    grid.appendChild(div);
  }

  const lbl = document.getElementById('sel-sound-lbl');
  if (lbl) {
    const s = SOUNDS.find(x => x.id === cur);
    lbl.textContent = 'Seçili: ' + (cur === 'custom' ? customAudioName || 'Kişisel Ses' : s ? s.name : 'İstanbul Ezanı');
  }
}

function selectSound(id) {
  if (S && S.cfg) S.cfg.sound = id;
  if (typeof save === 'function') save();
  renderSoundGrid();
}

// ── Özel Ses Dosyası Yükleme (Base64) ────────────────────
function loadCustomSound(inp) {
  const file = inp.files[0]; if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('Dosya maksimum 10MB olabilir.', false); inp.value = ''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    customAudioUrl = e.target.result;
    customAudioName = file.name.replace(/\.[^.]+$/, '');
    try {
      localStorage.setItem('cm6_audio', customAudioUrl);
      localStorage.setItem('cm6_audio_name', customAudioName);
    } catch (err) { toast('Hafıza dolu, ses kaydedilemedi.', false); }
    showCustomAudioRow();
    selectSound('custom');
    renderSoundGrid();
    toast('Ses yüklendi: ' + customAudioName + ' 🎵');
  };
  reader.readAsDataURL(file);
}

function showCustomAudioRow() {
  const row = document.getElementById('custom-audio-row');
  const nm = document.getElementById('custom-audio-name');
  if (row) row.style.display = 'flex';
  if (nm && customAudioName) nm.textContent = customAudioName;
}

function testCustomSound() {
  if (!customAudioUrl) { toast('Önce ses yükleyin.', false); return; }
  stopAllAudio();
  previewAudio = new Audio(customAudioUrl); previewAudio.volume = 0.8;
  previewAudio.play().catch(() => toast('Ses çalınamadı.', false));
}

function removeCustomSound() {
  customAudioUrl = null; customAudioName = null;
  try { localStorage.removeItem('cm6_audio'); localStorage.removeItem('cm6_audio_name'); } catch (e) {}
  const row = document.getElementById('custom-audio-row'); if (row) row.style.display = 'none';
  const inp = document.getElementById('sound-file-inp'); if (inp) inp.value = '';
  if (S && S.cfg && S.cfg.sound === 'custom') { S.cfg.sound = 'ezan_istanbul'; if (typeof save === 'function') save(); }
  renderSoundGrid(); toast('Özel ses silindi.');
}

function loadCustomAudioFromStorage() {
  try {
    const url = localStorage.getItem('cm6_audio');
    const name = localStorage.getItem('cm6_audio_name');
    if (url && name) { customAudioUrl = url; customAudioName = name; showCustomAudioRow(); }
  } catch (e) {}
}
