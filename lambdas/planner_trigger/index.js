import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const REGION = process.env.AWS_REGION;
const PLANNER_LAMBDA_NAME = process.env.PLANNER_LAMBDA_NAME;
const lambdaClient = new LambdaClient({ region: REGION });

export const handler = async (event) => {
    console.log(`Received ${event.Records.length} DDB stream records.`);

    for (const record of event.Records) {
        // Only process updates, not inserts or deletes initially
        if (record.eventName !== 'MODIFY') {
            console.log(`Skipping event type: ${record.eventName}`);
            continue;
        }

        // Ensure NewImage exists and has content
        if (!record.dynamodb || !record.dynamodb.NewImage) {
            console.warn('Skipping record without NewImage:', record.eventID);
            continue;
        }


        try {
            // Unmarshall the "New" image from the DDB stream
            const newImage = unmarshall(record.dynamodb.NewImage);
            const incidentId = newImage.incidentId; // Get ID early for logging

            if (!incidentId) {
                console.warn('Skipping record with missing incidentId in NewImage:', record.eventID);
                continue;
            }
            const isDetected = newImage.isAnomaly !== undefined && newImage.isAnomaly !== null;

            const isRetrieved = Array.isArray(newImage.retrievedContext) && newImage.retrievedContext.length > 0;


            const isNotPlanned = newImage.remediationPlan === null || typeof newImage.remediationPlan === 'undefined';


            // Log the state for debugging
            console.log(`Checking incident ${incidentId}: Detected=${isDetected}, Retrieved=${isRetrieved}, NotPlanned=${isNotPlanned}`);


            if (isDetected && isRetrieved && isNotPlanned) {
                console.log(`Incident ${incidentId} is READY for planning. Invoking planner...`);

                const invokeParams = {
                    FunctionName: PLANNER_LAMBDA_NAME,
                    InvocationType: 'Event', // Async invocation
                    Payload: JSON.stringify({ incidentId: incidentId }), // Pass only the ID
                };

                await lambdaClient.send(new InvokeCommand(invokeParams));
                console.log(`Successfully invoked planner for ${incidentId}`);

            } else {
                // More detailed logging why it's not ready
                let reason = [];
                if (!isDetected) reason.push("Detection not complete");
                if (!isRetrieved) reason.push("Retrieval not complete");
                if (!isNotPlanned) reason.push("Plan already exists or field present");
                console.log(`Incident ${incidentId} not ready. Reason: ${reason.join(', ')}`);
            }
        } catch (error) {
            console.error('Error processing DDB stream record:', error, record.eventID);
            // Optional: Add logic here to update DDB item with a trigger failure status
        }
    }
};