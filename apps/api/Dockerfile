FROM python:3.11-slim

WORKDIR /workspace

RUN apt-get update && apt-get install -y \
    ffmpeg \
    imagemagick \
    curl \
    libva2 libva-drm2 vainfo i965-va-driver mesa-va-drivers \
    && rm -rf /var/lib/apt/lists/*
# VAAPI drivers above enable Intel (i965) and AMD/Radeon (mesa) hardware
# encoding when TRANSCODER_HWACCEL=vaapi and /dev/dri is passed to the worker.
# NVIDIA (nvenc) needs no extra package here — it uses the host's NVIDIA runtime.

# Install API dependencies
COPY apps/api/requirements.txt /workspace/apps/api/requirements.txt
RUN pip install --no-cache-dir -r /workspace/apps/api/requirements.txt

# Copy transcoder package and API
COPY packages/transcoder /workspace/packages/transcoder
COPY apps/api /workspace/apps/api

# Stay in /workspace so imports work as packages
WORKDIR /workspace

CMD ["uvicorn", "apps.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
