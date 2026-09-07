import json
import subprocess

with open("data/mock.json", encoding="utf-8") as f:
    cur = json.load(f)

old = json.loads(
    subprocess.check_output(
        ["git", "show", "HEAD:data/mock.json"]
    ).decode("utf-8")
)

cur_tests = cur["TEST NUMBER"]
old_tests = old["TEST NUMBER"]

cur_total = sum(len(qs) for qs in cur_tests.values())
old_total = sum(len(qs) for qs in old_tests.values())

changed = []
size_changes = []

for set_name in old_tests:
    old_questions = old_tests[set_name]
    cur_questions = cur_tests.get(set_name)

    if cur_questions is None:
        size_changes.append((set_name, len(old_questions), 0))
        continue

    if len(cur_questions) != len(old_questions):
        size_changes.append(
            (set_name, len(old_questions), len(cur_questions))
        )

    for i in range(min(len(old_questions), len(cur_questions))):
        if cur_questions[i] != old_questions[i]:
            changed.append(
                (
                    set_name,
                    i + 1,
                    old_questions[i]["q"][:80],
                    cur_questions[i]["q"][:80]
                )
            )

invalid_answers = []

for set_name, questions in cur_tests.items():
    for i, r in enumerate(questions, 1):
        opts = r.get("options", [])
        ans = r.get("answer")

        if opts and (
            not isinstance(ans, int)
            or ans < 0
            or ans >= len(opts)
        ):
            invalid_answers.append(
                (set_name, i, ans, len(opts))
            )

missing_fields = []

for set_name, questions in cur_tests.items():
    for i, r in enumerate(questions, 1):
        for field in ("q", "options", "answer", "explanation"):
            if field not in r:
                missing_fields.append((set_name, i, field))

print("=== PROPER FINAL VALIDATION ===")
print("JSON parse: OK")
print("TEST GROUPS:", len(cur_tests))
print("HEAD TEST GROUPS:", len(old_tests))
print("TOTAL QUESTIONS:", cur_total)
print("HEAD TOTAL QUESTIONS:", old_total)
print("Group names/order identical:", list(cur_tests) == list(old_tests))
print("Group sizes unchanged:", len(size_changes) == 0)
print("Changed records:", len(changed))
print("Invalid answers:", len(invalid_answers))
print("Missing required fields:", len(missing_fields))

print("\n=== CHANGED RECORDS ===")
for item in changed:
    print(item)

print("\n=== GROUP SIZE CHANGES ===")
for item in size_changes:
    print(item)

print("\n=== INVALID ANSWERS ===")
for item in invalid_answers:
    print(item)

print("\n=== MISSING FIELDS ===")
for item in missing_fields:
    print(item)

print("\n=== FINAL VERDICT ===")

if (
    len(cur_tests) == 41
    and len(old_tests) == 41
    and cur_total == 6137
    and old_total == 6137
    and list(cur_tests) == list(old_tests)
    and not size_changes
    and len(changed) == 9
    and not invalid_answers
    and not missing_fields
):
    print("PASS — structure preserved and 9 intended repairs remain.")
else:
    print("REVIEW REQUIRED — one or more checks failed.")
