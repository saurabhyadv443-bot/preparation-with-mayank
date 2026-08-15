from pathlib import Path
lines = Path('assets/js/quizEngine.js').read_text(encoding='utf-8').splitlines()
for i, line in enumerate(lines, 1):
    if 'normalizeQuizChapters' in line or 'getChapterLabel' in line or 'loadChapters' in line or 'btn.innerText' in line or 'chapterTitle.innerText' in line or 'quizData.chapters' in line:
        print(f'{i}: {line}')
