# 📚 DOCUMENTACIÓN COMPLETA API KYC-LISTAS

## 🌐 Información General

- **Base URL**: `http://localhost:3000/api/listas`
- **Autenticación**: API Key requerida en header `X-API-Key`
- **Content-Type**: `application/json`
- **Timeout**: 30 segundos
- **Rate Limiting**: 100 req/min (single), 10 req/min (batch)

## 🔐 Autenticación

Todas las peticiones requieren autenticación mediante API Key:

```bash
curl -H "X-API-Key: YOUR_API_KEY" \
     -H "Content-Type: application/json" \
     "http://localhost:3000/api/listas/endpoint"
```

### Respuestas de Error de Autenticación:

```json
// Sin API Key
{
  "err": true,
  "message": "NO SE PROPORCIONÓ UNA CLAVE X-API-KEY."
}

// API Key inválida
{
  "err": true,
  "message": "X-API-KEY INVÁLIDA."
}
```

---

## 📋 ENDPOINTS DISPONIBLES

### 1. 🔍 BÚSQUEDA INDIVIDUAL
**POST** `/search`

Realiza búsqueda de una sola persona en las listas de compliance.

#### Request Body:
```json
{
  "persona": "1",                    // 1=física, 2=moral (obligatorio)
  "nombre": "IVAN",                  // Nombre (obligatorio)
  "apaterno": "GUZMAN",             // Apellido paterno (opcional)
  "amaterno": "SALAZAR",            // Apellido materno (opcional)
  "rfc": "GUMI830815ABC",           // RFC (opcional)
  "curp": "GUMI830815HDFRRT05",     // CURP (opcional)
  "porcentaje_min": 85,             // Porcentaje mínimo similitud (opcional, default: 98)
  "tipo": "OFAC",                   // Filtrar por tipo de lista (opcional)
  "id_entity": 2000,                // ID de entidad específica (opcional)
  "document": 1                     // Generar PDF (opcional, 1=sí)
}
```

#### Response Exitosa:
```json
{
  "err": false,
  "coincidences": 2,
  "message": "REGISTROS CARGADOS EXITOSAMENTE.",
  "person": [
    {
      "id": 1262018,
      "person_type": 1,
      "nombre": "IVAN ARCHIVALDO GUZMAN SALAZAR",
      "apaterno": null,
      "amaterno": null,
      "rfc": "15/08/1983",
      "curp": null,
      "tipo": "OFAC",
      "porcentaje_coincidencia": 100,
      "observaciones": "Persona en lista OFAC",
      "pertenece": "OFAC",
      "status": "active"
    }
  ],
  "performance": {
    "processing_time_ms": 89,
    "validation_time": 2,
    "search_strategy": "high",
    "used_workers": false
  },
  "requestId": "req_1755024354049_abc123"
}
```

#### Response Sin Coincidencias:
```json
{
  "err": false,
  "coincidences": 0,
  "message": "NO SE ENCONTRARON COINCIDENCIAS CON IVAN GUZMAN.",
  "person": null,
  "performance": {
    "processing_time_ms": 67,
    "validation_time": 1,
    "search_strategy": "medium",
    "used_workers": false
  },
  "requestId": "req_1755024354049_xyz789"
}
```

#### Ejemplo de Uso:
```bash
curl -X POST http://localhost:3000/api/listas/search \
  -H "Content-Type: application/json" \
  -H "X-API-Key: KYC-062192Sj2NgK8aPyPHXYSxjKY" \
  -d '{
    "persona": "1",
    "nombre": "Ivan Archivaldo",
    "apaterno": "Guzman",
    "amaterno": "Salazar",
    "porcentaje_min": 85,
    "tipo": "OFAC"
  }'
```

---

### 2. 📊 BÚSQUEDA MÚLTIPLE (BATCH)
**POST** `/search-multiple`

Procesa hasta 10,000 registros en una sola petición utilizando workers en paralelo.

