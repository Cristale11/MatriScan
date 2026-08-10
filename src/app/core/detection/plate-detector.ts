import * as ort from 'onnxruntime-web';

export interface DetectedPlate {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

const MODEL_PATH = '/assets/models/plate-detect-int8.onnx';
const INPUT_SIZE = 320;
const CONF_THRESHOLD = 0.25;
const IOU_THRESHOLD = 0.45;

export class PlateDetector {
  private session: ort.InferenceSession | null = null;
  private loading: Promise<void> | null = null;
  private canvas = document.createElement('canvas');

  async load(): Promise<void> {
    if (this.session) return;
    if (this.loading) return this.loading;

    this.loading = (async () => {
      ort.env.wasm.wasmPaths = '/assets/onnx/';
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      this.session = await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['webgl', 'wasm'],
        graphOptimizationLevel: 'all',
      });
    })();

    return this.loading;
  }

  async detect(source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement): Promise<DetectedPlate | null> {
    if (!this.session) return null;

    const { tensor, scaleX, scaleY, padX, padY } = this.preprocess(source);
    const feeds: Record<string, ort.Tensor> = { images: tensor };
    const results = await this.session.run(feeds);

    const output = results[this.session.outputNames[0]];
    const data = output.data as Float32Array;
    const dims = output.dims;

    const boxes = this.postprocess(data, dims, scaleX, scaleY, padX, padY);
    return boxes.length > 0 ? boxes[0] : null;
  }

  private preprocess(source: HTMLCanvasElement | HTMLVideoElement | HTMLImageElement) {
    const sw = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
    const sh = source instanceof HTMLVideoElement ? source.videoHeight : source.height;

    const ratio = Math.min(INPUT_SIZE / sw, INPUT_SIZE / sh);
    const newW = Math.round(sw * ratio);
    const newH = Math.round(sh * ratio);
    const padX = (INPUT_SIZE - newW) / 2;
    const padY = (INPUT_SIZE - newH) / 2;

    this.canvas.width = INPUT_SIZE;
    this.canvas.height = INPUT_SIZE;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;

    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    ctx.drawImage(source, 0, 0, sw, sh, padX, padY, newW, newH);

    const imgData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const pixels = imgData.data;
    const float32 = new Float32Array(3 * INPUT_SIZE * INPUT_SIZE);
    const area = INPUT_SIZE * INPUT_SIZE;

    for (let i = 0; i < area; i++) {
      const off = i * 4;
      float32[i] = pixels[off] / 255;
      float32[i + area] = pixels[off + 1] / 255;
      float32[i + area * 2] = pixels[off + 2] / 255;
    }

    const tensor = new ort.Tensor('float32', float32, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    return { tensor, scaleX: 1 / ratio, scaleY: 1 / ratio, padX, padY };
  }

  private postprocess(
    data: Float32Array,
    dims: readonly number[],
    scaleX: number,
    scaleY: number,
    padX: number,
    padY: number,
  ): DetectedPlate[] {
    // YOLOv8 output: [1, 5, N] where 5 = cx, cy, w, h, conf
    // or [1, 5+numClasses, N] — we take max class conf
    const numDetections = dims[2];
    const numFields = dims[1];
    const hasClasses = numFields > 5;

    const raw: (DetectedPlate & { _score: number })[] = [];

    for (let i = 0; i < numDetections; i++) {
      const cx = data[0 * numDetections + i];
      const cy = data[1 * numDetections + i];
      const w = data[2 * numDetections + i];
      const h = data[3 * numDetections + i];

      let conf: number;
      if (hasClasses) {
        conf = 0;
        for (let c = 4; c < numFields; c++) {
          const score = data[c * numDetections + i];
          if (score > conf) conf = score;
        }
      } else {
        conf = data[4 * numDetections + i];
      }

      if (conf < CONF_THRESHOLD) continue;

      raw.push({
        x: (cx - w / 2 - padX) * scaleX,
        y: (cy - h / 2 - padY) * scaleY,
        w: w * scaleX,
        h: h * scaleY,
        confidence: conf,
        _score: conf,
      });
    }

    raw.sort((a, b) => b._score - a._score);
    return this.nms(raw);
  }

  private nms(boxes: (DetectedPlate & { _score: number })[]): DetectedPlate[] {
    const kept: DetectedPlate[] = [];
    const suppressed = new Set<number>();

    for (let i = 0; i < boxes.length; i++) {
      if (suppressed.has(i)) continue;
      kept.push(boxes[i]);

      for (let j = i + 1; j < boxes.length; j++) {
        if (suppressed.has(j)) continue;
        if (this.iou(boxes[i], boxes[j]) > IOU_THRESHOLD) {
          suppressed.add(j);
        }
      }
    }

    return kept;
  }

  private iou(a: DetectedPlate, b: DetectedPlate): number {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w);
    const y2 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
  }

  dispose(): void {
    this.session?.release();
    this.session = null;
    this.loading = null;
  }
}
