# Lista de publicación

Antes de crear una versión pública:

1. Confirma que `.env.local`, `data/`, `downloads/`, `auth/`, `tmp/`, `output/`
   y `node_modules/` no estén en el índice.
2. Ejecuta `npm ci`, `npm test` y `npm run doctor` en un clon limpio.
3. Revisa `git diff --cached` buscando credenciales, cookies, identificadores y
   rutas personales.
4. Publica primero la rama predeterminada y crea la etiqueta `v0.1.0` sobre el
   commit verificado.
5. Comprueba la instalación desde la URL pública con las instrucciones de
   `AGENTS.md` en al menos un cliente compatible.

No adjuntes cachés ni documentos descargados a la sección de releases.
