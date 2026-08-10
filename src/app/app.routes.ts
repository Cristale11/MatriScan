import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./tabs/tabs.page').then((m) => m.TabsPage),
    children: [
      { path: '', redirectTo: 'scanner', pathMatch: 'full' },
      {
        path: 'scanner',
        loadComponent: () =>
          import('./pages/scanner/scanner.page').then((m) => m.ScannerPage),
      },
      {
        path: 'historial',
        loadComponent: () =>
          import('./pages/history/history.page').then((m) => m.HistoryPage),
      },
      {
        path: 'ubicacion',
        loadComponent: () =>
          import('./pages/location/location.page').then((m) => m.LocationPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
