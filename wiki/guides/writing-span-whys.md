---
title: Writing Span Whys
summary: How to write a good span "why" — one present-tense sentence defining the subsystem the anchors form — in long, medium, and short form, with good and bad examples and the reasoning behind the rules. A why routes attention when a hook surfaces it mid-task; rules, warnings, and co-change instructions belong in comments at the anchor sites, not in the why.
aliases: [Span Whys, Good Why, Why Writing]
tags: [guide, git-span]
keywords: [why, span, anchor, implicit dependency, coupling, evergreen, hook]
---

# Writing span whys

Every span carries a **why**: one sentence stored with the span that defines the
subsystem its anchors form together. The why is read in an unusual place. Hooks
surface it inline — along with the span's other anchors — the moment an agent
reads or edits lines inside one anchor, in the middle of some other task, like
adding a feature. That reading context drives every rule on this page.

The design principle: **a why is a router, not a work order.** Its one job is to
let a reader who just touched an anchor decide, from the sentence alone, whether
their edit lands inside the thing it names. If yes, they open the other anchors,
where comments explain what must hold. If no, they move on and keep their focus
on the task they were doing.

## Definitions

Three lengths of the same definition. Use the long form when teaching or
documenting, the medium form in skills and reference docs, the short form in
help text and templates.

### Long

> A why is one sentence, written in the present tense, that defines the piece of
> the system its anchors form together. Name the thing, then say what it does
> across the anchors. Use role words — "the parser," "the doc," "the release
> script" — instead of file names, and don't repeat the span's name. Write it as
> a complete sentence with a subject and a verb, not a label followed by a colon.
>
> The sentence has one job. When a tool shows it to someone in the middle of
> another task, that person should be able to tell — from the sentence and the
> lines they just touched — whether their edit lands inside the thing it names.
> If yes, they open the other anchors, where comments explain what must hold. If
> no, they move on. So be specific: name the real flow, value, or wording the
> anchors share, not a vague theme.
>
> A why is a definition, not an instruction. It never gives rules, warnings,
> owners, review steps, or the story of a change — those belong in code comments
> at the anchor sites, in commit messages, and in PRs. Because it only defines,
> it stays true across rewrites and re-anchors. Rewrite it only when the thing
> itself changes.

### Medium

> A why is one complete present-tense sentence that defines what its anchors
> form together: name the thing in role words, not file names, and say what it
> does across the anchors. Make it specific enough that someone who just edited
> one anchor can tell whether their change touches what it names. It gives no
> rules, warnings, or review steps — comments at the anchor sites do that — so
> it stays true until the thing itself changes.

### Short

> One present-tense sentence naming what the anchors form together — clear
> enough to tell whether an edit lands inside it, with no rules or reminders
> attached.

## Examples and the thinking behind them

### The test every why must pass

Read the why and ask: **"Is my edit inside this?"** A good why lets you answer
from the sentence and the lines you just touched. Every bad why on this page
fails that test in one of three ways — it is too vague to check, it is an
instruction instead of a definition, or it is a story about the past.

### Good examples

Longer whys, earned by couplings with more parts:

- "The password-reset flow runs from the endpoint that issues a one-time token,
  through the email template that carries it, to the form handler that redeems
  it, and the token expires after fifteen minutes."
- "The retry policy for outbound webhooks is set by the backoff table, applied
  by the queue worker that schedules each retry, and shown on the admin page as
  a delivery's remaining attempts."
- "The app's dark-mode palette is defined in the design-token file, generated
  into CSS variables, and repeated by hand as the native splash screen's
  background color."

Medium whys:

- "Product-listing pagination is a continuation-token flow defined by the API
  and mirrored by each client library."
- "The sign-up throttle counts attempts per address in the middleware and takes
  its limit and time window from the settings file."
- "The config loader reads environment variables first, then the project file,
  then built-in defaults, and the setup guide describes that same order."

Short whys:

- "Checkout request flow that carries a charge attempt from the browser to the
  Stripe-backed server."
- "Session-timeout length shared by the login server and the mobile app."
- "The onboarding checklist the app shows and the help-center article that
  walks through it."

What makes these work:

