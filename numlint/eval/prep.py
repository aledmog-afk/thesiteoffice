"""Convert the NLTK corpora into plain-text documents for the corpus run.

Reuters is 1987 financial newswire, Brown is 1961 general American English,
Gutenberg is literary prose, state_union/inaugural are political speeches
(1789-2006) and abc/webtext are 2000s news and web writing. Between them they
cover most of the ways numbers get written down in English.
"""
import glob
import os
import re
import sys

SRC = sys.argv[1].rstrip('/')
OUT = sys.argv[2]
KIND = os.path.basename(SRC)
os.makedirs(OUT, exist_ok=True)
CHUNK = 18000


def clean_wire(t: str) -> str:
    t = t.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
    lines = t.split('\n')
    if lines and lines[0].isupper():
        lines[0] = lines[0].title()
    t = '\n'.join(lines)
    return re.sub(r'\n\s+', '\n', re.sub(r'[ \t]+', ' ', t)).strip()


def clean_tagged(t: str) -> str:
    """Brown ships as word/POS pairs."""
    words = [tok.rsplit('/', 1)[0].replace('``', '"').replace("''", '"') for tok in t.split()]
    return re.sub(r'\s+([,.;:!?])', r'\1', ' '.join(words)).strip()


def write(name: str, text: str) -> int:
    n = 0
    for i in range(0, len(text), CHUNK):
        chunk = text[i:i + CHUNK]
        if len(chunk) < 1500:
            continue
        with open(os.path.join(OUT, f'{KIND}-{name}.{i}.txt'), 'w') as fh:
            fh.write(chunk)
        n += 1
    return n


total = 0
if KIND == 'reuters':
    for f in sorted(glob.glob(os.path.join(SRC, 'training', '*')))[:6000]:
        body = clean_wire(open(f, encoding='latin-1').read())
        if len(body) >= 200:
            with open(os.path.join(OUT, f'reuters-{os.path.basename(f)}.txt'), 'w') as fh:
                fh.write(body)
            total += 1
elif KIND == 'brown':
    for f in sorted(glob.glob(os.path.join(SRC, 'c*'))):
        if os.path.basename(f) in ('cats.txt', 'CONTENTS', 'README'):
            continue
        body = clean_tagged(open(f, encoding='latin-1').read())
        if len(body) >= 200:
            with open(os.path.join(OUT, f'brown-{os.path.basename(f)}.txt'), 'w') as fh:
                fh.write(body)
            total += 1
else:
    for f in sorted(glob.glob(os.path.join(SRC, '*.txt'))):
        total += write(os.path.basename(f), open(f, encoding='latin-1').read())

print(f'{KIND}: {total} documents -> {OUT}')
