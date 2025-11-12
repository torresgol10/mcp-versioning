# MCP Versioning Server

Servidor MCP (Model Context Protocol) para consultar versiones de paquetes en múltiples ecosistemas utilizando la API de [deps.dev](https://deps.dev).

## Características

- 🚀 **Operaciones por lotes (Batch)**: Consulta hasta 50 paquetes en paralelo (10-50x más rápido)
- 🔍 **Consulta de versiones**: Obtén todas las versiones disponibles de un paquete
- 📦 **Última versión**: Identifica rápidamente la versión más reciente
- 📄 **Inspección de manifiestos**: Parsea archivos de dependencias y extrae información
- 💾 **Caché inteligente**: Reduce llamadas a la API con TTL configurable por ecosistema
- 🔄 **Reintentos automáticos**: Manejo robusto de errores con backoff exponencial
- 🌐 **Multi-ecosistema**: Soporta NPM, Cargo, PyPI, Go, RubyGems y NuGet

## Ecosistemas Soportados

| Ecosistema | Sistema | Manifiestos |
|------------|---------|-------------|
| npm (Node.js) | `NPM` | `package.json` |
| Cargo (Rust) | `CARGO` | `Cargo.toml` |
| PyPI (Python) | `PYPI` | `pyproject.toml`, `requirements.txt` |
| Go Modules | `GO` | `go.mod` |
| RubyGems | `RUBYGEMS` | `Gemfile` |
| NuGet (.NET) | `NUGET` | `.csproj`, `.fsproj`, `.vbproj` |

## Instalación

```powershell
# Clonar el repositorio (o usar directamente si ya está descargado)
cd mcp-versioning

# Instalar dependencias
pnpm install

# Compilar TypeScript
pnpm build
```

## Inicio Rápido

1. **Compilar el proyecto:**
   ```powershell
   pnpm build
   ```

2. **Verificar que funciona:**
   ```powershell
   node dist/index.js
   ```
   Deberías ver: `MCP Versioning Server running on stdio`

3. **Configurar en Claude Desktop:**
   - Copia el contenido de `claude_desktop_config.example.json`
   - Actualiza la ruta absoluta al archivo `dist/index.js` según tu sistema
   - Añádelo a la configuración de Claude Desktop
   - Reinicia Claude Desktop

## Uso

### Configuración en Claude Desktop

Añade el servidor a tu configuración de Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` en macOS o `%APPDATA%\Claude\claude_desktop_config.json` en Windows):

```json
{
  "mcpServers": {
    "versioning": {
      "command": "node",
      "args": ["C:\\Users\\Torres\\Desktop\\_UbuntuDevShare\\mcp-versioning\\dist\\index.js"]
    }
  }
}
```

### Herramientas Disponibles

### Operaciones Individuales

#### 1. `get_package_versions`

Obtiene todas las versiones disponibles de un paquete.

**Entrada:**
```json
{
  "system": "NPM",
  "name": "react"
}
```

**Salida:**
```json
{
  "system": "NPM",
  "name": "react",
  "versions": [
    {
      "version": "18.2.0",
      "publishedAt": "2023-06-14T...",
      "isDefault": true,
      "isDeprecated": false
    },
    {
      "version": "18.1.0",
      "publishedAt": "2023-04-26T...",
      "isDefault": false,
      "isDeprecated": false
    }
  ]
}
```

> 💡 **Nota:** Todas las herramientas devuelven `structuredContent` además del texto formateado, facilitando el procesamiento por parte de clientes MCP.

#### 2. `get_latest_version`

Obtiene la última versión de un paquete.

**Entrada:**
```json
{
  "system": "CARGO",
  "name": "serde",
  "includePrerelease": false
}
```

**Salida:**
```json
{
  "version": "1.0.204",
  "publishedAt": "2024-07-01T...",
  "isDefault": true
}
```

#### 3. `inspect_manifest`

Parsea un archivo de manifiesto y extrae las dependencias.

> **💡 Importante:** Para evitar múltiples solicitudes de permisos, se recomienda pasar el contenido del archivo directamente usando el parámetro `content` en lugar de solo la ruta.

**Entrada (recomendada - con contenido):**
```json
{
  "manifestPath": "package.json",
  "content": "{\n  \"dependencies\": {\n    \"react\": \"^18.2.0\"\n  }\n}"
}
```

**Entrada (alternativa - solo ruta):**
```json
{
  "manifestPath": "./package.json"
}
```

**Salida:**
```json
{
  "system": "NPM",
  "dependencies": [
    {
      "system": "NPM",
      "name": "react",
      "spec": "^18.2.0",
      "kind": "prod",
      "source": "manifest"
    },
    {
      "system": "NPM",
      "name": "typescript",
      "spec": "^5.0.0",
      "kind": "dev",
      "source": "manifest"
    }
  ],
  "warnings": [],
  "metadata": {
    "workspace": false
  }
}
```

### Operaciones por Lotes (Batch) 🚀

#### 4. `get_package_versions_batch`

Obtiene versiones de múltiples paquetes en paralelo. **Mucho más eficiente** que llamar `get_package_versions` múltiples veces.

**Entrada:**
```json
{
  "packages": [
    { "system": "NPM", "name": "react" },
    { "system": "NPM", "name": "vue" },
    { "system": "CARGO", "name": "serde" }
  ]
}
```

**Salida:**
```json
{
  "total": 3,
  "successful": 3,
  "cached": 1,
  "results": [
    {
      "system": "NPM",
      "name": "react",
      "cached": true,
      "result": { "system": "NPM", "name": "react", "versions": [...] }
    },
    {
      "system": "NPM",
      "name": "vue",
      "cached": false,
      "result": { "system": "NPM", "name": "vue", "versions": [...] }
    },
    {
      "system": "CARGO",
      "name": "serde",
      "cached": false,
      "result": { "system": "CARGO", "name": "serde", "versions": [...] }
    }
  ]
}
```

#### 5. `get_latest_versions_batch`

Obtiene la última versión de múltiples paquetes en paralelo. **Ideal para auditorías de dependencias**.

**Entrada:**
```json
{
  "packages": [
    { "system": "NPM", "name": "react" },
    { "system": "NPM", "name": "typescript" },
    { "system": "PYPI", "name": "django" }
  ]
}
```

**Salida:**
```json
{
  "total": 3,
  "successful": 3,
  "failed": 0,
  "results": [
    {
      "system": "NPM",
      "name": "react",
      "result": { "version": "18.2.0", "publishedAt": "...", "isDefault": true }
    },
    {
      "system": "NPM",
      "name": "typescript",
      "result": { "version": "5.3.3", "publishedAt": "...", "isDefault": true }
    },
    {
      "system": "PYPI",
      "name": "django",
      "result": { "version": "5.0.1", "publishedAt": "...", "isDefault": true }
    }
  ]
}
```

**💡 Ventajas del Batching:**
- ✅ **10-50x más rápido** que operaciones individuales
- ✅ **Aprovecha paralelización** de requests HTTP
- ✅ **Respeta el caché** (paquetes ya consultados se devuelven instantáneamente)
- ✅ **Manejo de errores individual** (un fallo no afecta a los demás)
- ✅ **Hasta 50 paquetes** por request recomendado

## Permisos y Acceso a Archivos

⚠️ **Importante:** Cuando uses `inspect_manifest`, Claude Desktop solicitará permisos para leer archivos. Para evitar múltiples solicitudes de permisos:

**Opción 1 (Recomendada):** Pasa el contenido del archivo directamente usando el parámetro `content`:
```json
{
  "manifestPath": "package.json",
  "content": "<contenido del archivo aquí>"
}
```

**Opción 2:** Permite el acceso cuando se solicite (solo primera vez si usas solo la ruta)

## Caché

El servidor implementa un sistema de caché en memoria con TTL (Time To Live) configurable por ecosistema:

- **NPM**: 30 minutos
- **Cargo**: 2 horas
- **PyPI**: 1 hora
- **Go**: 2 horas
- **RubyGems**: 1 hora
- **NuGet**: 1 hora

La caché reduce la carga en la API de deps.dev y mejora los tiempos de respuesta.

## FAQ - Preguntas Frecuentes

### ¿Por qué Claude me pide permisos múltiples veces?

Cuando usas `inspect_manifest` solo con `manifestPath`, Claude debe solicitar permiso cada vez que el servidor lee el archivo. 

**Solución:** Usa el parámetro `content` y pasa el contenido del archivo directamente:
```json
{
  "manifestPath": "package.json",
  "content": "{ \"dependencies\": { \"react\": \"^18.2.0\" } }"
}
```

Así solo hay **una solicitud de permiso** cuando Claude lee el archivo inicialmente, y luego puede reutilizar ese contenido.

Consulta [BEST_PRACTICES.md](BEST_PRACTICES.md) para más detalles.

## ¿Qué es PURL?

**PURL (Package URL)** es un formato estándar para identificar paquetes de software de forma uniforme a través de diferentes ecosistemas. 

Formato: `pkg:<ecosystem>/<namespace>/<name>@<version>`

Ejemplos:
- `pkg:npm/react@18.2.0`
- `pkg:cargo/serde@1.0.204`
- `pkg:pypi/django@5.0`

Los PURLs facilitan la correlación de paquetes en herramientas de seguridad, análisis de dependencias y gestión de licencias. En futuras versiones podríamos añadir herramientas para búsquedas masivas usando PURLs.

## Resumen de Herramientas

| Herramienta | Uso | Velocidad |
|-------------|-----|-----------|
| `get_package_versions` | Una sola versión | Normal |
| `get_latest_version` | Última versión de 1 paquete | Normal |
| `inspect_manifest` | Parsear archivo local | Rápida |
| `get_package_versions_batch` ⭐ | Versiones de múltiples paquetes | **10-50x más rápida** |
| `get_latest_versions_batch` ⭐ | Últimas versiones de múltiples | **10-50x más rápida** |

**Regla de oro:** Si consultas 2+ paquetes, usa batching.

Consulta [BATCHING_GUIDE.md](BATCHING_GUIDE.md) para ejemplos prácticos.

## Desarrollo

```powershell
# Modo desarrollo (watch)
pnpm dev

# Compilar
pnpm build

# Ejecutar tests
pnpm test

# Ejecutar servidor
pnpm start

# Linting
pnpm lint
```

## Despliegue en Cloudflare Workers

Se incluye una versión HTTP JSON-RPC del servidor para ejecutarlo como Worker.

### Diferencias clave
- Transport: HTTP (métodos `tools/list` y `tools/call`).
- No hay acceso al filesystem: `inspect_manifest` exige el campo `content`.
- Caché en memoria por aislamiento (puede reiniciarse tras despliegues / reubicación).

### Construir y desplegar

```powershell
pnpm install
pnpm build:worker   # genera dist/worker.js
pnpm deploy:cloudflare
```

Para desarrollo local:
```powershell
wrangler dev
```

### Ejemplos de uso JSON-RPC

Listar herramientas:
```powershell
curl -X POST %WORKER_URL% -H "Content-Type: application/json" -d '{
  "jsonrpc":"2.0","id":1,"method":"tools/list"
}'
```

Llamar a una herramienta:
```powershell
curl -X POST %WORKER_URL% -H "Content-Type: application/json" -d '{
  "jsonrpc":"2.0","id":2,"method":"tools/call","params":{
    "name":"get_latest_version","arguments":{"system":"NPM","name":"react"}
  }
}'
```

Respuesta típica (`tools/call`):
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      { "type": "text", "text": "{\n  ... paquete ...\n}" }
    ]
  }
}
```

