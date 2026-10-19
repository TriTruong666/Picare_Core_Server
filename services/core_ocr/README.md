# Picare Core OCR

## Python environment for the editor on macOS

The OCR container contains the full inference stack. For VS Code/Pyrefly and local parser/API tests, create the project-local Python 3.11 environment (the repo's `.vscode/settings.json` and this service's `pyrefly.toml` select it):

```sh
uv venv --python 3.11 services/core_ocr/.venv
uv pip install --python services/core_ocr/.venv/bin/python -r services/core_ocr/requirements.editor.txt
uv pip install --python services/core_ocr/.venv/bin/python --no-deps paddleocr==3.3.1
```

The last command installs PaddleOCR's Python module for import resolution without installing its Linux-only inference runtime into macOS. Run OCR and the image inference smoke test through Docker. After setup, use **Python: Select Interpreter** in VS Code if an interpreter was selected manually before; choose `services/core_ocr/.venv/bin/python`. Pyrefly's VS Code integration gives a manually selected interpreter precedence over project configuration.
The editor environment also pins Pyrefly 1.3.2. If the extension was already running before `paddleocr` was installed, reload the VS Code window once so it refreshes the package index and uses the binary from this environment.

Self-hosted OCR; no external inference API. Route → Pydantic schema → controller → service → registry/engine. No database access inside Python. Same response envelope as Node: `{success,message,data}` or `{success:false,message,error_code,details}`. OCR is an editing aid, NOT identity verification.

## Local test (Node runs on host)

From the Core repo:

```sh
docker compose --env-file .env.development -f docker-compose.ocr.yml up -d --build
docker compose --env-file .env.development -f docker-compose.ocr.yml logs --tail=50 core-ocr
curl http://127.0.0.1:8010/health/ready
```

Restart Core and Office Node processes after pulling the code/protos. Open a valid invited account at `/member/setup`, step 2, choose two JPEG/PNG/WEBP files, then **Đọc thông tin từ ảnh**. Edit the fields, retry with another photo, or type manually. No OCR output is saved until **Tham gia**. Completion also saves images/signature without using admin-only APIs.

For all-container development use the existing `docker-compose.dev.yml` (Core URL is overridden to `http://core-ocr:8010`). Do not start both OCR Compose variants on the same host port.

## Configuration / production

| Setting | Core Node | Office | Python |
| --- | --- | --- | --- |
| `GRPC_OCR_SERVICE_TOKEN` | incoming RPC secret | outgoing RPC secret | — |
| `CORE_OCR_SERVICE_TOKEN` | outgoing Python secret | — | incoming HTTP secret |
| `GRPC_STORAGE_SERVICE_TOKEN` | fallback for both secrets | fallback RPC secret | fallback HTTP secret |
| `CORE_OCR_URL` | defaults `http://127.0.0.1:8010`; Compose uses service DNS | — | — |
| `OCR_CPU_THREADS` | — | — | default 4 |
| `OCR_CPUS` | — | — | Compose CPU quota; default 4, set no higher than available vCPUs |
| `OCR_REQUEST_TIMEOUT_SECONDS` | — | — | default 75, clamped to 10–80 |

Both boundaries fail closed when no secret is configured. Reuse the already-matched storage token for initial deployment, or set dedicated secrets on each matching pair. Never expose OCR HTTP or unauthenticated gRPC on a public interface. Remote gRPC hops require private networking/TLS termination as with existing Core services.

Local `.env.development` and `.env.production` files have dedicated OCR secrets configured. Before production deployment, copy those settings into the corresponding GitHub production environment secrets for **both** Core and Office; ignored local env files are not deployed automatically. Do not paste secret values into logs or source control.

The production GitHub workflow builds/pushes a separate OCR image when OCR files change on a push to `production`; the existing Compose deploy pulls and starts it alongside Core. To rebuild an OCR image that a previous run skipped, use **Actions → Deploy Picare Core Hub Service → Run workflow → production**. Manual runs always build and test OCR before publishing and deploying it. Check the container startup log for `ocr_runtime policy=orientation-v2` after deployment. No extra published port. Model weights download **during image build**, not on requests. Python dependencies are locked in `requirements.lock`; the tested image is the deployment artifact. Build targets Linux amd64; Apple Silicon development uses emulation and is slower. Benchmark CPU/RAM and p95 latency on the production hardware; default limits are 4 CPUs / 3 GB, not an SLA. Do not increase Uvicorn workers: each loads another copy of the models.

The UI request timeout is 105s; Office→Core deadline 95s; Core→Python timeout 90s. Python stops between inference stages at 75s by default. Two valid fields or several upright labels end front orientation search; one valid back field or a back label ends back orientation search. The front search reserves 40s for the back, and optional back rotations stop with 30s remaining. Region rereads stop when time is low. A watchdog exits the OCR process five seconds after its deadline if an inference call itself hangs; Docker restarts the container. Core reports a disconnect near this watchdog deadline as `ERR_OCR_TIMEOUT`. Set the reverse proxy read timeout to at least 110s for OCR and 180s for setup completion. Python admits a single inference at a time. Core uses an atomic Redis lease to admit one request across Core replicas and limits each user to 5 accepted attempts per 60 seconds. Busy requests do not consume quota. The lease expires after 95 seconds; a failed release may temporarily return busy. During Redis outages Core uses a per-process limit and Python still refuses concurrent inference. Large document jobs should later use the existing Core queue infrastructure, not a second Celery system.

