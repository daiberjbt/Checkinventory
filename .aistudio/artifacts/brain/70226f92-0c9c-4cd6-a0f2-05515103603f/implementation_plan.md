# Plan de Implementación: Cámara Continua Integrada (ContinuousCamera)

Este plan detalla la arquitectura e integración del componente **ContinuousCamera** para permitir la captura ininterrumpida y secuencial de fotografías dentro de la aplicación con un solo toque, manteniendo intacta la lógica de almacenamiento local en IndexedDB y la cola de sincronización.

---

## 1. Nuevo Flujo de Apertura Directa

### 1.1 Eliminación del paso intermedio `photoSourceModal`
- Al presionar **"+ Añadir fotos"** o el botón de cámara en cualquier **espacio** del inventario o en la sección de **anexos**:
  - Ya **no** se mostrará la ventana flotante `photoSourceModal` (que forzaba a elegir entre Cámara o Galería).
  - Se abrirá directamente a pantalla completa el nuevo componente `ContinuousCamera`.
  - Se pasa el destino activo: `{ type: 'space' | 'annex', spaceId?: string, spaceName?: string }`.
  - Las opciones alternativas (Galería y Cámara del sistema nativa) estarán accesibles directamente desde la propia interfaz de `ContinuousCamera` mediante botones dedicados en la barra de herramientas.

---

## 2. Componente `ContinuousCamera` (`src/components/ContinuousCamera.tsx`)

Se creará un componente dedicado, optimizado para dispositivos móviles y escritorio, con diseño a pantalla completa sobre fondo negro inmersivo.

### 2.1 Captura de Video y Hardware
- **Stream de Cámara**:
  - Invocación con restricciones óptimas:
    ```ts
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    })
    ```
  - Renderizado en `<video ref={videoRef} playsInline muted autoPlay className="w-full h-full object-cover" />`.
- **Detección de Linterna (Torch)**:
  - Al iniciar el stream, inspecciona `track.getCapabilities?.().torch`.
  - Si está soportado, habilita un botón de linterna que alterna `track.applyConstraints({ advanced: [{ torch: isTorchOn }] })`.

### 2.2 Disparo Instantáneo y Retroalimentación
- **Botón de Disparo**:
  - Botón circular prominente y centrado en la parte inferior (diámetro 72-80 px) con aro exterior y pulsación táctil responsiva.
- **Mecanismo de Captura Ultra-Rápida**:
  1. Si `window.ImageCapture` está disponible en el `videoTrack`, se utiliza `imageCapture.takePhoto()` para obtener el fotograma con resolución nativa del sensor.
  2. Si no está soportado o falla, se dibuja de inmediato el fotograma actual del `<video>` en un `<canvas width={videoWidth} height={videoHeight}>` y se genera el Blob JPEG vía `canvas.toBlob(..., 'image/jpeg', 0.92)`.
  3. La cámara **no se cierra ni se bloquea**; permanece lista inmediatamente para el siguiente disparo.
- **Retroalimentación Inmediata**:
  - **Destello de pantalla**: Capa blanca semitransparente con animación de flash (`100ms`).
  - **Vibración háptica**: `if ('vibrate' in navigator) navigator.vibrate(15);`.

---

## 3. Cola de Procesamiento y Persistencia Unificada

### 3.1 Función Compartida `addPhotosToTarget`
Se extrae la lógica común de procesamiento de imágenes de `handlePhotoCapture` y `handleAnnexPhotoCapture` hacia una función reutilizable:
```ts
addPhotosToTarget(
  files: File[], 
  target: { type: 'space' | 'annex'; spaceId?: string }
): Promise<Photo[]>
```
- Realiza el redimensionamiento estándar (máx. 900px, JPEG compresión), genera el ID único, guarda el Blob en IndexedDB (`offlinePhotoDb`) con estado `pending`, y retorna el objeto liviano `Photo`.
- Actualiza de forma segura el estado de React (`currentInventory.spaces` o `annexPhotos`).
- Es utilizada tanto por `ContinuousCamera` como por los inputs de archivo tradicionales (`cameraInputRef`, `galleryInputRef`, `annexCameraInputRef`, `annexGalleryInputRef`).

### 3.2 Cola Secuencial en Segundo Plano (Background Queue)
- En `ContinuousCamera`, cada disparo convierte el Blob capturado en un `File` (`photo_timestamp_uuid.jpg`) y lo añade a una cola en memoria (`queueRef`).
- Un despachador asíncrono procesa las fotos **de una en una** llamando a `addPhotosToTarget([file], target)`.
- **Beneficios**:
  - El usuario puede presionar el obturador tantas veces como desee sin lag ni congelamiento del visor.
  - Evita picos de consumo de memoria RAM en dispositivos de gama media o baja.
  - Al completar cada foto, se actualiza el contador de la sesión y la miniatura activa.

---

## 4. Interfaz de Usuario de `ContinuousCamera`

