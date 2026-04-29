#!/bin/bash
cd /home/ubuntu/elevatetrust/deepfake_backend
source .venv/bin/activate
exec gunicorn -b 0.0.0.0:8003 app:app
