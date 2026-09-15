# Operación y publicación

## Preparación

Esta versión añade persistencia MySQL y almacenamiento privado. Requiere publicar el código, ejecutar la migración y actualizar Nginx juntos. Los cambios preparados el 15 de septiembre de 2026 son locales.

1. Respaldar base, código anterior, Nginx y `.env` vigente. Conservar las credenciales Twilio corregidas en producción.
2. Consultar [`.env.example`](../.env.example); no sustituir el archivo de producción por el ejemplo. `SERVER_URL` debe ser el origen HTTPS exacto utilizado en Twilio, sin ruta adicional.
3. Generar secretos independientes con `openssl rand -hex 32`. Respaldar `DATA_ENCRYPTION_KEY` separado de los datos: cambiarla impide descifrar sesiones, consultas, trabajos y PDF existentes. Si se omite, se usa `SESSION_SECRET`, que tampoco debe rotarse sin migrar los datos. Cambiar `REPORT_SIGNING_KEY` invalida enlaces ya enviados.
4. Instalar con `npm ci`. Ejecutar `npm run migrate` contra la base configurada. La migración es repetible: crea tablas InnoDB y agrega columnas ausentes de permisos/límites; no borra usuarios ni recalcula contadores anteriores. Requiere permisos CREATE y ALTER.
5. Si no hay administradores, la migración importa `ADMIN_USER`/`ADMIN_PASS` como propietario con hash bcrypt. Configurarlos para una instalación nueva. Verificar acceso, cambiar contraseña en el panel y retirar `ADMIN_PASS` del entorno y de PM2. Las siguientes migraciones no restablecen contraseñas.
6. Dar al usuario de PM2 permiso para crear/escribir `private/reports/`. Respaldar ese directorio cifrado junto con la base. No publicarlo mediante alias de Nginx.

Verificar que `authorized_users` use InnoDB y que MySQL admita `max_allowed_packet` de al menos 64 MB para resultados PDF e imágenes cifradas. Las fechas nuevas se guardan en UTC; el consumo diario usa CDMX.

## Proxy, arranque y comprobaciones

Adaptar [nginx-simple.conf](../nginx-simple.conf) o [nginx-production.conf](../nginx-production.conf). La segunda variante requiere la zona `webhook` de rate limiting ya definida en el bloque `http`.

- Eliminar **todos** los alias previos que sirvan `/temp` o `/pdfs`; esas rutas deben responder 410.
- `/reports/` debe pasar a Express y omitir el access log para no guardar firmas de descarga.
- `/health` debe pasar a Express. Retirar cualquier `return 200 "healthy"` anterior.
- Conservar HTTPS y encabezados de proxy. El proceso confía en proxies loopback; ajustar esa confianza si la topología es diferente.

Después de aplicar archivos y migración en una publicación autorizada:

```sh
sudo nginx -t
sudo systemctl reload nginx
pm2 restart kyc-whatsapp-bot --update-env
pm2 logs kyc-whatsapp-bot --lines 100
curl -i https://kyc-bots.com/health
```

PM2 debe conceder tiempo para finalizar solicitudes en curso; se recomienda `kill_timeout: 60000`. Un cierre forzado también se recupera, pero una llamada interrumpida puede quedar incierta.

Confirmar ingreso al panel, persona, empresa, INE y descarga/revocación de PDF con usuarios de prueba. Esas comprobaciones con proveedores reales consumen servicios y no forman parte de las pruebas automatizadas locales.

## Monitoreo y logs

`/live` confirma que Express responde. `/health` devuelve 200 si los últimos controles están bien; 503 al iniciar, ante fallos o diagnóstico desactualizado. PM2 `online` no confirma que WhatsApp pueda responder.

