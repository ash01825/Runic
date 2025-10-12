const AWS = require('aws-sdk');
const sqs = new AWS.SQS();

const QUEUE_URL = process.env.QUEUE_URL; // set via environment variable in CDK

exports.handler = async (event) => {
    try {
        console.log("Received event:", JSON.stringify(event));

        const body = event.body ? JSON.parse(event.body) : event;

        // Simple normalization logic
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
