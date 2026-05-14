#!/bin/bash
cd /home/ubuntu/elevatetrust/HR-Reachout-Agent-main
source .venv/bin/activate
exec gunicorn -k uvicorn.workers.UvicornWorker -b 0.0.0.0:8000 FastAPI-server.main:app
