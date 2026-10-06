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
| `OCR_CPU_THREADS` | — | — | default 2 |

Both boundaries fail closed when no secret is configured. Reuse the already-matched storage token for initial deployment, or set dedicated secrets on each matching pair. Never expose OCR HTTP or unauthenticated gRPC on a public interface. Remote gRPC hops require private networking/TLS termination as with existing Core services.

Local `.env.development` and `.env.production` files have dedicated OCR secrets configured. Before production deployment, copy those settings into the corresponding GitHub production environment secrets for **both** Core and Office; ignored local env files are not deployed automatically. Do not paste secret values into logs or source control.

The production GitHub workflow builds/pushes a separate OCR image; the existing Compose deploy pulls and starts it alongside Core. No extra published port. Model weights download **during image build**, not on requests. Python dependencies are locked in `requirements.lock`; the tested image is the deployment artifact. Build targets Linux amd64; Apple Silicon development uses emulation and is slower. Benchmark CPU/RAM and p95 latency on the production hardware; initial limits are 2 CPUs / 3 GB, not an SLA. Do not increase Uvicorn workers: each loads another copy of the models.

The UI request timeout is 105s; Office→Core deadline 95s; Core→Python timeout 90s. Set the reverse proxy read timeout to at least 110s for OCR and 180s for setup completion. Python admits a single inference at a time, with busy responses; Core limits each user to 5 attempts/minute/process. For multiple replicas, put the rate limit at the gateway or use Redis atomics. Large document jobs should later use the existing Core queue infrastructure, not a second Celery system.

## API / data lifecycle

- Office `POST /api/v1/member/invitation/ocr`: authenticated multipart `token`, `front`, `back`. Verifies the invitation before and after inference, returns suggestions only.
- Office `POST /api/v1/member/invitation/complete`: multipart `payload` (JSON setup fields + token + optional signatureDataUrl), optional `front`/`back`. No client-provided asset keys/URLs. Uploads private assets, then atomically updates member and accepts the invitation. OCR is optional.
- Internal Python `POST /api/v1/ocr/recognize`: multipart `document_type`, `front`, optional `back`, `x-service-token`. Supported handlers `vn_identity_card` (two images) and `document` (one image/plain text; PDFs/layout extraction not yet supported).
- Images max 10MB each, decoded images max 20MP. Runtime does not send data to a model vendor. Multipart spooling uses temporary files, closed at the end of the request; production `/tmp` is tmpfs. No images, tokens or OCR text are logged by application code. Do not enable body logging on gateways.
- Completed setup images use existing private S3 storage. Failed setup deletes completed uploads. Timed-out storage uploads get a bounded terminal-state cleanup watcher; a server crash during upload still requires storage orphan reconciliation (as does the existing storage workflow). Do not apply automatic expiry to committed credential folders.

## Accuracy / extensibility

Registry handlers own extraction, shared engine combines PaddleOCR (`PP-OCRv5_mobile_det` / `latin_PP-OCRv5_mobile_rec`) and **local Tesseract vie+eng**. The upstream Latin dictionary is missing many Vietnamese accented capitals (confirmed in the shipped model and upstream issue https://github.com/PaddlePaddle/PaddleOCR/issues/16339). Tesseract supplies Vietnamese lines above a minimum recognition confidence; overlapping Paddle lines are replaced only when the Vietnamese result contains enough text, rather than allowing a two-letter fragment to erase a complete Paddle line. Both engines run entirely locally. For identity cards, each side is first read as shot; if key fields are missing, the service tries 90°, 270° and 180° rotations and selects the orientation that extracts more reliable identity fields. Conservative label extraction rejects short/low-confidence name fragments and incomplete address fragments; unreadable/unknown fields remain empty, never guessed.

The identity handler additionally decodes the printed QR **locally** with ZXing. A QR is used only if its 12-digit number matches the number OCR reads from the visible front face. It may suggest name, permanent address, birth date, sex, and issue date; conflicting dates/sex are left blank for manual review. The old ID number is never returned. Origin and issuing authority are not contained in this QR and still depend on OCR/manual entry. QR values are suggestions, not proof of card authenticity or account ownership. Confidence is transcription confidence, not proof of correctness. Glare, unusual layouts and new card variants may need a retake/manual input. No chip reading, liveness, authenticity verification, or guaranteed matching of two sides.

Add handlers in `app/handlers`, register explicitly in `OcrService`, update `OcrInput` and Core schema allowlist. No dynamic module names from clients. Add synthetic parser tests and evaluate on an authorized real-image corpus before claiming production accuracy.

```sh
python -m unittest discover -s tests
```
