#!/usr/bin/env python3
"""
KeelCat — iQOO Hackathon 2026 (City Battles) pitch deck generator.

Builds a phone-first, on-device 16:9 deck (KeelCat-iQOO-Hackathon-Deck.pptx)
tailored to the iQOO Hackathon: on-device NPU LLM, camera/voice, Office Kit,
and a realistic 30-hour build plan. Reuses the KeelCat brand (dark + lime),
with an iQOO amber accent touch.

Run:  python apisteward/docs/build_hackathon_deck.py
Needs: pip install python-pptx
"""

from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

# ---- Brand palette ---------------------------------------------------------
BG     = RGBColor(0x12, 0x14, 0x1A)   # deep near-black surface
CARD   = RGBColor(0x1B, 0x1E, 0x26)   # lifted card
ACCENT = RGBColor(0xA8, 0xFF, 0x53)   # KeelCat lime
IQOO   = RGBColor(0xF0, 0xB3, 0x1C)   # iQOO amber
INK    = RGBColor(0xF4, 0xF6, 0xF9)   # near-white text
MUTED  = RGBColor(0x9A, 0xA3, 0xB2)   # muted gray
FAINT  = RGBColor(0x66, 0x6C, 0x78)   # faint gray
ROSE   = RGBColor(0xFF, 0x6B, 0x7A)   # problem
FONT   = "Segoe UI"

EMU_W, EMU_H = Inches(13.333), Inches(7.5)

prs = Presentation()
prs.slide_width = EMU_W
prs.slide_height = EMU_H
BLANK = prs.slide_layouts[6]


# ---- Helpers ---------------------------------------------------------------
def slide():
    s = prs.slides.add_slide(BLANK)
    bg = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, EMU_W, EMU_H)
    bg.fill.solid(); bg.fill.fore_color.rgb = BG
    bg.line.fill.background()
    bg.shadow.inherit = False
    sp = bg._element
    sp.getparent().remove(sp)
    s.shapes._spTree.insert(2, sp)
    return s


def _set(p, text, size, color, bold=False, italic=False):
    p.text = text
    for r in p.runs:
        r.font.size = Pt(size); r.font.color.rgb = color
        r.font.bold = bold; r.font.italic = italic; r.font.name = FONT


def textbox(s, x, y, w, h, anchor=MSO_ANCHOR.TOP):
    tb = s.shapes.add_textbox(x, y, w, h)
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    return tf


def rect(s, x, y, w, h, fill=CARD, line=None):
    shp = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    shp.fill.solid(); shp.fill.fore_color.rgb = fill
    if line is None:
        shp.line.fill.background()
    else:
        shp.line.color.rgb = line; shp.line.width = Pt(1)
    shp.shadow.inherit = False
    try:
        shp.adjustments[0] = 0.06
    except Exception:
        pass
    return shp


def eyebrow(s, text, x=Inches(0.7), y=Inches(0.55), color=ACCENT):
    tf = textbox(s, x, y, Inches(11), Inches(0.4))
    _set(tf.paragraphs[0], text.upper(), 12, color, bold=True)


def title(s, text, x=Inches(0.7), y=Inches(0.95), size=34, w=Inches(11.9)):
    tf = textbox(s, x, y, w, Inches(1.2))
    _set(tf.paragraphs[0], text, size, INK, bold=True)
    return tf


def bullets(s, items, x=Inches(0.7), y=Inches(2.1), w=Inches(11.9), size=18, gap=10):
    tf = textbox(s, x, y, w, Inches(4.6))
    for i, (head, body) in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(gap)
        run = p.add_run(); run.text = "\u25b8  "
        run.font.size = Pt(size); run.font.color.rgb = ACCENT; run.font.bold = True; run.font.name = FONT
        run = p.add_run(); run.text = head
        run.font.size = Pt(size); run.font.color.rgb = INK; run.font.bold = True; run.font.name = FONT
        if body:
            run = p.add_run(); run.text = "  \u2014  " + body
            run.font.size = Pt(size); run.font.color.rgb = MUTED; run.font.name = FONT
    return tf


def footer(s, page):
    tf = textbox(s, Inches(0.7), Inches(7.02), Inches(12), Inches(0.35))
    p = tf.paragraphs[0]
    r = p.add_run(); r.text = "KeelCat"; r.font.size = Pt(10); r.font.bold = True; r.font.color.rgb = ACCENT; r.font.name = FONT
    r = p.add_run(); r.text = "   \u00b7   iQOO Hackathon 2026 \u00b7 Developer Tools"; r.font.size = Pt(10); r.font.color.rgb = FAINT; r.font.name = FONT
    t2 = textbox(s, Inches(12.2), Inches(7.02), Inches(0.9), Inches(0.35))
    _set(t2.paragraphs[0], str(page), 10, FAINT); t2.paragraphs[0].alignment = PP_ALIGN.RIGHT


