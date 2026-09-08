# Línea base de rendimiento

Medición local realizada el 7 de septiembre de 2026 sobre tres sincronizaciones
completas consecutivas de Paideia. Los valores son orientativos: dependen de la
latencia de PUCP, el número de cursos visibles y la cantidad de actividades.
No contienen credenciales, rutas privadas ni nombres de cursos.

| Etapa | Ejecución 1 | Ejecución 2 | Ejecución 3 | Mediana |
|---|---:|---:|---:|---:|
| Catálogo | 4,491 ms | 5,038 ms | 4,600 ms | 4,600 ms |
| Contenido de cursos | 7,177 ms | 8,217 ms | 6,551 ms | 7,177 ms |
| Detalle de actividades | 9,801 ms | 13,569 ms | 10,294 ms | 10,294 ms |
| Anuncios | 5,079 ms | 4,553 ms | 4,474 ms | 4,553 ms |
| Calificaciones | 6,298 ms | 7,090 ms | 5,735 ms | 6,298 ms |
| Total | 39,494 ms | 38,472 ms | 31,661 ms | 38,472 ms |

## Sesión reutilizada

Las tres sincronizaciones usaron un solo navegador y una sola autenticación:

- `browserCreated`: 1
- `sessionReused`: 2
- `authenticationMs`: 5,666 ms
- `operationMs`: 102,972 ms acumulados
- fallos de sincronización: 0

Esto confirma que las consultas calientes evitan repetir el costo de iniciar
Chromium y autenticarse. La sesión se renueva una sola vez cuando Paideia la
rechaza, y solo se repiten operaciones de lectura idempotentes.

## Conclusión

`activityDetails` fue la etapa individual más lenta, pero representó menos de la
mitad del tiempo total y varió con el contenido visible. Por ello no se elevó la
concurrencia ni se omitieron detalles: faltaba evidencia para asumir que ese
cambio sería estable o respetuoso con Paideia. Las consultas focalizadas deben
seguir solicitando únicamente los componentes necesarios cuando el caso de uso
lo permita; una sincronización completa conserva su cobertura completa.

Educación Continua se prueba como un área independiente: una vista accesible sin
cursos debe producir `available` con `courseCount: 0`; solo un fallo real activa
el periodo de espera, y `retryUnavailableAreas: true` fuerza una nueva sonda.
Una comprobación real posterior a la corrección confirmó el área como `available`
y recuperó cuatro cursos pasados; por tanto, una cuenta sin cursos vigentes no se
confunde con un área inaccesible.

## Cómo repetir la medición

1. Ejecutar tres sincronizaciones completas dentro del mismo proceso MCP.
2. Registrar solamente los seis tiempos públicos de la respuesta y las métricas
   sanitizadas del administrador de sesión.
3. Comparar ejecuciones fría y calientes sin publicar datos académicos.
4. Optimizar una etapa únicamente si domina de forma consistente el tiempo total.
