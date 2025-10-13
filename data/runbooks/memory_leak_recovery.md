# Memory Leak Recovery

## 🔍 Incident Symptoms
- The `eventType` is `ResourceExhaustion`.
- The `memoryUsagePercent` metric for a service is steadily increasing over several hours and has now exceeded 95%.
- The service may be experiencing performance degradation and increased garbage collection pauses.

## 📈 Possible Causes
- **Code Defect:** An application bug is causing objects to be allocated but never released, leading to a gradual exhaustion of available memory.
- **Cache Misconfiguration:** An in-memory cache has no eviction policy or is configured to hold too much data.

## 🛠️ Resolution Steps
1.  **Immediate Mitigation:** Perform a rolling restart of the affected service. This is the only way to immediately reclaim all leaked memory.
2.  **Enable Profiling:** Before the restart (if possible), enable memory profiling on one of the affected instances to capture a heap dump for later analysis.
3.  **Monitor Post-Restart:** After the restart, carefully monitor the memory usage graph. A healthy service's memory usage should plateau, not climb indefinitely.
4.  **Create Engineering Ticket:** A memory leak is a P1 bug. Create a high-priority ticket and attach any captured heap dumps and relevant logs.

## 🧪 Validation
- After the restart, the `memoryUsagePercent` metric should drop to its normal baseline (e.g., 20-30%).
- The metric should remain stable and not exhibit the same steady-climb pattern over the next hour.

## 💡 Additional Notes
- This runbook is for immediate recovery. The long-term fix requires code changes and cannot be fully automated by OpsFlow.