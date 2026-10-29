# Plan de Corrección: Cámara Continua In-App (ContinuousCamera)

Este plan detalla la arquitectura y corrección para garantizar una cámara continua de **un toque = una foto** (sin ráfagas automáticas), con componentes desacoplados, callbacks estables, gestión blindada del historial en Android y control fiable de gestos táctiles y hardware.

---

## 1. Diagnóstico de la Causa Raíz

1. **Re-renderizados y Reinicio Constante del Stream**:
   - En `src/App.tsx`, las funciones pasadas como props a `<ContinuousCamera />` (`onCapturePhoto`, `onClose`, etc.) se generaban como funciones flecha anónimas en línea.
   - Cada render de `App` (provocado por timers, listeners de cuota, o por la actualización de `currentInventory` al guardar fotos) recreaba estas referencias.
   - En `ContinuousCamera.tsx`, el `useEffect` que inicializaba la cámara dependía de `startCamera` y `stopTracks`, que a su vez dependían de `stream` y de las props de `App`. Esto provocaba que el componente reiniciara el stream o vaciara `sessionPhotos` a `[]` en cada render.
2. **Dependencia errónea de `targetSpaceId` global**:
   - El manejador tradicional `handlePhotoCapture` ejecutaba `setTargetSpaceId(null)` tras la primera foto, dejando sin destino a capturas subsiguientes si se dependía del estado global en vez de la prop inmutable del modal.
3. **Falta de Validación Previa de Video / Canvas**:
   - Si se disparaba antes de que `video.readyState >= 2` o con `videoWidth === 0`, el canvas no dibujaba nada o `canvas.toBlob` generaba un blob nulo o de 0 bytes, fallando silenciosamente tras haber mostrado el destello.
4. **Desconexión entre el Destello y el Guardado Real**:
   - La retroalimentación visual no debe asumir éxito; el incremento del contador y la miniatura deben actualizarse únicamente cuando `addPhotosToTarget` resuelva de manera exitosa en IndexedDB.

---

## 2. Decisiones de Arquitectura y Ajustes Aprobados

