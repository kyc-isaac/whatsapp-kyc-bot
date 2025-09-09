const express = require('express');
const router = express.Router();
const { pool } = require('./database');
const bcrypt = require('bcryptjs');

// Verificar que las credenciales de admin estén configuradas
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

if (!ADMIN_USER || !ADMIN_PASS) {
  console.error('❌ ERROR: ADMIN_USER and ADMIN_PASS environment variables are required');
  process.exit(1);
}

// Ruta de login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Usuario y contraseña son requeridos' 
      });
    }
    
    // Verificar credenciales
    if (username === ADMIN_USER && password === ADMIN_PASS) {
      // Crear sesión autenticada
      req.session.authenticated = true;
      req.session.username = username;
      req.session.loginTime = new Date().toISOString();
      
      res.json({ 
        success: true, 
        message: 'Login exitoso',
        user: username
      });
    } else {
      res.status(401).json({ 
        success: false, 
        message: 'Usuario o contraseña incorrectos' 
      });
    }
    
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error interno del servidor' 
    });
  }
});

// Ruta de logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Error cerrando sesión:', err);
      return res.status(500).json({ 
        success: false, 
        message: 'Error cerrando sesión' 
      });
    }
    
    res.clearCookie('connect.sid');
    res.json({ 
      success: true, 
      message: 'Sesión cerrada exitosamente' 
    });
  });
});

// Middleware de autenticación para las rutas protegidas
const adminAuth = (req, res, next) => {
  console.log(`🔍 Protected admin route accessed: ${req.method} ${req.path}`);
  
  if (!req.session.authenticated) {
    console.log('❌ No authenticated session found');
    return res.status(401).json({ 
      success: false, 
      message: 'No autorizado. Inicia sesión primero.' 
    });
  }
  
  console.log('✅ Session authenticated, proceeding...');
  next();
};

// Ruta para obtener información de sesión
router.get('/session', adminAuth, (req, res) => {
  if (req.session.authenticated) {
    res.json({
      success: true,
      authenticated: true,
      username: req.session.username,
      loginTime: req.session.loginTime
    });
  } else {
    res.json({
      success: false,
      authenticated: false
    });
  }
});

// Migración: Agregar columna ine_ocr_enabled si no existe
router.post('/migrate-ine-ocr', adminAuth, async (req, res) => {
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
      message: 'Error ejecutando migración: ' + error.message
    });
  }
});

// Test route para debug
router.get('/test', adminAuth, async (req, res) => {
  console.log('🧪 Test route accessed');
  try {
    const [tables] = await pool.query('SHOW TABLES');
    console.log('📋 Tables found:', tables);
    
    if (tables.some(t => Object.values(t).includes('authorized_users'))) {
      const [columns] = await pool.query('DESCRIBE authorized_users');
      console.log('📋 authorized_users columns:', columns);
      
      const [count] = await pool.query('SELECT COUNT(*) as count FROM authorized_users');
      console.log('📊 Row count:', count[0].count);
    }
    
    res.json({ success: true, tables, message: 'Check server logs for details' });
  } catch (error) {
    console.error('❌ Test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener todos los usuarios
router.get('/users', adminAuth, async (req, res) => {
  try {
    console.log('📋 Obteniendo usuarios...');
    
    // Seleccionar todas las columnas necesarias para el panel de administración
    const [rows] = await pool.query(`
      SELECT 
        id, 
        phone_number, 
        full_name, 
        company, 
        is_active, 
        search_limit,
        total_queries, 
        last_access, 
        ine_ocr_enabled,
        created_at,
        updated_at
      FROM authorized_users 
      ORDER BY created_at DESC
      LIMIT 50
    `);
    
    console.log(`✅ ${rows.length} usuarios encontrados`);
    res.json(rows);
  } catch (error) {
    console.error('❌ Error obteniendo usuarios:', error);
    console.error('❌ Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Error obteniendo usuarios',
      details: error.message,
      stack: error.stack
    });
  }
});

// Crear nuevo usuario
router.post('/users', adminAuth, async (req, res) => {
  try {
    const { phone_number, full_name, company, is_active, search_limit, ine_ocr_enabled } = req.body;
    
    if (!phone_number || !full_name) {
      return res.status(400).json({ error: 'Teléfono y nombre son requeridos' });
    }

    // Procesar search_limit: -1 para ilimitado, o valor numérico
    let processedSearchLimit = 100; // Default
    if (search_limit === 'unlimited' || search_limit === -1) {
      processedSearchLimit = -1;
    } else if (typeof search_limit === 'number' && search_limit > 0) {
      processedSearchLimit = search_limit;
    } else if (typeof search_limit === 'string' && !isNaN(search_limit)) {
      processedSearchLimit = parseInt(search_limit);
    }

    const [result] = await pool.query(
      'INSERT INTO authorized_users (phone_number, full_name, company, is_active, search_limit, ine_ocr_enabled) VALUES (?, ?, ?, ?, ?, ?)',
      [phone_number, full_name, company || null, is_active !== false, processedSearchLimit, ine_ocr_enabled || false]
    );
    
    res.json({ id: result.insertId, message: 'Usuario creado exitosamente' });
  } catch (error) {
    console.error('Error creando usuario:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'El número de teléfono ya existe' });
    } else {
      res.status(500).json({ error: 'Error creando usuario' });
    }
  }
});

// Actualizar usuario
router.put('/users/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { phone_number, full_name, company, is_active, search_limit, ine_ocr_enabled } = req.body;
    
    if (!phone_number || !full_name) {
      return res.status(400).json({ error: 'Teléfono y nombre son requeridos' });
    }

    // Procesar search_limit: -1 para ilimitado, o valor numérico
    let processedSearchLimit = 100; // Default
    if (search_limit === 'unlimited' || search_limit === -1) {
      processedSearchLimit = -1;
    } else if (typeof search_limit === 'number' && search_limit > 0) {
      processedSearchLimit = search_limit;
    } else if (typeof search_limit === 'string' && !isNaN(search_limit)) {
      processedSearchLimit = parseInt(search_limit);
    }

    const [result] = await pool.query(
      'UPDATE authorized_users SET phone_number = ?, full_name = ?, company = ?, is_active = ?, search_limit = ?, ine_ocr_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [phone_number, full_name, company || null, is_active !== false, processedSearchLimit, ine_ocr_enabled || false, id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json({ message: 'Usuario actualizado exitosamente' });
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      res.status(400).json({ error: 'El número de teléfono ya existe' });
    } else {
      res.status(500).json({ error: 'Error actualizando usuario' });
    }
  }
});

// Eliminar usuario
router.delete('/users/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const [result] = await pool.query('DELETE FROM authorized_users WHERE id = ?', [id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    res.json({ message: 'Usuario eliminado exitosamente' });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({ error: 'Error eliminando usuario' });
  }
});

// Obtener estadísticas
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const [totalUsers] = await pool.query('SELECT COUNT(*) as total FROM authorized_users');
    const [activeUsers] = await pool.query('SELECT COUNT(*) as active FROM authorized_users WHERE is_active = 1');
    const [recentUsers] = await pool.query(
      'SELECT COUNT(*) as recent FROM authorized_users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)'
    );
    
    res.json({
      totalUsers: totalUsers[0].total,
      activeUsers: activeUsers[0].active,
      recentUsers: recentUsers[0].recent,
      inactiveUsers: totalUsers[0].total - activeUsers[0].active
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ error: 'Error obteniendo estadísticas' });
  }
});

module.exports = router;