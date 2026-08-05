from pathlib import Path
import json

path = Path(r"c:\Desktop\HTML\bpsc-quiz-portal\data\mock.json")
text = path.read_text(encoding="utf-8")
out = []
in_string = False
escaped = False
for ch in text:
    if in_string:
        if escaped:
            out.append(ch)
            escaped = False
            continue
        if ch == "\\":
            out.append(ch)
            escaped = True
            continue
        if ch == '"':
            out.append(ch)
            in_string = False
            continue
        if ch in "\n\r":
            out.append(" ")
            continue
        out.append(ch)
    else:
        if ch == '"':
            in_string = True
        out.append(ch)

new_text = "".join(out)
path.write_text(new_text, encoding="utf-8")
obj = json.loads(new_text)
print(f"Parsed OK: {obj['subject']} with {len(obj.get('chapters', {}))} chapter groups")
