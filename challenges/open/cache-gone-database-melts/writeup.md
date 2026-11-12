The database was sized for a trickle, so the instant the cache vanishes there are only three honest options: have capacity for the full read load, serve less (shed) so the database stays alive, or serve something other than fresh data. Doing nothing sends everything to the database and loses all of it, including the writes.

Failing open — letting the application read through to the database when the cache is down — keeps requests working, and is exactly what overloads the database. So fail-open needs a limiter on the path to the database (a gateway shedding by queue age works) and/or enough database capacity. Either approach passes; they trade cost (more database machines, 24/7) against availability during the outage (shedding rejects some requests but protects everyone else).

The cache's return is its own incident: it comes back empty, every request is a miss, and the database takes the full load again until it warms. Designs that protect the database help twice.