#### Request Body:
```json
[
  {
    "id": "cliente_001",              // ID único opcional
    "persona": "1",                   // 1=física, 2=moral (obligatorio)
    "nombre": "IVAN",                 // Nombre (obligatorio)
    "apaterno": "GUZMAN",            // Apellido paterno (opcional)
    "amaterno": "SALAZAR",           // Apellido materno (opcional)
    "rfc": "GUMI830815ABC",          // RFC (opcional)
    "curp": "GUMI830815HDFRRT05",    // CURP (opcional)
    "type": "CLIENTE",               // Tipo de cliente (opcional)
    "porcentaje_min": 85             // Porcentaje mínimo (opcional)
  },
  {
    "id": "cliente_002",
    "persona": "2",
    "nombre": "EMPRESA EJEMPLO SA DE CV",
    "porcentaje_min": 90
  }
  // ... hasta 10,000 registros
]
```

#### Response Exitosa:
```json
{
  "err": false,
  "message": "PROCESAMIENTO COMPLETADO.",
  "processing_time_ms": 2456,
  "total_records": 2,
  "results": [
    {
      "err": false,
      "message": "REGISTROS CARGADOS EXITOSAMENTE.",
      "coincidences": 1,
      "person": [
        {
          "id": 1262018,
          "nombre": "IVAN ARCHIVALDO GUZMAN SALAZAR",
          "porcentaje_coincidencia": 95,
          "tipo": "OFAC"
        }
      ],
      "input": {
        "id": "cliente_001",
        "persona": "1",
        "nombre": "IVAN",
        "apaterno": "GUZMAN",
        "amaterno": "SALAZAR"
      }
    },
    {
      "err": false,
      "message": "NO SE ENCONTRARON COINCIDENCIAS CON EMPRESA EJEMPLO SA DE CV.",
      "coincidences": 0,
      "person": null,
      "input": {
        "id": "cliente_002",
        "persona": "2",
        "nombre": "EMPRESA EJEMPLO SA DE CV"
      }
    }
  ],
  "performance": {
    "validationTime": 5,
    "hardware": {
      "class": "minimal",
      "isM4MacBook": true,
      "isEC2T3Large": false
    }
  },
  "requestId": "req_1755024354049_batch123"
}
```

#### Características Importantes:
- **Máximo**: 10,000 registros por petición
- **Procesamiento**: Paralelo usando workers
- **Orden preservado**: Los resultados mantienen el orden del input
- **Auto-redirect**: Peticiones de 1 registro se redirigen a `/search`
- **Performance**: 40-60% más rápido que búsquedas secuenciales

#### Ejemplo de Uso:
```bash
curl -X POST http://localhost:3000/api/listas/search-multiple \
  -H "Content-Type: application/json" \
  -H "X-API-Key: KYC-062192Sj2NgK8aPyPHXYSxjKY" \
  -d '[
    {
      "id": "001", 
      "persona": "1", 
      "nombre": "IVAN ARCHIVALDO", 
      "apaterno": "GUZMAN", 
      "amaterno": "SALAZAR"
    },
    {
      "id": "002", 
      "persona": "2", 
      "nombre": "EMPRESA TEST SA"
    }
  ]'
```

---

### 3. 📅 BÚSQUEDA POR PARÁMETROS DE FECHA
**POST** `/search/params`

Realiza búsqueda individual con filtros adicionales de fecha.

#### Request Body:
```json
{
  "persona": "1",                    // 1=física, 2=moral (obligatorio)
  "nombre": "IVAN ARCHIVALDO",       // Nombre (obligatorio)
  "apaterno": "GUZMAN",             // Apellido paterno (opcional)
  "amaterno": "SALAZAR",            // Apellido materno (opcional)
  "rfc": "GUMI830815ABC",           // RFC (opcional)
  "curp": "GUMI830815HDFRRT05",     // CURP (opcional)
  "porcentaje_min": 85,             // Porcentaje mínimo (opcional)
  "tipo": "OFAC",                   // Tipo de lista (opcional)
  "id_entity": 2000,                // ID entidad (opcional)
  "year": 2024,                     // Año para filtrar (obligatorio)
  "month": 8,                       // Mes para filtrar (obligatorio)
  "document": 1                     // Generar PDF (opcional)
}
```

