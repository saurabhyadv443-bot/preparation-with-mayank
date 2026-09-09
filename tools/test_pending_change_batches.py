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

    def compact(self):
        latest_changes = {}
        for change in self.changes:
            latest_changes[change["operationKey"]] = change
        self.changes = list(latest_changes.values())
        latest = {change["operationKey"]: change["pendingChangeId"] for change in self.changes}
        for batch in self.batches:
            if batch["status"] == "synced":
                continue
            batch["changes"] = [
                change for change in batch["changes"]
                if latest.get(change["operationKey"]) == change["pendingChangeId"]
            ]
        self.batches = [batch for batch in self.batches if batch["status"] == "synced" or batch["changes"]]

    def migrate(self, legacy_state, indexed_state=None, fail=False):
        if fail:
            raise RuntimeError("storage failure")
        state = indexed_state or legacy_state
        known = {change["operationKey"] for change in state["changes"]}
        for batch in state["batches"]:
            if batch["status"] == "synced":
                continue
            for change in batch["changes"]:
                if change["operationKey"] not in known:
                    state["changes"].append(dict(change))
                    known.add(change["operationKey"])
        self.changes = state["changes"]
        self.batches = state["batches"]
        self.compact()
        return self

    def export_after_migration(self):
        return [dict(change) for change in self.changes if "downloadedBatchId" not in change]

    @staticmethod
    def merge_changes(primary, secondary):
        merged = {}
        for change in [*primary, *secondary]:
            key = change["operationKey"]
            current = merged.get(key)
            if current is None or (change.get("timestamp", ""), change.get("pendingChangeId", "")) >= (current.get("timestamp", ""), current.get("pendingChangeId", "")):
                merged[key] = dict(change)
        return list(merged.values())


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
            'const QUIZ_PENDING_DB_NAME = "bpscQuizPendingChanges"',
            "function quizPendingInitializeStorage()",
            "function quizPendingRemoveLegacyStorage(state)",
            "function quizPendingRestoreLegacyStorage(state)",
            "function quizPendingChangeRecency(change)",
            "function quizPendingIsNewerChange(candidate, current)",
            "function quizPendingMergeAndWriteDatabase(database, state)",
            "window.indexedDB",
            "function exportQuizPendingBatch(batchId)",
            "function markQuizPendingBatchSynced(batchId)",
            "function quizPendingPruneCompletedBatches(state)",
        ):
            self.assertIn(required, source)
        self.assertNotIn("tools/sync_quiz_changes.py", source)

    def test_merge_prefers_newer_legacy_operation_over_older_indexeddb_operation(self):
        old = {
            "operationKey": "edit-question::answer::::A::1",
            "pendingChangeId": "change-8",
            "timestamp": "2026-09-09T10:00:00.000Z",
            "value": 1,
        }
        new = {**old, "pendingChangeId": "change-9", "timestamp": "2026-09-09T11:00:00.000Z", "value": 2}
        merged = PendingBatchLedger.merge_changes([old], [new])
        self.assertEqual(merged[0]["value"], 2)

    def test_merge_prefers_newer_pending_change_id_when_timestamps_match(self):
        old = {"operationKey": "classification::H::::A::1", "pendingChangeId": "change-8", "value": False}
        new = {**old, "pendingChangeId": "change-9", "value": True}
        merged = PendingBatchLedger.merge_changes([old], [new])
        self.assertTrue(merged[0]["value"])

    def test_concurrent_migrations_merge_different_pending_operations(self):
        operation_a = {"operationKey": "classification::H::::A::1", "pendingChangeId": "change-8", "timestamp": "2026-09-09T10:00:00.000Z", "value": True}
        operation_b = {"operationKey": "classification::G::::A::2", "pendingChangeId": "change-9", "timestamp": "2026-09-09T10:01:00.000Z", "value": True}
        first_commit = PendingBatchLedger.merge_changes([], [operation_a])
        second_commit = PendingBatchLedger.merge_changes(first_commit, [operation_b])
        self.assertEqual({change["operationKey"] for change in second_commit}, {operation_a["operationKey"], operation_b["operationKey"]})

    def test_newer_indexeddb_operation_survives_older_second_migration(self):
        newer = {"operationKey": "edit-question::answer::::A::1", "pendingChangeId": "change-12", "timestamp": "2026-09-09T10:02:00.000Z", "value": 2}
        older = {**newer, "pendingChangeId": "change-11", "timestamp": "2026-09-09T10:01:00.000Z", "value": 1}
        final_state = PendingBatchLedger.merge_changes([newer], [older])
        self.assertEqual(final_state[0]["value"], 2)

    def test_older_migration_snapshot_cannot_replace_newer_state(self):
        newer = {"operationKey": "saved-question::S::::A::1", "pendingChangeId": "change-20", "timestamp": "2026-09-09T10:02:00.000Z", "value": True}
        older = {**newer, "pendingChangeId": "change-19", "timestamp": "2026-09-09T10:01:00.000Z", "value": False}
        final_state = PendingBatchLedger.merge_changes([newer], [older])
        self.assertEqual(final_state[0]["pendingChangeId"], "change-20")

    def test_fallback_partial_write_rolls_back_without_losing_cache(self):
        previous = {"quizPendingChangeBatches": "old-batches", "quizPendingChanges": "old-changes"}
        attempted = {"quizPendingChangeBatches": "new-batches", "quizPendingChanges": "new-changes"}
        restored = dict(previous)
        try:
            restored["quizPendingChangeBatches"] = attempted["quizPendingChangeBatches"]
            raise OSError("quota")
        except OSError:
            restored = dict(previous)
        self.assertEqual(restored, previous)
        self.assertEqual(attempted["quizPendingChanges"], "new-changes")

    def test_duplicate_top_level_operations_compact_to_latest_value(self):
        ledger = PendingBatchLedger()
        first = {"operationType": "edit-question", "field": "answer", "chapter": "A", "questionIndex": 1, "value": 1, "pendingChangeId": "old", "operationKey": "edit-question::answer::::A::1"}
        latest = {**first, "value": 2, "pendingChangeId": "latest"}
        ledger.migrate({"changes": [first, latest], "batches": []})
        self.assertEqual(len(ledger.changes), 1)
        self.assertEqual(ledger.changes[0]["value"], 2)

    def test_migration_recovers_operation_only_present_in_unsynced_batch(self):
        ledger = PendingBatchLedger()
        ledger.queue({"operationType": "classification", "tag": "H", "chapter": "A", "questionIndex": 1})
        ledger.download_current()
        legacy_state = {"changes": [], "batches": ledger.batches}
        ledger.migrate(legacy_state)
        self.assertEqual(len(ledger.changes), 1)
        self.assertEqual(ledger.changes[0]["tag"], "H")

    def test_migration_compacts_superseded_unsynced_snapshots(self):
        ledger = PendingBatchLedger()
        ledger.queue({"operationType": "edit-question", "field": "answer", "chapter": "A", "questionIndex": 1, "value": 1})
        first = ledger.download_current()
        ledger.queue({"operationType": "edit-question", "field": "answer", "chapter": "A", "questionIndex": 1, "value": 2})
        ledger.download_current()
        ledger.migrate({"changes": ledger.changes, "batches": ledger.batches})
        self.assertEqual(len(ledger.batches), 1)
        self.assertEqual(ledger.batches[0]["changes"][0]["value"], 2)
        self.assertEqual(first[0]["value"], 1)

    def test_export_after_migration_keeps_pending_operations(self):
        ledger = PendingBatchLedger()
        ledger.queue({"operationType": "saved-question", "tag": "S", "chapter": "A", "questionIndex": 1})
        ledger.migrate({"changes": ledger.changes, "batches": []})
        exported = ledger.export_after_migration()
        self.assertEqual(len(exported), 1)
        self.assertEqual(exported[0]["operationType"], "saved-question")

    def test_migration_failure_preserves_legacy_state(self):
        legacy_state = {"changes": [{"operationType": "classification", "tag": "G"}], "batches": []}
        original = json.loads(json.dumps(legacy_state))
        with self.assertRaises(RuntimeError):
            PendingBatchLedger().migrate(legacy_state, fail=True)
        self.assertEqual(legacy_state, original)

    def test_storage_failure_does_not_replace_cached_pending_changes(self):
        ledger = PendingBatchLedger()
        ledger.queue({"operationType": "edit-question", "field": "explanation", "chapter": "A", "questionIndex": 1, "value": "latest"})
        cached = json.loads(json.dumps(ledger.changes))
        with self.assertRaises(RuntimeError):
            ledger.migrate({"changes": cached, "batches": []}, fail=True)
        self.assertEqual(ledger.changes, cached)


if __name__ == "__main__":
    unittest.main()
