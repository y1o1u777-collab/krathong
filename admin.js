(() => {
  const $ = id => document.getElementById(id);
  const cfg = window.APP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes('ใส่_') && !cfg.SUPABASE_ANON_KEY.includes('ใส่_');
  const client = configured && window.supabase?.createClient
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  function status(id, message, good = false) {
    const node = $(id); node.textContent = message; node.style.color = good ? '#bfe6d3' : '#f0b5c4';
  }
  function dateText(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  }
  function safeText(tag, className, value) {
    const node = document.createElement(tag); node.className = className; node.textContent = value; return node;
  }
  function showSignedIn(show) {
    $('loginPanel').classList.toggle('hidden', show);
    $('wishesPanel').classList.toggle('hidden', !show);
  }
  async function loadWishes() {
    if (!client) { status('listStatus', 'ยังไม่ได้ตั้งค่า Supabase กรุณาตรวจสอบ config.js'); return; }
    status('listStatus', 'กำลังโหลดคำอธิษฐาน…', true);
    $('refreshButton').disabled = true;
    try {
      const { data, error } = await client.from('wishes')
        .select('id, category, message, created_at, krathong_style')
        .order('created_at', { ascending: false }).limit(300);
      if (error) throw error;
      const list = $('wishList'); list.replaceChildren();
      $('wishCount').textContent = `${data.length} ข้อความ`;
      if (!data.length) {
        list.appendChild(safeText('p', 'empty-state', 'ยังไม่มีคำอธิษฐานที่ถูกฝากไว้'));
      } else {
        data.forEach(item => {
          const card = document.createElement('article'); card.className = 'wish-item';
          const meta = document.createElement('div'); meta.className = 'wish-meta';
          meta.append(safeText('span', '', `✦ ${item.category || 'คำอธิษฐาน'}`));
          meta.append(safeText('time', '', dateText(item.created_at)));
          card.append(meta, safeText('p', 'wish-message', item.message || ''));
          list.appendChild(card);
        });
      }
      status('listStatus', '', true);
    } catch (error) {
      console.error('Unable to load wishes:', error);
      status('listStatus', 'ไม่สามารถอ่านข้อมูลได้ ตรวจสอบว่าเข้าสู่ระบบด้วยบัญชีเจ้าของเว็บไซต์แล้ว');
    } finally { $('refreshButton').disabled = false; }
  }

  if (!client) status('loginStatus', 'โปรดกรอก Supabase URL และ public key ใน config.js ก่อน');
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client) { status('loginStatus', 'ยังไม่ได้ตั้งค่า Supabase ใน config.js'); return; }
    const button = $('loginButton'); button.disabled = true; button.textContent = 'กำลังเข้าสู่ระบบ…';
    try {
      const { error } = await client.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
      if (error) throw error;
      showSignedIn(true); await loadWishes();
    } catch (error) {
      console.error('Sign in failed:', error);
      status('loginStatus', 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบอีเมลและรหัสผ่าน');
    } finally { button.disabled = false; button.textContent = 'เข้าสู่ระบบ'; }
  });
  $('logoutButton').addEventListener('click', async () => {
    if (client) await client.auth.signOut();
    $('wishList').replaceChildren(); showSignedIn(false);
  });
  $('refreshButton').addEventListener('click', loadWishes);
  if (client) {
    client.auth.getSession().then(({ data }) => {
      if (data.session) { showSignedIn(true); loadWishes(); }
    });
  }
})();
