# Redis Cache Latency

## 🔍 Incident Symptoms
- The `eventType` is `LatencySpike`.
- The `service` is a cache like `session-cache` or `product-cache`.
- Application metrics show a significant increase in the time taken for cache `GET` or `SET` operations.
- The ElastiCache for Redis `CPUUtilization` metric is consistently high (>80%).

## 📈 Possible Causes
- **Expensive Commands:** The application is using slow, blocking Redis commands like `KEYS` or `SCAN` with a high count over a large keyspace.
- **Network Saturation:** The Redis instance is processing too many commands, saturating its network bandwidth.
- **High Eviction Rate:** The cache is full, and Redis is spending significant CPU time evicting keys to make space for new writes.

## 🛠️ Resolution Steps
1.  **Check Slow Log:** Connect to the Redis instance via `redis-cli` and run the `SLOWLOG GET 10` command to identify the most recent expensive queries.
2.  **Monitor Evictions:** Use the `INFO stats` command and look for a high `evicted_keys` count, which indicates the cache is under memory pressure.
3.  **Temporarily Scale Up:** If CPU is the bottleneck, temporarily scale the Redis cluster to a larger instance type to handle the load.
4.  **Flush Cache (Emergency Only):** As a last resort for a completely unresponsive cache, consider a `FLUSHALL` command. **WARNING: This will cause mass cache misses and high database load.**

## 🧪 Validation
- The P99 latency for Redis commands must return to its baseline (typically <5ms).
- The `CPUUtilization` metric for the Redis node must drop below 50%.

## 💡 Additional Notes
- Avoid the `KEYS` command in production applications at all costs. Use `SCAN` with a reasonable `COUNT` instead.