- **Barra Superior**:
  - Título con el nombre del espacio actual (ej. *"Cocina"*, *"Dormitorio Principal"*, o *"Anexo"*).
  - Contador dinámico: `"{N} fotos tomadas"`.
  - Botón de **Linterna** (condicional según capacidades del dispositivo).
  - Botón **"Listo" / Cerrar**: Cierra la cámara y vuelve al inventario; todas las fotos tomadas en la sesión quedan conservadas.
- **Barra Inferior**:
  - **Centro**: Botón de obturador grande.
  - **Izquierda**: Miniatura de la última foto tomada en la sesión actual:
    - Debajo o junto a ella, botón **"Deshacer"**: elimina exclusivamente la última foto tomada en esta sesión (usando `removePhoto` o `removeAnnexPhoto`), liberando el Blob de IndexedDB y retrocediendo la miniatura y el contador.
  - **Acciones Rápidas Alternativas**:
    - Botón **"Galería"**: Invoca `galleryInputRef.current?.click()` permitiendo seleccionar fotos del carrete sin fricción.
    - Botón **"Cámara del sistema"**: Invoca `cameraInputRef.current?.click()` para aquellos casos donde el usuario prefiera la app nativa de su teléfono.

---

## 5. Manejo de Errores y Fallback Automático

- Si `navigator.mediaDevices?.getUserMedia` no existe (navegadores antiguos o entornos no compatibles) o el usuario deniega el permiso de cámara (`NotAllowedError` / `PermissionDeniedError`):
  1. Cierra `ContinuousCamera` limpiamente.
  2. Muestra un toast breve: *"Permiso de cámara denegado o no disponible. Abriendo cámara del sistema..."*.
  3. Dispara automáticamente el click de `cameraInputRef` (o `annexCameraInputRef`), asegurando que el usuario pueda tomar fotos sin perder el destino actual.

---

## 6. Ciclo de Vida y Resiliencia en Android/Web

1. **Liberación de Hardware**:
   - Detiene todos los `MediaStreamTrack` (`track.stop()`) al cerrar la cámara o al desmontar el componente.
2. **Segundo Plano (`visibilitychange`)**:
   - Escucha `document.addEventListener('visibilitychange', ...)`:
     - Si la pestaña o aplicación se oculta (`visibilityState === 'hidden'`), apaga los tracks de video para ahorrar batería y no bloquear el hardware del teléfono.
     - Al volver al primer plano (`visibilityState === 'visible'`), reactiva el stream si el visor sigue abierto.
3. **Botón Atrás de Android (Integración con Historial)**:
   - Al abrir `ContinuousCamera`, ejecuta `window.history.pushState({ continuousCamera: true }, '')`.
   - Escucha el evento `popstate`: si el usuario presiona el botón físico o gesto de "Atrás" de Android, cierra la cámara sin salir del inventario.
   - Al pulsar "Listo" o cerrar manualmente, si el estado de historial fue insertado, se ejecuta `window.history.back()`.
4. **Limpieza de Recursos**:
   - Revocación de URLs temporales creadas para las miniaturas mediante `URL.revokeObjectURL(...)`.

---

## 7. Archivos a Modificar / Crear

| Archivo | Cambios Planificados |
| :--- | :--- |
| `src/components/ContinuousCamera.tsx` *(Nuevo)* | Componente de cámara continua a pantalla completa: getUserMedia, ImageCapture/canvas fallback, destello/vibración, cola secuencial, linterna, miniatura con deshacer, accesos a galería y cámara de sistema. |
| `src/App.tsx` | - Extraer `addPhotosToTarget` a partir de `handlePhotoCapture` y `handleAnnexPhotoCapture`.<br>- Actualizar los disparadores de "+ Añadir foto" para abrir directamente `ContinuousCamera`.<br>- Montar `ContinuousCamera` en el árbol de componentes.<br>- Mantener intactos los inputs ocultos de archivo y funciones auxiliares. |

---

## 8. Verificación y Pruebas

1. **Ráfaga de Captura**: Disparar 5-10 fotos en rápida sucesión; verificar que no hay bloqueos de UI, que el contador sube en tiempo real y que el destello/vibración ocurre en cada disparo.
2. **Acción Deshacer**: Tomar fotos, pulsar "Deshacer" y comprobar que solo se elimina la última capturada en IndexedDB y del estado visual.
3. **Persistencia & Cola**: Comprobar que al cerrar la cámara ("Listo"), todas las fotos tomadas aparecen listadas en el espacio correspondiente con la etiqueta "Local" listas para sincronizar.
4. **Fallback de Permisos**: Probar bloqueo o no disponibilidad de `getUserMedia` y comprobar que abre la cámara del sistema con un toast explicativo.
5. **Ciclo de Vida y Botón Atrás**: Comprobar que minimizar la app apaga la cámara, que el botón atrás de Android cierra la cámara limpiamente y que la linterna funciona si el hardware lo soporta.
6. **Compilación y Linteo**: Ejecutar `compile_applet` y `lint_applet` con 0 errores, y validar compatibilidad con `android-patch.py`.
