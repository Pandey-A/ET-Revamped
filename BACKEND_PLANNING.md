# Backend Planning Document

## 1) Goals
- Provide secure auth, role-based access, and quota control for analysis usage.
- Offer stable API endpoints for image, video, audio, and URL-based deepfake checks.
- Keep model-serving concerns isolated from business logic so each can scale independently.
- Improve observability, reliability, and deployment workflow for production.

## 2) Current Backend Topology
- Main API service (Node/Express): user auth, admin routes, quota checks, proxying to model services.
- Deepfake orchestration service (Python/Flask in deepfake_backend): URL ingestion (YouTube/Instagram/LinkedIn), download, fan-out to face/audio services.
- Model services (external or local):
  - Video/Image model endpoint (port 5006 in current defaults).
  - Audio conversion/predict endpoint (port 5000 in current defaults).

## 3) Recommended Target Architecture
- API Gateway Layer: existing Node service remains the public entrypoint.
- Analysis Orchestrator: keep deepfake_backend as a private internal service for URL workflows and future multi-model orchestration.
- Model Inference Services: remain separate stateless services with health checks.
- Data Layer: MongoDB for users, quota state, logs, and future billing metadata.

## 4) Is deepfake_backend Necessary?
Short answer: yes, if you want URL-based analysis and clean orchestration.

When it is necessary:
- You need /analysis/url style workflows (download + preprocess + multiple model calls).
- You want Python ecosystem tools (yt-dlp, media tooling) separate from Node app logic.
- You want to independently scale analysis orchestration from auth/admin APIs.

When it may be removed:
- You only support direct file upload from frontend to model endpoints.
- You do not need URL ingestion or model fan-out logic.
- You are comfortable moving all orchestration into Node (which increases complexity there).

Recommendation for this project:
- Keep deepfake_backend as a separate internal service.
- Treat it as optional by feature flag:
  - Enabled for URL analysis.
  - Bypassed for direct file upload flows.

## 5) API Contract Plan
### Public API (Node service)
- POST /api/analysis/video
- POST /api/analysis/image
- POST /api/analysis/audio/convert
- POST /api/analysis/audio/predict
- POST /api/analysis/url

Contract rules:
- Standard response envelope for JSON:
  - success: boolean
  - data: object
  - quota: object | null
  - error: { code, message } | null
- Correlation ID in request/response headers for traceability.
- Timeouts and upstream error mapping standardized.

## 6) Security Plan
- Keep JWT in httpOnly cookies with secure + sameSite configured per environment.
- Strict CORS allowlist via FRONTEND_ORIGIN.
- Input validation for all analysis routes (file type, file size, URL schema/domain).
- Add API rate limiting at Node layer (per-IP and per-user).
- Internal service network only for deepfake_backend and model services.

## 7) Quota and Billing Readiness
- Keep existing analysisRequestsUsed/analysisRequestLimit model.
- Add idempotency token for retry-safe quota consumption.
- Move usage update + log write into transactional flow where possible.
- Add plan tiers and per-feature quotas (video/image/url can have separate costs).

## 8) Reliability and Performance
- Add health endpoints:
  - Node: /health
  - deepfake_backend: /health
  - each model service: /health
- Use retry policy only for safe upstream operations.
- Add queue option for long-running URL analysis (future):
  - API returns jobId.
  - Worker performs download + inference.
  - Client polls or subscribes for completion.

## 9) Observability Plan
- Structured logs (JSON) across all services.
- Metrics:
  - request count/latency/error rate per endpoint
  - upstream model latency/error rate
  - quota consumption per user and per day
- Tracing:
  - propagate correlation ID to deepfake_backend and model services.

## 10) Deployment Plan
### Environments
- Local: docker-compose or scripts for Node + Python + model mocks.
- Staging: mirror production topology with lower scale.
- Production: separate services with internal networking.

### Env Vars Baseline
Node service:
- MONGO_URI
- FRONTEND_ORIGIN
- VIDEO_ANALYSIS_BASE
- AUDIO_ANALYSIS_BASE
- DEEPFAKE_ANALYSIS_BASE
- JWT_SECRET

deepfake_backend:
- VIDEO_API_URL
- AUDIO_CONVERT_URL
- AUDIO_PREDICT_URL
- COOKIES_FILE (optional for social downloads)

## 11) Testing Strategy
- Unit tests:
  - quota math, auth middleware, error mapping.
- Integration tests:
  - proxy routes with mocked upstream services.
  - URL workflow in deepfake_backend with mocked ytdlp/model responses.
- Contract tests:
  - ensure stable JSON schema for frontend.
- Load tests:
  - /api/analysis/video and /api/analysis/url under realistic payload sizes.

## 12) Implementation Roadmap
Phase 1 (Hardening, 1-2 weeks):
- Standardize response envelope.
- Add validation, rate limiting, correlation IDs.
- Add health endpoints and improved timeout handling.

Phase 2 (Reliability, 1-2 weeks):
- Add structured logging and metrics.
- Improve quota atomicity and rollback handling.
- Add integration tests for proxy paths.

Phase 3 (Scalability, 2-3 weeks):
- Introduce async job flow for URL analysis.
- Worker service for heavy media operations.
- Add staging performance benchmarks.

Phase 4 (Productization, ongoing):
- Billing plan hooks.
- Admin dashboards for usage/latency/error tracking.
- Model-version awareness in API responses.

## 13) Decisions To Make Now
- Keep deepfake_backend as separate service: Yes.
- Keep direct file upload proxy path in Node: Yes.
- Add async jobs for URL analysis in next milestone: Recommended.
- Enforce strict max upload size by type: Required before production.

## 14) Definition of Done (Backend)
- All analysis endpoints return consistent contract.
- Quota cannot be double-consumed under retries.
- End-to-end tracing works across Node -> Python -> model service.
- Staging load test passes agreed latency/error thresholds.
- Runbooks documented for upstream outage and model timeout scenarios.
