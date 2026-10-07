import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { saveAs } from 'file-saver';
import type JSZip from 'jszip';
import { streamZipBase64 } from './zipStream';
import firebaseConfig from '../firebase-applet-config.json';

export const isNative = Capacitor.isNativePlatform();

/**
 * URL base del servidor que envía correos (/api/send-verification).
 * En la app nativa NO existe servidor local: define VITE_API_URL en .env
 * con la URL de tu app desplegada (ej. https://tuapp-xxxx.run.app).
 */
export const API_BASE: string = isNative ? (import.meta.env.VITE_API_URL || '') : '';

/**
 * Origen "web" para enlaces (correos de verificación, enlace de fotos en PDF).
 * En nativo window.location.origin es https://localhost, que no sirve.
 */
export const webOrigin = (): string =>
  isNative
    ? (import.meta.env.VITE_WEB_URL || `https://${firebaseConfig.authDomain}`)
    : window.location.origin;

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(blob);
  });

/** Web: descarga normal. Android: guarda en el teléfono y abre "Compartir". */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  if (!isNative) {
    saveAs(blob, fileName);
    return;
  }
  const data = await blobToBase64(blob);
  const written = await Filesystem.writeFile({
    path: fileName,
    data,
    directory: Directory.Cache,
  });
  await Share.share({ title: fileName, url: written.uri, dialogTitle: 'Guardar o compartir' });
}

/** Dictado por voz nativo (el de WebView no funciona en Android). */
export async function nativeListen(lang = 'es-ES'): Promise<string> {
  const { available } = await SpeechRecognition.available();
  if (!available) throw new Error('unavailable');
  const perm = await SpeechRecognition.requestPermissions();
  if (perm.speechRecognition !== 'granted') throw new Error('not-allowed');
  const result = await SpeechRecognition.start({
    language: lang,
    maxResults: 1,
    popup: false,
    partialResults: false,
  });
  return result.matches?.[0] ?? '';
}

/**
 * Guarda un ZIP grande. En Android lo escribe por partes en disco (evita agotar
 * la memoria con cientos de fotos) y luego abre "Compartir".
 */
export async function saveZip(zip: JSZip, fileName: string): Promise<void> {
  if (!isNative) {
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
    saveAs(blob, fileName);
    return;
  }
  try { await Filesystem.deleteFile({ path: fileName, directory: Directory.Cache }); } catch { /* no existía */ }
  const toBase64 = (bytes: Uint8Array) => blobToBase64(new Blob([bytes]));
  await streamZipBase64(zip, toBase64, async (data, i) => {
    if (i === 0) await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache });
    else await Filesystem.appendFile({ path: fileName, data, directory: Directory.Cache });
  });
  const { uri } = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
  await Share.share({ title: fileName, url: uri, dialogTitle: 'Guardar o compartir' });
}
