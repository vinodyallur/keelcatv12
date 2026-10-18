# KeelCat — iQOO Hackathon 2026 Idea Submission

**Event:** iQOO Hackathon 2026 · City Battles (Reskilll)
**Track:** Developer Tools (primary) · Open Innovation (fallback)
**Team size:** Solo / up to 3
**Bucket:** Working Professional (adjust if student)

---

## One-liner
KeelCat is an on-device "API guardian" that lives on your iQOO phone: point it at any
API changelog, and a local open-source model finds what will break in your code, then
drives your laptop over Office Kit to fix it and open a pull request — fully private, works
offline, never auto-merges.

## The problem
Every app is built on third-party APIs (Stripe, OpenAI, Twilio, internal services). Those
APIs change constantly — AI APIs break roughly every 90 days — and unmanaged API changes
cause an estimated 40% of integration failures, each burning 15–20 engineering hours.
Today developers find out when production breaks, then scramble to trace every call site
and patch it by hand. The information they need (the changelog) and the code that breaks
sit in two different places, and nothing connects them.

## The solution (phone-first)
The phone becomes the brain; the laptop is just where the code lives.

1. **Capture** — Point the iQOO camera at a changelog, a release note, or a deprecation
   warning on any screen or page. On-device OCR + a local LLM turn it into a structured
   list of breaking changes (renamed methods, removed params, deprecations).
2. **Understand** — Ask by voice: "What in Stripe v12 breaks my checkout?" The on-device
   model answers and reads back the impact. No network call, no code or changelog leaves
   the device.
3. **Fix** — Over Office Kit, the phone drives the laptop that holds the repo: it scans the
   codebase for affected call sites, applies deterministic edits (LLM fallback for the
   ambiguous ones), and verifies the change.
4. **Review** — The proposed fix lands on the phone as a swipeable PR preview. Approve →
   KeelCat opens a real pull request. Reject → it's discarded. It never auto-merges.

## Why it fits iQOO City Battles
- **Local / open-source model at the core** (the stack nudge): Gemma or Llama 3.2 running
  on the Snapdragon NPU. Zero cloud dependency — a privacy win developers actually want,
  since proprietary code and internal changelogs never leave the device.
- **Creative phone use (15%)**: camera → OCR → on-device parsing; voice query + spoken
  impact summary; on-device inference on the NPU.
- **Office Kit (10%)**: the phone-to-laptop bridge is not a bolt-on — it's the spine of the
  fix workflow. Phone = analysis + control surface; laptop = code host. Works in Red Light
  (phone-only) end to end.
- **Technical depth (15%)**: on-device LLM inference, OCR pipeline, AST-aware code scanning
  and editing, git integration.
- **Impact (20%)**: a real, painful, universal developer problem with quantified cost.

## What we'll build in 30 hours (scoped MVP)
- Android app for the iQOO device: camera capture + OCR, on-device LLM (MediaPipe LLM
  Inference or llama.cpp / MLC) that extracts a structured change-set from a changelog.
- Voice query → on-device answer (speech-to-text + local model + text-to-speech).
- Office Kit flow: phone triggers a scan on the laptop repo, gets back affected files,
  shows the diff on the phone.
- Swipe-to-approve → opens a GitHub PR via the laptop.
- Demo on one real, well-known API changelog (e.g., a Stripe/OpenAI-style version bump)
  against a small sample repo.

Stretch (if time): multi-file fixes, a security-scan pass on the same capture, offline
"changelog library" cached on-device.

## Tech stack
- **On-device AI:** Gemma / Llama 3.2 (quantized) on the Snapdragon NPU via MediaPipe LLM
  Inference or llama.cpp / MLC-LLM.
- **Vision:** on-device OCR (ML Kit / Tesseract) for changelog capture.
- **Voice:** on-device speech-to-text + text-to-speech.
- **Bridge:** Office Kit (screen mirror, clipboard, file transfer, remote control) between
  phone and laptop.
- **Code engine (on laptop):** AST-aware scan + deterministic edits with LLM fallback,
  ephemeral verify, GitHub PR creation. (This is KeelCat's existing pipeline, invoked from
  the phone.)

## Why us
KeelCat already exists as a working product (live at keelcat.in, multi-tenant, GitHub/Google
login, real users testing it) — so we're not starting from a blank page, we're porting a
proven pipeline to a phone-native, on-device form. The origin story: as an intern, one missed
changelog took the app down, and I shipped 35 pull requests in 9 hours to recover. KeelCat is
the tool I wished existed that day.

---

## Notes / open decisions (not part of the submission text)
- Confirm the on-device model choice against what actually runs on the loaner iQOO's NPU.
- Confirm the exact idea-screening form fields; this doc is structured to cover the usual
  ones (problem / solution / track / stack / phone use / team).
- Student vs Working-Professional bucket: pick based on the team's status.

---

## FORM-READY FIELDS (Phase 1 submission — team leader submits)

**Idea title** (<200)
> KeelCat — on-device API guardian that catches breaking API changes and fixes your code from your phone

**Description** (<2000)
> KeelCat is an on-device API guardian for developers and teams who depend on third-party APIs (Stripe, OpenAI, Twilio, internal services). These break constantly — AI APIs roughly every 90 days — and unmanaged changes cause ~40% of integration failures, 15–20 hrs each to fix. Today the changelog and the code that breaks live in two places, and nothing connects them.
>
> The phone is the brain; the laptop just holds the code.
> 1) Capture — point the iQOO camera at any changelog, release note or deprecation warning. On-device OCR + a local open-source model (Gemma/Llama 3.2 on the Snapdragon NPU) extract a structured list of breaking changes.
> 2) Understand — ask by voice ("what in Stripe v12 breaks my checkout?"); the on-device model answers and reads back the impact. Nothing leaves the device — private and offline.
> 3) Fix — over Office Kit the phone drives the laptop: scans the repo for affected call sites, applies deterministic edits (LLM fallback for ambiguous ones), verifies.
> 4) Review — the fix appears on the phone as a swipeable PR preview. Approve to open a real pull request. It never auto-merges.
>
> Runs end to end in Red Light (phone-only) via Office Kit. We already run this pipeline as a live web product (keelcat.in); here we port it to a phone-native, on-device form.

**Prototype URL**
> https://keelcat.in

**Prior builds & hackathons**
> KeelCat is live in production (keelcat.in): multi-tenant SaaS with GitHub/Google login, per-user isolation, and Razorpay billing; two teams testing and a first paying user. Other shipped builds: a VTOL kamikaze drone, an ESP32 + Azure AI meeting assistant, and a free ATS resume builder (CLI + Streamlit + Chrome extension + web). Biomedical hardware currently in patenting. Building since age 17.

**What makes you and your team stand out**
> We've lived this exact problem. As an intern, one missed changelog took the app down and I shipped 35 pull requests in 9 hours to recover — KeelCat is the tool I wished existed that day. A deep systems + hardware background (drones, biomedical HW, ESP32) plus an already-shipped production SaaS means we can actually land an on-device inference + OCR + Office Kit control loop in 30 hours, not just mock it. Co-founders building together since 2022 (~4 years).

**Dropdowns — answer honestly:**
- Android proficiency: "Basic" (or "No Android experience" if neither has shipped an app).
- LLM proficiency: "Cloud APIs only" today (KeelCat uses OpenRouter). Upgrade only if a local model has actually been run on-device.

**Video walkthrough URL:** optional — skip unless one exists.
**Deck/document:** required — tailored phone-first one-pager PDF recommended (TODO).
