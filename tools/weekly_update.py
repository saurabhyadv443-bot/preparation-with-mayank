"""Apply pending quiz changes, commit the quiz data, and push to GitHub."""

import subprocess
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PENDING_CHANGES = PROJECT_ROOT / "quiz_pending_changes.json"
QUIZ_FILES = (
    Path("data/current_affairs.json"),
    Path("data/economy.json"),
    Path("data/geography.json"),
    Path("data/mock.json"),
    Path("data/modern.json"),
    Path("data/polity.json"),
)


class WeeklyUpdateError(Exception):
    """An expected failure that should stop the workflow safely."""


def run_git(*arguments, check=True):
    result = subprocess.run(
        ["git", *arguments],
        cwd=PROJECT_ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout).strip()
        raise WeeklyUpdateError(f"git {' '.join(arguments)} failed: {detail}")
    return result


def print_process_output(result):
    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip(), file=sys.stderr)


def verify_project_root():
    if Path.cwd().resolve() != PROJECT_ROOT:
        raise WeeklyUpdateError(f"Run this command from the project root: {PROJECT_ROOT}")
    result = run_git("rev-parse", "--show-toplevel")
    git_root = Path(result.stdout.strip()).resolve()
    if git_root != PROJECT_ROOT:
        raise WeeklyUpdateError(f"Project root mismatch: expected {PROJECT_ROOT}, found {git_root}")


def status_text():
    return run_git("status", "--short", "--untracked-files=all").stdout


def changed_quiz_files(before_contents):
    return [
        path
        for path in QUIZ_FILES
        if before_contents.get(path) != (PROJECT_ROOT / path).read_bytes()
    ]


def final_status():
    result = run_git("status", "--short", "--untracked-files=all")
    print("Final git status:")
    clean = not result.stdout.strip()
    print("Working tree is clean." if clean else result.stdout.rstrip())
    print(f"Working tree clean: {'yes' if clean else 'no'}")
    return clean


def main():
    try:
        print("[1/6] Checking project...")
        verify_project_root()
        status_before = status_text()
        print("Git status before update:")
        print(status_before.rstrip() if status_before.strip() else "(clean)")
        before_contents = {
            path: (PROJECT_ROOT / path).read_bytes()
            for path in QUIZ_FILES
            if (PROJECT_ROOT / path).is_file()
        }

        print("[2/6] Applying pending quiz changes...")
        if PENDING_CHANGES.is_file():
            result = subprocess.run(
                [sys.executable, "tools/sync_quiz_changes.py"],
                cwd=PROJECT_ROOT,
                check=False,
                text=True,
            )
            if result.returncode != 0:
                raise WeeklyUpdateError(
                    f"Synchronization failed with exit code {result.returncode}."
                )
        else:
            print("No quiz_pending_changes.json found; skipping synchronization.")

        print("[3/6] Checking changes...")
        run_git("diff", "--check")
        changed_files = changed_quiz_files(before_contents)
        if not changed_files:
            print("There are no quiz-data changes to commit.")
            return 0

        print("[4/6] Staging quiz JSON files...")
        print("Quiz JSON files to commit:")
        for path in changed_files:
            print(f"- {path.as_posix()}")
        run_git("add", "--", *(path.as_posix() for path in changed_files))

        print("[5/6] Committing...")
        run_git("commit", "-m", "Update quiz changes")
        if PENDING_CHANGES.is_file():
            PENDING_CHANGES.unlink()
            print("Removed quiz_pending_changes.json after successful synchronization and commit.")

        print("[6/6] Pushing to GitHub...")
        push_result = run_git("push", "origin", "main", check=False)
        print_process_output(push_result)
        if push_result.returncode != 0:
            raise WeeklyUpdateError(
                "Push failed, but the local commit exists. "
                "The pending changes were committed locally."
            )
        print("Weekly quiz update completed successfully.")
        return 0
    except (OSError, WeeklyUpdateError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    finally:
        try:
            final_status()
        except (OSError, WeeklyUpdateError) as error:
            print(f"ERROR: Could not read final git status: {error}", file=sys.stderr)


if __name__ == "__main__":
    sys.exit(main())