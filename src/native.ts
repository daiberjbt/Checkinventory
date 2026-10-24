import { Capacitor, CapacitorHttp } from '@capacitor/core';
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
