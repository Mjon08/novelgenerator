// usageLimiter.js
// Rate & Budget Limiter to protect Anthropic API balance

const { getSupabase, throwIfError } = require('./database/supabaseClient');

// Tabel api_usage_logs sudah dibuat lewat supabase/schema.sql — di Postgres
// tidak ada eksekusi DDL ad-hoc dari client seperti dulu di SQLite.

function getTodayStr() {
  return new Date().toISOString().split('T')[0];
}

/**
 * Cek apakah pemanggilan API diizinkan berdasarkan batas harian/total
 *
 * Model gratis (OpenRouter :free) tidak menagih biaya, sehingga hanya
 * dibatasi laju permintaannya — bukan budget. Melewatkan pemeriksaan budget
 * untuk model gratis mencegah pipeline DNA terhenti oleh batas biaya yang
 * sebenarnya tidak pernah terpakai.
 */
async function checkUsageLimit(modelName = null) {
  const db = getSupabase();

  const maxDailyCalls = parseInt(process.env.MAX_DAILY_API_CALLS || '40', 10);
  const maxTotalBudgetUSD = parseFloat(process.env.MAX_TOTAL_BUDGET_USD || '3.50');

  let freeModel = false;
  try {
    freeModel = modelName ? require('./modelRegistry').isFreeModel(modelName) : false;
  } catch (_) {}

  const today = getTodayStr();

  // Hitung penggunaan hari ini
  const todayResult = await db
    .from('api_usage_logs')
    .select('calls_count, estimated_cost_usd')
    .eq('date_str', today)
    .maybeSingle();
  const todayRow = throwIfError(todayResult, 'checkUsageLimit:today');
  const todayCalls = todayRow ? todayRow.calls_count : 0;

  // Hitung total pengeluaran kumulatif. Agregat .sum() PostgREST tidak
  // diaktifkan di banyak project Supabase (fitur opsional server-side),
  // jadi dijumlahkan manual dari baris yang diambil.
  const totalResult = await db.from('api_usage_logs').select('estimated_cost_usd');
  const totalRows = throwIfError(totalResult, 'checkUsageLimit:total');
  const totalCost = totalRows.reduce((a, r) => a + (r.estimated_cost_usd || 0), 0);

  if (todayCalls >= maxDailyCalls) {
    throw new Error(`[LIMIT TERPACU] Batas pemanggilan API harian (${maxDailyCalls}x panggilan/hari) telah tercapai demi menghemat saldo Anda. Cobalah kembali besok atau naikkan MAX_DAILY_API_CALLS di file .env.`);
  }

  // Model gratis tidak menambah biaya, jadi batas budget tidak berlaku.
  if (!freeModel && totalCost >= maxTotalBudgetUSD) {
    throw new Error(`[LIMIT BUDGET TERPACU] Total perkiraan biaya penggunaan API ($${totalCost.toFixed(2)}) telah mencapai batas budget aman ($${maxTotalBudgetUSD.toFixed(2)}). Gunakan model gratis, atau ubah MAX_TOTAL_BUDGET_USD di file .env jika ingin melanjutkan.`);
  }

  return true;
}

/**
 * Catat setiap kali panggilan API berhasil dilakukan
 */
async function recordApiUsage(estimatedCost = 0.015, modelName = null) {
  try {
    // Panggilan ke model gratis tetap dihitung jumlahnya (untuk batas laju),
    // tetapi biayanya nol.
    if (modelName) {
      try {
        if (require('./modelRegistry').isFreeModel(modelName)) estimatedCost = 0;
      } catch (_) {}
    }

    const db = getSupabase();
    const today = getTodayStr();

    const existingResult = await db
      .from('api_usage_logs')
      .select('id, calls_count, estimated_cost_usd')
      .eq('date_str', today)
      .maybeSingle();
    const existing = throwIfError(existingResult, 'recordApiUsage:cek');

    if (existing) {
      const updateResult = await db
        .from('api_usage_logs')
        .update({
          calls_count: existing.calls_count + 1,
          estimated_cost_usd: existing.estimated_cost_usd + estimatedCost,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id);
      throwIfError(updateResult, 'recordApiUsage:update');
    } else {
      const insertResult = await db
        .from('api_usage_logs')
        .insert({ date_str: today, calls_count: 1, estimated_cost_usd: estimatedCost });
      throwIfError(insertResult, 'recordApiUsage:insert');
    }
  } catch (err) {
    console.error('Gagal mengupdate api_usage_logs:', err.message);
  }
}

/**
 * Ambil status saldo dan kuota untuk UI/API
 */
async function getUsageStats() {
  const db = getSupabase();
  const today = getTodayStr();

  const maxDailyCalls = parseInt(process.env.MAX_DAILY_API_CALLS || '40', 10);
  const maxTotalBudgetUSD = parseFloat(process.env.MAX_TOTAL_BUDGET_USD || '3.50');

  const todayResult = await db
    .from('api_usage_logs')
    .select('calls_count, estimated_cost_usd')
    .eq('date_str', today)
    .maybeSingle();
  const todayRow = throwIfError(todayResult, 'getUsageStats:today');
  const todayCalls = todayRow ? todayRow.calls_count : 0;
  const todayCost = todayRow ? todayRow.estimated_cost_usd : 0.0;

  const totalResult = await db.from('api_usage_logs').select('estimated_cost_usd, calls_count');
  const totalRows = throwIfError(totalResult, 'getUsageStats:total');
  const totalCost = totalRows.reduce((a, r) => a + (r.estimated_cost_usd || 0), 0);
  const totalCalls = totalRows.reduce((a, r) => a + (r.calls_count || 0), 0);

  return {
    todayCalls,
    maxDailyCalls,
    todayCostUSD: todayCost.toFixed(3),
    totalCalls,
    totalCostUSD: totalCost.toFixed(3),
    maxTotalBudgetUSD: maxTotalBudgetUSD.toFixed(2),
    remainingBudgetUSD: Math.max(0, maxTotalBudgetUSD - totalCost).toFixed(2)
  };
}

module.exports = {
  checkUsageLimit,
  recordApiUsage,
  getUsageStats
};
