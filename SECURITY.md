# Seguridad y privacidad

PUCP-MCP procesa credenciales y datos académicos únicamente en el equipo del
usuario. Nunca adjuntes a un issue credenciales, cookies, URLs de sesión,
capturas autenticadas, HTML privado, cachés ni documentos personales.

## Reportar una vulnerabilidad

Cuando el repositorio esté publicado, utiliza un aviso privado de seguridad de
GitHub. Si esa opción todavía no está habilitada, contacta al mantenedor por un
canal privado y comparte solo una reproducción sanitizada.

No pruebes acciones destructivas ni realices cambios en cuentas ajenas. Las
pruebas incluidas utilizan fixtures ficticios y no requieren conectarse a PUCP.

## Datos locales

`.env.local`, `data/`, `downloads/`, `auth/`, `tmp/` y `output/` están excluidos
de Git. Antes de publicar una contribución, ejecuta `git status --ignored` y
comprueba que ninguno de esos archivos haya sido forzado al índice.
