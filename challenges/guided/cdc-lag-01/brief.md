# Outbox + Debezium

Order writes stream through a Debezium connector into Kafka. The connector is slower than the write rate, so lag and WAL retention grow.

Bring CDC lag under 2 s and retained WAL under 500 MB. The source DB and load are locked.

**Concepts:** CDC lag, WAL growth, connector scaling.
