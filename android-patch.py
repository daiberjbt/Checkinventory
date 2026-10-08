#!/usr/bin/env python3
"""
android-patch.py  -  Adapta la app web exportada de AI Studio para correr como app Android (Capacitor).

- NO toca tu lógica: agrega un modulo nativo (src/native.ts) y redirige unos pocos puntos
  que no funcionan dentro del WebView de Android (guardar/compartir archivos, dictado, URLs del servidor, etc.).
- Es idempotente: si ya se aplico, no hace nada. Si AI Studio cambia el codigo y un parche ya no
  encaja, falla con un mensaje claro (no deja la app a medio parchear en silencio).
- Se ejecuta solo desde el workflow de GitHub Actions: no hay que correrlo a mano.
"""
import json
import pathlib
import re
import sys

ROOT = pathlib.Path('.')
MARK = '/* android-patched */'
errors = []


def read(p):
    return pathlib.Path(p).read_text(encoding='utf-8')


def write(p, s):
    pathlib.Path(p).write_text(s, encoding='utf-8')


def patch_file(path, edits, regex_edits=()):
    """edits: lista de (viejo, nuevo, veces_esperadas)."""
    s = read(path)
    if MARK in s:
        print(f'= {path}: ya estaba parchado')
        return
    for old, new, expected in edits:
        n = s.count(old)
        if n != expected:
            errors.append(f'{path}: se esperaban {expected} coincidencia(s) y hay {n} para:\n    {old[:110]!r}')
            continue
        s = s.replace(old, new)
    for fn in regex_edits:
        try:
            s = fn(s)
        except AssertionError as e:
            errors.append(f'{path}: {e}')
    if not errors:
        write(path, MARK + '\n' + s)
        print(f'+ {path}: parchado')


