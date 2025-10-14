import json
import random
import time
import uuid
import requests
import argparse

# Make sure to update this with your API Gateway endpoint URL from the `cdk deploy` output
API_GATEWAY_URL = "https://9e1sqol6ki.execute-api.ap-south-1.amazonaws.com/prod/alerts"

# Set to True to use direct Lambda invocation (requires AWS credentials)
# NOTE: This will bypass your API Gateway and SQS queue for testing the normalizer directly.
USE_LAMBDA_INVOKE = False
LAMBDA_FUNCTION_NAME = "opsflow-alert-normalizer"

lambda_client = None
if USE_LAMBDA_INVOKE:
    import boto3
    lambda_client = boto3.client('lambda')

def generate_incident():
    """
    Generate a synthetic incident with random but realistic values.
    It now includes a top-level 'metricValue' for the detection lambda.
    """
    incident_id = str(uuid.uuid4())
    now = int(time.time())

    services = ["auth-service", "payment-gateway", "search-engine", "inventory-db", "frontend-ui"]
    severity_levels = ["INFO", "WARN", "ERROR", "CRITICAL"]
    event_types = ["LatencySpike", "ErrorRateIncrease", "Timeouts", "ResourceExhaustion", "ServiceDown"]

    # Generate a random CPU value to use for our detection metric
    cpu_usage = 110.0

    return {
        "incidentId": incident_id,
        "timestamp": now,
        "service": random.choice(services),
        "severity": random.choices(severity_levels, weights=[10, 30, 40, 20])[0],
        "eventType": random.choice(event_types),
        # This top-level field is added to be compatible with your detection lambda
        "metricValue": str(cpu_usage),
        "metrics": {
            "errorRate": round(random.uniform(0, 0.5), 3),
            "latencyMs": random.randint(50, 1500),
            "cpuUsagePercent": cpu_usage,
            "memoryUsagePercent": round(random.uniform(10, 90), 2)
        },
        "message": "Synthetic alert generated for testing OpsFlow pipeline"
    }

def send_incident_to_api(incident):
    """
    Send the incident to the API Gateway endpoint via HTTP POST.
    """
    print(f"Sending incident {incident['incidentId']} to {API_GATEWAY_URL}...")
    headers = {"Content-Type": "application/json"}
    try:
        resp = requests.post(API_GATEWAY_URL, data=json.dumps(incident), headers=headers, timeout=10)
        if resp.status_code == 200:
            print(f"[+] Incident {incident['incidentId']} sent successfully. Response: {resp.json()}")
        else:
            print(f"[!] Failed to send incident {incident['incidentId']} (Status: {resp.status_code}). Response: {resp.text}")
    except requests.exceptions.RequestException as e:
        print(f"[!] HTTP error: {e}")
        print("[!] Check that the API_GATEWAY_URL is correct and the API is reachable.")

def invoke_lambda_directly(incident):
    """
    Call the Lambda function directly using boto3.
    """
    print(f"Invoking Lambda '{LAMBDA_FUNCTION_NAME}' for incident {incident['incidentId']}...")
    try:
        resp = lambda_client.invoke(
            FunctionName=LAMBDA_FUNCTION_NAME,
            InvocationType='RequestResponse',
            Payload=json.dumps(incident)
        )
        status_code = resp['StatusCode']
        response_payload = json.loads(resp['Payload'].read())

        if status_code == 200:
            print(f"[+] Lambda response: {response_payload}")
        else:
            print(f"[!] Lambda returned status {status_code}. Response: {response_payload}")
    except Exception as e:
        print(f"[!] Lambda invocation failed: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Synthetic incident generator for OpsFlow")
    parser.add_argument("--count", type=int, default=5, help="Number of incidents to send")
    parser.add_argument("--delay", type=float, default=1.0, help="Delay (in seconds) between incidents")
    parser.add_argument("--use-lambda", action="store_true", help="Invoke Lambda directly instead of API Gateway")
    parser.add_argument("--api-url", type=str, default=API_GATEWAY_URL, help="Override the default API Gateway URL")

    args = parser.parse_args()
    API_GATEWAY_URL = args.api_url

    print("--- Starting Incident Simulation ---")

    for i in range(args.count):
        incident = generate_incident()

        if args.use_lambda or USE_LAMBDA_INVOKE:
            if not lambda_client:
                print("[!] Lambda client not initialized. Set USE_LAMBDA_INVOKE = True to enable.")
                break
            invoke_lambda_directly(incident)
        else:
            send_incident_to_api(incident)

        if i < args.count - 1:
            time.sleep(args.delay)

    print("--- Simulation Complete ---")

