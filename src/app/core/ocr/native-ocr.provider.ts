import { Injectable } from '@angular/core';
import { OcrProvider } from './ocr-provider';
import { CameraPreview } from '@capacitor-community/camera-preview';
import { TextBlock, TextRecognition } from '@capacitor-mlkit/text-recognition';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { NativePlateDetector } from '../detection/native-plate-detector';
import { frameRect } from '../scanner/scan-frame';

/** Holgura alrededor del marco, en fracciones de pantalla. */
const FRAME_MARGIN = 0.08;

/**
 * OCR nativo con dos modos:
 *
 *  - España (por defecto): fotograma -> ML Kit -> se descarta el texto que cae
 *    fuera del marco. Es el camino rápido: ML Kit lee la imagen entera (que en
 *    nativo es barato) y el filtrado es aritmética sobre las cajas que ya
 *    devuelve, así que quitar el texto de fondo no cuesta tiempo.
 *  - Internacional: fotograma -> YOLO nativo (localiza la placa) -> ML Kit
 *    sobre el recorte. Más lento, pero funciona con placas de cualquier país
 *    porque el parser acepta el texto del recorte sin exigir formato español.
 */
@Injectable({ providedIn: 'root' })
export class NativeOcrProvider implements OcrProvider {
  private running = false;
  private international = false;
  private readonly tmpFile = 'ocr_frame.jpg';

  /** Resolución de la cámara. Se mide una vez: no cambia entre fotogramas. */
  private imageSize: { w: number; h: number } | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    await CameraPreview.start({
      parent: 'cameraPreview',
      position: 'rear',
      toBack: true,
      disableAudio: true,
    });
    this.running = true;
  }

  setInternational(on: boolean): void {
    this.international = on;
    if (on) {
      // Cargar YOLO en segundo plano para que el primer frame no lo pague.
      NativePlateDetector.warmup().catch((err) =>
        console.warn('[nativo] warmup YOLO falló:', err),
      );
    }
  }

  async readFrame(): Promise<string> {
    if (!this.running) return '';
    try {
      const photo = await CameraPreview.captureSample({ quality: 70 });
      const base64 = photo.value;
      if (!base64) return '';

      return this.international
        ? await this.readInternational(base64)
        : await this.readSpain(base64);
    } catch {
      return '';
    }
  }

  /** Modo España: ML Kit sobre el fotograma, quedándose con lo del marco. */
  private async readSpain(base64: string): Promise<string> {
    await Filesystem.writeFile({
      path: this.tmpFile,
      data: base64,
      directory: Directory.Cache,
    });

    const fileInfo = await Filesystem.getUri({
      path: this.tmpFile,
      directory: Directory.Cache,
    });

    const result = await TextRecognition.processImage({ path: fileInfo.uri });
    if (!result.blocks?.length) return result.text ?? '';

    const size = await this.ensureImageSize(base64);
    if (!size) return result.text ?? '';

    return this.textInsideFrame(result.blocks, size);
  }

  /** Modo internacional: YOLO localiza la placa, ML Kit lee solo el recorte. */
  private async readInternational(base64: string): Promise<string> {
    const detection = await NativePlateDetector.detect({ image: base64 });
    if (!detection.found || !detection.path) return '';

    const result = await TextRecognition.processImage({ path: detection.path });
    return result.text ?? '';
  }

  /**
   * Une el texto de los bloques cuyo centro cae dentro del marco (con holgura).
   * Se mira el centro y no la caja entera porque el usuario rara vez encuadra
   * la placa perfectamente, y descartar por asomar un borde perdería lecturas
   * buenas. Los bloques sin caja se conservan: sin coordenadas no hay motivo
   * para descartarlos.
   */
  private textInsideFrame(blocks: TextBlock[], size: { w: number; h: number }): string {
    const f = frameRect(window.innerWidth, window.innerHeight);
    const left = f.x - FRAME_MARGIN;
    const right = f.x + f.w + FRAME_MARGIN;
    const top = f.y - FRAME_MARGIN;
    const bottom = f.y + f.h + FRAME_MARGIN;

    const kept = blocks.filter((block) => {
      const box = block.boundingBox;
      if (!box) return true;
      const cx = (box.left + box.right) / 2 / size.w;
      const cy = (box.top + box.bottom) / 2 / size.h;
      return cx >= left && cx <= right && cy >= top && cy <= bottom;
    });

    if (kept.length !== blocks.length) {
      console.log(`[nativo] ${blocks.length - kept.length} bloques fuera del marco`);
    }

    return kept.map((b) => b.text).join('\n');
  }

  /** Decodifica un fotograma una sola vez para conocer la resolución. */
  private async ensureImageSize(base64: string): Promise<{ w: number; h: number } | null> {
    if (this.imageSize) return this.imageSize;
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = `data:image/jpeg;base64,${base64}`;
      });
      this.imageSize = { w: img.width, h: img.height };
      console.log(`[nativo] resolución de captura: ${img.width}x${img.height}`);
      return this.imageSize;
    } catch {
      return null;
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.imageSize = null;
    try {
      await CameraPreview.stop();
    } catch { /* ya parada */ }
  }
}