- **The verb carries the relationship.** "Is defined in… generated into…
  repeated by hand" and "is set by… applied by… shown on" tell the reader
  exactly how the anchors relate. This is why a why must be a full sentence
  rather than a label with a colon — turning the label into a sentence forces
  you to pick a verb, and the verb is what the reader classifies their edit
  against.
- **Role words survive renames.** "The email template" stays true when the file
  moves; a file name in the why goes stale the day the file is renamed.
- **The shared thing is named precisely.** "Expires after fifteen minutes,"
  "the same background color," "that same order" — each names the concrete
  flow, value, or wording the anchors share, so the reader can check it.
- **Length matches the number of parts.** A why should be exactly as long as
  the coupling has parties. The long examples earn their length by naming more
  roles, not by adding warnings.

### Bad examples

A **work order** — rules, owners, and review steps instead of a definition:

> "The retry delays in the backoff table must match the admin page, and any
> change here needs review from the platform team; don't touch the queue worker
> without updating the table first, and re-run the load test afterward."

This pulls the reader out of their task. It reads as an instruction to act,
even when the touch was incidental. The facts it carries — the matching rule,
the owner, the test step — belong in a comment at the backoff table, in
CODEOWNERS, and in the PR checklist.

A **change story** — past tense, tied to one commit:

> "Rewrote the password-reset flow so tokens now expire after fifteen minutes
> instead of an hour; the old email template was removed and the form handler
> was updated to match."

A reader six months later cannot tell what is true now versus what was news at
the time. The story belongs in the commit message; the why states only the
standing result.

**Vague, even at length** — nothing a reader can check an edit against:

> "These files are all connected to how the app handles errors in different
> places, and they relate in ways that matter, so changes in one area can
> affect the others and should be handled carefully."

Long but empty. No named flow, value, or wording means every reader must open
every anchor just to decide whether their edit is relevant — the worst outcome
for a sentence whose whole job is routing.

**Vague plus a reminder:**

> "This span tracks the sign-up throttle and makes sure attempts are handled
> properly. Note that the limits may change soon and we should review them."

"Properly" checks nothing, "tracks" restates that a span exists, and the
reminder is a review instruction wearing a why's clothes.

**File names and a bare rule:**

> "auth/middleware.ts and config/limits.json need to stay in sync."

The anchors already say where; the why must say *what* — the subsystem those
places form. "Stay in sync" names no thing and gives the reader nothing to
verify. Same failure in miniature: "Keep these in sync."

**A pointer away from the code:**

> "See PR #482 for context."

Useless without repository history, and unreadable in the one place whys are
actually read — hook output in the middle of a task.

**Restating the span name:**

> "Tracks the checkout flow."

If the why only repeats the name, it adds nothing the span list didn't already
show.

### Why rules and reminders are banned

The ban is not a style preference; it follows from where whys are read.

- **The interrupt is paid on every firing.** Hooks surface the why on *any*
  overlap with an anchor, and most touches are incidental to the coupling. A
  definition lets the common case end in seconds — "my edit isn't inside this,
  moving on." A work order invites the reader to switch tasks and make edits
  nobody needed.
- **Invariants belong where they are checked.** If the edit *is* relevant, the
  reader opens the other anchors anyway — and a comment sitting at the anchor
  site ("this wording is quoted verbatim in the gate message and both doc
  mirrors") arrives exactly when it is needed. Comments also live in the
  reviewed diff next to the lines they govern, so normal review pressure keeps
  them honest; a rule buried in a span file has no such pressure.
- **Duplication drifts.** Stating the rule in both the why and a comment
  guarantees the two copies eventually disagree.
- **Definitions don't rot.** Invariants change more often than subsystem
  identity. A why that only defines stays true across rewrites and re-anchors,
  which is what makes it trustworthy when a hook injects it — the reader has no
  cheap way to notice that a stale why is lying.

The practical consequence for span authors: declaring a span isn't finished
when the anchors and the why are written. Leave a comment at each load-bearing
anchor site stating what must hold there. The why routes; the comments state
the rules.

## Related

- [Git Span Documentation Touchpoints](../meta/git-span-documentation-touchpoints.md)
  — the map of guidance surfaces (CLI help, man page, skills, agents, hook
  templates) that must be walked when the recommended why-writing convention
  changes.
