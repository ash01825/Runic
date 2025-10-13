# DNS Resolution Failure

## 🔍 Incident Symptoms
- The `eventType` is `Timeouts`.
- Application logs are filled with errors like `UnknownHostException`, `EAI_AGAIN`, or "Could not resolve host" for a specific internal or external service.
- The service is failing its health checks because it cannot connect to its dependencies (e.g., a database).

## 📈 Possible Causes
- **VPC DNS Throttling:** The instance is making too many DNS requests, exceeding the limit for the VPC DNS resolver.
- **Misconfigured `resolv.conf`:** The DNS configuration on the instance itself is incorrect or has been corrupted.
- **Route 53 Health Check Failure:** The DNS record is backed by a Route 53 health check that is failing, causing DNS to resolve to a failover endpoint or not at all.
- **Network ACLs or Security Groups:** A network rule is blocking DNS traffic (UDP/TCP on port 53).

## 🛠️ Resolution Steps
1.  **Test Resolution from Instance:** SSH into an affected instance and use `dig` or `nslookup` on the failing hostname to confirm the issue.
2.  **Test Resolution from Another Instance:** Run the same `dig` command from a healthy instance in the same VPC to see if the issue is isolated.
3.  **Check Route 53 Health Checks:** If using Route 53, check the status of any associated health checks for the DNS record.
4.  **Restart `dnsmasq` or DNS client:** Restarting the local DNS caching service on the instance can resolve transient issues.

## 🧪 Validation
- The `dig` command for the failing hostname must successfully return the correct IP address when run from the affected instance.
- The application error logs must no longer contain DNS resolution errors.

## 💡 Additional Notes
- The default VPC DNS resolver is located at the `+2` address of your VPC's CIDR block (e.g., `10.0.0.2` for a `10.0.0.0/16` VPC). Ensure this is reachable.