#### Response:
Similar a `/search` pero con filtros de fecha aplicados.

#### Ejemplo de Uso:
```bash
curl -X POST http://localhost:3000/api/listas/search/params \
  -H "Content-Type: application/json" \
  -H "X-API-Key: KYC-062192Sj2NgK8aPyPHXYSxjKY" \
  -d '{
    "persona": "1",
    "nombre": "IVAN ARCHIVALDO",
    "apaterno": "GUZMAN", 
    "amaterno": "SALAZAR",
    "year": 2024,
    "month": 8,
    "porcentaje_min": 90
  }'
```

---

### 4. 📊 ESTADÍSTICAS DE RENDIMIENTO
**GET** `/search-multiple/stats`

Obtiene estadísticas en tiempo real del sistema.

#### Response:
```json
{
  "system": {
    "uptime": "2 hours, 34 minutes",
    "environment": "development",
    "hardware_class": "minimal"
  },
  "performance": {
    "average_response_time": "89ms",
    "total_requests": 1247,
    "successful_requests": 1198,
    "failed_requests": 49,
    "success_rate": "96.1%"
  },
  "workers": {
    "active_workers": 6,
    "max_workers": 6,
    "worker_utilization": "23%"
  },
  "database": {
    "active_connections": 8,
    "max_connections": 20,
    "connection_utilization": "40%",
    "avg_query_time": "12ms"
  },
  "memory": {
    "heap_used": "45MB",
    "heap_total": "67MB",
    "memory_usage": "67%"
  }
}
```

#### Ejemplo de Uso:
```bash
curl -H "X-API-Key: KYC-062192Sj2NgK8aPyPHXYSxjKY" \
     http://localhost:3000/api/listas/search-multiple/stats
```

---

## 🎯 PARÁMETROS DETALLADOS

### Campo `persona`:
- **`"1"`**: Persona física (individual)
- **`"2"`**: Persona moral (empresa/organización)

### Campo `porcentaje_min`:
- **95-100%**: Coincidencias exactas o casi exactas
- **80-94%**: Coincidencias con pequeñas variaciones
- **60-79%**: Coincidencias con palabras faltantes/extras
- **50-59%**: Coincidencias parciales significativas
- **<50%**: Coincidencias muy flexibles (muchos falsos positivos)

### Campo `tipo` (filtros disponibles):
- `"OFAC"`: Lista OFAC (Office of Foreign Assets Control)
- `"DEA"`: Lista DEA (Drug Enforcement Administration)  
- `"LPB"`: Listas Personas Bloqueadas
- `"SAT"`: Listas del SAT (Sistema de Administración Tributaria)
- `"PEP"`: Personas Expuestas Políticamente
- `"FBI"`: Listas del FBI
- Sin especificar: Busca en todas las listas

---

## ⚠️ MANEJO DE ERRORES

### Errores Comunes:

#### Error de Validación:
```json
{
  "err": true,
  "message": "EL CAMPO NOMBRE ES OBLIGATORIO Y NO PUEDE ESTAR VACÍO.",
  "requestId": "req_1755024354049_error123"
}
```

#### Error de Límite Excedido:
```json
{
  "err": true,
  "message": "EL NÚMERO MÁXIMO DE REGISTROS PERMITIDOS ES 10000. RECIBIDOS: 15000.",
  "requestId": "req_1755024354049_limit123"
}
```

#### Error Interno del Servidor:
```json
{
  "err": true,
  "message": "ERROR INTERNO DEL SERVIDOR.",
  "requestId": "req_1755024354049_server123"
}
```

#### Error de Timeout:
```json
{
  "err": true,
  "message": "LA PETICIÓN EXCEDIÓ EL TIEMPO LÍMITE DE 30 SEGUNDOS.",
  "requestId": "req_1755024354049_timeout123"
}
```

---

## 📈 CÓDIGOS DE RESPUESTA HTTP

