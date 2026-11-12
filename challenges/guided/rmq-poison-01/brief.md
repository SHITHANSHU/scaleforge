# Poison message loop

8% of messages always fail. With auto-requeue they come straight back and consume consumer capacity until the backlog explodes.

Keep the backlog under 2,000 **without changing consumer count or speed** and make sure bad messages end up somewhere inspectable.

**Concepts:** DLX, redelivery limits, retry with backoff.
