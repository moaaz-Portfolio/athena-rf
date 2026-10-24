#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "esp_event.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "lwip/inet.h"
#include "csi_stream.h"

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1
#define MAX_RETRIES 12
#define SETTINGS_NS "athena"
#define SETUP_AP_SSID "ATHENA-RF-Setup"
#define SETUP_AP_PASSWORD "athena1234"
#define DEFAULT_UDP_PORT 5005

static const char *TAG = "ATHENA_RF";
static EventGroupHandle_t s_wifi_events;
static int s_retry_count;
static char s_ssid[33];
static char s_password[65];
static char s_pc_ip[16];
static uint16_t s_pc_port = DEFAULT_UDP_PORT;

static const char SETUP_HTML[] =
"<!doctype html><html lang='ar' dir='rtl'><meta charset='utf-8'>"
"<meta name='viewport' content='width=device-width,initial-scale=1'>"
"<title>إعداد ATHENA RF</title><style>body{font-family:system-ui;background:#0b1220;color:#e8eef7;max-width:600px;margin:30px auto;padding:18px}"
"form{background:#121d30;padding:22px;border-radius:16px}label{display:block;margin:14px 0 6px}input{width:100%;box-sizing:border-box;padding:12px;border-radius:8px;border:1px solid #3c4b63;background:#08101d;color:white}"
"button{margin-top:20px;width:100%;padding:13px;background:#22c55e;border:0;border-radius:9px;font-weight:700;cursor:pointer}small{color:#b7c4d8}</style>"
"<h1>ATHENA RF — إعداد اللوحة</h1><p>أدخل شبكة 2.4 GHz التي يتصل بها الكمبيوتر، وعنوان IPv4 للكمبيوتر.</p>"
"<form method='post' action='/save'><label>اسم شبكة Wi‑Fi (SSID)</label><input name='ssid' maxlength='32' required autocomplete='off'>"
"<label>كلمة مرور الشبكة</label><input name='password' type='password' maxlength='64' autocomplete='new-password'>"
"<label>عنوان IPv4 للكمبيوتر</label><input name='pc_ip' placeholder='192.168.1.20' pattern='[0-9.]{7,15}' required>"
"<label>UDP Port</label><input name='port' type='number' min='1024' max='65535' value='5005' required>"
"<button type='submit'>حفظ الإعدادات وإعادة التشغيل</button></form>"
"<p><small>كلمة مرور شبكة الإعداد المؤقتة: athena1234. بعد الحفظ ستعيد اللوحة التشغيل وتتصل براوترك.</small></p></html>";

static bool load_settings(void)
{
    nvs_handle_t nvs;
    if (nvs_open(SETTINGS_NS, NVS_READONLY, &nvs) != ESP_OK) return false;
    size_t n = sizeof(s_ssid);
    esp_err_t err = nvs_get_str(nvs, "ssid", s_ssid, &n);
    n = sizeof(s_password);
    (void)nvs_get_str(nvs, "password", s_password, &n);
    n = sizeof(s_pc_ip);
    (void)nvs_get_str(nvs, "pc_ip", s_pc_ip, &n);
    (void)nvs_get_u16(nvs, "port", &s_pc_port);
    nvs_close(nvs);
    return err == ESP_OK && s_ssid[0] != '\0' && s_pc_ip[0] != '\0';
}

static esp_err_t setup_root_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, SETUP_HTML, HTTPD_RESP_USE_STRLEN);
}

static void delayed_restart(void *arg)
{
    (void)arg;
    vTaskDelay(pdMS_TO_TICKS(1500));
    esp_restart();
}

static esp_err_t setup_save_handler(httpd_req_t *req)
{
    if (req->content_len <= 0 || req->content_len > 1024) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid form size");
        return ESP_FAIL;
    }
    char body[1025] = {0};
    int received = 0;
    while (received < req->content_len) {
        int n = httpd_req_recv(req, body + received, req->content_len - received);
        if (n <= 0) {
            httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Could not read form");
            return ESP_FAIL;
        }
        received += n;
    }
    body[received] = '\0';

    char ssid[33] = {0};
    char password[65] = {0};
    char pc_ip[16] = {0};
    char port_text[8] = {0};
    if (httpd_query_key_value(body, "ssid", ssid, sizeof(ssid)) != ESP_OK ||
        httpd_query_key_value(body, "pc_ip", pc_ip, sizeof(pc_ip)) != ESP_OK ||
        httpd_query_key_value(body, "port", port_text, sizeof(port_text)) != ESP_OK) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Missing required fields");
        return ESP_FAIL;
    }
    /* Password may intentionally be empty for an open Wi-Fi network. */
    (void)httpd_query_key_value(body, "password", password, sizeof(password));
    struct in_addr parsed_ip;
    char *end = NULL;
    unsigned long port = strtoul(port_text, &end, 10);
    if (ssid[0] == '\0' || inet_aton(pc_ip, &parsed_ip) == 0 ||
        end == port_text || *end != '\0' || port < 1024 || port > 65535) {
        httpd_resp_send_err(req, HTTPD_400_BAD_REQUEST, "Invalid SSID, IPv4 or UDP port");
        return ESP_FAIL;
    }

    nvs_handle_t nvs = 0;
    bool nvs_opened = false;
    esp_err_t err = nvs_open(SETTINGS_NS, NVS_READWRITE, &nvs);
    nvs_opened = (err == ESP_OK);
    if (err == ESP_OK) err = nvs_set_str(nvs, "ssid", ssid);
    if (err == ESP_OK) err = nvs_set_str(nvs, "password", password);
    if (err == ESP_OK) err = nvs_set_str(nvs, "pc_ip", pc_ip);
    if (err == ESP_OK) err = nvs_set_u16(nvs, "port", (uint16_t)port);
    if (err == ESP_OK) err = nvs_commit(nvs);
    if (nvs_opened) nvs_close(nvs);
    if (err != ESP_OK) {
        httpd_resp_send_err(req, HTTPD_500_INTERNAL_SERVER_ERROR, "Could not save settings");
        return ESP_FAIL;
    }

    const char *response = "<!doctype html><meta charset='utf-8'><meta name='viewport' content='width=device-width'><html lang='ar' dir='rtl'><body style='font-family:system-ui;background:#0b1220;color:#fff;padding:24px'><h2>تم حفظ الإعدادات</h2><p>ستعيد اللوحة التشغيل الآن. أعد توصيل الكمبيوتر بشبكته الأصلية، ثم راجع لوحة ATHENA RF.</p></body></html>";
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_send(req, response, HTTPD_RESP_USE_STRLEN);
    xTaskCreate(delayed_restart, "athena_restart", 2048, NULL, 1, NULL);
    return ESP_OK;
}

