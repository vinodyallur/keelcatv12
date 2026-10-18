# -*- coding: utf-8 -*-
"""Generate two PDFs for KeelCat:
  1. KeelCat-Product-Overview.pdf  -- professional, detailed (rendered from PRODUCT.md)
  2. KeelCat-Explained-Simply.pdf  -- dead-simple visual deck (explain like I'm 5)
Pure-Python via fpdf2. No external fonts required (uses core Helvetica).
All text is sanitized to Latin-1 so core fonts never choke.
"""
import os
import re
from fpdf import FPDF

HERE = os.path.dirname(os.path.abspath(__file__))

# Brand palette
INK      = (18, 22, 30)
MUTED    = (90, 100, 115)
FAINT    = (140, 150, 165)
ACCENT   = (22, 132, 92)     # deep green
ACCENT2  = (14, 92, 66)
SKY      = (44, 120, 210)
AMBER    = (214, 158, 46)
CORAL    = (222, 82, 70)
VIOLET   = (120, 92, 210)
LINE     = (223, 227, 233)
CARD     = (247, 249, 251)
WHITE    = (255, 255, 255)


def clean(s: str) -> str:
    """Make text safe for core (Latin-1) fonts."""
    repl = {
        "\u2014": "-", "\u2013": "-", "\u2019": "'", "\u2018": "'",
        "\u201c": '"', "\u201d": '"', "\u2026": "...", "\u2192": "->",
        "\u2022": "-", "\u00a0": " ", "\u2011": "-", "\u2212": "-",
    }
    for k, v in repl.items():
        s = s.replace(k, v)
    return s.encode("latin-1", "replace").decode("latin-1")


# ---------------------------------------------------------------------------
# 1) PROFESSIONAL DOC  (render PRODUCT.md)
# ---------------------------------------------------------------------------
class ProDoc(FPDF):
    def header(self):
        if self.page_no() == 1:
            return
        self.set_y(9)
        self.set_font("Helvetica", "B", 9)
        self.set_text_color(*ACCENT)
        self.cell(0, 6, "KeelCat", align="L")
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*FAINT)
        self.cell(0, 6, "Product Overview", align="R")
        self.set_draw_color(*LINE)
        self.set_line_width(0.3)
        self.line(self.l_margin, 17, self.w - self.r_margin, 17)

    def footer(self):
        if self.page_no() == 1:
            return
        self.set_y(-13)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(*FAINT)
        self.cell(0, 6, f"{self.page_no()}", align="C")


