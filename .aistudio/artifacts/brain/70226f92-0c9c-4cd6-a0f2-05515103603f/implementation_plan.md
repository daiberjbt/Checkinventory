# Rediseño de Almacenamiento y Sincronización de Fotos a Gran Escala (Revisado)

Plan de arquitectura e implementación para escalar el almacenamiento de fotografías a cientos de fotos por inventario desacoplándolas del documento principal mediante la subcolección `inventories/{id}/photos/{photoId}`, almacenamiento seguro en Firebase Storage según `storage.rules`, miniaturas optimizadas `_thumb`, subida concurrente (concurrencia 3), sincronización sin reescritura de inventarios y retrocompatibilidad estricta.

> [!IMPORTANT]
> **Ajustes y Correcciones Confirmadas Incorporadas en Esta Revisión:**
> 1. **NO Re-incrustar Fotos en Firestore**: En `saveInventory` y `confirmFinalSave`, `spaces[].photos` y `annexes[].photos` mantendrán **únicamente** las fotos históricas que ya venían embebidas en el documento antes de la migración. Nunca se re-incrustarán fotos de la subcolección ni fotos locales/pendientes (`localBlobId`, `pending`, `uploading`, `failed`).
> 2. **Conteo en Tarjetas y PDF**: Las tarjetas de inventario y la generación del PDF utilizarán `photoCount` (a nivel inventario y `annex.photoCount` en cada anexo) en lugar de `spaces[].photos.length`.
> 3. **Ruta Exacta en Storage**: Se usará estrictamente la ruta configurada en `storage.rules`:  
>    `tenants/{adminUid}/photos/{userUid}/{photoId}.jpg`  
>    `tenants/{adminUid}/photos/{userUid}/{photoId}_thumb.jpg`  
>    (confirmado que `storage.rules` ya valida y permite cualquier `fileName` de imagen en esa jerarquía).
> 4. **Timestamp Estricto de Captura**: El `timestamp` guardado en el documento de la subcolección será **siempre** la fecha/hora en que se capturó la foto original (`record.createdAt` o `photo.timestamp`), nunca `Date.now()` al momento de la subida. Esto garantiza que las fotos capturadas durante la inspección antes de firmar sean admitidas por la regla de seguridad (`timestamp <= completedAt + 300000`).
> 5. **Anexos con `photoCount`**: Al crear o editar un anexo se persistirá `annexes[i].photoCount` con el total de fotos del anexo. Sus fotos se suben a la subcolección con `annexId` (sin `spaceId`). El PDF y las tarjetas mostrarán `annex.photoCount`.
> 6. **Fotos Pendientes Existentes y Fallback de Miniatura**: Los registros locales de IndexedDB que no tengan `thumbBlob` generarán su miniatura dinámicamente desde el blob original antes de subir. Si la generación en canvas falla, la foto se subirá sin `thumbUrl` (nunca se bloqueará una subida por falla de miniatura). Las fotos pendientes que hoy figuren en `spaces[].photos` con `pending`/`localBlobId` se enviarán a la subcolección usando su mismo ID original.
> 7. **Reemplazo Total de `src/photos.ts`**: Se reescribe desde cero `src/photos.ts`, eliminando todo código o prototipo obsoleto y proveyendo utilidades puras y tipadas (`getPhotosOf`, `fetchPhotos`, `subscribePhotos`, `deleteAllPhotos`, `stripPhotosForSave`).
> 8. **Reglas de Seguridad Exactas**: Se incorporan literalmente las reglas de `inventories/{inventoryId}/photos/{photoId}` solicitadas por el usuario y se actualiza `isValidInventory` para admitir `photoCount`.

---

## 1. Visión General y Concepto Central

### Qué Resuelve
Elimina la saturación del documento de inventario generada por transacciones sobre `spaces[].photos` durante la sincronización de fotos. Al transferir cada imagen a su propio documento en la subcolección `inventories/{inventoryId}/photos/{photoId}`, el documento padre permanece liviano e inmutable durante la subida, soportando cientos de fotos sin riesgo de alcanzar el límite de 1 MB ni provocar denegación de permisos en documentos completados.

---

## 2. Experiencia de Usuario y Diseño Visual

### Banner Global de Fotos Pendientes
- **Ubicación**: Visible en toda la app debajo del header.
- **Información**: Conteo de fotos locales pendientes de sincronizar (`"N fotos pendientes de sincronizar con la nube"` o último motivo de fallo).
- **Acción**: Botón *"Reintentar ahora"* que dispara `photoSyncEngine.triggerSync()`.

### Aviso No Bloqueante en Finalización (`confirmFinalSave`)
- Si hay fotos pendientes locales asociadas al inventario actual al presionar *"Finalizar y Firmar"*, se notifica al usuario con un diálogo informativo sin impedir la firma ni el guardado del acta.

### Galerías y Visor de Fotos
- **Miniaturas Ligeras**: `PhotoThumb` cargará `thumbUrl` en cuadrículas, con atributos `loading="lazy"` y `decoding="async"`. La URL original `url` se carga al abrir el visor fullscreen.
- **Paginación Inteligente**: Si un espacio o anexo tiene más de 40 fotos, se renderizan 24 inicialmente con un botón interactivo *"Ver más (+N fotos)"*.

---

## 3. Modelo de Datos y Estrategia de Persistencia

