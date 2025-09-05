# Documentación API KYC Validación

## Descripción General
API RESTful para servicios de validación KYC (Know Your Customer) especializada en validación de documentos mexicanos y colombianos, incluyendo CURP, RFC, INE, NSS, IMSS, y reconocimiento facial.

## Información Base

### URL Base
- **Producción**: `https://kyc-validacion.com/app/api/`
- **Desarrollo**: `http://localhost/kyc-validacion/api/`

### Autenticación
Todos los endpoints requieren autenticación mediante API Key.

**Header Requerido:**
```
X-API-KEY: tu_api_key_aqui
```

### Límite de Consultas
- Cada API key tiene un límite de consultas configurado
- Si se excede el límite, se retornará un error 400
- El conteo de peticiones se rastrea por API key, método y fecha

### Formato de Respuesta
- Todas las respuestas son en formato JSON
- Códigos de estado HTTP estándar (200 para éxito, 400 para errores)
- Los errores incluyen mensaje descriptivo y detalles de validación

## Endpoints Disponibles

### 1. Validación de CURP
Valida un CURP y opcionalmente genera un documento PDF.

**Endpoint:** `POST /valida_curp`

**Body Parameters:**
```json
{
    "curp": "CURP de 18 caracteres",
    "documento": "1 para generar PDF, 0 para no generar"
}
```

**Respuesta Exitosa (200):**
```json
{
    "codigoMensaje": "0",
    "nombre": "NOMBRE",
    "apellidoPaterno": "APELLIDO",
    "apellidoMaterno": "APELLIDO",
    "fechaNacimiento": "DD/MM/AAAA",
    "sexo": "H/M",
    "datosDocProbatorio": {
        "claveEntidadRegistro": 9,
        "claveMunicipioRegistro": 1,
        "municipioRegistro": "Nombre del Municipio"
    },
    "documento": "http://kyc-systems.s3.us-east-2.amazonaws.com/kyc-validacion/curp/CURP.pdf"
}
```

### 2. Obtener CURP por Datos Personales
Obtiene el CURP basándose en datos personales.

**Endpoint:** `POST /obtener_curp`

**Body Parameters:**
```json
{
    "nombre": "Nombre(s)",
    "primerApellido": "Primer apellido",
    "segundoApellido": "Segundo apellido",
    "fechaNacimiento": "DD/MM/AAAA",
    "entidad": "Clave de entidad (2 caracteres)",
    "sexo": "H o M",
    "documento": "1 para generar PDF, 0 para no generar"
}
```

### 3. OCR de INE/IFE (México)
Extrae información de una identificación oficial mexicana usando OCR.

**Endpoint:** `POST /obtener_datos_id`

**Body Parameters:**
```json
{
    "id": "Imagen frontal del INE en base64",
    "idReverso": "Imagen reverso del INE en base64"
}
```

**Respuesta Exitosa (200):**
```json
{
    "nombre": "Nombre completo",
    "domicilio": "Dirección",
    "claveElector": "Clave de elector",
    "curp": "CURP",
    "fechaNacimiento": "DD/MM/AAAA",
    "sexo": "H/M",
    "vigencia": "AAAA",
    "registro": "AAAA",
    "seccion": "####",
    "cic": "CIC",
    "identificadorCiudadano": "Identificador"
}
```

### 4. Reconocimiento Facial (México)
Compara una selfie con la foto del INE para validación biométrica.

**Endpoint:** `POST /reconocimiento_facial`

**Body Parameters:**
```json
{
    "credencial": "Imagen frontal del INE en base64",
    "captura": "Selfie en base64"
}
```

**Respuesta Exitosa (200):**
```json
{
    "match": true,
    "similarity": 95.5,
    "message": "Las imágenes coinciden"
}
```

### 5. Validación de INE
Valida la autenticidad de una credencial INE usando CIC e identificador ciudadano.

**Endpoint:** `POST /valida_ine`

**Body Parameters:**
```json
{
    "cic": "CIC del INE",
    "identificadorCiudadano": "Identificador ciudadano del INE"
}
```

### 6. Validación de RFC
Valida un RFC con el SAT.

**Endpoint:** `POST /valida_rfc`

**Body Parameters:**
```json
{
    "rfc": "RFC de 12 o 13 caracteres"
}
```

**Respuesta Exitosa (200):**
```json
{
    "valid": true,
    "rfc": "RFC",
    "nombre": "Nombre o razón social",
    "situacionFiscal": "Activo",
    "fechaInicio": "DD/MM/AAAA"
}
```

### 7. Obtener Nombre por RFC
Obtiene el nombre asociado a un RFC.

**Endpoint:** `POST /obtiene_nombre_por_rfc`

**Body Parameters:**
```json
{
    "rfc": "RFC de 12 o 13 caracteres"
}
```

### 8. Obtener NSS por CURP
Obtiene el Número de Seguridad Social asociado a un CURP.

**Endpoint:** `POST /obtiene_nss`

**Body Parameters:**
```json
{
    "curp": "CURP de 18 caracteres"
}
```

### 9. Obtener Historial IMSS
Obtiene el historial laboral del IMSS.

**Endpoint:** `POST /obtiene_historial_imss`

**Body Parameters:**
```json
{
    "curp": "CURP de 18 caracteres",
    "nss": "Número de Seguridad Social"
}
```

### 10. Consultar CIF
Consulta la Cédula de Identificación Fiscal.

**Endpoint:** `POST /consultar_cif`

**Body Parameters:**
```json
{
    "cif": "Cédula de Identificación Fiscal",
    "rfc": "RFC",
    "tipo": "datos"
}
```

