// Script para verificar y limpiar intentos bloqueados
const { pool } = require('./database');

async function checkBlocked() {
  try {
    console.log('🔍 Verificando intentos bloqueados...\n');

    // Ver intentos recientes
    const [attempts] = await pool.execute(
      `SELECT phone_number, COUNT(*) as attempts, MAX(attempt_time) as last_attempt
       FROM blocked_attempts 
       WHERE attempt_time > DATE_SUB(NOW(), INTERVAL 1 HOUR)
       GROUP BY phone_number`
    );

    if (attempts.length > 0) {
      console.log('📊 Intentos en la última hora:');
      attempts.forEach(row => {
        console.log(`  📱 ${row.phone_number}: ${row.attempts} intentos (último: ${row.last_attempt})`);
      });

      // Preguntar si limpiar
      console.log('\n🧹 Limpiando intentos bloqueados para resetear el sistema...');
      
      // Limpiar intentos de la última hora
      const [result] = await pool.execute(
        'DELETE FROM blocked_attempts WHERE attempt_time > DATE_SUB(NOW(), INTERVAL 2 HOUR)'
      );
      
      console.log(`✅ ${result.affectedRows} intentos eliminados\n`);
    } else {
      console.log('✅ No hay intentos bloqueados recientes\n');
    }

    // Verificar usuarios autorizados
    console.log('📱 Usuarios autorizados activos:');
    const [users] = await pool.execute(
      'SELECT phone_number, full_name, company FROM authorized_users WHERE is_active = TRUE'
    );
    
    users.forEach(user => {
      console.log(`  ✅ ${user.phone_number} - ${user.full_name} (${user.company || 'Sin empresa'})`);
    });

    // Verificar específicamente tu número
    console.log('\n🔍 Verificando tu número específico: +525544426599');
    const [yourNumber] = await pool.execute(
      'SELECT * FROM authorized_users WHERE phone_number = "+525544426599"'
    );
    
    if (yourNumber.length > 0) {
      console.log('✅ Tu número está autorizado correctamente');
      console.log(`   Nombre: ${yourNumber[0].full_name}`);
      console.log(`   Empresa: ${yourNumber[0].company || 'Sin empresa'}`);
      console.log(`   Activo: ${yourNumber[0].is_active ? 'SÍ' : 'NO'}`);
    } else {
      console.log('❌ Tu número NO está en la base de datos');
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkBlocked();