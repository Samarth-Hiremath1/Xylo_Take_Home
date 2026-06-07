# Data Analysis — Emails ↔ CRM (pre-build, no reconciliation logic yet)

Source: `data/crm_export.csv` (15 rows) and `data/emails/email_01..14.txt` (14 emails).
Purpose: understand the real mess before designing the matching strategy.

---

## 1. The CRM export

Columns: `client_id, name, company, email, phone, status, last_contact, value, notes`
15 data rows (`client_id` 1001–1015), plus one trailing blank line.

### Field-by-field dirtiness

| Field | Fill rate | State | Notes |
|---|---|---|---|
| `client_id` | 15/15 | **Clean** | Sequential ints, unique. Reliable primary key — but **never referenced in any email**, so it's the *join target*, never a *match signal*. |
| `name` | 13/15 | **Dirty** | No consistent form: full ("Marcy Holt"), first-only ("Tina", "Mike", "Greg"), initial+last ("J. Park"), first+initial ("Dwight S"). **Blank for 1006 and 1013** (anonymous rows). |
| `company` | 11/15 | **Dirty** | Blank for 1001, 1006, 1007, 1013. Free text with `&`, `'s`, "and Sons". |
| `email` | **14/15** | **Cleanest usable key** | All lowercase, all valid-looking. **Blank only for 1005 (Tom Becker).** Mix of corporate domains and free webmail (see below). |
| `phone` | **4/15** | **Sparse + inconsistent** | Only 1002, 1003, 1005, 1015. Formats: `(952) 555-0177`, `651-555-0148`, `612-555-0193`, `218-555-0102`. Needs digit-normalization. |
| `status` | 15/15 | **Dirty vocab** | No controlled set: `active`, `Active`, `prospect`, `negotiating`, `new`, `churned?`, `onboarding`, `lead`, `inactive`. Inconsistent casing; `churned?` literally encodes uncertainty with a `?`. |
| `last_contact` | 9/15 | **Very dirty dates** | **6 distinct formats** + blanks: `2024-04-02` (ISO), `4/29/2024` (M/D/YYYY), `05/01/24` (MM/DD/YY), `Apr 10 2024` (text month), `2024/04/22` (slash-ISO), `4-25-2024` (M-D-YYYY). Blank for 1003, 1005, 1009, 1012, 1013, 1014. |
| `value` | 4/15 | Sparse | Plain ints (`2400`, `6500`, `3200`, `1800`), no symbols/commas. Note: email_02 writes the same figure as "2,400" — formatting differs from CRM. |
| `notes` | ~11/15 | **Rich free text** | Best corroboration signal, worst as a key. Embeds semi-structured data: EIN `47-1839204`, account names ("Hendricks acct"), referrer ("Sandra Liu"), payment method ("via zelle"), deadlines ("oct extension"). **Gotcha: row 1009's notes is a single space `" "` — looks blank but isn't an empty string.** |

### Email-domain texture (matters for matching)
- **Corporate domains (encode the company):** delgadohvac.net, brightpathbooks.com, stellaroofing.com, kapooraccounting.com, twincitiesflooring.com, whitakeragency.com, gregsautobody.biz, olsonandsons.com.
- **Free webmail (domain tells you nothing):** gmail (1001, 1007, **1008** — corporate-feeling `c.morales.contracting@gmail.com` is still gmail), outlook (1004), yahoo (1013), protonmail (1006). → Domain→company inference fails for ~6 rows.

---

## 2. The emails

### Format messiness
- **`From:` header has 3+ shapes**, often with junk display names:
  - bare address, no brackets: `tina@brightpathbooks.com`, `angryclient@protonmail.com`, `dwight.s@stellaroofing.com`, `newlead2024@yahoo.com`
  - `name <addr>`: `marcy h <...>`, `jpark <...>`, `greg <...>`, `mike <...>`, `priya.k <...>`, `carlos m <...>`
  - quoted "Last, First": `"Delgado, Ray" <...>`, `"Whitaker, Joan" <...>`, `"Bev" <...>`
  - Display names are inconsistent (full name, first-only, lowercase handle, "Last, First").
- **Subjects** range from empty (email_04) → reply chains (`re:`, `RE:`, `Re: Re: Re:`) → ALL-CAPS urgency → vague one-word (`hello`, `cancel`, `complaint`, `payment`).
- **Bodies**: lowercase, missing punctuation, typos, emoji/"lol", run-ons, a **forwarded block** (email_08 `---------- Forwarded message ----------`), inconsistent/absent signatures. Phone embedded in body (email_03: `651-555-0148`). **Obfuscated** contact info (email_05: `tom.becker at beckerroofing dot com`, `612 555 0193`).

### Intent range (all 14)
| # | Sender | Intent | Urgency signal |
|---|---|---|---|
| 01 | Marcy | Status chase + frustration ("2nd time", "where's my paperwork") | escalating, no hard date |
| 02 | Ray Delgado | **Invoice dispute** (2400 vs 2850) + payment-method Q (ACH?) | medium |
| 03 | Tina | **Doc pull on a hard deadline** (Q2 numbers for 3pm call *today*) | **today** |
| 04 | J. Park | Proposal follow-up + **reschedule start** (June→July) | low |
| 05 | **Sandra Liu** | **3rd-party referral** of a new client (Tom Becker) | "this week" |
| 06 | anon | **Complaint / double-charge + churn threat** ("dispute with my bank") | **Friday** |
| 07 | Bev | Doc-not-received check-in (friendly, low) | "no rush" |
| 08 | Carlos | Doc submission for **loan package** (P&L, BS, returns) | EOW |
| 09 | Dwight | **Meeting reschedule/cancel** (not Thu; Mon/Tue) | scheduling |
| 10 | Priya | **Onboarding blocker** (EIN field error) + provides EIN | medium |
| 11 | Mike | **Payment notification** (zelle) + report-timing Q | low |
| 12 | Joan | **Records request** (5-yr loss run, Hendricks acct) | medium, recurring |
| 13 | anon | **New lead / pricing** (dental, 2 locations, ~1yr behind) | low |
| 14 | Greg | New-client takeover before **Oct extension** deadline | Oct |

