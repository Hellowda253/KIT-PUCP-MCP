# Lista de publicación

Antes de crear una versión pública:

1. Confirma que `.env.local`, `data/`, `downloads/`, `auth/`, `tmp/`, `output/`
   y `node_modules/` no estén en el índice.
2. Ejecuta `npm ci`, `npm test`, `npm run doctor -- --json` y
   `npm run verify:portable` en un clon limpio de Windows x64.
3. Revisa `git diff --cached` buscando credenciales, cookies, identificadores y
   rutas personales.
4. Confirma que la versión de `package.json` sea nueva y crea la etiqueta
   `vX.Y.Z` sobre el commit verificado.
5. Deja que el workflow construya el ZIP y comprueba que la release contenga el
   ZIP, su `.sha256` y `release-manifest.json` con la misma versión.
6. Descarga el artefacto publicado, verifica su hash y prueba `install`, Doctor,
   `initialize`, `tools/list`, actualización y rollback con rutas limpias.
7. Comprueba la integración desde la URL pública siguiendo `AGENTS.md` en Codex
   y Antigravity, sin reutilizar la caché ni las credenciales del desarrollador.

No adjuntes cachés ni documentos descargados a la sección de releases.
