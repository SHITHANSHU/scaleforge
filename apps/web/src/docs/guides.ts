// Product documentation. Every external link below is a primary source the project's research read
// (see docs/research/*.md); nothing is linked that wasn't opened and checked.

export interface Ref { title: string; url: string; note?: string }
export type Block =
  | { t: "p"; text: string }
  | { t: "h3"; text: string }
  | { t: "ul"; items: string[] }
  | { t: "ol"; items: string[] }
  | { t: "callout"; tone: "info" | "warn" | "tip"; title: string; text: string }
  | { t: "table"; head: string[]; rows: string[][] }
  | { t: "refs"; items: Ref[] };
export interface Section { id: string; title: string; blocks: Block[] }
export interface Guide { id: string; title: string; summary: string; group: "Start here" | "Concepts" | "Reference"; sections: Section[] }

export const R = {
  sreCascading: { title: "Google SRE Book — Addressing Cascading Failures", url: "https://sre.google/sre-book/addressing-cascading-failures/", note: "Retries, queues, load shedding and why overload spreads." },
  sreOverload: { title: "Google SRE Book — Handling Overload", url: "https://sre.google/sre-book/handling-overload/", note: "Client and server-side overload protection." },
  awsRetries: { title: "AWS Builders' Library — Timeouts, retries and backoff with jitter", url: "https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/", note: "Why retries amplify load and how jitter helps." },
  awsShedding: { title: "AWS Builders' Library — Using load shedding to avoid overload", url: "https://builder.aws.com/content/3Eun1EEyX6p2e3VYNyRLSJzLuMV/using-load-shedding-to-avoid-overload" },
  awsStatic: { title: "AWS Builders' Library — Static stability using Availability Zones", url: "https://builder.aws.com/content/3K9SiqiJ369TGkkGzqPM95BuYWI/static-stability-using-availability-zones" },
  pgHA: { title: "PostgreSQL — High availability, load balancing and replication", url: "https://www.postgresql.org/docs/current/warm-standby.html" },
  pgPitr: { title: "PostgreSQL — Continuous archiving and point-in-time recovery", url: "https://www.postgresql.org/docs/current/continuous-archiving.html" },
  pgWal: { title: "PostgreSQL — Reliability and the write-ahead log", url: "https://www.postgresql.org/docs/current/wal-reliability.html" },
  auroraRepl: { title: "Amazon Aurora — Replication", url: "https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/Aurora.Replication.html" },
  rdsReplicas: { title: "Amazon RDS — Read replicas", url: "https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_ReadRepl.html" },
  githubOct21: { title: "GitHub — October 21 post-incident analysis", url: "https://github.blog/news-insights/company-news/oct21-post-incident-analysis/", note: "A 43-second partition, automated failover and 24 hours of degradation." },
  gitlab2017: { title: "GitLab — Postmortem of database outage of January 31", url: "https://about.gitlab.com/blog/postmortem-of-database-outage-of-january-31/", note: "Backups that existed but could not be restored." },
  dynamo: { title: "Dynamo: Amazon's Highly Available Key-value Store (SOSP '07)", url: "https://www.allthingsdistributed.com/files/amazon-dynamo-sosp2007.pdf" },
  cassandra: { title: "Apache Cassandra — Dynamo-style architecture", url: "https://cassandra.apache.org/doc/latest/cassandra/architecture/dynamo.html" },
  discord: { title: "Discord — How Discord stores trillions of messages", url: "https://discord.com/blog/how-discord-stores-trillions-of-messages" },
  pacelc: { title: "Abadi — Consistency tradeoffs in modern distributed database system design (PACELC)", url: "https://www.cs.umd.edu/~abadi/papers/abadi-pacelc.pdf" },
  raft: { title: "In Search of an Understandable Consensus Algorithm (Raft)", url: "https://raft.github.io/raft.pdf" },
  kleppmann: { title: "Martin Kleppmann — How to do distributed locking", url: "https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html", note: "Leases, fencing tokens and why timing assumptions are unsafe." },
  memcache: { title: "Scaling Memcache at Facebook (NSDI '13)", url: "https://www.usenix.org/system/files/conference/nsdi13/nsdi13-final170_update.pdf" },
  confluentEO: { title: "Confluent — Exactly-once semantics in Apache Kafka", url: "https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/" },
  rabbitConfirms: { title: "RabbitMQ — Consumer acknowledgements and publisher confirms", url: "https://www.rabbitmq.com/docs/confirms" },
  rabbitPrefetch: { title: "RabbitMQ — Consumer prefetch", url: "https://www.rabbitmq.com/docs/consumer-prefetch" },
  kafkaDocs: { title: "Apache Kafka — Documentation", url: "https://kafka.apache.org/documentation/" },
  uberDlq: { title: "Uber Engineering — Building reliable reprocessing and dead letter queues with Kafka", url: "https://www.uber.com/blog/reliable-reprocessing/" },
  stripeIdem: { title: "Stripe — Designing robust and predictable APIs with idempotency", url: "https://stripe.com/blog/idempotency" },
  outbox: { title: "microservices.io — Transactional outbox", url: "https://microservices.io/patterns/data/transactional-outbox.html" },
  saga: { title: "microservices.io — Saga", url: "https://microservices.io/patterns/data/saga.html" },
  k8sDeploy: { title: "Kubernetes — Deployments (rolling updates)", url: "https://kubernetes.io/docs/concepts/workloads/controllers/deployment/" },
  k8sHpa: { title: "Kubernetes — Horizontal Pod Autoscaling", url: "https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/" },
  k8sProbes: { title: "Kubernetes — Liveness, readiness and startup probes", url: "https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/" },
  elasticShards: { title: "Elastic — Size your shards", url: "https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/size-shards" },
  elasticIndexing: { title: "Elastic — Tune for indexing speed", url: "https://www.elastic.co/docs/deploy-manage/production-guidance/optimize-performance/indexing-speed" },
  clickhouse: { title: "ClickHouse — Selecting an insert strategy", url: "https://clickhouse.com/docs/best-practices/selecting-an-insert-strategy" },
  s3Perf: { title: "Amazon S3 — Best practices design patterns: optimizing Amazon S3 performance", url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/optimizing-performance.html" },
  aws2021: { title: "AWS — Summary of the AWS service event in the N. Virginia Region (7 Dec 2021)", url: "https://aws.amazon.com/message/12721/" },
  aws2025: { title: "AWS — Summary of the Amazon DynamoDB service disruption in us-east-1 (19–20 Oct 2025)", url: "https://aws.amazon.com/message/101925/" },
  cloudflare2025: { title: "Cloudflare — 18 November 2025 outage", url: "https://blog.cloudflare.com/18-november-2025-outage/" },
  gcp2025: { title: "Google Cloud — Incident report, 12 June 2025", url: "https://status.cloud.google.com/incidents/ow5i3PPK96RduMcb1SsW" },
  phoenix: { title: "Phoenix — The road to 2 million websocket connections", url: "https://www.phoenixframework.org/blog/the-road-to-2-million-websocket-connections" },
  bloom: { title: "RedisBloom — Bloom filter", url: "https://redis.io/docs/latest/develop/data-types/probabilistic/bloom-filter/" },
  redisEviction: { title: "Redis — Key eviction", url: "https://redis.io/docs/latest/develop/reference/eviction/" },
  debezium: { title: "Debezium — Architecture", url: "https://debezium.io/documentation/reference/stable/architecture.html" },
  ec2Credits: { title: "AWS — CPU credits and baseline utilization for burstable instances", url: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/burstable-credits-baseline-concepts.html" },
  stripeLimiters: { title: "Stripe — Scaling your API with rate limiters", url: "https://stripe.com/blog/rate-limiters" },
  nginxLb: { title: "NGINX — HTTP load balancing", url: "https://nginx.org/en/docs/http/load_balancing.html" },
} satisfies Record<string, Ref>;

const flow = "Each tick, every component receives the traffic that was sent to it last tick, decides how much it can process, queues or drops the rest, and sends the remainder down its connections.";

export const guides: Guide[] = [
  {
    id: "welcome", title: "Welcome to ScaleForge", group: "Start here",
    summary: "An engineering laboratory for backend architecture: design a system, load it, break it, and see why.",
    sections: [
      { id: "what", title: "What it is", blocks: [
        { t: "p", text: "ScaleForge simulates the behaviour of backend systems — queues filling, caches warming, replicas lagging, deploys going wrong — so you can reason about design decisions with evidence. Everything runs in your browser; there are no accounts and no servers, and your designs are stored locally." },
        { t: "p", text: "It models behaviour, not software. It never runs Kafka, Redis or PostgreSQL. Each component is a set of rates, queues, limits and failure rules that you can read and edit." },
      ] },
      { id: "workflow", title: "The workflow", blocks: [
        { t: "ol", items: [
          "Drag components from the palette (or press ⌘K) onto the canvas and connect them. Connections carry a protocol; the editor only offers compatible ports.",
          "Click a component to configure it. Controls are specific to the component, show derived values (such as the throughput ceiling that follows from your settings), and come with approximate presets whose sources you can read.",
          "Click empty canvas to edit the scenario: a traffic profile, a duration, a seed and scheduled faults.",
          "Press Space to run. Watch the canvas change colour and thickness, read the metrics and event timeline, and use the Bottlenecks tab to see what saturated first.",
          "Change one thing and run again. Because runs are deterministic, a different outcome always has a cause you introduced.",
        ] },
        { t: "callout", tone: "tip", title: "Keyboard", text: "Space runs or pauses, . steps 100 ms, ⌘K adds a component, / searches the palette, ⌘Z undoes, ⌘G groups components in a boundary, ? lists every shortcut." },
      ] },
      { id: "practice", title: "Ways to practise", blocks: [
        { t: "ul", items: [
          "Engineering challenges — realistic production situations on a blank canvas. You decide the architecture; simulation judges it, including scenarios you have not seen.",
          "Guided exercises — focused, step-by-step work on one idea, starting from a design that is broken in a specific way.",
          "Labs — interactive explainers for a single concept (retries, hashing, replication, quorums, Bloom filters).",
          "The workspace — free exploration with any component.",
        ] },
      ] },
    ],
  },
  {
    id: "how-it-works", title: "How the simulator works", group: "Concepts",
    summary: "A deterministic, fixed-step flow model: what it computes, and what it deliberately does not.",
    sections: [
      { id: "flow-model", title: "A flow model", blocks: [
        { t: "p", text: "The engine moves request rates and queue depths through the graph, not individual messages. " + flow + " A request's latency is the sum of what each component contributes (service time plus queueing delay) and what each connection adds." },
        { t: "p", text: "Individual items are sampled only where behaviour depends on them: a Bloom filter checks real keys, Redis eviction policies are compared on real key streams in the labs, and partitioners hash real keys." },
      ] },
      { id: "determinism", title: "Determinism and seeds", blocks: [
        { t: "p", text: "Time advances in fixed steps (10 ms by default). Randomness comes from a seeded generator with an independent stream per component, so the same design, scenario and seed always produce the same result. That is what makes challenge grading reproducible and lets you attribute any change to your edit." },
      ] },
      { id: "queues", title: "Queues, drops and latency", blocks: [
        { t: "p", text: "Every component with buffering has an explicit queue with a limit. Work beyond the limit is rejected and counted as an error. Queueing delay is derived from depth and drain rate, so a deep queue turns overload into latency before it turns into errors — which is exactly why deep queues are dangerous with clients that time out." },
        { t: "callout", tone: "warn", title: "Latency is an average per tick", text: "Flows merge at every component, so reported percentiles are over per-tick means weighted by volume rather than over individual requests. Real tail latency is worse than what the simulator shows. Treat p99 as a trend indicator, not a measurement." },
      ] },
      { id: "failure-feedback", title: "Failures travel upstream", blocks: [
        { t: "p", text: "When a component rejects, loses or times out work, the failure is reported to whoever sent it, one tick later, and propagates up the chain. That is how retry storms, circuit breakers and cache fall-backs emerge: a caller that retries creates extra load; a caller that falls back changes where load goes." },
        { t: "ul", items: [
          "Async boundaries (queues and logs) stop the propagation: a producer does not learn that a downstream consumer failed.",
          "A component that handles failures itself — by retrying, re-queueing or falling back — takes them out of the user-visible error count.",
          "Traffic that goes nowhere is an error. Only service endpoints and declared terminal ports complete a request, so a design cannot succeed by connecting nothing.",
        ] },
      ] },
      { id: "regions", title: "Regions and faults", blocks: [
        { t: "p", text: "A boundary drawn around components is a failure domain. A regional outage takes down everything inside it unless the component models how it spans regions itself (replicated databases and quorum stores do). Edges that cross between regions pay the scenario's round-trip time." },
        { t: "p", text: "Faults are scheduled in the scenario: kill a component or a whole region, add latency to a connection, or use component-specific faults such as flushing a cache, forcing a rebalance, partitioning a primary or releasing a bad version." },
      ] },
      { id: "limits", title: "What it is not", blocks: [
        { t: "ul", items: [
          "Not a performance predictor. Throughput and latency figures are approximations you should replace with measurements of your own system.",
          "Not a vendor comparison. Presets are illustrative and say where their numbers come from; no vendor failover time is asserted.",
          "Not a correctness checker. Consistency behaviour is modelled statistically, not by replaying histories.",
        ] },
        { t: "refs", items: [R.sreCascading, R.awsRetries] },
      ] },
    ],
  },
  {
    id: "reading-results", title: "Reading the results", group: "Concepts",
    summary: "What the canvas, the dock and the event timeline are telling you.",
    sections: [
      { id: "canvas", title: "The canvas is the first dashboard", blocks: [
        { t: "ul", items: [
          "Component colour and bar: utilisation, from green through amber to red. A pulsing red border means saturated; a DOWN badge means a fault killed it.",
          "Connection thickness and flowing dashes: throughput. The label shows requests per second and the latency accumulated up to that point.",
          "Queue bars: backlog against its limit. Component-specific numbers (hit ratio, lag, credits, connections) appear on the node.",
        ] },
      ] },
      { id: "dock", title: "The execution dock", blocks: [
        { t: "p", text: "Metrics plots offered load, served load, drops and latency, plus the selected component's own series. Timeline lists engine events such as 'credits exhausted', 'failover started' or 'rolling back', on a shared time axis. Bottlenecks ranks components by when they first reached their limit — the first to saturate is usually where to look." },
        { t: "callout", tone: "tip", title: "Offered versus retries", text: "Offered load is the demand users generate. Retry traffic is extra load created by clients and is reported separately, so you can see amplification directly." },
      ] },
      { id: "habits", title: "Habits worth building", blocks: [
        { t: "ol", items: [
          "Find the first bottleneck before changing anything.",
          "Change one thing per run.",
          "Check recovery, not just peak: does the system return to normal after the trigger ends?",
          "Look at the failure case, not only the happy path: lose a node, a replica, a region.",
          "Ask what the design costs, and what it risks when your assumptions are wrong.",
        ] },
      ] },
    ],
  },
  {
    id: "challenges", title: "Challenges and grading", group: "Concepts",
    summary: "How engineering challenges and guided exercises differ, and how designs are judged.",
    sections: [
      { id: "kinds", title: "Two kinds of practice", blocks: [
        { t: "table", head: ["", "Engineering challenges", "Guided exercises"], rows: [
          ["Starting point", "Blank canvas with fixed items only", "A design that is broken in one specific way"],
          ["You are told", "Situation, symptoms, requirements, constraints", "What to investigate, step by step"],
          ["Goal", "Decide the architecture yourself", "Understand one mechanism well"],
          ["Judged by", "Simulation over visible and hidden scenarios", "Measured criteria on the visible scenario"],
          ["Multiple answers", "Yes — several architectures pass", "Usually one fix, sometimes more"],
        ] },
      ] },
      { id: "grading", title: "How engineering challenges are graded", blocks: [
        { t: "ul", items: [
          "Your design runs against every scenario, including ones you have not seen (a bigger peak, a different failure, a different seed).",
          "Each challenge defines its own criteria. Must-haves have to pass; the rest earn partial credit by weight.",
          "Budgets are judged on peak spend, so temporary capacity (a blue-green fleet, a surge) counts.",
          "Grading is deterministic: the same design always receives the same grade.",
          "Connecting components is not enough. Traffic must actually be served end to end, and an unknown metric never passes.",
        ] },
        { t: "callout", tone: "info", title: "Why hidden scenarios?", text: "A design tuned to the visible test is brittle. Hidden scenarios check that you solved the problem rather than the example — the same reason production systems get failure drills they were not tuned for." },
      ] },
      { id: "after", title: "After you pass", blocks: [
        { t: "p", text: "Read the write-up: it describes a reference design, the trade-offs behind it, and the other architectures that also satisfy the requirements. You can open the reference design on the canvas to compare." },
      ] },
    ],
  },
  {
    id: "assumptions", title: "Modelling assumptions", group: "Reference",
    summary: "The simplifications behind every model, in one place.",
    sections: [
      { id: "principles", title: "Principles", blocks: [
        { t: "ul", items: [
          "Simulate behaviour, not software.",
          "Run real algorithms where they are cheap: Bloom filters, LRU and LFU, hash rings, rendezvous hashing, token buckets.",
          "Assumptions are data: every capacity, latency and price is an editable value, and presets state where they come from and that they are approximate.",
          "A behaviour is modelled only if it changes a design decision. Internals that would not (garbage collection, segment merging) are left out rather than faked.",
        ] },
      ] },
      { id: "common", title: "Simplifications that apply everywhere", blocks: [
        { t: "table", head: ["Area", "Simplification"], rows: [
          ["Requests", "Flow, not individual requests; a read/write mix and a duplicate fraction travel with the flow."],
          ["Latency", "Per-tick mean; tails are understated."],
          ["Connections", "One tick of delay on every edge; no per-connection state."],
          ["Load", "Open-loop arrivals; clients may retry but do not model think time."],
          ["Capacity", "Flat per-node rates; no lock contention, cache hierarchy or noisy neighbours."],
          ["Cost", "Simple per-hour prices; not a billing model."],
        ] },
        { t: "p", text: "Each component's page lists what it models, what it simplifies and where its design comes from." },
      ] },
    ],
  },
  {
    id: "reading", title: "Further reading", group: "Reference",
    summary: "Primary sources the models are based on: official documentation, engineering blogs, postmortems and papers.",
    sections: [
      { id: "overload", title: "Overload, retries and resilience", blocks: [
        { t: "refs", items: [R.sreCascading, R.sreOverload, R.awsRetries, R.awsShedding, R.awsStatic, R.stripeLimiters] },
      ] },
      { id: "databases", title: "Databases, replication and recovery", blocks: [
        { t: "refs", items: [R.pgHA, R.pgPitr, R.pgWal, R.auroraRepl, R.rdsReplicas, R.githubOct21, R.gitlab2017] },
      ] },
      { id: "distributed", title: "Distributed data and consistency", blocks: [
        { t: "refs", items: [R.dynamo, R.cassandra, R.discord, R.pacelc, R.raft, R.kleppmann] },
      ] },
      { id: "messaging", title: "Messaging, idempotency and event-driven design", blocks: [
        { t: "refs", items: [R.confluentEO, R.kafkaDocs, R.rabbitConfirms, R.rabbitPrefetch, R.uberDlq, R.stripeIdem, R.outbox, R.saga, R.debezium] },
      ] },
      { id: "caching", title: "Caching", blocks: [
        { t: "refs", items: [R.memcache, R.redisEviction, R.bloom] },
      ] },
      { id: "deploy", title: "Deployment, scaling and capacity", blocks: [
        { t: "refs", items: [R.k8sDeploy, R.k8sHpa, R.k8sProbes, R.ec2Credits, R.nginxLb, R.phoenix] },
      ] },
      { id: "storage", title: "Search, analytics and object storage", blocks: [
        { t: "refs", items: [R.elasticShards, R.elasticIndexing, R.clickhouse, R.s3Perf] },
      ] },
      { id: "postmortems", title: "Public postmortems", blocks: [
        { t: "p", text: "Real incidents are the best case studies. Read them for the sequence of events, what made recovery slow, and what changed afterwards." },
        { t: "refs", items: [R.githubOct21, R.gitlab2017, R.aws2021, R.aws2025, R.cloudflare2025, R.gcp2025] },
      ] },
    ],
  },
];
