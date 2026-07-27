/*
 * SUPABASE CLIENT
 *
 * Server ini adalah backend tepercaya (bukan browser), jadi memakai
 * SERVICE ROLE KEY — kunci ini melewati Row Level Security dan tidak boleh
 * pernah dikirim ke frontend/browser.
 *
 * Menggantikan database/db.js (better-sqlite3) yang dipakai sebelum migrasi
 * ke Postgres/Supabase.
 */

const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        'SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib diisi di .env. ' +
        'Ambil dari dashboard Supabase: Project Settings > API.'
      );
    }

    client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}

/**
 * Melempar error yang jelas bila query Supabase gagal.
 * PostgREST mengembalikan { data, error } alih-alih melempar exception,
 * sehingga tiap pemanggilan perlu dicek eksplisit — helper ini merapikan pola itu.
 */
function throwIfError(result, context = '') {
  if (result.error) {
    const prefix = context ? `[${context}] ` : '';
    throw new Error(`${prefix}${result.error.message}`);
  }
  return result.data;
}

module.exports = { getSupabase, throwIfError };
