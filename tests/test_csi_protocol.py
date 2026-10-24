"""Small no-hardware smoke tests for the ATHENA custom UDP frame."""
import struct
import unittest
from backend.app import HEADER, SUPPORTED_ACTIVITY_LABELS, handle_packet, resample_magnitudes, state


class CSIProtocolTests(unittest.TestCase):
    def test_recording_labels_match_seven_class_model(self):
        self.assertEqual(SUPPORTED_ACTIVITY_LABELS, {"arm_wave", "fall", "jumping", "running", "squatting", "turning", "walking"})

    def test_header_is_18_bytes(self):
        self.assertEqual(HEADER.size, 18)

    def test_fixed_feature_vector_and_first_word_flag(self):
        raw = bytes([1, 2, 3, 4] + [i % 128 for i in range(128)])
        features = resample_magnitudes(raw, flags=0)
        self.assertEqual(len(features), 64)
        trimmed = resample_magnitudes(raw, flags=1)
        self.assertEqual(len(trimmed), 64)
        self.assertTrue(all(x >= 0 for x in features))

    def test_packet_updates_live_state(self):
        csi = bytes([10, 20, 30, 40] * 32)
        frame = HEADER.pack(b"ATCS", 1, 6, -47, 0, 77, 123456, len(csi)) + csi
        before = state["frames_total"]
        handle_packet(frame)
        self.assertEqual(state["frames_total"], before + 1)
        self.assertEqual(state["sequence"], 77)
        self.assertEqual(state["rssi_dbm"], -47)
        self.assertEqual(len(state["features"]), 64)

    def test_invalid_magic_ignored(self):
        csi = bytes([1, 2] * 32)
        frame = HEADER.pack(b"NOPE", 1, 6, -48, 0, 1, 2, len(csi)) + csi
        before = state["frames_total"]
        handle_packet(frame)
        self.assertEqual(state["frames_total"], before)


if __name__ == "__main__":
    unittest.main()
