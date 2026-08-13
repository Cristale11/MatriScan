import { Component, inject, OnDestroy, ElementRef, viewChild, computed, effect, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlateStore, PlateRecord } from '../../core/storage/plate-store.service';
import * as L from 'leaflet';

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

interface DayGroup {
  label: string;
  count: number;
  records: PlateRecord[];
}

@Component({
  selector: 'app-location',
  standalone: true,
  imports: [DatePipe, FormsModule],
  templateUrl: './location.page.html',
  styleUrl: './location.page.scss',
})
export class LocationPage implements OnDestroy {
  readonly store = inject(PlateStore);
  private mapRef = viewChild<ElementRef>('mapContainer');
  private map: L.Map | null = null;
  private markers = new Map<string, L.Marker>();
  private watchId: number | null = null;

  readonly searchText = signal('');
  readonly userLat = signal<number | null>(null);
  readonly userLng = signal<number | null>(null);

  readonly hasRecordsWithLocation = computed(() =>
    this.store.records().some((r) => r.lat != null && r.lng != null),
  );

  readonly geoRecords = computed(() =>
    this.store.records().filter((r) => r.lat != null && r.lng != null),
  );

  readonly filteredRecords = computed(() => {
    const q = this.searchText().toUpperCase().trim();
    const list = this.geoRecords();
    if (!q) return list;
    return list.filter(r =>
      r.display.toUpperCase().includes(q) ||
      (r.address?.toUpperCase().includes(q) ?? false),
    );
  });

  readonly groupedRecords = computed(() => {
    const records = this.filteredRecords();
    const groups = new Map<string, PlateRecord[]>();

    for (const record of records) {
      const date = new Date(record.capturedAt);
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(record);
    }

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const result: DayGroup[] = [];
    for (const [, recs] of groups) {
      const date = new Date(recs[0].capturedAt);
      const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const dayMonth = `${date.getDate()} ${MONTHS[date.getMonth()]}`;

      let label: string;
      if (dayStart.getTime() === today.getTime()) {
        label = `HOY · ${dayMonth}`;
      } else if (dayStart.getTime() === yesterday.getTime()) {
        label = `AYER · ${dayMonth}`;
      } else {
        label = dayMonth;
      }

      result.push({ label, count: recs.length, records: recs });
    }

    return result;
  });

  constructor() {
    void this.store.load();
    this.startLocationWatch();

    effect(() => {
      const el = this.mapRef()?.nativeElement;
      if (!el || this.map) return;
      requestAnimationFrame(() => this.initMap(el));
    });
  }

  ngOnDestroy(): void {
    this.map?.remove();
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
  }

  flyTo(record: PlateRecord): void {
    if (!this.map || record.lat == null || record.lng == null) return;
    this.map.flyTo([record.lat, record.lng], 17, { duration: 0.8 });
    this.highlightMarker(record.id);
  }

  private highlightMarker(id: string): void {
    for (const [mId, m] of this.markers) {
      const el = m.getElement();
      if (!el) continue;
      const label = el.querySelector('.plate-marker__label') as HTMLElement | null;
      if (!label) continue;
      label.classList.toggle('plate-marker__label--active', mId === id);
    }
  }

  getDistance(record: PlateRecord): string | null {
    const uLat = this.userLat();
    const uLng = this.userLng();
    if (uLat == null || uLng == null || record.lat == null || record.lng == null) return null;
    const m = this.haversine(uLat, uLng, record.lat, record.lng);
    return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
  }

  private haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371e3;
    const toRad = (d: number) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private startLocationWatch(): void {
    if (!navigator.geolocation) return;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.userLat.set(pos.coords.latitude);
        this.userLng.set(pos.coords.longitude);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 10000 },
    );
  }

  private initMap(el: HTMLElement): void {
    const records = this.geoRecords();
    const latest = records[0];
    const center: L.LatLngExpression = latest
      ? [latest.lat!, latest.lng!]
      : [40.4168, -3.7038];

    this.map = L.map(el, { zoomControl: false }).setView(center, latest ? 16 : 6);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap &copy; CARTO',
    }).addTo(this.map);

    const bounds: L.LatLng[] = [];

    for (const r of records) {
      const latlng = L.latLng(r.lat!, r.lng!);
      bounds.push(latlng);

      const icon = L.divIcon({
        className: 'plate-marker',
        html: `<span class="plate-marker__dot"></span><span class="plate-marker__label">${r.display}</span>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8],
      });

      const marker = L.marker(latlng, { icon }).addTo(this.map!);
      marker.on('click', () => {
        this.map!.flyTo(latlng, 17, { duration: 0.8 });
        this.highlightMarker(r.id);
      });
      this.markers.set(r.id, marker);
    }

    if (bounds.length > 1) {
      this.map.fitBounds(L.latLngBounds(bounds), { padding: [60, 60] });
    }

    setTimeout(() => this.map?.invalidateSize(), 200);
  }
}
