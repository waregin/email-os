# External Brain OS — Email Triage Rules

Email Service Module · Seed Data v1.0

Generated: May 2026 · Living document — update as agent learns


## 0. Identity & Inbox Structure

This document captures the triage logic for Reginald NeoWilliams's primary Gmail inbox (waregin88@gmail.com). Multiple addresses route into this inbox; each carries different handling rules.


### 0.1 Email Addresses

| Field | Value |
| --- | --- |
| waregin88@gmail.com | Primary address. Used for most personal, household, and project email. Default inbox. |
| warebec@gmail.com | Former primary. MIGRATION IN PROGRESS: any sender still using this address should be flagged for migration outreach. Label_1 in Gmail. Wind-down account. |
| reginald.a.z.neowilliams@gmail.com | Professional/resume address. LinkedIn, job applications. Label_71 in Gmail. |
| katsnreg@gmail.com | Shared address with husband (Kats). Currently used for WPCU credit union statements. May expand to other shared household items. Label_5375... in Gmail. |


### 0.2 General Principles

- Never delete emails except confirmed spam. Everything else gets archived.
- Primary trust requirement: Reginald must not miss anything critically important.
- Reginald does manual multi-pass triage daily plus a Sunday catch-up.
- Target: inbox under 10 emails most weeks.
- The agent's job is to produce a prioritized digest and recommend archive actions — not to act autonomously.

### 0.3 Priority Tiers

| Field | Value |
| --- | --- |
| T1 — Immediate | Surface at top of digest. Requires same-day attention or immediate awareness. Do not suppress even if sender seems familiar. |
| T2 — Action Required | Needs a deliberate action (payment, call, transfer, decision) but not necessarily today. |
| T3 — Summarized | Short digest summary is sufficient. Glance and archive. Show key numbers or facts. No follow-up expected. |
| T4 — Browse | Full content needed; email cannot be meaningfully summarized. Grouped by category in Browse panel. Newsletters, digests, community notifications. Read when convenient. |


## 1. Financial & Account Alerts

ℹ️  Reginald monitors transactions near-daily via spreadsheet. Statement emails are largely confirmatory, but key numbers must always be shown in the digest. Flag anything that looks anomalous.


### 1.1 Credit Card Statements

Rule: Surface in digest with balance, minimum payment, and due date. Default priority T3 (glance and archive) unless a number appears anomalous, in which case escalate to T2.


**Account-Specific Notes**

| Field | Value |
| --- | --- |
| Chase 0889 | In credit counseling. No new charges expected. Show: balance, minimum, due date. If minimum is higher than prior month or new charges appear, escalate to T2. |
| Care Credit | NOT in credit counseling. Reginald uses the statement email as a reminder to log in and adjust the payment amount. Treat as T2 — surface prominently. |
| PayPal Credit | In credit counseling. Treat same as Chase 0889. Glance and archive, show numbers. |
| WPCU Credit Card | Unclear if statement emails are received. If they arrive, treat as T3, show numbers. |


### 1.2 Loan & Mortgage Statements

| Field | Value |
| --- | --- |
| Chase — Subaru loan | T3. Glance and archive. Show balance and payment amount if present in email. |
| Mortgage | T3. Glance and archive. Show balance and payment amount if present. |


### 1.3 Bank Account Statements

| Field | Value |
| --- | --- |
| Chase 2341 (checking) | Dormant account — $50 balance, balance-drop alert already configured. Statement email is reflexive confirmation only. T3, no numbers need surfacing. |
| WPCU (multi-account statement) | Covers checking, two savings, HELOC (and formerly a car loan). Reginald monitors these accounts regularly. T3, glance and archive. |


### 1.4 PayPal — Money Received

| Field | Value |
| --- | --- |
| Default rule | Surface in digest with sender name and amount. Note that a transfer to WPCU checking is likely needed. |
| Escalation threshold | If sender is unknown OR amount is $50 or more: escalate to T1 — flag as potentially unexpected. |
| Known sender (e.g. Jesse Neubauer) | Likely routine (carpool cost-sharing, small purchases). Show in digest at T3 if under $50, T2 if $50+. |
| Hard problem note | Agent cannot know whether a payment was expected. When in doubt, surface it. User will self-dismiss if routine. |
| Trigger note | PayPal subject lines are counterintuitive. Money received emails say 'sent you' (e.g. 'Jesse Neubauer sent you $10.40 USD'). Do NOT match on 'received' — that word appears in outgoing confirmations ('We received your payment'). Always test subjectOrSnippetContainsAny triggers against real subject lines. |


### 1.5 PayPal — Money Sent Confirmations

Treat as T3. Show recipient and amount. No follow-up expected. Flag if amount is large (over $100) or recipient is unrecognized.

| Field | Value |
| --- | --- |
| Trigger | sender_domain: paypal.com, subjectOrSnippetContainsAny: 'received your' |
| Notes | Matches 'We received your Pay Monthly payment' and similar outgoing payment confirmations. Previously matched on 'your pay' but that was too broad — it also caught payment due reminders. |


### 1.6 PayPal — Payment Due Reminders

| Field | Value |
| --- | --- |
| Priority | T3 — informational. Autopays — no action required. |
| Trigger | sender_domain: paypal.com, subjectOrSnippetContainsAny: 'payment is due' |
| Digest format | PayPal payment due: {subject} |
| Notes | Covers Pay Monthly and Pay Later due date reminders. If a reminder unexpectedly requires action, use the followup flow from the T3 panel. |


## 2. Security & Account Alerts

ℹ️  The agent cannot know whether Reginald expected a given security event. Always surface. Never suppress. Reginald will self-dismiss if the event is expected.


### 2.1 Google Security Alerts

| Field | Value |
| --- | --- |
| Priority | T1 always — surface at top of digest regardless of apparent routine. |
| Digest format | Describe the specific action: 'New sign-in from [device/location]', 'App authorized: [app name]', 'Password changed', 'Recovery email activity'. |
| warebec as recovery email | Currently set as recovery email for waregin88. Flagged for removal (see Open Actions). Until removed, security alerts forwarded to warebec are duplicates — acknowledge but do not double-surface. |


