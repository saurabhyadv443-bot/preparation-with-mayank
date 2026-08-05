from pathlib import Path
import json

path = Path(r"c:\Desktop\HTML\bpsc-quiz-portal\data\mock.json")
text = path.read_text(encoding='utf-8')
out_path = Path(r"c:\Desktop\HTML\bpsc-quiz-portal\scripts\mock_json_error.txt")
try:
    json.loads(text)
    out_path.write_text('JSON_OK\n', encoding='utf-8')
except Exception as e:
    msg = str(e)
    pos = None
    if 'position' in msg:
        pos = int(msg.split('position ')[1].split()[0])
    snippet = text[max(0, (pos or 0) - 300):(pos or 0) + 500] if pos is not None else ''
    out_path.write_text(f'{msg}\nPOS={pos}\n---SNIPPET---\n{snippet}\n', encoding='utf-8')
