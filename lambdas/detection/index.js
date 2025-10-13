import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.TABLE_NAME;
const ANOMALY_THRESHOLD = 0.7;

const ddbClient = new DynamoDBClient({ region: REGION });
// THIS IS THE FIX: The typo "DynamoDBDocument_Client" has been corrected to "DynamoDBDocumentClient".
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {
    console.log(`Received detection event for incident: ${event.incidentId}`);

    try {
        const incidentId = event.incidentId;
        // The value is nested. This is the critical logic fix from our debugging.
        const rawMetricValue = event.rawPayload ? event.rawPayload.metricValue : undefined;

        if (!incidentId || rawMetricValue === undefined) {
            console.error('Fatal: Incident ID or metricValue is missing from the event payload.', { incidentId });
            return;
        }

        const metricValue = parseFloat(rawMetricValue);

        // Simple rule-based scoring logic
        let anomalyScore = 0;
        if (metricValue > 90)      anomalyScore = 1.0;
        else if (metricValue > 70) anomalyScore = 0.9;
        else if (metricValue > 50) anomalyScore = 0.7;
        else if (metricValue > 30) anomalyScore = 0.5;
        else                       anomalyScore = 0.3;

        const isAnomaly = anomalyScore >= ANOMALY_THRESHOLD;

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
            }
        });

        await docClient.send(command);

        console.log(`Successfully processed detection for incident ${incidentId}. Score: ${anomalyScore}, Anomaly: ${isAnomaly}`);

    } catch (err) {
        console.error('--- CRITICAL DETECTION ERROR ---', {
            error: err.message,
            stack: err.stack,
            incidentId: event ? event.incidentId : 'Unknown'
        });
    }
};