FROM python:3.12-slim

WORKDIR /app

# System deps for asyncpg (libpq) and build tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends gcc libpq-dev && \
    rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy project source
COPY . .

# Every module import resolves from /app
ENV PYTHONPATH=/app
ENV PYTHONUNBUFFERED=1

# No CMD — each docker-compose service overrides the command
