const AWS = require('aws-sdk');
const sqs = new AWS.SQS();

// Set by the deployment environment (e.g. CDK)
const QUEUE_URL = process.env.QUEUE_URL;

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event));

        // Support both direct invocation and HTTP-based (API Gateway) events
        const body = event.body ? JSON.parse(event.body) : event;

        // Normalize the incoming payload
        const normalized = {
            incidentId: body.id || `incident-${Date.now()}`,
            source: body.source || 'unknown',
            message: body.message || 'no message',
            timestamp: body.timestamp || new Date().toISOString(),
            raw: body
        };

        const sqsParams = {
            QueueUrl: QUEUE_URL,
            MessageBody: JSON.stringify(normalized)
        };

        console.log(`Sending normalized message to ${QUEUE_URL}`);
        await sqs.sendMessage(sqsParams).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, incidentId: normalized.incidentId })
        };

    } catch (error) {
        console.error("Error in alert_normalizer:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message })
        };
    }
};