### 2.2 Other Account Security Alerts

Same rule as Google: always T1. Always describe the specific action. Examples: login from new device, password reset, two-factor change, suspicious activity notice.


### 2.3 Service Policy / Data Change Notices

| Field | Value |
| --- | --- |
| Example | Atlassian data contribution settings change. |
| Rule | T2 if action is available or required (opt-in/opt-out, data export). T3 if purely informational. Describe the action clearly in digest. |
| Atlassian specifically | Reginald intends to abandon Atlassian tools. Export data action is pending (see Open Actions). Flag any further Atlassian emails until resolved. |


## 3. Home / Household Logistics

ℹ️  Rules in this section are intentionally sender-specific. Do not generalize across senders — different household services have different priority profiles.


### 3.1 Local Waste Services (LWS) — Holiday Delay Notices

| Field | Value |
| --- | --- |
| Priority | T3 — glance and archive. |
| Digest format | Surface with the delay details: 'LWS: trash pickup delayed one day for week of [date] due to [holiday].' |
| Notes | Pattern is predictable for major US holidays. Reginald has lived at this address for ~10 years and is familiar with the pattern. Still surface — do not suppress. |


### 3.2 AEP Ohio (Utility Provider)

| Field | Value |
| --- | --- |
| Marketing emails | Unsubscribed. If any slip through, surface in manual triage queue for user to handle. |
| Account / service notices | T3 — glance and archive. sender_domain: aepohio.com, subjectOrSnippetContainsAny: 'account'. Examples: bill ready, payment confirmations. Note: outage and restoration alerts come from aep-email.com (separate rules in Section 9.4), NOT aepohio.com. |
| Notes | The 'account' subject filter keeps the rule narrow — stray marketing or promotional emails that slip through fall to manual triage rather than being auto-classified. |


### 3.3 Veterinary — Northwest Animal Hospital

| Field | Value |
| --- | --- |
| Vaccine / appointment reminders | T2 — surface with due dates. Reginald is switching vets; these are relevant until the transition is complete. |
| Informational / new services | T3 — surface if content is actionable (e.g. new treatment options worth asking about at next appointment). |
| Notes | Soma is the dog. Future vet emails will come from a new provider once transition is complete; update sender rule at that time. |


### 3.4 Promo Codes & Discount Offers (All Senders)

| Field | Value |
| --- | --- |
| Rule | Surface promo code and expiry date (or 'no expiry') in digest. Flag for entry into promo code tracking system. |
| Expiring codes | Include expiry date prominently. Email should remain in inbox until code is logged in tracking system or expires. |
| Non-expiring codes | Same rule — tracking system is the canonical home, not the inbox. |
| Tracking system | Not yet built. See Open Actions. Agent should flag but not discard until system exists. |
| Example | Byers Imports/Costco Auto: 50% off parts/service/accessories, auth code 04621-0226-74448-2, expires 2026-08-16. Stays in inbox until logged. |


## 4. Automated System Reports

ℹ️  Currently only one active automated report: luckyBackup. A second report is planned but not yet functional; it will get its own rule when ready. Rules in this section are intentionally specific — do not generalize across senders.


### 4.1 luckyBackup Daily Backup Report

| Field | Value |
| --- | --- |
| Sender | Self-sent: waregin88@gmail.com → waregin88@gmail.com |
| Subject pattern | 'luckyBackup report' |
| Cadence | Daily at midnight |
| Attachment | Always includes a .log file |
| Errors = 0 | T3. One-line digest entry: 'Backup: OK [date].' Confirm via digest (same as all T3 items). |
| Errors > 0, first occurrence | T2. Surface in digest with error count. Note self-resolution is possible on next run. Flag to check next day's report. |
| Errors > 0, second consecutive day | T2. Generate action item: 'luckyBackup has failed 2+ consecutive days — investigate.' |
| Report missing, first occurrence | T1. Note in digest: 'No backup report received for [date] — machine may not have been running.' |
| Report missing, second consecutive day | T1. Generate action item: 'Backup report missing 2+ consecutive days — investigate.' |
| Implementation note | Agent must maintain state for last N days of backup report outcomes (received/not received, error count). This state must not be designed away. |


## 5. Crowdfunding Updates

ℹ️  Crowdfunding is a high-volume category that warrants its own OS module in the future. Rules here are interim until that module exists. Reginald backs many projects; do not attempt to maintain a hardcoded campaign list.


### 5.1 General Rules

| Field | Value |
| --- | --- |
| Sources | BackerKit updates (sender_domain: s.backerkit.com), Kickstarter (sender_domain: kickstarter.com), BackerKit pre-launch (sender_domain: o.backerkit.com), BackerKit digital content (sender_domain: backerkit.com) |
| Default priority | T4 — read when convenient. Surface all updates; do not suppress any. |
| Reading order | Within a single campaign: chronological. When a creator has multiple active campaigns: chronological across all their campaigns, as context may carry over between updates. |
| Action items | If an update contains a survey, pledge change, address confirmation, or download: escalate to T2. Polls alone do NOT escalate — Reginald rarely votes but may choose to. |
| Digital content | T2. sender_domain: backerkit.com, subjectOrSnippetContainsAny: 'digital content'. Generate action item: download content and add to reading list. Note: uses the root backerkit.com domain, distinct from s.backerkit.com (updates) and o.backerkit.com (pre-launch). |
| Images | Full email content including images must be accessible. Digest is a navigation aid only — Reginald always reads the full original update. |
| Archive trigger | After reading. Not before. |
| Pre-launch / discovery emails | Separate rule TBD — not yet walked through. |


### 5.2 Known Creators & Campaigns (as of May 2026)

ℹ️  This list is illustrative, not exhaustive. The agent should group by creator, not maintain a fixed whitelist.

