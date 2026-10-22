# --- Stage 1: build the SPA (npm runs only here, never in the Python image) ---
FROM node:20-alpine AS frontend

WORKDIR /build
# The bundle imports design/tokens.css by its REPO_ROOT-relative path, so the
# build stage mirrors that layout: design/ sits beside frontend/.
COPY frontend/ frontend/
COPY design/ design/

RUN npm --prefix frontend ci && npm --prefix frontend run build

# --- Stage 2: Python runtime (app + scripts + the baked SPA) ---
FROM python:3.11-slim

# tesseract-ocr binary + language data (eng, ind) needed by pytesseract at runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ind \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

# requirements-dev.txt is a superset of requirements.txt; installing it keeps
# `docker compose run --rm app pytest` working without a per-run install
# (tests themselves stay bind-mounted from the host in the dev compose file).
COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt

COPY app/ app/
COPY scripts/ scripts/
COPY --from=frontend /build/frontend/dist frontend/dist

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]