Core sends `RESOURCE_EXHAUSTED` for both busy and rate-limited calls. The `x-ocr-error-code` gRPC error metadata distinguishes `ERR_OCR_BUSY` from `ERR_OCR_RATE_LIMITED`; Office maps these to HTTP 429 for the OCR helper text. The request/response messages in `proto/ocr.proto` are identical in Core and Office and need no schema change.

For production latency diagnosis, check startup for `ocr_runtime policy=orientation-v2` to verify the running image contains the current rotation policy. Search the Python container logs for the same `request_id` shown in Core's `[ocr]` line. `ocr_stage` reports `decode_front`, `decode_back`, `qr`, `read_front_0`, `read_back_0`, any rotation passes and region rereads. `ocr_orientation` reports each side's chosen rotation, recognized field/label counts and why rotation search stopped. `ocr_card_theme` reports `vn_id_2024`, `vn_cccd_legacy` or `unknown`, plus a field count and whether a QR was decoded; it never prints identity values or OCR text. Repeated `read_*_90/270/180` stages indicate orientation search; retaking both card photos upright avoids those expensive passes. The engine now decodes and resizes each uploaded image once per request, including when rotation or region rereads are needed. CPU inference remains the main cost. Benchmark the same authorized images at the 4 CPU default, checking latency, OCR fields and host CPU usage. Increasing threads beyond the CPU quota causes contention. More Uvicorn workers also load more model copies, so keep one worker per container.

Core and OCR log the same `request_id`. OCR logs stage names, elapsed milliseconds, completion status and field counts; logs never contain image bytes, OCR text, tokens or identity fields. Follow the local service with `docker compose --env-file .env.development -f docker-compose.ocr.yml logs -f core-ocr` and search Core logs for `[ocr] request_id=...`.

## API / data lifecycle

- Office `POST /api/v1/member/invitation/ocr`: authenticated multipart `token`, `front`, `back`. Verifies the invitation before and after inference, returns suggestions only.
- Office `POST /api/v1/member/invitation/complete`: multipart `payload` (JSON setup fields + token + optional signatureDataUrl), optional `front`/`back`. No client-provided asset keys/URLs. Uploads private assets, then atomically updates member and accepts the invitation. OCR is optional.
- Internal Python `POST /api/v1/ocr/recognize`: multipart `document_type`, `front`, optional `back`, `x-service-token`. Supported handlers `vn_identity_card` (two images) and `document` (one image/plain text; PDFs/layout extraction not yet supported).
- Images max 10MB each, decoded images max 20MP. Runtime does not send data to a model vendor. Multipart spooling uses temporary files, closed at the end of the request; production `/tmp` is tmpfs. No images, tokens or OCR text are logged by application code. Do not enable body logging on gateways.
- Completed setup images use existing private S3 storage. Failed setup deletes completed uploads. Timed-out storage uploads get a bounded terminal-state cleanup watcher; a server crash during upload still requires storage orphan reconciliation (as does the existing storage workflow). Do not apply automatic expiry to committed credential folders.

## Accuracy / extensibility

Registry handlers own extraction, shared engine combines PaddleOCR (`PP-OCRv5_mobile_det` / `latin_PP-OCRv5_mobile_rec`) and **local Tesseract vie+eng**. The upstream Latin dictionary is missing many Vietnamese accented capitals (confirmed in the shipped model and upstream issue https://github.com/PaddlePaddle/PaddleOCR/issues/16339). Tesseract supplies Vietnamese lines above a minimum recognition confidence; Paddle label lines are preserved when Tesseract misses the label. Both engines run entirely locally. For identity cards, detected vertical text triggers a rotation search even if some fields are read; upright cards skip extra full-image passes once their orientation is clear. Missing origin and issuer fields are reread from crops anchored to detected text boxes in the photo. Conservative label extraction rejects short/low-confidence name fragments and incomplete address fragments; unreadable/unknown fields remain empty, never guessed.

The identity handler additionally decodes the printed QR **locally** with ZXing, retrying at higher resolution when a small printed code is missed. QR suggestions require its 12-digit number to match the printed number read from the front, or uniquely from the reverse when the front number is unreadable. It may suggest name, permanent address, birth date, sex, and issue date; conflicts with printed text use the QR value and carry an explicit review warning. The old ID number is never returned. Origin and issuing authority are not contained in this QR and still depend on OCR/manual entry. QR values are suggestions, not proof of card authenticity or account ownership. Confidence is transcription confidence, not proof of correctness. Glare, unusual layouts and new card variants may need a retake/manual input. No chip reading, liveness, authenticity verification, or guaranteed matching of two sides.

The 2024 `Căn cước` layout places residence, birth registration place, expiry date and the QR on the back. Its birth registration place is returned as `birthRegistrationPlace`, separate from the older CCCD `placeOfOrigin` field. Office accepts and displays both fields separately; no database migration is needed because identification is stored as JSON. New-layout QR payloads with empty trailing optional segments are accepted only after the printed number matches.

Add handlers in `app/handlers`, register explicitly in `OcrService`, update `OcrInput` and Core schema allowlist. No dynamic module names from clients. Add synthetic parser tests and evaluate on an authorized real-image corpus before claiming production accuracy.

```sh
python -m unittest discover -s tests
```
