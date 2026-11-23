(() => {
  const $ = (id) => document.getElementById(id);
  const screens = {
    home: $('homeScreen'), build: $('buildScreen'), release: $('releaseScreen'), success: $('successScreen'), gallery: $('galleryScreen')
  };
  const config = window.APP_CONFIG || {};
  const isConfigured = config.SUPABASE_URL && config.SUPABASE_ANON_KEY &&
    !config.SUPABASE_URL.includes('ใส่_') && !config.SUPABASE_ANON_KEY.includes('ใส่_');
  let supabaseClient = null;
  if (isConfigured && window.supabase?.createClient) {
    supabaseClient = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
  }

  let selectedStyle = 'lotus';
  let selectedCategory = 'ความสุข';
  let holdTimer = null;
  let holdStarted = 0;
  let holdFrame = null;
  let sending = false;
  let toastTimer = null;

  function showScreen(name) {
    Object.entries(screens).forEach(([key, node]) => node.classList.toggle('hidden', key !== name));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2700);
  }
  function setStatus(id, message, isError = true) {
    const node = $(id);
    node.textContent = message;
    node.style.color = isError ? '#f4b9c6' : '#c3e9d6';
  }
  function starsInto(containerId, count) {
    const container = $(containerId);
    if (!container || container.childElementCount) return;
    for (let i = 0; i < count; i++) {
      const star = document.createElement('i');
      star.className = 'scene-star';
      star.style.left = `${Math.random() * 96 + 2}%`;
      star.style.top = `${Math.random() * 72 + 4}%`;
      star.style.animationDelay = `${Math.random() * 3}s`;
      container.appendChild(star);
    }
  }
  starsInto('sceneStars', 44);
  starsInto('releaseStars', 34);
  loadHomeRiver();

  $('startButton').addEventListener('click', () => showScreen('build'));
  document.querySelectorAll('[data-go-home]').forEach(button => button.addEventListener('click', () => showScreen('home')));

  document.querySelectorAll('.krathong-option').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.krathong-option').forEach(item => {
        item.classList.remove('selected'); item.setAttribute('aria-pressed', 'false');
      });
      button.classList.add('selected'); button.setAttribute('aria-pressed', 'true');
      selectedStyle = button.dataset.style;
      $('krathongPreview').className = `krathong-illustration style-${selectedStyle}`;
      $('releaseKrathong').className = `release-krathong style-${selectedStyle}`;
    });
  });
  document.querySelectorAll('.category-chip').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.category-chip').forEach(item => {
        item.classList.remove('active'); item.setAttribute('aria-pressed', 'false');
      });
      button.classList.add('active'); button.setAttribute('aria-pressed', 'true');
      selectedCategory = button.dataset.category;
    });
  });
  $('wishMessage').addEventListener('input', () => {
    $('charCount').textContent = `${$('wishMessage').value.length} / 500`;
  });

  $('prepareButton').addEventListener('click', () => {
    const message = $('wishMessage').value.trim();
    if (!message) {
      setStatus('builderStatus', 'เขียนคำอธิษฐานสักนิดก่อนนะ');
      $('wishMessage').focus();
      return;
    }
    if (message.length > 500) {
      setStatus('builderStatus', 'ข้อความยาวเกินไป ลองปรับให้ไม่เกิน 500 ตัวอักษรนะ');
      return;
    }
    setStatus('builderStatus', '', false);
    $('releaseKrathong').className = `release-krathong style-${selectedStyle}`;
    $('releaseKrathong').classList.remove('drifting');
    $('releaseButton').disabled = false;
    $('holdProgress').style.width = '0%';
    $('holdLabel').textContent = 'แตะค้างเพื่อปล่อยกระทง';
    $('releaseHint').textContent = 'หนึ่งคำอธิษฐาน กำลังจะออกเดินทาง';
    setStatus('releaseStatus', 'แตะค้างประมาณ 1 วินาที เพื่อปล่อยกระทง', false);
    showScreen('release');
  });

  $('editWishButton').addEventListener('click', () => showScreen('build'));
  $('viewFloatingButton').addEventListener('click', () => { showScreen('gallery'); loadGallery(); });
  $('homeViewFloatingButton').addEventListener('click', () => { showScreen('gallery'); loadGallery(); });
  $('galleryBackButton').addEventListener('click', () => { showScreen('home'); loadHomeRiver(); });
  $('anotherWishButton').addEventListener('click', () => {
    $('wishMessage').value = '';
    $('wishFrom').value = '';
    $('charCount').textContent = '0 / 500';
    setStatus('builderStatus', '', false);
    showScreen('build');
  });

  function stopHold() {
    if (holdTimer) clearTimeout(holdTimer);
    if (holdFrame) cancelAnimationFrame(holdFrame);
    holdTimer = null; holdFrame = null;
    if (!sending) $('holdProgress').style.width = '0%';
  }
  function updateHold() {
    if (!holdStarted || sending) return;
    const progress = Math.min(100, ((performance.now() - holdStarted) / 1050) * 100);
    $('holdProgress').style.width = `${progress}%`;
    if (progress < 100) holdFrame = requestAnimationFrame(updateHold);
  }
  async function sendWish() {
    if (sending) return;
    const message = $('wishMessage').value.trim();
    const fromName = $('wishFrom').value.trim().slice(0, 40) || 'ผู้ไม่ระบุชื่อ';
    if (!message) { showScreen('build'); setStatus('builderStatus', 'ไม่พบคำอธิษฐาน ลองเขียนใหม่อีกครั้งนะ'); return; }
    if (!supabaseClient) {
      setStatus('releaseStatus', 'เว็บไซต์ยังเชื่อมต่อ Supabase ไม่สำเร็จ กรุณาตรวจสอบ URL และ public key ใน config.js');
      $('holdLabel').textContent = 'ลองอีกครั้งหลังตั้งค่าฐานข้อมูล';
      $('holdProgress').style.width = '0%';
      return;
    }
    sending = true;
    $('releaseButton').disabled = true;
    $('holdLabel').textContent = 'กำลังส่งคำอธิษฐาน…';
    setStatus('releaseStatus', 'กำลังเก็บคำอธิษฐานไว้อย่างเป็นส่วนตัว', false);
    try {
      const { error } = await supabaseClient.from('wishes').insert({
        category: selectedCategory,
        message,
        krathong_style: selectedStyle
      });
      if (error) throw error;
      const { error: publicError } = await supabaseClient.from('floating_krathongs').insert({ from_name: fromName, krathong_style: selectedStyle });
      if (publicError) throw publicError;
      $('releaseKrathong').classList.add('drifting');
      $('releaseHint').textContent = 'ปล่อยให้สายน้ำพาความปรารถนาดีเดินทางไป';
      $('holdLabel').textContent = 'ลอยออกไปแล้ว ✧';
      setStatus('releaseStatus', 'คำอธิษฐานของคุณถูกบันทึกแล้ว', false);
      setTimeout(() => { showScreen('success'); loadFloatingPreview(); }, 2550);
    } catch (error) {
      console.error('Unable to save wish:', error);
      $('releaseButton').disabled = false;
      $('holdLabel').textContent = 'แตะค้างเพื่อลองอีกครั้ง';
      $('releaseHint').textContent = 'กระทงยังรอออกเดินทางอยู่ตรงนี้';
      setStatus('releaseStatus', 'ส่งไม่สำเร็จ ลองอีกครั้งได้เลย หากยังมีปัญหาให้ตรวจสอบการตั้งค่า Supabase');
      sending = false;
      return;
    }
    sending = false;
  }
  function renderFloatingKrathongs(container, items) {
    container.innerHTML = '';
    if (!items.length) { container.textContent = 'ยังไม่มีใครลอยกระทง'; return; }
    const loopItems = ['floatingTrack', 'homeRiverTrack'].includes(container.id) ? [...items, ...items] : items;
    loopItems.forEach((item, index) => {
      const card = document.createElement('div'); card.className = 'floating-krathong-card';
      card.style.setProperty('--float-delay', `${index * -2.4}s`);
      card.innerHTML = `<span class="float-flower">${item.krathong_style === 'jasmine' ? '✽' : item.krathong_style === 'marigold' ? '✺' : '✿'}</span><span class="float-candle">☼</span><span class="float-name"></span>`;
      card.querySelector('.float-name').textContent = item.from_name || 'ผู้ไม่ระบุชื่อ';
      container.appendChild(card);
    });
  }
  async function loadFloatingPreview() {
    if (!supabaseClient) return;
    const { data, error } = await supabaseClient.from('floating_krathongs').select('from_name,krathong_style,created_at').order('created_at', { ascending: false }).limit(30);
    if (!error && data) renderFloatingKrathongs($('floatingTrack'), data);
  }
  async function loadHomeRiver() {
    const riverTrack = $('homeRiverTrack');
    if (!riverTrack || !supabaseClient) return;
    const { data, error } = await supabaseClient.from('floating_krathongs').select('from_name,krathong_style,created_at').order('created_at', { ascending: false }).limit(24);
    if (!error && data) renderFloatingKrathongs(riverTrack, data);
  }
  async function loadGallery() {
    const track = $('galleryTrack');
    if (!supabaseClient) { $('galleryStatus').textContent = 'ยังเชื่อมต่อฐานข้อมูลไม่ได้'; return; }
    $('galleryStatus').textContent = 'กำลังเรียกกระทงที่ลอยอยู่…';
    const { data, error } = await supabaseClient.from('floating_krathongs').select('from_name,krathong_style,created_at').order('created_at', { ascending: false }).limit(100);
    if (error) { console.error(error); $('galleryStatus').textContent = 'โหลดไม่สำเร็จ โปรดตรวจสอบตาราง floating_krathongs ใน Supabase'; return; }
    $('galleryStatus').textContent = data.length ? `กระทง ${data.length} ใบที่ลอยอยู่` : 'ยังไม่มีใครลอยกระทง';
    renderFloatingKrathongs(track, data);
  }

  function beginHold(event) {
    if (sending || $('releaseButton').disabled) return;
    if (event && event.pointerType === 'mouse' && event.button !== 0) return;
    if (event?.cancelable) event.preventDefault();
    holdStarted = performance.now();
    updateHold();
    holdTimer = setTimeout(() => {
      holdTimer = null; holdStarted = 0;
      if (holdFrame) cancelAnimationFrame(holdFrame);
      holdFrame = null;
      sendWish();
    }, 1050);
  }
  function endHold() {
    if (holdTimer) {
      stopHold();
      if (holdStarted) setStatus('releaseStatus', 'ยังไม่ครบเวลา ลองแตะค้างอีกครั้งนะ', false);
    }
    holdStarted = 0;
  }
  const releaseButton = $('releaseButton');
  releaseButton.addEventListener('pointerdown', beginHold);
  releaseButton.addEventListener('pointerup', endHold);
  releaseButton.addEventListener('pointercancel', endHold);
  releaseButton.addEventListener('pointerleave', endHold);
  releaseButton.addEventListener('keydown', event => {
    if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) beginHold(event);
  });
  releaseButton.addEventListener('keyup', event => {
    if (event.key === ' ' || event.key === 'Enter') endHold();
  });
})();
