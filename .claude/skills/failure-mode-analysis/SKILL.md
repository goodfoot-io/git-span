---
name: failure-mode-analysis
description: Use subagents to perform failure mode analysis
---

<user-input>
$ARGUMENTS
</user-input>

<instructions>
Dispatch a Fable-model, geneneral-purpose subagent to perform a failure mode analysis. Infer the subject of the analysis from `<user-input>` or conversation history.

Provide the subagent with a clear understanding of the subject. Include any secondary information that might be useful to the analysis in an appendix. Avoid providing subjective perspectives, but include all factual evidence and direct observations relevant to the subject.

Once the subagent has completed the analysis, address the issues it surfaces, then use the SendMessage tool to request a follow-up review. Continue this revision-review cycle until the subagent is fully satisfied.

Finally, output what was changed and why, then a full version for the user's confirmation.
</instructions>
