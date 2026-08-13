import { Injectable, signal } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { PlateFormat } from '../plate/plate-parser';

export interface PlateRecord {
  id: string;
  value: string;
  display: string;
  format: PlateFormat;
  /** Distintivo de país en las extranjeras (F, D, P...). */
  country?: string;
  /** ID del evento al que pertenece, si se escaneó con uno activo. */
  eventId?: string;
  /** ISO 8601 */
  capturedAt: string;
  note?: string;
  lat?: number;
  lng?: number;
  address?: string;
}

const KEY = 'plates';

/**
 * Almacenamiento local, y solo local.
 *
 * Nada sale del dispositivo. Además de ser lo correcto con datos de matrículas,
 * significa que la app funciona en un sótano sin cobertura.
 *
 * Para el MVP con Preferences basta (es un JSON). Cuando la lista pase de unos
 * cientos de registros o quieras buscar y filtrar en serio, el cambio natural
 * es @capacitor-community/sqlite, y solo hay que reescribir esta clase.
 */
@Injectable({ providedIn: 'root' })
export class PlateStore {
  readonly records = signal<PlateRecord[]>([]);
  readonly loaded = signal(false);

  async load(): Promise<void> {
    const { value } = await Preferences.get({ key: KEY });
    try {
      this.records.set(value ? (JSON.parse(value) as PlateRecord[]) : []);
    } catch {
      this.records.set([]);
    }
    this.loaded.set(true);
    void this.backfillAddresses();
  }

  private async backfillAddresses(): Promise<void> {
    const pending = this.records().filter(r => r.lat != null && r.lng != null && !r.address);
    if (!pending.length) return;

    for (const record of pending) {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${record.lat}&lon=${record.lng}&format=json&addressdetails=1`,
          { headers: { 'Accept-Language': 'es' } },
        );
        const data = await res.json();
        const a = data.address;
        if (a) {
          const road = a.road ?? a.pedestrian ?? a.footway ?? '';
          const num = a.house_number ?? '';
          const city = a.city ?? a.town ?? a.village ?? '';
          record.address = [road, num, city].filter(Boolean).join(', ');
        }
      } catch { /* sin conexión, se reintentará la próxima vez */ }
    }

    if (pending.some(r => r.address)) {
      this.records.update(list => [...list]);
      await this.persist();
    }
  }

  async add(entry: Omit<PlateRecord, 'id' | 'capturedAt'>): Promise<PlateRecord> {
    const record: PlateRecord = {
      ...entry,
      id: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
    };
    this.records.update((list) => [record, ...list]);
    await this.persist();
    return record;
  }

  async remove(id: string): Promise<void> {
    this.records.update((list) => list.filter((r) => r.id !== id));
    await this.persist();
  }

  async clear(): Promise<void> {
    this.records.set([]);
    await this.persist();
  }

  /** Exporta a CSV para pasarlo a otro sitio. */
  toCsv(): string {
    const rows = this.records().map((r) =>
      [r.display, r.capturedAt, (r.note ?? '').replace(/"/g, '""')]
        .map((f) => `"${f}"`)
        .join(','),
    );
    return ['"matricula","fecha","nota"', ...rows].join('\n');
  }

  private persist(): Promise<void> {
    return Preferences.set({ key: KEY, value: JSON.stringify(this.records()) });
  }
}
