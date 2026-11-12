# Retries that make it worse

Clients retry three times, 100 ms apart. A 10-second burst pushes the service over capacity and the retries keep it there.

Change the **traffic source's retry policy** (you can't change the server) so the system recovers and retries stay under 1× the offered load.

**Concepts:** retry amplification, backoff, jitter, retry budgets.
