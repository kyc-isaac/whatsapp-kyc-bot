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

// Migración: Agregar columna ine_ocr_enabled si no existe
router.post('/migrate-ine-ocr', async (req, res) => {
  try {
    // Verificar si la columna ya existe
    const [columns] = await pool.query(`
      SHOW COLUMNS FROM authorized_users LIKE 'ine_ocr_enabled'
    `);
    
    if (columns.length === 0) {
      // Agregar la columna ine_ocr_enabled
      await pool.query(`
        ALTER TABLE authorized_users 
        ADD COLUMN ine_ocr_enabled BOOLEAN DEFAULT FALSE 
        COMMENT 'Permite al usuario hacer búsquedas enviando fotos de INE'
      `);
      
      res.json({
        success: true,
        message: 'Columna ine_ocr_enabled agregada exitosamente'
      });
    } else {
      res.json({
        success: true,
        message: 'La columna ine_ocr_enabled ya existe'
      });
    }
  } catch (error) {
    console.error('Error en migración:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

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
        ine_ocr_enabled,
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
  const { phone_number, full_name, company, search_limit, ine_ocr_enabled } = req.body;
  
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
      'INSERT INTO authorized_users (phone_number, full_name, company, search_limit, ine_ocr_enabled) VALUES (?, ?, ?, ?, ?)',
      [formattedNumber, full_name, company || null, finalSearchLimit, ine_ocr_enabled || false]
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
  const { full_name, company, is_active, search_limit, ine_ocr_enabled } = req.body;
  
  // Validar search_limit
  let finalSearchLimit = search_limit || 100;
  if (finalSearchLimit === 'unlimited') {
    finalSearchLimit = -1;
  }
  
  try {
    await pool.query(
      `UPDATE authorized_users 
       SET full_name = ?, company = ?, is_active = ?, search_limit = ?, ine_ocr_enabled = ?
       WHERE id = ?`,
      [full_name, company, is_active, finalSearchLimit, ine_ocr_enabled || false, id]
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

// GET - Diagnóstico temporal (ELIMINAR EN PRODUCCIÓN DESPUÉS DE USAR)
router.get('/diagnostic', async (req, res) => {
  try {
    const diagnosticInfo = {
      kycApiUrl: process.env.KYC_API_URL || 'NO CONFIGURADA',
      kycApiKeyPresent: !!process.env.KYC_API_KEY,
      serverUrl: process.env.SERVER_URL || 'NO CONFIGURADA',
      twilioConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      nodeEnv: process.env.NODE_ENV || 'development',
      timestamp: new Date().toISOString()
    };
    
    // Verificar conectividad con la API KYC
    try {
      const axios = require('axios');
      // Hacer una búsqueda de prueba simple para verificar la conectividad
      const testResponse = await axios.post(`${process.env.KYC_API_URL}/search`, {
        persona: "2",
        nombre: "TEST CONNECTION",
        porcentaje_min: 98
      }, {
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": process.env.KYC_API_KEY,
        },
        timeout: 5000
      });
      diagnosticInfo.kycApiStatus = 'CONECTADO';
      diagnosticInfo.kycApiResponse = 'API funcional';
    } catch (error) {
      diagnosticInfo.kycApiStatus = 'ERROR';
      diagnosticInfo.kycApiError = error.message;
      if (error.response) {
        diagnosticInfo.kycApiStatusCode = error.response.status;
        diagnosticInfo.kycApiResponseData = error.response.data;
      }
    }
    
    res.json(diagnosticInfo);
  } catch (error) {
    res.status(500).json({ error: error.message });
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