| Field | Value |
| --- | --- |
| The Bestiary / MorningStar999 | DND — Cute Critters! Volume 2 (BackerKit). Active poll: will-o'-wisp colorway (blue/blue vs purple/blue). |
| Kira | Two active Kickstarter campaigns: Winter Wonderland Kitty Trove pins, The Witch's Cat pins. Same creator — read updates together in chronological order. |
| Wraithmarked Creative | Hitchhiker's Guide to the Galaxy Omnibus (Kickstarter). |
| Kody Lukens | Stimagz Dubz — stress support fidget device (Kickstarter). |
| Phil Falco / Lifeline Comics | Rainbow LGBTQ Enamel Pins (Kickstarter). |
| Other BackerKit campaigns | Paranormal Pals plushies, Pride pins, Famous Animals science book, Monstie Pals plushies — creators TBD. |


## 6. Elicited Rules — Batch 2 (Re-grouped Inbox Scan)

ℹ️  These rules were elicited during a second structured session working through the full inbox after the initial seed rules were loaded. They cover groups A through D from the re-grouped inbox overview of 116 unmatched threads.


### 6A. WPCU Account Alerts (katsnreg address)

| Field | Value |
| --- | --- |
| Large withdrawal alert | T1. sender_domain: wpcu.coop, subjectOrSnippetContainsAny: 'withdrawal'. Fraud detection — T1 even when transaction is expected. Sent to katsnreg address. |
| Scheduled transfer complete | T3. sender_domain: wpcu.coop, subjectOrSnippetContainsAny: 'transfer'. Recurring scheduled transfer confirmations. Glance and archive. |
| SavvyMoney credit rating | T3. sender_domain: e.savvymoney.com. Credit rating update for Kats (Joshua), whose name is on the WPCU membership. Sent to katsnreg. Glance and archive. |
| WPCU eNewsletter | T3. sender_domain: info.wpcu.coop. Monthly newsletter. Sent to katsnreg. Glance and archive. |
| Payment due reminders | Rule TBD — handle when first example arrives. |


### 6B. Skool Community Notifications

| Field | Value |
| --- | --- |
| Arlan Hamilton communities | T4. subjectOrSnippetContainsAny: ['Your First $5k Club']. sender: noreply@skool.com. Matches Your First $5k Club w/ARLAN. Community name used as trigger rather than person name to avoid false positives. Additional Arlan communities can be added to patterns list. Skool emails matching neither community fall to manual triage. categoryLabel: Arlan Hamilton. |
| Premium Ghostwriting communities | T4. subjectOrSnippetContainsAny: ['Nicolas Cole', 'Ship 30 for 30', 'Ghostwriters Anonymous', 'Start Writing Online']. sender: noreply@skool.com. Covers Nicolas Cole's communities and partner communities. Some emails filtered at Gmail level. categoryLabel: Premium Ghostwriting. |
| Other Skool emails | Fall to manual triage — no blanket Skool rule. |
| Implementation note | subject_or_snippet_contains_any trigger does not currently support a sender constraint field — action item 11. Community name patterns are specific enough to avoid false positives in practice. |


### 6C. Newsletters — Regular Reads

| Field | Value |
| --- | --- |
| WTF Just Happened Today | T4. sender: matt@whatthefuckjusthappenedtoday.com. Daily political news digest. Current primary source for staying informed on current events. Opens with 'Today in one sentence' but the sentence is lengthy — full content needed. categoryLabel: WTFJHT. |
| Clearer Thinking | T4. sender_domain: info.clearerthinking.net. Mix of essays, workshop invitations, and study participation requests. All T4 — use followup flag on individual emails if action needed. |
| Healthy Gamer | T4. sender: hello@healthygamer.gg. Dr. K newsletter. Read when convenient. Note: support@guide.healthygamer.gg is a separate sender for purchase confirmations — different rule. |
| We're Here | T4. sender: werehere@mail.beehiiv.com. Personal/reflective newsletter with curated internet content. Full content engagement required: clicking through to read online and opening tabs for curated content. categoryLabel: We're Here. |


### 6D. Newsletters — Occasional / Civic

| Field | Value |
| --- | --- |
| ACLU | T3 default. sender_domain: aclu.org. Catches all ACLU addresses (aclu@aclu.org, 2xmatch@aclu.org, etc). Action emails with take-action buttons may warrant T2 — teach agent when encountered (Option D). Fundraising T3, case updates informational. |
| WWW Rise | T1. sender_domain: wwwrise.org. Tech worker organizing. T1 because calls to action are time-sensitive (solidarity calls, organizing moments). User may not always attend but wants immediate awareness. |
| Logic of Science | T4. subject_or_snippet_contains_any: 'Logic of Science'. Science/climate blog. Triggered on content rather than sender because emails arrive via WordPress comment-reply infrastructure. Future: match on mailing list header instead (action item 12). Other WordPress comment-reply emails are NOT covered — handle when real example arrives. |
| Honesty for Ohio Education | T4. sender_domain: honestyforohioeducation.org. Local education advocacy. Read when convenient. |
| Our City Our Say | T4 default. sender_domain: ourcityoursay.com. Local civic org. Signature collection requests may warrant T2 — teach agent when encountered (Option D). |
| Strawberry Comics | T4. sender_domain: strawberrycomics.com. Monthly bulletin. Read when convenient. |
| iNaturalist | T4. sender_domain: inaturalist.org. Biodiversity platform. Read when convenient. |


## 7. Elicited Rules — Batch 3 (Groups E–J)

ℹ️  Continuation of the re-grouped inbox elicitation session. These rules cover Groups E through J. T1-T4 tier naming adopted in this batch.


### 7A. Creator / Patreon Content (Group E)

| Field | Value |
| --- | --- |
| The Latest Kate | T2. sender: thelatestkate@creator.patreon.com. Art/illustration creator. T2 because user downloads a copy of all artwork per email — deliberate action required. |
| DarkMatter2525 | T4. sender: darkmatter2525@creator.patreon.com. categoryLabel: DarkMatter2525. Atheist/philosophy YouTube creator. Browse when convenient. |
| Ella's Arcanum Minis | T4. sender: ellasarcanumminis@creator.patreon.com. categoryLabel: Ella's Arcanum Minis. Miniature sculpting creator. Browse when convenient. |
| Patreon live streams | T4. sender_domain: live.patreon.com. categoryLabel: Patreon Live. Live stream notifications from any creator. Currently not of interest but kept for awareness. |
| Other Patreon creators | Fall to manual triage — no blanket creator.patreon.com rule. New creators handled via teaching chat. |


