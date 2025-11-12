# Test MCP Versioning Server

Este directorio contiene scripts de prueba para el servidor MCP.

## Prueba manual con MCP Inspector

Puedes probar el servidor usando el [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

```powershell
# Instalar MCP Inspector globalmente
npm install -g @modelcontextprotocol/inspector

# Ejecutar inspector con nuestro servidor
mcp-inspector node dist/index.js
```

## Prueba con ejemplo de package.json

Crea un archivo `test-package.json`:

```json
{
  "name": "test-app",
  "dependencies": {
    "react": "^18.2.0",
    "express": "^4.18.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

Luego usa la herramienta `inspect_manifest`:

```json
{
  "manifestPath": "./test-package.json"
}
```

## Prueba básica de API

```powershell
# Compilar primero
pnpm build

# El servidor espera comunicación MCP por stdio
# Para pruebas simples, considera usar un cliente MCP o Claude Desktop
```

## Ejemplos de consultas

### Obtener versiones de React (NPM)

```json
{
  "system": "NPM",
  "name": "react"
}
```

### Obtener última versión de serde (Cargo)

```json
{
  "system": "CARGO",
  "name": "serde"
}
```

### Obtener versiones de Django (PyPI)

```json
{
  "system": "PYPI",
  "name": "django"
}
```

## Verificación rápida

Para verificar que el servidor inicia correctamente:

```powershell
node dist/index.js
```

Deberías ver: `MCP Versioning Server running on stdio`

El servidor quedará esperando entrada JSON-RPC en stdin. Presiona Ctrl+C para salir.
