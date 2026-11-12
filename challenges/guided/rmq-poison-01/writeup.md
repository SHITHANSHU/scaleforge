Enable a dead-letter exchange with a redelivery cap. Failed messages leave the hot path and land in a DLQ you can inspect or retry with backoff. Trade-off: you now own a DLQ runbook.
