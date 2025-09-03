# 🚀 Guía Completa: Migración a WhatsApp Business API en Producción

## 📋 Resumen Ejecutivo

Esta guía detalla el proceso completo para migrar del Sandbox de Twilio a WhatsApp Business API con número propio, incluyendo todos los pasos técnicos, configuraciones y verificaciones necesarias.

**Estado Actual:**
- ✅ Bot funcionando en Sandbox de Twilio
- ✅ Número de teléfono comprado en Twilio
- ✅ Cuenta de Twilio verificada con documentación
- ✅ Sistema desplegado en producción (EC2 + nginx + MySQL)

---

## 🎯 Fase 1: Preparación del Número WhatsApp Business

### Paso 1.1: Verificar Requisitos del Número

**En Twilio Console:**
```
https://console.twilio.com/us1/develop/phone-numbers/manage/incoming
```

**Verificar que tu número tenga:**
- ✅ SMS capability (obligatorio)
- ✅ Voice capability (recomendado)
- ✅ Status: Active

### Paso 1.2: Preparar Documentación de la Empresa

**Documentos necesarios:**
1. **Nombre de la empresa:** KYC SYSTEMS (o tu razón social)
2. **Sitio web:** https://kyc-bots.com
3. **Dirección de la empresa:** Dirección física verificable
4. **Descripción del negocio:** 
   ```
   Sistema automatizado de verificación de cumplimiento KYC 
   que permite consultar listas restrictivas (OFAC, DEA, SAT, PEP) 
   a través de WhatsApp para instituciones financieras.
   ```
5. **Caso de uso:**
   ```
   Notificaciones y consultas de compliance para verificación 
   de identidad en procesos KYC/AML.
   ```

### Paso 1.3: Crear Perfil de WhatsApp Business

1. **Ir a Twilio Console → Messaging → Try it out → WhatsApp → Senders**
2. **Click en "WhatsApp Business Profile"**
3. **Completar información:**
   - Business Display Name: KYC SYSTEMS
   - Business Category: Financial Services
   - Business Description: (usar la descripción del paso anterior)
   - Address: Tu dirección verificada
   - Email: contacto@kyc-bots.com
   - Website: https://kyc-bots.com

---

## 📱 Fase 2: Solicitar Activación de WhatsApp Business

### Paso 2.1: Iniciar Solicitud en Twilio

1. **Navegar a:** 
   ```
   https://console.twilio.com/us1/develop/sms/manage/whatsapp-senders
   ```

2. **Click en "Request to enable a Twilio phone number for WhatsApp"**

3. **Seleccionar tu número comprado**

4. **Completar el formulario de solicitud:**
   - Phone Number: Tu número de Twilio
   - Facebook Business Manager ID: (se crea automáticamente si no tienes)
   - Use Case: Transactional + Customer Support
   - Expected Message Volume: 1000-10000 mensajes/mes

### Paso 2.2: Configurar Facebook Business Manager

**Si no tienes Facebook Business Manager:**

1. Twilio creará uno automáticamente
2. Recibirás un email de Meta para confirmar
3. Acepta los términos y condiciones de WhatsApp Business

**Si ya tienes Facebook Business Manager:**

