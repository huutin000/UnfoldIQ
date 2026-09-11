"""
Unit and Integration Tests for UnfoldIQ Phase 3 Pronunciation Dictionary Subsystem.
"""

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

from studio.pronunciation_service import PronunciationDictionary, PronunciationEntry


class TestPronunciationDictionary(unittest.TestCase):
    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="unfoldiq_test_pron_"))
        self.dict_path = self.test_dir / "pronunciation_dictionary.json"
        self.dict = PronunciationDictionary(self.dict_path)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_01_add_entry(self):
        entry = self.dict.add_entry("Olduvai Gorge", "Oldu-vye Gorge", enabled=True)
        self.assertIsNotNone(entry.id)
        self.assertEqual(entry.original, "Olduvai Gorge")
        self.assertEqual(entry.spoken_form, "Oldu-vye Gorge")
        self.assertTrue(entry.enabled)
        self.assertEqual(len(self.dict.entries), 1)

    def test_02_edit_entry(self):
        entry = self.dict.add_entry("Homo habilis", "Homo ha-bih-lis")
        updated = self.dict.update_entry(entry.id, spoken_form="Homo hab-ih-lis")
        self.assertEqual(updated.spoken_form, "Homo hab-ih-lis")
        self.assertEqual(self.dict.get_entry(entry.id).spoken_form, "Homo hab-ih-lis")

    def test_03_delete_entry(self):
        entry = self.dict.add_entry("Agta", "Ag-tah")
        self.assertEqual(len(self.dict.entries), 1)
        deleted = self.dict.delete_entry(entry.id)
        self.assertTrue(deleted)
        self.assertEqual(len(self.dict.entries), 0)

    def test_04_enable_disable_toggle(self):
        entry = self.dict.add_entry("Mbendjele BaYaka", "Ben-jeh-lay Ba-Yaka", enabled=True)
        self.assertTrue(entry.enabled)
        self.dict.update_entry(entry.id, enabled=False)
        self.assertFalse(self.dict.get_entry(entry.id).enabled)

    def test_05_persistence_after_reload(self):
        self.dict.add_entry("Barnham", "Barn-um", enabled=True)
        # Re-instantiate from disk
        reloaded = PronunciationDictionary(self.dict_path)
        self.assertEqual(len(reloaded.entries), 1)
        self.assertEqual(reloaded.entries[0].original, "Barnham")
        self.assertEqual(reloaded.entries[0].spoken_form, "Barn-um")

    def test_06_atomic_write_behavior(self):
        self.dict.add_entry("Test Phrase", "Test Spoken")
        self.assertTrue(self.dict_path.exists())
        # Verify valid JSON
        with open(self.dict_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.assertEqual(data["version"], 1)
        self.assertEqual(len(data["entries"]), 1)
        # Check no temporary files left behind
        tmp_files = list(self.test_dir.glob("pron_dict_tmp_*"))
        self.assertEqual(len(tmp_files), 0)

    def test_07_duplicate_rejection(self):
        self.dict.add_entry("Homo habilis", "Homo ha-bih-lis")
        # Exact duplicate
        with self.assertRaises(ValueError):
            self.dict.add_entry("Homo habilis", "Homo different")
        # Case-insensitive duplicate
        with self.assertRaises(ValueError):
            self.dict.add_entry("homo HABILIS", "Homo different")

    def test_08_longest_match_first_overlap(self):
        # Shorter phrase and longer phrase containing the shorter
        self.dict.add_entry("Homo", "Ho-mo")
        self.dict.add_entry("Homo habilis", "Handy Man")

        text = "Fossils of Homo habilis and Homo erectus were discovered."
        transformed, applied = self.dict.preprocess(text)

        # "Homo habilis" must be matched as a unit first, then bare "Homo"
        self.assertIn("Handy Man", transformed)
        self.assertIn("Ho-mo erectus", transformed)
        self.assertNotIn("Ho-mo habilis", transformed)
        self.assertEqual(len(applied), 2)
        # Verify first applied was the longer entry
        self.assertEqual(applied[0]["original"], "Homo habilis")
        self.assertEqual(applied[1]["original"], "Homo")

    def test_09_no_replacement_inside_larger_alphanumeric_word(self):
        self.dict.add_entry("cat", "feline")
        text = "The cat looked at the catalog in the bobcat sanctuary."
        transformed, applied = self.dict.preprocess(text)

        self.assertEqual(transformed, "The feline looked at the catalog in the bobcat sanctuary.")
        self.assertEqual(applied[0]["match_count"], 1)

    def test_10_multiple_occurrences(self):
        self.dict.add_entry("Neanderthal", "Ne-an-der-tal")
        text = "Neanderthal tool use was advanced. Another Neanderthal site confirms this."
        transformed, applied = self.dict.preprocess(text)

        self.assertEqual(transformed, "Ne-an-der-tal tool use was advanced. Another Ne-an-der-tal site confirms this.")
        self.assertEqual(applied[0]["match_count"], 2)

    def test_11_disabled_entry_is_not_applied(self):
        self.dict.add_entry("Olduvai", "Oldu-vye", enabled=False)
        text = "Excavations at Olduvai continue."
        transformed, applied = self.dict.preprocess(text)

        self.assertEqual(transformed, text)
        self.assertEqual(len(applied), 0)

    def test_12_corrupted_file_recovery(self):
        # Write corrupted JSON to disk
        with open(self.dict_path, "w", encoding="utf-8") as f:
            f.write("{ invalid json syntax ... ")

        # Loading must not crash
        recovered = PronunciationDictionary(self.dict_path)
        self.assertEqual(len(recovered.entries), 0)
        # Check that corrupted backup was preserved
        corrupt_backups = list(self.test_dir.glob("*.corrupt.*.json"))
        self.assertGreater(len(corrupt_backups), 0)


if __name__ == "__main__":
    unittest.main()