### Subcolección: `inventories/{inventoryId}/photos/{photoId}`
```typescript
export interface InventoryPhotoDoc {
  id: string;                      // ID de la foto
  spaceId?: string;                // ID del espacio (mutuamente excluyente con annexId)
  annexId?: string;                // ID del anexo (mutuamente excluyente con spaceId)
  storagePath: string;             // tenants/{adminUid}/photos/{userUid}/{photoId}.jpg
  url: string;                     // URL de Firebase Storage
  thumbUrl?: string;               // URL de tenants/{adminUid}/photos/{userUid}/{photoId}_thumb.jpg
  caption?: string;                // Observación
  timestamp: number;               // Timestamp original de captura
  createdBy: string;               // UID del creador
}
```

### Limpieza al Guardar Inventario (`stripPhotosForSave`)
Cuando `saveInventory` o `confirmFinalSave` envían datos a Firestore:
1. `spaces[].photos`: Conserva **únicamente** fotos legacy que ya existían embebidas en Firestore (aquellas con `url` o `dataUrl` preexistentes en el documento remoto y sin `localBlobId`). Se excluyen todas las fotos de la subcolección y fotos con `syncStatus: 'pending'|'uploading'|'failed'`.
2. `annexes[].photos`: Mismo criterio de conservación exclusiva de fotos legacy; actualiza `annex.photoCount`.
3. `inventory.photoCount`: Total acumulado de fotos conocidas (legacy + subcolección + pendientes locales).

---

## 4. Arquitectura del Sistema y Flujo de Datos

### Diagrama de Flujo

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Dispositivo del Usuario                         │
│                                                                        │
│  [Captura Foto en Espacio o Anexo]                                     │
│                │                                                       │
│                ▼                                                       │
│   Compresión JPEG + Generación Miniatura 320px (_thumb)                │
│   Guardado en IndexedDB (status: 'pending', createdAt = timestamp)     │
│                │                                                       │
│                ▼                                                       │
│   PhotoSyncEngine (Concurrencia = 3, Web Locks)                        │
│       ├── 1. Storage: tenants/{adminUid}/photos/{userUid}/{photoId}.jpg│
│       │               tenants/{adminUid}/photos/{userUid}/{photoId}_thumb.jpg
│       │        (Refresh token ante 'storage/unauthorized')             │
│       ├── 2. Firestore: setDoc(inventories/{id}/photos/{photoId})      │
│       │        (con timestamp = record.createdAt original)             │
│       └── 3. Liberación: deletePhotoRecord de IndexedDB                │
└────────────────┬───────────────────────────────────────┬───────────────┘
                 │                                       │
                 ▼                                       ▼
┌───────────────────────────────────┐ ┌──────────────────────────────────┐
│         Firebase Storage          │ │        Cloud Firestore         │
│ tenants/{adminUid}/photos/        │ │ inventories/{id}                 │
│   {userUid}/{photoId}.jpg         │ │   (photoCount, spaces limpios)   │
│   {userUid}/{photoId}_thumb.jpg   │ │   └── photos/{photoId}           │
│                                   │ │         (un doc por foto)        │
└───────────────────────────────────┘ └──────────────────────────────────┘
```

---

## 5. Plan de Ejecución por Archivos

1. **`firestore.rules`**:
   - Reemplazar bloque de `match /inventories/{inventoryId}/photos/{photoId}` con las reglas exactas provistas.
   - Actualizar `isValidInventory` para aceptar opcionalmente `photoCount`.
   - Desplegar con `deploy_firebase`.

2. **`src/types.ts`**:
   - Añadir `thumbUrl?: string` a `Photo` y `OfflinePhotoRecord`.
   - Declarar `InventoryPhotoDoc`.
   - Añadir `photoCount?: number` a `Inventory` y `Annex`.

3. **`src/photos.ts` (Reemplazo total)**:
   - Crear utilidades limpias: `getPhotosOf`, `subscribePhotos`, `fetchPhotos`, `deleteAllPhotos` (lotes de 400), `stripPhotosForSave`.

4. **`src/lib/photoSyncEngine.ts`**:
   - Subida concurrente (límite 3 fotos en paralelo).
   - Rutas en Storage: `tenants/{adminUid}/photos/{userUid}/{photoId}.jpg` y `_thumb.jpg`.
   - Fallback si falta `thumbBlob`: generar en el momento o continuar sin miniatura.
   - Fase 2 con `setDoc` en `inventories/{invId}/photos/{photoId}` con el timestamp original de captura.
   - Reintentos con espera creciente (1, 2, 5, 15 min), re-autenticación en `storage/unauthorized`.

5. **`src/components/PhotoThumb.tsx`**:
   - Priorizar `photo.thumbUrl` para miniaturas y `photo.url` para fullscreen.
   - Añadir `loading="lazy"` y `decoding="async"`.

6. **`src/App.tsx`**:
   - Integración de `getPhotosOf` en renderizado de espacios y anexos.
   - Limpieza al guardar en `saveInventory` y `confirmFinalSave` (no re-incrustar fotos).
   - Uso de `photoCount` en tarjetas y PDF.
   - `onSnapshot` de `inventories/{id}/photos` solo mientras el inventario está abierto.
   - Paginación de galerías con > 40 fotos.
   - `downloadPhotosZip` obteniendo fotos de la subcolección + legacy.
   - Eliminación en lotes de 400 con `deleteAllPhotos` en `handleDeleteInventory`.
   - Banner global de fotos pendientes y aviso no bloqueante en firma.

7. **Verificación**:
   - `compile_applet`, `lint_applet` y `deploy_firebase`.
