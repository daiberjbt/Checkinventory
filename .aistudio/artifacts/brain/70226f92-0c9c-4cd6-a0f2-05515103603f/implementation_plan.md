# Plan de Implementación: Rediseño No Intrusivo de Avisos de Estado (SyncStatusChip, Bottom Sheet y Toasts)

Este plan detalla el rediseño integral de los avisos de estado (cuota, sin conexión y fotos pendientes) para que **no ocupen espacio fijo de la pantalla**, reemplazando los banners superiores apilados por un chip compacto en el encabezado, una hoja inferior (*Bottom Sheet*) informativa bajo demanda, micro-toasts efímeros y una única franja bloqueante descartable de 32 px cuando sea estrictamente necesario.

---

## 1. Indicador Compacto de Sincronización en el Encabezado (`SyncStatusChip`)

Se elimina el banner apilado de la parte superior. En su lugar, se incorpora en el encabezado (`<header>`), junto a los botones actuales (modo claro/oscuro, ajustes, etc.), un botón/chip de 36 a 40 px:

### 1.1 Estados Visuales del Chip (36-40 px)
1. **Gris con Check (Sincronizado / Idle)**:
   - Icono: `Cloud` con un pequeño `Check` sutil.
   - Aspecto: Color neutro/gris tenue (`text-neutral-400 hover:text-neutral-600 bg-neutral-100 dark:bg-neutral-800`).
   - Comportamiento: Puede atenuarse u ocultarse tras unos segundos si no hay actividad, manteniéndose discreto.
2. **Azul con Giro (Sincronizando / Subiendo)**:
   - Icono: `Loader2` o `RefreshCw` girando suavemente (`animate-spin`) con nube azul (`text-blue-500 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800`).
   - Feedback: Indica que el motor de fotos o Firestore está transfiriendo datos activamente.
3. **Ámbar con Número de Fotos Pendientes**:
   - Icono: `CloudUpload` en ámbar con un badge numérico compacto integrado (ej. `3`, `12`).
   - Aspecto: Fondo cálido suave (`bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200`).
4. **Rojo con Signo de Exclamación (!) (Atención Requerida)**:
   - Icono: `AlertTriangle` o `CloudAlert` con `!` en rojo/escarlata (`bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400 border border-red-200 animate-pulse`).
   - Se activa ante cuota alcanzada de Firestore o Storage, o errores persistentes de permisos.

### 1.2 Integración de Modo Limitado y Datos Guardados (Sin Banner Fijo)
- Ni el modo limitado ni el aviso de lectura desde caché tendrán banners fijos ni etiquetas grandes en el header.
- Se representan mediante un **punto indicador (dot)** sobre el chip:
  - **Punto Ámbar pulsante**: Modo limitado o lectura desde caché telefónica.
  - **Icono WifiOff diminuto** en la esquina del chip cuando `!isOnline`.

---

## 2. Hoja Inferior de Detalle (`SyncStatusSheet`)

Al tocar el `SyncStatusChip`, se despliega una hoja inferior (*Bottom Sheet*) accesible, suavemente animada desde el borde inferior de la pantalla con fondo atenuado (*backdrop blur*):

### 2.1 Contenido de la Hoja Inferior
- **Cabecera y Cierre**:
  - Título: *"Estado de Sincronización"* y botón de cierre `X` (o arrastre/tap fuera).
- **Indicadores de Estado**:
  - **Conexión**: *"Conectado a Internet"* (verde) o *"Sin conexión (Modo fuera de línea)"* (ámbar con icono `WifiOff`).
  - **Base de Datos / Modo**:
    - Si el interruptor de Firestore está activo: *"Límite de Firebase alcanzado: la app guarda cambios localmente en el teléfono"*.
    - Si está en modo limitado: *"Modo limitado: operando con datos locales del dispositivo"*.
    - Si está normal: *"Base de datos sincronizada"*.
  - **Fotografías Pendientes**:
    - Si `count === 0`: *"Todas las fotos están sincronizadas en la nube ✓"*.
    - Si `count > 0`: *"{N} fotos pendientes de subir. Se subirán cuando abras la app con conexión"*.
  - **Último Motivo de Error**:
    - Redacción en lenguaje natural, simple y comprensible (ej. *"Límite de almacenamiento de fotos alcanzado: se intentará más tarde"*, *"Conexión inestable con el servidor"*).
  - **Hora del Último Intento**:
    - Formateado comprensible (ej. *"Último intento: 15:42 (hace 8 min)"*).
- **Acciones Directas**:
  - **[Reintentar ahora]**:
    - Si hay cuota o error pausado, resetea el enfriamiento de Firestore y/o Storage y fuerza un reintento manual inmediato.
  - **[Ver fotos pendientes]**:
    - Abre un visor/modal rápido o filtra la lista de inventarios para ver los registros con fotografías pendientes de subida en cola.
  - **Independencia**:
    - La hoja refleja con precisión si el problema es de Storage, de Firestore o de red, sin interferir entre ellos.

