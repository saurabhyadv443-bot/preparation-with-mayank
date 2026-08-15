from pathlib import Path

paths = [
    Path('assets/js/quizEngine.js'),
    Path('assets/js/result.js'),
    Path('assets/js/resultReview.js'),
    Path('assets/js/review.js')
]
errors = False
for path in paths:
    try:
        src = path.read_text(encoding='utf-8')
        compile(src, str(path), 'exec')
    except Exception as exc:
        print(f'ERROR in {path}: {exc}')
        errors = True
if not errors:
    print('JS SYNTAX CHECK PASSED')
else:
    raise SystemExit(1)