# ---- 1. Title -------------------------------------------------------------
s = slide()
rect(s, Inches(0.7), Inches(2.15), Inches(0.14), Inches(2.4), fill=ACCENT)
tf = textbox(s, Inches(1.05), Inches(2.0), Inches(11), Inches(1.2))
_set(tf.paragraphs[0], "KeelCat", 60, INK, bold=True)
tf = textbox(s, Inches(1.05), Inches(3.3), Inches(11.6), Inches(1.0))
_set(tf.paragraphs[0], "On-device API guardian \u2014 from your phone.", 26, ACCENT, bold=True)
tf = textbox(s, Inches(1.05), Inches(4.15), Inches(11.3), Inches(1.1))
_set(tf.paragraphs[0],
     "Point your iQOO at any API changelog. A local model on the NPU finds what breaks\n"
     "in your code, drives your laptop over Office Kit to fix it, and opens a pull request.",
     16, MUTED)
tf = textbox(s, Inches(1.05), Inches(6.4), Inches(11.8), Inches(0.6))
p = tf.paragraphs[0]
r = p.add_run(); r.text = "Vinod & Srushti"; r.font.size = Pt(14); r.font.bold = True; r.font.color.rgb = INK; r.font.name = FONT
r = p.add_run(); r.text = "     \u00b7     Track: Developer Tools     \u00b7     Live web product: keelcat.in"
r.font.size = Pt(14); r.font.color.rgb = FAINT; r.font.name = FONT

# ---- 2. Problem -----------------------------------------------------------
s = slide(); eyebrow(s, "The problem"); title(s, "APIs break your code silently \u2014 in production")
bullets(s, [
    ("Every app runs on third-party APIs", "Stripe, OpenAI, Twilio, and internal services."),
    ("They change constantly", "a field renamed, a method removed, an endpoint deprecated."),
    ("You find out when it breaks", "usually in production, for a customer, at the worst time."),
    ("The fix is a manual fire drill", "hunt every call site across every repo, and rewrite by hand."),
])
rect(s, Inches(0.7), Inches(5.55), Inches(11.9), Inches(1.15), fill=CARD)
for i, (num, label) in enumerate([("~40%", "of integration failures come from\nunmanaged API changes"),
                                  ("15\u201320 hrs", "of emergency engineering\nper incident"),
                                  ("~90 days", "AI API deprecation cycle \u2014\nand shrinking")]):
    tf = textbox(s, Inches(0.9) + Inches(3.95) * i, Inches(5.62), Inches(3.8), Inches(1.0), anchor=MSO_ANCHOR.MIDDLE)
    _set(tf.paragraphs[0], num, 24, ACCENT, bold=True)
    p = tf.add_paragraph(); _set(p, label, 11, MUTED)
footer(s, 2)

# ---- 3. What exists today -------------------------------------------------
s = slide(); eyebrow(s, "What we've already built"); title(s, "A proven pipeline \u2014 live today at keelcat.in")
bullets(s, [
    ("Watch \u2192 Understand \u2192 Fix \u2192 Verify \u2192 PR", "detects breaking changes, rewrites affected code, opens a reviewable GitHub PR. Never auto-merges."),
    ("Shipped end-to-end", "multi-tenant SaaS, GitHub/Google/guest login, sandbox verification, Razorpay billing."),
    ("In the market", "two teams testing; first paying user."),
], y=Inches(2.1), gap=14)
rect(s, Inches(0.7), Inches(5.35), Inches(11.9), Inches(1.35), fill=CARD, line=IQOO)
tf = textbox(s, Inches(0.95), Inches(5.5), Inches(11.4), Inches(1.05), anchor=MSO_ANCHOR.MIDDLE)
p = tf.paragraphs[0]
r = p.add_run(); r.text = "The gap: "; r.font.size = Pt(15); r.font.bold = True; r.font.color.rgb = IQOO; r.font.name = FONT
r = p.add_run(); r.text = ("today it needs an external LLM API key and cloud compute to parse changelogs \u2014 "
                           "so your code context leaves the machine, and you're tied to a PC + the cloud.")
r.font.size = Pt(15); r.font.color.rgb = INK; r.font.name = FONT
footer(s, 3)

