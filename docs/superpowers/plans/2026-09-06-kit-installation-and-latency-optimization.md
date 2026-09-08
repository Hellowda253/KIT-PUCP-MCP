# Instalación portátil, confiable y asistida por agentes de KIT PUCP MCP

> **Estado:** plan aprobado, todavía no implementado. Su ejecución no autoriza publicar una release ni modificar las instalaciones actuales de Codex, Antigravity u otros clientes.

**Objetivo:** ofrecer una instalación local reproducible de KIT PUCP MCP en Windows 10/11, sin exigir Git, Node.js global, permisos de administrador ni conocimiento manual de MCP. Debe admitir varios agentes en una misma computadora, recuperarse de fallos y completar el núcleo más hasta dos integraciones en menos de seis minutos bajo condiciones controladas.

**Arquitectura:** distribuir mediante GitHub Releases un núcleo portátil e independiente de los clientes, con Node.js, dependencias de producción, los tres servidores MCP, las tres skills y sus recursos. El instalador administrará únicamente el núcleo y el estado privado. El agente instalador elegirá con el usuario los clientes, respaldará y editará su configuración, registrará los servidores `stdio`, copiará las skills completas y verificará cada integración. Los plugins nativos podrán añadirse posteriormente, pero no serán requisito.

**Estándares:** Model Context Protocol para servidores; Agent Skills para `SKILL.md`, `references/`, `scripts/` y `assets/`; artefactos inmutables de GitHub Releases con SHA-256; instalación por usuario y versiones lado a lado; adaptadores documentados por cliente.

---

## 1. Decisiones fijadas

- La vía principal será una release portátil de Windows x64.
- Git quedará reservado para desarrollo; no será requisito del estudiante.
- No se ejecutarán `git clone`, `npm install`, `npm ci` ni la suite completa durante una instalación normal.
- Node.js vendrá incluido y se invocará mediante ruta absoluta, sin modificar `PATH`.
- La entrada será `install.cmd`; PowerShell no será necesario en la ruta normal.
- El núcleo se instalará una sola vez aunque existan varios agentes.
- Las configuraciones y skills se integrarán por separado en cada cliente elegido.
- Detectar un cliente nunca autoriza modificarlo. El agente preguntará cuáles debe integrar.
- No habrá un modo `--all` implícito.
- El instalador no se presentará como plugin nativo de ningún cliente.
- La instalación podrá terminar sin credenciales PUCP.
- Credenciales, sesiones, cachés, preferencias y descargas vivirán fuera del código versionado.
- La instalación no iniciará sesión ni sincronizará Campus o Paideia.
- El núcleo deberá superar `initialize` y `tools/list` en los tres servidores.
- MCP, skills y assets se verificarán por separado para cada cliente.
- Instalación, actualización, reparación, rollback y desinstalación serán idempotentes.

---

## 2. Distribución instalada

### Núcleo compartido

```text
%LOCALAPPDATA%\Programs\PUCP-MCP\
├── current.json
├── previous.json
├── install.cmd
├── launcher.cmd
├── launcher.mjs
├── integration-manifest.json
├── runtime\
│   └── node-<version>\
└── versions\
    ├── 0.3.2\
    └── 0.4.0\
```

El usuario podrá cambiarla con `--install-dir`. No se copiará el núcleo dentro de `.codex`, `.gemini`, `.claude`, `.cursor` o `.kimi`.

### Estado privado

```text
%LOCALAPPDATA%\PUCP-MCP\
├── config\.env.local
├── data\
├── cache\
├── downloads\
├── backups\
└── install-state.json
```

Una actualización del núcleo nunca sobrescribirá este directorio.

### Elementos propios de cada cliente

Cada agente tendrá únicamente:

- las entradas de los tres servidores MCP en su configuración;
- las tres skills completas en su directorio reconocido;
- referencias al launcher compartido;
- sus propias decisiones de permisos y reinicio.

---