### 11. Obtener CIF
Obtiene información del CIF con opciones adicionales.

**Endpoint:** `POST /obtiene_cif`

**Body Parameters:**
```json
{
    "tipo": "Tipo de consulta",
    "rfc": "RFC",
    "cif": "CIF"
}
```

### 12. Obtener RFC desde CURP
Valida CURP y obtiene el RFC asociado.

**Endpoint:** `POST /get_rfc_from_curp`

**Body Parameters:**
```json
{
    "curp": "CURP de 18 caracteres",
    "documento": "1 para generar PDF, 0 para no generar"
}
```

**Respuesta Exitosa (200):**
```json
{
    "codigoMensaje": "0",
    "nombre": "NOMBRE",
    "apellidoPaterno": "APELLIDO",
    "apellidoMaterno": "APELLIDO",
    "fechaNacimiento": "DD/MM/AAAA",
    "rfc": "RFC generado"
}
```

### 13. Comparación Facial Avanzada
Realiza comparación facial con opciones de configuración adicionales.

**Endpoint:** `POST /comparacion_facial`

**Body Parameters:**
```json
{
    "id": "Imagen frontal del INE en base64",
    "face": "Foto selfie o video en base64",
    "media": "Tipo de media (foto/video)"
}
```

**Nota:** Este endpoint usa un threshold interno de 80% para la comparación.

## Endpoints para Colombia

### 14. Validar Estado de Cédula Colombiana
Verifica el estado de una cédula de ciudadanía colombiana.

**Endpoint:** `POST /get_status_colombian_id`

**Body Parameters:**
```json
{
    "numeroIdentificacion": "Número de identificación",
    "fechaExpedicion": "Fecha de expedición"
}
```

### 15. OCR de Cédula Colombiana
Extrae información de una cédula colombiana usando OCR.

**Endpoint:** `POST /get_ocr_colombian_id`

**Body Parameters:**
```json
{
    "id": "Imagen frontal de la cédula en base64",
    "idReverso": "Imagen reverso de la cédula en base64"
}
```

### 16. Reconocimiento Facial (Colombia)
Compara una selfie con la foto de la cédula colombiana.

**Endpoint:** `POST /facial_recognition_id`

**Body Parameters:**
```json
{
    "credencial": "Imagen frontal de la cédula en base64",
    "captura": "Selfie en base64"
}
```

### 17. Validación de Cédula Profesional
Valida una cédula profesional.

**Endpoint:** `POST /professional_id`

**Body Parameters:**
```json
{
    "numeroCedula": "Número de cédula profesional"
}
```

## Manejo de Errores

### Error de Validación (400)
```json
{
    "err": true,
    "message": "HAY ERRORES EN EL ENVÍO DE INFORMACIÓN.",
    "errors": {
        "campo": "Mensaje de error específico del campo"
    }
}
```

### Error de Límite de Consultas (400)
```json
{
    "err": true,
    "message": "HA LLEGADO AL LIMITE DE CONSULTAS PERMITIDAS, POR FAVOR CONTACTE A SU ASESOR PARA OBTENER MÁS."
}
```

## Consideraciones Importantes

1. **Timeouts**: Algunos endpoints (OCR y reconocimiento facial) tienen un timeout extendido de 900 segundos debido al procesamiento intensivo.

2. **Formato Base64**: Las imágenes deben enviarse en formato base64 puro, sin el prefijo `data:image/...;base64,`

3. **Almacenamiento S3**: Los documentos PDF generados se almacenan en:
   - Bucket: `kyc-systems`
   - Región: `us-east-2`
   - Path: `kyc-validacion/curp/{CURP}.pdf`

4. **Webhooks**: Algunos endpoints utilizan webhooks internos para procesamiento asíncrono:
   - NSS: `https://kycservices.io/kyc-validacion/api/obtiene_nss_webhook`
   - Historial IMSS: `https://kycservices.io/kyc-validacion/api/obtiene_historial_imss_webhook`
   - PDF CURP: URL base + `/webhook/receive_pdf`

5. **Tracking de Peticiones**: Cada petición exitosa incrementa un contador asociado al API key, método y fecha para control de límites.

## Códigos de Estado HTTP

- **200 OK**: Petición procesada exitosamente
- **400 Bad Request**: Error en la validación de datos o límite de consultas excedido
- **401 Unauthorized**: API Key inválida o no proporcionada
- **500 Internal Server Error**: Error del servidor

## Ejemplo de Implementación

### cURL
```bash
curl -X POST https://kyc-validacion.com/app/api/valida_curp \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: tu_api_key" \
  -d '{
    "curp": "CURP180CARACTERES",
    "documento": "1"
  }'
```

### JavaScript (Fetch)
```javascript
const response = await fetch('https://kyc-validacion.com/app/api/obtener_datos_id', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': 'tu_api_key'
    },
    body: JSON.stringify({
        id: 'base64_imagen_frontal',
        idReverso: 'base64_imagen_reverso'
    })
});

const data = await response.json();
```

### Python (Requests)
```python
import requests

url = "https://kyc-validacion.com/app/api/valida_rfc"
headers = {
    "Content-Type": "application/json",
    "X-API-KEY": "tu_api_key"
}
payload = {
    "rfc": "RFC13CARACTERES"
}

response = requests.post(url, json=payload, headers=headers)
data = response.json()
```

## Soporte y Contacto

Para obtener una API Key o aumentar el límite de consultas, contacta a tu asesor asignado.

---

**Última actualización**: Enero 2025  
**Versión API**: 1.0