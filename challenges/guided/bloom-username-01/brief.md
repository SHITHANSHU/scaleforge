# Bloom filter for username availability

Signup form checks hit Postgres for every keystroke. **85% of names checked are free.** A Bloom filter is in front of the DB, but it was sized for 100k names and now holds 400k — false positives flood the DB.

Resize the filter so the DB stays under 50% utilization and observed false positives stay under 3%.

**Concepts:** sizing n and p, overfill, FP cost on the DB.
