FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for ML and web scraping
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    git \
    libxml2-dev \
    libxslt-dev \
    && rm -rf /var/lib/apt/lists/*

# Pre-install only the absolute bare essentials to avoid version fights
RUN pip install --no-cache-dir \
    gunicorn \
    uvicorn \
    python-multipart \
    "pandas<2.3.0"

# Copy the minimal requirements and install
COPY requirements_minimal.txt .
RUN pip install --no-cache-dir -r requirements_minimal.txt

# Copy the entire agent codebase
COPY . .

# Ensure the temp_files directory exists
RUN mkdir -p temp_files

EXPOSE 8000

CMD ["gunicorn", "-k", "uvicorn.workers.UvicornWorker", "-b", "0.0.0.0:8000", "FastAPI-server.main:app"]
