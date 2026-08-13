/* sw.js — offline shell สำหรับ subsii dashboard
 * deploy: deploy.sh copy ไฟล์นี้ไป deploy mirror คู่กับ index.html (scope = /subsii/)
 *
 * 2 กลยุทธ์แยกกันตามชนิดของ request:
 *   หน้าเว็บ (same-origin)  → network-first  เน็ตมี = ของสดเสมอ · เน็ตหลุด = copy ล่าสุด
 *                            (pull-to-refresh ที่ cache-bust ด้วย ?v= ยังทำงานปกติ)
 *   ฟอนต์ Google (cross-origin) → cache-first  โหลดครั้งเดียวจบ · offline ยังได้ตัวอักษรถูกแบบ
 *
 * ไม่มี version ให้ bump มือ — entry ถูกเขียนทับทุกครั้งที่ fetch สำเร็จ
 */
const CACHE = 'subsii-v1';

// key เดียวสำหรับทุก navigation — PTR รีโหลดด้วย ?v=timestamp ทุกครั้ง
// ถ้า key ตาม URL ตรงๆ cache จะบวมไม่มีที่สิ้นสุด + offline หา entry ไม่เจอ
const SHELL = new URL('./', self.location).href;

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // ── ฟอนต์: cache-first ──
  // response เป็น opaque (no-CORS) — เช็ค res.ok ไม่ได้ (opaque = status 0 เสมอ)
  // จึงเก็บเมื่อ fetch ไม่ throw · ยอมรับความเสี่ยงว่าถ้า CDN คืน error page จะติด cache
  // แลกกับการที่ offline ยังได้ฟอนต์ถูกแบบ ไม่ตกไป system font
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req, { ignoreVary: true }).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      // ยังไม่เคย cache + เน็ตหลุด → คืน 504 เปล่าๆ ให้เบราว์เซอร์ตกไป system font
      // (ห้ามคืน undefined — respondWith จะ throw แล้วขึ้น error ใน console เปล่าๆ)
      }).catch(() => new Response('', { status: 504, statusText: 'offline' })))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // ── หน้าเว็บ + ไฟล์ในโดเมนตัวเอง: network-first ──
  const key = req.mode === 'navigate' ? SHELL : req;

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(key, copy));
        }
        return res;
      })
      // ignoreVary สำคัญ: GitHub Pages ส่ง Vary: Accept-Encoding มาด้วย
      // ถ้าไม่ข้าม การ match จะพลาดเพราะ header ไม่ตรง = offline ได้หน้าขาวทั้งที่ cache มีของ
      .catch(() => caches.match(key, { ignoreVary: true })
        .then(hit => hit || caches.match(SHELL, { ignoreVary: true })))
  );
});
