import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { pipeline } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// --- ES Module Path Fix ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.TABLE_NAME;
const MAX_SNIPPET_LENGTH = 500; // --- NEW: Limit snippet length ---

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// --- HELPER FUNCTIONS ---

function parseAndChunkMarkdown(doc) {
    const chunks = [];
    const lines = doc.content.split('\n');
    let currentSection = "Introduction";
    let currentChunkLines = [];

    for (const line of lines) {
        const headerMatch = line.match(/^##\s+(.*)/);
        if (headerMatch) {
            if (currentChunkLines.length > 0) {
                chunks.push({
                    parentDoc: doc.name,
                    section: currentSection,
                    content: currentChunkLines.join('\n').trim()
                });
            }
            currentSection = headerMatch[1].replace(/^[^\w\s]+/, '').trim();
            currentChunkLines = [line];
        } else if (line.trim()) {
            currentChunkLines.push(line);
        }
    }
    if (currentChunkLines.length > 0) {
        chunks.push({ parentDoc: doc.name, section: currentSection, content: currentChunkLines.join('\n').trim() });
    }
    return chunks;
}

function chunkGenericText(doc) {
    return [{ parentDoc: doc.name, section: 'Log Content', content: doc.content }];
}

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0.0, normA = 0.0, normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// --- SINGLETON FOR MANAGING MODEL AND DATA ---

class RetrieverSingleton {
    static instance = null;
    static async getInstance() {
        if (!this.instance) {
            console.log("COLD START: Initializing model and loading documents...");
            // Use path.resolve with __dirname to ensure correct path
            const modelCacheDir = path.resolve('/tmp', 'transformers_cache');
            const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { cache_dir: modelCacheDir });

            const docs = this.loadDocumentsFromDisk();
            const chunks = docs.flatMap(doc => doc.name.endsWith('.md') ? parseAndChunkMarkdown(doc) : chunkGenericText(doc));
            const embeddings = await this.embedChunks(extractor, chunks);

            this.instance = { extractor, chunks, embeddings };
            console.log(`COLD START: Complete. Loaded ${chunks.length} chunks from ${docs.length} documents.`);
        }
        return this.instance;
    }

    static loadDocumentsFromDisk() {
        // Use path.resolve and __dirname to make sure we find the 'data' folder
        // relative to the *Lambda file's location* after bundling
        const docPath = path.resolve(__dirname, 'data'); // <-- FIX: Use resolved path
        console.log(`Attempting to load documents from: ${docPath}`); // Debug log
        const documents = [];
        try {
            for (const subdir of ['logs', 'runbooks']) {
                const subDirPath = path.join(docPath, subdir);
                if (!fs.existsSync(subDirPath)) {
                    console.warn(`Subdirectory not found: ${subDirPath}`);
                    continue; // Skip if subdir doesn't exist
                }
                const files = fs.readdirSync(subDirPath);
                for (const file of files) {
                    const filePath = path.join(subDirPath, file);
                    try {
                        documents.push({
                            name: file,
                            content: fs.readFileSync(filePath, 'utf-8')
                        });
                    } catch (readErr) {
                        console.error(`Error reading file ${filePath}:`, readErr);
                    }
                }
            }
            console.log(`Successfully loaded ${documents.length} documents.`); // Debug log
        } catch (listErr) {
            console.error(`Error listing files in ${docPath}:`, listErr);
        }
        return documents;
    }


    static async embedChunks(extractor, chunks) {
        const contents = chunks.map(c => `Section: ${c.section}. Content: ${c.content}`);
        // Handle potential errors during embedding
        try {
            const output = await extractor(contents, { pooling: 'mean', normalize: true });
            // Check if tolist is available (depends on Xenova version/output)
            return typeof output.tolist === 'function' ? output.tolist() : Array.from(output.data);
        } catch (embedErr) {
            console.error("Error during embedding:", embedErr);
            throw embedErr; // Re-throw to be caught by handler
        }
    }
}

// --- LAMBDA HANDLER ---

