import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SYNC_TOOL = Path(__file__).with_name("sync_quiz_changes.py")
TAGS = {
    "H": "modern.json",
    "G": "geography.json",
    "P": "polity.json",
    "E": "economy.json",
    "CA": "current_affairs.json",
}


class SyncQuizChangesTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name) / "data"
        self.data_dir.mkdir()
        source_question = {
            "q": "Temporary source question",
            "options": ["A", "B", "C"],
            "answer": 1,
            "explanation": "Original explanation",
        }
        self._write("mock.json", {
            "subject": "Mock Test",
            "quizType": "practice",
            "TEST NUMBER": {"Set 1": [source_question]},
        })
        for tag, filename in TAGS.items():
            if tag == "CA":
                self._write(filename, {"questions": [{"question": {"q": "Unrelated CA question"}}]})
            else:
                self._write(filename, {
                    "subject": filename[:-5],
                    "quizType": "practice",
                    "chapters": {"Existing": [{"q": "Unrelated destination question"}]},
                })

    def tearDown(self):
        self.temp_dir.cleanup()

    def _write(self, filename, value):
        (self.data_dir / filename).write_text(json.dumps(value), encoding="utf-8")

    def _read(self, filename):
        return json.loads((self.data_dir / filename).read_text(encoding="utf-8"))

    def _run(self, changes):
        changes_path = Path(self.temp_dir.name) / "quiz_pending_changes.json"
        changes_path.write_text(json.dumps(changes), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(SYNC_TOOL), "--changes", str(changes_path), "--data-dir", str(self.data_dir)],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def _change(self, operation_type, **values):
        return {
            "operationType": operation_type,
            "sourceSubjectKey": "mock",
            "sourceJsonFile": "mock.json",
            "chapter": "Set 1",
            "questionIndex": 0,
            "questionId": None,
            "questionFingerprint": {"algorithm": "sha256", "value": ""},
            **values,
        }

    def _destination_questions(self, tag):
        data = self._read(TAGS[tag])
        if tag == "CA":
            return [entry["question"] for entry in data["questions"] if "question" in entry and entry["question"].get("_source")]
        return [question for question in data["chapters"].get("Important Questions", []) if question.get("_source")]

    def test_classification_sync_and_edit_sync(self):
        activate = [self._change("classification", tag=tag, active=True) for tag in TAGS]
        self._run(activate)

        source = self._read("mock.json")["TEST NUMBER"]["Set 1"][0]
        self.assertEqual(set(source["quizMeta"]["classifications"]), set(TAGS))
        for tag in TAGS:
            copies = self._destination_questions(tag)
            self.assertEqual(len(copies), 1)
            self.assertEqual(copies[0]["q"], "Temporary source question")

        self._run(activate)
        for tag in TAGS:
            self.assertEqual(len(self._destination_questions(tag)), 1)

        self._run([
            self._change("edit-question", field="answer", value=2),
            self._change("edit-question", field="explanation", value="Updated explanation"),
        ])
        for tag in TAGS:
            copy = self._destination_questions(tag)[0]
            self.assertEqual(copy["answer"], 2)
            self.assertEqual(copy["explanation"], "Updated explanation")

        self._run([self._change("classification", tag="G", active=False)])
        source = self._read("mock.json")["TEST NUMBER"]["Set 1"][0]
        self.assertNotIn("G", source["quizMeta"]["classifications"])
        self.assertEqual(len(self._destination_questions("G")), 0)
        for tag in ("H", "P", "E", "CA"):
            self.assertEqual(len(self._destination_questions(tag)), 1)
        self.assertEqual(self._read("modern.json")["chapters"]["Existing"][0]["q"], "Unrelated destination question")
        self.assertEqual(self._read("current_affairs.json")["questions"][0]["question"]["q"], "Unrelated CA question")
        self.assertEqual(source["q"], "Temporary source question")
        self.assertEqual(source["answer"], 2)
        self.assertEqual(source["explanation"], "Updated explanation")


if __name__ == "__main__":
    unittest.main()
