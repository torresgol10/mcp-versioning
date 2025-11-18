# Mejores Prácticas de Uso

## Evitar Múltiples Solicitudes de Permisos

### Problema
Cuando usas `inspect_manifest` solo con `manifestPath`, Claude Desktop solicita permiso para cada acceso al archivo del sistema. Esto puede resultar en múltiples prompts de permisos.

### Solución Recomendada

**Siempre proporciona el parámetro `content`** con el contenido completo del archivo:

```json
{
  "manifestPath": "package.json",
  "content": "{\n  \"name\": \"my-app\",\n  \"dependencies\": {\n    \"react\": \"^18.2.0\"\n  }\n}"
}
```

### Cómo Obtener el Contenido

En Claude Desktop, puedes:
1. Abrir el archivo en el editor
2. Copiar todo el contenido
3. Pasarlo como string en el parámetro `content`

O pedirle a Claude que lea el archivo una vez y luego use ese contenido para `inspect_manifest`.

### Ventajas de Pasar el Contenido

✅ **Una sola solicitud de permiso** (cuando Claude lee el archivo inicialmente)
✅ **Más rápido** (no hay I/O adicional)
✅ **Usa el caché** eficientemente con hash del contenido
✅ **Funciona con contenido generado** dinámicamente

## Operaciones por Lotes (Batching) 🚀

### Cuándo usar batching

**SIEMPRE** que necesites consultar 2 o más paquetes, usa las herramientas batch:
- `get_package_versions_batch` - Para múltiples paquetes
- `get_latest_versions_batch` - Para auditar actualizaciones

### Comparación de Performance

**Sin batching (lento):**
```
get_latest_version("react")      → 800ms
get_latest_version("express")    → 750ms
get_latest_version("typescript") → 820ms
Total: ~2.4 segundos
```

**Con batching (rápido):**
```
get_latest_versions_batch([
  "react", "express", "typescript"
]) → 850ms
Total: ~0.85 segundos (3x más rápido!)
```

### El caché hace el batching aún más rápido

```json
// Primera llamada: consulta API para los 3
get_latest_versions_batch([...]) → 850ms

// Segunda llamada: todos desde caché
get_latest_versions_batch([...]) → 5ms (170x más rápido!)
```

### Límites recomendados

- **Óptimo:** 10-20 paquetes por batch
- **Máximo recomendado:** 50 paquetes por batch
- **Para más:** Divide en múltiples batches de 50

### Ejemplo real: Auditoría completa de package.json

```javascript
// Paso 1: Inspeccionar manifest (con content inline)
inspect_manifest({ 
  manifestPath: "package.json",
  content: "..." 
})

// Paso 2: Extraer dependencias (ej: 25 deps)
// En lugar de 25 llamadas individuales...

// Paso 3: Una sola llamada batch
get_latest_versions_batch({
  packages: [
    { system: "NPM", name: "react" },
    { system: "NPM", name: "express" },
    // ... 23 más
  ]
})

// Resultado: 25x más rápido que individuales
```

## Uso Eficiente del Caché

### El caché funciona automáticamente

Todas las consultas a la API se cachean automáticamente:

```json
// Primera llamada: consulta API (lenta)
{"system": "NPM", "name": "react"}

// Segunda llamada en 30 min: usa caché (instantánea)
{"system": "NPM", "name": "react"}
```

### Tiempos de caché por ecosistema

- NPM: 30 minutos (paquetes actualizados frecuentemente)
- Cargo: 2 horas (menos frecuente)
- PyPI: 1 hora
- Go: 2 horas
- RubyGems: 1 hora
- NuGet: 1 hora

### Manifiestos también se cachean

El parser de manifiestos usa hash SHA256 del contenido:

```json
// Mismo archivo, mismo hash → caché hit
{"manifestPath": "package.json", "content": "..."}
{"manifestPath": "package.json", "content": "..."} // Instantáneo

// Contenido diferente → caché miss
{"manifestPath": "package.json", "content": "... modificado ..."} // Nueva consulta
```

## Orden de Operaciones Óptimo

### Auditoría de Dependencias (con batching)

```
1. Lee package.json una vez con Claude
2. Llama inspect_manifest con el contenido
3. Extrae lista de dependencias del resultado
4. Llama get_latest_versions_batch UNA VEZ con todas las deps
5. Compara versiones actuales vs últimas

Tiempo total: ~1-2 segundos (vs 10-30 segundos sin batching)
```

