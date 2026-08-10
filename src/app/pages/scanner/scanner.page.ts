import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ScannerService } from '../../core/scanner/scanner.service';
import { PlateStore } from '../../core/storage/plate-store.service';
import { FORMAT_LABELS } from '../../core/plate/plate-parser';

@Component({
  selector: 'app-scanner',
  standalone: true,
  templateUrl: './scanner.page.html',
  styleUrl: './scanner.page.scss',
})
export class ScannerPage implements OnInit, OnDestroy {
  readonly scanner = inject(ScannerService);
  readonly store = inject(PlateStore);
  readonly formatLabels = FORMAT_LABELS;
  readonly saving = signal(false);

  async ngOnInit(): Promise<void> {
    await this.store.load();
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
        lat,
        lng,
        address,
      });
      this.scanner.clearConfirmed();
    } finally {
      this.saving.set(false);
    }
  }

  async retry(): Promise<void> {
    await this.scanner.stop();
    await this.scanner.start();
  }

  discard(): void {
    this.scanner.clearConfirmed();
  }
}
