# Instalación desde un agente

PUCP-MCP está diseñado para que un agente con acceso al terminal pueda instalarlo
desde el enlace del repositorio. No requiere un instalador gráfico.

## Solicitud recomendada

Entrega al agente el enlace del repositorio junto con este mensaje:

> Instala PUCP-MCP desde este repositorio. Sigue `AGENTS.md`, configura este cliente,
> instala las skills y verifica los tres servidores. No muestres mis credenciales.

El agente debe preferir la etiqueta estable más reciente. Si todavía no existe,
puede usar la rama predeterminada e indicarlo al usuario. Después ejecuta `npm ci`,
genera una propuesta con rutas absolutas y la combina con la configuración existente
tras crear una copia de seguridad.

Las skills se instalan copiando sus carpetas completas de forma recursiva, no
solamente `SKILL.md`. Así también quedan disponibles sus `assets/`, referencias,
scripts y plantillas HTML en cualquier cliente compatible.

### Biblioteca académica opcional

Durante la instalación, el agente puede ofrecer una sola vez configurar una carpeta
principal para materiales. El usuario puede seleccionar una carpeta existente o
autorizar la creación de una nueva con el nombre y ubicación que prefiera. Si acepta,
el agente guarda la ruta absoluta en `PUCP_DOWNLOADS_DIR` dentro de `.env.local`.

La carpeta `.UNI V2` es solamente un ejemplo de organización personal, no un nombre
ni una estructura obligatoria del kit. El agente no debe crear una carpeta sin
permiso, cambiar una biblioteca existente ni insistir si el usuario rechaza la
propuesta. Si la variable queda vacía, se conserva `downloads\Paideia` como destino
predeterminado dentro del repositorio.

## Clientes

El generador admite:

```powershell
npm run install-config -- --client codex --root C:\ruta\PUCP-MCP
npm run install-config -- --client antigravity --root C:\ruta\PUCP-MCP
npm run install-config -- --client claude-code --root C:\ruta\PUCP-MCP
npm run install-config -- --client claude-desktop --root C:\ruta\PUCP-MCP
```

También existe `--client generic`. Sin `--output`, el comando solo imprime una
propuesta; no modifica ninguna configuración. Con `--output`, escribe exclusivamente
el archivo indicado.

### Estado de compatibilidad

- Codex: esquema local verificado y generación TOML comprobada.
- Antigravity: esquema local verificado y generación JSON comprobada.
- Claude Code: generación y contrato probados, pero cliente real no probado en este
  equipo.
- Claude Desktop: generación y contrato probados, pero cliente real no probado en
  este equipo.

Un cliente no probado no debe anunciarse como validado hasta completar
`initialize` y `tools/list` desde ese cliente.

## Credenciales

Puedes escribir voluntariamente tus credenciales PUCP en el chat y pedir al agente
que las utilice o almacene. El destino predeterminado es `.env.local`, que está
excluido de Git. Si pides expresamente guardarlas en la configuración del cliente,
el agente usará el bloque `env`, nunca los argumentos del proceso.

El agente no debe repetir contraseñas ni mostrarlas en logs, diffs o diagnósticos.
Recuerda que las credenciales enviadas por chat también quedan sujetas a la política
de privacidad y retención del servicio de IA que estés usando.

La instalación puede completarse sin credenciales. En ese caso, las consultas en
vivo responderán `authentication_required` hasta que completes `.env.local`.

## Verificación

Ejecuta:

```powershell
npm run doctor
npm run doctor -- --json
npm test
```

`doctor` no inicia sesión ni contacta a la PUCP. Comprueba el entorno local y realiza
`initialize` y `tools/list` contra los tres servidores por `stdio`. Una prueba en vivo
debe solicitarse después mediante las herramientas MCP de solo lectura.

En el primer uso, sincroniza Paideia y Campus, espera sus trabajos con
`get_paideia_job_status` y `get_campus_job_status`, y consulta después
`get_academic_data_status`. Overview devuelve `cache_unavailable` mientras ambas
cachés estén vacías.

## Actualización

El agente debe crear primero una copia de seguridad de la configuración del cliente.
Luego cambia a la etiqueta elegida, reinstala exactamente el lockfile y verifica:

```powershell
git fetch --tags
git checkout v0.3.1
npm ci
npm test
npm run doctor
```

Si falla la verificación, restaura la configuración anterior y conserva el clon
previo hasta resolver el problema.

## Desinstalación

Retira de la configuración solamente `paideia`, `campus_virtual_pucp` y
`pucp_academic_overview`, además de las skills instaladas desde este repositorio.
La desinstalación no borra caché, materiales descargados, documentos privados ni
`.env.local`. Elimina esos datos únicamente mediante una solicitud separada y
después de comprobar sus rutas exactas.