### 7B. Commerce / Retail Promotions (Group F)

| Field | Value |
| --- | --- |
| Squishable | T4. sender: hello@squishable.com. categoryLabel: Squishable. Browse for new products. |
| Big Blanket | T4. sender: snuggle@e.bigblanket.com. categoryLabel: Big Blanket. Note: promo code rule (T2) takes priority if email contains a code. |
| Jeni's Ice Cream | T4. sender: updates@jenis.com. categoryLabel: Jeni's Ice Cream. Use followup flag when placing an order. |
| Perks at Work | T4. sender: cs@perksatwork.com. categoryLabel: Perks at Work. JPMorgan Chase employee benefit platform. |
| Bad Dragon | T4. sender: newsletter@bad-dragon.com. categoryLabel: Bad Dragon. Adult toy retailer. |
| Costco Auto | Unsubscribed — two cars recently purchased, no need for car deal emails. |


### 7C. Humble Bundle (Group G)

| Field | Value |
| --- | --- |
| All Humble Bundle emails | T4. sender_domain: mailer.humblebundle.com. categoryLabel: Humble Bundle. Replaces agent-taught rule which used unreliable body content triggers — subject lines use creative marketing copy with no consistent pattern. Sender domain is the only reliable signal. |


### 7D. Steam Wishlist Sales (Group H)

| Field | Value |
| --- | --- |
| Wishlist sale alerts | T3. sender: noreply@steampowered.com, subjectOrSnippetContainsAny: 'on sale'. digestSummaryTemplate lists every game on sale with both sale price and discount percentage. Other Steam email types (security, purchases) handled by separate rules when encountered. |


### 7E. Kit / ConvertKit (Group I)

| Field | Value |
| --- | --- |
| Weekly analytics | T3. sender: help@convertkit.com. digestSummaryTemplate surfaces open rate, click rate, subscriber count for Rambling Reggie account. Legacy convertkit.com domain. |
| Product announcements | T4. sender: help@kit.com. categoryLabel: Kit. Feature updates and platform news. Watch for other email types from this sender that may need different handling. |


### 7F. Amazon (Group J)

| Field | Value |
| --- | --- |
| Return reminders | T2. sender: return@amazon.com. digestSummaryTemplate surfaces item name and return deadline. Note: Amazon sometimes issues refunds without requiring return — investigate if reminder arrives for already-refunded item. |
| Subscription updates | T3. sender: no-reply@amazon.com, subjectOrSnippetContainsAny: 'subscription'. Scoped to subscription emails only — other Amazon email types from this sender handled via teaching agent when examples arrive. |

### 7G. Order Confirmations / Receipts (Group K)

| Field | Value |
| --- | --- |
| Chewy | T3. sender_domain: chewy.com. Covers autoship delivered, autoship coming soon, and other Chewy notifications. Note: shipment tracking rule may also fire on delivery emails — Chewy rule takes priority. |
| Jeni's Ice Cream | T3. sender: contact@jenis.com. Order confirmation emails. Separate from promotional emails (updates@jenis.com — see Section 7B). T3 — glance and archive. |
| Good Store orders | T3. sender: hello@good.store, subjectOrSnippetContainsAny: 'order'. Order confirmations and upcoming subscription notices. |
| Good Store catch-all | T4. sender: hello@good.store (no subject constraint). Catch-all for any Good Store email not matched by the T3 order rule — promotional, loyalty, and miscellaneous. categoryLabel: Good Store. |
| Restaurant receipts | T3. sender_domain: toasttab.com. Restaurant receipts via Toast POS. Summarizer extracts restaurant name and total. |
| Grubhub | T3. sender_domain: eat.grubhub.com. Order confirmations. Summarizer extracts restaurant name and ETA. Note: order confirmation email missing for some orders — investigate. |
| DFTBA | Caught by warebec migration rule (T2) since orders sent to warebec address. Add separate DFTBA rule when migrated to waregin88. |


## 8. Elicited Rules — Batch 4 (Groups L–S + U)

ℹ️  Final batch of rules elicited from the re-grouped inbox scan. Covers Groups L through S and U.


### 8A. Financial New Senders (Group L)

| Field | Value |
| --- | --- |
| American Family Insurance | T3. sender: amfamonlinebilling@amfam.com, subjectOrSnippetContainsAny: 'payment'. Umbrella insurance payment confirmations. Scoped to billing sender so personal agent emails fall to training queue. Amount and description identify insurance type. |
| Shop Pay / Affirm | T3. sender: affirm-billing@shop.affirm.com, subjectOrSnippetContainsAny: 'autopay'. Shop Pay autopay reminders. All expected payments. Scoped to exact billing sender. |
| Other financial senders | No rules without examples. Teach agent when new senders arrive. |


### 8B. Subscription / Service Notifications (Group M)

| Field | Value |
| --- | --- |
| Spotify | T4. sender_domain: spotify.com. categoryLabel: Spotify. Policy updates and service notices. T4 — may affect app usage decisions. |
| GitHub invites | T2. sender: noreply@github.com, subjectOrSnippetContainsAny: 'invited'. Repository invitations require deliberate action (accept or decline). Other GitHub notification types taught when examples arrive. |
| Adobe / ebooks.com | Caught by warebec migration rule (T2) since sent to warebec address. |


### 8C. Health / Appointments (Group N)

| Field | Value |
| --- | --- |
| Appointment reminders (all senders) | T3. subject_contains: 'appointment reminder'. Catches reminders from any sender — Aetna, medical, dental, etc. T3 — informational since appointments are already in calendar. |
| Healthy Gamer Guide purchase | T2. sender_domain: guide.healthygamer.gg. Purchase confirmation includes gift link requiring followup action. Different sender from newsletter (hello@healthygamer.gg). |


