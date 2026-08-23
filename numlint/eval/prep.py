"""Turn the NLTK corpora into plain-text documents for the false-positive run."""
import os, re, sys, glob

SRC = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)

def clean_reuters(t: str) -> str:
    t = t.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
    lines = t.split('\n')
    if lines and lines[0].isupper():
        lines[0] = lines[0].title()
    t = '\n'.join(lines)
    t = re.sub(r'[ \t]+', ' ', t)
    t = re.sub(r'\n\s+', '\n', t)
    return t.strip()

def clean_brown(t: str) -> str:
    words = []
    for tok in t.split():
        w = tok.rsplit('/', 1)[0]
        w = w.replace('``', '"').replace("''", '"')
        words.append(w)
    t = ' '.join(words)
    t = re.sub(r'\s+([,.;:!?])', r'\1', t)
    return t.strip()

n = 0
if 'reuters' in SRC:
    for f in sorted(glob.glob(os.path.join(SRC, 'training', '*')))[:6000]:
        t = clean_reuters(open(f, encoding='latin-1').read())
        if len(t) < 200: continue
        open(os.path.join(OUT, f'reuters-{os.path.basename(f)}.txt'), 'w').write(t)
        n += 1
else:
    for f in sorted(glob.glob(os.path.join(SRC, 'c*'))):
        if os.path.basename(f) in ('cats.txt', 'CONTENTS', 'README'): continue
        t = clean_brown(open(f, encoding='latin-1').read())
        if len(t) < 200: continue
        open(os.path.join(OUT, f'brown-{os.path.basename(f)}.txt'), 'w').write(t)
        n += 1
print(f'{n} documents -> {OUT}')
