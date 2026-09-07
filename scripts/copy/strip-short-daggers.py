#!/usr/bin/env python3
"""Take the ‡ off any string four words or fewer.

The mark says "nobody has signed off on this wording yet" (CLAUDE.md's prime
directive), so it is only worth carrying on a line that HAS wording. "Save",
"Try again", "You have no camera" — there is no voice in those to rewrite, and
1200 of them buried the lines that do need a look.

Read-only by default. `--apply` writes.

Each mark is measured against its own RENDERED UNIT, not its line: the string
literal it sits in, the JSX text node, the Markdown block, the YAML scalar. A
`${…}` interpolation and a `{tag:…}` token each count as one word, because
that is one word on screen.
"""

import os
import re
import sys

ROOTS = ["docs", "web", "bot", "db"]

SKIP_DIRS = {"node_modules", ".next", ".git", "dist", "build"}
SKIP_PREFIXES = (
    "docs/systemdocs/",   # internal reference; a ‡ there marks a drafted RULE
    "docs/archive/",      # dead games, left as they were
    "docs/superpowers/",  # planning notes, not game text
)
SKIP_FILES = {
    "docs/text-change-review.md",   # a worksheet somebody is filling in
    "db/prisma/schema.prisma",      # comments only
}

JS_EXT = (".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx")
MD_EXT = (".md",)
YAML_EXT = (".yaml", ".yml")

MARK = "‡"
MAX_WORDS = 4

# Glyph furniture that is punctuation rather than a word.
FURNITURE = re.compile(r"[‡⬢»]|(?<![A-Za-z0-9])-#")
# A rich token renders as one chip.
TOKEN = re.compile(r"\{(?:tag|resource|character|location):[^}]*\}")
MD_NOISE = re.compile(r"[*_`~#>\[\]]|\((?:https?|/)[^)]*\)")


def word_count(unit, interpolations=" X "):
    text = TOKEN.sub(" X ", unit)
    text = re.sub(r"\$\{[^{}]*\}", interpolations, text)
    text = FURNITURE.sub(" ", text)
    text = MD_NOISE.sub(" ", text)
    text = re.sub(r"&[a-z]+;", "x", text)
    words = [w for w in text.split() if re.search(r"[A-Za-z0-9]", w)]
    return len(words)


# --------------------------------------------------------------- JS scanning

def js_regions(src):
    """Every ‡ in a JS file, tagged with the unit it belongs to.

    Returns a list of (mark_index, kind, unit_text). kind is "comment" (never
    touched), "string" or "jsx".
    """
    out = []
    i = 0
    n = len(src)
    state = None          # None | "line" | "block" | "'" | '"' | "`"
    tmpl_stack = []       # (template start, marks so far) per open `${`
    start = 0
    marks_here = []

    def flush(kind, text):
        for m in marks_here:
            out.append((m, kind, text))
        marks_here.clear()

    while i < n:
        ch = src[i]
        if state is None:
            if ch == "/" and i + 1 < n and src[i + 1] == "/":
                state, start, i = "line", i, i + 2
                continue
            if ch == "/" and i + 1 < n and src[i + 1] == "*":
                state, start, i = "block", i, i + 2
                continue
            if ch in "'\"`":
                state, start, i = ch, i + 1, i + 1
                continue
            if ch == "}" and tmpl_stack:
                # Back inside the template this `${` interrupted. The unit is
                # the WHOLE template, so its start and its marks come back too.
                start, marks_here[:] = tmpl_stack.pop()
                state, i = "`", i + 1
                continue
            if ch == MARK:
                out.append((i, "jsx", None))
            i += 1
            continue

        if state == "line":
            if ch == "\n":
                flush("comment", src[start:i])
                state = None
            elif ch == MARK:
                marks_here.append(i)
            i += 1
            continue

        if state == "block":
            if ch == "*" and i + 1 < n and src[i + 1] == "/":
                flush("comment", src[start:i])
                state, i = None, i + 2
                continue
            if ch == MARK:
                marks_here.append(i)
            i += 1
            continue

        # inside a string literal
        if ch == "\\":
            i += 2
            continue
        if state == "`" and ch == "$" and i + 1 < n and src[i + 1] == "{":
            tmpl_stack.append((start, list(marks_here)))
            marks_here.clear()
            state, i = None, i + 2
            continue
        if ch == state:
            flush("string", src[start:i])
            state, i = None, i + 1
            continue
        if ch == MARK:
            marks_here.append(i)
        i += 1

    flush("string" if state else "jsx", src[start:n] if state else "")
    return out


def jsx_unit(src, idx):
    """The text node a bare ‡ sits in: from the tag that opened it to the tag
    that closes it, `{…}` interpolations included, since those render as words
    too."""
    a = src.rfind(">", 0, idx) + 1
    b = src.find("<", idx)
    if b == -1:
        b = len(src)
    return src[a:b]