## 3. Contrato neutral para agentes

El instalador generará `integration-manifest.json` con rutas absolutas y sin secretos:

```json
{
  "schemaVersion": 1,
  "version": "0.4.0",
  "installRoot": "C:\\...\\Programs\\PUCP-MCP",
  "stateRoot": "C:\\...\\PUCP-MCP",
  "servers": [
    {"name": "paideia", "transport": "stdio", "command": "C:\\...\\launcher.cmd", "args": ["paideia"]},
    {"name": "campus_virtual_pucp", "transport": "stdio", "command": "C:\\...\\launcher.cmd", "args": ["campus_virtual_pucp"]},
    {"name": "pucp_academic_overview", "transport": "stdio", "command": "C:\\...\\launcher.cmd", "args": ["pucp_academic_overview"]}
  ],
  "skills": {
    "source": "C:\\...\\versions\\0.4.0\\skills",
    "names": ["pucp-academic", "pucp-context", "profe-pucp"]
  },
  "assets": {
    "scheduleTemplate": "skills/pucp-academic/assets/horario-pucp.html"
  }
}
```

Este manifiesto será la interfaz entre el núcleo y cualquier agente actual o futuro.

---

## 4. División de responsabilidades

### Instalador determinista

- Descargar el manifiesto estable sin usar `api.github.com`.
- Descargar el ZIP versionado exacto y validar tamaño, HTTPS y SHA-256.
- Instalar desde staging y mantener versiones lado a lado.
- Escribir `current.json` atómicamente y conservar una versión para rollback.
- Crear y preservar el estado privado.
- Descubrir Chrome o Edge sin iniciarlos.
- Ejecutar Doctor, `initialize` y `tools/list`.
- Generar el manifiesto neutral y ejemplos de configuración.
- Emitir errores estructurados sin secretos.
- No detectar ni modificar configuraciones de clientes.

### Agente que realiza la instalación

- Identificar el cliente actual e inventariar otros mediante lecturas.
- Preguntar cuáles desea integrar el usuario.
- Confirmar la ubicación y el formato vigentes de cada cliente.
- Respaldar su configuración antes de modificarla.
- Registrar solo los tres servidores PUCP y conservar MCP ajenos.
- Copiar recursivamente las tres skills, incluidas referencias, scripts y assets.
- Solicitar credenciales después de instalar el núcleo y guardarlas en el archivo privado.
- Reiniciar o pedir que se reinicie el cliente cuando corresponda.
- Verificar herramientas, skills y plantilla de manera independiente.
- Ejecutar solo reparaciones documentadas; no improvisar rutas ni editar el código fuente.

### Acciones prohibidas al agente

- Instalar Git o Node global para resolver el proceso.
- Clonar el repositorio como método de usuario final.
- Probar varias estrategias de instalación simultáneamente.
- Sobrescribir configuraciones completas sin combinarlas.
- Registrar servidores duplicados.
- Copiar el núcleo dentro de la carpeta interna de un agente.
- colocar credenciales en argumentos, comandos visibles o informes.
- Declarar éxito sin verificaciones.

---

## 5. Flujo de instalación

### Fase A: preparación

1. Leer `installation-manifest.json` desde el repositorio.
2. Confirmar Windows 10/11 x64.
3. Detectar de forma no mutante el cliente actual y otros conocidos.
4. Preguntar qué clientes deben recibir la integración.
5. Comprobar espacio, conectividad y políticas evidentes.

### Fase B: núcleo

1. Descargar `release-manifest.json` desde GitHub Releases.
2. Validar su esquema y origen.
3. Descargar y verificar el ZIP antes de extraerlo.
4. Extraerlo en una carpeta temporal.
5. Ejecutar una sola vez:

```cmd
install.cmd --action install --json
```

6. Leer el resultado y `integration-manifest.json`.
7. Detenerse si Doctor no aprueba el núcleo.

### Fase C: clientes elegidos

Para cada cliente:

