# Horario PUCP en HTML

Usa este recurso cuando el estudiante pida el horario elegido, final o posible
como archivo HTML. Todos esos pedidos usan el mismo formato.

## Datos

Construye un JSON UTF-8 con esta estructura:

```json
{
  "term": "2026-2",
  "credits": 22,
  "courses": [
    {
      "code": "CUR101",
      "name": "Nombre del curso",
      "credits": 3.5,
      "scheduleId": "0101",
      "instructor": "Docente",
      "classes": "Lun 08:00–10:00",
      "practice": "—",
      "exams": "Vie 15:00–18:00"
    }
  ],
  "sessions": [
    {
      "day": 1,
      "start": "08:00",
      "end": "10:00",
      "type": "class",
      "courseCodes": ["CUR101"],
      "scheduleId": "0101",
      "title": "Nombre del curso",
      "room": "A101",
      "instructor": "Docente",
      "weeksLabel": ""
    }
  ]
}
```

`day` usa 1 para lunes y 6 para sábado. `type` admite `class`, `lab` o
`exam`. Omite `weeksLabel` cuando no corresponda. Conserva exactamente las
claves, secciones, docentes, aulas y sesiones obtenidas del Campus; no las
inventes.

## Generación

Desde la carpeta de esta skill ejecuta:

```powershell
node scripts/render-schedule.mjs --data RUTA_DATOS.json --output RUTA_HORARIO.html --force
```

El script usa `assets/horario-pucp.html` y entrega un único HTML autocontenido.
No edites el CSS ni el JavaScript para cada estudiante: cambia solamente el
JSON. La plantilla distribuye en carriles horizontales y muestra lado a lado las
clases, prácticas o exámenes que se superponen; los filtros recalculan los
carriles usando solo las actividades visibles. No incluyas nombre, código de
alumno, credenciales, cookies ni otros datos personales. Antes de entregar,
confirma que los créditos y el número de cursos y sesiones coincidan con la
selección consultada.
