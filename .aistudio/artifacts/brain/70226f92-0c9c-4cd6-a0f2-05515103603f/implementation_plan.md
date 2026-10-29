# Plan de Implementación: Prevención y Limpieza de Fotos Huérfanas

Este plan detalla la arquitectura para evitar que queden fotografías huérfanas en la cola local de sincronización (`offlinePhotoDb`) cuando un usuario sale de un inventario nuevo sin haberlo guardado, protegiendo tanto la navegación por botones de la interfaz como el botón físico/gesto "Atrás" de Android, e incorporando un módulo de limpieza manual para fotos huérfanas existentes.

---

## 1. Situación Actual y Causa Raíz

1. **Salida sin Guardar en `handleBack` y `handleGoHome`**:
   - Si un inventario está en modo borrador pero aún no cuenta con `propertyName` y `address` (campos mínimos requeridos para crear el documento), las funciones limpian `currentInventory = null` y navegan a la lista sin eliminar los registros creados en `photo_sync_queue` de IndexedDB.
   - Las fotos tomadas durante esa sesión continúan en la cola local de subida de forma permanente.
2. **Botón Atrás de Android (`handlePopState`)**:
   - Si el usuario presiona "Atrás" en Android mientras está en `view === 'create'`, el listener actual simplemente ejecuta `setView('list')`, sin validar si hay cambios sin guardar, sin invocar `handleBack` y sin limpiar las fotos pendientes.
3. **Fotos Huérfanas Acumuladas**:
   - En dispositivos donde ya se descartaron inventarios incompletos en el pasado, los blobs siguen ocupando espacio en IndexedDB y el Sync Engine intenta procesarlos periódicamente.

---

## 2. Decisiones de Arquitectura y Flujos

```
                                    Usuario pulsa Atrás / Inicio / PopState
                                                      │
                                                      ▼
                                       ┌─────────────────────────────┐
                                       │    requestExit(destino)     │
                                       └──────────────┬──────────────┘
                                                      │
                                    ¿view === 'create' y borrador?
                                      /                            \
                                   (NO)                            (SÍ)
                                   /                                  \
                     Navegar directo al destino             ¿Tiene trabajo ingresado?
                                                            (fotos o campos de texto)
                                                               /                   \
                                                            (NO)                   (SÍ)
                                                            /                         \
                                             deletePhotosByInventory(id)    ¿Tiene nombre y dirección?
                                             y salir en silencio              /                    \
                                                                            (SÍ)                   (NO)
                                                                            /                         \
                                                                  Guardar borrador            Mostrar diálogo
                                                                  y salir al destino         ExitDraftDialog
                                                                                             ┌───────────────┐
                                                                                             │- Seguir       │
                                                                                             │- Guardar      │
                                                                                             │- Descartar    │
                                                                                             └───────────────┘
```

---

## 3. Especificación Técnica de los Cambios

### 3.1 Función Única `requestExit(destino: 'home' | 'back' | 'popstate')`
Se centraliza la lógica de salida en `src/App.tsx`:
1. **Detección de Inventario No Guardado**:
   - Se considera no guardado si `currentInventory.id` no existe en la lista en memoria `inventories` (que incluye tanto inventarios de Firestore como borradores guardados localmente) y no está en proceso de guardado activo.
2. **Evaluación de Trabajo Ingresado (`hasWork`)**:
   - **Fotos**: `getPendingPhotosByInventory(id).length > 0` o fotos presentes en memoria en los espacios o anexos (`spaces.some(s => s.photos.length > 0)` o `annexPhotos.length > 0`).
   - **Campos de Texto**: contenido no vacío en `propertyName`, `address`, `ownerName`, `tenantName`, `internalCode`, `generalObservations`, o descripciones/detalles de los ítems de los espacios.
3. **Casos de Decisión**:
   - **Caso 1: Sin trabajo (`!hasWork`)**:
     - Ejecuta `await deletePhotosByInventory(currentInventory.id)` para limpiar cualquier posible residuo en IndexedDB.
     - Limpia `currentInventory = null`, firmas y estados temporales.
     - Navega en silencio al destino.
   - **Caso 2: Con trabajo y campos obligatorios completos (`propertyName` y `address`)**:
     - Mantiene el comportamiento actual: guarda el borrador con `await saveInventory(currentInventory)` y navega. Las fotos quedan asociadas al borrador y continúan su subida normal.
   - **Caso 3: Con trabajo pero faltan nombre o dirección**:
     - Detiene la salida y abre `ExitDraftDialog`.
     - Si la llamada provino de `handlePopState`, restaura de inmediato la entrada en el historial con `window.history.pushState({ view: 'create' }, '')` para que el navegador no saque al usuario de la pantalla.

### 3.2 Componente `ExitDraftDialog` (`src/components/ExitDraftDialog.tsx`)
Nuevo modal de confirmación con diseño limpio y accesible:
- **Mensaje**:
  - *"Este inventario aún no se ha guardado. Si sales ahora perderás {N fotos y} los datos ingresados."* (calcula dinámicamente si hay fotos y pluraliza: *"1 foto y"*, *"3 fotos y"*, o solo *"los datos ingresados"* si no hay fotos).