```
┌────────────────────────────────────────────────────────────────────────┐
│                                App.tsx                                 │
│  - Callbacks estables (useCallback) para todas las operaciones         │
│  - Destino inmutable pasado como prop: { type, spaceId, capturedAt }   │
│  - handlePopState global ignora el evento si continuousCamera está     │
│    abierta, previniendo navegación no deseada a 'list'                 │
│  - Pausa de PhotoSyncEngine con 4 salvaguardas de reanudación          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Props estables + React.memo
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                     ContinuousCamera (Componente Memo)                 │
│  - Stream useEffect depende ÚNICAMENTE de isOpen                       │
│  - closeCamera() unificado: consume entrada de historial con           │
│    history.back() en Listo, X, fallback, error o botón Atrás           │
│  - Watchdog de 4 s arranca SOLO cuando getUserMedia resuelve (permiso  │
│    concedido), no durante el diálogo nativo de permisos                │
│  - Pantalla interna de fallback con botón táctil directo ("Abrir       │
│    cámara del sistema") para evitar bloqueo de gestos del navegador    │
│  - Timestamp exacto del instante del disparo (capturedAt = Date.now()) │
│  - Captura Canvas por defecto con validación estricta de blob          │
│  - Shutter: valida video.readyState >= 2 & width > 0 antes de destello │
│  - Contador y miniatura SOLO tras persistencia exitosa                 │
│  - HUD de diagnóstico con toque sostenido (600ms) en contador          │
│  - Wake Lock de pantalla activo mientras esté abierta                  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Especificación Técnica Detallada de Cambios

### 1. Gestión Unificada de Historial y `closeCamera()`
- **Apertura de Cámara**:
  ```ts
  window.history.pushState({ view: view, continuousCamera: true }, '');
  cameraHistoryEntryPushedRef.current = true;
  ```
- **Cierre Unificado (`closeCamera`)**:
  - Función centralizada invocada por todas las vías de salida: botón "Listo", botón "X", pantalla de error/fallback o botón físico/gesto "Atrás".
  - Si la entrada superior en el historial es la de la cámara (`cameraHistoryEntryPushedRef.current` o `window.history.state?.continuousCamera`), ejecuta `window.history.back()`.
  - Desactiva el flag para no duplicar retrocesos.
- **Protección en `handlePopState` Global de `App.tsx`**:
  ```ts
  const handlePopState = (event: PopStateEvent) => {
    // Si la cámara continua está abierta, el evento le pertenece y no debe alterar la vista del inventario
    if (continuousCamera.open) {
      return;
    }
    if (event.state && event.state.view) {
      setView(event.state.view);
    } else {
      setView('list');
    }
  };
  ```

### 2. Pantalla de Fallback Interactiva (Sin llamadas automáticas a `.click()`)
- Los navegadores y WebViews de Android bloquean `.click()` sobre inputs de archivo cuando provienen de temporizadores (`setTimeout`) o callbacks asíncronos de error.
- En caso de error de `getUserMedia` (permiso denegado, dispositivo ocupado) o expiración del watchdog de video:
  - Cierra de inmediato los tracks del stream.
  - Renderiza una pantalla de fallback interna dentro de `ContinuousCamera`:
    - Icono de aviso y mensaje explicativo del motivo del error.
    - Botón primario prominente: **"Abrir cámara del sistema"** (su evento táctil `onClick` invoca de forma síncrona `onOpenSystemCamera()`).
    - Botón secundario: **"Abrir Galería"** (invoca síncronamente `onOpenGallery()`).
    - Botón de cancelación / volver al inventario.

### 3. Watchdog de 4 Segundos tras Concesión de Permiso
- El watchdog **NO** se inicia al abrir el modal, protegiendo el tiempo que el usuario tarda en aceptar el diálogo nativo de permisos de Android/navegador.
- **Inicio**: Arranca exactamente cuando `navigator.mediaDevices.getUserMedia(...)` resuelve exitosamente la promesa.
- **Evaluación**: Si tras 4.000 ms desde la resolución el elemento `<video>` no ha alcanzado `readyState >= 2` y `videoWidth > 0`, cancela el stream y activa la pantalla interna de fallback.

### 4. Pausa Blindada de Subida de Fotos (`PhotoSyncEngine`)
- Mientras la cámara esté abierta, se suspende la subida de fotos a Firebase (`photoSyncEngine.pause()`) para liberar el 100% de CPU, RAM y bus de datos en favor de la captura.
- **Garantía absoluta de reanudación (`photoSyncEngine.resume()`) en 4 salvaguardas**:
  1. En la función `closeCamera()` al cerrar la cámara.
  2. En la función de limpieza (`cleanup`) del `useEffect` al desmontar el componente.
  3. En el listener de ciclo de vida cuando la app pasa a segundo plano (`document.visibilityState === 'hidden'`).
  4. **Seguro por tiempo límite (Watchdog de 15 minutos)**: Un temporizador `setTimeout` de 900.000 ms que ejecuta `photoSyncEngine.resume()` incondicionalmente, garantizando que nunca quede pausada de manera permanente.

### 5. Timestamp Fidedigno del Instante del Disparo
- Al presionar el obturador táctil, se captura de inmediato:
  ```ts
  const capturedAt = Date.now();
  ```
- Este timestamp se envía junto con el archivo a través del flujo unificado:
  ```ts
  addPhotosToTarget(files, { type, spaceId, capturedAt })
  ```
- `uploadPhotoWithFallback` asigna `capturedAt` como el `timestamp` oficial de la foto (en lugar del momento en que finaliza la compresión o el guardado en IndexedDB).

### 6. Shutter, Cola y Retroalimentación Fidedigna
- **Validación previa al disparo**:
  ```ts
  if (!video || video.readyState < 2 || video.videoWidth === 0) {
    showToast('La cámara aún no está lista', 'warning');
    return;
  }
  if (captureQueueRef.current.length >= 20) {
    showToast('Cola llena (máx. 20 fotos). Espera a que se guarden las pendientes.', 'warning');
    return;
  }
  ```
- **Captura Canvas**:
  - Dibuja el fotograma en canvas según `video.videoWidth` y `video.videoHeight`.
  - Verifica que `canvas.toBlob` entregue un blob válido y con tamaño mayor a 0 bytes.
  - Ejecuta el destello visual de pantalla (`setIsFlashing(true)`) y la vibración háptica (`navigator.vibrate(15)`).
- **Contador y Miniatura**:
  - No se incrementan por adelantado.
  - Se actualizan **únicamente** cuando `onCapturePhoto` resuelve con éxito con la foto guardada en IndexedDB.
  - Si ocurre un fallo en el guardado, se presenta un toast de error con el detalle y no sube el contador.

### 7. Panel de Diagnóstico HUD (Toque Largo)
- Pulsación sostenida de 600 ms sobre el encabezado del contador muestra un panel técnico superpuesto con:
  - Estado del stream: `"iniciando"` | `"lista"` | `"error: <nombre>"`.
  - Resolución del sensor: `${videoWidth}x${videoHeight}`.
  - Conteo de sesión: `{guardadas}` / `{intentadas}`.
  - Longitud de cola en espera.
  - Último error registrado.

---

## 4. Criterios de Aceptación y Verificación

1. **Un toque = Una foto**: Tocar el obturador captura una sola foto por toque; la cámara permanece abierta y lista para el siguiente disparo sin disparos automáticos.
2. **Estabilidad del Stream**: El visor de video no parpadea ni se reinicia al guardar una foto ni ante renders externos en `App.tsx`.
3. **Persistencia Fidedigna**: El contador y la miniatura solo se actualizan cuando la foto se guarda efectivamente en el espacio o anexo correspondiente.
4. **Navegación e Historial en Android**:
   - Presionar "Atrás" en Android mientras la cámara continua está abierta cierra **única y exclusivamente la cámara continua**.
   - Cerrar la cámara por cualquier vía (Listo, X, Atrás o Fallback) y posteriormente presionar "Atrás" regresa al listado o vista anterior según el flujo normal, sin salir del inventario ni desfasar la navegación.
5. **Fallback sin Bloqueo de Gestos**: Si el permiso falla o el watchdog expira, muestra botones táctiles directos que abren la cámara del sistema o la galería sin ser bloqueados por el navegador.
6. **Watchdog Condicionado**: El tiempo de espera de 4 s no penaliza el diálogo de permisos del sistema operativo.
7. **Reanudación Garantizada del Sync Engine**: La subida de fotos se reanuda al cerrar, al minimizar, al desmontar o tras 15 minutos de inactividad.
8. **Compilación y Linteo**: `compile_applet` y `lint_applet` limpios con 0 errores, y validación correcta con `android-patch.py`.
