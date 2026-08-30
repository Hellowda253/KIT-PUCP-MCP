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
      "exams": "Vie 15:00–18:00",
      "examStatus": "published"
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

`examStatus` distingue tres estados: `published` cuando Campus publicó el
examen y deben existir sus sesiones `type: "exam"`; `not_published` únicamente
cuando Campus confirma que no hay información de examen publicada; y `unknown`
cuando todavía falta consultar el detalle. El renderizador rechaza `unknown` y
también exige `examStatus` si `exams` está vacío. Los datos antiguos que ya
declaran un examen conservan compatibilidad y se interpretan como publicados.

## Generación

Sigue este flujo cuando el estudiante pida el archivo:

1. Obtén los cursos y todas sus sesiones desde Campus. Para el horario personal
   usa `get_student_schedule`; para una opción recomendada parte del resultado
   de `recommend_course_schedules` y consulta cualquier detalle faltante.
2. Construye el JSON anterior. No copies otro HTML y no escribas uno desde cero.
   Cada curso que declare exámenes en `courses[].exams` debe tener al menos una
   sesión independiente con `type: "exam"` y su clave en `courseCodes`; no
   conviertas el texto de la tabla en una sesión ni omitas las tarjetas rojas.
   No cambies `exams` a `"-"` para sortear una validación: vuelve a consultar
   `get_course_schedule_details`. El renderizador devuelve los cursos y horarios
   faltantes junto con esa acción recomendada.
3. Separa varios docentes con ` / `; no concatenes sus nombres. Conserva los
   nombres oficiales en el JSON. El renderizador crea etiquetas abreviadas y
   evita mostrar los títulos completamente en mayúsculas.
4. Desde la carpeta de esta skill ejecuta:

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

Abre el HTML generado y verifica visualmente que aparezcan todos los cursos y
sesiones; que cada sesión tenga tipo, hora, aula y docente cuando Campus los
publique; y que clases, prácticas y exámenes no hayan sido fusionados. Los
cruces deben aparecer lado a lado y el contenido completo debe revelarse al
pasar el puntero o enfocar la tarjeta. Si falta información, vuelve a consultar
Campus y regenera el archivo; no edites manualmente el HTML para ocultarlo.
Abre también la vista previa de impresión en A4 horizontal: la cuadrícula debe
quedar completa en la primera página, sin texto cortado; el detalle tabular va
en la página siguiente. Activa «Gráficos de fondo» para conservar los colores y
desactiva «Encabezados y pies de página» para aprovechar toda la hoja.
