import { Injectable } from '@angular/core';
import { OcrProvider } from './ocr-provider';
import { CameraPreview } from '@capacitor-community/camera-preview';
import { TextRecognition } from '@capacitor-mlkit/text-recognition';
import { Filesystem, Directory } from '@capacitor/filesystem';

@Injectable({ providedIn: 'root' })
export class NativeOcrProvider implements OcrProvider {
  private running = false;
  private readonly tmpFile = 'ocr_frame.jpg';
  private readonly canvas = document.createElement('canvas');

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

  async readFrame(): Promise<string> {
    if (!this.running) return '';
    try {
      const photo = await CameraPreview.captureSample({ quality: 75 });
      const base64 = photo.value;
      if (!base64) return '';

      const img = await this.loadImage(base64);
      const w = img.width;
      const h = img.height;

      // Recortar a la zona del encuadre: top 26%, left 8%, width 84%, aspect-ratio 2.2/1
      const frameX = Math.round(w * 0.08);
      const frameY = Math.round(h * 0.26);
      const frameW = Math.round(w * 0.84);
      const frameH = Math.round(frameW / 2.2);

      this.canvas.width = frameW;
      this.canvas.height = frameH;
      const ctx = this.canvas.getContext('2d')!;
      ctx.drawImage(img, frameX, frameY, frameW, frameH, 0, 0, frameW, frameH);

      const cropped = this.canvas.toDataURL('image/jpeg', 0.85).split(',')[1];

      await Filesystem.writeFile({
        path: this.tmpFile,
        data: cropped,
        directory: Directory.Cache,
      });

      const fileInfo = await Filesystem.getUri({
        path: this.tmpFile,
        directory: Directory.Cache,
      });

      const result = await TextRecognition.processImage({
        path: fileInfo.uri,
      });

      return result.text ?? '';
    } catch {
      return '';
    }
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    try {
      await CameraPreview.stop();
    } catch { /* ya parada */ }
  }

  private loadImage(base64: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = `data:image/jpeg;base64,${base64}`;
    });
  }
}