1. Resolver su configuración efectiva.
2. Crear un backup fechado.
3. Agregar o actualizar únicamente los tres servidores PUCP.
4. Apuntarlos al mismo `launcher.cmd` con argumentos diferentes.
5. Copiar las tres skills completas.
6. Validar la sintaxis resultante.
7. Registrar los archivos administrados.
8. Solicitar reinicio si no existe recarga en caliente.

### Fase D: credenciales y verificación

1. Solicitar credenciales únicamente después de completar la instalación estructural.
2. Guardarlas en `%LOCALAPPDATA%\PUCP-MCP\config\.env.local`.
3. Confirmar que aparecen los tres servidores.
4. Ejecutar el comando nativo equivalente a `tools/list`.
5. Invocar una herramienta local y no destructiva de estado.
6. Confirmar las tres skills en el catálogo.
7. Confirmar que `pucp-academic` localiza la plantilla HTML.
8. Entregar un reporte por cliente.

---

## 6. Adaptadores documentados

| Cliente | MCP | Skills | Verificación preferida |
|---|---|---|---|
| Codex | bloque administrado en `config.toml` | directorio global de skills | listado MCP + catálogo de skills |
| Antigravity | combinación de `mcp_config.json` | directorio global reconocido | MCP Manager + catálogo de skills |
| Cursor | combinación de `~/.cursor/mcp.json` | `~/.cursor/skills/` | `cursor-agent mcp list-tools` |
| Kimi Code | `kimi mcp add`; JSON como respaldo | ruta oficial de skills | `kimi mcp test` |
| Claude Code | `claude mcp add --scope user` | ruta oficial de skills | `claude mcp list` |
| Claude Desktop | configuración local; `.mcpb` opcional futuro | reportar soporte real | Developer Settings |
| Genérico | `command`, `args`, `env` | solo si declara Agent Skills | `initialize` + `tools/list` |

Cada guía incluirá detección de solo lectura, esquema comprobado, backup, merge, reinicio, verificación y reversión. No se afirmará compatibilidad completa si solo funciona MCP pero no skills o assets.

---

## 7. Archivos previstos

### Crear

- `installation-manifest.json`
- `scripts/release-manifest.schema.json`
- `scripts/install.cmd`
- `scripts/bootstrap-windows.mjs`
- `scripts/launcher.cmd`
- `scripts/portable-launcher.mjs`
- `scripts/build-portable-release.ps1`
- `scripts/lib/install-state.js`
- `scripts/lib/browser-discovery.js`
- `scripts/lib/integration-manifest.js`
- `integration/README.md`
- `integration/{codex,antigravity,cursor,kimi-code,claude-code,claude-desktop,generic-mcp}.md`
- `integration/examples/*`
- `test/installation-manifest.test.js`
- `test/portable-artifact.test.js`
- `test/portable-launcher.test.js`
- `test/bootstrap-windows.test.js`
- `test/integration-manifest.test.js`
- `test/client-integration-fixtures.test.js`
- `test/install-entrypoint.test.js`
- `.github/workflows/release-portable-windows.yml`
- `docs/portable-installation.md`

### Modificar

- `package.json`
- `AGENTS.md`
- `README.md`
- `docs/installation.md`
- `scripts/lib/doctor.js`
- `.gitignore`

La lógica actual de configuraciones pasará a producir ejemplos y validadores. No escribirá configuraciones durante la instalación del núcleo.

---

## 8. Tareas de implementación

### Tarea 1: manifiestos y contratos

- [ ] Probar esquemas estrictos para los tres manifiestos.
- [ ] Definir plataforma, versión, URLs, hashes, servidores, skills y assets.
- [ ] Rechazar URLs ajenas al repositorio y campos desconocidos.
- [ ] Auditar que nunca contengan secretos.

### Tarea 2: artefacto portátil

