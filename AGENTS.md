# Instalación de PUCP-MCP por agentes

Estas instrucciones se aplican cuando el usuario entrega el enlace de GitHub y
pide instalar o actualizar el kit. La distribución normal es una **release
portátil para Windows 10/11 x64**: no requiere Git, Node.js global, npm,
permisos de administrador ni cambios en `PATH`.

El protocolo cubre Codex, Antigravity y Claude, además de otros clientes MCP
cuando declaren una interfaz de configuración compatible.

## Secuencia obligatoria

1. Identifica el cliente desde el que trabajas y pregunta qué otros clientes
   desea configurar. No instales automáticamente en todos los detectados.
2. Abre la release estable elegida, descarga
   `KIT-PUCP-MCP-vX.Y.Z-windows-x64.zip`, su `.sha256` y
   `release-manifest.json` usando las URLs versionadas de los assets. No uses la
   API de GitHub como dependencia de la instalación.
3. Verifica SHA-256 y que la versión del ZIP coincida con el manifiesto.
4. Extrae el ZIP en una carpeta temporal y ejecuta, con rutas absolutas:

   ```cmd
   install.cmd install --json
   install.cmd doctor --json
   ```

5. Lee `integration-manifest.json`. Contiene el launcher, los tres servidores,
   las rutas fuente de skills y assets, y los directorios privados por cliente.
6. Lee y valida la configuración vigente de cada cliente seleccionado. Crea una
   copia de seguridad fechada y combina solamente `paideia`,
   `campus_virtual_pucp` y `pucp_academic_overview`; preserva servidores ajenos.
7. Usa rutas absolutas al launcher y asigna un `--client` diferente a cada
   cliente. No apuntes las configuraciones directamente a una carpeta de
   versión.
8. Copia las carpetas completas de las tres skills de forma recursiva, incluidos
   `assets/`, `references/`, `scripts/` y `agents/`. En Codex usa
   `$HOME/.agents/skills`; en Antigravity,
   `$HOME/.gemini/antigravity/skills`. Para otro cliente confirma primero su
   soporte y ruta de skills.
9. Verifica por separado la sintaxis de configuración, `initialize`,
   `tools/list`, descubrimiento de skills y presencia de la plantilla HTML. Si
   el cliente lo exige, reinícialo y repite la comprobación.
10. Informa la versión instalada, clientes configurados, backups y pruebas sin
    mostrar secretos.

## Credenciales proporcionadas en el chat

El usuario puede entregar voluntariamente sus credenciales PUCP y pedir que el
agente las guarde. Esa autorización se limita a esta instalación.

- Guárdalas por defecto en el perfil compartido
  `%LOCALAPPDATA%\PUCP-MCP\profiles\default\.env.local` como `PAIDEIA_USER`,
  `PAIDEIA_PASS`, `CAMPUS_PUCP_USER` y `CAMPUS_PUCP_PASS`.
- Si el usuario pide guardarlas en el cliente, usa su bloque `env` solo por
  petición expresa y advierte que puede quedar como texto plano.
- Nunca pongas secretos en argumentos, URLs, nombres de archivo, Git,
  diagnósticos o plantillas públicas.
- No vuelvas a repetir la contraseña en el chat, terminal, diff o resumen.
- La instalación puede terminar sin credenciales; `authentication_required` es
  entonces el resultado esperado de una consulta en vivo.

## Actualización, reparación y reversión

Una actualización no modifica el núcleo activo en el sitio. Descarga y verifica
el ZIP de la nueva versión, ejecuta `install.cmd update --json` y deja que el
instalador copie a staging, ejecute Doctor y cambie `current.json` de forma
atómica. El launcher estable seguirá funcionando y la versión anterior quedará
disponible para `install.cmd rollback --json`.

Después de actualizar, vuelve a sincronizar las skills de los clientes
seleccionados con backup previo. Si una etapa falla, usa `repair` para repetir
solo esa etapa; no reinstales ni borres el estado privado de forma automática.

La desinstalación retira el núcleo, pero conserva credenciales, cachés y
descargas. El borrado de datos privados requiere otra solicitud explícita.

## Límites

- No publiques releases ni hagas `push` salvo solicitud expresa.
- No alteres políticas del sistema ni intentes eludir antivirus o controles de
  una organización.
- Chrome o Edge sigue siendo necesario para las consultas que usan navegador;
  su ausencia debe producir `browser_required`, no una instalación corrupta.
- Git y `npm ci` son herramientas de desarrollo desde código fuente, no pasos de
  la instalación normal para estudiantes.
