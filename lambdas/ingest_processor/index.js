import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { log, getCurrentISOTime } from "./utils.js";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.TABLE_NAME;
const DETECTION_LAMBDA_NAME = process.env.DETECTION_LAMBDA_NAME;
const RETRIEVER_LAMBDA_NAME = process.env.RETRIEVER_LAMBDA_NAME;

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);
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
                retrievedContext: null,
                plan: null,
                resolution: null
            };

            await docClient.send(new PutCommand({
                TableName: TABLE_NAME,
                Item: enrichedIncident
            }));

            log("Incident ingested", { incidentId: enrichedIncident.incidentId });

            const downstreamTasks = [];

            if (DETECTION_LAMBDA_NAME) {
                const invokeParams = {
                    FunctionName: DETECTION_LAMBDA_NAME,
                    InvocationType: 'Event',
                    Payload: JSON.stringify(enrichedIncident),
                };
                downstreamTasks.push(lambdaClient.send(new InvokeCommand(invokeParams)));
            }

            if (RETRIEVER_LAMBDA_NAME) {
                const invokeParams = {
                    FunctionName: RETRIEVER_LAMBDA_NAME,
                    InvocationType: 'Event',
                    Payload: JSON.stringify(enrichedIncident),
                };
                downstreamTasks.push(lambdaClient.send(new InvokeCommand(invokeParams)));
            }

            if (downstreamTasks.length > 0) {
                await Promise.all(downstreamTasks);
                log("Triggered downstream processing", {
                    incidentId: enrichedIncident.incidentId,
                    tasksTriggered: downstreamTasks.length
                });
            }

        } catch (error) {
            log("Error processing record", {
                error: error.message,
                recordBody: record.body
            });
        }
    }
};