# ---- 4. The hackathon idea ------------------------------------------------
s = slide(); eyebrow(s, "Our hackathon build", color=IQOO); title(s, "Phone-first KeelCat \u2014 the intelligence moves on-device")
bullets(s, [
    ("Bring the core onto the iQOO", "a small local open-source model (Gemma / Llama 3.2) runs on the Snapdragon NPU."),
    ("Parse changelogs on-device", "no external API key, nothing sent to the cloud \u2014 private and efficient."),
    ("Office Kit is the bridge", "the phone drives the laptop repo when heavier compute is needed."),
    ("Run it anywhere", "trigger a fix from your phone on a tea break \u2014 no PC or cloud required."),
], y=Inches(2.1), gap=14)
tf = textbox(s, Inches(0.7), Inches(6.1), Inches(11.9), Inches(0.6))
_set(tf.paragraphs[0], "The phone becomes the brain; the laptop just holds the code.", 17, ACCENT, bold=True, italic=True)
footer(s, 4)

# ---- 5. How it works on the phone -----------------------------------------
s = slide(); eyebrow(s, "How it works"); title(s, "Four taps, on the phone")
steps = [("1. Capture", "Point the camera at a changelog or deprecation warning. On-device OCR + local LLM \u2192 structured change-set."),
         ("2. Understand", "Ask by voice: \u201cwhat in Stripe v12 breaks my checkout?\u201d \u2014 get a spoken impact summary."),
         ("3. Fix", "Over Office Kit, the phone drives the laptop: scan repo, apply fix, verify."),
         ("4. Review", "The fix lands as a swipeable PR preview. Approve \u2192 opens a real GitHub PR.")]
for i, (h, b) in enumerate(steps):
    col = i % 2; row = i // 2
    x = Inches(0.7) + Inches(6.05) * col; y = Inches(2.2) + Inches(2.05) * row
    rect(s, x, y, Inches(5.8), Inches(1.8))
    tf = textbox(s, x + Inches(0.3), y + Inches(0.2), Inches(5.2), Inches(1.5))
    _set(tf.paragraphs[0], h, 18, ACCENT, bold=True)
    p = tf.add_paragraph(); p.space_before = Pt(6); _set(p, b, 13, MUTED)
footer(s, 5)

# ---- 6. Why it fits iQOO --------------------------------------------------
s = slide(); eyebrow(s, "Why on-device \u00b7 why iQOO", color=IQOO); title(s, "A real reason to run local, not cloud")
bullets(s, [
    ("Privacy", "proprietary code and internal changelogs never leave the device."),
    ("No API keys, no bill", "on-device inference replaces the external LLM the web version needs."),
    ("Offline & portable", "works without connectivity; the developer's phone is always with them."),
    ("Creative phone use", "camera capture, voice queries, and NPU inference \u2014 not a bolt-on."),
    ("Office Kit as the spine", "the phone-to-laptop bridge is core to the fix loop, incl. Red Light (phone-only)."),
], y=Inches(2.05), gap=11, size=17)
footer(s, 6)

# ---- 7. 30-hour build plan ------------------------------------------------
s = slide(); eyebrow(s, "The 30-hour plan"); title(s, "What we'll ship at the battle")
rect(s, Inches(0.7), Inches(2.15), Inches(5.8), Inches(3.6), fill=CARD, line=ACCENT)
tf = textbox(s, Inches(0.95), Inches(2.3), Inches(5.3), Inches(3.3))
_set(tf.paragraphs[0], "Core MVP", 18, ACCENT, bold=True)
for b in ["Android app on the iQOO device",
          "Camera + OCR capture of a changelog",
          "Local LLM on NPU \u2192 structured change-set",
          "Voice query \u2192 spoken impact summary",
          "Office Kit \u2192 scan repo, show diff on phone",
          "Swipe-to-approve \u2192 opens a real GitHub PR"]:
    p = tf.add_paragraph(); p.space_before = Pt(7)
    r = p.add_run(); r.text = "\u2713  "; r.font.size = Pt(13); r.font.bold = True; r.font.color.rgb = ACCENT; r.font.name = FONT
    r = p.add_run(); r.text = b; r.font.size = Pt(13); r.font.color.rgb = INK; r.font.name = FONT
rect(s, Inches(6.75), Inches(2.15), Inches(5.85), Inches(3.6), fill=CARD)
tf = textbox(s, Inches(7.0), Inches(2.3), Inches(5.35), Inches(3.3))
_set(tf.paragraphs[0], "Stretch", 18, IQOO, bold=True)
for b in ["Multi-file fixes across the repo",
          "Security-scan pass on the same capture",
          "Offline changelog library cached on-device",
          "Fallback to cloud only if a model can't fit"]:
    p = tf.add_paragraph(); p.space_before = Pt(7)
    r = p.add_run(); r.text = "\u2192  "; r.font.size = Pt(13); r.font.bold = True; r.font.color.rgb = IQOO; r.font.name = FONT
    r = p.add_run(); r.text = b; r.font.size = Pt(13); r.font.color.rgb = MUTED; r.font.name = FONT
