Health checks verify that an instance is alive and ready, not that it is correct, so a version that returns errors passes them. What actually limits damage is how much traffic the new version sees before you learn it is bad, and how fast you can stop. A rolling update replaces the fleet quickly, so exposure grows with every batch; if nothing watches the error rate the bad version simply finishes the rollout.

A canary sends a small share of traffic to the new version first and holds, so a bad release is seen by a few percent of users for the hold time plus the detection time, and rolling back is cheap because most of the fleet is untouched. Blue-green gives instant rollback and no mixed fleet, but flips all traffic at once (full exposure until detected) and doubles capacity during the rollout — usually the most expensive option.

The common thread is automatic rollback on an error-rate signal. Without it, every strategy ends at 100% bad.
