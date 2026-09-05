import json
import unittest
from pathlib import Path


APP_JS = Path(__file__).parents[1] / "assets" / "js" / "app.js"


class PendingBatchLedger:
    """Small executable specification for the browser batch invariants."""

    def __init__(self, legacy=None):
        self.next_batch_id = 1
        self.next_change_id = 1
        self.changes = []
        self.batches = []
        for change in legacy or []:
            self.queue(change)

    def queue(self, change):
        item = dict(change)
        operation_key = "::".join(str(item.get(key, "")) for key in ("operationType", "field", "tag", "sourceSubjectKey", "chapter", "questionIndex"))
        existing = next((entry for entry in self.changes if entry.get("operationKey") == operation_key), None)
        item["operationKey"] = operation_key
        item["pendingChangeId"] = existing["pendingChangeId"] if existing and "downloadedBatchId" not in existing else f"change-{self.next_change_id}"
        if item["pendingChangeId"] == f"change-{self.next_change_id}":
            self.next_change_id += 1
        item.pop("downloadedBatchId", None)
        if existing:
            self.changes[self.changes.index(existing)] = item
        else:
            self.changes.append(item)

    def download_current(self):
        current = [change for change in self.changes if "downloadedBatchId" not in change]
        if not current:
            return []
        batch_id = self.next_batch_id
        self.next_batch_id += 1
        snapshot = [dict(change) for change in current]
        for change in current:
            change["downloadedBatchId"] = batch_id
        self.batches.append({"batchId": batch_id, "status": "downloaded", "changes": snapshot})
        return snapshot

    def sync(self, batch_id):
        batch = next(batch for batch in self.batches if batch["batchId"] == batch_id)
        batch["status"] = "synced"
        ids = {change["pendingChangeId"] for change in batch["changes"]}
        self.changes = [change for change in self.changes if change["pendingChangeId"] not in ids]
        completed = [batch for batch in self.batches if batch["status"] == "synced"]
        retained = {batch["batchId"] for batch in completed[-5:]}
        self.batches = [batch for batch in self.batches if batch["status"] != "synced" or batch["batchId"] in retained]


class PendingChangeBatchTest(unittest.TestCase):
    def test_legacy_array_migrates_without_losing_data(self):
        legacy = [{"operationType": "edit-question", "field": "explanation", "questionIndex": 1}]
        ledger = PendingBatchLedger(legacy)
        self.assertEqual(ledger.changes[0]["operationType"], "edit-question")
        self.assertIn("pendingChangeId", ledger.changes[0])

    def test_one_download_is_one_batch_and_next_download_is_delta(self):
        ledger = PendingBatchLedger()
        for index in range(100):
            ledger.queue({"operationType": "classification", "tag": "H", "chapter": f"A{index}", "questionIndex": index})
        first = ledger.download_current()
        for index in range(20):
            ledger.queue({"operationType": "classification", "tag": "G", "chapter": f"B{index}", "questionIndex": index})
        second = ledger.download_current()
        self.assertEqual(len(first), 100)
        self.assertEqual(len(second), 20)
        self.assertTrue(all(change["tag"] == "G" for change in second))
        self.assertEqual(len(ledger.batches), 2)
        self.assertEqual(len(ledger.changes), 120)

    def test_sync_is_separate_and_removes_only_synced_changes(self):
        ledger = PendingBatchLedger()
        ledger.queue({"operationType": "saved-question", "tag": "S", "questionIndex": 1})
        first = ledger.download_current()
        ledger.queue({"operationType": "classification", "tag": "CA", "questionIndex": 2, "active": False})
        second = ledger.download_current()
        self.assertEqual(ledger.batches[0]["status"], "downloaded")
        ledger.sync(1)
        self.assertEqual(ledger.batches[0]["status"], "synced")
        self.assertEqual(ledger.batches[1]["status"], "downloaded")
        self.assertEqual(ledger.batches[0]["changes"], first)
        self.assertEqual(ledger.batches[1]["changes"], second)
        self.assertEqual(len(ledger.changes), 1)

    def test_only_five_synced_batches_are_pruned_and_unsynced_survives(self):
        ledger = PendingBatchLedger()
        for index in range(6):
            ledger.queue({"operationType": "edit-question", "field": "answer", "questionIndex": index})
            ledger.download_current()
            ledger.sync(index + 1)
        self.assertEqual(len([batch for batch in ledger.batches if batch["status"] == "synced"]), 5)
        ledger.queue({"operationType": "classification", "tag": "P", "questionIndex": 99})
        ledger.download_current()
        unsynced_id = ledger.batches[-1]["batchId"]
        for index in range(6, 7):
            ledger.queue({"operationType": "edit-question", "field": "answer", "questionIndex": index})
            ledger.download_current()
            ledger.sync(ledger.batches[-1]["batchId"])
        unsynced = next(batch for batch in ledger.batches if batch["batchId"] == unsynced_id)
        self.assertEqual(unsynced["status"], "downloaded")
        self.assertEqual(len([batch for batch in ledger.batches if batch["status"] == "synced"]), 5)

    def test_source_contains_versioned_storage_and_historical_apis(self):
        source = APP_JS.read_text(encoding="utf-8")
        for required in (
            'const QUIZ_PENDING_BATCHES_KEY = "quizPendingChangeBatches"',
            "function exportQuizPendingBatch(batchId)",
            "function markQuizPendingBatchSynced(batchId)",
            "function quizPendingPruneCompletedBatches(state)",
        ):
            self.assertIn(required, source)
        self.assertNotIn("tools/sync_quiz_changes.py", source)


if __name__ == "__main__":
    unittest.main()
