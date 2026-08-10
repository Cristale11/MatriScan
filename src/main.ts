import { bootstrapApplication } from '@angular/platform-browser';
import {
  RouteReuseStrategy, provideRouter, withPreloading, PreloadAllModules,
} from '@angular/router';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular/standalone';
import { Capacitor } from '@capacitor/core';
import { routes } from './app/app.routes';
import { AppComponent } from './app/app.component';
import { OCR_PROVIDER } from './app/core/ocr/ocr-provider';
import { WebOcrProvider } from './app/core/ocr/web-ocr.provider';
import { NativeOcrProvider } from './app/core/ocr/native-ocr.provider';

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular({ mode: 'md' }),
    provideRouter(routes, withPreloading(PreloadAllModules)),
    {
      provide: OCR_PROVIDER,
      useClass: Capacitor.isNativePlatform() ? NativeOcrProvider : WebOcrProvider,
    },
  ],
});
