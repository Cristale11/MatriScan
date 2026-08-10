package com.cristian.matriculas;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.os.SystemClock;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.FloatBuffer;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Detección de matrículas con YOLOv11n corriendo en ONNX Runtime NATIVO.
 *
 * Recibe un fotograma JPEG en base64, localiza la matrícula, la recorta de la
 * imagen original y guarda el recorte en caché para que ML Kit lo lea.
 * Todo el trabajo pesado (decodificación, inferencia, recorte) ocurre en
 * código nativo, fuera del WebView.
 */
@CapacitorPlugin(name = "PlateDetector")
public class PlateDetectorPlugin extends Plugin {

    private static final String TAG = "PlateDetector";
    private static final String MODEL_ASSET = "plate-detect.onnx";
    private static final int INPUT_SIZE = 320;
    private static final float CONF_THRESHOLD = 0.30f;
    private static final float PAD_RATIO = 0.15f;

    private OrtEnvironment env;
    private OrtSession session;
    private String inputName;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    /**
     * Carga el modelo y ejecuta una inferencia de calentamiento. Se llama al
     * abrir la cámara para que el primer escaneo real no pague la carga.
     */
    @PluginMethod
    public void warmup(PluginCall call) {
        executor.execute(() -> {
            try {
                long t0 = SystemClock.elapsedRealtime();
                ensureSession();

                float[] zeros = new float[3 * INPUT_SIZE * INPUT_SIZE];
                try (OnnxTensor tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(zeros),
                        new long[]{1, 3, INPUT_SIZE, INPUT_SIZE});
                     OrtSession.Result ignored = session.run(Collections.singletonMap(inputName, tensor))) {
                    // solo calienta los kernels
                }

                Log.d(TAG, "warmup completado en " + (SystemClock.elapsedRealtime() - t0) + "ms");
                call.resolve();
            } catch (Exception e) {
                call.reject("Error en warmup: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void detect(PluginCall call) {
        final String image = call.getString("image");
        if (image == null || image.isEmpty()) {
            call.reject("Falta el parámetro 'image' (JPEG en base64)");
            return;
        }

        executor.execute(() -> {
            try {
                ensureSession();

                long t0 = SystemClock.elapsedRealtime();
                byte[] jpeg = Base64.decode(image, Base64.DEFAULT);
                Bitmap original = BitmapFactory.decodeByteArray(jpeg, 0, jpeg.length);
                if (original == null) {
                    call.reject("No se pudo decodificar la imagen");
                    return;
                }
                long t1 = SystemClock.elapsedRealtime();

                float[] box = runInference(original);
                long t2 = SystemClock.elapsedRealtime();
                Log.d(TAG, "decode=" + (t1 - t0) + "ms yolo=" + (t2 - t1) + "ms");

                if (box == null) {
                    JSObject miss = new JSObject();
                    miss.put("found", false);
                    call.resolve(miss);
                    return;
                }

                File cropFile = cropAndSave(original, box);

                JSObject ret = new JSObject();
                ret.put("found", true);
                ret.put("path", "file://" + cropFile.getAbsolutePath());
                ret.put("confidence", box[4]);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Error en detección: " + e.getMessage());
            }
        });
    }

    private synchronized void ensureSession() throws Exception {
        if (session != null) return;

        env = OrtEnvironment.getEnvironment();

        byte[] model;
        try (InputStream is = getContext().getAssets().open(MODEL_ASSET);
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
            model = bos.toByteArray();
        }

        // XNNPACK es el motor de CPU optimizado para móvil de ONNX Runtime.
        // Si el modelo no es compatible, caemos al motor estándar.
        try {
            session = createSession(model, true);
            Log.d(TAG, "Sesión creada con XNNPACK");
        } catch (Exception e) {
            Log.w(TAG, "XNNPACK no disponible, usando CPU estándar: " + e.getMessage());
            session = createSession(model, false);
        }
        inputName = session.getInputNames().iterator().next();
    }

    private OrtSession createSession(byte[] model, boolean useXnnpack) throws Exception {
        OrtSession.SessionOptions opts = new OrtSession.SessionOptions();
        opts.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        if (useXnnpack) {
            Map<String, String> xnnOpts = new HashMap<>();
            xnnOpts.put("intra_op_num_threads", "4");
            opts.addXnnpack(xnnOpts);
            opts.setIntraOpNumThreads(1);
        } else {
            opts.setIntraOpNumThreads(4);
        }
        return env.createSession(model, opts);
    }

    /**
     * Ejecuta YOLO sobre el bitmap y devuelve la mejor caja en coordenadas de
     * la imagen original: [x, y, w, h, confianza]. Null si no hay matrícula.
     */
    private float[] runInference(Bitmap original) throws Exception {
        int ow = original.getWidth();
        int oh = original.getHeight();

        float ratio = Math.min((float) INPUT_SIZE / ow, (float) INPUT_SIZE / oh);
        int newW = Math.round(ow * ratio);
        int newH = Math.round(oh * ratio);
        float padX = (INPUT_SIZE - newW) / 2f;
        float padY = (INPUT_SIZE - newH) / 2f;

        Bitmap letterbox = Bitmap.createBitmap(INPUT_SIZE, INPUT_SIZE, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(letterbox);
        canvas.drawColor(Color.rgb(128, 128, 128));
        Paint paint = new Paint(Paint.FILTER_BITMAP_FLAG);
        canvas.drawBitmap(original, null, new Rect(
            Math.round(padX), Math.round(padY),
            Math.round(padX) + newW, Math.round(padY) + newH), paint);

        int area = INPUT_SIZE * INPUT_SIZE;
        int[] pixels = new int[area];
        letterbox.getPixels(pixels, 0, INPUT_SIZE, 0, 0, INPUT_SIZE, INPUT_SIZE);
        letterbox.recycle();

        float[] chw = new float[3 * area];
        for (int i = 0; i < area; i++) {
            int p = pixels[i];
            chw[i] = ((p >> 16) & 0xFF) / 255f;
            chw[i + area] = ((p >> 8) & 0xFF) / 255f;
            chw[i + area * 2] = (p & 0xFF) / 255f;
        }

        try (OnnxTensor tensor = OnnxTensor.createTensor(env, FloatBuffer.wrap(chw),
                new long[]{1, 3, INPUT_SIZE, INPUT_SIZE});
             OrtSession.Result result = session.run(Collections.singletonMap(inputName, tensor))) {

            float[][][] out = (float[][][]) result.get(0).getValue();
            float[][] o = out[0];
            int numFields = o.length;
            int numDetections = o[0].length;

            float bestConf = 0f;
            int bestIdx = -1;
            for (int i = 0; i < numDetections; i++) {
                float conf;
                if (numFields > 5) {
                    conf = 0f;
                    for (int c = 4; c < numFields; c++) {
                        if (o[c][i] > conf) conf = o[c][i];
                    }
                } else {
                    conf = o[4][i];
                }
                if (conf > bestConf) {
                    bestConf = conf;
                    bestIdx = i;
                }
            }

            if (bestIdx < 0 || bestConf < CONF_THRESHOLD) return null;

            float cx = o[0][bestIdx];
            float cy = o[1][bestIdx];
            float w = o[2][bestIdx];
            float h = o[3][bestIdx];

            float x = (cx - w / 2f - padX) / ratio;
            float y = (cy - h / 2f - padY) / ratio;
            return new float[]{x, y, w / ratio, h / ratio, bestConf};
        }
    }

    /** Recorta la caja (con margen) de la imagen original y la guarda en caché. */
    private File cropAndSave(Bitmap original, float[] box) throws Exception {
        int ow = original.getWidth();
        int oh = original.getHeight();

        float padW = box[2] * PAD_RATIO;
        float padH = box[3] * PAD_RATIO;
        int x = Math.max(0, Math.round(box[0] - padW));
        int y = Math.max(0, Math.round(box[1] - padH));
        int w = Math.min(Math.round(box[2] + padW * 2), ow - x);
        int h = Math.min(Math.round(box[3] + padH * 2), oh - y);

        if (w < 10 || h < 10) throw new Exception("Recorte demasiado pequeño");

        Bitmap crop = Bitmap.createBitmap(original, x, y, w, h);
        File file = new File(getContext().getCacheDir(), "plate_crop.jpg");
        try (FileOutputStream fos = new FileOutputStream(file)) {
            crop.compress(Bitmap.CompressFormat.JPEG, 92, fos);
        }
        crop.recycle();
        return file;
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdown();
        try {
            if (session != null) session.close();
        } catch (Exception ignored) { }
        session = null;
    }
}
