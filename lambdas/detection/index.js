import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
// --- ADD THESE IMPORTS ---
import { SageMakerRuntimeClient, InvokeEndpointCommand } from "@aws-sdk/client-sagemaker-runtime";

const REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.TABLE_NAME;
// --- ADD THIS LINE ---
const SAGEMAKER_ENDPOINT_NAME = process.env.SAGEMAKER_ENDPOINT_NAME;

const ANOMALY_THRESHOLD = 1.0; // RCF scores > 1.0 are typically strong anomaly indicators

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);
// --- ADD THIS LINE ---
const sagemakerClient = new SageMakerRuntimeClient({ region: REGION });

export const handler = async (event) => {
    console.log(`Received detection event for incident: ${event.incidentId}`);

    try {
        const incidentId = event.incidentId;
        const rawMetricValue = event.rawPayload ? event.rawPayload.metricValue : undefined;

        if (!incidentId || rawMetricValue === undefined) {
            console.error('Fatal: Incident ID or metricValue is missing.', { incidentId });
            return;
        }

        if (!SAGEMAKER_ENDPOINT_NAME) {
            console.error('Fatal: SAGEMAKER_ENDPOINT_NAME environment variable is not set.');
            return;
        }

        const metricValue = parseFloat(rawMetricValue);

        // --- LOGIC CHANGE: Call SageMaker instead of using rules ---
        console.log(`Invoking SageMaker endpoint: ${SAGEMAKER_ENDPOINT_NAME}`);

        const invokeCommand = new InvokeEndpointCommand({
            EndpointName: SAGEMAKER_ENDPOINT_NAME,
            ContentType: 'text/csv',
            Body: metricValue.toString() // Send the single metric value as a CSV string
        });

        const response = await sagemakerClient.send(invokeCommand);
        const responseBody = new TextDecoder().decode(response.Body);
        const result = JSON.parse(responseBody);

        const anomalyScore = result.scores[0].score;
        // --- END OF LOGIC CHANGE ---

        const isAnomaly = anomalyScore >= ANOMALY_THRESHOLD;

        const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { incidentId },
            UpdateExpression: 'SET #anomalyScore = :score, #isAnomaly = :anomaly, #detectionTimestamp = :ts, #status = :status',
            ExpressionAttributeNames: {
                '#anomalyScore': 'anomalyScore',
                '#isAnomaly': 'isAnomaly',
                '#detectionTimestamp': 'detectionTimestamp',
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':score': anomalyScore,
                ':anomaly': isAnomaly,
                ':ts': new Date().toISOString(),
                ':status': 'DETECTED'
            }
        });

        await docClient.send(command);

        console.log(`Successfully processed detection via SageMaker for incident ${incidentId}. Score: ${anomalyScore}, Anomaly: ${isAnomaly}`);

    } catch (err) {
        console.error('--- CRITICAL DETECTION ERROR ---', {
            error: err.message,
            stack: err.stack,
            incidentId: event ? event.incidentId : 'Unknown'
        });
    }
};
