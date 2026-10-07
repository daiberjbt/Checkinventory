import type JSZip from 'jszip';

/**
 * Genera el ZIP por partes y entrega cada parte ya en base64.
 * Cada parte (salvo la última) es múltiplo de 3 bytes para que la unión
 * de los base64 sea idéntica al base64 del archivo completo.
 * Con pausa/reanudación se evita acumular cientos de MB en memoria.
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