### 8D. Civic / Local Events (Group O)

| Field | Value |
| --- | --- |
| Lynd Fruit Farm | T4. sender: info@lyndfruitfarm.com. categoryLabel: Lynd Fruit Farm. Local Columbus area farm market. User reads these. Honeycrisp apple picking season may warrant T1/T2 — add rule when example arrives. |
| Market research surveys | T3. subject_or_snippet_contains_any patterns: 'take our survey', 'share your feedback', 'tell us what you think', 'quick survey', 'survey request'. Does NOT apply to BackerKit or Kickstarter pledge fulfillment surveys. |


### 8E. StoryWorth — Family (Group P)

| Field | Value |
| --- | --- |
| Roger's stories | T4. sender: story@postman.storyworth.com, subjectOrSnippetContainsAny: 'Roger shared'. categoryLabel: StoryWorth — Dad. User reads every story. Some may prompt followup (e.g. adding books to reading list). |
| Upcoming question preview | T3. sender: hello@postman.storyworth.com, subjectOrSnippetContainsAny: 'Upcoming Storyworth'. Scoped to avoid catching other StoryWorth emails. digestSummaryTemplate: 'StoryWorth: this week Dad will be asked: {upcoming_question}'. |


### 8F. BackerKit Pre-launch / Discovery (Group Q)

| Field | Value |
| --- | --- |
| Pre-launch notifications | T4. sender_domain: o.backerkit.com. categoryLabel: BackerKit Pre-launch. Sender format is creator+[variable]@o.backerkit.com. Typically from creators already followed. User wants to read and possibly back the campaign. |


### 8G. Crowdfunding Surveys / Action-Required (Group R)

| Field | Value |
| --- | --- |
| Survey required | T2. sender: no-reply@s.backerkit.com, subjectOrSnippetContainsAny: 'Response Needed'. Action required to receive rewards. Distinct from market research surveys. |
| Survey confirmation | T3. sender: no-reply@s.backerkit.com, subjectOrSnippetContainsAny: 'Survey Confirmation'. financial_summary captures order total, credit remaining, or shipping status as available. |
| Other campaign updates | Caught by existing BackerKit updates rule (T4, categoryLabel: BackerKit Updates). |


### 8H. Miscellaneous One-offs (Group S)

| Field | Value |
| --- | --- |
| Medium weekly stats | T3. sender: noreply@medium.com, subjectOrSnippetContainsAny: 'stats'. Weekly writer stats for Rambling Reggie account. |
| Medium mentions | T4. sender: noreply@medium.com, subjectOrSnippetContainsAny: 'mentioned'. categoryLabel: Medium. Comment notifications from same sender are T2 — add rule when example arrives. |
| Cthulhu Dreamt | T4. sender_domain: quasirealhouse.com. categoryLabel: Cthulhu Dreamt. RPG announcement emails. Rule added from single example. |
| Big Blanket review requests | T4. sender_domain: okendo.io. categoryLabel: Big Blanket. Product review requests via Okendo platform. |
| Arlan Hamilton direct/newsletter | T4. sender: arlanhamilton@gmail.com AND sender_domain: f.stanmail.io with subjectOrSnippetContainsAny: 'Arlan'. categoryLabel: Arlan Hamilton for both. Same category as Skool community notifications. |
| GitHub invites | T2. See Group M. |


### 8I. Ohio BMV (Group U)

| Field | Value |
| --- | --- |
| Vehicle registration renewal | T2. sender: DoNotReplyVR@dps.ohio.gov. ~2 months lead time — T2 appropriate. Email arrives via BCC so toRecipients shows No-Reply@dps.ohio.gov — must trigger on sender, not address. Two vehicles currently registered. |


## 9. Agent-Taught Rules (Taught via Teaching Chat)

ℹ️  These rules were created through the teaching chat in the Email OS UI, not through the structured elicitation session. All were confirmed by the user before being saved. They represent the ongoing learning phase — after the initial seed rules are loaded, all new rules are expected to be taught this way.


### 9.1 Shipment Tracking

| Field | Value |
| --- | --- |
| Priority | T3 |
| Trigger | subject_or_snippet_contains_any: 'tracking number', 'tracking #', 'shipment', 'your order has shipped', 'on the way', 'scheduled delivery', 'estimated delivery', 'out for delivery', 'will arrive today', 'arriving today', 'arrives today' |
| Digest format | Shipment from {retailer_or_sender} · Tracking: {tracking_number} · Delivery: {delivery_date} · {delivery_window} |
| Notes | Tracking numbers may appear in subject or body. retailer_or_sender falls back to email sender name if no retailer is mentioned. Applies to any carrier or seller. If tracking number is not extractable, omit gracefully. Surface delivery window when available (e.g. 11am-3pm). |


### 9.2 USPS Informed Delivery

| Field | Value |
| --- | --- |
| Priority | T3 |
| Trigger | subject_contains: 'Your Mail Was Delivered' |
| Digest format | {subject} |
| Notes | Daily or near-daily USPS Informed Delivery notifications. Subject line contains the date and is sufficient as the full summary. Glance and archive. |


### 9.3 Humble Bundle — SUPERSEDED

| Field | Value |
| --- | --- |
| Priority | T4 |
| Trigger | subject_or_snippet_contains_any: 'book bundle', 'game bundle', 'software bundle', 'pay what you want', 'collection' |
| Digest format | Humble Bundle: {bundle_name_or_topic} |
| Notes | Bundle announcement emails. User reads these regardless — digest is navigation aid only. Subject line alone is not a reliable trigger; body content used. May expand to include non-bundle sales emails in future. |


### 9.4 AEP Ohio Outage & Restoration Alerts

