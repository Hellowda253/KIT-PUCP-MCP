# Instalación portátil asistida por un agente

La instalación estable de PUCP-MCP usa un ZIP de release para Windows 10/11
x64. El paquete incluye Node.js portátil, dependencias de producción, los tres
servidores, las tres skills, referencias, scripts y la plantilla HTML. El
usuario no necesita Git, npm, Node global, permisos de administrador ni cambios
en `PATH`.

## Solicitud recomendada

Entrega al agente el enlace del repositorio y este mensaje:

> Instala PUCP-MCP desde este repositorio usando la última release estable.
> Sigue `AGENTS.md`, configura este cliente y los que yo elija, instala skills
> y assets, verifica los tres servidores y no muestres mis credenciales.

El agente debe descargar los tres assets versionados de la misma release:

```text
KIT-PUCP-MCP-vX.Y.Z-windows-x64.zip
KIT-PUCP-MCP-vX.Y.Z-windows-x64.zip.sha256
release-manifest.json
```

La descarga usa la URL directa e inmutable del asset, no la API de GitHub. Tras
comparar el SHA-256, el agente extrae el ZIP temporalmente y ejecuta:

```cmd
install.cmd install --json
install.cmd doctor --json
```

Por defecto, el núcleo se instala en
`%LOCALAPPDATA%\Programs\PUCP-MCP` y los datos privados en
`%LOCALAPPDATA%\PUCP-MCP`. Pueden cambiarse con `--install-dir` y
`--state-dir`; se admiten espacios, tildes y caracteres no ASCII.

## Integración con clientes

El instalador no edita clientes automáticamente. El agente lee
`integration-manifest.json`, identifica los clientes seleccionados, crea
backups y combina solo las tres entradas PUCP con la configuración existente.
Copia las carpetas completas de las skills de forma recursiva para conservar
sus referencias, scripts, assets y plantilla.

Estado de compatibilidad inicial:

- **Codex — verificado:** configuración MCP y skills en
  `$HOME/.agents/skills`.
- **Antigravity — verificado:** configuración MCP y skills en
  `$HOME/.gemini/antigravity/skills`.
- **Claude Code — documentado:** MCP mediante su comando oficial y skills en
  `$HOME/.claude/skills`; requiere validación final en el cliente.
- **Claude Desktop — condicional:** usar su mecanismo MCP vigente; las skills
  solo se copian si la versión instalada declara una ruta compatible.
- **Cursor y Kimi Code — condicional:** configurar MCP con su mecanismo vigente;
  instalar skills solo si el cliente confirma soporte y ruta.
- **Cliente genérico:** usar `command`, `args` y `env`; no asumir skills.

Cada cliente recibe un identificador seguro distinto:

```cmd
launcher.cmd paideia --client codex
launcher.cmd campus_virtual_pucp --client codex
launcher.cmd pucp_academic_overview --client codex
```

El perfil de credenciales es compartido, pero cada cliente mantiene su propio
caché y estado. Los tres servidores del mismo cliente comparten el contexto
necesario para que Overview combine Campus y Paideia.

La comprobación final distingue:

1. configuración MCP válida;
2. `initialize` y `tools/list` en los tres servidores;
3. descubrimiento de las tres skills completas;
4. presencia de la plantilla y sus assets.

## Credenciales y biblioteca académica

El usuario puede escribir voluntariamente sus credenciales en el chat; quedan
sujetas a la política de privacidad y retención del servicio de IA. El agente
no debe repetirlas. El destino predeterminado es
`%LOCALAPPDATA%\PUCP-MCP\profiles\default\.env.local`.

La instalación puede completarse sin credenciales. Las consultas en vivo
responderán `authentication_required` hasta que se configuren.

El agente puede ofrecer una vez una carpeta para materiales y registrar su ruta
en `PUCP_DOWNLOADS_DIR`. No debe imponer una estructura personal específica por
defecto: no debe crear ninguna carpeta sin permiso ni insistir si el usuario
prefiere el destino predeterminado.

## Actualización

No usar Git no hace inflexible la actualización. Cada ZIP es una versión
completa e inmutable:

```text
descargar ZIP nuevo
→ verificar SHA-256
→ copiar a staging
→ ejecutar Doctor
→ instalar junto a la versión actual
→ cambiar current.json atómicamente
→ resincronizar skills seleccionadas
```

Ejecuta desde el ZIP nuevo:

```cmd
install.cmd update --json
```

El launcher tiene una ruta estable, así que normalmente no es necesario editar
otra vez los clientes. Credenciales, cachés y descargas viven fuera de las
versiones y no se borran. La versión anterior se conserva para:

```cmd
install.cmd rollback --json
```

Si falla la nueva versión, `current.json` no cambia. Una actualización mientras
la versión anterior está en ejecución tampoco la sobrescribe porque ambas se
guardan lado a lado.

## Reparación y desinstalación

```cmd
install.cmd repair --json
install.cmd uninstall --preserve-data --json
```

`repair` restaura únicamente el núcleo dañado desde un artefacto íntegro. La
desinstalación no borra caché, credenciales ni descargas; eliminar esos datos
requiere una acción separada y explícita.

## Diagnóstico

Las operaciones devuelven JSON con `stage`, `code`, `retryable` y
`suggestedAction`. Errores de rutas, configuración, reinicio o descubrimiento
de skills pueden repararse por etapa. `install.cmd doctor --json` no inicia
sesión ni contacta a la PUCP; valida el Node incluido y realiza `initialize` y
`tools/list`.

## Desarrollo desde código fuente

Git y npm siguen siendo útiles para contribuir, editar o construir una release:

```powershell
npm ci
npm test
npm run doctor -- --json
npm run build:portable
```

Este flujo no debe confundirse con la instalación normal del estudiante.
