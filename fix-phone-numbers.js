// Script para corregir el formato de números telefónicos
const { pool } = require('./database');

async function fixPhoneNumbers() {
  try {
    console.log('🔧 Corrigiendo formato de números telefónicos...\n');

    // Actualizar el número principal (quitar el 1 después del 52)
    const updates = [
      {
        old: '+5215544426599',
        new: '+525544426599'
      },
      {
        old: '+5215512345678',
        new: '+525512345678'
      },
      {
        old: '+5215598765432',
        new: '+525598765432'
      }
    ];

    for (const update of updates) {
      try {
        // Primero intentar actualizar
        const [result] = await pool.execute(
          'UPDATE authorized_users SET phone_number = ? WHERE phone_number = ?',
          [update.new, update.old]
        );
        
        if (result.affectedRows > 0) {
          console.log(`✅ Actualizado: ${update.old} → ${update.new}`);
        } else {
          console.log(`ℹ️ No se encontró: ${update.old}`);
        }
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
          console.log(`⚠️ El número ${update.new} ya existe`);
        } else {
          console.error(`❌ Error actualizando ${update.old}:`, error.message);
        }
      }
    }

    console.log('\n📋 Números actualizados en la base de datos:');
    
    // Mostrar todos los números actuales
    const [rows] = await pool.execute('SELECT phone_number, full_name FROM authorized_users WHERE is_active = TRUE');
    
    rows.forEach(row => {
      console.log(`  ✅ ${row.phone_number} - ${row.full_name}`);
    });

    console.log('\n✅ Corrección completada');
    console.log('\n📱 Formato correcto para México: +52 (sin el 1)');
    
    process.exit(0);
  } catch (error) {
    console.error('Error general:', error);
    process.exit(1);
  }
}

fixPhoneNumbers();