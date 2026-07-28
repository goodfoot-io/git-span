# Review loop

1. Regularly use subagents to view frames of the hyperframes video directly, and to make sure the video meets the goals defined in `goals.md`.
2. When each reviewing subagent returns, identify how you would have structured the video differently if you were starting from scratch to address its feedback.
3. Build a new version of the video based on that reworked structure.
4. Use SendMessage to notify the reviewing agent of the new version, and to trigger a review.
5. Repeat steps 1–4 until the reviewing subagents are fully satisfied with the outcome.