### Migración de Versiones

```
1. Usa inspect_manifest para obtener dependencias actuales
2. Usa get_package_versions para ver historial completo
3. Identifica versiones target (estables, sin deprecar)
4. Actualiza manifest y vuelve a inspeccionar
```

### Monitoreo Multi-Ecosistema

```
1. Inspecciona todos los manifiestos al inicio de sesión
2. Las consultas subsecuentes usan caché por horas
3. Refresco manual si necesitas datos actualizados (reinicia servidor)
```

## Manejo de Errores

### Paquete no encontrado (404)

```json
{
  "isError": true,
  "content": [{"type": "text", "text": "HTTP 404: Package not found"}],
  "_meta": {
    "status": 404,
    "endpoint": "GET /systems/NPM/packages/nonexistent-pkg"
  }
}
```

**Solución:** Verifica el nombre del paquete y el ecosistema correcto.

### Rate Limiting (429)

El servidor reintenta automáticamente con backoff exponencial (3 intentos).

### Timeout de Red

```json
{
  "isError": true,
  "content": [{"type": "text", "text": "Network error: timeout"}]
}
```

**Solución:** Reintenta la operación. El servidor ya implementó 3 reintentos automáticos.

## Limitaciones y Workarounds

### Maven no soportado

**Problema:** Maven requiere resolución de propiedades y padres complejos.

**Workaround:** Usa herramientas Maven para listar dependencias:
```bash
mvn dependency:list
```
Luego consulta cada paquete manualmente.

### Dependencias con Git/Path

**Problema:** El parser omite dependencias VCS y locales.

**Solución:** Estas dependencias no están en registros públicos. Gestiónalas manualmente o usa lockfiles.

### Prerelease vs Stable

Por defecto, `get_latest_version` devuelve la versión estable (default).

Para incluir prerelease:
```json
{
  "system": "NPM",
  "name": "react",
  "includePrerelease": true
}
```

## Seguridad

### Validación de Entrada

Todos los parámetros se validan con Zod schemas:
- `system` debe ser uno de: NPM, CARGO, PYPI, GO, RUBYGEMS, NUGET
- `name` es requerido y string
- `content` tiene límite de 256 KB

### Parsing Seguro

- ✅ Sin ejecución de código
- ✅ Sin resolución de scripts npm
- ✅ Sin seguimiento de symlinks
- ✅ Sin procesamiento de DTD XML (evita XXE)

### Datos Sensibles

El caché es **solo en memoria** y se pierde al reiniciar. No persiste datos sensibles en disco.

### Performance

### Benchmarks Aproximados

| Operación | Primera vez | Con caché | Batch (10 paquetes) |
|-----------|-------------|-----------|---------------------|
| `get_package_versions` | 500-2000ms | <5ms | N/A |
| `get_latest_version` | 500-2000ms | <5ms | N/A |
| `get_package_versions_batch` | 800-2500ms | <50ms | 10x más rápido |
| `get_latest_versions_batch` | 800-2500ms | <50ms | 10x más rápido |
| `inspect_manifest` | 10-50ms | <5ms | N/A |

**Nota:** Batch con caché parcial (algunos paquetes ya consultados) es híbrido: devuelve cacheados instantáneamente y consulta solo los nuevos.

### Optimizaciones

1. **🚀 USA BATCHING**: `get_latest_versions_batch` y `get_package_versions_batch` son 10-50x más rápidos
2. **Reutiliza contenido**: Si ya leíste un manifest, guarda el contenido en memoria de Claude
3. **Sesiones largas**: El caché persiste durante toda la sesión del servidor
4. **Divide batches grandes**: Para 100+ paquetes, divide en batches de 50

## Debugging

### Ver logs del servidor

Los logs van a stderr:
```powershell
# Ver logs en tiempo real (si ejecutas manualmente)
node dist/index.js 2> logs.txt
```

### Verificar que el caché funciona

1. Llama `get_package_versions` dos veces con el mismo paquete
2. La segunda debe ser instantánea

### Probar parsing sin permisos

Usa el parámetro `content`:
```json
{
  "manifestPath": "test.json",
  "content": "{\"dependencies\":{\"react\":\"^18.0.0\"}}"
}
```

No requiere permisos de filesystem.
