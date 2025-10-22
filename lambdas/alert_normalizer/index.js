import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { randomUUID } from "crypto";

const sqs = new SQSClient({});
const QUEUE_URL = process.env.QUEUE_URL;

/**
 * Extracts the primary metric value based on event type.
 * Tries to find a relevant number for the anomaly detector.
 */
function extractPrimaryMetricValue(payload) {
    // Priority 1: Check standardized details first
    if (payload.incidentDetails?.primaryMetricValue !== undefined) {
        return payload.incidentDetails.primaryMetricValue;
    }

    // Priority 2: Check common top-level metric fields
    if (payload.metricValue !== undefined) return payload.metricValue;
    if (payload.value !== undefined) return payload.value; // Common in CW alarms

    // Priority 3: Check inside nested 'details' based on known structures
    const details = payload.details || payload.rawPayload?.details; // Check both possibilities
    if (details) {
        // Handle rawPayload structure (like ECS alert)
        if(details.M) {
            if (details.M.cpu_utilization_percent?.N) return parseFloat(details.M.cpu_utilization_percent.N);
            if (details.M.restartCount?.N) return parseFloat(details.M.restartCount.N); // Extract ECS restart count
            if (details.M.integrationLatency?.N) return parseFloat(details.M.integrationLatency.N); // Extract API GW latency
            // Add more specific extractions here based on alert types...
        }
        // Handle direct details structure
        else {
            if (details.cpu_utilization_percent !== undefined) return details.cpu_utilization_percent;
            if (details.restartCount !== undefined) return details.restartCount;
            if (details.integrationLatency !== undefined) return details.integrationLatency;
            // Add more specific extractions here...
        }
    }

    // Priority 4: Check rawPayload directly for some common fields
    const raw = payload.rawPayload || {};
    if (raw.metricValue !== undefined) return raw.metricValue;
    if (raw.value !== undefined) return raw.value;


    // Fallback: If no specific metric found, return 1.0 for error types, 0.0 otherwise
    // This gives the anomaly detector *something* to score.
    const eventType = payload.eventType || payload.rawPayload?.eventType?.S || "";
    const level = payload.severity || payload.rawPayload?.level?.S || "";

    if (eventType.includes("Error") || eventType.includes("Failure") || eventType.includes("Down") || level === "ERROR" || level === "CRITICAL") {
        return 1.0;
    }

    return 0.0; // Default for non-error events if no metric found
}


/**
 * Creates a standardized message from various alert formats.
 * NOW includes better primary metric extraction.
 */
function normalizePayload(payload) {
    const incidentId = payload.incidentId || randomUUID();
    let standardizedDetails = {};

    // --- Add intelligent parsing logic here ---
    const rawPayload = payload.rawPayload || payload; // Use rawPayload if it exists, otherwise assume payload is raw
    const detailsSource = rawPayload.details?.M || rawPayload.details || {}; // Handle both potential structures

    // Specific parsing based on source or alertName if available
    const source = rawPayload.source?.S || rawPayload.source || "unknown";
    const alertName = rawPayload.alertName?.S || rawPayload.alertName;
    const eventType = rawPayload.eventType?.S || rawPayload.eventType || "GenericAlert";

    // --- Populate standardizedDetails ---
    // Example: If it's a known CloudWatch metric alarm
    if (alertName && rawPayload.metric) {
        standardizedDetails.primaryMetricName = rawPayload.metric;
        standardizedDetails.primaryMetricValue = rawPayload.value; // Already handled by extractPrimaryMetricValue, but good to keep
    }
    // Example: ECS alert specific details
    else if (source === "ECS" && eventType === "ServiceDown") {
        standardizedDetails.restartCount = detailsSource.restartCount?.N ? parseInt(detailsSource.restartCount.N) : undefined;
        standardizedDetails.lastError = detailsSource.lastError?.S;
    }
    // Example: API Gateway error specific details
    else if (source === "api-gateway" && eventType === "ApiError") {
        standardizedDetails.endpoint = detailsSource.endpoint?.S;
        standardizedDetails.integrationLatency = detailsSource.integrationLatency?.N ? parseInt(detailsSource.integrationLatency.N) : undefined;
        standardizedDetails.httpStatus = detailsSource.httpStatus?.N ? parseInt(detailsSource.httpStatus.N) : undefined;
    }
    // Example: DNS error from frontend
    else if (rawPayload.service === "frontend-ui" && eventType === "Timeouts") {
        standardizedDetails.errorMessage = detailsSource.error?.S;
        standardizedDetails.stackTrace = detailsSource.stackTrace?.S;
    }
    // Add more specific parsing rules here...


    // --- Extract the primary metric VALUE using the helper function ---
    const primaryValue = extractPrimaryMetricValue(rawPayload);
    if (primaryValue !== undefined && standardizedDetails.primaryMetricValue === undefined) {
        standardizedDetails.primaryMetricValue = primaryValue;
    }
    // Attempt to find a metric name if not set
    if (!standardizedDetails.primaryMetricName) {
        if (rawPayload.metric) standardizedDetails.primaryMetricName = rawPayload.metric;
        else if (detailsSource.cpu_utilization_percent) standardizedDetails.primaryMetricName = "cpu_utilization_percent";
        else if (detailsSource.restartCount) standardizedDetails.primaryMetricName = "restartCount";
        else if (detailsSource.integrationLatency) standardizedDetails.primaryMetricName = "integrationLatency";
        // Add more name logic...
        else standardizedDetails.primaryMetricName = "unknown_metric";
    }


    let normalized = {
        incidentId: incidentId,
        source: source,
        service: rawPayload.serviceName?.S || rawPayload.service || "unknown-service",
        severity: rawPayload.severity?.S || rawPayload.level?.S || "INFO",
        eventType: eventType,
        message: rawPayload.msg?.S || rawPayload.reason?.S || rawPayload.message || "No message provided.",
        timestamp: rawPayload.timestamp?.S ? new Date(rawPayload.timestamp.S).toISOString() : new Date().toISOString(),
        incidentDetails: standardizedDetails, // Use the populated standardized details
        rawPayload: rawPayload // Keep the original structure too
    };

    return normalized;
}

export const handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        // Determine if the actual body is nested inside event.body (API GW) or if event is the body (Lambda Invoke)
        const body = event.body ? JSON.parse(event.body) : event;

        // Pass the raw body to normalizePayload
        const normalized = normalizePayload(body);

        const sqsCommand = new SendMessageCommand({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify(normalized) // Send the *normalized* structure
        });

        console.log("Sending normalized message to SQS:", JSON.stringify(normalized, null, 2));
        await sqs.send(sqsCommand);

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                success: true,
                incidentId: normalized.incidentId,
                message: "Incident accepted for processing"
            })
        };

    } catch (error) {
        console.error("Error processing alert:", error);
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                success: false,
                error: error.message
            })
        };
    }
};