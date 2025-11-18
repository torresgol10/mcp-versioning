# Changelog

## [0.2.0] - 2025-11-12

### Added
- 🚀 **Operaciones por lotes (Batching)**: Nuevas herramientas para consultas paralelas masivas
  - `get_package_versions_batch`: Obtener versiones de múltiples paquetes (hasta 50)
  - `get_latest_versions_batch`: Obtener últimas versiones de múltiples paquetes (hasta 50)
- Métodos batch en `DepsDevClient` con `Promise.allSettled` para manejo robusto de errores
- Optimización de caché: batches aprovechan paquetes ya cacheados (híbrido caché + red)

### Performance
- **10-50x más rápido** para consultar múltiples paquetes vs operaciones individuales
- Respuestas incluyen métricas: `total`, `successful`, `cached`, `failed`

### Documentation
- Ejemplos de batching en README y EXAMPLES.md
- Sección "Operaciones por Lotes" con casos de uso y benchmarks
- Actualizado BEST_PRACTICES.md con guías de batching y límites recomendados

## [0.1.1] - 2025-11-12

- Actualizado README y EXAMPLES con recomendaciones de uso del parámetro `content`
## [0.2.1] - 2025-01-XX
### Changed
- Migrated from deprecated `Server` API to modern `McpServer` high-level API
- Updated tool registration to use `registerTool()` method with ZodRawShape input schemas
- Improved TypeScript type safety with proper literal types for content.type


### Added
- Nuevo archivo BEST_PRACTICES.md con guía completa de uso óptimo
- Sección "Permisos y Acceso a Archivos" en README

## [0.1.0] - 2025-11-12

### Added
- Initial release del servidor MCP Versioning
- Soporte para 6 ecosistemas: NPM, Cargo, PyPI, Go, RubyGems, NuGet
- Herramienta `get_package_versions` para listar todas las versiones
- Herramienta `get_latest_version` para obtener la última versión
- Herramienta `inspect_manifest` para parsear manifiestos locales
- Cliente deps.dev API v3alpha con retries y backoff exponencial
- Sistema de caché TTL/LRU en memoria con configuración por ecosistema
- Parsers para package.json, Cargo.toml, pyproject.toml, requirements.txt, Gemfile, go.mod
- Documentación completa en README
- Ejemplos de fixtures para testing

### Security
- Parsing estático de manifiestos (sin ejecución de código)
- Límite de tamaño de archivo: 256 KB
- Validación de entrada con Zod schemas
- Exclusión automática de dependencias VCS y locales
