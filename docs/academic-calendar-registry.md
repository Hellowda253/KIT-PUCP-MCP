# Registro curado de calendarios académicos

El archivo público [`config/academic-calendars.json`](../config/academic-calendars.json) es la fuente operativa predeterminada para calcular la semana académica. El MCP intenta descargarlo desde la rama `main`, lo cachea durante seis horas y conserva una copia persistente. Si GitHub no está disponible, usa la última copia válida o el archivo incluido con la instalación.

## Curación

Solo el mantenedor modifica este archivo. Cada calendario debe conservar:

- un `id` estable por ciclo y programa;
- `term` en formato `AAAA-N`;
- `kind`: `regular`, `summer`, `intensive` o `continuing`;
- fechas ISO de inicio y fin de clases;
- `courseKeys`, usando `*` únicamente si las fechas realmente aplican al programa completo;
- una fuente pública oficial de PUCP sin parámetros de sesión;
- evidencia breve que permita auditar las fechas.

Los ciclos de verano deben ser registros separados. Si su calendario contiene recesos o numeración especial, se añaden intervalos explícitos en `weeks`; el servidor no inventa semanas para los huecos.

Antes de publicar una edición, actualiza `updatedAt`, ejecuta `npm test` y comprueba que no existan fechas provisionales presentadas como definitivas. No agregues ciclos futuros hasta que una fuente oficial publique sus fechas.

`set_academic_calendar` permanece disponible para un respaldo local verificado, pero ya no es un paso obligatorio del primer uso.
