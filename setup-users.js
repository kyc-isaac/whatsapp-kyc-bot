// Script para agregar usuarios de prueba a la base de datos
const { pool } = require('./database');

async function setupTestUsers() {
  try {
    // Usuario autorizado - TU NÚMERO
    const users = [
      {
        phone_number: '+5215544426599', // Tu número actual
        full_name: 'Isaac Usuario Principal',
        company: 'Empresa Demo S.A. de C.V.'
      },
      {
        phone_number: '+5215512345678', // Número de prueba autorizado
        full_name: 'Juan Pérez García',
        company: 'Constructora ABC'
      },
      {
        phone_number: '+5215598765432', // Otro número autorizado
        full_name: 'María López Hernández',
        company: 'Servicios Financieros XYZ'
      }
    ];

    console.log('📋 Agregando usuarios de prueba...\n');

    for (const user of users) {
      try {
        await pool.execute(
          'INSERT INTO authorized_users (phone_number, full_name, company) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), company = VALUES(company)',
          [user.phone_number, user.full_name, user.company]
        );
        console.log(`✅ Usuario agregado/actualizado: ${user.full_name} (${user.phone_number})`);
      } catch (error) {
        console.error(`❌ Error con usuario ${user.phone_number}:`, error.message);
      }
    }

    console.log('\n✅ Usuarios de prueba configurados correctamente');
    console.log('\n📱 Números autorizados:');
    console.log('  - +5215544426599 (Tu número actual)');
    console.log('  - +5215512345678 (Prueba autorizado)');
    console.log('  - +5215598765432 (Prueba autorizado)');
    console.log('\n❌ Cualquier otro número será rechazado');

    process.exit(0);
  } catch (error) {
    console.error('Error general:', error);
    process.exit(1);
  }
}

setupTestUsers();