---

## 3. Toasts Puntuales No Repetitivos (Inferiores, 3 a 4 s)

Los eventos informativos y cambios de estado puntuales se notifican mediante micro-toasts flotantes:
- **Posición**: En la parte inferior de la pantalla, flotando sobre la barra de navegación o controles inferiores (`bottom-6` en escritorio, `bottom-20` en móvil si hay tabs).
- **Duración**: Se desvanecen automáticamente tras **3 a 4 segundos**.
- **Contenido conciso**:
  - Ejemplo de subida: *"18 fotos subidas ✓"*
  - Ejemplo de reconexión: *"Conexión restablecida ✓"*
- **Prevención de bucles y fatiga (Anti-spam)**:
  - Registro en memoria del último toast de error emitido y su código/mensaje.
  - **Regla estricta**: No repetir el mismo toast de error más de una vez por episodio (mientras persista la misma condición o durante la ventana de enfriamiento).

---

## 4. Franja Fija Única Descartable (Máx. 32 px) Solo para Errores Bloqueantes

- **Condición Estricta de Aparición**:
  - Se reserva **exclusivamente** para situaciones críticas donde el usuario no puede cargar datos ni continuar trabajando con normalidad (por ejemplo: límite diario de Firestore alcanzado sin caché previa disponible, o error crítico de autenticación).
- **Diseño Ultra-Compacto**:
  - Altura máxima: **32 px**.
  - **Una sola línea de texto** con `truncate` o texto condensado (ej. *"Límite diario alcanzado: datos guardados en el teléfono"*).
  - **Botón de descarte (X)** en el extremo derecho: el usuario puede cerrarlo inmediatamente con un toque y no vuelve a aparecer durante la sesión actual a menos que ocurra un evento crítico nuevo.
  - **Restricción total**: Nunca más de una franja simultánea, nunca textos en dos líneas, y nunca barras apiladas.

---

## 5. Corrección de Redacción en Textos

Se auditan y reemplazan todas las referencias en la interfaz:
- ❌ *"en segundo plano"*
- ❌ *"se sincronizarán automáticamente en segundo plano"*
- ✅ **"Se subirán cuando abras la app con conexión"**

Aplicado de forma consistente en:
- Hoja inferior de sincronización (`SyncStatusSheet`).
- Diálogos de confirmación al guardar inventarios con fotos pendientes.
- Mensajes informativos de finalización de actas o inspecciones.

---

## 6. Arquitectura y Componentes a Implementar

| Componente / Archivo | Responsabilidad |
| :--- | :--- |
| `src/components/SyncStatusChip.tsx` *(Nuevo)* | Botón compacto de 36-40 px para el header con 4 estados visuales (gris con check, azul girando, ámbar con conteo, rojo con !), badge de modo limitado y evento de apertura. |
| `src/components/SyncStatusSheet.tsx` *(Nuevo)* | Hoja inferior animada con backdrop: conexión, fotos pendientes, texto explicativo ("Se subirán cuando abras la app con conexión"), último error, hora, botón "Reintentar ahora" y "Ver fotos pendientes". |
| `src/components/UnifiedStatusBanner.tsx` | Reducción/reemplazo a franja única descartable de máx. 32 px para errores críticos bloqueantes de una línea. |
| `src/App.tsx` | - Integración del `SyncStatusChip` en `<header>` junto a controles de tema/ajustes.<br>- Supresión del banner superior fijo apilado y del badge voluminoso de modo limitado.<br>- Lógica de toasts efímeros inferiores (3-4 s) con deduplicación.<br>- Actualización de textos a *"Se subirán cuando abras la app con conexión"*. |

---

## 7. Plan de Verificación

1. **Espacio en Pantalla**: Verificar que el viewport útil de la pantalla no tiene banners apilados fijos y que la barra de navegación se mantiene limpia.
2. **Estados del Chip**:
   - Simular sincronización activa -> chip azul girando.
   - Fotos en cola -> chip ámbar con número.
   - Error de cuota Storage o Firestore -> chip rojo con "!".
   - Todo completado -> gris tenue con check.
3. **Interacción con Bottom Sheet**:
   - Tocar el chip -> despliegue suave de la hoja inferior.
   - Comprobar que muestra el último intento, motivo claro y los botones funcionales "Reintentar ahora" y "Ver fotos pendientes".
4. **Toasts**:
   - Verificar aparición inferior, desaparición a los 3.5 segundos y no repetición de toasts de error idénticos.
5. **Franja Bloqueante**:
   - En caso de bloqueo crítico de Firestore, verificar que ocupa máximo 32 px en una línea y que el botón `X` la descarta.
6. **Compilación y Linteo**:
   - Verificar `compile_applet` y `lint_applet` sin errores, manteniendo compatibilidad con `android-patch.py`.