Cada minuto se comprueban MySQL, DNS, TLS (aviso a menos de 14 días), cuenta Twilio activa, HTTP público, endpoint KYC y actividad del worker/cola. Por defecto KYC usa `GET <KYC_API_URL>/search-multiple/stats`: confirma disponibilidad HTTP, **no certifica saldo, todas las listas, OCR ni validez de una clave si el endpoint no la exige**. `KYC_HEALTH_URL` permite elegir otro diagnóstico GET sin ejecutar búsquedas.

Los incidentes aparecen en **Operación del bot** y en logs locales como `ALERTA`; se repiten como máximo cada hora mientras persistan. La recuperación registra `RECUPERADO`. No hay correo, WhatsApp ni webhooks de alerta. Configurar rotación de logs de PM2/Nginx en el servidor; la aplicación no instala extensiones de PM2.

## Recuperación

- Se valida la firma Twilio y se guarda el SID único antes del acuse XML. Si MySQL falla, se devuelve 503. Los duplicados no crean otro trabajo.
- Sesiones, historial, reservas diarias, resultados intermedios KYC/OCR y respuestas pendientes sobreviven a reinicios. El consumo usa el día de Ciudad de México.
- Los trabajos reintentan hasta cinco veces con espera progresiva y orden por usuario. Un fallo definitivo detiene los siguientes mensajes de ese usuario. El propietario puede **Recuperar** o **Descartar** el mensaje después de corregir el problema.
- Una consulta/lectura que pudo ejecutarse sin guardar respuesta queda **incierta**. Revisar el proveedor antes de iniciar otra consulta. Una reserva KYC incierta permanece consumida para evitar duplicaciones de uso.
- Los envíos guardan SID y callbacks. Un rechazo confirmado sin SID admite reintento manual; un envío incierto no se reenvía automáticamente. Los callbacks tardíos pueden resolverlo. Errores 429 admiten reintentos acotados.
- Trabajos y respuestas pendientes de más de 23 horas no se ejecutan/envían automáticamente. Solicitar un mensaje nuevo al usuario.

No hay garantía de ejecución única entre MySQL y un servicio remoto sin idempotencia del proveedor. Los estados inciertos evitan repetir operaciones a ciegas.

El worker procesa una entrada y una salida a la vez con locks globales MySQL. Una consulta lenta demora entradas de otros usuarios; la cola mantiene sus mensajes y alerta si la espera supera cinco minutos.

## Datos y permisos

Las sesiones vencen a las seis horas; el historial ofrece diez consultas recientes guardadas. Sesiones, consultas, payloads y PDF usan AES-256-GCM; teléfonos e índices operativos permanecen en columnas consultables.

Los enlaces PDF vencen a las 24 horas y admiten revocación inmediata. Cualquiera que reciba un enlace vigente puede descargarlo. La limpieza horaria elimina archivos vencidos/revocados y huérfanos antiguos. Las rutas públicas anteriores dejan de funcionar; no se migra su contenido.

`HISTORY_RETENTION_DAYS` controla limpieza de registros completados, eventos, auditoría e intentos bloqueados (90 días por defecto). Los casos pendientes/inciertos se conservan para revisión. No se reconstruye el historial anterior en memoria. El contador histórico previo puede incluir mensajes por el comportamiento antiguo.

Cada administrador tiene cuenta individual. `admin` gestiona usuarios, límites y reportes; `owner` además gestiona cuentas y recuperación. Cambiar contraseña o desactivar una cuenta invalida sesiones. Se exige CSRF, se limitan intentos de login en MySQL y se protege al último propietario activo.

## Validación local

```sh
npm test
npm run test:integration
```

La primera suite usa `node:test` sin servicios externos. La segunda requiere MySQL local con permisos para crear/eliminar una base temporal. Configurar `TEST_DB_*` en `.env.test.local` (ignorado por Git). El runner crea `kyc_bot_test_<aleatorio>` y elimina únicamente esa base al terminar. Twilio, KYC y OCR se simulan; HTTP, firmas y transacciones MySQL son reales. No apuntar las pruebas a producción.
