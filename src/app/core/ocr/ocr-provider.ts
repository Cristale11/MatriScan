import { InjectionToken } from '@angular/core';

/**
 * Todo lo que la app necesita de un motor de OCR.
 *
 * Existe esta interfaz por dos razones:
 *  1. Poder desarrollar toda la app en el navegador con `npm start`, sin móvil.
 *  2. Poder cambiar el plugin de ML Kit por otro (o por un plugin propio en
 *     Kotlin/Swift, que es la optimización natural de la v2) tocando un archivo.
 */
export interface OcrProvider {
  /** Arranca la cámara y deja el preview listo. */
  start(): Promise<void>;

  /** Captura un fotograma y devuelve el texto que encuentre. '' si no hay nada. */
  readFrame(): Promise<string>;

  /** Para la cámara y libera recursos. */
  stop(): Promise<void>;
}

export const OCR_PROVIDER = new InjectionToken<OcrProvider>('OCR_PROVIDER');
