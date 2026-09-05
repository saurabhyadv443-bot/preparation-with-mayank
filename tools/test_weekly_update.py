import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SOURCE_TOOL = Path(__file__).with_name("weekly_update.py")


class WeeklyUpdateTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.remote_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        (self.root / "tools").mkdir()
        (self.root / "data").mkdir()
        shutil.copy2(SOURCE_TOOL, self.root / "tools/weekly_update.py")
        self._write("data/mock.json", {"questions": [{"q": "original"}]})
        self._write("data/current_affairs.json", {"questions": []})
        self._write("data/economy.json", {"questions": []})
        self._write("data/geography.json", {"questions": []})
        self._write("data/modern.json", {"questions": []})
        self._write("data/polity.json", {"questions": []})
        self._write_sync_tool()
        self._run_git("init", "-b", "main")
        self._run_git("config", "user.email", "test@example.com")
        self._run_git("config", "user.name", "Weekly Update Test")
        self._run_git("add", ".")
        self._run_git("commit", "-m", "Initial test state")

    def tearDown(self):
        self.remote_dir.cleanup()
        self.temp_dir.cleanup()

    def _write(self, relative_path, value):
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value) + "\n", encoding="utf-8")

    def _write_sync_tool(self):
        (self.root / "tools/sync_quiz_changes.py").write_text(
            """import json
import os
import sys
from pathlib import Path

mode = os.environ.get('WEEKLY_TEST_SYNC_MODE', 'success')
if mode == 'fail':
    sys.exit(2)
if mode == 'noop':
    sys.exit(0)
path = Path('data/mock.json')
data = json.loads(path.read_text(encoding='utf-8'))
data['questions'][0]['q'] = 'updated'
path.write_text(json.dumps(data) + '\\n', encoding='utf-8')
""",
            encoding="utf-8",
        )

    def _run_git(self, *arguments, check=True):
        return subprocess.run(
            ["git", *arguments], cwd=self.root, check=check,
            capture_output=True, text=True,
        )

    def _run_update(self, mode="success"):
        environment = os.environ.copy()
        environment["WEEKLY_TEST_SYNC_MODE"] = mode
        return subprocess.run(
            [sys.executable, "tools/weekly_update.py"],
            cwd=self.root, env=environment, check=False,
            capture_output=True, text=True,
        )

    def test_successful_workflow_commits_and_pushes(self):
        self._write("quiz_pending_changes.json", {"changes": []})
        remote = Path(self.remote_dir.name) / "remote.git"
        subprocess.run(["git", "init", "--bare", str(remote)], check=True, capture_output=True)
        self._run_git("remote", "add", "origin", str(remote))
        result = self._run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Weekly quiz update completed successfully.", result.stdout)
        self.assertFalse((self.root / "quiz_pending_changes.json").exists())
        self.assertEqual(
            self._run_git("rev-parse", "HEAD").stdout,
            self._run_git("rev-parse", "origin/main").stdout,
        )

    def test_sync_failure_prevents_commit_and_push(self):
        self._write("quiz_pending_changes.json", {"changes": []})
        before = self._run_git("rev-parse", "HEAD").stdout
        result = self._run_update("fail")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Synchronization failed", result.stderr)
        self.assertEqual(self._run_git("rev-parse", "HEAD").stdout, before)
        self.assertFalse(self._run_git("rev-parse", "--verify", "origin/main", check=False).returncode == 0)

    def test_unrelated_files_are_not_staged(self):
        self._write("notes.txt", "do not stage\n")
        result = self._run_update()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        status = self._run_git("status", "--short").stdout
        self.assertIn("?? notes.txt", status)
        self.assertNotIn("notes.txt", self._run_git("show", "--format=", "--name-only", "HEAD").stdout)

    def test_no_quiz_changes_does_not_create_empty_commit(self):
        self._write("quiz_pending_changes.json", {"changes": []})
        before = self._run_git("rev-parse", "HEAD").stdout
        result = self._run_update("noop")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("no quiz-data changes", result.stdout.lower())
        self.assertEqual(self._run_git("rev-parse", "HEAD").stdout, before)

    def test_push_failure_reports_local_commit(self):
        self._write("quiz_pending_changes.json", {"changes": []})
        self._run_git("remote", "add", "origin", str(Path(self.remote_dir.name) / "missing-remote.git"))
        result = self._run_update()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("local commit exists", result.stderr)
        self.assertIn("Update quiz changes", self._run_git("log", "-1", "--format=%s").stdout)


if __name__ == "__main__":
    unittest.main()