| Código | Descripción |
|--------|-------------|
| `200` | Búsqueda exitosa (con o sin resultados) |
| `400` | Error de validación de parámetros |
| `401` | API Key no proporcionada |
| `403` | API Key inválida |
| `408` | Timeout de la petición |
| `429` | Rate limit excedido |
| `500` | Error interno del servidor |

---

## ⚡ OPTIMIZACIÓN DE PERFORMANCE

### Recomendaciones:

#### Para Búsquedas Individuales:
- Use porcentajes apropiados (80-90% para balance óptimo)
- Especifique `tipo` cuando sea posible para filtrar resultados
- Incluya RFC/CURP cuando esté disponible para búsquedas exactas

#### Para Búsquedas Múltiples:
- **Lotes óptimos**: 100-1000 registros por petición
- **Evitar**: Peticiones de 1 solo registro (use `/search`)
- **Paralelismo**: El sistema automáticamente optimiza según hardware

#### Configuraciones por Hardware:

| Hardware | Workers | Batch Size | Timeout |
|----------|---------|------------|---------|
| **MacBook M4** | 6 | 12 registros | 15s |
| **EC2 t3.large** | 2 | 6 registros | 8s |
| **Básico** | 2 | 4 registros | 5s |

---

## 🔧 EJEMPLOS DE INTEGRACIÓN

### JavaScript (Node.js):
```javascript
const axios = require('axios');

async function buscarPersona(nombre, apellidos) {
  try {
    const response = await axios.post('http://localhost:3000/api/listas/search', {
      persona: "1",
      nombre: nombre,
      apaterno: apellidos.paterno,
      amaterno: apellidos.materno,
      porcentaje_min: 85
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': 'YOUR_API_KEY'
      }
    });
    
    return response.data;
  } catch (error) {
    console.error('Error en búsqueda:', error.response?.data || error.message);
  }
}
```

### Python:
```python
import requests

def buscar_persona(nombre, apellido_paterno, apellido_materno):
    url = "http://localhost:3000/api/listas/search"
    headers = {
        "Content-Type": "application/json",
        "X-API-Key": "YOUR_API_KEY"
    }
    data = {
        "persona": "1",
        "nombre": nombre,
        "apaterno": apellido_paterno,
        "amaterno": apellido_materno,
        "porcentaje_min": 85
    }
    
    try:
        response = requests.post(url, json=data, headers=headers)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error en búsqueda: {e}")
        return None
```

### PHP:
```php
<?php
function buscarPersona($nombre, $apellidoPaterno, $apellidoMaterno) {
    $url = 'http://localhost:3000/api/listas/search';
    $data = [
        'persona' => '1',
        'nombre' => $nombre,
        'apaterno' => $apellidoPaterno,
        'amaterno' => $apellidoMaterno,
        'porcentaje_min' => 85
    ];
    
    $options = [
        'http' => [
            'header' => [
                'Content-Type: application/json',
                'X-API-Key: YOUR_API_KEY'
            ],
            'method' => 'POST',
            'content' => json_encode($data)
        ]
    ];
    
    $context = stream_context_create($options);
    $result = file_get_contents($url, false, $context);
    
    return json_decode($result, true);
}
?>
```

---

## 📊 CASOS DE USO COMUNES

### 1. KYC Básico (Know Your Customer):
```bash
# Verificar si una persona está en listas restrictivas
curl -X POST http://localhost:3000/api/listas/search \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "persona": "1",
    "nombre": "JUAN CARLOS",
    "apaterno": "RODRIGUEZ",
    "amaterno": "MARTINEZ",
    "porcentaje_min": 90
  }'
```

### 2. Procesamiento Masivo de Clientes:
```bash
# Verificar lista completa de clientes
curl -X POST http://localhost:3000/api/listas/search-multiple \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d @clientes.json
```

### 3. Búsqueda por RFC:
```bash
# Búsqueda exacta por RFC
curl -X POST http://localhost:3000/api/listas/search \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "persona": "1",
    "nombre": "JUAN",
    "rfc": "ROMJ850615ABC",
    "porcentaje_min": 100
  }'
```

