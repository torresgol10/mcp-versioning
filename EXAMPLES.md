# Ejemplos de Uso

Este documento muestra ejemplos prácticos de cómo usar las herramientas del servidor MCP Versioning.

## Consultar Versiones de Paquetes

### Ejemplo 1: Obtener todas las versiones de React

```
Herramienta: get_package_versions
Entrada:
{
  "system": "NPM",
  "name": "react"
}
```

**Resultado esperado:** Lista de todas las versiones de React, incluyendo versión, fecha de publicación, si es la versión por defecto y si está deprecada.

### Ejemplo 2: Obtener versiones de serde (Rust)

```
Herramienta: get_package_versions
Entrada:
{
  "system": "CARGO",
  "name": "serde"
}
```

### Ejemplo 3: Obtener versiones de Django (Python)

```
Herramienta: get_package_versions
Entrada:
{
  "system": "PYPI",
  "name": "django"
}
```

## Obtener Última Versión

### Ejemplo 4: Última versión estable de Express

```
Herramienta: get_latest_version
Entrada:
{
  "system": "NPM",
  "name": "express"
}
```

### Ejemplo 5: Última versión de tokio (con prerelease)

```
Herramienta: get_latest_version
Entrada:
{
  "system": "CARGO",
  "name": "tokio",
  "includePrerelease": true
}
```

## Inspeccionar Manifiestos

### Ejemplo 6: Analizar package.json (recomendado - con contenido)

```
Herramienta: inspect_manifest
Entrada:
{
  "manifestPath": "package.json",
  "content": "{\"name\":\"my-app\",\"dependencies\":{\"react\":\"^18.2.0\",\"express\":\"^4.18.0\"}}"
}
```

**Resultado esperado:** Lista de dependencias con su tipo (prod, dev, optional, peer), nombre del paquete, especificación de versión y warnings si hay dependencias no soportadas.

> **💡 Tip:** Pasar el contenido del archivo directamente evita que Claude solicite permisos múltiples veces.

### Ejemplo 7: Analizar Cargo.toml

```
Herramienta: inspect_manifest
Entrada:
{
  "manifestPath": "./Cargo.toml"
}
```

### Ejemplo 8: Analizar pyproject.toml con contenido inline

```
Herramienta: inspect_manifest
Entrada:
{
  "manifestPath": "pyproject.toml",
  "content": "[project]\nname = \"my-app\"\ndependencies = [\n  \"django>=4.0\",\n  \"requests>=2.28\"\n]"
}
```

## Operaciones por Lotes (Batch)

### Ejemplo 9: Auditar múltiples dependencias a la vez

```
Herramienta: get_latest_versions_batch
Entrada:
{
  "packages": [
    { "system": "NPM", "name": "react" },
    { "system": "NPM", "name": "express" },
    { "system": "NPM", "name": "typescript" },
    { "system": "NPM", "name": "@types/node" }
  ]
}
```

**Ventaja:** Una sola llamada en lugar de 4 llamadas individuales. **Hasta 50x más rápido**.

### Ejemplo 10: Obtener versiones completas de múltiples paquetes

```
Herramienta: get_package_versions_batch
Entrada:
{
  "packages": [
    { "system": "CARGO", "name": "serde" },
    { "system": "CARGO", "name": "tokio" },
    { "system": "CARGO", "name": "reqwest" }
  ]
}
```

### Ejemplo 11: Auditoría multi-ecosistema

```
Herramienta: get_latest_versions_batch
Entrada:
{
  "packages": [
    { "system": "NPM", "name": "react" },
    { "system": "CARGO", "name": "serde" },
    { "system": "PYPI", "name": "django" },
    { "system": "GO", "name": "github.com/gin-gonic/gin" },
    { "system": "RUBYGEMS", "name": "rails" }
  ]
}
```

**Resultado:** Obtienes las últimas versiones de 5 ecosistemas diferentes en una sola operación paralela.

## Casos de Uso Reales

### Caso 1: Verificar si un paquete tiene actualizaciones (con batching)

1. Inspecciona tu `package.json` con contenido inline:
   ```json
   { 
     "manifestPath": "package.json",
     "content": "<contenido del archivo>"
   }
   ```

2. Extrae las dependencias del resultado

3. Usa `get_latest_versions_batch` para obtener todas las últimas versiones de una vez:
   ```json
   {
     "packages": [
       { "system": "NPM", "name": "react" },
       { "system": "NPM", "name": "express" },
       { "system": "NPM", "name": "typescript" }
     ]
   }
   ```

4. Compara versiones actuales vs últimas disponibles

**Ventaja del batch:** En lugar de 3+ llamadas secuenciales (lentas), haces 1 llamada paralela (rápida).

### Caso 2: Auditar dependencias entre ecosistemas

Si tienes un proyecto que usa múltiples lenguajes:

1. Inspecciona `package.json` (NPM)
2. Inspecciona `Cargo.toml` (Rust)
3. Inspecciona `requirements.txt` (Python)

Obtienes una vista completa de todas las dependencias en un solo flujo.

### Caso 3: Validar compatibilidad de versiones

1. Obtén todas las versiones de un paquete:
   ```json
   { "system": "NPM", "name": "@types/node" }
   ```

2. Verifica qué versiones están disponibles para tu rango de compatibilidad (ej. `^18.0.0`)

3. Identifica versiones deprecadas o con problemas conocidos

## Tips de Uso

- **🚀 Usa batching siempre que puedas**: `get_latest_versions_batch` y `get_package_versions_batch` son 10-50x más rápidos que llamadas individuales
- **⚠️ Permisos de archivo**: Para evitar que Claude solicite permisos múltiples, **siempre pasa el parámetro `content`** con el contenido del archivo al usar `inspect_manifest`
- **Caché automático**: Las consultas repetidas son más rápidas gracias al caché interno. El batch respeta el caché y solo consulta paquetes no cacheados
- **Límite de batch**: Recomendado hasta 50 paquetes por request. Para más, divide en múltiples batches
- **Manifiestos grandes**: Si tienes un manifiesto muy grande, considera dividirlo o usar herramientas adicionales
- **Dependencias locales**: El parser automáticamente omite dependencias `git+`, `file:`, `workspace:` y similar
- **Normalización de nombres**: PyPI normaliza nombres (guiones y guiones bajos), el servidor maneja esto automáticamente
- **Manejo de errores en batch**: Si un paquete falla, los demás siguen procesándose. Revisa el campo `error` en cada resultado

## Ecosistemas por Tipo de Archivo

| Archivo | Ecosistema | Sistema |
|---------|------------|---------|
| `package.json` | Node.js | NPM |
| `Cargo.toml` | Rust | CARGO |
| `pyproject.toml` | Python | PYPI |
| `requirements.txt` | Python | PYPI |
| `Gemfile` | Ruby | RUBYGEMS |
| `go.mod` | Go | GO |
| `.csproj`, `.fsproj`, `.vbproj` | .NET | NUGET |

## Limitaciones Conocidas

- Maven no está soportado (complejidad de propiedades y resolución de padres)
- Los rangos de versiones se devuelven como strings (no hay resolución semántica)
- Dependencias con `workspace:`, `git+`, `file:` se excluyen automáticamente
- La API puede tener rate limits (el servidor implementa retries automáticos)

## Soporte y Contribuciones

Si encuentras un caso de uso que no funciona correctamente, considera:
1. Verificar los logs del servidor
2. Revisar los warnings en la respuesta de `inspect_manifest`
3. Consultar la documentación de la API
