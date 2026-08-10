import { Injectable } from '@angular/core';
import { createWorker, PSM, Worker } from 'tesseract.js';
import { OcrProvider } from './ocr-provider';
import { PlateDetector } from '../detection/plate-detector';

@Injectable({ providedIn: 'root' })
export class WebOcrProvider implements OcrProvider {
  private video?: HTMLVideoElement;
  private stream?: MediaStream;
  private worker?: Worker;
  private detector = new PlateDetector();
  private detectorReady = false;
  private readonly canvas = document.createElement('canvas');
  private readonly cropCanvas = document.createElement('canvas');

  async start(): Promise<void> {
    if (this.video) return;

    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 960 } },
      audio: false,
    });

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    Object.assign(video.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    });
    document.getElementById('cameraPreview')?.appendChild(video);
    await video.play();
    this.video = video;

    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    });
    this.worker = worker;

    await this.detector.load();
    this.detectorReady = true;
    console.log('[detector] YOLO11 cargado ✓');
  }

  async readFrame(): Promise<string> {
    const { video, worker } = this;
    if (!video || !worker || video.readyState < 2 || !this.detectorReady) return '';

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return '';

    const dw = Math.min(vw, 320);
    const dh = Math.round(vh * (dw / vw));
    this.canvas.width = dw;
    this.canvas.height = dh;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, vw, vh, 0, 0, dw, dh);

    const plate = await this.detector.detect(this.canvas);
    if (!plate) return '';

    const padW = plate.w * 0.15;
    const padH = plate.h * 0.15;
    const cx = Math.max(0, Math.round(plate.x - padW));
    const cy = Math.max(0, Math.round(plate.y - padH));
    const cw = Math.min(Math.round(plate.w + padW * 2), dw - cx);
    const ch = Math.min(Math.round(plate.h + padH * 2), dh - cy);

    if (cw < 10 || ch < 10) return '';

    // Crop from original full-res video for better OCR
    const rx = vw / dw;
    const ry = vh / dh;
    const targetH = 64;
    const scale = Math.max(1, Math.round(targetH / ch));
    this.cropCanvas.width = Math.round(cw * rx * scale);
    this.cropCanvas.height = Math.round(ch * ry * scale);
    const cropCtx = this.cropCanvas.getContext('2d', { willReadFrequently: true })!;
    cropCtx.imageSmoothingQuality = 'high';
    cropCtx.drawImage(video, cx * rx, cy * ry, cw * rx, ch * ry, 0, 0, this.cropCanvas.width, this.cropCanvas.height);

    this.binarize(cropCtx, this.cropCanvas.width, this.cropCanvas.height);

    try {
      const { data } = await worker.recognize(this.cropCanvas);
      return data.text ?? '';
    } catch {
      return '';
    }
  }

  private binarize(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      const v = g < 110 ? 0 : g > 150 ? 255 : ((g - 110) * 255) / 40;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }

  async stop(): Promise<void> {
    this.video?.remove();
    this.video = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    await this.worker?.terminate();
    this.worker = undefined;
    this.detector.dispose();
    this.detectorReady = false;
  }
}
