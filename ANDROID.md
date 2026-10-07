# CheckInventory – App Android

## 0. IMPORTANTE: publica las reglas ANTES de instalar esta versión
Las fotos ahora se guardan en `inventories/{id}/photos/{fotoId}`. Sin las reglas nuevas Firebase las rechaza.
1. Firebase Console > Firestore Database > pestaña **Rules** (elige la base `ai-studio-70226f92-...`).
2. Pega el contenido completo de `firestore.rules` y pulsa **Publish**.

## 1. Compilar el APK
1. Sube este proyecto a tu repositorio de GitHub.
2. Settings > Secrets and variables > Actions > secret `VITE_API_URL` = URL de tu app en Cloud Run (envío de correos).
3. Pestaña Actions > "Build Android APK" > Run workflow.
4. Descarga el artefacto `CheckInventory-apk`, descomprímelo e instala `app-debug.apk`.

## Cómo funcionan ahora las fotos
- Cada foto es un documento propio: soporta cientos de fotos por inventario.
- Se guardan al instante al tomarlas (con o sin internet) y se suben solas al volver la conexión.
- Un inventario nuevo se autoguarda como borrador al tomar la primera foto.
- Las fotos antiguas (dentro del documento) se migran solas la primera vez que guardes ese inventario.
