const mysql = require('mysql2/promise');
require('dotenv').config();

// Crear pool de conexiones
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  timezone: 'Z',
  connectTimeout: 8000,
  connectionLimit: Math.max(5, Number(process.env.DB_CONNECTION_LIMIT) || 10),
  queueLimit: 0
});

// Alinear defaults SQL y fechas leídas por mysql2 con UTC.
pool.on('connection', connection => connection.query("SET time_zone = '+00:00'"));

// Verificar conexión
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Conexión a MySQL establecida correctamente');
    connection.release();
    return true;
  } catch (error) {
    console.error('❌ Error conectando a MySQL:', error.message);
    return false;
  }
}

module.exports = {
  pool,
  testConnection
};