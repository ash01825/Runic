import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.TABLE_NAME;

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {

    try {
        const incidentId = event.incidentId;

        }

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
        });

        await docClient.send(command);


    } catch (err) {
            error: err.message,
        });
    }
};