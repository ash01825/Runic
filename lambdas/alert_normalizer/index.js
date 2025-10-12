const AWS = require('aws-sdk');
const sqs = new AWS.SQS();

const QUEUE_URL = process.env.QUEUE_URL;

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event, null, 2));

        // Parse incoming payload; use event.body if triggered via API Gateway
        const body = event.body ? JSON.parse(event.body) : event;

        // Normalize the incoming alert into a standard format
        const normalized = {
            incidentId: body.incidentId,
            source: "synthetic-generator", // Fixed source for now
            service: body.service,
            severity: body.severity,
            eventType: body.eventType,
            message: body.message,
            metrics: body.metrics || {},
            logsContext: null,             // Placeholder for future enrichment
            recentDeploys: [],             // Placeholder for future enrichment
            timestamp: new Date(body.timestamp * 1000).toISOString(), // Unix -> ISO 8601
            rawPayload: body               // Retain original for traceability
        };

        const sqsParams = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify(normalized)
        };

        console.log("Sending normalized message to SQS:", JSON.stringify(normalized, null, 2));
        await sqs.sendMessage(sqsParams).promise();

        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                success: true,
                incidentId: normalized.incidentId,
                message: "Incident accepted"
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
