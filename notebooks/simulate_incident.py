# notebooks/simulate_incident.py

import json
import random
import time
import uuid
import requests
import argparse

# === Configuration ===
# IMPORTANT: Replace this with the 'ApiGatewayUrl' output from your CDK deploy.
# It should look like: https://<id>.execute-api.<region>.amazonaws.com/prod/alerts
API_GATEWAY_URL = "https://9e1sqol6ki.execute-api.ap-south-1.amazonaws.com/prod/alerts"

# Optional: set this to True if you want to invoke Lambda directly (using boto3)
# Note: This requires your local environment to have AWS credentials configured.
USE_LAMBDA_INVOKE = False
LAMBDA_FUNCTION_NAME = "opsflow-alert-normalizer"

lambda_client = None
if USE_LAMBDA_INVOKE:
    import boto3
    lambda_client = boto3.client('lambda')

# === Synthetic Incident Generator ===

def generate_incident():
    """
    Create a realistic synthetic incident alert with random attributes.
    """
    incident_id = str(uuid.uuid4())
    now = int(time.time())

    services = ["auth-service", "payment-gateway", "search-engine", "inventory-db", "frontend-ui"]
    severity_levels = ["INFO", "WARN", "ERROR", "CRITICAL"]
    event_types = ["LatencySpike", "ErrorRateIncrease", "Timeouts", "ResourceExhaustion", "ServiceDown"]

    incident = {
        "incidentId": incident_id,
        "timestamp": now,
        "service": random.choice(services),
        "severity": random.choices(severity_levels, weights=[10, 30, 40, 20])[0],
        "eventType": random.choice(event_types),
        "metrics": {
            "errorRate": round(random.uniform(0, 0.5), 3),
            "latencyMs": random.randint(50, 1500),
            "cpuUsagePercent": round(random.uniform(10, 90), 2),
            "memoryUsagePercent": round(random.uniform(10, 90), 2)
        },
        "message": "Synthetic alert generated for testing OpsFlow pipeline"
    }
    return incident

def send_incident_to_api(incident):
    """
    Send the incident alert JSON payload via HTTP POST to the API Gateway URL.
    """
    print(f"Sending incident {incident['incidentId']} to {API_GATEWAY_URL}...")
    headers = {"Content-Type": "application/json"}
    try:
        resp = requests.post(API_GATEWAY_URL, data=json.dumps(incident), headers=headers, timeout=10)
        if resp.status_code == 200:
            print(f"[+] Sent incident {incident['incidentId']} successfully. Response: {resp.json()}")
        else:
            print(f"[!] Failed to send incident {incident['incidentId']}. Status code: {resp.status_code}, Response: {resp.text}")
    except requests.exceptions.RequestException as e:
        print(f"[!] HTTP Request failed: {e}")
        print("[!] Please ensure the API_GATEWAY_URL is correct and the stack is deployed.")


def invoke_lambda_directly(incident):
    """
    Invoke the alert_normalizer Lambda function directly via boto3.
    """
    print(f"Invoking Lambda {LAMBDA_FUNCTION_NAME} directly for incident {incident['incidentId']}...")
    payload = json.dumps(incident)
    try:
        resp = lambda_client.invoke(
            FunctionName=LAMBDA_FUNCTION_NAME,
            InvocationType='RequestResponse',  # Use 'Event' for async, 'RequestResponse' to see the return value
            Payload=payload
        )
        status_code = resp['StatusCode']
        response_payload = json.loads(resp['Payload'].read())
        if status_code == 200:
            print(f"[+] Lambda invoked successfully for incident {incident['incidentId']}. Response: {response_payload}")
        else:
            print(f"[!] Lambda invocation failed with status {status_code}. Response: {response_payload}")
    except Exception as e:
        print(f"[!] Failed to invoke lambda: {e}")


# === Main Simulation Loop ===

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Synthetic incident generator for OpsFlow")
    parser.add_argument("--count", type=int, default=5, help="Number of incidents to send")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay between sends (seconds)")
    parser.add_argument("--use-lambda", action="store_true", help="Invoke Lambda directly instead of API Gateway")
    parser.add_argument("--api-url", type=str, default=API_GATEWAY_URL, help="Override the API Gateway URL")

    args = parser.parse_args()

    # Update the global URL if provided via command line
    API_GATEWAY_URL = args.api_url

    print("--- Starting Incident Simulation ---")
    for i in range(args.count):
        incident = generate_incident()
        if args.use_lambda or USE_LAMBDA_INVOKE:
            if not lambda_client:
                print("[!] Boto3 is not initialized. Please set USE_LAMBDA_INVOKE = True at the top of the script.")
                break
            invoke_lambda_directly(incident)
        else:
            send_incident_to_api(incident)

        if i < args.count -1:
            time.sleep(args.delay)

    print("--- Simulation Complete ---")
