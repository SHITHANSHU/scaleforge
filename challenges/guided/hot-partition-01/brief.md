# Hot partition

A flash-sale SKU makes **60% of messages share one key**, so one partition takes 18k msg/s but only handles 10k. Fix the skew so errors stay under 1% and lag stays bounded.

**Concepts:** key salting, partition strategy, cost vs ordering trade-off.
