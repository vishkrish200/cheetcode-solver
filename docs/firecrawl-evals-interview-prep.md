# Firecrawl Evals Interview Prep From Zero

Prepared: 2026-06-09

## Reality Check

Assume you are not prepared for the Research Engineer - Evals role yet.

That is okay for the quick chat. The email says this is a casual chat to discuss your background, Firecrawl's tech environment, and help prepare you for the technical portion. Your goal is not to convince Rafa that you are already a mature evals engineer. Your goal is to show:

- You understand the shape of the problem.
- You can learn fast.
- Your CTF work shows adjacent instincts: reverse engineering, validation, debugging, measurement, and fast iteration.
- You are honest about what you have and have not done.

## What The Role Actually Is

Firecrawl turns web pages into AI-usable data: markdown, HTML, structured JSON, screenshots, crawled sites, URL maps, search results, and interactive browser workflows.

The Evals role asks: how do we know those outputs are actually good?

The posting says this person will build the eval stack from scratch: metrics, datasets, pipelines, LLM-as-judge systems, human review tooling, CI/CD regression gates, and feedback loops into model/product/RL decisions.

So the role is not:

- "Run benchmark X and report a score."
- "Write prompts all day."
- "Use an existing eval framework."

It is:

- "Invent the measurement system for messy web-data quality."

## The Honest Positioning

Use this:

"I should be clear that I have not owned a production evals platform before. What I do have is adjacent experience building harnesses around ambiguous systems. In the CheetCode challenge I had to understand the real app/API behavior, build solvers, validate outputs, and avoid being fooled by results that looked good but came from the wrong path. That is the part of Evals that interests me: defining what good means, building the loop that measures it, and using failures to improve the system."

Short version:

"I am not coming in as a polished evals specialist. I am coming in as a fast builder with strong instincts around validation, debugging, and measurement."

## Do Not Say

- "I know evals deeply."
- "I have built LLM-as-judge systems at scale."
- "The CTF proves I can do the role."
- "I can just figure it out with models."

Better:

- "I have not done that exact thing at production scale, but I understand why it is hard."
- "My adjacent strength is building the harness and debugging whether the measurement is trustworthy."
- "I would want to learn how Firecrawl currently defines quality before proposing a metric."

## Minimum Vocabulary To Learn

### Scrape

Single URL in, content out. Outputs can include markdown, HTML, structured JSON, screenshots, links, metadata.

Eval questions:

- Did we capture the main content?
- Did we drop important tables, code blocks, prices, links, or metadata?
- Did we include junk like nav bars, cookie banners, ads, repeated footers?
- Did JS rendering change the answer?

### Crawl

Start from a URL and gather pages across a site.

Eval questions:

- Did we discover the right pages?
- Did we avoid irrelevant/duplicate/infinite URLs?
- Did the crawl finish within time/cost limits?
- Is coverage good for the user's use case?

### Map

Find URLs on a site quickly, usually without extracting every page.

Eval questions:

- Is URL discovery complete enough?
- Are important sections missing?
- Are URLs normalized and deduplicated?

### Extract

Turn page/site content into structured fields.

Eval questions:

- Are required fields present?
- Are field values grounded in the source page?
- Are types correct?
- Are hallucinated fields penalized?

### Interact / Browser Workflows

Continue working with a page: click, fill forms, navigate, extract dynamic content.

Eval questions:

- Did the action actually happen?
- Did the browser reach the intended state?
- Did the output reflect the final page state, not the initial page?

## One Defensible System Design

If asked "how would you evaluate scrape quality?", say:

1. First I would define the use case. RAG ingestion, structured extraction, and agent browsing need different definitions of quality.
2. I would build a small but representative dataset across docs, blogs, e-commerce pages, PDFs, SPAs, pages with tables, pages with code blocks, and pages with cookie/modal noise.
3. For each example, I would store the URL, timestamp, rendered screenshot, raw HTML or DOM snapshot, Firecrawl output, and human notes about what content matters.
4. I would score multiple dimensions instead of one global score: main-content recall, junk/noise precision, structure preservation, metadata/link quality, schema fidelity when relevant, latency, cost, and error class.
5. I would use deterministic checks where possible: required text present, forbidden boilerplate absent, valid JSON schema, link counts, table preservation.
6. I would use LLM judges only for fuzzy judgments, and calibrate them against human labels.
7. I would report by slice: site type, rendering mode, output format, parser path, and failure class.
8. I would wire the benchmark into CI so release candidates compare against the current baseline and show concrete diffs for regressions.

Memorize the core idea:

"Use multiple metrics and slices. Do not hide failures behind one average score."

## LLM-As-Judge For Beginners

You do not need to pretend mastery. You need a sensible view.

