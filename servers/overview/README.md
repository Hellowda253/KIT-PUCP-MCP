# PUCP Academic Overview

Servidor MCP local de solo lectura que combina las cachés de Paideia y Campus
Virtual PUCP. No inicia sesión, no contacta a la PUCP y no descarga archivos.

## Herramientas

- `get_academic_overview`
- `get_course_workspace`
- `list_upcoming_academic_items`
- `list_recent_academic_changes`
- `get_academic_data_status`

El resumen usa Campus Virtual para horario, modalidad, aulas y notas oficiales;
Paideia para entregas, cuestionarios, avisos y materiales. Las alertas
financieras solo indican estado, existencia de saldo y próxima fecha: el monto
completo queda reservado para `get_financial_status` del servidor de Campus.

Si una de las dos cachés falta, responde con la fuente disponible y una
advertencia. Si ambas faltan, devuelve `cache_unavailable`.

## Inicio

```powershell
npm run start:overview
```

Las rutas se derivan de `PUCP_DATA_DIR` o, por defecto, de `data/` en la raíz
del monorepo.
