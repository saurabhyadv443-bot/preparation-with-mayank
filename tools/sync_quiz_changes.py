"""Apply exported quizPendingChanges to copies of the original quiz JSON files."""

import argparse
import hashlib
import json
import shutil
import sys
from datetime import datetime
from pathlib import Path


SUBJECT_FILES = {
    "ancient": "ancient.json",
    "medieval": "medeival.json",
    "modern": "modern.json",
    "geography": "geography.json",
    "polity": "polity.json",
    "economy": "economy.json",
    "mock": "mock.json",
    "current_affairs": "current_affairs.json",
}
EDITABLE_FIELDS = {"explanation", "answer"}
CLASSIFICATION_OPERATIONS = {"saved-question", "classification"}


def question_text(question):
    return str(question.get("q", question.get("question", question.get("questionText", question.get("prompt", "")))))


def fingerprint(text):
    normalized = " ".join(str(text or "").strip().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest(), normalized[:240]


def question_id(question):
    for key in ("id", "qid", "questionId", "_id", "questionID", "question_id"):
        if question.get(key) is not None:
            return str(question[key])
    return None


def questions_for_chapter(data, chapter):
    for container_name in ("chapters", "TEST NUMBER"):
        groups = data.get(container_name) if isinstance(data, dict) else None
        if isinstance(groups, dict) and isinstance(groups.get(chapter), list):
            return groups[chapter]
    return None


def resolve_question(data, change):
    chapter = change.get("chapter")
    questions = questions_for_chapter(data, chapter)
    if questions is None:
        raise ValueError(f"chapter/set not found: {chapter!r}")
    index = change.get("questionIndex")
    if not isinstance(index, int) or not 0 <= index < len(questions):
        raise ValueError(f"question index not found: {index!r}")
    question = questions[index]
    expected_id = change.get("questionId")
    actual_id = question_id(question)
    if expected_id is not None and actual_id is not None and actual_id != str(expected_id):
        raise ValueError("question ID conflict")
    expected = change.get("questionFingerprint") or {}
    if expected.get("value"):
        actual_value, actual_snapshot = fingerprint(question_text(question))
        if expected.get("algorithm") == "sha256" and actual_value != expected["value"]:
            raise ValueError("question text fingerprint conflict")
        if expected.get("algorithm") == "fnv1a32":
            # Browser fingerprints are checked by their short text snapshot.
            if expected.get("snapshot", "") != actual_snapshot:
                raise ValueError("question text snapshot conflict")
    return question


def source_path(data_dir, change):
    subject = str(change.get("sourceSubjectKey") or "")
    expected_file = SUBJECT_FILES.get(subject)
    if not expected_file or change.get("sourceJsonFile") != expected_file:
        raise ValueError("source subject/file mapping conflict")
    path = (data_dir / expected_file).resolve()
    if path.parent != data_dir.resolve() or not path.is_file():
        raise ValueError("source JSON file is unavailable")
    return path


def operation_key(change):
    return "::".join(str(change.get(key, "")) for key in ("operationType", "field", "tag", "sourceSubjectKey", "chapter", "questionIndex"))


def load_changes(path):
    payload = json.loads(path.read_text(encoding="utf-8-sig"))
    changes = payload.get("changes") if isinstance(payload, dict) else payload
    if isinstance(payload, dict) and isinstance(payload.get("operationType"), str):
        changes = [payload]
    if not isinstance(changes, list):
        raise ValueError("pending changes must be a JSON array")
    retained = {}
    for change in changes:
        if isinstance(change, dict):
            retained[operation_key(change)] = change
    return list(retained.values())


def backup_paths(paths, backup_root):
    backup_root.mkdir(parents=True, exist_ok=False)
    for path in paths:
        shutil.copy2(path, backup_root / path.name)


def apply_change(data_dir, change, data=None):
    path = source_path(data_dir, change)
    if data is None:
        data = json.loads(path.read_text(encoding="utf-8"))
    question = resolve_question(data, change)
    kind = change.get("operationType")
    if kind == "edit-question":
        field = change.get("field")
        if field not in EDITABLE_FIELDS:
            raise ValueError("unsupported editable field")
        if field == "answer" and (not isinstance(change.get("value"), int) or not 0 <= change["value"] < len(question.get("options", []))):
            raise ValueError("answer is not a valid option index")
        question[field] = change.get("value")
    elif kind in CLASSIFICATION_OPERATIONS:
        tag = change.get("tag") or "S"
        if kind == "classification" and tag not in {"H", "G", "P", "E", "CA"}:
            raise ValueError(f"unsupported classification tag: {tag}")
        meta = question.get("quizMeta")
        if not isinstance(meta, dict):
            meta = {}
            question["quizMeta"] = meta
        if kind == "saved-question":
            if change.get("active", True):
                meta["saved"] = True
            else:
                meta.pop("saved", None)
        else:
            classifications = meta.get("classifications")
            if not isinstance(classifications, dict):
                classifications = {}
                meta["classifications"] = classifications
            if change.get("active", True):
                classifications[tag] = True
            else:
                classifications.pop(tag, None)
            if not classifications:
                meta.pop("classifications", None)
        if not meta:
            question.pop("quizMeta", None)
    else:
        raise ValueError("unsupported operation type")
    return path, data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("legacy_changes", nargs="?", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--changes", type=Path, default=Path("quiz_pending_changes.json"), help="exported quiz_pending_changes.json")
    parser.add_argument("--data-dir", type=Path, default=Path("data"), help="directory containing original source JSON files")
    parser.add_argument("--backup-dir", type=Path, help="backup destination; defaults to a timestamped directory")
    parser.add_argument("--dry-run", action="store_true", help="validate and report without writing source JSON")
    args = parser.parse_args()
    data_dir = args.data_dir.resolve()
    changes_path = args.changes if args.changes != Path("quiz_pending_changes.json") or args.legacy_changes is None else args.legacy_changes
    changes = load_changes(changes_path.resolve())
    results = []
    updates = {}
    for number, change in enumerate(changes, 1):
        try:
            path = source_path(data_dir, change)
            data = updates.get(path)
            path, data = apply_change(data_dir, change, data)
            updates[path] = data
            results.append((number, "APPLIED", change, "validated"))
        except (OSError, json.JSONDecodeError, ValueError) as error:
            results.append((number, "SKIPPED/CONFLICT", change, str(error)))
    if updates and not args.dry_run:
        backup_dir = args.backup_dir or data_dir.parent / f"quiz-sync-backup-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}"
        backup_paths(list(updates), backup_dir)
        for path, data in updates.items():
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            temporary.replace(path)
        print(f"Backup: {backup_dir}")
    elif updates:
        print("Dry run: no source JSON files written.")
    for number, status, change, detail in results:
        print(f"{number}: {status}: {change.get('operationType')} {change.get('sourceSubjectKey')}::{change.get('chapter')}::{change.get('questionIndex')} - {detail}")
    return 0 if not any(status == "SKIPPED/CONFLICT" for _, status, _, _ in results) else 2


if __name__ == "__main__":
    sys.exit(main())