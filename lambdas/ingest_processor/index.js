import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { log, getCurrentISOTime } from "./utils.js";
// MODIFIED: Import the Lambda client and InvokeCommand
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.TABLE_NAME;
// MODIFIED: Get the detection lambda name from environment variables
const DETECTION_LAMBDA_NAME = process.env.DETECTION_LAMBDA_NAME;

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);
// MODIFIED: Create a new Lambda client
const lambdaClient = new LambdaClient({ region: REGION });

/**
 * Lambda handler for processing normalized incident messages from SQS.
 */
export const handler = async (event) => {
    for (const record of event.Records) {
        try {
            const body = JSON.parse(record.body);

            if (!body.incidentId) {
                log("Skipping record: missing incidentId", { recordBody: record.body });
                continue;
            }

            const enrichedIncident = {
                ...body,
                receivedAt: getCurrentISOTime(),
                status: "RECEIVED",
                anomalyScore: null,
                isAnomaly: false,
                plan: null,
                resolution: null
            };

            await docClient.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: enrichedIncident
            }));

            log("Incident ingested", { incidentId: enrichedIncident.incidentId });

            // MODIFIED: After successfully ingesting, invoke the detection Lambda asynchronously
            if (DETECTION_LAMBDA_NAME) {
                const invokeParams = {
                    FunctionName: DETECTION_LAMBDA_NAME,
                    InvocationType: 'Event', // Asynchronous invocation
                    Payload: JSON.stringify(enrichedIncident),
                };

                await lambdaClient.send(new InvokeCommand(invokeParams));
                log("Triggered detection lambda", { incidentId: enrichedIncident.incidentId });
            }

        } catch (error) {
            log("Error processing record", {
                error: error.message,
                recordBody: record.body
            });
        }
    }
};
