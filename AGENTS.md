# Instalación de PUCP-MCP por agentes

Estas instrucciones se aplican cuando un usuario pide instalar o actualizar este
repositorio desde un enlace. El alcance inicial es Codex, Antigravity, Claude Code
y Claude Desktop en Windows; para otro cliente, usa su formato MCP `stdio` vigente.

## Secuencia obligatoria

1. Identifica el cliente, el sistema y si la instalación será de usuario o proyecto.
2. Clona la etiqueta estable más reciente en una ubicación persistente. Si el
   repositorio aún no tiene etiquetas, usa la rama predeterminada e informa esa
   limitación. No ejecutes el MCP desde una carpeta temporal.
3. Comprueba Node.js 20 o posterior y ejecuta `npm ci` en la raíz.
4. Si falta `.env.local`, créalo a partir de `.env.example`.
5. Configura credenciales según la sección siguiente.
6. Ejecuta `npm run install-config -- --client CLIENTE --root RUTA_ABSOLUTA`.
7. Lee la configuración vigente del cliente y crea una copia de seguridad antes de
   cambiarla. Conserva todos los servidores ajenos y combina únicamente `paideia`,
   `campus_virtual_pucp` y `pucp_academic_overview`.
8. Instala las carpetas completas de `skills/` de forma recursiva, incluidos
   `assets/`, `references/`, `scripts/` y `agents/`, con el mecanismo admitido por
   el cliente. No sustituyas silenciosamente una versión más nueva.
9. Ejecuta `npm run doctor -- --json`; después verifica `initialize` y `tools/list`
   desde el cliente.
10. Informa archivos modificados, pruebas realizadas y reversión disponible sin
    mostrar secretos.

## Credenciales proporcionadas en el chat

El usuario puede entregar voluntariamente sus credenciales PUCP en el chat y pedir
que el agente las use o guarde. Esa autorización se limita a esta instalación.

- Por defecto guárdalas en `.env.local` como `PAIDEIA_USER`, `PAIDEIA_PASS`,
  `CAMPUS_PUCP_USER` y `CAMPUS_PUCP_PASS`.
- Si el usuario pide guardarlas en el cliente, usa su bloque `env` únicamente por
  petición expresa. Advierte que algunos clientes conservan ese archivo como texto
  plano.
- Nunca coloques secretos en `args`, URLs, nombres de archivo, comandos visibles,
  Git, plantillas públicas o archivos de diagnóstico.
- No vuelvas a repetir una contraseña en el chat, la salida del terminal, un diff o
  el resumen final. Confirma solo los nombres de variables configurados.
- Si las credenciales no fueron proporcionadas, termina la instalación igualmente;
  `authentication_required` es el comportamiento esperado al consultar PUCP.

## Escritura, actualización y reversión

Usa rutas absolutas para el ejecutable de Node y cada servidor. No edites una
configuración cuyo formato no puedas validar. La copia de seguridad debe permanecer
local y fuera de Git. Para actualizar, cambia a una etiqueta indicada, ejecuta
`npm ci`, `npm test` y `npm run doctor` antes de conservar el cambio.

Al desinstalar, retira solamente las tres entradas y las skills de PUCP-MCP. No
borres `.env.local`, cachés, descargas ni documentos personales sin una solicitud
separada y explícita.
