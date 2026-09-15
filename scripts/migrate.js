const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
async function migrate(pool, env = {}) {
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/001_reliability.sql'), 'utf8');
  for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await pool.query(statement);
  for (const [column, definition] of [['search_limit', 'INT NOT NULL DEFAULT 100'], ['ine_ocr_enabled', 'BOOLEAN NOT NULL DEFAULT FALSE']]) {
    const [rows] = await pool.query('SHOW COLUMNS FROM authorized_users LIKE ?', [column]);
    if (!rows.length) await pool.query(`ALTER TABLE authorized_users ADD COLUMN ${column} ${definition}`);
  }
  // Importación inicial solamente; el runtime nunca autentica contra ADMIN_PASS.
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM bot_admins');
  if (!total && env.ADMIN_USER && env.ADMIN_PASS) {
    const hash = await bcrypt.hash(env.ADMIN_PASS, 12);
    await pool.execute("INSERT INTO bot_admins (username, password_hash, role) VALUES (?, ?, 'owner')", [env.ADMIN_USER.toLowerCase(), hash]);
    console.log('Administrador inicial importado con hash. Retira ADMIN_PASS del entorno después de validar el acceso.');
  }
}
if (require.main === module) {
  const { pool } = require('../database');
  migrate(pool, process.env).then(() => console.log('Migración completada.')).catch(error => {
    console.error('Migración fallida:', error.code || error.message); process.exitCode = 1;
  }).finally(() => pool.end());
}
module.exports = { migrate };
