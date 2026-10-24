# ESP32-S3 firmware

The active ESP-IDF project is at the repository root (`CMakeLists.txt` + `main/`). The firmware captures Wi-Fi CSI and streams packets to the ATHENA RF PC collector over UDP.

## Runtime setup (no credentials baked into the build)

On first boot, the board starts a Wi-Fi setup AP named `ATHENA-RF-Setup` (password `athena1234`). Connect to it and open `http://192.168.4.1`. Enter the 2.4 GHz Wi-Fi SSID/password, the PC IPv4 address, and UDP port 5005. Settings are saved in NVS; the device restarts and connects to the configured Wi-Fi.

The PC must run `START-ATHENA.bat`, be reachable on the same LAN, and allow inbound UDP port 5005 through Windows Firewall. The browser-flash page is `http://localhost:8080/flash.html` once the `athena-rf-merged.bin` build artifact has been copied into `web/firmware/`.

Target version: ESP-IDF v5.5.5. CSI is enabled by `CONFIG_ESP_WIFI_CSI_ENABLED` and uses `esp_wifi_set_csi_rx_cb`, `esp_wifi_set_csi_config`, and `esp_wifi_set_csi`.
