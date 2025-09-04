const express = require('express');
const router = express.Router();
const { pool } = require('./database');
const bcrypt = require('bcryptjs');

// Middleware de autenticación básica
const adminAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
    return res.status(401).send('Autenticación requerida');
  }
  
  const auth = Buffer.from(authHeader.split(' ')[1], 'base64').toString().split(':');
  const user = auth[0];
  const pass = auth[1];
  
  // Credenciales de admin (cambiar en producción)
  const ADMIN_USER = process.env.ADMIN_USER || 'admin';
  const ADMIN_PASS = process.env.ADMIN_PASS || 'KYC2025Admin!';
  
  if (user === ADMIN_USER && pass === ADMIN_PASS) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Panel"');
    res.status(401).send('Credenciales incorrectas');
  }
};

// Aplicar autenticación a todas las rutas admin
router.use(adminAuth);

// Migración: Agregar columna search_limit si no existe
router.post('/migrate-search-limits', async (req, res) => {
  try {
    // Verificar si la columna ya existe
    const [columns] = await pool.query(`
      SHOW COLUMNS FROM authorized_users LIKE 'search_limit'
    `);
    
    if (columns.length === 0) {
      // Agregar la columna search_limit con valor por defecto de 100
      await pool.query(`
        ALTER TABLE authorized_users 
        ADD COLUMN search_limit INT DEFAULT 100 COMMENT 'Límite diario de búsquedas (-1 = ilimitado)'
      `);
      
      res.json({
        success: true,
        message: 'Columna search_limit agregada exitosamente'
      });
    } else {
      res.json({
        success: true,
        message: 'La columna search_limit ya existe'
      });
    }
  } catch (error) {
    console.error('Error en migración:', error);
    res.status(500).json({
      success: false,
      error: 'Error al agregar columna search_limit: ' + error.message
    });
  }
});

// GET - Listar todos los usuarios
router.get('/users', async (req, res) => {
  try {
    const [users] = await pool.query(
      `SELECT 
        id,
        phone_number,
        full_name,
        company,
        is_active,
        search_limit,
        created_at,
        last_access,
        total_queries
      FROM authorized_users 
      ORDER BY created_at DESC`
    );
    res.json(users);
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({ error: 'Error obteniendo usuarios' });
  }
});

// POST - Agregar nuevo usuario
router.post('/users', async (req, res) => {
  const { phone_number, full_name, company, search_limit } = req.body;
  
  if (!phone_number || !full_name) {
    return res.status(400).json({ error: 'Número y nombre son requeridos' });
  }
  
  // Limpiar número - quitar espacios y el + si existe
  let formattedNumber = phone_number.replace(/\s+/g, '').replace(/^\+/, '');
  
  // Validar search_limit
  let finalSearchLimit = search_limit || 100; // Default 100
  if (finalSearchLimit === 'unlimited') {
    finalSearchLimit = -1;
  }
  
  try {
    const [result] = await pool.query(
      'INSERT INTO authorized_users (phone_number, full_name, company, search_limit) VALUES (?, ?, ?, ?)',
      [formattedNumber, full_name, company || null, finalSearchLimit]
    );
    
    res.json({ 
      id: result.insertId,
      message: 'Usuario agregado exitosamente',
      phone_number: formattedNumber 
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'Este número ya está registrado' });
    } else {
      console.error('Error agregando usuario:', error);
      res.status(500).json({ error: 'Error agregando usuario' });
    }
  }
});

// PUT - Actualizar usuario
router.put('/users/:id', async (req, res) => {
  const { id } = req.params;
  const { full_name, company, is_active, search_limit } = req.body;
  
  // Validar search_limit
  let finalSearchLimit = search_limit || 100;
  if (finalSearchLimit === 'unlimited') {
    finalSearchLimit = -1;
  }
  
  try {
    await pool.query(
      `UPDATE authorized_users 
       SET full_name = ?, company = ?, is_active = ?, search_limit = ?
       WHERE id = ?`,
      [full_name, company, is_active, finalSearchLimit, id]
    );
    
    res.json({ message: 'Usuario actualizado exitosamente' });
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({ error: 'Error actualizando usuario' });
  }
});

// DELETE - Eliminar usuario
router.delete('/users/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    await pool.query('DELETE FROM authorized_users WHERE id = ?', [id]);
    res.json({ message: 'Usuario eliminado exitosamente' });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ error: 'Error eliminando usuario' });
  }
});

// GET - Estadísticas
router.get('/stats', async (req, res) => {
  try {
    const [totalUsers] = await pool.query(
      'SELECT COUNT(*) as total FROM authorized_users WHERE is_active = true'
    );
    
    const [activeToday] = await pool.query(
      `SELECT COUNT(*) as total FROM authorized_users 
       WHERE last_access >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    );
    
    const [totalQueries] = await pool.query(
      'SELECT SUM(total_queries) as total FROM authorized_users'
    );
    
    const [blockedAttempts] = await pool.query(
      `SELECT COUNT(*) as total FROM blocked_attempts 
       WHERE attempt_time >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
    );
    
    res.json({
      totalUsers: totalUsers[0].total,
      activeToday: activeToday[0].total,
      totalQueries: totalQueries[0].total || 0,
      blockedToday: blockedAttempts[0].total
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

// GET - Intentos bloqueados
router.get('/blocked', async (req, res) => {
  try {
    const [attempts] = await pool.query(
      `SELECT 
        phone_number,
        COUNT(*) as attempts,
        MAX(attempt_time) as last_attempt
      FROM blocked_attempts 
      WHERE attempt_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY phone_number
      ORDER BY attempts DESC
      LIMIT 50`
    );
    res.json(attempts);
  } catch (error) {
    console.error('Error obteniendo intentos bloqueados:', error);
    res.status(500).json({ error: 'Error obteniendo intentos bloqueados' });
  }
});

module.exports = router;