| Field | Value |
| --- | --- |
| Priority | T1 for BOTH outage and restoration alerts |
| Outage trigger | sender_domain: aep-email.com, subjectOrSnippetContainsAny: 'outage' |
| Restoration trigger | sender_domain: aep-email.com, subjectOrSnippetContainsAny: 'restored' |
| Digest format | AEP Ohio: {subject} |
| Notes | Sender domain is aep-email.com — distinct from aepohio.com used for billing/account notices. Both alerts are T1 so they appear in the same panel and can be easily correlated. Rule designed with mobile use in mind — during a power outage, restoration alert should be immediately visible in the same place as the outage alert. Do not downgrade restoration to T2. |


## 10. Email OS — Client Architecture

ℹ️  This section documents the design decisions made during the triage rules session that expand scope beyond a triage rules engine into a full smart email client.


### 10.1 Revised Build Philosophy

Original plan: define triage rules first, then build an agent that applies them. Revised plan: build the client first, use the manual triage queue as the primary agent training interface. Rules defined in this session are seed data — the agent learns and refines rules through ongoing use. The manual triage session process IS the rules elicitation process, made continuous.


### 10.2 Three-Zone UI Layout

| Field | Value |
| --- | --- |
| Zone 1: Tiered digest panels | One collapsible panel per priority tier (T1-T4), shown at top. Each panel is a snapshot on open — does not auto-refresh while open. T1/T2: Per-item actions: (1) Confirm (wasCorrect=true, mark read, button disappears — row stays visible), (2) Done (wasCorrect=true if not set, mark read, archive — row disappears), (3) Misclassified (wasCorrect=false, back to inbox). Confirm All: wasCorrect=true, mark read for all unconfirmed in snapshot — does NOT archive. T3/T4: Per-item actions: (1) Confirm (wasCorrect=true, mark read, archive — row disappears), (2) Followup (wasCorrect=true, mark read, reclassify to T2, stays in Gmail inbox — row disappears), (3) Misclassified (wasCorrect=false, back to inbox). Confirm All: wasCorrect=true, mark read, archive for all in snapshot. No standalone followup panel — followup items fold into T2 with a userFlagged indicator. |
| Zone 2: Inbox / Manual triage queue | Emails not matched by any rule, plus emails flagged as misclassified. Labeled Inbox in UI. Each thread row has a Teach button. Teaching opens a chat panel — does not auto-open on misclassification; user initiates. Auto-refreshes continuously. |
| Zone 3: Followup | No longer a separate panel. Followup items fold into T2 with a userFlagged=true indicator. Flagging for followup means the agent was not wrong — the user is adding personal context the agent could not have. Repeatedly flagging a sender for followup may be a future signal to suggest a rule priority update. |


### 10.3 Core Interaction Model

| Field | Value |
| --- | --- |
| Read state | Opening an item in any panel marks it as read. Archive is a separate explicit action. |
| Confirm (T1/T2) | wasCorrect=true, mark read in Gmail, confirmedByUser=true. Does NOT archive. Button disappears after click — row stays visible showing read state. User completes action separately then clicks Done. |
| Done (T1/T2) | wasCorrect=true (if not already set), mark read (if unread), archive. Row disappears. No bulk Done button — deliberate per-item action by design. |
| Confirm (T3/T4) | wasCorrect=true, mark read, archive. Row disappears immediately. |
| Followup (T3/T4 only) | wasCorrect=true (agent was not wrong — user is adding context agent could not have). Mark read in Gmail. Reclassify decision to T2 locally with userFlagged=true indicator. Row disappears from T3/T4. Appears in T2 panel. Thread stays in Gmail inbox — not archived. |
| Confirm All | T1/T2: wasCorrect=true, mark read for all unconfirmed items in snapshot. Does not archive. T3/T4: wasCorrect=true, mark read, archive for all items in snapshot. Applies only to snapshot taken when panel was opened. |
| Misclassified | Moves item from digest panel back to inbox. Does not auto-open teaching chat. User initiates teaching when ready. |
| Teach button | Appears on each inbox thread row and at the bottom of the expanded thread view. Thread header is sticky while scrolling so top button always accessible. |
| Teaching flow | User opens teach chat, explains what to do and why. Agent asks clarifying questions one at a time, proposes a structured rule, user confirms. Agent searches for other threads where rule applies, user confirms scope, agent processes confirmed threads and closes chat. Threads leave inbox. |
| Followup flag | Moves item to Followup digest. Marks thread as read in Gmail (removes from unread count) but leaves it in Gmail inbox — not archived. User confirms (archives) from Followup panel when the followup action is complete. |
| Action items | Noted in digest. Future: feed into Task/TODO OS. V1: displayed as text. |
| Auto-archive | NOT a v1 feature. Possibly never. Agent never acts unilaterally. |


### 10.4 Teaching Chat — Agent Behavior

| Field | Value |
| --- | --- |
| Interface | Desktop: right-side panel alongside thread view. Mobile (future): bottom sheet over thread view. |
| Input style | Free-form conversation. Structured shortcuts may be added later as patterns emerge. |
| Agent role | Reasoning system. Asks clarifying questions one at a time. Proposes rules in structured form. Does not apply rules until user explicitly confirms. |
| Rule structure | Trigger (sender, subject pattern, label, content keyword) \| Action (priority tier, action item flag, followup flag) \| Priority (T1-T4) \| Digest summary template \| Notes/exceptions. |
| Misclassified auto-open | Off by default. Misclassified items sit in inbox waiting for user to initiate. Future setting to toggle auto-open when mistakes become rare. |
| Multi-user consideration | Auto-open on misclassification will be per-user configurable in future. |


### 10.5 Teaching Chat — System Prompt

The agent system prompt is assembled at runtime from a user profile object stored in the database. The context section is a variable — not hardcoded — to support multi-user use. The primary concern clause (never miss anything critically important) is considered universal and is hardcoded.


Rule structure proposed by agent: { trigger, action, priority (T1-T4), digestSummaryTemplate, notes }. Agent asks one clarifying question at a time. Does not propose a rule until intent is clear. Does not apply a rule until user explicitly confirms. After confirmation, searches for other matching threads and confirms scope before applying.


### 10.6 Technical Architecture (v1)

