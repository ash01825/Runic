import {
    BedrockRuntimeClient,
    InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    GetCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// --- ES Module Path Fix ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Bedrock and DynamoDB Clients ---
const REGION = process.env.AWS_REGION || 'us-east-1';
const TABLE_NAME = process.env.TABLE_NAME;
const MODEL_ID = 'meta.llama3-70b-instruct-v1:0';

const bedrockClient = new BedrockRuntimeClient({ region: REGION });
const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// --- Load the prompt template ---
const PROMPT_TEMPLATE = fs.readFileSync(
    path.resolve(__dirname, 'prompt_template.md'),
    'utf-8'
);

// --- Helper for exponential backoff ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Extracts a JSON object from a string, logging raw output on failure.
 */
function extractJson(text) {
    const strictMatch = text.trim().match(/^\{[\s\S]*\}$/);
    if (strictMatch) {
        try {
            JSON.parse(strictMatch[0]);
            return strictMatch[0];
        } catch (e) {
            console.warn("Strict JSON match failed validation, trying lenient extraction.", e.message);
        }
    }

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');

    if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
        console.error("<<< INVALID LLM OUTPUT START >>>");
        console.error(text); // Log the entire bad output
        console.error("<<< INVALID LLM OUTPUT END >>>");
        throw new Error('No valid JSON object boundaries found in LLM response.');
    }

    const potentialJson = text.substring(firstBrace, lastBrace + 1);

    try {
        JSON.parse(potentialJson);
        console.log("Lenient JSON extraction successful.");
        return potentialJson;
    } catch (e) {
        console.error("<<< RAW LLM OUTPUT (JSON PARSE FAILED) START >>>");
        console.error(text); // Log the entire bad output
        console.error("<<< RAW LLM OUTPUT (JSON PARSE FAILED) END >>>");
        console.error("Failed to parse leniently extracted JSON:", potentialJson);
        throw new Error(`Failed to parse extracted JSON: ${e.message}`); // Re-throw with parse error
    }
}


/**
 * Fills the prompt template with incident data.
 */
function buildPrompt(template, incident) {
    // ... (Keep the buildPrompt function exactly as it was before) ...
    const incidentData = {
        incidentId: incident.incidentId,
        service: incident.service,
        message: incident.message,
        anomalyScore: incident.anomalyScore,
        isAnomaly: incident.isAnomaly,
    };

    const logs =
        incident.retrievedContext
            ?.map((c) => `- ${c.contentSnippet}`)
            .join('\n') || 'No logs retrieved.';
    const runbooks =
        incident.retrievedContext
            ?.map((c) => `- ${c.document} (Section: ${c.section})`)
            .join('\n') || 'No runbooks retrieved.';

    return template
        .replace('{incident_json}', JSON.stringify(incidentData, null, 2))
        .replace('{logs}', logs)
        .replace('{runbooks}', runbooks);
}

/**
 * Main Lambda Handler
 */