def js_marks(path, src):
    """[(index, unit)] for every ‡ worth measuring."""
    tagged = {}
    for idx, kind, text in js_regions(src):
        tagged[idx] = (kind, text)
    marks = []
    for m in re.finditer(MARK, src):
        idx = m.start()
        kind, text = tagged.get(idx, ("jsx", None))
        if kind == "comment":
            continue
        if kind == "jsx" or text is None:
            text = jsx_unit(src, idx)
        marks.append((idx, text))
    return marks


# --------------------------------------------------------- Markdown and YAML

def md_marks(src):
    marks = []
    lines = src.split("\n")
    starts = []
    pos = 0
    for line in lines:
        starts.append(pos)
        pos += len(line) + 1
    for i, line in enumerate(lines):
        if MARK not in line:
            continue
        # the block: contiguous non-blank lines around this one
        a = i
        while a > 0 and lines[a - 1].strip():
            a -= 1
        b = i
        while b + 1 < len(lines) and lines[b + 1].strip():
            b += 1
        unit = " ".join(lines[a:b + 1])
        for m in re.finditer(MARK, line):
            marks.append((starts[i] + m.start(), unit))
    return marks


def yaml_marks(src):
    marks = []
    lines = src.split("\n")
    starts = []
    pos = 0
    for line in lines:
        starts.append(pos)
        pos += len(line) + 1
    key = re.compile(r"^\s*(-\s+)?[A-Za-z_][\w-]*:")
    for i, line in enumerate(lines):
        if MARK not in line:
            continue
        if line.lstrip().startswith("#"):
            continue          # a comment in a YAML master is authoring notes
        # walk up to the key line that opened this scalar
        a = i
        while a > 0 and not key.match(lines[a]):
            a -= 1
        b = i
        # a block scalar runs on; a plain one may fold over a line or two
        while b + 1 < len(lines) and lines[b + 1].strip() and not key.match(lines[b + 1]):
            b += 1
        unit = " ".join(lines[a:b + 1])
        unit = re.sub(r"^\s*(-\s+)?[A-Za-z_][\w-]*:\s*[|>]?[-+]?", "", unit)
        for m in re.finditer(MARK, line):
            marks.append((starts[i] + m.start(), unit))
    return marks


# ------------------------------------------------------------------- the pass

def strip_at(src, indexes):
    """Remove each ‡ and the whitespace that was holding it out."""
    out = []
    last = 0
    for idx in sorted(indexes):
        a = idx
        while a > 0 and src[a - 1] == " ":
            a -= 1
        # A mark on its own after a newline keeps the newline, not the indent.
        out.append(src[last:a])
        last = idx + 1
    out.append(src[last:])
    text = "".join(out)
    return text


def files():
    for root in ROOTS:
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
            for name in filenames:
                p = os.path.join(dirpath, name)
                if p in SKIP_FILES or p.startswith(SKIP_PREFIXES):
                    continue
                if not p.endswith(JS_EXT + MD_EXT + YAML_EXT):
                    continue
                yield p


def main():
    apply = "--apply" in sys.argv
    verbose = "--list" in sys.argv
    total = stripped = skipped_empty = 0
    touched = []

    for path in sorted(files()):
        try:
            src = open(path, encoding="utf-8").read()
        except (UnicodeDecodeError, OSError):
            continue
        if MARK not in src:
            continue

        if path.endswith(JS_EXT):
            marks = js_marks(path, src)
        elif path.endswith(MD_EXT):
            marks = md_marks(src)
        else:
            marks = yaml_marks(src)

        total += src.count(MARK)
        hits = []
        for idx, unit in marks:
            n = word_count(unit)
            if word_count(unit, " ") == 0:
                # An append site: `${line} ‡`, all interpolation and no words
                # of its own. What it will be as long as is a runtime fact, so
                # the mark stays.
                skipped_empty += 1
                continue
            if n <= MAX_WORDS:
                hits.append(idx)
                if verbose:
                    print(f"{path}: ({n}) {unit.strip()[:90]}")

        if not hits:
            continue
        new = strip_at(src, hits)

        # The only difference may be removed marks and the spaces before them.
        assert new.replace(MARK, "").replace(" ", "") == src.replace(MARK, "").replace(" ", ""), path
        stripped += len(hits)
        touched.append((path, len(hits)))
        if apply:
            tmp = path + ".dagger.tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                fh.write(new)
            os.replace(tmp, path)

    for path, n in touched:
        print(f"{n:4d}  {path}")
    print(f"\n{stripped} of {total} marks are on strings of {MAX_WORDS} words or fewer, "
          f"across {len(touched)} files. {skipped_empty} runtime append sites left alone.")
    if not apply:
        print("Dry run. Pass --apply to write.")


if __name__ == "__main__":
    main()
