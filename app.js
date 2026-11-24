(() => {
  'use strict';

  const CONFIG = window.KRATHONG_CONFIG || {};
  const STORAGE_KEY = CONFIG.LOCAL_STORAGE_KEY || 'krathong-wishes-v2';
  const MAX_WISH = Number(CONFIG.MAX_WISH_LENGTH) || 180;
  const MAX_LOCAL_RECORDS = 200;
  const MAX_RENDERED = 24;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const state = {
    wishes: loadLocal(),
    supabase: null,
    cloudReady: false,
    currentView: 'home',
    lastCreated: null,
    reduceMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false
  };

  function loadLocal() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(parsed) ? parsed.filter(isValidStoredWish).slice(0, MAX_LOCAL_RECORDS) : [];
    } catch (error) {
      console.warn('Krathong: local data could not be read.', error);
      return [];
    }
  }

  function isValidStoredWish(item) {
    return item && typeof item === 'object' && typeof item.wish === 'string' && typeof item.id === 'string';
  }

  function persistLocal() {
    try {
      state.wishes = state.wishes.slice(0, MAX_LOCAL_RECORDS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.wishes));
      return true;
    } catch (error) {
      console.error('Krathong: local save failed.', error);
      toast('พื้นที่จัดเก็บของเบราว์เซอร์เต็มหรือไม่พร้อมใช้งาน กรุณาสำรองข้อมูลก่อนปิดหน้าเว็บ', 'error', 6000);
      return false;
    }
  }

  function makeId() {
    return (window.crypto && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function safeText(value, max = 180) {
    return String(value ?? '').trim().slice(0, max);
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'เพิ่งสร้าง';
    return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  }

  function toast(message, type = 'info', duration = 3600) {
    const region = $('#toast-region');
    if (!region) return;
    const item = document.createElement('div');
    item.className = `toast${type === 'error' ? ' error' : ''}`;
    item.setAttribute('role', type === 'error' ? 'alert' : 'status');
    item.textContent = message;
    region.append(item);
    window.setTimeout(() => {
      item.style.opacity = '0';
      item.style.transform = 'translateY(7px)';
      window.setTimeout(() => item.remove(), 260);
    }, duration);
  }

  function setConnection(online, label) {
    const pill = $('#connection-status');
    if (!pill) return;
    pill.classList.toggle('is-online', Boolean(online));
    const text = $('span', pill);
    if (text) text.textContent = label || (online ? 'เชื่อมต่อคลาวด์แล้ว' : 'โหมดออฟไลน์');
  }

  function initSupabase() {
    const url = safeText(CONFIG.SUPABASE_URL, 300);
    const key = safeText(CONFIG.SUPABASE_ANON_KEY, 500);
    if (!url || !key || !window.supabase?.createClient) {
      setConnection(false, 'โหมดออฟไลน์');
      return;
    }
    try {
      state.supabase = window.supabase.createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { headers: { 'X-Client-Info': 'krathong-web/2.0' } }
      });
      refreshFromCloud();
    } catch (error) {
      console.error('Krathong: could not initialise cloud client.', error);
      setConnection(false, 'ใช้ข้อมูลในเครื่อง');
    }
  }

  async function refreshFromCloud() {
    if (!state.supabase) return;
    const table = safeText(CONFIG.SUPABASE_TABLE || 'krathongs', 64);
    try {
      const { data, error } = await state.supabase
        .from(table)
        .select('id, name, wish, design, created_at')
        .order('created_at', { ascending: false })
        .limit(MAX_LOCAL_RECORDS);
      if (error) throw error;
      const remote = (data || []).filter(row => typeof row.wish === 'string').map(row => ({
        id: String(row.id), name: safeText(row.name, 30) || 'ไม่ระบุชื่อ',
        wish: safeText(row.wish, MAX_WISH), design: row.design === 'lotus' ? 'lotus' : 'gold',
        created_at: row.created_at || new Date().toISOString(), source: 'cloud'
      }));
      const remoteIds = new Set(remote.map(item => item.id));
      const pendingLocal = state.wishes.filter(item => item.pending === true && !remoteIds.has(item.id));
      state.wishes = [...remote, ...pendingLocal].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      persistLocal();
      state.cloudReady = true;
      setConnection(true, 'เชื่อมต่อคลาวด์แล้ว');
      // Retry a small batch of locally saved wishes that have not reached the cloud yet.
      for (const pendingWish of pendingLocal.slice(0, 10)) {
        await saveToCloud(pendingWish);
      }
      renderCounts();
      if (state.currentView === 'gallery') renderGallery();
    } catch (error) {
      console.warn('Krathong: cloud read failed; local data remains available.', error);
      state.cloudReady = false;
      setConnection(false, 'ใช้ข้อมูลในเครื่อง');
    }
  }

  async function saveToCloud(wish) {
    if (!state.supabase) return { ok: false, reason: 'offline' };
    const table = safeText(CONFIG.SUPABASE_TABLE || 'krathongs', 64);
    try {
      const payload = { name: wish.name, wish: wish.wish, design: wish.design };
      const { data, error } = await state.supabase.from(table).insert(payload).select('id, name, wish, design, created_at').single();
      if (error) throw error;
      const synced = {
        id: String(data.id), name: safeText(data.name, 30) || wish.name,
        wish: safeText(data.wish, MAX_WISH), design: data.design === 'lotus' ? 'lotus' : 'gold',
        created_at: data.created_at || wish.created_at, source: 'cloud'
      };
      state.wishes = state.wishes.map(item => item.id === wish.id ? synced : item);
      persistLocal();
      state.cloudReady = true;
      setConnection(true, 'เชื่อมต่อคลาวด์แล้ว');
      return { ok: true, data: synced };
    } catch (error) {
      console.warn('Krathong: cloud insert failed; the local copy is kept.', error);
      setConnection(false, 'บันทึกไว้ในเครื่อง');
      return { ok: false, reason: 'cloud-error' };
    }
  }

  function switchView(view) {
    const next = view === 'gallery' ? 'gallery' : 'home';
    state.currentView = next;
    $('#home-view').hidden = next !== 'home';
    $('#gallery-view').hidden = next !== 'gallery';
    $('#home-view').classList.toggle('is-visible', next === 'home');
    $('#gallery-view').classList.toggle('is-visible', next === 'gallery');
    $$('[data-view]').forEach(button => {
      if (button.classList.contains('nav-link')) button.classList.toggle('is-active', button.dataset.view === next);
    });
    if (next === 'gallery') renderGallery();
    window.scrollTo({ top: 0, behavior: state.reduceMotion ? 'auto' : 'smooth' });
  }

  function openModal(id) {
    const modal = $(`#${id}`);
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('modal-open');
    const focusTarget = $('input, textarea, button', modal);
    window.setTimeout(() => focusTarget?.focus(), 60);
  }

  function closeModal(id) {
    const modal = $(`#${id}`);
    if (modal) modal.hidden = true;
    if (!$('.modal-backdrop:not([hidden])')) document.body.classList.remove('modal-open');
  }

  function renderCounts() {
    const count = state.wishes.length;
    $('#nav-count').textContent = String(count);
    $('#gallery-count').innerHTML = `${count} <small>กระทง</small>`;
  }

  function seededNumber(text, offset = 0) {
    let hash = 2166136261 ^ offset;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0) / 4294967295;
  }

  function createFloatingKrathong(item, index) {
    const boat = document.createElement('button');
    boat.type = 'button';
    boat.className = `floating-krathong${item.design === 'lotus' ? ' design-lotus' : ''}`;
    boat.setAttribute('aria-label', `เปิดคำอธิษฐานของ ${item.name || 'ผู้ร่วมลอยกระทง'}`);
    const x = 13 + seededNumber(item.id, 1) * 74;
    const y = 38 + seededNumber(item.id, 2) * 48;
    const delay = -seededNumber(item.id, 3) * 9;
    const duration = 7 + seededNumber(item.id, 4) * 5;
    boat.style.left = `${x}%`;
    boat.style.top = `${y}%`;
    boat.style.animationDelay = `${delay}s`;
    boat.style.setProperty('--float-duration', `${duration}s`);
    if (state.reduceMotion) boat.style.animation = 'none';
    const hull = document.createElement('span'); hull.className = 'mini-boat';
    boat.append(hull);
    for (let i = 0; i < 6; i++) { const petal = document.createElement('span'); petal.className = 'mini-petal'; boat.append(petal); }
    const candle = document.createElement('span'); candle.className = 'mini-candle'; boat.append(candle);
    boat.addEventListener('click', () => openWish(item));
    return boat;
  }

  function renderGallery() {
    const collection = $('#floating-collection');
    const empty = $('#gallery-empty');
    if (!collection || !empty) return;
    collection.replaceChildren();
    const ordered = [...state.wishes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    const visible = ordered.slice(-MAX_RENDERED);
    visible.forEach((item, index) => collection.append(createFloatingKrathong(item, index)));
    empty.classList.toggle('is-hidden', state.wishes.length > 0);
    renderCounts();
  }

  function openWish(item) {
    $('#detail-title').textContent = item.name ? `คำอธิษฐานของ ${item.name}` : 'คำอธิษฐาน';
    $('#detail-wish').textContent = item.wish;
    $('#detail-author').textContent = item.name || 'ผู้ร่วมลอยกระทง';
    $('#detail-date').textContent = formatDate(item.created_at);
    $('#detail-visual').classList.toggle('is-pink', item.design === 'lotus');
    openModal('detail-modal');
  }

  function updateWishCounter() {
    const input = $('#wish-text');
    $('#wish-counter').textContent = `${input.value.length}/${MAX_WISH}`;
  }

  function showLaunch() {
    const overlay = $('#launch-overlay');
    const raft = $('#launch-raft');
    const finish = $('#launch-finish');
    overlay.hidden = false;
    finish.style.animation = 'none';
    finish.style.opacity = '0';
    raft.classList.remove('is-leaving');
    // Restart the departure animation without a timer dependency.
    void raft.offsetWidth;
    raft.classList.add('is-leaving');
    if (state.reduceMotion) {
      raft.style.display = 'none';
      finish.style.animation = 'none';
      finish.style.opacity = '1';
    } else {
      raft.style.display = '';
      finish.style.animation = 'finish-show .6s 3.2s forwards';
    }
  }

  async function handleCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const wishText = safeText($('#wish-text').value, MAX_WISH);
    if (!wishText) { $('#wish-text').focus(); toast('เขียนคำอธิษฐานก่อนปล่อยกระทงนะ'); return; }
    if (wishText.length > MAX_WISH) { toast(`คำอธิษฐานยาวได้ไม่เกิน ${MAX_WISH} ตัวอักษร`, 'error'); return; }

    const button = $('#launch-button');
    button.disabled = true;
    button.querySelector('span').textContent = 'กำลังจุดแสง...';
    const localWish = {
      id: makeId(), name: safeText($('#wish-name').value, 30) || 'ไม่ระบุชื่อ',
      wish: wishText, design: $('input[name="design"]:checked').value === 'lotus' ? 'lotus' : 'gold',
      created_at: new Date().toISOString(), pending: true, source: 'local'
    };
    state.wishes.unshift(localWish);
    persistLocal();
    state.lastCreated = localWish;
    closeModal('create-modal');
    showLaunch();
    renderCounts();

    const cloudResult = await saveToCloud(localWish);
    if (cloudResult.ok) {
      state.lastCreated = cloudResult.data;
    } else if (cloudResult.reason === 'cloud-error') {
      toast('บันทึกกระทงไว้ในเครื่องแล้ว แต่ซิงก์คลาวด์ไม่สำเร็จ', 'error', 5000);
    } else {
      toast('บันทึกกระทงไว้ในเครื่องแล้ว');
    }
    button.disabled = false;
    button.querySelector('span').textContent = 'จุดแสงและปล่อยกระทง';
  }

  function finishLaunch() {
    $('#launch-overlay').hidden = true;
    switchView('gallery');
    renderGallery();
    if (state.lastCreated) toast('กระทงของคุณกำลังลอยไปกับสายน้ำ ✦', 'info', 4200);
  }

  function createStars() {
    const field = $('#star-field');
    if (!field) return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 42; i++) {
      const star = document.createElement('i');
      star.className = 'star-dot';
      star.style.left = `${seededNumber(`star-${i}`, 1) * 96 + 2}%`;
      star.style.top = `${seededNumber(`star-${i}`, 2) * 53 + 3}%`;
      star.style.setProperty('--dur', `${2 + seededNumber(`star-${i}`, 3) * 3}s`);
      star.style.animationDelay = `${-seededNumber(`star-${i}`, 4) * 5}s`;
      fragment.append(star);
    }
    field.append(fragment);
  }

  function bindEvents() {
    $$('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    $('#start-create').addEventListener('click', () => openModal('create-modal'));
    $('#gallery-create').addEventListener('click', () => openModal('create-modal'));
    $('#empty-create').addEventListener('click', () => openModal('create-modal'));
    $('#krathong-form').addEventListener('submit', handleCreate);
    $('#launch-finish').addEventListener('click', finishLaunch);
    $('#wish-text').addEventListener('input', updateWishCounter);

    $$('input[name="design"]').forEach(input => input.addEventListener('change', () => {
      $$('.design-option').forEach(option => option.classList.toggle('is-selected', $('input', option).checked));
    }));
    $$('[data-close]').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
    $$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => {
      if (event.target === backdrop) closeModal(backdrop.id);
    }));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        $$('.modal-backdrop:not([hidden])').forEach(modal => closeModal(modal.id));
      }
    });
    $('#motion-toggle').addEventListener('click', () => {
      state.reduceMotion = !state.reduceMotion;
      document.body.classList.toggle('reduce-motion', state.reduceMotion);
      $('#motion-toggle').classList.toggle('is-on', state.reduceMotion);
      $('#motion-toggle').setAttribute('aria-pressed', String(state.reduceMotion));
      toast(state.reduceMotion ? 'ลดการเคลื่อนไหวแล้ว' : 'เปิดเอฟเฟกต์เคลื่อนไหวแล้ว');
      if (state.currentView === 'gallery') renderGallery();
    });
  }

  function init() {
    if (state.reduceMotion) {
      document.body.classList.add('reduce-motion');
      $('#motion-toggle').classList.add('is-on');
      $('#motion-toggle').setAttribute('aria-pressed', 'true');
    }
    updateWishCounter();
    createStars();
    bindEvents();
    renderCounts();
    renderGallery();
    initSupabase();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
