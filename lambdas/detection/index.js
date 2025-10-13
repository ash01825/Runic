import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.TABLE_NAME;
const ANOMALY_THRESHOLD = 0.7; // Incidents with a score >= 0.7 are considered anomalies

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

/**
 * This Lambda receives an incident payload, determines an anomaly score,
 * and updates the incident in DynamoDB.
 */
export const handler = async (event) => {
    // The event is the direct payload from the invoking ingest_processor Lambda
    console.log('Received event:', JSON.stringify(event, null, 2));

    try {
        const incidentId = event.incidentId;
        // Ensure metricValue is a number, default to 0 if not present
        const metricValue = parseFloat(event.metricValue || 0);

        if (!incidentId) {
            console.error('Fatal: Incident ID is missing from the event payload.');
            return; // Exit gracefully
        }

        // 🧠 Simple rule-based scoring logic
        let anomalyScore = 0;
        if (metricValue > 90) anomalyScore = 1.0;
        else if (metricValue > 70) anomalyScore = 0.9;
        else if (metricValue > 50) anomalyScore = 0.7;
        else if (metricValue > 30) anomalyScore = 0.5;
        else anomalyScore = 0.3;

        const isAnomaly = anomalyScore >= ANOMALY_THRESHOLD;

        // Update the existing incident in DynamoDB with detection results
        const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { incidentId },
            UpdateExpression: 'SET #anomalyScore = :score, #isAnomaly = :anomaly, #detectionTimestamp = :ts',
            ExpressionAttributeNames: {
                '#anomalyScore': 'anomalyScore',
                '#isAnomaly': 'isAnomaly',
                '#detectionTimestamp': 'detectionTimestamp'
            },
            ExpressionAttributeValues: {
                ':score': anomalyScore,
                ':anomaly': isAnomaly,
                ':ts': new Date().toISOString()
            },
            ReturnValues: 'ALL_NEW'
        });

        await docClient.send(command);

        console.log(`Incident ${incidentId} updated. Anomaly: ${isAnomaly}, Score: ${anomalyScore}`);

    } catch (err) {
        console.error('Detection error:', {
            error: err.message,
            incidentId: event.incidentId
        });
    }
};