static void start_setup_ap(void)
{
    esp_netif_create_default_wifi_ap();
    wifi_config_t ap_cfg = {0};
    strlcpy((char *)ap_cfg.ap.ssid, SETUP_AP_SSID, sizeof(ap_cfg.ap.ssid));
    strlcpy((char *)ap_cfg.ap.password, SETUP_AP_PASSWORD, sizeof(ap_cfg.ap.password));
    ap_cfg.ap.ssid_len = strlen(SETUP_AP_SSID);
    ap_cfg.ap.channel = 1;
    ap_cfg.ap.max_connection = 2;
    ap_cfg.ap.authmode = WIFI_AUTH_WPA2_PSK;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_AP));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_AP, &ap_cfg));
    ESP_ERROR_CHECK(esp_wifi_start());

    httpd_config_t server_cfg = HTTPD_DEFAULT_CONFIG();
    server_cfg.max_uri_handlers = 4;
    httpd_handle_t server = NULL;
    ESP_ERROR_CHECK(httpd_start(&server, &server_cfg));
    httpd_uri_t root_uri = {.uri = "/", .method = HTTP_GET, .handler = setup_root_handler, .user_ctx = NULL};
    httpd_uri_t save_uri = {.uri = "/save", .method = HTTP_POST, .handler = setup_save_handler, .user_ctx = NULL};
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &root_uri));
    ESP_ERROR_CHECK(httpd_register_uri_handler(server, &save_uri));
    ESP_LOGW(TAG, "No saved Wi-Fi configuration. Connect to AP '%s' (password: %s), then open http://192.168.4.1", SETUP_AP_SSID, SETUP_AP_PASSWORD);
}

static void event_handler(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry_count++ < MAX_RETRIES) {
            ESP_LOGW(TAG, "Wi-Fi disconnected; retry %d/%d", s_retry_count, MAX_RETRIES);
            esp_wifi_connect();
        } else {
            xEventGroupSetBits(s_wifi_events, WIFI_FAIL_BIT);
        }
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)data;
        ESP_LOGI(TAG, "Connected; device IP=" IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_count = 0;
        xEventGroupSetBits(s_wifi_events, WIFI_CONNECTED_BIT);
        ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
        athena_csi_start(s_pc_ip, s_pc_port);
    }
}

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    wifi_init_config_t wifi_cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&wifi_cfg));

    if (!load_settings()) {
        start_setup_ap();
        return;
    }

    ESP_LOGI(TAG, "Loaded Wi-Fi settings for SSID '%s'; CSI destination %s:%u", s_ssid, s_pc_ip, (unsigned)s_pc_port);
    esp_netif_create_default_wifi_sta();
    s_wifi_events = xEventGroupCreate();
    ESP_ERROR_CHECK(s_wifi_events ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &event_handler, NULL));

    wifi_config_t wifi_config = {0};
    strlcpy((char *)wifi_config.sta.ssid, s_ssid, sizeof(wifi_config.sta.ssid));
    strlcpy((char *)wifi_config.sta.password, s_password, sizeof(wifi_config.sta.password));
    wifi_config.sta.threshold.authmode = WIFI_AUTH_OPEN;
    wifi_config.sta.pmf_cfg.capable = true;
    wifi_config.sta.pmf_cfg.required = false;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    EventBits_t bits = xEventGroupWaitBits(s_wifi_events,
        WIFI_CONNECTED_BIT | WIFI_FAIL_BIT, pdFALSE, pdFALSE, portMAX_DELAY);
    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "CSI stream initialized. If frames are slow, run 'ping -t <device IP>' from the PC.");
    } else {
        ESP_LOGE(TAG, "Could not join Wi-Fi after retries. Clearing saved network settings and reopening setup AP.");
        (void)esp_wifi_stop();
        nvs_handle_t nvs;
        if (nvs_open(SETTINGS_NS, NVS_READWRITE, &nvs) == ESP_OK) {
            (void)nvs_erase_key(nvs, "ssid");
            (void)nvs_erase_key(nvs, "password");
            (void)nvs_erase_key(nvs, "pc_ip");
            (void)nvs_erase_key(nvs, "port");
            (void)nvs_commit(nvs);
            nvs_close(nvs);
        }
        start_setup_ap();
    }
}
