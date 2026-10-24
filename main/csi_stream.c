#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_wifi.h"
#include "lwip/inet.h"
#include "csi_stream.h"

#define CSI_MAX_LEN 612
#define CSI_QUEUE_DEPTH 12
#define HEADER_LEN 18
#define CSI_VERSION 1

typedef struct {
    uint32_t seq;
    uint32_t ts_us;
    uint16_t len;
    int8_t rssi;
    uint8_t channel;
    uint8_t flags;
    uint8_t data[CSI_MAX_LEN];
} csi_record_t;

static const char *TAG = "athena_csi";
static QueueHandle_t s_queue;
static bool s_started;
static uint32_t s_seq;
static uint8_t s_ap_bssid[6];
static int s_sock = -1;
static struct sockaddr_in s_collector;

static void write_le16(uint8_t *p, uint16_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
static void write_le32(uint8_t *p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24); }

static void csi_rx_cb(void *ctx, wifi_csi_info_t *info)
{
    (void)ctx;
    if (!info || !info->buf || info->len == 0 || !s_queue) return;
    if (memcmp(s_ap_bssid, "\0\0\0\0\0\0", 6) != 0 && memcmp(info->mac, s_ap_bssid, 6) != 0) return;
    csi_record_t r = {0};
    r.seq = ++s_seq;
    r.ts_us = info->rx_ctrl.timestamp;
    r.len = info->len > CSI_MAX_LEN ? CSI_MAX_LEN : info->len;
    r.rssi = info->rx_ctrl.rssi;
    r.channel = info->rx_ctrl.channel;
    r.flags = info->first_word_invalid ? 1 : 0;
    memcpy(r.data, info->buf, r.len);
    (void)xQueueSend(s_queue, &r, 0); /* Never block the Wi-Fi task. */
}

static void udp_sender_task(void *arg)
{
    (void)arg;
    csi_record_t r;
    uint8_t packet[HEADER_LEN + CSI_MAX_LEN];
    while (true) {
        if (xQueueReceive(s_queue, &r, portMAX_DELAY) != pdTRUE) continue;
        if (s_sock < 0) continue;
        packet[0] = 'A'; packet[1] = 'T'; packet[2] = 'C'; packet[3] = 'S';
        packet[4] = CSI_VERSION;
        packet[5] = r.channel;
        packet[6] = (uint8_t)r.rssi;
        packet[7] = r.flags;
        write_le32(&packet[8], r.seq);
        write_le32(&packet[12], r.ts_us);
        write_le16(&packet[16], r.len);
        memcpy(&packet[HEADER_LEN], r.data, r.len);
        int sent = sendto(s_sock, packet, HEADER_LEN + r.len, 0,
                          (struct sockaddr *)&s_collector, sizeof(s_collector));
        if (sent < 0) ESP_LOGW(TAG, "UDP send failed; collector IP/firewall may be wrong");
    }
}

void athena_csi_start(const char *collector_ipv4, uint16_t collector_port)
{
    if (s_started) return;
    s_started = true;
    s_queue = xQueueCreate(CSI_QUEUE_DEPTH, sizeof(csi_record_t));
    ESP_ERROR_CHECK(s_queue ? ESP_OK : ESP_ERR_NO_MEM);
    wifi_ap_record_t ap = {0};
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
        memcpy(s_ap_bssid, ap.bssid, sizeof(s_ap_bssid));
        ESP_LOGI(TAG, "Associated AP channel=%u RSSI=%d dBm", ap.primary, ap.rssi);
    }
    s_sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (s_sock < 0) ESP_LOGE(TAG, "Cannot create UDP socket");
    memset(&s_collector, 0, sizeof(s_collector));
    s_collector.sin_family = AF_INET;
    s_collector.sin_port = htons(collector_port);
    s_collector.sin_addr.s_addr = inet_addr(collector_ipv4);
    ESP_ERROR_CHECK(xTaskCreate(udp_sender_task, "athena_udp", 4096, NULL, 5, NULL) == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);

    wifi_csi_config_t csi_cfg = {
        .lltf_en = true,
        .htltf_en = true,
        .stbc_htltf2_en = true,
        .ltf_merge_en = false,
        .channel_filter_en = false,
        .manu_scale = false,
        .shift = 0,
        .dump_ack_en = false,
    };
    /* ESP-IDF's CSI examples enable promiscuous reception before CSI configuration. */
    ESP_ERROR_CHECK(esp_wifi_set_promiscuous(true));
    ESP_ERROR_CHECK(esp_wifi_set_csi_config(&csi_cfg));
    ESP_ERROR_CHECK(esp_wifi_set_csi_rx_cb(csi_rx_cb, NULL));
    ESP_ERROR_CHECK(esp_wifi_set_csi(true));
    ESP_LOGI(TAG, "CSI enabled; UDP stream -> %s:%u", collector_ipv4, (unsigned)collector_port);
}
