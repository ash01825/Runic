# Disk Space Full

## 🔍 Incident Symptoms
- A CloudWatch alarm has triggered for the `DiskSpaceUsedPercent` metric on an EBS volume, exceeding 90%.
- The service may fail to start or may be logging errors related to "No space left on device."
- Applications may be unable to write to log files or temporary directories.

## 📈 Possible Causes
- **Log Spam:** A misconfiguration or bug is causing the application to write excessively verbose logs, filling the disk.
- **Unmanaged Temp Files:** A process is creating temporary files without cleaning them up afterwards.
- **Insufficient Provisioning:** The disk was not provisioned with enough space for normal operation.

## 🛠️ Resolution Steps
1.  **Identify Large Directories:** SSH into the instance and run `du -sh /path/*` to find which directory is consuming the most space.
2.  **Archive and Purge Old Logs:** If logs are the culprit, compress and archive old log files to S3, then delete them from the local disk.
3.  **Clear Temp Directory:** Safely clear the contents of `/tmp` or other temporary application directories.
4.  **Resize EBS Volume:** If the disk usage is legitimate, use the AWS console or CLI to resize the EBS volume to a larger capacity.

## 🧪 Validation
- The `DiskSpaceUsedPercent` metric must drop below 70%.
- The application must be able to successfully write files to the disk.

## 💡 Additional Notes
- Automate log rotation and archiving as a permanent solution to prevent recurrence.