# Build your private voice and evidence profile

Run `upwork-cli init`, then `upwork-cli proposal profile` to locate your private JSON profile. It starts empty. Keep your completed profile outside the public repository.

## Capture your voice

Write or dictate three short samples: explain a project you completed, disagree with an approach you would avoid, and explain your rate. Use your normal vocabulary. Add representative sentences to `proposalVoice.cadenceExamples`; these are voice references, not automatic proposal text.

Record three to five preferences in `voice`: formality, typical contractions, sentence length, humor, and how you express uncertainty. Do not ask the assistant to imitate another member’s biography or achievements.

## Record evidence

Add only verified facts to `facts`. Each `proof` entry has this shape:

```json
{
  "id": "your-project-id",
  "title": "Your project title",
  "summary": "Your contribution, the mechanism, and any observed result you can support.",
  "tags": ["training", "workflow"],
  "urls": []
}
```

Replace the example text with your own evidence. Use an empty URL list for private work. Describe it only at a level you have permission to disclose. Keep client names, confidential metrics, and access links out of public issue reports.

Set `name`, `positioning`, and `defaultHourlyRate` yourself. The starter profile intentionally supplies no name, rate, credentials, clients, or results. Leave unavailable evidence empty rather than inventing it.

## Ask an assistant to help

> Interview me about my actual work and writing preferences. Ask for evidence where a claim is incomplete. Build my profile from what I provide, preserving uncertainty. Do not invent numbers, testimonials, client names, credentials, or proof links. Show the completed profile before saving it to the private path. Then draft from docs/proposal-writing.md and the job’s proposal packet.
