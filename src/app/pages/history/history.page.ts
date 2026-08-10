import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PlateStore, PlateRecord } from '../../core/storage/plate-store.service';
import { FORMAT_LABELS, PlateFormat } from '../../core/plate/plate-parser';

type DateFilter = 'today' | 'yesterday' | 'week' | 'all';

interface DayGroup {
  label: string;
  count: number;
  records: PlateRecord[];
}

interface CalendarDay {
  date: Date;
  day: number;
  currentMonth: boolean;
  isToday: boolean;
  inRange: boolean;
  isStart: boolean;
  isEnd: boolean;
}

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

@Component({
  selector: 'app-history',
  standalone: true,
  imports: [DatePipe, FormsModule],
  templateUrl: './history.page.html',
  styleUrl: './history.page.scss',
})
export class HistoryPage implements OnInit {
  readonly store = inject(PlateStore);
  readonly formatLabels = FORMAT_LABELS;

  readonly searchText = signal('');
  readonly dateFilter = signal<DateFilter>('all');
  readonly typeFilter = signal<PlateFormat | ''>('');
  readonly rangeStart = signal<Date | null>(null);
  readonly rangeEnd = signal<Date | null>(null);

  readonly selectOpen = signal(false);
  readonly typeOptions: { value: PlateFormat | ''; label: string }[] = [
    { value: '', label: 'Todos los tipos' },
    { value: 'modern', label: 'Moderna' },
    { value: 'moped', label: 'Ciclomotor' },
    { value: 'legacy', label: 'Provincial' },
    { value: 'old', label: 'Antigua' },
    { value: 'special', label: 'Especial' },
  ];
  readonly typeLabel = computed(() =>
    this.typeOptions.find(o => o.value === this.typeFilter())?.label ?? 'Todos los tipos');

  readonly calendarOpen = signal(false);
  readonly calMonth = signal(new Date().getMonth());
  readonly calYear = signal(new Date().getFullYear());

  readonly calendarTitle = computed(() =>
    `${MONTH_NAMES[this.calMonth()]} ${this.calYear()}`);

  readonly rangeLabel = computed(() => {
    const s = this.rangeStart();
    const e = this.rangeEnd();
    if (!s) return 'Seleccionar fechas';
    const fmt = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;
    if (!e || s.getTime() === e.getTime()) return fmt(s);
    return `${fmt(s)} — ${fmt(e)}`;
  });

  readonly hasRange = computed(() => this.rangeStart() !== null);

  readonly calendarDays = computed<CalendarDay[]>(() => {
    const month = this.calMonth();
    const year = this.calYear();
    const start = this.rangeStart();
    const end = this.rangeEnd();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const firstDay = new Date(year, month, 1);
    let startWeekday = firstDay.getDay();
    if (startWeekday === 0) startWeekday = 7;

    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();

    const days: CalendarDay[] = [];

    for (let i = startWeekday - 1; i > 0; i--) {
      const d = new Date(year, month - 1, daysInPrev - i + 1);
      days.push(this.makeDay(d, false, today, start, end));
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const d = new Date(year, month, i);
      days.push(this.makeDay(d, true, today, start, end));
    }

    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      days.push(this.makeDay(d, false, today, start, end));
    }

    return days;
  });

  readonly filteredRecords = computed(() => {
    let records = this.store.records();

    const search = this.searchText().toUpperCase().trim();
    if (search) {
      records = records.filter(r => r.display.toUpperCase().includes(search));
    }

    const type = this.typeFilter();
    if (type) {
      records = records.filter(r => r.format === type);
    }

    const start = this.rangeStart();
    const end = this.rangeEnd();
    if (start) {
      const fromDate = new Date(start);
      fromDate.setHours(0, 0, 0, 0);
      const toDate = end ? new Date(end) : new Date(start);
      toDate.setHours(23, 59, 59, 999);
      records = records.filter(r => {
        const d = new Date(r.capturedAt);
        return d >= fromDate && d <= toDate;
      });
    } else {
      const df = this.dateFilter();
      if (df !== 'all') {
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        if (df === 'today') {
          records = records.filter(r => new Date(r.capturedAt) >= startOfToday);
        } else if (df === 'yesterday') {
          const startOfYesterday = new Date(startOfToday);
          startOfYesterday.setDate(startOfYesterday.getDate() - 1);
          records = records.filter(r => {
            const d = new Date(r.capturedAt);
            return d >= startOfYesterday && d < startOfToday;
          });
        } else if (df === 'week') {
          const startOfWeek = new Date(startOfToday);
          startOfWeek.setDate(startOfWeek.getDate() - 7);
          records = records.filter(r => new Date(r.capturedAt) >= startOfWeek);
        }
      }
    }

    return records;
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

  readonly subtitle = computed(() => {
    const count = this.filteredRecords().length;
    return `${count} ${count === 1 ? 'matrícula' : 'matrículas'}`;
  });

  ngOnInit(): void {
    void this.store.load();
  }

  setDateFilter(filter: DateFilter): void {
    this.dateFilter.set(filter);
    this.rangeStart.set(null);
    this.rangeEnd.set(null);
  }

  toggleSelect(): void {
    this.selectOpen.update(v => !v);
    if (this.selectOpen()) this.calendarOpen.set(false);
  }

  pickType(value: PlateFormat | ''): void {
    this.typeFilter.set(value);
    this.selectOpen.set(false);
  }

  toggleCalendar(): void {
    this.calendarOpen.update(v => !v);
    if (this.calendarOpen()) this.selectOpen.set(false);
  }

  prevMonth(): void {
    if (this.calMonth() === 0) {
      this.calMonth.set(11);
      this.calYear.update(y => y - 1);
    } else {
      this.calMonth.update(m => m - 1);
    }
  }

  nextMonth(): void {
    if (this.calMonth() === 11) {
      this.calMonth.set(0);
      this.calYear.update(y => y + 1);
    } else {
      this.calMonth.update(m => m + 1);
    }
  }

  selectDay(day: CalendarDay): void {
    const start = this.rangeStart();
    const end = this.rangeEnd();

    if (!start || end) {
      this.rangeStart.set(day.date);
      this.rangeEnd.set(null);
      this.dateFilter.set('all');
    } else {
      if (day.date < start) {
        this.rangeStart.set(day.date);
        this.rangeEnd.set(start);
      } else {
        this.rangeEnd.set(day.date);
      }
      this.calendarOpen.set(false);
    }
  }

  clearRange(): void {
    this.rangeStart.set(null);
    this.rangeEnd.set(null);
    this.dateFilter.set('all');
  }

  copyPlates(): void {
    const text = this.filteredRecords().map(r => r.display).join('\n');
    void navigator.clipboard.writeText(text);
  }

  private makeDay(
    date: Date, currentMonth: boolean, today: Date,
    start: Date | null, end: Date | null,
  ): CalendarDay {
    const t = date.getTime();
    const sT = start?.getTime() ?? -1;
    const eT = end?.getTime() ?? -1;
    return {
      date,
      day: date.getDate(),
      currentMonth,
      isToday: t === today.getTime(),
      isStart: t === sT,
      isEnd: t === eT,
      inRange: sT > -1 && eT > -1 ? t >= sT && t <= eT : t === sT,
    };
  }
}