Intent families: billing/payment (02, 06, 11), document request/submission (03, 07, 08, 12), scheduling (04, 09), onboarding/leads (05, 10, 13, 14), complaints/follow-ups (01, 06, 07).

---

## 3. Matching difficulty — the core question

**Bottom line: 13 of 14 emails match a CRM row by exact, case-insensitive `From`-address == `email`. Exactly one breaks, and one CRM row has no email at all.**

### The 13 easy ones
Sender address equals a CRM `email` verbatim once lowercased. Several are *corroborated* by a second signal already sitting in the CRM, which is a gift for confidence scoring:
- 02 Ray → 1002, and his disputed "2,400" == CRM `value` 2400 + note "invoice dispute open".
- 03 Tina → 1003, and the cell `651-555-0148` in the body == CRM `phone`.
- 04 J. Park → 1004, "push to july" == note "wants july start".
- 06 anon → 1006, "charged twice" == note "double charge complaint".
- 10 Priya → 1010, "EIN 47-1839204" == note EIN.
- 12 Joan → 1012, "Hendricks account" == note "Hendricks acct".

### The 1 hard one — email_05 (the real test)
This is where a naive sender-email join collapses:
1. **Sender ≠ subject.** The `From` is `sliu@meridianadvisors.co` (Sandra Liu, a *referrer* who is **not in the CRM at all**). The email is *about* Tom Becker → row **1005**.
2. **Best key is missing.** Row 1005 (Tom Becker) has a **blank `email`** — there is nothing to join the strong key against.
3. **The email's email is obfuscated.** Body says `tom.becker at beckerroofing dot com` — must be de-obfuscated to `tom.becker@beckerroofing.com` before any address compare (and even then 1005 has no email to compare to).
4. **The rescue is the sparse key.** Body has `612 555 0193`; normalize to digits `6125550193` == CRM 1005 `phone` `612-555-0193`. Plus name "Tom Becker" + company "Becker Roofing" (→ corporate domain `beckerroofing.com`) + the CRM note literally reads **"referral from Sandra Liu, needs bookkeeping cleanup."** All four corroborate.
   → Right answer: match to 1005 at **medium** confidence, flagged for human review because the sender is a third party.

### The orphan CRM row — 1015 (Hank Olson)
No inbound email. `status: inactive`, note "no response in 5 months". The briefing should surface him as a *no-activity / re-engage* item, not drop him.

### Identifiers available, ranked
1. **Sender email** — strong, present for 13/14, but fails on referrals (05) and any blank-email CRM row (1005).
2. **Phone** — sparse (4/15) but **decisive for the one hard case**; needs digit-only normalization on both sides.
3. **Name** (From display name + signature) — inconsistent and **dangerous as a primary key**: CRM has first-only names ("Mike", "Tina", "Greg", "Dwight S") that would collide across a larger dataset. Useful only as corroboration.
4. **Company** (signature / body / corporate domain) — useful corroboration; useless for the ~6 webmail senders and 4 blank-company rows.
5. **`client_id`** — never appears in emails; join target only.

### Where matching will break (design against these)
- **Referral / third-party sender** (05): the human who sent it isn't the client.
- **Blank CRM `email`** (1005): the strongest key is unavailable for that row.
- **Webmail senders** (~6): domain carries no company signal.
- **First-name-only CRM names**: name-matching will collide at scale.
- **Anonymous rows** (1006, 1013): only email identifies them — match works, but there's no human-readable name to confirm against.
- **Obfuscated / in-body contact info** (05): must extract+normalize before comparing.
- **Pre-normalization required**: lowercase emails; strip phones to digits; parse 6 date formats; trim the `" "`-as-blank notes; normalize status casing.

---

## 4. Recommended matching strategy (to build next — not built yet)

A **tiered, confidence-scored** resolver rather than a single join:
1. **Normalize both sides first** (emails→lowercase; phones→digits; dates→ISO via tolerant multi-format parse; de-obfuscate "x at y dot com"/"a b c" phone runs; trim whitespace-only fields).
2. **Tier 1 — exact email match** → `high` confidence (covers 13/14).
3. **Tier 2 — phone match** (normalized) → `high` (rescues 1005).
4. **Tier 3 — name + company fuzzy** (and corporate-domain ↔ company) → `medium`.
5. **Sender-vs-subject check**: if the matched client's identity comes from the *body* rather than the *sender* (referral pattern), down-rank to `medium` and **flag for review**.
6. **No-match path**: emit as "unmatched — possible new lead" (none here, but 13 is a near-miss anonymous lead that *does* match by email).
7. **Reverse pass**: CRM rows with no inbound email (1015) become *no-activity* briefing items.
8. **LLM (Gemini) role**: structured field extraction from each email (intent, urgency, entities, requested action, deadline) + the fuzzy/ambiguous tie-breaks and the referral detection — deterministic exact/phone joins stay in plain code so they're cheap and auditable.

Expected outcome on this dataset: **14/14 emails resolved** (13 high, 1 medium-flagged) + **1 CRM no-activity item** = 15 briefing entries.