- [ ] Empaquetar Node.js LTS verificado y dependencias de producción.
- [ ] Materializar correctamente npm workspaces.
- [ ] Incluir servidores, skills completas y plantilla.
- [ ] Excluir `.env.local`, cookies, sesiones, cachés, descargas, datos personales y `.git`.
- [ ] Probar el ZIP extraído en rutas con espacios y caracteres no ASCII.
- [ ] Limitar inicialmente el ZIP a 65 MiB.

### Tarea 3: launcher y estado versionado

- [ ] Seleccionar atómicamente la versión activa y anterior.
- [ ] Aceptar solo los tres nombres de servidor.
- [ ] Cargar el entorno privado sin imprimirlo.
- [ ] Funcionar desde cualquier directorio mediante rutas absolutas.
- [ ] Propagar correctamente cierre de `stdin` y señales.

### Tarea 4: bootstrap del núcleo

- [ ] Admitir `install`, `update`, `repair`, `rollback`, `uninstall`, `--install-dir`, `--dry-run` y `--json`.
- [ ] Instalar desde staging y activar únicamente después de Doctor.
- [ ] Mantener versiones lado a lado ante `EBUSY`.
- [ ] Preservar datos privados.
- [ ] No detectar ni modificar clientes.
- [ ] Generar `integration-manifest.json` con rutas reales.

### Tarea 5: Doctor rápido

- [ ] Validar inventario, Node, permisos de estado y navegador.
- [ ] Ejecutar `initialize` y `tools/list` para los tres servidores.
- [ ] No contactar PUCP ni exigir credenciales.
- [ ] Medir duración total y por servidor.

### Tarea 6: adaptadores

- [ ] Crear fixtures sanitizados por cliente.
- [ ] Priorizar comandos oficiales y documentar edición de archivos como respaldo.
- [ ] Probar merges que preserven MCP ajenos.
- [ ] Probar configuraciones inválidas, duplicados y rutas antiguas.
- [ ] Validar copia recursiva de skills y assets.
- [ ] Registrar capacidades y versión probada por cliente.

### Tarea 7: protocolo para agentes

- [ ] Reescribir `AGENTS.md` como secuencia breve y obligatoria.
- [ ] Exigir selección de clientes, backups y validación de sintaxis.
- [ ] Prohibir instalación automática en todos los clientes detectados.
- [ ] Incluir errores conocidos y acciones permitidas.
- [ ] Indicar cuándo reparar y cuándo detenerse.

### Tarea 8: actualización y rollback

- [ ] Evitar GitHub REST API y limitar reintentos.
- [ ] Mantener activa la versión anterior ante cualquier fallo.
- [ ] Conservar como máximo versión actual y anterior.
- [ ] No reconfigurar clientes si el launcher estable no cambió.
- [ ] Marcar `restartRequired` cuando corresponda.

### Tarea 9: release automatizada

- [ ] Construir y verificar en GitHub Actions sobre Windows.
- [ ] Auditar secretos, datos personales y rutas locales.
- [ ] Ejecutar pruebas usando exclusivamente el Node incluido.
- [ ] Publicar ZIP versionado y manifiesto estable.

### Tarea 10: validación real

- [ ] Probar Windows 10 22H2 y Windows 11 con cuentas estándar.
- [ ] Probar Codex y Antigravity como soporte principal.
- [ ] Probar Cursor, Kimi Code, Claude Code y Claude Desktop por separado.
- [ ] Probar dos agentes simultáneos compartiendo el núcleo.
- [ ] Registrar MCP, skills, assets, reinicio y versión de cada cliente.

### Tarea 11: documentación pública

- [ ] Reducir el README a un prompt breve y un enlace a la guía.
- [ ] Explicar selección explícita de clientes y núcleo compartido.
- [ ] Documentar instalación personalizada, actualización, reparación y rollback.
- [ ] Incluir una vía manual para usuarios sin agente con terminal.

---

## 9. Errores estructurados

