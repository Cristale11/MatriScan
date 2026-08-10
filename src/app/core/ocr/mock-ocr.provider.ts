import { Injectable } from '@angular/core';
import { OcrProvider } from './ocr-provider';

/**
 * OCR falso para desarrollar la app entera en el navegador con `npm start`.
 *
 * Simula lo que de verdad te vas a encontrar: lecturas parciales, caracteres
 * confundidos y fotogramas basura. Si la app funciona bien contra esto,
 * funcionará contra ML Kit.
 */
@Injectable({ providedIn: 'root' })
export class MockOcrProvider implements OcrProvider {
  /** Cámbiala para probar con otra matrícula. */
  private target = '4821KGN';

  private frame = 0;

  async start(): Promise<void> {
    this.frame = 0;
  }

  async readFrame(): Promise<string> {
    await new Promise((r) => setTimeout(r, 120));
    this.frame++;

    // Uno de cada tres fotogramas no ve nada útil.
    if (this.frame % 3 === 0) return 'E\nESPAÑA';

    // Uno de cada cinco sale con caracteres confundidos: el parser debería
    // arreglarlos con la corrección posicional.
    if (this.frame % 5 === 0) {
      const garbled = this.target.replace(/4/g, 'A').replace(/8/g, 'B');
      return `E ${garbled.slice(0, 4)} ${garbled.slice(4)}`;
    }

    return `E\n${this.target.slice(0, 4)} ${this.target.slice(4)}\nESP`;
  }

  async stop(): Promise<void> {}
}
