import json
import random
import time
import uuid
import requests
import argparse
import boto3

# ==============================================================================
# ⚙️ CONFIGURATION - UPDATE THIS SECTION
# ==============================================================================

# 1. Paste your API Gateway endpoint URL from the `cdk deploy` output.
API_GATEWAY_URL = "https://9e1sqol6ki.execute-api.ap-south-1.amazonaws.com/prod/alerts"

# 2. (Optional) Set to True to bypass the API and invoke the normalizer Lambda directly.
USE_LAMBDA_INVOKE = False
LAMBDA_FUNCTION_NAME = "opsflow-alert-normalizer"

# ==============================================================================
# INCIDENT GENERATOR FUNCTIONS
# ==============================================================================

def generate_cpu_spike_incident():
    """Generates a structured log for a high CPU event."""
    return {
        # --- FIXED: Standardized timestamp to ISO 8601 format ---
        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "service": "auth-service",
        "level": "ERROR",
        "msg": "High resource warning; triggering ResourceExhaustion event",
        "eventType": "ResourceExhaustion",
        "details": {
            "cpu_utilization_percent": round(random.uniform(92.0, 99.5), 2),
            "p99_latency_ms": random.randint(2100, 3500),
            "task_id": str(uuid.uuid4())
        }
    }

def generate_crash_loop_incident():
    """Generates a structured log for a service in a crash loop."""
    return {
        "alertName": "ServiceUnhealthy",
        "source": "ECS",
        "severity": "CRITICAL",
        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "eventType": "ServiceDown",
        "serviceName": "search-engine",
        "reason": "Service has been restarting continuously.",
        "details": {
            "restartCount": random.randint(6, 15),
            "timeWindowMinutes": 10,
            "lastError": "Container health check failed"
        }
    }

def generate_api_error_incident():
    """Generates a structured log for a 5xx error from API Gateway."""
    return {
        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "service": "api-gateway",
        "level": "ERROR",
        "msg": "Backend integration timed out",
        "eventType": "ApiError",
        "details": {
            "endpoint": "/v1/checkout",
            "httpStatus": 504,
            "integrationLatency": random.randint(29000, 31000)
        }
    }

def generate_db_latency_incident():
    """Generates a structured log for high database latency."""
    return {
        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "service": "payment-gateway",
        "level": "WARN",
        "msg": "High DB query latency detected",
        "eventType": "LatencySpike",
        "details": {
            "dependency": "inventory-db",
            "p99_latency_ms": random.randint(1500, 3000),
            "threshold_ms": 1000,
        }
    }

def generate_dns_error_incident():
    """Generates a structured log for a DNS resolution failure."""
    return {
        "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "service": "frontend-ui",
        "level": "ERROR",
        "msg": "Application startup failed due to DNS resolution failure",
        "eventType": "Timeouts",
        "details": {
            "error": "Could not establish connection to backend service.",
            "stackTrace": "java.net.UnknownHostException: payment-gateway.internal.opsflow.local: Temporary failure in name resolution"
        }
    }

# List of all our generator functions
incident_generators = [
    generate_cpu_spike_incident,
    generate_crash_loop_incident,
    generate_api_error_incident,
    generate_db_latency_incident,
    generate_dns_error_incident
]

def send_incident_to_api(incident):
    """Sends the incident to the API Gateway endpoint via HTTP POST."""
    incident_id = incident.get("incidentId", str(uuid.uuid4()))
    print(f"Sending incident {incident_id} ({incident.get('eventType')}) to API Gateway...")
    headers = {"Content-Type": "application/json"}
    try:
        resp = requests.post(API_GATEWAY_URL, data=json.dumps(incident), headers=headers, timeout=10)
        if resp.status_code == 200:
            print(f"  [✅] Success! Response: {resp.json()}")
        else:
            print(f"  [❌] Failed (Status: {resp.status_code}). Response: {resp.text}")
    except requests.exceptions.RequestException as e:
        print(f"  [❌] HTTP error: {e}")

def invoke_lambda_directly(incident, lambda_client):
    """Calls the Lambda function directly using boto3."""
    incident_id = incident.get("incidentId", str(uuid.uuid4()))
    print(f"Invoking Lambda '{LAMBDA_FUNCTION_NAME}' for incident {incident_id}...")
    try:
        resp = lambda_client.invoke(
            FunctionName=LAMBDA_FUNCTION_NAME,
            InvocationType='RequestResponse',
            Payload=json.dumps(incident)
        )
        status_code = resp['StatusCode']
        response_payload = json.loads(resp['Payload'].read())
        if 200 <= status_code < 300:
            print(f"  [✅] Lambda invocation successful. Response: {response_payload}")
        else:
            print(f"  [❌] Lambda returned status {status_code}. Response: {response_payload}")
    except Exception as e:
        print(f"  [❌] Lambda invocation failed: {e}")

# ==============================================================================
# MAIN EXECUTION
# ==============================================================================

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Synthetic incident generator for OpsFlow")
    parser.add_argument("--count", type=int, default=5, help="Number of incidents to send")
    parser.add_argument("--delay", type=float, default=2.0, help="Delay (in seconds) between incidents")
    args = parser.parse_args()

    if "PASTE_YOUR_API_GATEWAY_URL_HERE" in API_GATEWAY_URL and not USE_LAMBDA_INVOKE:
        print("\n[🚨 ERROR] Please update the 'API_GATEWAY_URL' variable in this script with your deployment output.")
        exit(1)

    lambda_client = boto3.client('lambda') if USE_LAMBDA_INVOKE else None

    print("\n--- Starting OpsFlow Incident Simulation ---")

    for i in range(args.count):
        generator_func = random.choice(incident_generators)
        incident = generator_func()

        if USE_LAMBDA_INVOKE:
            invoke_lambda_directly(incident, lambda_client)
        else:
            send_incident_to_api(incident)

        if i < args.count - 1:
            time.sleep(args.delay)

    print("\n--- Simulation Complete ---")