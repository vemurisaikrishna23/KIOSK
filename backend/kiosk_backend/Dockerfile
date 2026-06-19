# =====================================
# 1️⃣ Base image with Python and system deps
# =====================================
FROM python:3.12-slim AS base

# Prevent Python from writing .pyc files & buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Set working directory
WORKDIR /app

# Install essential build tools for Twisted, cryptography, cffi, etc.
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libssl-dev \
    libffi-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/*

# =====================================
# 2️⃣ Install dependencies
# =====================================
COPY requirements.txt .

RUN pip install --upgrade pip setuptools wheel \
 && pip install --no-cache-dir -r requirements.txt

# =====================================
# 3️⃣ Copy project files
# =====================================
COPY . .

# =====================================
# 4️⃣ Expose Daphne port and start server
# =====================================
EXPOSE 8000

# On start: apply DB migrations, gather static files for WhiteNoise, then
# launch the Daphne ASGI server (Django Channels). `exec` makes Daphne PID 1
# so it receives stop/restart signals cleanly. Drop the migrate step if you
# prefer to run migrations manually as a one-off container.
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py collectstatic --noinput && exec daphne -b 0.0.0.0 -p 8000 kiosk_backend.asgi:application"]
