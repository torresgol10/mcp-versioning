# Guía Rápida de Batching

## ¿Por qué usar batching?

**Antes (lento):**
```
get_latest_version → 800ms
get_latest_version → 750ms
get_latest_version → 820ms
TOTAL: 2.37 segundos
```

**Ahora (rápido):**
```
get_latest_versions_batch → 850ms
TOTAL: 0.85 segundos (3x más rápido!)
```

## Ejemplo Simple

### ❌ Sin batching (no recomendado)

```json
// Llamada 1
{
  "tool": "get_latest_version",
  "args": { "system": "NPM", "name": "react" }
}

// Llamada 2
{
  "tool": "get_latest_version",
  "args": { "system": "NPM", "name": "vue" }
}

// Llamada 3
{
  "tool": "get_latest_version",
  "args": { "system": "NPM", "name": "angular" }
}
```

### ✅ Con batching (recomendado)

```json
// Una sola llamada
{
  "tool": "get_latest_versions_batch",
  "args": {
    "packages": [
      { "system": "NPM", "name": "react" },
      { "system": "NPM", "name": "vue" },
      { "system": "NPM", "name": "angular" }
    ]
  }
}
```

## Caso de Uso Real: Auditar package.json

### Paso 1: Leer el archivo con Claude

"Lee mi package.json"

### Paso 2: Inspeccionar manifest

```json
{
  "tool": "inspect_manifest",
  "args": {
    "manifestPath": "package.json",
    "content": "<contenido del paso 1>"
  }
}
```

**Resultado:** Lista de 15 dependencias

### Paso 3: Auditar TODAS las dependencias con UNA llamada

```json
{
  "tool": "get_latest_versions_batch",
  "args": {
    "packages": [
      { "system": "NPM", "name": "react" },
      { "system": "NPM", "name": "react-dom" },
      { "system": "NPM", "name": "typescript" },
      { "system": "NPM", "name": "vite" },
      { "system": "NPM", "name": "eslint" },
      // ... 10 dependencias más
    ]
  }
}
```

**Tiempo total:** ~1.5 segundos (vs 15+ segundos sin batching)

## Respuesta del Batch

```json
{
  "total": 15,
  "successful": 14,
  "failed": 1,
  "results": [
    {
      "system": "NPM",
      "name": "react",
      "result": {
        "version": "18.2.0",
        "publishedAt": "2023-06-14T...",
        "isDefault": true
      }
    },
    {
      "system": "NPM",
      "name": "invalid-package",
      "error": "HTTP 404: Package not found"
    },
    // ... resto
  ]
}
```

## Tips

1. **Hasta 50 paquetes** por batch recomendado
2. **Aprovecha el caché**: Paquetes ya consultados se devuelven instantáneamente
3. **Errores individuales**: Un fallo no afecta a los demás
4. **Multi-ecosistema**: Puedes mezclar NPM, Cargo, PyPI, etc. en el mismo batch

## Comandos para Claude

Puedes decirle a Claude:

- "Audita todas las dependencias de mi package.json usando batching"
- "Obtén las últimas versiones de estos 10 paquetes en una sola llamada"
- "Compara las versiones actuales con las últimas usando get_latest_versions_batch"

Claude automáticamente usará las herramientas batch cuando sea apropiado.