# ---------------------------------------------------------------- archivos nuevos
NATIVE_TS = r"""import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import type JSZip from 'jszip';
import firebaseConfig from '../firebase-applet-config.json';
import { streamZipBase64 } from './zipStream';

export const isNative = Capacitor.isNativePlatform();

/**
 * URL del servidor desplegado (Cloud Run) que atiende /api/* (correos, firma remota, etc.).
 * En la app Android no existe servidor local: se define con el secret VITE_API_URL.
 */
export const API_BASE: string = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

/** Origen "web" para enlaces (correos, firma remota, enlace de fotos). En Android window.location.origin es https://localhost. */
export const webOrigin = (): string =>
  isNative ? (API_BASE || `https://${firebaseConfig.authDomain}`) : window.location.origin;

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(blob);
  });

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_');
const isCancel = (e: any) => /cancel/i.test(String(e?.message ?? e));

async function writeCacheFile(blob: Blob, fileName: string): Promise<string> {
  const written = await Filesystem.writeFile({
    path: safeName(fileName),
    data: await blobToBase64(blob),
    directory: Directory.Cache,
  });
  return written.uri;
}

/** Android: guarda el archivo y abre "Compartir / Guardar". */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  const uri = await writeCacheFile(blob, fileName);
  try {
    await Share.share({ title: fileName, files: [uri], dialogTitle: 'Guardar o compartir' });
  } catch (e) {
    if (!isCancel(e)) throw e;
  }
}

/** jsPDF: en web descarga normal; en Android abre "Compartir / Guardar". */
export async function savePdf(doc: any, fileName: string): Promise<void> {
  if (!isNative) {
    doc.save(fileName);
    return;
  }
  await saveFile(doc.output('blob') as Blob, fileName);
}

/** Descarga una imagen/archivo. En Android usa HTTP nativo (evita bloqueos CORS del WebView). */
export async function fetchBlob(url: string): Promise<Blob | null> {
  try {
    if (isNative && /^https?:/i.test(url)) {
      const res = await CapacitorHttp.get({ url, responseType: 'blob' });
      if (res.status < 200 || res.status >= 300) return null;
      const bin = atob(res.data as string);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const type = (res.headers && (res.headers['Content-Type'] || res.headers['content-type'])) || 'image/jpeg';
      return new Blob([bytes], { type });
    }
    const r = await fetch(url);
    return r.ok ? await r.blob() : null;
  } catch (e) {
    console.warn('fetchBlob fallo', e);
    return null;
  }
}

/** ZIP grande: en Android se escribe por partes en disco (cientos de fotos no caben en memoria de una vez). */
export async function saveZip(zip: JSZip, fileName: string): Promise<void> {
  if (!isNative) {
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return;
  }
  const path = safeName(fileName);
  try { await Filesystem.deleteFile({ path, directory: Directory.Cache }); } catch { /* no existia */ }
  await streamZipBase64(zip, (bytes) => blobToBase64(new Blob([bytes])), async (data, i) => {
    if (i === 0) await Filesystem.writeFile({ path, data, directory: Directory.Cache });
    else await Filesystem.appendFile({ path, data, directory: Directory.Cache });
  });
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  try {
    await Share.share({ title: fileName, files: [uri], dialogTitle: 'Guardar o compartir' });
  } catch (e) {
    if (!isCancel(e)) throw e;
  }
}

/** Dictado por voz nativo (el del navegador no funciona dentro del WebView de Android). */
export async function nativeListen(lang = 'es-ES'): Promise<string> {
  const { available } = await SpeechRecognition.available();
  if (!available) throw new Error('unavailable');
  const perm = await SpeechRecognition.requestPermissions();
  if (perm.speechRecognition !== 'granted') throw new Error('not-allowed');
  const result = await SpeechRecognition.start({ language: lang, maxResults: 1, popup: false, partialResults: false });
  return result.matches?.[0] ?? '';
}

// ----------------------------------------------------------------------------
// Ajustes globales solo para Android
// ----------------------------------------------------------------------------
if (isNative) {
  // 1) Las llamadas relativas fetch('/api/...') apuntan al servidor desplegado
  if (API_BASE) {
    const originalFetch = window.fetch.bind(window);
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === 'string' && input.startsWith('/api/')) input = API_BASE + input;
      return originalFetch(input, init);
    }) as typeof window.fetch;
  }

  // 1b) Los servidores gratuitos (Render) se duermen tras 15 min sin uso y tardan ~1 min en despertar:
  //     se les avisa al abrir la app y al volver a ella, para que ya esten listos cuando se necesiten.
  if (API_BASE) {
    const wake = () => { fetch(`${API_BASE}/api/health`, { cache: 'no-store' }).catch(() => {}); };
    let lastWake = Date.now();
    wake();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastWake > 10 * 60 * 1000) {
        lastWake = Date.now();
        wake();
      }
    });
  }

  // 2) navigator.share / canShare no existen en el WebView: se reemplazan por el menu nativo de Android
  const nav = navigator as any;
  nav.canShare = () => true;
  nav.share = async (data: { title?: string; text?: string; url?: string; files?: File[] }) => {
    try {
      if (data.files && data.files.length) {
        const uris: string[] = [];
        for (const f of data.files) uris.push(await writeCacheFile(f, f.name));
        await Share.share({ title: data.title, text: data.text, files: uris, dialogTitle: data.title || 'Compartir' });
      } else {
        await Share.share({ title: data.title, text: data.text, url: data.url, dialogTitle: data.title || 'Compartir' });
      }
    } catch (e: any) {
      if (isCancel(e)) {
        const err: any = new Error('Share canceled');
        err.name = 'AbortError';
        throw err;
      }
      throw e;
    }
  };
}
"""