export const handler = async (event) => {
    console.log(`Received retriever event for incident: ${event.incidentId}`, JSON.stringify(event, null, 2)); // Log full event
    const { incidentId, message, service } = event;

    // --- IMPROVED INPUT VALIDATION ---
    // The message might be nested differently after alertNormalizer changes
    const actualMessage = message || event.rawPayload?.message || event.rawPayload?.msg?.S || event.rawPayload?.reason?.S || "Missing message";
    const actualService = service || event.rawPayload?.service || event.rawPayload?.serviceName?.S || "unknown-service";


    if (!incidentId || !actualMessage) { // Service is less critical for the query
        console.error("Fatal: Missing incidentId or message from payload.", event);
        // Update DDB with failure status
        await updateDynamoDBWithError(incidentId, "Missing incidentId or message");
        return;
    }

    try {
        console.log("Getting retriever singleton instance...");
        const { extractor, chunks, embeddings } = await RetrieverSingleton.getInstance();
        console.log("Singleton instance retrieved.");


        const query = `Service: ${actualService}. Incident message: ${actualMessage}`;
        console.log(`Generating embedding for query: "${query}"`);
        const queryEmbedding = await extractor(query, { pooling: 'mean', normalize: true });
        // Adjust based on actual output structure if needed
        const queryVector = typeof queryEmbedding.tolist === 'function' ? queryEmbedding.tolist()[0] : Array.from(queryEmbedding.data);
        console.log("Query embedding generated.");


        console.log("Calculating similarities...");
        const similarities = embeddings.map((docEmbedding, i) => ({
            index: i,
            score: cosineSimilarity(queryVector, docEmbedding)
        }));

        similarities.sort((a, b) => b.score - a.score);
        const topK = similarities.slice(0, 3);
        console.log(`Top ${topK.length} documents found.`);


        const retrievedContext = topK.map(item => ({
            document: chunks[item.index].parentDoc,
            section: chunks[item.index].section,
            score: item.score,
            // --- NEW: Truncate snippet ---
            contentSnippet: chunks[item.index].content.substring(0, MAX_SNIPPET_LENGTH) + (chunks[item.index].content.length > MAX_SNIPPET_LENGTH ? '...' : '')
        }));

        const command = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { incidentId },
            UpdateExpression: 'SET #retrievedContext = :ctx, #retrievalTimestamp = :ts, #status = :status',
            ExpressionAttributeNames: {
                '#retrievedContext': 'retrievedContext',
                '#retrievalTimestamp': 'retrievalTimestamp',
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':ctx': retrievedContext,
                ':ts': new Date().toISOString(),
                ':status': 'CONTEXT_RETRIEVED'
            }
        });

        console.log(`Attempting to update DynamoDB for incident ${incidentId}...`);
        await docClient.send(command);
        // --- MOVED SUCCESS LOG ---
        console.log(`Successfully retrieved context AND updated DynamoDB for incident ${incidentId}`, { topDocs: retrievedContext.map(d => `${d.document} (${d.section})`) });

    } catch (err) {
        console.error('--- CRITICAL RETRIEVER ERROR ---', {
            error: err.message || JSON.stringify(err), // Log full error object if no message
            stack: err.stack,
            incidentId: incidentId // Use the validated incidentId
        });
        // Attempt to update DDB with failure status
        await updateDynamoDBWithError(incidentId, err.message || "Unknown retriever error");
    }
};

// --- NEW: Helper to update DDB on error ---
async function updateDynamoDBWithError(incidentId, errorMessage) {
    if (!incidentId) return; // Can't update if no ID
    try {
        const errorUpdateCommand = new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { incidentId },
            UpdateExpression: 'SET #status = :status, #error = :error',
            ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
            ExpressionAttributeValues: {
                ':status': 'RETRIEVAL_FAILED',
                ':error': errorMessage.substring(0, 500), // Limit error message size
            },
        });
        await docClient.send(errorUpdateCommand);
        console.log(`Updated DynamoDB status to RETRIEVAL_FAILED for ${incidentId}`);
    } catch (ddbError) {
        console.error(`Failed to update DynamoDB with error status for ${incidentId}:`, ddbError);
    }
}