tf = textbox(s, Inches(0.7), Inches(6.0), Inches(11.9), Inches(0.6))
_set(tf.paragraphs[0], "Demo on one real, well-known API version bump against a sample repo.", 15, ACCENT, bold=True)
footer(s, 7)

# ---- 8. Tech stack --------------------------------------------------------
s = slide(); eyebrow(s, "Tech stack"); title(s, "How we build it")
cards = [("On-device AI", "Gemma / Llama 3.2 (quantized) on the Snapdragon NPU via MediaPipe LLM Inference / llama.cpp / MLC."),
         ("Vision & voice", "On-device OCR (ML Kit) for changelog capture; speech-to-text + text-to-speech for voice."),
         ("Bridge", "Office Kit \u2014 screen mirror, clipboard, file transfer, remote control between phone and laptop."),
         ("Code engine", "AST-aware scan + deterministic edits (LLM fallback), sandbox verify, GitHub PR \u2014 KeelCat's proven pipeline.")]
for i, (h, b) in enumerate(cards):
    col = i % 2; row = i // 2
    x = Inches(0.7) + Inches(6.05) * col; y = Inches(2.2) + Inches(2.05) * row
    rect(s, x, y, Inches(5.8), Inches(1.8))
    tf = textbox(s, x + Inches(0.3), y + Inches(0.2), Inches(5.2), Inches(1.5))
    _set(tf.paragraphs[0], h, 17, ACCENT, bold=True)
    p = tf.add_paragraph(); p.space_before = Pt(6); _set(p, b, 13, MUTED)
footer(s, 8)

# ---- 9. Team / why us -----------------------------------------------------
s = slide(); eyebrow(s, "Why us"); title(s, "We lived this problem")
tf = textbox(s, Inches(0.7), Inches(2.05), Inches(11.9), Inches(1.6))
_set(tf.paragraphs[0],
     "\u201cAs an intern, a missed changelog took our app down. I shipped 35 pull requests in 9 hours to fix every broken call site by hand.\u201d",
     20, INK, bold=True, italic=True)
tf = textbox(s, Inches(0.7), Inches(3.7), Inches(11.9), Inches(0.7))
_set(tf.paragraphs[0], "That night is why KeelCat exists \u2014 it should have been one reviewed PR, opened automatically.", 15, MUTED)
people = [("Vinod", "Builds the full stack \u2014 detection, fix engine, infra. Startups since 17; hardware, drones, ESP32, and autonomous-systems background."),
          ("Srushti", "Co-founder, full-time on KeelCat. Engineering classmates since 2022 (~4 years building together).")]
for i, (name, bio) in enumerate(people):
    y = Inches(4.5) + Inches(1.15) * i
    rect(s, Inches(0.7), y, Inches(11.9), Inches(1.0), fill=CARD)
    tf = textbox(s, Inches(1.0), y + Inches(0.12), Inches(11.3), Inches(0.8), anchor=MSO_ANCHOR.MIDDLE)
    p = tf.paragraphs[0]
    r = p.add_run(); r.text = name + "   "; r.font.size = Pt(16); r.font.bold = True; r.font.color.rgb = ACCENT; r.font.name = FONT
    r = p.add_run(); r.text = bio; r.font.size = Pt(13); r.font.color.rgb = MUTED; r.font.name = FONT
footer(s, 9)

# ---- 10. Close ------------------------------------------------------------
s = slide()
rect(s, Inches(0.7), Inches(2.2), Inches(0.14), Inches(3.0), fill=ACCENT)
tf = textbox(s, Inches(1.05), Inches(2.15), Inches(11.4), Inches(1.0))
_set(tf.paragraphs[0], "API maintenance, in your pocket", 34, INK, bold=True)
bullets(s, [
    ("The build", "a phone-first, on-device version of a product that already works in the cloud."),
    ("The edge", "local NPU inference makes it private, offline, and free of API keys."),
    ("The vision", "keep the world's code working as the APIs beneath it change \u2014 from anywhere."),
], x=Inches(1.05), y=Inches(3.3), gap=14)
tf = textbox(s, Inches(1.05), Inches(6.3), Inches(11.5), Inches(0.6))
p = tf.paragraphs[0]
r = p.add_run(); r.text = "keelcat.in"; r.font.size = Pt(16); r.font.bold = True; r.font.color.rgb = ACCENT; r.font.name = FONT
r = p.add_run(); r.text = "     \u00b7     Vinod & Srushti     \u00b7     On-device API guardian, from your phone."
r.font.size = Pt(14); r.font.color.rgb = MUTED; r.font.name = FONT

out = __file__.replace("build_hackathon_deck.py", "KeelCat-iQOO-Hackathon-Deck.pptx")
prs.save(out)
print("Saved:", out, "-", len(prs.slides._sldIdLst), "slides")
