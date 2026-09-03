import json
import re
from pathlib import Path

html_path = Path('quizzes/Medeival And Modern History.htm')
out_dir = Path('data')
out_dir.mkdir(exist_ok=True)

text = html_path.read_text(encoding='utf-8')
start_marker = 'const quizData ='
start_index = text.find(start_marker)
if start_index == -1:
    raise SystemExit('quizData block not found in the source HTML file.')

brace_start = text.find('{', start_index)
if brace_start == -1:
    raise SystemExit('quizData object opening brace not found.')

brace_depth = 0
in_string = False
escape = False
end_index = None
for i in range(brace_start, len(text)):
    ch = text[i]
    if in_string:
        if escape:
            escape = False
        elif ch == '\\':
            escape = True
        elif ch == '"':
            in_string = False
        continue

    if ch == '"':
        in_string = True
        continue

    if ch == '{':
        brace_depth += 1
    elif ch == '}':
        brace_depth -= 1
        if brace_depth == 0:
            end_index = i
            break

if end_index is None:
    raise SystemExit('Unable to locate the end of the quizData object.')

raw = text[brace_start:end_index + 1]

# Normalize JS object sugar into JSON-safe text.
raw = re.sub(r'([{,]\s*)([A-Za-z_][A-Za-z0-9_\- ]*)(\s*:\s*)', r'\1"\2"\3', raw)
raw = raw.replace('question:', 'q:')
raw = re.sub(r'"question"\s*:', '"q":', raw)
raw = re.sub(r',\s*([}\]])', r'\1', raw)

try:
    obj = json.loads(raw)
except json.JSONDecodeError as exc:
    raise SystemExit(f'Failed to parse converted JSON: {exc}')

normalized = {
    'subject': 'Medieval and Modern History',
    'quizType': 'practice',
    'secondsPerQuestion': 40,
    'chapters': {}
}

question_total = 0
for chapter_name, items in obj.items():
    cleaned_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        cleaned_item = {
            'q': item.get('q') or item.get('question') or '',
            'options': item.get('options') or [],
            'answer': item.get('answer', 0),
            'explanation': item.get('explanation', '') or ''
        }
        if item.get('quizMeta'):
            cleaned_item['quizMeta'] = item['quizMeta']
        cleaned_items.append(cleaned_item)
    normalized['chapters'][chapter_name] = cleaned_items
    question_total += len(cleaned_items)

max_per_file = 2500
parts = []
current = {}
current_count = 0
for chapter_name, chapter_items in normalized['chapters'].items():
    if current_count + len(chapter_items) > max_per_file and current:
        parts.append(current)
        current = {}
        current_count = 0
    current[chapter_name] = chapter_items
    current_count += len(chapter_items)
if current:
    parts.append(current)

created = []
for idx, part_chapters in enumerate(parts, start=1):
    payload = {
        'subject': normalized['subject'],
        'quizType': normalized['quizType'],
        'secondsPerQuestion': normalized['secondsPerQuestion'],
        'chapters': part_chapters
    }
    out_path = out_dir / f'modern_part{idx}.json'
    with out_path.open('w', encoding='utf-8') as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
        fh.write('\n')

    with out_path.open('r', encoding='utf-8') as fh:
        validated = json.load(fh)

    q_count = sum(len(v) for v in validated['chapters'].values())
    created.append((out_path.name, q_count))

print(f'question_total={question_total}')
print(f'parts_created={len(created)}')
for name, count in created:
    print(f'{name}:{count}')
