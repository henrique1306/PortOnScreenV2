# PortOnScreen

## Docker

Build the image from Windows with Docker Desktop:

```powershell
docker compose build
```

Docker Desktop on Windows can build this Linux image, but this project's Linux
container cannot directly access Windows COM ports and cameras by default. Run
the container on a Linux machine connected to the Arduino and camera:

```bash
docker compose up
```

By default, Compose passes `/dev/ttyUSB0` to the container as the Arduino and
`/dev/video0` as the camera. Set `SERIAL_DEVICE` and `CAMERA_DEVICE` in a
`.env` file or in the shell to use different Linux host device paths; Compose
maps them to `/dev/ttyUSB0` and `/dev/video0` inside the container. The baud
rate defaults to `9600`, and `API_URL` defaults to the configured API endpoint.

Captured images are persisted in `fotos_acessos`; EasyOCR's downloaded models
are stored in the `easyocr-models` Docker volume. On its first start, EasyOCR
downloads its OCR models, so the container needs internet access.

## Firebase local

`docker compose up --build` also starts Firebase Authentication and Firestore
Emulators in the `firebase` container. The application uses the local Firestore
by default when started through Compose; the Authentication Emulator is also
available at `http://localhost:9099`, and the Emulator UI is at
`http://localhost:4000`. Emulator ports are bound to localhost only.

Create authorized vehicle documents in the Emulator UI under the
`veiculos_autorizados` collection. Use the vehicle plate, normalized to uppercase,
as the document ID, with `nome_condutor` (string) and `autorizado` (boolean)
fields. Access records are added to `historico_acessos` and include the
`foto_arquivo` path to the matching image in `fotos_acessos`. The photos are
persisted by the Compose bind mount. Emulator data is exported to a Docker
volume on shutdown and restored at the next start.

The current camera-to-gate workflow has no operator login, so it does not sign
in users through Firebase Authentication. To keep using the existing remote API,
set `DATA_BACKEND=api` when starting Compose.

Example `.env` for a Linux host:

```dotenv
SERIAL_DEVICE=/dev/ttyACM0
CAMERA_DEVICE=/dev/video2
BAUD_RATE=9600
API_URL=https://api-arduino-khdv.onrender.com
```

## Local execution

The application can also be run directly with Python. Its existing defaults
remain in place (`COM6` and camera index `2`); `API_URL`, `PORTA_SERIAL`,
`BAUD_RATE`, `CAMERA_INDEX`, and `DATA_BACKEND` can be overridden with
environment variables. Direct execution defaults to the existing API backend;
set `DATA_BACKEND=firebase` and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` to
connect to a locally running Firestore Emulator.
