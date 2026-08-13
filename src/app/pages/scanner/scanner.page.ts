import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ScannerService } from '../../core/scanner/scanner.service';
import { PlateStore } from '../../core/storage/plate-store.service';
import { EventStore } from '../../core/storage/event-store.service';
import { FORMAT_LABELS, PlateMatch } from '../../core/plate/plate-parser';
import { bandCode, countryName } from '../../core/plate/country-codes';

@Component({
  selector: 'app-scanner',
  standalone: true,
  templateUrl: './scanner.page.html',
  styleUrl: './scanner.page.scss',
})
export class ScannerPage implements OnInit, OnDestroy {
  readonly scanner = inject(ScannerService);
  readonly store = inject(PlateStore);
  readonly eventStore = inject(EventStore);
  readonly formatLabels = FORMAT_LABELS;
  readonly saving = signal(false);

  async ngOnInit(): Promise<void> {
    await Promise.all([this.store.load(), this.eventStore.load()]);
    await this.scanner.start();
  }

  async ngOnDestroy(): Promise<void> {
    await this.scanner.stop();
  }

  async save(): Promise<void> {
    const plate = this.scanner.confirmed();
    if (!plate || this.saving()) return;
    this.saving.set(true);

    let lat: number | undefined;
    let lng: number | undefined;
    let address: string | undefined;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 }),
      );
      lat = pos.coords.latitude;
      lng = pos.coords.longitude;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
          { headers: { 'Accept-Language': 'es' } },
        );
        const data = await res.json();
        const a = data.address;
        if (a) {
          const road = a.road ?? a.pedestrian ?? a.footway ?? '';
          const num = a.house_number ?? '';
          const city = a.city ?? a.town ?? a.village ?? '';
          address = [road, num, city].filter(Boolean).join(', ');
        }
      } catch { /* reverse geocoding falló, se guarda sin dirección */ }
    } catch { /* GPS no disponible */ }

    try {
      await this.store.add({
        value: plate.value,
        display: plate.display,
        format: plate.format,
        country: plate.country,
        eventId: this.eventStore.activeId() ?? undefined,
        lat,
        lng,
        address,
      });
      this.scanner.clearConfirmed();
    } finally {
      this.saving.set(false);
    }
  }

  toggleInternational(): void {
    this.scanner.setInternational(!this.scanner.international());
  }

  /** Letra de la banda azul, o null si la placa no lleva banda. */
  band(plate: PlateMatch): string | null {
    return bandCode(plate.format, plate.country);
  }

  /** "Francia" si se ha leído el distintivo; si no, "Extranjera". */
  label(plate: PlateMatch): string {
    return countryName(plate.country) ?? this.formatLabels[plate.format];
  }

  async retry(): Promise<void> {
    await this.scanner.stop();
    await this.scanner.start();
  }

  discard(): void {
    this.scanner.clearConfirmed();
  }
}
