# High CPU Restart Procedure

## 🔍 Incident Symptoms
- An incident is flagged as an anomaly with a score of **1.0**, indicating a `metricValue` (CPU Usage) of **> 90%**.
- The `eventType` in the alert payload is `ResourceExhaustion`.
- The `service` field identifies a specific component, like `auth-service`, as the source.
- P99 latency for the service is significantly elevated.

## 📈 Possible Causes
- **Stuck Process:** A worker thread or process has entered a non-terminating loop, consuming all available CPU cycles.
- **Garbage Collection Storm:** For memory-managed languages, the garbage collector is thrashing due to memory pressure.
- **Intensive Computation:** A "poison pill" request has triggered a computationally expensive operation that is blocking other requests.

## 🛠️ Resolution Steps
1.  **Acknowledge Incident:** Update the incident status in the `OpsFlowIncidents` table to `INVESTIGATING`.
2.  **Immediate Mitigation:** Perform a rolling restart of the affected service (e.g., `auth-service`). This is the fastest way to recover from a stuck process.
3.  **Monitor Post-Restart:** Closely observe the `cpuUsagePercent` metric for 5 minutes after the restart.
4.  **Escalate if Unresolved:** If the CPU spikes again immediately, the issue is likely not a transient stuck process. Escalate to the on-call engineer and consider a rollback of the last deployment.

## 🧪 Validation
- The `cpuUsagePercent` metric for the service must drop and remain below **50%** for 15 consecutive minutes.
- The service's P99 latency should return to its baseline value.

## 💡 Additional Notes
- A restart is a temporary fix for an underlying code issue. Ensure a ticket is created and linked to the incident for root cause analysis.