export const handler = async (event) => {
    console.log('Planner received event:', event);
    const { incidentId } = event;

    if (!incidentId) {
        console.error('No incidentId provided.');
        return; // Exit early if no ID
    }

    // --- Initialize error message variable ---
    let errorMessage = "Unknown planning error";

    try {
        // --- 1. Get Incident from DynamoDB ---
        // ... (Keep GetCommand exactly as before) ...
        const getResult = await docClient.send(
            new GetCommand({
                TableName: TABLE_NAME,
                Key: { incidentId },
            })
        );
        if (!getResult.Item) {
            throw new Error(`Incident ${incidentId} not found.`);
        }
        const incident = getResult.Item;


        // --- 2. Build the Prompt ---
        // ... (Keep prompt building exactly as before) ...
        const filledPrompt = buildPrompt(PROMPT_TEMPLATE, incident);


        // --- 3. Build the Llama 3 Payload ---
        // ... (Keep payload exactly as before) ...
        const bedrockPayload = {
            prompt: `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\nYou are an expert incident response AI. Follow all instructions precisely.<|eot_id|><|start_header_id|>user<|end_header_id|>\n\n${filledPrompt}<|eot_id|><|start_header_id|>assistant<|end_header_id|>\n\n`,
            max_gen_len: 2048,
            temperature: 0.0,
        };


        // --- 4. Call Bedrock with MAX RETRIES ---
        console.log(`Invoking Bedrock (${MODEL_ID}) for incident ${incidentId}...`);
        const command = new InvokeModelCommand({
            modelId: MODEL_ID,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify(bedrockPayload),
        });

        let response;
        let attempts = 0;
        // --- HACKATHON FIX: Aggressive Retries ---
        const maxAttempts = 7; // Increased attempts
        let baseDelayMs = 3000; // Increased base delay (3 seconds)

        while (attempts < maxAttempts) {
            try {
                response = await bedrockClient.send(command);
                console.log(`Bedrock call successful on attempt ${attempts + 1} for ${incidentId}`);
                break; // Success!
            } catch (error) {
                attempts++;
                // --- HACKATHON FIX: Catch more rate limit variants ---
                const isRateLimitError = (
                    error.name === 'ThrottlingException' ||
                    error.name === 'TooManyRequestsException' ||
                    error.name === 'LimitExceededException' || // Another possible name
                    error.name === 'AccessDeniedException' || // Can indicate concurrent call limits
                    (error.$metadata && error.$metadata.httpStatusCode === 429)
                );

                if (isRateLimitError && attempts < maxAttempts) {
                    const jitter = Math.random() * 1500; // Add 0-1.5s jitter
                    const waitTime = baseDelayMs * Math.pow(2, attempts - 1) + jitter;
                    console.warn(`Bedrock rate limited for ${incidentId} (attempt ${attempts}/${maxAttempts}). Name: ${error.name}. Retrying in ${(waitTime / 1000).toFixed(1)}s...`);
                    await delay(waitTime);
                } else {
                    console.error(`Bedrock call failed definitively on attempt ${attempts} for ${incidentId}:`, error);
                    errorMessage = error.message || JSON.stringify(error); // Capture error message
                    throw error; // Propagate the error to the main catch block
                }
            }
        }

        if (!response) {
            errorMessage = `Bedrock call failed after ${maxAttempts} retries (likely rate limiting).`;
            throw new Error(errorMessage);
        }

        // --- 5. Parse and Validate Plan ---
        const responseText = new TextDecoder().decode(response.body);
        const responseBody = JSON.parse(responseText); // This parses the outer Bedrock response structure
        const llmGeneration = responseBody.generation;

        console.log(`Received generation from LLM for ${incidentId}:`, llmGeneration);
        // Now parse the actual JSON *generated by* the LLM
        const planJsonString = extractJson(llmGeneration); // Will throw if invalid
        const plan = JSON.parse(planJsonString);
        console.log(`Parsed plan successfully for ${incidentId}:`, plan);


        // --- 6. Risk Gating Logic ---
        // ... (Keep risk gating exactly as before) ...
        const risk = plan.risk || 'HIGH';
        plan.requiresManualApproval = risk === 'HIGH' || risk === 'MEDIUM';


        // --- 7. Update DynamoDB with the Plan ---
        // ... (Keep UpdateCommand exactly as before) ...
        const updateCommand = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { incidentId },
            UpdateExpression:
                'SET #plan = :plan, #status = :status, #planningTimestamp = :ts REMOVE #error', // Remove error on success
            ExpressionAttributeNames: {
                '#plan': 'remediationPlan',
                '#status': 'status',
                '#planningTimestamp': 'planningTimestamp',
                '#error': 'error', // Define error attribute name
            },
            ExpressionAttributeValues: {
                ':plan': plan,
                ':status': 'PLAN_GENERATED',
                ':ts': new Date().toISOString(),
            },
        });

        await docClient.send(updateCommand);
        console.log(`Successfully generated and saved plan for ${incidentId}`);

    } catch (error) {
        // Use the captured error message if available, otherwise use the catch block error
        const finalErrorMessage = (errorMessage !== "Unknown planning error") ? errorMessage : (error.message || JSON.stringify(error));

        console.error(`--- CRITICAL PLANNER ERROR for ${incidentId} ---`, {
            error: finalErrorMessage,
            stack: error.stack,
        });
        // Update DDB with FAILED status and the specific error
        await docClient.send(
            new UpdateCommand({
                TableName: TABLE_NAME,
                Key: { incidentId },
                UpdateExpression: 'SET #status = :status, #error = :error',
                ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
                ExpressionAttributeValues: {
                    ':status': 'PLANNING_FAILED',
                    ':error': finalErrorMessage.substring(0, 500), // Limit error message
                },
            })
        );
    }
};