1. Agregar Twilio como partner:
   - Business Settings → Partners → Add Partner
   - Partner Business ID: `208023824935506` (Twilio's ID)
   - Dar permisos de WhatsApp Business Account

### Paso 2.3: Verificación de Facebook Business

**Proceso de verificación (3-5 días):**

1. **Meta revisará:**
   - Documentación de la empresa
   - Sitio web activo
   - Políticas de privacidad
   - Términos de servicio

2. **Posibles solicitudes adicionales:**
   - Documento de incorporación
   - Comprobante de domicilio
   - Carta poder si aplica

---

## 🛠️ Fase 3: Configuración Técnica

### Paso 3.1: Mientras Esperas la Aprobación

**Crear páginas web requeridas:**

```bash
# En tu servidor de producción
cd /var/www/kyc-bots.com
mkdir -p public
```

**Crear archivo: `public/privacy.html`**
```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Política de Privacidad - KYC SYSTEMS</title>
</head>
<body>
    <h1>Política de Privacidad</h1>
    <h2>1. Recolección de Datos</h2>
    <p>KYC SYSTEMS recolecta únicamente el número de teléfono y nombre 
    proporcionados para realizar consultas de compliance.</p>
    
    <h2>2. Uso de Datos</h2>
    <p>Los datos son utilizados exclusivamente para:</p>
    <ul>
        <li>Verificación de identidad en listas de compliance</li>
        <li>Generación de reportes KYC</li>
        <li>Comunicación relacionada con el servicio</li>
    </ul>
    
    <h2>3. Protección de Datos</h2>
    <p>Implementamos encriptación SSL y cumplimos con GDPR y LFPDPPP.</p>
    
    <h2>4. Retención de Datos</h2>
    <p>Los datos se retienen por 90 días para auditoría.</p>
    
    <h2>5. Contacto</h2>
    <p>Para dudas sobre privacidad: privacidad@kyc-bots.com</p>
</body>
</html>
```

**Crear archivo: `public/terms.html`**
```html
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <title>Términos de Servicio - KYC SYSTEMS</title>
</head>
<body>
    <h1>Términos y Condiciones de Uso</h1>
    
    <h2>1. Aceptación de Términos</h2>
    <p>Al usar este servicio, acepta estos términos y condiciones.</p>
    
    <h2>2. Descripción del Servicio</h2>
    <p>KYC SYSTEMS proporciona consultas automatizadas de listas de 
    compliance a través de WhatsApp para verificación KYC/AML.</p>
    
    <h2>3. Uso Apropiado</h2>
    <ul>
        <li>El servicio es solo para instituciones autorizadas</li>
        <li>Prohibido el uso para discriminación o acoso</li>
        <li>Los resultados son informativos, no definitivos</li>
    </ul>
    
    <h2>4. Limitación de Responsabilidad</h2>
    <p>KYC SYSTEMS no es responsable por decisiones tomadas 
    basadas en los reportes generados.</p>
    
    <h2>5. Modificaciones</h2>
    <p>Nos reservamos el derecho de modificar estos términos.</p>
    
    <p>Última actualización: Agosto 2025</p>
</body>
</html>
```

**Actualizar nginx para servir las páginas:**
```nginx
# Agregar en tu configuración nginx
location /privacy {
    alias /var/www/kyc-bots.com/public/privacy.html;
}

location /terms {
    alias /var/www/kyc-bots.com/public/terms.html;
}
```

### Paso 3.2: Configurar Webhook para Producción

**Una vez aprobado el número:**

1. **En Twilio Console → WhatsApp Senders → Tu número**
2. **Configurar Webhook URL:**
   - When a message comes in: `https://kyc-bots.com/webhook`
   - Method: POST
   - Status Callback URL: `https://kyc-bots.com/webhook/status` (opcional)

---

## 🔄 Fase 4: Migración del Sistema

### Paso 4.1: Actualizar Variables de Entorno

```bash
# En tu servidor de producción
cd /var/www/kyc-bots.com
nano .env
```

**Actualizar:**
```env
# ANTES (Sandbox)
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# DESPUÉS (Tu número de producción)
TWILIO_WHATSAPP_NUMBER=whatsapp:+521XXXXXXXXX
```

### Paso 4.2: Actualizar el Código (si es necesario)

**Verificar que el código no tenga referencias hardcodeadas al sandbox:**

```bash
# Buscar referencias al número sandbox
grep -r "14155238886" .
grep -r "parent-tone" .
```

### Paso 4.3: Configurar Plantillas de Mensaje (Templates)

**En Twilio Console → WhatsApp Templates:**

1. **Crear template de bienvenida:**
```
Nombre: welcome_message
Categoría: UTILITY
Contenido:
Hola {{1}}, bienvenido al sistema KYC-LISTAS de {{2}}.
Para iniciar una consulta, responde con "Consultar".
```

2. **Crear template de notificación:**
```
Nombre: report_ready
Categoría: TRANSACTIONAL
Contenido:
{{1}}, tu reporte KYC está listo.
Se encontraron {{2}} coincidencias.
Responde "Descargar" para recibir el PDF.
```

### Paso 4.4: Reiniciar la Aplicación

```bash
# Reiniciar con los nuevos valores
pm2 restart kyc-whatsapp-bot

# Verificar logs
pm2 logs kyc-whatsapp-bot --lines 50

# Verificar que el número cambió
grep "TWILIO_WHATSAPP_NUMBER" .env
```

---

## ✅ Fase 5: Pruebas y Validación

### Paso 5.1: Pruebas Iniciales

1. **Agregar tu número como tester en Twilio**
2. **Enviar mensaje de prueba al número nuevo**
3. **Verificar logs:**
   ```bash
   pm2 logs kyc-whatsapp-bot --lines 0
   ```

### Paso 5.2: Lista de Verificación

**Funcionalidades a probar:**
- [ ] Mensaje de bienvenida personalizado
- [ ] Búsqueda de persona física
- [ ] Búsqueda de empresa
- [ ] Generación de PDF
- [ ] Envío de PDF por WhatsApp
- [ ] Sistema de autorización
- [ ] Bloqueo de usuarios no autorizados
- [ ] Anti-spam (5 intentos)

### Paso 5.3: Monitoreo Post-Migración

```bash
# Dashboard de monitoreo
pm2 monit

# Logs de nginx
tail -f /var/log/nginx/kyc-bots.access.log

# Estado de MySQL
mysql -u kycbots_user -p -e "SELECT COUNT(*) FROM kyc_bots.authorized_users;"

# Health check
curl https://kyc-bots.com/health
```

---

## 🎨 Fase 6: Personalización de WhatsApp Business

### Paso 6.1: Configurar Perfil de Negocio

**En Facebook Business Manager → WhatsApp Manager:**

1. **Subir logo de la empresa** (mínimo 640x640px)
2. **Configurar horario de atención**
3. **Agregar categorías de negocio**
4. **Configurar mensaje de ausencia**

### Paso 6.2: Configurar Respuestas Rápidas

```javascript
// Agregar en server.js para botones interactivos
const interactiveMessage = {
  type: "interactive",
  interactive: {
    type: "button",
    body: {
      text: "Selecciona una opción:"
    },
    action: {
      buttons: [
        {
          type: "reply",
          reply: {
            id: "search_person",
            title: "Buscar Persona"
          }
        },
        {
          type: "reply",
          reply: {
            id: "search_company",
            title: "Buscar Empresa"
          }
        }
      ]
    }
  }
};
```

---

## 📊 Fase 7: Analytics y Optimización

### Paso 7.1: Configurar Analytics

**En Twilio Console → Monitor → Logs:**
- Configurar alertas para errores
- Crear dashboard personalizado
- Exportar métricas mensuales

### Paso 7.2: Métricas a Monitorear

```sql
-- Queries útiles para reportes
-- Usuarios más activos
SELECT 
  full_name,
  company,
  total_queries,
  last_access
FROM authorized_users 
ORDER BY total_queries DESC 
LIMIT 10;

-- Actividad por día
SELECT 
  DATE(last_access) as fecha,
  COUNT(*) as usuarios_activos
FROM authorized_users 
WHERE last_access >= DATE_SUB(NOW(), INTERVAL 30 DAY)
GROUP BY DATE(last_access);

-- Intentos bloqueados
SELECT 
  DATE(attempt_time) as fecha,
  COUNT(*) as intentos_bloqueados
FROM blocked_attempts 
WHERE attempt_time >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY DATE(attempt_time);
```

---

## 🚨 Troubleshooting Común

### Problema: "Number not approved for WhatsApp"
**Solución:** Verificar estado de aprobación en Twilio Console → WhatsApp Senders

### Problema: "Template not approved"
**Solución:** Las plantillas tardan 24h en aprobarse, usar mensaje directo mientras tanto

### Problema: "User has not accepted terms"
**Solución:** El usuario debe iniciar la conversación primero

### Problema: "Rate limit exceeded"
**Solución:** WhatsApp Business tiene límites por tier:
- Tier 1: 1,000 usuarios únicos/día
- Tier 2: 10,000 usuarios únicos/día
- Tier 3: 100,000 usuarios únicos/día

---

## 📝 Checklist Final de Migración

### Pre-Producción:
- [ ] Número comprado con SMS+Voice
- [ ] Documentación de empresa lista
- [ ] Sitio web con privacy/terms activo
- [ ] Base de datos con usuarios migrados
- [ ] Backup del sistema actual

### Durante la Migración:
- [ ] WhatsApp Business aprobado
- [ ] Webhook configurado
- [ ] Variables .env actualizadas
- [ ] Templates creados y aprobados
- [ ] Logo y perfil configurados

### Post-Migración:
- [ ] Pruebas completas realizadas
- [ ] Monitoreo activo
- [ ] Usuarios notificados del cambio
- [ ] Analytics configurado
- [ ] Documentación actualizada

---

## 📞 Soporte y Recursos

**Recursos de Twilio:**
- WhatsApp Business API Docs: https://www.twilio.com/docs/whatsapp
- Twilio Status: https://status.twilio.com
- Support: support@twilio.com

**Recursos de Meta:**
- WhatsApp Business Platform: https://developers.facebook.com/docs/whatsapp
- Business Manager: https://business.facebook.com

**Tu Sistema:**
- Logs: `pm2 logs kyc-whatsapp-bot`
- Health: https://kyc-bots.com/health
- Base de datos: `mysql -u kycbots_user -p kyc_bots`

---

## 🎯 Siguientes Pasos Después de la Migración

1. **Semana 1:** Monitoreo intensivo, ajustes menores
2. **Semana 2:** Optimización de templates, análisis de uso
3. **Mes 1:** Reporte de métricas, plan de escalamiento
4. **Mes 2:** Implementar funciones avanzadas (listas, catálogos)
5. **Mes 3:** Evaluación para aumentar tier si es necesario

---

**Documentación creada:** Agosto 2025
**Sistema:** WhatsApp KYC Bot
**Versión:** 2.0 (Producción con WhatsApp Business)
**Desarrollado con:** Claude Code (claude.ai/code)