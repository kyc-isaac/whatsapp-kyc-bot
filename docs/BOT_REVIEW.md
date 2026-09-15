# Revisión y actualización del bot

Fecha: 15 de septiembre de 2026. Alcance: menús, flujos actuales, persistencia, recuperación, administración y monitoreo. Implementado localmente; publicación pendiente. Sustituye la revisión anterior del almacenamiento en memoria.

## Menús y flujos

| Pantalla | Acciones |
| --- | --- |
| Inicio | Buscar, consultas recientes, ayuda, cuenta y porcentaje |
| Tipo | Persona con apellidos separados, nombre completo, empresa, INE con permiso |
| Captura | Validación de nombres; `omitir` permite omitir un apellido |
| Confirmación | Ejecutar, corregir o cancelar; nunca consulta automáticamente |
| Resultado | Recuperar PDF, instrucciones para compartir, nueva consulta, inicio |
| Historial | Abrir una de las diez consultas recientes sin ejecutar otra búsqueda |
| Ayuda | Nueve temas con contenido propio y navegación de regreso |
| Error KYC | Reintentar datos, inicio o contacto; aviso de resultado incierto |
| Error INE | Repetir fotos, captura manual o inicio |
| Límite | Contacto o inicio; consumo persistente por día de CDMX |

Comandos globales: `menu`, `inicio`, `hola`, `cancelar`, `buscar`, `ayuda`, `info`, `listas`, `soporte`, `atras`/`atrás`/`0`, `P70`–`P100`. El porcentaje se conserva en la sesión. Se valida autorización en cada mensaje y permiso INE antes de descargar fotos. Persona física usa `persona: "1"`, incluido nombre completo/INE; empresa usa `"2"`, según el contrato local del proveedor.

## Métodos y responsabilidades

| Archivo / métodos | Comportamiento revisado |
| --- | --- |
| `bot-flow.js`: `handleMessage`, `dispatch`, `show`, `reset`, `back` | Estados y navegación contextual; autorización cerrada ante fallos; datos separados por usuario |
| `chooseType`, `checkLimit`, `runSearch`, `handleImage` | Confirmación real, cuotas, validación de imágenes/nombres, resultados e historial |
| `lib/repository.js`: `enqueue`, `nextJob`, `finishJob`, `failJob` | SID único, orden de mensajes y guardado transaccional de estado/respuestas |
| `executeSearch`, `executeEffect`, `quota`, `history` | Reservas atómicas, resultados recuperables KYC/OCR, estados inciertos y persistencia |
| `lib/worker.js`: `incoming`, `outgoing`, `tick` | Locks MySQL, recuperación, reintentos acotados y envío al proveedor |
| `lib/providers.js`: `search`, `download`, `readIne` | Contratos existentes, límites de tamaño/tiempo y descarga autenticada Twilio |
| `lib/reports.js`: `save`, `serve`, `cleanup` | PDF válido, cifrado privado, UUID, firma, vencimiento, revocación y limpieza |
| `lib/admin-security.js` | bcrypt, sesiones MySQL cifradas, CSRF, límites de login, roles e invalidación de sesiones |
| `admin-routes.js` | Usuarios paginados y búsqueda global, cuotas, cuentas, reportes, incidentes, recuperación y auditoría |
| `lib/monitor.js`: `tick`, `snapshot` | Dependencias, diagnósticos con timeout, alertas y recuperación en logs locales |
| `server.js`: `createApp`, webhooks, `cleanup` | Firma Twilio, acuse tras persistir, rutas protegidas y ciclo de vida |
| `authService.js`, `user-validation.js` | Teléfono normalizado, permisos, bloqueo de insistencia y validación compartida |
| `enhanced-menus.js` | Textos acordes con funciones reales, sin progreso ficticio |

`interactive-menu.js` permanece como prototipo inactivo. No ofrece botones interactivos ni soporte humano real. Los scripts antiguos de usuarios de prueba y corrección de teléfonos siguen siendo utilidades manuales; no se ejecutaron sobre datos de la aplicación.

## Administración y monitoreo

El panel conserva la gestión de usuarios y añade **Operación del bot**: salud, incidentes, trabajos fallidos, entrega de respuestas, consultas inciertas, revocación de reportes y cuentas individuales. Los usuarios se consultan en páginas de 25, con búsqueda en toda la base.

Las alertas se guardan únicamente en logs del servidor y en el panel, por decisión del usuario. La comprobación KYC usa un diagnóstico GET sin consumir búsquedas; sus límites están documentados en [OPERATIONS.md](OPERATIONS.md).

## Validación y publicación

- `npm test`: 29 pruebas de conversación y seguridad.
- `npm run test:integration`: 25 pruebas con MySQL real temporal y HTTP; proveedores simulados. Incluye reinicios, rollback transaccional, última cuota disponible, OCR interrumpido, callbacks tardíos, PDF revocado, permisos, límites de login y más de 50 usuarios.
- Panel comprobado en Chrome con respuestas simuladas: paginación/búsqueda, recuperación, revocación y creación de administrador con CSRF. Sin errores JavaScript en esos recorridos.

No se enviaron mensajes reales ni se modificó producción. Se requieren migración, variables de cifrado y cambios Nginx: sus antiguos alias PDF y su respuesta fija de salud anulaban las protecciones/diagnósticos de Express. Consultar [OPERATIONS.md](OPERATIONS.md) para publicación, conservación y límites de recuperación.

Referencias: [firmas Twilio](https://www.twilio.com/docs/usage/tutorials/how-to-secure-your-express-app-by-validating-incoming-twilio-requests), [seguimiento de entrega](https://www.twilio.com/docs/messaging/guides/track-outbound-message-status), contratos locales `API_DOCUMENTATION.md` y `API_DOCUMENTATION KYC VALIDACION.md`.
