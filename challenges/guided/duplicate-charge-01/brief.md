# Stop the double charge

The payment provider slows down for 20 seconds. Clients time out after 600 ms and retry, but the first attempt may still complete — so customers are charged twice.

Keep duplicates reaching the payment service under 0.1%.

**Concepts:** idempotency keys, dedup window, at-least-once delivery.
