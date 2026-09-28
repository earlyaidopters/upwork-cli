# Write a proposal that sounds like you

A useful proposal gives the client enough evidence to make a hiring decision. Start with something you have actually done. Explain the part that matters for this job. State the terms you can stand behind.

## Before you draft

Read the job and its screening questions. Run `upwork-cli proposal packet JOB_ID` and open your private profile. Pick one or two relevant pieces of evidence. If the evidence is missing, ask the writer for it before producing claims.

Keep three things separate: what you did, what you observed, and what you hope to achieve next. Building a dashboard does not prove that it saved anyone time. Teaching an exercise does not prove that everyone adopted the tool.

## Cover letter

Open with your strongest relevant proof, or a real shared detail if it adds something. Put useful evidence within the first three sentences. Describe a mechanism: the inputs you worked with, a decision you made, what you built, or how you checked it. Include rate, availability, and scope when relevant. Use only links the writer has supplied and approved.

Do not spend the opening explaining the client’s own posting back to them. Avoid a biography that makes the reader search for the relevant part. Stop once the reader has evidence, terms, and a concrete next step.

Word ranges in the profile are drafting guides. A complete short answer is better than padding to hit a target.

## Screening answers

Answer the question in the first sentence, then support it with the strongest relevant example.

| Question | Useful supporting detail |
| --- | --- |
| What have you built? | Inputs, your responsibility, implementation, review, observed result |
| Have you trained this audience? | Actual learners, exercise, feedback, measured versus intended outcomes |
| How would you structure the work? | First decision, sequence, deliverables, acceptance criteria |
| How do you adapt to different teams? | A real adjustment and why you made it |
| Can you share proof? | A supplied link, what it demonstrates, your contribution |

A proposed approach may describe future work. Label it as a proposal instead of presenting it as past experience.

## Edit without flattening your voice

Read the draft aloud. Keep contractions, useful qualifiers, and longer sentences that sound natural. Remove repeated sentence openings and stacks of short claims. Add a bridge only when it explains how one thought follows another.

Every sentence should add evidence, a mechanism, a decision, a constraint, a commercial term, or a next step. If another freelancer could paste a line unchanged, replace it with a supported detail or delete it.

These editing examples are invented illustrations, not credentials to reuse:

| Weak line | Better direction |
| --- | --- |
| I am excited to apply and am the perfect fit. | Delete it. Start with relevant work. |
| I built a robust solution to improve efficiency. | Name what you built and how you checked it. |
| Studies show this saves hours. | Supply the actual source and measurement, or remove the claim. |
| The team’s knowledge lives in scattered chats. | Describe the actual problem only where the question asks for it. |

Avoid inflated vocabulary, canned contrasts, false enthusiasm, rhetorical questions, generic closings, invented personas, and em dashes. `proposal lint` flags specific patterns. Warnings require judgment: “honestly” may be a natural qualifier. The linter cannot verify your claims or determine whether a person wrote the text.

## Review before anyone touches Submit

Run `proposal lint`, resolve blocking findings, inspect warnings, then run `proposal review`. Show the cover letter in its own code block and every screening answer separately with its question. Include rate, base Connects, boost, and maximum total Connects. State **NOT SUBMITTED**.

The user must approve that exact content. A changed answer, rate, link, attachment, or Connects amount invalidates approval. Live Connects confirmation is a separate step. A saved command or earlier approval is not consent for a new version.