def build_pro_doc(md_path, out_path):
    with open(md_path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()

    pdf = ProDoc(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.set_margins(20, 18, 20)
    pdf.add_page()
    EPW = pdf.w - pdf.l_margin - pdf.r_margin  # effective page width

    # ---- Cover ----
    pdf.set_fill_color(*INK)
    pdf.rect(0, 0, pdf.w, pdf.h, style="F")
    # accent band
    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, 96, pdf.w, 3, style="F")
    pdf.set_xy(20, 70)
    pdf.set_text_color(*WHITE)
    pdf.set_font("Helvetica", "B", 40)
    pdf.cell(0, 18, "KeelCat", align="L")
    pdf.set_xy(20, 104)
    pdf.set_text_color(200, 210, 205)
    pdf.set_font("Helvetica", "", 15)
    pdf.cell(0, 10, "Dependabot for the APIs your code calls.", align="L")
    pdf.set_xy(20, 122)
    pdf.set_text_color(150, 160, 158)
    pdf.set_font("Helvetica", "", 11)
    pdf.multi_cell(150, 6, clean(
        "Your APIs change. Your code keeps up. KeelCat watches your API "
        "providers' changelogs, fixes the affected code across every repo "
        "and language, and opens a reviewable pull request - automatically. "
        "It never merges without you."))
    pdf.set_xy(20, pdf.h - 30)
    pdf.set_text_color(120, 130, 128)
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(0, 6, "Version 1.0   -   Product & Technical Overview", align="L")

    pdf.add_page()
    pdf.set_text_color(*INK)

    def at_left():
        pdf.set_x(pdf.l_margin)

    def space_check(need):
        if pdf.get_y() + need > pdf.h - 20:
            pdf.add_page()

    def para(text, size=10.5, gap=2.2, lh=5.4, color=MUTED):
        at_left()
        pdf.set_font("Helvetica", "", size)
        pdf.set_text_color(*color)
        pdf.multi_cell(EPW, lh, clean(text), markdown=True)
        pdf.ln(gap)

    def bullet(text, indent=0.0):
        at_left()
        pdf.set_font("Helvetica", "", 10.5)
        x = pdf.l_margin + 2 + indent
        y = pdf.get_y()
        pdf.set_fill_color(*ACCENT)
        pdf.ellipse(x, y + 2.0, 1.5, 1.5, style="F")
        pdf.set_xy(x + 4, y)
        pdf.set_text_color(*MUTED)
        pdf.multi_cell(EPW - (x + 4 - pdf.l_margin), 5.2, clean(text), markdown=True)
        pdf.ln(1.2)

    def table_card(rows):
        """Render a markdown table as a stack of clean cards."""
        if len(rows) < 3:
            return
        header = [c.strip() for c in rows[0]]
        body = [[c.strip() for c in r] for r in rows[2:]]
        pdf.ln(1)
        for r in body:
            title = r[0] if r else ""
            rest = list(zip(header[1:], r[1:]))
            # estimate height
            space_check(30)
            y0 = pdf.get_y()
            at_left()
            # card background
            # title bar
            pdf.set_font("Helvetica", "B", 11)
            pdf.set_text_color(*WHITE)
            pdf.set_fill_color(*ACCENT)
            pdf.multi_cell(EPW, 7, "  " + clean(title.replace("**", "")),
                           fill=True, markdown=False)
            for label, val in rest:
                at_left()
                pdf.set_font("Helvetica", "B", 9.5)
                pdf.set_text_color(*ACCENT2)
                pdf.multi_cell(EPW, 5, clean(label.replace("**", "")))
                at_left()
                pdf.set_font("Helvetica", "", 10)
                pdf.set_text_color(*MUTED)
                pdf.multi_cell(EPW, 5, "   " + clean(val), markdown=True)
            pdf.set_draw_color(*LINE)
            pdf.set_line_width(0.3)
            pdf.line(pdf.l_margin, pdf.get_y() + 1, pdf.w - pdf.r_margin, pdf.get_y() + 1)
            pdf.ln(4)

    in_table = []

    def flush_table():
        nonlocal in_table
        if in_table:
            table_card(in_table)
            in_table = []

    for raw in lines:
        line = raw.rstrip()

        # table rows
        if line.strip().startswith("|") and line.strip().endswith("|"):
            cells = line.strip().strip("|").split("|")
            in_table.append(cells)
            continue
        else:
            flush_table()

        if line.strip() == "---":
            continue
        if not line.strip():
            pdf.ln(1.5)
            continue

        if line.startswith("### "):
            space_check(16)
            pdf.ln(1.5)
            at_left()
            pdf.set_font("Helvetica", "B", 11.5)
            pdf.set_text_color(*ACCENT2)
            pdf.multi_cell(EPW, 6, clean(line[4:]))
            pdf.ln(1)
        elif line.startswith("## "):
            space_check(40)
            pdf.ln(3)
            y = pdf.get_y()
            pdf.set_fill_color(*ACCENT)
            pdf.rect(pdf.l_margin, y + 0.5, 2.5, 6.5, style="F")
            pdf.set_xy(pdf.l_margin + 5, y)
            pdf.set_font("Helvetica", "B", 15)
            pdf.set_text_color(*INK)
            pdf.multi_cell(EPW - 5, 7.5, clean(line[3:]))
            pdf.ln(2)
        elif line.startswith("# "):
            at_left()
            pdf.set_font("Helvetica", "B", 22)
            pdf.set_text_color(*INK)
            pdf.multi_cell(EPW, 10, clean(line[2:]))
            pdf.ln(2)
        elif line.startswith("> "):
            txt = clean(line[2:])
            pdf.set_font("Helvetica", "BI", 11)
            wrapped = pdf.multi_cell(EPW - 10, 5.6, txt, dry_run=True,
                                     output="LINES")
            h = len(wrapped) * 5.6 + 5
            space_check(h + 4)
            y = pdf.get_y()
            pdf.set_fill_color(*CARD)
            pdf.rect(pdf.l_margin, y, EPW, h, style="F")
            pdf.set_fill_color(*ACCENT)
            pdf.rect(pdf.l_margin, y, 2.5, h, style="F")
            pdf.set_xy(pdf.l_margin + 6, y + 2.5)
            pdf.set_text_color(*ACCENT2)
            pdf.multi_cell(EPW - 10, 5.6, txt)
            pdf.set_y(y + h)
            pdf.ln(2)
        elif re.match(r"^\s*-\s+", line):
            indent = (len(line) - len(line.lstrip()))
            bullet(re.sub(r"^\s*-\s+", "", line), indent=indent * 1.2)
        else:
            para(line)

    flush_table()
    pdf.output(out_path)
    print("WROTE", out_path)


# ---------------------------------------------------------------------------
# 2) SIMPLE VISUAL DECK  (explain like I'm 5)
# ---------------------------------------------------------------------------
class Deck(FPDF):
    pass


def build_simple_deck(out_path):
    W, H = 297, 167  # 16:9-ish landscape mm
    pdf = FPDF(orientation="L", unit="mm", format=(H, W))
    pdf.set_auto_page_break(auto=False)

    def bg(color=WHITE):
        pdf.set_fill_color(*color)
        pdf.rect(0, 0, W, H, style="F")

    def page_num(n, total):
        pdf.set_font("Helvetica", "", 10)
        pdf.set_text_color(*FAINT)
        pdf.set_xy(0, H - 12)
        pdf.cell(W, 6, f"{n} / {total}", align="C")

    def center_text(txt, y, size, color=INK, style="B", w=None):
        pdf.set_font("Helvetica", style, size)
        pdf.set_text_color(*color)
        pdf.set_xy((W - (w or (W - 40))) / 2, y)
        pdf.multi_cell(w or (W - 40), size * 0.5, clean(txt), align="C")

    # simple icon helpers -----------------------------------------------
    def phone(cx, cy, col=SKY, label="YOUR\nAPP"):
        w, h = 26, 42
        pdf.set_fill_color(*col)
        pdf.rect(cx - w/2, cy - h/2, w, h, style="F", round_corners=True, corner_radius=4)
        pdf.set_fill_color(*WHITE)
        pdf.rect(cx - w/2 + 3, cy - h/2 + 5, w - 6, h - 12, style="F", round_corners=True, corner_radius=2)
        pdf.set_font("Helvetica", "B", 8)
        pdf.set_text_color(*col)
        pdf.set_xy(cx - w/2 + 3, cy - 4)
        pdf.multi_cell(w - 6, 4, clean(label), align="C")

    def cloud(cx, cy, col=VIOLET, label="STRIPE"):
        pdf.set_fill_color(*col)
        pdf.ellipse(cx - 22, cy - 6, 20, 16, style="F")
        pdf.ellipse(cx - 10, cy - 12, 24, 22, style="F")
        pdf.ellipse(cx + 4, cy - 6, 20, 16, style="F")
        pdf.rect(cx - 20, cy + 2, 40, 8, style="F")
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*WHITE)
        pdf.set_xy(cx - 22, cy - 3)
        pdf.multi_cell(44, 5, clean(label), align="C")

    def arrow(x1, y, x2, col=INK, label=None):
        pdf.set_draw_color(*col)
        pdf.set_line_width(2)
        pdf.line(x1, y, x2 - 4, y)
        # head
        pdf.set_fill_color(*col)
        d = 1 if x2 > x1 else -1
        pdf.polygon([(x2, y), (x2 - 6*d, y - 3.5), (x2 - 6*d, y + 3.5)], style="F")
        if label:
            pdf.set_font("Helvetica", "B", 8)
            pdf.set_text_color(*col)
            pdf.set_xy(min(x1, x2), y - 12)
            pdf.cell(abs(x2 - x1), 5, clean(label), align="C")

    def cat(cx, cy, s=1.0, col=ACCENT):
        # super-simple mascot: circle head + triangle ears + face
        r = 16 * s
        pdf.set_fill_color(*col)
        # ears
        pdf.polygon([(cx - r*0.75, cy - r*0.55), (cx - r*0.35, cy - r*1.15), (cx - r*0.1, cy - r*0.6)], style="F")
        pdf.polygon([(cx + r*0.75, cy - r*0.55), (cx + r*0.35, cy - r*1.15), (cx + r*0.1, cy - r*0.6)], style="F")
        pdf.ellipse(cx - r, cy - r, 2*r, 2*r, style="F")
        # eyes
        pdf.set_fill_color(*WHITE)
        pdf.ellipse(cx - r*0.5 - 2, cy - 3, 4, 5, style="F")
        pdf.ellipse(cx + r*0.5 - 2, cy - 3, 4, 5, style="F")
        pdf.set_fill_color(*INK)
        pdf.ellipse(cx - r*0.5 - 1, cy - 1, 2, 2.5, style="F")
        pdf.ellipse(cx + r*0.5 - 1, cy - 1, 2, 2.5, style="F")
        # nose
        pdf.set_fill_color(255, 170, 170)
        pdf.polygon([(cx - 2, cy + 3), (cx + 2, cy + 3), (cx, cy + 5.5)], style="F")

    def check(cx, cy, s=1.0, col=ACCENT):
        pdf.set_fill_color(*col)
        r = 14 * s
        pdf.ellipse(cx - r, cy - r, 2*r, 2*r, style="F")
        pdf.set_draw_color(*WHITE)
        pdf.set_line_width(3*s)
        pdf.line(cx - r*0.45, cy + r*0.05, cx - r*0.1, cy + r*0.4)
        pdf.line(cx - r*0.1, cy + r*0.4, cx + r*0.5, cy - r*0.4)

    def boom(cx, cy, s=1.0, col=CORAL):
        pdf.set_fill_color(*col)
        import math
        pts = []
        for i in range(16):
            ang = math.pi * 2 * i / 16
            rr = (18 if i % 2 == 0 else 9) * s
            pts.append((cx + rr*math.cos(ang), cy + rr*math.sin(ang)))
        pdf.polygon(pts, style="F")
        pdf.set_font("Helvetica", "B", int(11*s))
        pdf.set_text_color(*WHITE)
        pdf.set_xy(cx - 15*s, cy - 3*s)
        pdf.multi_cell(30*s, 5, "BREAK!", align="C")

    def eye(cx, cy, s=1.0, col=SKY):
        pdf.set_fill_color(*WHITE)
        pdf.set_draw_color(*col)
        pdf.set_line_width(2.5*s)
        pdf.ellipse(cx - 18*s, cy - 10*s, 36*s, 20*s, style="DF")
        pdf.set_fill_color(*col)
        pdf.ellipse(cx - 6*s, cy - 6*s, 12*s, 12*s, style="F")
        pdf.set_fill_color(*INK)
        pdf.ellipse(cx - 3*s, cy - 3*s, 6*s, 6*s, style="F")

    def wrench(cx, cy, s=1.0, col=AMBER):
        pdf.set_fill_color(*col)
        pdf.set_draw_color(*col)
        pdf.set_line_width(7*s)
        pdf.line(cx - 12*s, cy + 12*s, cx + 8*s, cy - 8*s)
        pdf.ellipse(cx + 4*s, cy - 16*s, 14*s, 14*s, style="F")
        pdf.set_fill_color(*WHITE)
        pdf.ellipse(cx + 8*s, cy - 12*s, 6*s, 6*s, style="F")

    TOTAL = 12
    n = 0

    def newslide(fill=WHITE):
        nonlocal n
        pdf.add_page()
        bg(fill)
        n += 1

    # --- Slide 1: Title ---
    newslide(INK)
    pdf.set_fill_color(*ACCENT)
    pdf.rect(0, H/2 + 30, W, 4, style="F")
    cat(W/2, 55, s=1.6, col=ACCENT)
    center_text("KeelCat", 82, 46, color=WHITE)
    center_text("We keep your code working when APIs change.", 120, 16, color=(180,190,188), style="")
    page_num(n, TOTAL)

    # --- Slide 2: your app talks to other apps ---
    newslide()
    center_text("Your app talks to other apps.", 16, 22)
    phone(70, 92, SKY, "YOUR\nAPP")
    arrow(92, 92, 150, INK, "asks for stuff")
    cloud(185, 90, VIOLET, "STRIPE")
    center_text("Like asking a friend for help. Your app asks Stripe to take a payment.", 138, 13, color=MUTED, style="")
    page_num(n, TOTAL)

    # --- Slide 3: the other app changes its rules ---
    newslide()
    center_text("Sometimes the other app changes its rules.", 16, 21)
    cloud(90, 85, VIOLET, "STRIPE")
    pdf.set_font("Helvetica", "B", 13)
    pdf.set_text_color(*AMBER)
    pdf.set_xy(150, 70)
    pdf.multi_cell(120, 7, clean('"Don\'t say \'source\' anymore.\nSay \'payment_method\' now!"'), align="L")
    center_text("They rename things. They remove things. They don't call you.", 138, 13, color=MUTED, style="")
    page_num(n, TOTAL)

    # --- Slide 4: your app breaks ---
    newslide()
    center_text("Now your app breaks.", 16, 22)
    phone(80, 90, SKY, "YOUR\nAPP")
    boom(150, 88, s=1.4)
    center_text("It's still using the old rule. So it stops working - often in front of customers.", 138, 13, color=MUTED, style="")
    page_num(n, TOTAL)

    # --- Slide 5: fixing by hand is painful ---
    newslide()
    center_text("Fixing it by hand is slow and boring.", 16, 21)
    # a tired person: circle head + line body
    cx, cy = 90, 82
    pdf.set_fill_color(*FAINT)
    pdf.ellipse(cx - 10, cy - 26, 20, 20, style="F")
    pdf.set_draw_color(*FAINT); pdf.set_line_width(4)
    pdf.line(cx, cy - 6, cx, cy + 18)
    pdf.line(cx, cy + 2, cx - 12, cy + 12)
    pdf.line(cx, cy + 2, cx + 12, cy + 12)
    pdf.set_font("Helvetica", "B", 22); pdf.set_text_color(*CORAL)
    pdf.set_xy(120, 60); pdf.cell(0, 10, "Zzz... so many files")
    center_text("An engineer must hunt down every place that uses the old rule, in every project.", 138, 13, color=MUTED, style="")
    page_num(n, TOTAL)

    # --- Slide 6: meet keelcat ---
    newslide(CARD)
    cat(W/2, 62, s=1.5, col=ACCENT)
    center_text("Meet KeelCat.", 98, 30)
    center_text("A little robot cat that does the boring fixing for you.", 128, 14, color=MUTED, style="")
    page_num(n, TOTAL)

    # --- Slide 7: it watches ---
    newslide()
    center_text("1. It watches for changes.", 16, 22, color=ACCENT2)
    eye(90, 88, s=1.5)
    cloud(190, 86, VIOLET, "STRIPE")
    center_text("KeelCat reads the rule book (the changelog) so you don't have to.", 138, 13, color=MUTED, style="")
    page_num(n, TOTAL)

    # --- Slide 8: it fixes ---
    newslide()
    center_text("2. It fixes your code.", 16, 22, color=ACCENT2)
    wrench(90, 86, s=1.6)
    phone(180, 90, SKY, "YOUR\nAPP")
    center_text("It changes the old rule to the new rule everywhere, in every language.", 138, 13, color=MUTED, style="")
    page_num(n, TOTAL)

    # --- Slide 9: it checks ---
    newslide()
    center_text("3. It checks the fix works.", 16, 22, color=ACCENT2)
    check(W/2, 82, s=1.7)
    center_text("KeelCat tries the fix safely first, so it doesn't hand you something broken.", 132, 13, color=MUTED, style="")
    page_num(n, TOTAL)

    # --- Slide 10: it asks you ---
    newslide()
    center_text("4. It asks: 'Okay to use this fix?'", 16, 21, color=ACCENT2)
    # PR card
    pdf.set_fill_color(*CARD); pdf.set_draw_color(*LINE); pdf.set_line_width(0.5)
    pdf.rect(W/2 - 60, 55, 120, 46, style="DF", round_corners=True, corner_radius=4)
    pdf.set_font("Helvetica", "B", 13); pdf.set_text_color(*INK)
    pdf.set_xy(W/2 - 54, 62); pdf.cell(0, 6, "Fix: source -> payment_method")
    pdf.set_font("Helvetica", "", 10); pdf.set_text_color(*MUTED)
    pdf.set_xy(W/2 - 54, 72); pdf.cell(0, 5, "Pull request - ready for your review")
    pdf.set_fill_color(*ACCENT); pdf.rect(W/2 - 54, 84, 34, 11, style="F", round_corners=True, corner_radius=2)
    pdf.set_font("Helvetica", "B", 10); pdf.set_text_color(*WHITE)
    pdf.set_xy(W/2 - 54, 86.5); pdf.cell(34, 6, "Approve", align="C")
    center_text("You are always the boss. KeelCat never changes anything without your yes.", 118, 13, color=MUTED, style="")
    page_num(n, TOTAL)

    # --- Slide 11: you click yes ---
    newslide()
    center_text("You click yes. Done.", 24, 26)
    check(W/2, 80, s=1.9)
    center_text("What used to take hours now takes about a minute.", 122, 15, color=ACCENT2, style="B")
    page_num(n, TOTAL)

    # --- Slide 12: summary ---
    newslide(INK)
    cat(W/2, 46, s=1.2, col=ACCENT)
    center_text("KeelCat", 68, 30, color=WHITE)
    center_text("Your APIs change.  Your code keeps up.", 96, 17, color=(180,200,190), style="B")
    center_text("Watch  >  Fix  >  Check  >  You approve", 120, 13, color=(150,160,158), style="")
    page_num(n, TOTAL)

    pdf.output(out_path)
    print("WROTE", out_path)


if __name__ == "__main__":
    build_pro_doc(os.path.join(HERE, "PRODUCT.md"),
                  os.path.join(HERE, "KeelCat-Product-Overview.pdf"))
    build_simple_deck(os.path.join(HERE, "KeelCat-Explained-Simply.pdf"))
    print("DONE")
