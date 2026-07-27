/*
 * SITE AUTH — gerbang password tunggal
 *
 * Aplikasi ini dipakai satu orang (Anda), bukan sistem banyak akun — jadi
 * bukan Supabase Auth dengan tabel users/sign-up/reset password, melainkan
 * satu password bersama yang menjaga SELURUH situs sebelum dideploy publik
 * di Render. Sesi disimpan di memori proses (bukan database): sederhana,
 * dan otomatis "logout semua" setiap server redeploy/restart — trade-off
 * yang wajar untuk pemakaian pribadi.
 */

const crypto = require('crypto');

const SESSION_COOKIE = 'ngen_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 hari
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 menit

// token -> waktu kedaluwarsa (ms epoch)
const sessions = new Map();
// ip -> { count, lockedUntil }
const failedAttempts = new Map();

function getLoginPassword() {
  const pw = process.env.APP_LOGIN_PASSWORD;
  if (!pw) {
    throw new Error(
      'APP_LOGIN_PASSWORD belum diisi di .env — wajib diset sebelum aplikasi bisa dipakai. ' +
      'Pilih password Anda sendiri dan tambahkan baris APP_LOGIN_PASSWORD=... ke .env.'
    );
  }
  return pw;
}

/**
 * Bandingkan password tanpa membocorkan info lewat waktu eksekusi
 * (constant-time compare), agar tidak rentan timing attack sederhana.
 */
function passwordMatches(input) {
  const expected = Buffer.from(getLoginPassword());
  const actual = Buffer.from(String(input || ''));
  if (actual.length !== expected.length) {
    // Tetap proses pembanding dummy agar waktu respons tidak membocorkan
    // panjang password yang benar.
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, actual);
}

function isLockedOut(ip) {
  const entry = failedAttempts.get(ip);
  if (!entry) return false;
  if (entry.lockedUntil && entry.lockedUntil > Date.now()) return true;
  if (entry.lockedUntil && entry.lockedUntil <= Date.now()) failedAttempts.delete(ip);
  return false;
}

function recordFailedAttempt(ip) {
  const entry = failedAttempts.get(ip) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_FAILED_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_MS;
    entry.count = 0;
  }
  failedAttempts.set(ip, entry);
}

function clearFailedAttempts(ip) {
  failedAttempts.delete(ip);
}

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function isValidSession(token) {
  if (!token) return false;
  const expiry = sessions.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function destroySession(token) {
  if (token) sessions.delete(token);
}

/**
 * Parser cookie minimal — menghindari dependency cookie-parser tambahan
 * hanya untuk satu cookie sesi.
 */
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(pair => {
      const idx = pair.indexOf('=');
      if (idx === -1) return [pair.trim(), ''];
      return [pair.slice(0, idx).trim(), decodeURIComponent(pair.slice(idx + 1).trim())];
    })
  );
}

function setSessionCookie(res, token, req) {
  // "Secure" hanya diaktifkan saat koneksi benar-benar HTTPS. Di Render,
  // TLS diterminasi di reverse proxy mereka — req.secure baru akurat kalau
  // "trust proxy" diaktifkan di app Express (lihat server.js).
  const secure = req.secure ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

// Path yang tetap boleh diakses tanpa login: halaman login itu sendiri,
// endpoint login/logout, dan aset statis yang dipakai halaman login.
const PUBLIC_PATHS = [
  '/login.html',
  '/api/login',
  '/api/logout',
  '/shared/shared.css',
  '/shared/design-tokens.css',
  '/shared/toast.js'
];

function isPublicPath(pathname) {
  return PUBLIC_PATHS.includes(pathname);
}

/**
 * Middleware gerbang: redirect ke /login.html (untuk navigasi halaman) atau
 * balas 401 JSON (untuk panggilan API/fetch) bila sesi tidak valid.
 */
function requireAuth(req, res, next) {
  if (isPublicPath(req.path)) return next();

  const cookies = parseCookies(req);
  if (isValidSession(cookies[SESSION_COOKIE])) return next();

  const wantsJson = req.path.startsWith('/api/') || req.headers.accept?.includes('application/json');
  if (wantsJson) {
    return res.status(401).json({ error: 'Sesi tidak valid atau sudah berakhir. Silakan login kembali.' });
  }
  // Bawa tujuan asli supaya setelah login pengguna kembali ke halaman yang
  // memang ingin dibuka, bukan selalu dilempar ke dasbor.
  const dest = req.originalUrl && req.originalUrl !== '/' ? req.originalUrl : 'index.html';
  res.redirect(`/login.html?redirect=${encodeURIComponent(dest)}`);
}

module.exports = {
  SESSION_COOKIE,
  passwordMatches,
  isLockedOut,
  recordFailedAttempt,
  clearFailedAttempts,
  LOCKOUT_MS,
  createSession,
  isValidSession,
  destroySession,
  parseCookies,
  setSessionCookie,
  clearSessionCookie,
  requireAuth
};