Say:

"I would treat LLM judges as scalable but untrusted labelers. They are useful for fuzzy quality judgments, but I would calibrate them against human review and keep deterministic checks wherever possible."

Know the failure modes:

- They reward pretty/verbose markdown even when content is missing.
- They miss silent omissions.
- They can be biased by formatting.
- They may accept plausible hallucinated structured fields.
- They may not catch stale or wrong page state.
- Aggregate scores can hide important slice regressions.

Good phrase:

"The judge needs its own eval."

## Dataset Basics

If asked how to build a dataset:

- Start with real customer traffic samples if privacy allows.
- Add hard cases from support tickets and regressions.
- Add synthetic/adversarial examples only after real examples exist.
- Keep a small frozen regression set for CI.
- Keep a rotating production-like set to catch drift.
- Version the dataset and rubric together.
- Store enough artifacts to debug: screenshot, HTML/DOM, output, metadata, model/parser version, error logs.

## What To Ask Rafa

Ask simple, grounded questions:

- "What does Firecrawl currently consider a bad scrape?"
- "Where are the current evals weakest: scrape quality, structured extraction, crawl coverage, or browser interactions?"
- "Are failures usually obvious, like a 500, or subtle, like missing the important content while returning clean markdown?"
- "For the technical interview, should I prepare more for coding, system design, or debugging an eval?"
- "Do you already have human-labeled datasets, or would this role be building that from scratch?"
- "How do eval results currently affect shipping decisions?"
- "What would a strong work trial project look like for this role?"

## Your CTF Story In A Safe Form

Do not oversell it.

Say:

"The challenge was not a direct evals project, but it had a similar failure mode: a score could look good while the method was brittle or not the one I intended. I built a harness that captured the app/API behavior, ran deterministic solvers where possible, used model fallbacks only when needed, and validated outputs before submission. The lesson I would carry into Evals is that you need to understand the system you are measuring, not just optimize the number."

If they ask for a concrete example:

- Level 1: deterministic specialists and example validation.
- Level 2: catalog/tool-first approach before model fallback.
- Level 3: local compile/server validation/repair loops.

But keep it brief. This is evidence of instincts, not proof of domain expertise.

## What To Study Before The Call

If you have 2 hours:

1. Read Firecrawl docs intro and understand Search, Scrape, Interact, Map, Crawl, Extract.
2. Memorize the one scrape-quality system design above.
3. Learn the LLM-as-judge failure modes.
4. Prepare the honest positioning paragraph.

If you have 1 day:

1. Do the 2-hour plan.
2. Write a tiny eval rubric for one URL-to-markdown example:
   - main content captured: 0-3
   - noise removed: 0-3
   - structure preserved: 0-3
   - links/metadata preserved: 0-2
   - fatal errors: yes/no
3. Compare two scraped outputs manually and explain which is better.
4. Read basic concepts: precision/recall, inter-rater agreement, golden datasets, regression testing, data drift.

If you have 3 days:

1. Build a tiny script that loads several URLs and expected snippets.
2. Score outputs with deterministic checks.
3. Add one LLM-judge prompt with a rubric.
4. Produce a simple regression report by URL and failure type.
5. Be ready to talk through tradeoffs.

## Reply Email

Hi Nicole,

Great to hear from you, and thanks for the context.

I am excited to chat with Rafa. I should say upfront that I have not owned a production evals platform before, but the part of the CheetCode challenge I enjoyed most was building the harness around an ambiguous system: understanding the real behavior, validating outputs, and making sure a good-looking result was actually reliable. That is what makes the Evals route interesting to me.

I will grab a time through the Calendly link.

Best,
Vishnu

## Red Flags To Avoid

- Pretending to be more senior in evals than you are.
- Talking only about the leaderboard.
- Talking too much about models and not enough about data, metrics, failure cases, and product loops.
- Giving one global metric as the answer.
- Ignoring cost, latency, flakiness, and production distribution.
- Acting like LLM judges are automatically trustworthy.

## Goal For The Quick Chat

End the call with Rafa thinking:

"He is not fully trained in evals yet, but he is honest, sharp, fast, and already thinks in harnesses, validation loops, and failure modes. I can prep him for the technical interview."

That is the realistic win condition.

## Sources Checked

- Firecrawl role URL: https://jobs.ashbyhq.com/firecrawl/25092c0e-9a32-4191-af79-050738213704
- Firecrawl docs introduction: https://docs.firecrawl.dev/introduction
- Firecrawl API reference: https://docs.firecrawl.dev/api-reference/v2-introduction
- Firecrawl data-extractor guide: https://docs.firecrawl.dev/developer-guides/usage-guides/choosing-the-data-extractor
