"""
Descarga el modelo YOLOv11n de detección de matrículas (ONNX pre-exportado).

Uso:
  pip install huggingface_hub
  python scripts/export-model.py
"""
import shutil
from pathlib import Path

try:
    from huggingface_hub import hf_hub_download
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "huggingface_hub"])
    from huggingface_hub import hf_hub_download

dst = Path(__file__).resolve().parent.parent / "src" / "assets" / "models" / "plate-detect.onnx"
dst.parent.mkdir(parents=True, exist_ok=True)

print("Descargando modelo YOLOv11n plate detection desde Hugging Face...")
downloaded = hf_hub_download(
    repo_id="morsetechlab/yolov11-license-plate-detection",
    filename="license-plate-finetune-v1n.onnx",
)

shutil.copy2(downloaded, dst)
print(f"Modelo copiado a {dst} ({dst.stat().st_size / 1e6:.1f} MB)")