| Field | Value |
| --- | --- |
| Frontend | React + TypeScript, Vite, Tailwind. Served from localhost:5173. |
| Backend | Express + TypeScript. Served from localhost:3001. Proxied through Vite so all client API calls go to :5173. |
| Database | SQLite via Prisma. Single file on disk, no separate server. Near-mechanical migration to Postgres for multi-user future by changing one Prisma config line. |
| Database schema | User, TriageRule (trigger as JSON, source: manual\|agent), TriageDecision (threadId, ruleId, priority, confirmedByUser, wasCorrect, archivedAt — null until confirmed or manually archived, userFlagged — true when user explicitly flagged for followup overriding agent classification), UserProfile (key/value pairs for flexible user context). |
| Triage agent model | Anthropic API (claude-sonnet for teaching chat, claude-haiku for digest summarization). Both model endpoints are configurable env variables — swap to local model by changing one value. |
| Trigger types | subject_or_snippet_contains (checks both subject and snippet), sender_domain (endsWith matching for subdomain support), sender (exact address), self_sent, address. subjectOrSnippetContains is the secondary constraint field on sender/sender_domain/self_sent triggers — checks both subject and snippet. |
| Gmail API | Read + archive actions. OAuth via Google Cloud. Redirect URI: http://localhost:5173/auth/callback (Vite proxy). |
| Session | express-session, sameSite: lax, secure: false (dev). Cookie scoped to :5173 via Vite proxy. |
| Auth fix | Callback returns 200 + JS location.replace() instead of server redirect — prevents Chrome 115+ bounce tracking from dropping Set-Cookie. |
| Tab unread count | V1: document.title prefix (N) Email OS. Future: favicon badge. |
| Inbox panel | Shows only undecided threads (server-side: GET /api/gmail/threads?undecided=true loops Gmail pages until maxResults undecided threads accumulated). Inbox label shows count: 'Inbox (N)'. |
| T4 Browse panel | Categories collapsed by default. Category headers show item count: 'Squishable (3)'. User chooses which categories to expand. T4 rows show subject + snippet instead of digestSummary. |
| CachedMessage table | Added to schema — stores individual messages within a thread (FK to ThreadCache, cascade delete). Engine and agent populate it. GET /api/gmail/threads/:id checks cache first (< 1hr TTL). Decisions endpoint includes unreadCount and messageCount per thread. Digest rows show unread badge when unreadCount > 1. |
| Summarizer empty template guard | summarizer.ts returns empty string immediately if digestSummaryTemplate is empty or whitespace — no API call made. Prevents rate limit errors for T4 rules and avoids model asking for template clarification. |
| Object storage note | Future pre-SaaS: move htmlBody/plaintextBody from relational DB to object storage (S3/R2/GCS) keyed by message ID with lifecycle expiry. At SaaS scale (~150KB/email x 80 T4 emails/user/day) DB cost becomes significant. |
| Package manager | npm. Node.js v22 installed via NodeSource apt repo. |


### 10.7 Explicitly Out of Scope for v1

| Field | Value |
| --- | --- |
| Auto-archive | Not in v1. Possibly never. |
| Compose / send / reply | Read and archive only in v1. |
| Task OS integration | Future. Action items displayed as text in v1. |
| Gmail filter creation | Future. Existing Gmail filters respected but not modified. |
| Agent auto-learning without confirmation | Agent proposes, user confirms. Always. |
| Auto-open teaching chat on misclassification | Future setting. Off by default. |
| Crowdfunding OS module | Future. Email OS handles crowdfunding via rules until dedicated module exists. |
| Local model support | Architecture supports it (configurable endpoint) but not tested in v1. |
| Spam folder integration | Future feature. Surface Gmail Spam folder emails in Email OS so they can be reviewed and rules applied. May help catch legitimate emails misclassified by Gmail. |
| Replace Gmail filters | Future consideration. As Email OS rule coverage grows, existing Gmail filters may become redundant or conflicting. Eventually may wish to migrate filter logic entirely into Email OS and remove Gmail-side filters. |
| Rule editing UI | Nice-to-have rather than necessity. The teaching chat in the UI can already access and modify existing rules, including stopping a rule from matching a particular email. A formal rule editing UI would add convenience but is not blocking. |


## 11. Rules In Progress (Session Incomplete)

The following groups were identified in the inbox scan but not yet walked through. Rules will be added as the elicitation session continues. Note: given the revised build philosophy (client-first, train via manual queue), some of these may be better handled through live training rather than elicitation.


| Field | Value |
| --- | --- |
| Shipment tracking patterns | Chewy autoship delivered email not caught by current patterns — investigate subject line and add 'has been delivered' or similar to patterns if needed. |
| Rule coverage gaps | First round complete. Fixed: Atlassian (endsWith domain matching), Chase statement (subject too narrow), Spotify (sender→sender_domain), Lynd Fruit Farm (content-based trigger), StoryWorth (Re: Roger→Roger shared via snippet). subjectOrSnippetContainsAny renamed to subjectOrSnippetContains globally. Good Store consolidated to 2 rules (T3 order, T4 catch-all). Jeni order confirmation added. Remaining unmatched threads being worked through via training queue and new rules. |
| Medium comment notifications | T2 — add rule when first example arrives. Same sender as stats and mentions (noreply@medium.com). |
| DFTBA | Add rule when account migrated from warebec to waregin88. Currently caught by warebec migration rule (T2). |
| Grubhub delivery confirmation | May need separate rule from order confirmation if delivery emails come from different sender. |
| Other Patreon creators | No blanket rule — new creators taught via training queue as they appear. |
| Other Steam email types | Security, purchase confirmations, etc. — teach agent when examples arrive. |
| Other Amazon email types | Only subscription cancellation and return reminders covered — teach agent when examples arrive. |
| Other GitHub notification types | Only invites covered — teach agent when examples arrive. |
| Other Spotify email types | Only policy updates covered — teach agent when examples arrive. |
| Future automated report | A second self-sent automated report is planned but not yet functional — rule TBD when ready. |
| WordPress comment notifications | Hold until real example of a non-Logic-of-Science WordPress comment arrives. |
| Honeycrisp apple picking season | Lynd Fruit Farm emails become time-sensitive in fall — add T1/T2 rule when example arrives. |
| WPCU payment due reminders | No example seen yet — add rule when first example arrives. |
| Our City Our Say signature requests | Default T4, but signature collection emails may warrant T2 — teach agent when example arrives. |
| ACLU action emails | Default T3, but take-action emails may warrant T2 — teach agent when example arrives. |