ZIPSTREAM_TS = r"""import type JSZip from 'jszip';

/**
 * Genera el ZIP por partes y entrega cada parte ya en base64.
 * Cada parte (salvo la ultima) es multiplo de 3 bytes para que la union de los base64
 * sea identica al base64 del archivo completo. Con pausa/reanudacion no se acumulan cientos de MB en memoria.
 */
export function streamZipBase64(
  zip: JSZip,
  toBase64: (bytes: Uint8Array) => Promise<string>,
  onChunk: (base64: string, index: number) => Promise<void>,
  flushBytes = 3 * 1024 * 1024
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let buffer = new Uint8Array(0);
    let index = 0;
    let inflight = 0;
    let ended = false;
    let failed = false;
    let chain: Promise<void> = Promise.resolve();

    const helper = zip.generateInternalStream({ type: 'uint8array', streamFiles: true, compression: 'STORE' });

    const fail = (e: unknown) => {
      if (failed) return;
      failed = true;
      reject(e);
    };

    const send = (bytes: Uint8Array) => {
      const i = index++;
      inflight++;
      if (inflight >= 2) helper.pause();
      chain = chain
        .then(async () => onChunk(await toBase64(bytes), i))
        .then(() => {
          inflight--;
          if (!ended && inflight < 2) helper.resume();
        })
        .catch(fail);
    };

    helper
      .on('data', (chunk: Uint8Array) => {
        const merged = new Uint8Array(buffer.length + chunk.length);
        merged.set(buffer, 0);
        merged.set(chunk, buffer.length);
        buffer = merged;
        if (buffer.length >= flushBytes) {
          const n = Math.floor(buffer.length / 3) * 3;
          send(buffer.slice(0, n));
          buffer = buffer.slice(n);
        }
      })
      .on('error', fail)
      .on('end', () => {
        ended = true;
        if (buffer.length) send(buffer);
        chain.then(() => { if (!failed) resolve(); });
      })
      .resume();
  });
}
"""

OFFLINE_WRITES_TS = r"""import {
  setDoc as _setDoc,
  updateDoc as _updateDoc,
  deleteDoc as _deleteDoc,
} from 'firebase/firestore';

/**
 * Con la cache offline de Firestore, la promesa de una escritura NO se resuelve hasta que el
 * servidor la confirma (sin internet, nunca). La escritura local ya quedo hecha y se subira sola,
 * asi que se espera poco y se continua. Los errores rapidos (permisos, datos invalidos) se propagan;
 * los tardios solo se registran en consola.
 */
export function queuedWrite<T>(p: Promise<T>, ms = 1200): Promise<T | undefined> {
  p.catch((e) => console.error('Firestore write failed', e));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export const setDoc = ((...args: any[]) => queuedWrite((_setDoc as any)(...args))) as unknown as typeof _setDoc;
export const updateDoc = ((...args: any[]) => queuedWrite((_updateDoc as any)(...args))) as unknown as typeof _updateDoc;
export const deleteDoc = ((...args: any[]) => queuedWrite((_deleteDoc as any)(...args))) as unknown as typeof _deleteDoc;
"""

CAP_CONFIG = """import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.checkinventory.app',
  appName: 'CheckInventory',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
"""

for path, content in [('src/native.ts', NATIVE_TS), ('src/zipStream.ts', ZIPSTREAM_TS),
                      ('src/offlineWrites.ts', OFFLINE_WRITES_TS)]:
    write(path, content)
    print(f'+ {path}: escrito')
if not ROOT.joinpath('capacitor.config.ts').exists():
    write('capacitor.config.ts', CAP_CONFIG)
    print('+ capacitor.config.ts: escrito')

# ---------------------------------------------------------------- src/main.tsx
patch_file('src/main.tsx', [
    ("import { registerSW } from 'virtual:pwa-register';",
     "import { registerSW } from 'virtual:pwa-register';\nimport { isNative } from './native';", 1),
    ("registerSW({ immediate: true });",
     "if (!isNative) registerSW({ immediate: true }); // en la app Android no se usa service worker", 1),
])

# ---------------------------------------------------------------- src/components/Auth.tsx
s = read('src/components/Auth.tsx')
if MARK not in s:
    n = s.count('url: window.location.origin,')
    if n < 1:
        errors.append('src/components/Auth.tsx: no se encontro window.location.origin')
    else:
        s = s.replace('url: window.location.origin,', 'url: webOrigin(),')
        # import tras la ultima linea import
        lines = s.split('\n')
        last_import = max(i for i, l in enumerate(lines) if l.startswith('import '))
        lines.insert(last_import + 1, "import { webOrigin } from '../native';")
        write('src/components/Auth.tsx', MARK + '\n' + '\n'.join(lines))
        print('+ src/components/Auth.tsx: parchado')
else:
    print('= src/components/Auth.tsx: ya estaba parchado')