- **Acciones**:
  1. **"Seguir editando"** (botón principal destacado):
     - Cierra el diálogo y mantiene al usuario en el editor del inventario sin alterar el estado.
  2. **"Guardar borrador"**:
     - Si faltan `propertyName` o `address`: no sale, cierra el diálogo (o muestra toast), hace scroll al inicio del formulario y resalta los campos con borde de atención y el mensaje *"Completa nombre y dirección para guardar"*.
     - Si están completos: ejecuta `saveInventory(currentInventory)` y navega al destino pendiente.
  3. **"Descartar"** (botón rojo / destructivo):
     - Ejecuta `await deletePhotosByInventory(currentInventory.id)`.
     - Actualiza `pendingLocalPhotos` y `globalPendingPhotos` eliminando las fotos del inventario descartado.
     - Limpia `currentInventory = null`, firmas y URLs de miniaturas.
     - Muestra toast: *"Inventario descartado"*.
     - Navega a la lista (`navigateTo('list')`).

### 3.3 Intercepción del Botón Atrás de Android (`handlePopState`)
- Se actualiza `handlePopState` en `src/App.tsx`:
  - Si la cámara continua está abierta (`continuousCameraOpenRef.current`), la cámara consume el evento (comportamiento actual preservado).
  - Si `view === 'create'`:
    - Evalúa si el inventario actual requiere confirmación.
    - Si requiere confirmación, ejecuta `window.history.pushState({ view: 'create' }, '')` y abre el diálogo.
    - Si no requiere confirmación (no hay trabajo o ya estaba guardado), procede con la salida limpia.

### 3.4 Limpieza de Fotos Huérfanas Existentes en `SyncStatusSheet`
- En `SyncStatusSheet.tsx` (y lógica de detección en `src/App.tsx` o helper dedicado):
  - Analiza `globalPendingPhotos`.
  - Agrupa las fotos pendientes por `inventoryId`.
  - Excluye el inventario actualmente abierto en edición.
  - Comprueba contra la lista local `inventories`. Si no existe localmente y la app está en línea, valida mediante `getDoc(doc(db, 'inventories', invId))` si el inventario existe en Firestore.
  - Aquellos grupos cuyo inventario no exista ni en local ni en la nube se catalogan como **"Fotos sin inventario"**.
- **Interfaz en `SyncStatusSheet`**:
  - Sección *"Fotos sin inventario"* con advertencia informativa.
  - Para cada grupo huérfano muestra:
    - Cantidad de fotos (ej. *"3 fotos huérfanas"*).
    - Antigüedad (ej. *"Tomadas hace 2 días"* o fecha formateada).
    - Botón **"Descartar"** con icono de papelera.
  - Al pulsar "Descartar", solicita confirmación con diálogo breve y, al aceptar, ejecuta `deletePhotosByInventory(invId)` y refresca el contador de la cola.
  - **Regla estricta**: Ninguna foto huérfana se borra de manera automática sin la acción expresa del usuario.

---

## 4. Archivos a Modificar / Crear

| Archivo | Cambios Planificados |
| :--- | :--- |
| `src/components/ExitDraftDialog.tsx` *(Nuevo)* | Componente modal con diseño accesible para confirmar salida de borrador no guardado (Seguir editando, Guardar borrador, Descartar). |
| `src/App.tsx` | - Implementar `requestExit(destino)`.<br>- Actualizar `handleBack`, `handleGoHome` y `handlePopState` para invocar `requestExit`.<br>- Renderizar `ExitDraftDialog`.<br>- Proveer lógica de detección y descarte de fotos huérfanas para `SyncStatusSheet`. |
| `src/components/SyncStatusSheet.tsx` | Añadir sección visual de "Fotos sin inventario" con lista de grupos huérfanos y botón interactivo de descarte por confirmación. |

---

## 5. Criterios de Aceptación y Verificación

1. **Inventario Vacío**: Crear inventario sin ingresar texto ni fotos y tocar Atrás o Home → Sale directamente a la lista sin diálogos ni errores.
2. **Inventario con Fotos sin Nombre/Dirección**: Crear inventario, tomar 2 fotos, tocar botón Atrás/X → Se muestra `ExitDraftDialog` con el aviso *"perderás 2 fotos y los datos ingresados"*.
3. **Acción Descartar**: Al pulsar "Descartar", `deletePhotosByInventory` elimina las 2 fotos de IndexedDB; el contador de fotos pendientes en el encabezado queda en 0 y se regresa a la lista.
4. **Acción Guardar Borrador**: Con fotos tomadas pero sin nombre/dirección, pulsar "Guardar borrador" no sale, resalta los campos obligatorios y muestra *"Completa nombre y dirección para guardar"*. Al completarlos y guardar, las fotos se conservan y se suben normalmente.
5. **Botón Atrás de Android**: Presionar Atrás en el teléfono en un inventario con fotos sin guardar abre el mismo diálogo `ExitDraftDialog` sin salir del inventario.
6. **No Interferencia con Cámara Continua**: Con la cámara continua abierta, presionar Atrás en Android sigue cerrando solo la cámara sin disparar el diálogo de borrador.
7. **Limpieza Manual en SyncStatusSheet**: Las fotos huérfanas existentes en la base local aparecen agrupadas con su antigüedad y pueden ser descartadas manualmente tras confirmación.
