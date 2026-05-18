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

# Run Daphne ASGI server (Django Channels)
# Replace `school_management.asgi:application` with your actual ASGI app path
#CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "school_management.asgi:application"]
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "kiosk_backend.asgi:application"]