# ---------------------------------------------------------------- src/App.tsx
SPEECH_BLOCK = """  const startListening = (spaceIndex: number, itemIndex: number, itemId: string, isGeneralObservation: boolean = false) => {
    if (isNative) {
      setIsListening(itemId);
      nativeListen('es-ES')
        .then((transcript) => {
          if (transcript && currentInventory) {
            const updated = [...currentInventory.spaces];
            if (isGeneralObservation) {
              const currentObs = updated[spaceIndex].generalObservations || '';
              updated[spaceIndex].generalObservations = currentObs ? `${currentObs} ${transcript}` : transcript;
            } else {
              const currentDetails = updated[spaceIndex].items[itemIndex].details;
              updated[spaceIndex].items[itemIndex].details = currentDetails ? `${currentDetails} ${transcript}` : transcript;
            }
            setCurrentInventory({ ...currentInventory, spaces: updated });
            showNotify('Texto dictado añadido');
          }
        })
        .catch((e: any) => {
          showNotify(e?.message === 'not-allowed' ? 'Permiso de micrófono denegado' : 'Dictado por voz no disponible', 'error');
        })
        .finally(() => setIsListening(null));
      return;
    }
"""

def app_regex(s):
    # Redirige setDoc / updateDoc / deleteDoc a las versiones "offline" (no se quedan esperando sin internet)
    m = re.search(r"import \{[^}]*\} from 'firebase/firestore';", s)
    assert m, 'no se encontro el import de firebase/firestore'
    block = m.group(0)
    new_block = re.sub(r"\n\s*(updateDoc|deleteDoc|setDoc),[ ]*", "", block)
    assert not re.search(r"\b(updateDoc|deleteDoc|setDoc)\b", new_block), 'no se pudieron quitar setDoc/updateDoc/deleteDoc del import'
    new_block += "\nimport { setDoc, updateDoc, deleteDoc, queuedWrite } from './offlineWrites';"
    return s.replace(block, new_block, 1)

patch_file('src/App.tsx', [
    # imports nativos
    ("import { saveAs } from 'file-saver';",
     "import { saveAs } from 'file-saver';\nimport { isNative, nativeListen, saveZip, savePdf, fetchBlob, webOrigin } from './native';", 1),
    # escrituras por lote
    ("await batch.commit();", "await queuedWrite(batch.commit());", 1),
    # fotos del ZIP: descarga nativa (sin CORS)
    ("""        const response = await fetch(targetUrl);
        if (response.ok) {
          const blob = await response.blob();
          return { type: 'blob', blob };
        }""",
     """        const blob = await fetchBlob(targetUrl);
        if (blob) {
          return { type: 'blob', blob };
        }""", 1),
    # ZIP por partes
    ("""    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `Fotos_Inventario_${inventory.propertyName.replace(/\\s+/g, '_')}.zip`);""",
     """    await saveZip(zip, `Fotos_Inventario_${inventory.propertyName.replace(/\\s+/g, '_')}.zip`);""", 1),
    # dictado por voz
    ("  const startListening = (spaceIndex: number, itemIndex: number, itemId: string, isGeneralObservation: boolean = false) => {\n",
     SPEECH_BLOCK, 1),
    # PDF
    ("    doc.save(`Inventario_${inventory.propertyName.replace(/\\s+/g, '_')}_${inventory.date}${suffix}.pdf`);",
     "    savePdf(doc, `Inventario_${inventory.propertyName.replace(/\\s+/g, '_')}_${inventory.date}${suffix}.pdf`);", 1),
    ("        doc.save(fileName);", "        savePdf(doc, fileName);", 2),
    # foto en pantalla completa: compartir
    ("""                          const response = await fetch(fullscreenPhoto.url);
                          const blob = await response.blob();""",
     """                          const blob = await fetchBlob(fullscreenPhoto.url);
                          if (!blob) throw new Error('No se pudo descargar la foto');""", 1),
    # enlaces / origen del servidor
    ("origin: window.location.origin\n", "origin: webOrigin()\n", 1),
    ("`${window.location.origin}/?downloadPhotos=", "`${webOrigin()}/?downloadPhotos=", 1),
    ("url: window.location.origin,", "url: webOrigin(),", 1),
], regex_edits=[app_regex])

# ---------------------------------------------------------------- resultado
if errors:
    print('\n*** NO SE PUDO ADAPTAR LA APP ***')
    print('AI Studio cambio partes del codigo que este script necesita. Envia este mensaje para actualizar el script:\n')
    for e in errors:
        print(' -', e)
    sys.exit(1)
print('\nOK: app adaptada para Android')