ℹ️  All inbox groups A through U have been walked through. Initial rule elicitation is complete. Remaining items above are edge cases, future senders, or rules awaiting real examples. Ongoing rule learning happens via the teaching chat in the Email OS UI.


## 12. Session Handoff & Next Steps

ℹ️  This section documents the state of the project at the end of this Claude session so a new session can continue without losing context.


### 12.1 Current State

| Field | Value |
| --- | --- |
| Rules in DB | 83 seed rules plus any agent-taught rules added during use. Primary trigger types: subject_or_snippet_contains_any, subject_or_snippet_contains_all, sender_domain, sender, self_sent, address. Secondary filter fields on sender/sender_domain/self_sent triggers are subjectOrSnippetContainsAny and subjectOrSnippetContainsAll. sender_domain uses endsWith matching for subdomain support. |
| UI state | Three-zone layout working. T1-T4 digest panels with correct tier behavior. Teaching chat with rule persistence and thread search. T4 Browse panel with collapsed categories and item counts. Inbox shows only undecided threads. |
| Known unmatched senders | Black Oak Workshop, Meetup, Out in Tech, Cloudflare (katsnreg), Experian, Velera OTP (katsnreg), Guidedtrack, People's Forum, Anthropic/Claude tips, Shop Pay final payment, Jesse forwarded email, itch.io, Debt Collective, ACLU Ohio personal, Northwest Animal Hospital, Byers Imports promo (intentional — awaiting promo tracking system). |
| Tier naming | T1 Immediate Attention, T2 Action Required, T3 Summarized, T4 Browse. |
| Services | Express server on localhost:3001, Vite client on localhost:5173. Started automatically with .desktop files. |
| Key architectural decisions | Confirm = wasCorrect true. Followup folds into T2 with userFlagged indicator. Agent never acts unilaterally. No auto-archive. Teaching chat is the primary rule learning interface post-seed. |


### 12.2 Files to Share in New Session

| Field | Value |
| --- | --- |
| triage_rules_v1.md | This document — complete project context, all rules, and architecture decisions. |
| seed-rules.json | Canonical rule definitions, 83 rules, all trigger types updated. |


### 12.3 New Session Context Prompt

I am building External Brain OS, an AI-first personal life management platform. The Email OS module is a smart email client that triages my Gmail inbox using rules and an AI agent. v1 is complete. This session is focused exclusively on creating new triage rules to improve inbox coverage.


Project state: Express backend (localhost:3001), React/Vite frontend (localhost:5173), SQLite via Prisma, triage engine running every 3 minutes, teaching chat powered by the Anthropic API. 83 seed rules loaded. I am attaching triage_rules_v1.md (all rules and architecture context) and seed-rules.json (canonical rule definitions).


Tech stack: Node.js v22, TypeScript, Express, Prisma/SQLite, React, Vite, Tailwind, Anthropic API (models configurable via ANTHROPIC_MODEL and ANTHROPIC_DIGEST_MODEL env vars). Repo: /mnt/Secondary/waregin/Documents/GitHub/email-os. Server in server/, client in client/.


**Valid rule structure** (exact format required when proposing rules):

```json
{
  "trigger": <trigger object — see formats below>,
  "action": "digest",
  "priority": "<T1|T2|T3|T4>",
  "digestSummaryTemplate": "<template with {field} placeholders — empty string for T4>",
  "notes": "<exceptions or edge cases>"
}
```

**Priority tiers:**
- T1 Immediate Attention: surface at top; requires same-day awareness or action
- T2 Action Required: needs deliberate followup; not necessarily today
- T3 Summarized: digest summary is sufficient; user rarely needs to open the original
- T4 Browse: full content needed; cannot be meaningfully summarized; grouped by category in Browse panel

**Trigger formats:**

```
Primary — match on subject or snippet:
  {"type":"subject_or_snippet_contains_any","patterns":["term1","term2"]}  ← fires if ANY pattern matches
  {"type":"subject_or_snippet_contains_all","patterns":["term1","term2"]}  ← fires if ALL patterns match

Primary — match on sender or recipient:
  {"type":"sender_domain","domain":"example.com"}
  {"type":"sender","sender":"user@example.com"}
  {"type":"self_sent"}
  {"type":"address","toAddress":"recipient@example.com"}

Optional secondary filter (sender_domain / sender / self_sent only):
  "subjectOrSnippetContainsAny": ["term1","term2"]  ← also require ANY of these
  "subjectOrSnippetContainsAll": ["term1","term2"]  ← also require ALL of these
  Both may appear together; both must pass.

Allowed fields per type — no others will be saved:
  subject_or_snippet_contains_any / _all  →  type, patterns
  sender_domain  →  type, domain, subjectOrSnippetContainsAny, subjectOrSnippetContainsAll
  sender         →  type, sender, subjectOrSnippetContainsAny, subjectOrSnippetContainsAll
  self_sent      →  type, subjectOrSnippetContainsAny, subjectOrSnippetContainsAll
  address        →  type, toAddress
```

**Matching behavior:**
- All string matching is case-insensitive substring against subject and snippet only — NOT the full email body
- sender_domain matches exact domain OR any subdomain (e.g. `paypal.com` also matches `mail.paypal.com`)
- sender matches exact email address only
- Rules are evaluated T1 → T4 then by creation date; first match wins

Hard constraints: Never delete emails except confirmed spam. Never take any action on any email without my explicit confirmation. The agent never acts unilaterally — it always proposes, I confirm. I have Gmail MCP access connected in this chat which you may use READ-ONLY to inspect inbox threads when needed for rule writing.
