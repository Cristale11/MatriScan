import { Injectable, inject, signal, computed } from '@angular/core';
import { OCR_PROVIDER } from '../ocr/ocr-provider';
import { extractPlate, PlateMatch } from '../plate/plate-parser';
import { PlateVoter } from '../plate/plate-voter';

export type ScannerStatus = 'idle' | 'scanning' | 'error';

/**
 * Une las tres piezas: cámara -> parser -> votación.
 *
 * El bucle no usa setInterval a propósito. Cada pasada espera a que termine la
 * anterior, así que si el móvil va lento el ritmo baja solo en vez de acumular
 * capturas pendientes.
 */
@Injectable({ providedIn: 'root' })
export class ScannerService {
  private readonly ocr = inject(OCR_PROVIDER);
  private readonly voter = new PlateVoter(2, 1, 2000);

  private loopActive = false;
  private loopEpoch = 0;

  readonly status = signal<ScannerStatus>('idle');
  readonly errorMessage = signal<string | null>(null);

  /** Modo internacional: YOLO + OCR sin exigir formato español. */
  readonly international = signal(false);

  /** Última matrícula confirmada por la votación. */
  readonly confirmed = signal<PlateMatch | null>(null);

  /** Candidata en curso, para dar feedback mientras el usuario apunta. */
  readonly candidate = signal<PlateMatch | null>(null);
  readonly votes = signal(0);
  readonly threshold = signal(2);

  readonly progress = computed(() => {
    const t = this.threshold();
    return t ? Math.min(this.votes() / t, 1) : 0;
  });

  async start(): Promise<void> {
    if (this.loopActive) return;

    try {
      await this.ocr.start();
    } catch (err) {
      this.status.set('error');
      this.errorMessage.set('No se pudo abrir la cámara. Revisa los permisos.');
      return;
    }

    this.loopActive = true;
    this.loopEpoch++;
    this.status.set('scanning');
    this.errorMessage.set(null);
    void this.loop(this.loopEpoch);
  }

  async stop(): Promise<void> {
    this.loopActive = false;
    this.voter.reset();
    this.candidate.set(null);
    this.votes.set(0);
    this.status.set('idle');
    await this.ocr.stop();
  }

  /** Se llama tras guardar o descartar, para volver a escanear. */
  clearConfirmed(): void {
    this.confirmed.set(null);
    this.voter.reset();
    this.candidate.set(null);
    this.votes.set(0);
  }

  setInternational(on: boolean): void {
    if (this.international() === on) return;
    this.international.set(on);
    this.ocr.setInternational?.(on);
    this.voter.reset();
    this.confirmed.set(null);
    this.candidate.set(null);
    this.votes.set(0);

    if (this.loopActive) {
      this.loopEpoch++;
      void this.loop(this.loopEpoch);
    }
  }

  private async loop(epoch: number): Promise<void> {
    while (this.loopActive && epoch === this.loopEpoch) {
      try {
        if (this.confirmed()) {
          await this.sleep(200);
          continue;
        }

        const text = await this.ocr.readFrame();
        if (epoch !== this.loopEpoch) break;

        const match = extractPlate(text, { allowForeign: this.international() });
        console.log('[ocr]', JSON.stringify(text), '->', match?.value ?? null);
        const hit = this.voter.push(match);

        const state = this.voter.state;
        this.candidate.set(state.leader);
        this.votes.set(state.votes);
        this.threshold.set(state.threshold);

        if (hit) {
          this.confirmed.set(hit);
          this.candidate.set(null);
          this.votes.set(0);
        }
      } catch (err) {
        console.error('[scanner] error en el bucle, reintentando:', err);
      }

      await this.sleep(50);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
