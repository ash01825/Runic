# API Gateway 5xx Errors

## 🔍 Incident Symptoms
- A CloudWatch alarm has triggered for a high rate of `5XXError` metrics on an API Gateway endpoint.
- The `eventType` is `ApiError`.
- Downstream clients are reporting `502 Bad Gateway`, `503 Service Unavailable`, or `504 Endpoint Request Timed-out`.

## 📈 Possible Causes
- **Lambda Integration Timeout:** The backend Lambda function is taking longer to execute than the maximum 29-second integration timeout for API Gateway.
- **Backend Service Failure:** The service integrated with API Gateway (e.g., ECS, EC2) is unhealthy, unreachable, or crashing.
- **Throttling:** The backend service is being throttled by API Gateway or is throttling a downstream dependency itself.

## 🛠️ Resolution Steps
1.  **Check API Gateway Logs:** Enable and check the execution logs for the API Gateway stage to see detailed error messages from the backend integration.
2.  **Inspect Backend Metrics:** Look at the primary metrics (CPU, Memory, Errors) for the integrated Lambda or ECS service to identify signs of resource exhaustion or failure.
3.  **Test Backend Directly:** If possible, invoke the backend service directly (e.g., invoke the Lambda function with a test payload) to bypass API Gateway and isolate the fault.
4.  **Review Recent Deployments:** Check for any recent code or infrastructure changes to the backend service that could have introduced the issue.

## 🧪 Validation
- The `5XXError` rate on the API Gateway metric must return to near-zero.
- A test `curl` command against the API endpoint must return a `200 OK` status.

## 💡 Additional Notes
- A `504` error is almost always a timeout in the backend service. A `502` error is often a crash or invalid response from the backend.