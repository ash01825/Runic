# High Database Query Latency

## 🔍 Incident Symptoms
- The `eventType` is `LatencySpike` or `Timeouts`.
- The `service` experiencing the issue is a database like `inventory-db`, or a service that depends on it.
- Application-level metrics show a sharp increase in the duration of database transactions.
- CloudWatch RDS metrics show high `DBLoad` and a low number of `FreeableMemory`.

## 📈 Possible Causes
- **Inefficient Query:** A new or existing query is performing a full table scan or a complex join, locking resources.
- **Connection Pool Exhaustion:** The application services have consumed all available database connections.
- **Hardware Saturation:** The database instance is undersized for the current load, leading to high CPU or I/O wait times.

## 🛠️ Resolution Steps
1.  **Identify Long-Running Queries:** Use the database's native tools (e.g., `pg_stat_activity` for Postgres) to find and analyze long-running queries.
2.  **Terminate Offending Query:** If a single query is identified as the cause, terminate its process ID to immediately relieve pressure.
3.  **Restart Connection Pool:** If no single query is at fault, restart the application services (e.g., `payment-gateway`) to reset their database connection pools.
4.  **Failover Database:** As a last resort for an unresponsive database, initiate a manual failover to a read replica.

## 🧪 Validation
- The `DBLoad` metric must return to a value less than the number of vCPUs.
- The P99 query latency metric must return to its baseline.

## 💡 Additional Notes
- Terminating queries can cause data inconsistencies. Use this action with caution.
- All long-running queries identified should be logged in the incident ticket for optimization.