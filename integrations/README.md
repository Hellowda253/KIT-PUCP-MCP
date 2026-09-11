# Integración con clientes

La release portátil instala un núcleo común y un launcher estable. El instalador
no modifica clientes: el agente combina la configuración después de crear una
copia de seguridad.

Los archivos de ejemplo son una referencia y no deben copiarse literalmente:
el agente reemplaza los marcadores por rutas absolutas y conserva la estructura
existente del cliente.

Para producir una propuesta sin secretos usa rutas absolutas:

```powershell
npm run install-config -- --client codex --launcher "C:\ruta\PUCP-MCP\launcher.cmd" --client-id codex
npm run install-config -- --client antigravity --launcher "C:\ruta\PUCP-MCP\launcher.cmd" --client-id antigravity
npm run install-config -- --client cursor --launcher "C:\ruta\PUCP-MCP\launcher.cmd" --client-id cursor
npm run install-config -- --client kimi-code --launcher "C:\ruta\PUCP-MCP\launcher.cmd" --client-id kimi-code
npm run install-config -- --client claude-code --launcher "C:\ruta\PUCP-MCP\launcher.cmd" --client-id claude-code
npm run install-config -- --client claude-desktop --launcher "C:\ruta\PUCP-MCP\launcher.cmd" --client-id claude-desktop
```

El modo heredado `--root` continúa disponible para desarrolladores que ejecutan
el repositorio con Node propio. No es el flujo recomendado para estudiantes.

## Skills y assets

- Codex: `$HOME/.agents/skills`.
- Antigravity: `$HOME/.gemini/antigravity/skills`.
- Claude Code: `$HOME/.claude/skills`.
- Cursor: integración MCP admitida; instalación de skills condicional a que el
  cliente confirme una ruta compatible.
- Kimi Code: integración MCP admitida mediante su mecanismo vigente; skills
  condicionales a soporte declarado.
- Claude Desktop y clientes genéricos: no inferir soporte de skills.

La copia siempre es recursiva e incluye `references/`, `scripts/`, `assets/`
y la plantilla HTML. Usa primero dry-run y conserva un backup fechado de los
archivos que vayan a reemplazarse.

## Verificación

`integration-manifest.json` describe servidores, launcher, directorio privado y
capacidades por cliente. Tras el merge, verifica configuración, handshake MCP,
skills y assets de forma independiente. Un fallo de skills no implica que el
servidor MCP esté roto, ni viceversa.

`tool-contracts/` contiene las declaraciones JSON generadas desde `tools/list`:

```powershell
npm run tool-contracts -- --output integrations/tool-contracts
```

No edites esos contratos a mano. Las plantillas y manifiestos nunca deben
contener credenciales.
