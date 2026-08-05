# Plantillas de integración

Estos archivos son una referencia, no deben copiarse literalmente a la
configuración de un cliente. Los marcadores no son variables que todos los clientes
expandan.

Genera una propuesta con rutas absolutas mediante:

```powershell
npm run install-config -- --client codex --root C:\ruta\PUCP-MCP
npm run install-config -- --client antigravity --root C:\ruta\PUCP-MCP
npm run install-config -- --client claude-code --root C:\ruta\PUCP-MCP
npm run install-config -- --client claude-desktop --root C:\ruta\PUCP-MCP
```

Lee y valida la configuración vigente del cliente, crea una copia de seguridad y
combina solo las tres entradas. Las plantillas no contienen credenciales. Si el
usuario pide guardar credenciales en el cliente, agrégalas después mediante su bloque
`env`; el generador nunca recibe ni imprime secretos.

`tool-contracts/` contiene las declaraciones JSON generadas directamente desde
`tools/list` para los tres servidores. Se regeneran con:

```powershell
npm run tool-contracts -- --output integrations/tool-contracts
```

No edites esos contratos a mano: así Codex, Antigravity, Claude y cualquier
cliente genérico reciben los mismos nombres, descripciones y esquemas reales.
