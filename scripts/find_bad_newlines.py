from pathlib import Path

path = Path(r"c:\Desktop\HTML\bpsc-quiz-portal\data\mock.json")
text = path.read_text(encoding='utf-8')
out = Path(r"c:\Desktop\HTML\bpsc-quiz-portal\scripts\bad_newlines_report.txt")

in_string = False
escaped = False
line = 1
col = 1
for i, ch in enumerate(text):
    if ch == '\n':
        line += 1
        col = 1
    else:
        col += 1
    if in_string:
        if escaped:
            escaped = False
            continue
        if ch == '\\':
            escaped = True
            continue
        if ch == '"':
            in_string = False
            continue
        if ch in '\n\r':
            with out.open('a', encoding='utf-8') as f:
                f.write(f'newline-in-string at index {i} line {line} col {col} around: {repr(text[max(0, i-80):i+120])}\n')
            break
    else:
        if ch == '"':
            in_string = True

if not out.exists():
    out.write_text('no newline-in-string found\n', encoding='utf-8')
