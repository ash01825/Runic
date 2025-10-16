import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { randomUUID } from "crypto";

const sqs = new SQSClient({});
const QUEUE_URL = process.env.QUEUE_URL;

/**
 * Creates a standardized message from various alert formats.
 * @param {object} payload - The raw alert body.
 * @returns {object} A normalized incident object.
 */
function normalizePayload(payload) {
    const incidentId = payload.incidentId || randomUUID();
    let normalized = {
        incidentId: incidentId,
        source: payload.source || "unknown",
        service: payload.serviceName || payload.service || "unknown-service",
        severity: payload.severity || "INFO",
        eventType: payload.eventType || "GenericAlert",
        message: payload.msg || payload.reason || payload.details || "No message provided.",
        timestamp: payload.timestamp ? new Date(payload.timestamp).toISOString() : new Date().toISOString(),
        incidentDetails: {}, // Standardized details for downstream consumers
        rawPayload: payload
    };

    // --- Add intelligent parsing logic here ---

    // For structured CloudWatch/ECS style alerts
    if (payload.alertName) {
        normalized.message = payload.details || payload.reason;
        if (payload.metric) {
            normalized.incidentDetails.primaryMetricName = payload.metric;
            normalized.incidentDetails.primaryMetricValue = payload.value;
        }
        if (payload.serviceName) {
            normalized.service = payload.serviceName;
        }
    }
    // For our new structured log formats
    else if (payload.details) {
        if (payload.details.cpu_utilization_percent) {
            normalized.incidentDetails.primaryMetricName = "cpu_utilization_percent";
            normalized.incidentDetails.primaryMetricValue = payload.details.cpu_utilization_percent;
        }
    }

    return normalized;
}

export const handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        const body = event.body ? JSON.parse(event.body) : event;
        const normalized = normalizePayload(body);

        const sqsCommand = new SendMessageCommand({
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify(normalized)
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