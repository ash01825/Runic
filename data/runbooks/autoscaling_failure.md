# Auto Scaling Failure

## 🔍 Incident Symptoms
- Service metrics (like CPU or latency) are high across all instances, which should have triggered a scale-up event.
- The "Activity History" for the Auto Scaling Group (ASG) shows recent scaling activities have failed.
- No new instances are being launched despite high demand.

## 📈 Possible Causes
- **Launch Configuration/Template Error:** The instance launch template is referencing a non-existent AMI, security group, or has an error in its user data script.
- **IAM Permission Issue:** The IAM role associated with the ASG is missing permissions required to launch or terminate instances.
- **Subnet Capacity Exhausted:** The subnets configured for the ASG have no available private IP addresses.
- **Health Check Failures:** The ASG's health checks are failing for new instances, causing them to be terminated immediately after launch.

## 🛠️ Resolution Steps
1.  **Check ASG Activity History:** Go to the EC2 console, find the ASG, and look at the "Activity" tab for the specific error message associated with the failed launch.
2.  **Validate Launch Template:** Manually try to launch an instance using the exact same Launch Template to see if it fails and get a more detailed error.
3.  **Inspect Subnet IP Availability:** Check the "Subnet" section of the VPC console to ensure there are available IPs in the subnets used by the ASG.
4.  **Review Health Check Grace Period:** Ensure the health check grace period is long enough for the service to fully initialize before being marked as unhealthy.

## 🧪 Validation
- The ASG must be able to successfully launch a new instance.
- The desired and running instance counts for the ASG should match after a scaling event.

## 💡 Additional Notes
- Failures are often silent until a scaling event is needed. Regularly test ASG configurations by temporarily increasing the desired count.