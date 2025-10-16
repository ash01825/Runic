# IAM Permission Denied

## 🔍 Incident Symptoms
- The `eventType` is `AccessDenied`.
- Application logs show errors like `AccessDeniedException`, `Client.UnauthorizedOperation`, or HTTP `403 Forbidden` when trying to call an AWS service (e.g., S3, DynamoDB).
- The service is failing to perform a specific function, like writing a file to S3 or reading from a DynamoDB table.

## 📈 Possible Causes
- **Missing IAM Policy:** The IAM role attached to the EC2 instance or Lambda function is missing a policy that grants the required permission (e.g., `s3:PutObject`).
- **Policy Condition Mismatch:** An explicit `Deny` statement or a condition in the IAM policy (e.g., IP address restriction) is preventing the action.
- **Service Control Policies (SCPs):** A higher-level SCP applied at the AWS Organization level is blocking the action, even if the local IAM role allows it.

## 🛠️ Resolution Steps
1.  **Identify Missing Permission:** Analyze the error message to find the exact service and action that was denied (e.g., `s3:GetObject`).
2.  **Review Attached IAM Role:** Go to the IAM console and inspect the policies attached to the role used by the affected service.
3.  **Use IAM Policy Simulator:** Use the IAM Policy Simulator to test if the role can perform the required action on the target resource. This is the safest way to debug.
4.  **Add Missing Permission:** If a permission is missing, add an inline policy or attach a managed policy to the role that grants the necessary action.

## 🧪 Validation
- The application must be able to successfully perform the previously failing AWS API call.
- The `AccessDenied` errors must disappear from the logs.

## 💡 Additional Notes
- Always follow the principle of least privilege. Grant only the permissions that are absolutely necessary for the service to function.