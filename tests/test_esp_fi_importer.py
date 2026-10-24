import json
import tempfile
import unittest
from pathlib import Path

import numpy as np
from scipy.io import savemat

from ml.import_esp_fi_har import convert, label_for_path, locate_sample_matrix, resample_subcarriers


class ESPFiImporterTests(unittest.TestCase):
    def test_filename_activity_mapping(self):
        activity_id, session = label_for_path(Path('2-5-3-7.mat'))
        self.assertEqual(activity_id, 3)
        self.assertEqual(session, 'scene2_person5_trial7')

    def test_matrix_resamples_subcarriers(self):
        matrix = np.arange(950 * 52, dtype=np.float32).reshape(950, 52)
        result = resample_subcarriers(matrix)
        self.assertEqual(result.shape, (950, 64))
        self.assertTrue(np.isfinite(result).all())

    def test_mat_conversion_creates_labeled_jsonl(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            source = base / 'input'
            output = base / 'output'
            source.mkdir()
            sample = np.random.default_rng(7).uniform(0, 5, size=(1, 950, 52)).astype(np.float32)
            savemat(source / '2-5-3-7.mat', {'csi': sample})
            parsed = locate_sample_matrix(source / '2-5-3-7.mat')
            self.assertEqual(parsed.shape, (950, 52))
            converted, skipped = convert(source, output)
            self.assertEqual((converted, skipped), (1, 0))
            target = next(output.glob('*.jsonl'))
            rows = [json.loads(line) for line in target.read_text(encoding='utf-8').splitlines()]
            self.assertEqual(len(rows), 950)
            self.assertEqual(rows[0]['label'], 'walking')
            self.assertEqual(len(rows[0]['features']), 64)


if __name__ == '__main__':
    unittest.main()
