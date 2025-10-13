# Service Crash Loop

## 🔍 Incident Symptoms
- The `eventType` is `ServiceDown`.
- Monitoring systems (like Kubernetes or ECS) report that a service is restarting more than 5 times in 10 minutes.
- The service is unreachable and returns 503 Service Unavailable errors.
- Application logs show a repeating pattern of startup messages followed by a fatal error.

## 📈 Possible Causes
- **Bad Configuration:** An environment variable is missing or malformed, causing the application to fail on startup.
- **Failed Dependency Connection:** The service cannot connect to a critical dependency (like a database or another service) during its initialization phase.
- **Out of Memory (OOM):** The service's memory footprint exceeds its allocated limit, causing the orchestrator to kill it.

## 🛠️ Resolution Steps
1.  **Immediate Rollback:** The highest-probability cause is a bad deployment. Immediately initiate a rollback to the previously known good version of the service.
2.  **Inspect Logs for Fatal Errors:** While the rollback is in progress, inspect the service's logs for the fatal error message that occurs just before it crashes.
3.  **Check Configuration:** Validate that all required environment variables and secrets are correctly mounted and accessible to the service.
4.  **Review Resource Limits:** Check the service's CPU and memory allocation. If a memory leak is suspected, temporarily increase the memory limit.

## 🧪 Validation
- The service must stop restarting and maintain a running state for at least 30 minutes.
- The service's health check endpoint must return a `200 OK` status.

## 💡 Additional Notes
- A crash loop is almost always caused by a recent change. Time is critical; always prefer rolling back first and investigating second.