### 4. Verificación de Empresas:
```bash
# Verificar persona moral
curl -X POST http://localhost:3000/api/listas/search \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "persona": "2",
    "nombre": "EMPRESA CONSTRUCTORA SA DE CV",
    "tipo": "SAT",
    "porcentaje_min": 85
  }'
```

---

## 🔍 ALGORITMO DE SIMILITUD

### Cómo Funciona:
1. **Normalización**: Convierte texto a mayúsculas, elimina acentos
2. **Levenshtein Distance**: Calcula diferencia entre cadenas
3. **Boost/Penalizaciones**: Ajusta según:
   - Coincidencias exactas por RFC/CURP
   - Todas las palabras presentes
   - Apellidos coincidentes
   - Ratio de longitud

### Fórmula Base:
```
Similitud = (1 - (distancia_levenshtein / longitud_mayor)) × 100
```

### Ejemplos de Similitud:
- `"IVAN GUZMAN"` vs `"IVAN GUZMAN"` = **100%**
- `"IVAN GUZMAN"` vs `"IVAN GUSMAN"` = **91%** (1 letra diferente)
- `"IVAN GUZMAN"` vs `"IVAN ARCHIVALDO GUZMAN"` = **56%** (palabra faltante)

---

## 💡 MEJORES PRÁCTICAS

### ✅ Recomendaciones:

1. **Use porcentajes apropiados**:
   - 95%+ para coincidencias casi exactas
   - 80-90% para uso general
   - 50-70% para búsquedas amplias

2. **Especifique tipo cuando sea posible**:
   - Reduce tiempo de búsqueda
   - Mejora precisión de resultados

3. **Para búsquedas masivas**:
   - Use `/search-multiple` para >1 registro
   - Procese en lotes de 100-1000 registros

4. **Manejo de errores**:
   - Siempre verifique `response.err`
   - Use `requestId` para debugging

### ❌ Evitar:

1. **No use porcentajes muy bajos** (<40%) sin filtrado posterior
2. **No exceda 10,000 registros** por petición
3. **No ignore los timeouts** en búsquedas grandes
4. **No olvide validar la API Key**

---

## 🚀 DEPLOYMENT Y CONFIGURACIÓN

### Variables de Entorno Requeridas:
```bash
# Base de datos
DB_HOST=localhost
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=kyc_lists

# API Keys (separadas por comas)
API_KEYS=key1,key2,key3

# Opcional
NODE_ENV=production
PORT=3000
```

### Health Check:
```bash
# Verificar estado del sistema
curl -H "X-API-Key: YOUR_API_KEY" \
     http://localhost:3000/api/listas/search-multiple/stats
```

---

## 📞 SOPORTE Y MONITOREO

### Logs Disponibles:
- `logs/search-YYYY-MM-DD.log` - Actividad de búsquedas
- `logs/worker-YYYY-MM-DD.log` - Performance de workers
- `logs/error-YYYY-MM-DD.log` - Errores detallados

### Métricas de Monitoreo:
- Response time objetivo: <100ms
- Success rate objetivo: >95%
- Worker utilization: <80%

### Request ID:
Cada petición incluye un `requestId` único para tracking y debugging:
```json
{
  "requestId": "req_1755024354049_abc123"
}
```

---

## 📋 LÍMITES Y RESTRICCIONES

| Parámetro | Límite |
|-----------|--------|
| **Registros por petición** | 10,000 máximo |
| **Rate limit (individual)** | 100 peticiones/minuto |
| **Rate limit (batch)** | 10 peticiones/minuto |
| **Timeout** | 30 segundos |
| **Tamaño máximo payload** | 50MB |
| **Campos de texto** | 500 caracteres máximo |

---

Esta documentación cubre todos los aspectos de la API KYC-LISTAS. Para casos específicos o dudas técnicas, consulte los logs del sistema o use el endpoint de estadísticas para monitoreo en tiempo real.