| Código | Acción del agente |
|---|---|
| `unsupported_platform` | detenerse y mostrar requisitos |
| `organization_policy_blocked` | detenerse; no intentar evasión |
| `release_download_unavailable` | conservar lo existente y reintentar después |
| `artifact_integrity_failed` | eliminar staging y no ejecutar |
| `installation_incomplete` | ejecutar `repair` una vez |
| `browser_required` | pedir instalación de Chrome o Edge |
| `client_not_supported` | usar descriptor genérico o detenerse |
| `client_config_invalid` | no escribir; mostrar ubicación y backup |
| `client_restart_required` | pedir reinicio y verificar otra vez |
| `skill_discovery_failed` | revisar solo integración de skills |
| `mcp_handshake_failed` | ejecutar Doctor y conservar diagnóstico |

El agente podrá corregir una ruta o repetir una etapa documentada, pero nunca saltarse validaciones.

---

## 10. Objetivo de tiempo

Condiciones: Windows 10/11 x64, cuenta estándar, al menos 10 Mbps, GitHub disponible, Microsoft Defender activo y hasta dos clientes seleccionados.

| Etapa | Presupuesto máximo |
|---|---:|
| Descarga y hash | 105 s |
| Extracción e instalación | 75 s |
| Doctor | 40 s |
| Integración de hasta dos clientes | 90 s |
| Reinicio y verificación | 35 s |
| Margen | 15 s |
| **Total** | **360 s** |

La primera sincronización autenticada se medirá aparte. No habrá garantía temporal frente a caída de red, bloqueo institucional, antivirus extraordinario o demora manual del usuario.

Objetivos adicionales:

- ZIP ya descargado: menos de 120 segundos;
- segunda ejecución sin cambios: menos de 15 segundos;
- actualización normal: menos de 180 segundos;
- rollback: menos de 30 segundos.

---

## 11. Aceptación final

- [ ] No requiere Git, Node global, administrador ni cambios de `PATH`.
- [ ] Funciona con PowerShell `Restricted` mediante `install.cmd`.
- [ ] Verifica el hash antes de ejecutar.
- [ ] Instala un solo núcleo compartido por varios clientes.
- [ ] No modifica clientes no seleccionados.
- [ ] No duplica servidores o skills en una segunda ejecución.
- [ ] Conserva configuraciones MCP ajenas.
- [ ] Una integración fallida no desactiva el núcleo.
- [ ] Los tres servidores pasan `initialize` y `tools/list` sin acceder a PUCP.
- [ ] Cada cliente verifica MCP, skills y assets por separado.
- [ ] Las skills conservan referencias, scripts y plantilla.
- [ ] Las credenciales no aparecen en comandos, logs o manifiestos.
- [ ] Una actualización fallida conserva la versión activa.
- [ ] El rollback no pierde datos privados.
- [ ] Dos agentes pueden compartir el mismo núcleo.
- [ ] Núcleo más dos integraciones terminan en menos de seis minutos en la matriz definida.
- [ ] El reporte distingue `core`, `mcp`, `skills`, `assets`, `credentials` y `restartRequired`.

## Orden de ejecución

1. Manifiestos.
2. Artefacto portátil.
3. Launcher y estado.
4. Bootstrap del núcleo.
5. Doctor.
6. Adaptadores.
7. Protocolo para agentes.
8. Actualización y rollback.
9. Automatización de releases.
10. Pruebas reales.
11. Documentación.

Primero debe existir un núcleo reproducible y neutral. La automatización de clientes se limitará a guías, validadores y facilidades para el agente.

## Resultado esperado

El estudiante compartirá el enlace de GitHub con su agente. El agente preguntará qué clientes configurar, descargará una release verificada, instalará un único núcleo portátil e integrará solamente los clientes elegidos mediante sus mecanismos vigentes. Las tres skills y su plantilla estarán disponibles donde el cliente realmente las descubra. Cualquier fallo conservará la versión funcional anterior y producirá una acción concreta de recuperación.
