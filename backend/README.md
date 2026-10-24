# ATHENA RF backend

FastAPI serves the static Arabic UI, accepts the custom UDP CSI stream on port 5005, saves explicitly labeled sessions to `backend/data/recordings`, and offers `/api/status`, `/api/recording/start`, `/api/recording/stop`, `/api/model/reload`, and `/ws/live`.

CSI UDP format (little-endian, 18-byte header): `<4sBBbBIIH`; magic `ATCS`, version=1, channel, signed RSSI, flags (`bit0=first_word_invalid`), packet sequence, device timestamp in microseconds, CSI length, then raw CSI bytes. No MAC addresses are recorded.

The feature extractor interprets signed pairs as `[imaginary, real]` and makes a 64-bin magnitude vector. This intentionally simple first baseline does not segment/phase-calibrate L-LTF and HT-LTF. For scientific-grade estimates, improve and validate this preprocessing against CSI metadata and ground truth.
