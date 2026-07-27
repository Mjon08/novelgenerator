const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'novels.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

let db;

/*
 * Kolom yang ditambahkan setelah basis data pertama kali dibuat.
 * schema.sql memakai CREATE TABLE IF NOT EXISTS, sehingga perubahan di sana
 * tidak berlaku pada tabel yang sudah terlanjur ada — penambahan kolom harus
 * lewat ALTER TABLE di sini.
 */
const COLUMN_MIGRATIONS = [
  { table: 'novel_dna', column: 'blueprint_json', definition: 'TEXT' },
  // Teks sumber disimpan bersama DNA agar pemeriksaan orisinalitas tetap bisa
  // berjalan untuk DNA yang berasal dari berkas unggahan — kasus ini tidak
  // punya baris padanan di tabel novels.
  { table: 'novel_dna', column: 'source_text', definition: 'TEXT' }
];

function runMigrations(database) {
  for (const { table, column, definition } of COLUMN_MIGRATIONS) {
    const tableExists = database
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(table);
    if (!tableExists) continue;

    const columns = database.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some(c => c.name === column)) continue;

    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[db] Migrasi: kolom ${table}.${column} ditambahkan`);
  }
}

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);
    runMigrations(db);
  }
  return db;
}

module.exports = { getDb, runMigrations };