> **✨ Actualización:** Todas las herramientas incluyen `outputSchema` y `structuredContent` tanto en el servidor como en el worker.


## Arquitectura

```
src/
├── index.ts                 # Servidor MCP principal
├── constants/
│   └── systems.ts           # Definiciones de ecosistemas y TTL
├── types/
│   └── index.ts             # Tipos TypeScript
├── depsdev/
│   └── client.ts            # Cliente API deps.dev con retries
├── cache/
│   └── cache.ts             # Sistema de caché TTL/LRU
├── manifest/
│   └── inspect.ts           # Parsers de manifiestos
└── tools/
    └── index.ts             # Herramientas MCP y schemas Zod
```

## Seguridad

- ✅ Los manifiestos se parsean de forma estática (sin ejecución de código)
- ✅ Límite de tamaño de archivo: 256 KB
- ✅ Se omiten dependencias locales, VCS y workspace protocols
- ✅ Validación de entrada con Zod schemas
- ✅ Manejo seguro de errores HTTP

## Limitaciones

- Maven no está soportado en la versión actual (complejidad de resolución de propiedades)
- El parsing de manifiestos es heurístico y puede no capturar todos los casos edge
- La API deps.dev está en fase v3alpha (puede cambiar)

## Referencias

- [Model Context Protocol](https://modelcontextprotocol.io)
- [deps.dev API v3alpha](https://docs.deps.dev/api/v3alpha/)
- [Package URL Specification](https://github.com/package-url/purl-spec)

## Licencia

MIT
