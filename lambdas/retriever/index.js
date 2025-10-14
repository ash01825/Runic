import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { pipeline } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';

const REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.TABLE_NAME;

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

class RetrieverSingleton {
    static instance = null;

    static async getInstance() {
        if (!this.instance) {
            console.log("COLD START: Initializing model and loading documents...");

            // THE DEFINITIVE FIX: Explicitly tell the library to use the writable /tmp/ directory for caching.
            const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { cache_dir: '/tmp/transformers_cache' });

            const docs = this.loadDocumentsFromDisk();
            const embeddings = await this.embedDocuments(extractor, docs);
            this.instance = { extractor, docs, embeddings };
            console.log(`COLD START: Initialization complete. Loaded ${docs.length} documents.`);
        }
        return this.instance;
    }

    static loadDocumentsFromDisk() {
        const docPath = path.join(process.cwd(), 'data');
        const documents = [];
        const subdirs = ['logs', 'runbooks'];
        for (const subdir of subdirs) {
            const files = fs.readdirSync(path.join(docPath, subdir));
            for (const file of files) {
                documents.push({
                    name: file,
                    content: fs.readFileSync(path.join(docPath, subdir, file), 'utf-8')
                });
            }
        }
        return documents;
    }

    static async embedDocuments(extractor, docs) {
        const contents = docs.map(d => d.content);
        const embeddings = await extractor(contents, { pooling: 'mean', normalize: true });
        return embeddings.tolist();
    }
}

function cosineSimilarity(vecA, vecB) {
    let dotProduct = 0.0;
    let normA = 0.0;
    let normB = 0.0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) {
        return 0;
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export const handler = async (event) => {
    console.log(`Received retriever event for incident: ${event.incidentId}`);
    const { incidentId, message, service } = event;

    if (!incidentId || !message || !service) {
        console.error("Fatal: Missing incidentId, message, or service from payload.", event);
        return;
    }

    try {
        const { extractor, docs, embeddings } = await RetrieverSingleton.getInstance();
        const query = `Service ${service} is experiencing an issue: ${message}`;
        const queryEmbedding = await extractor(query, { pooling: 'mean', normalize: true });

        const similarities = embeddings.map((docEmbedding, i) => ({
            index: i,
            score: cosineSimilarity(queryEmbedding.tolist()[0], docEmbedding)
        }));

        similarities.sort((a, b) => b.score - a.score);
        const topK = similarities.slice(0, 3);

        const retrievedContext = topK.map(item => ({
            document: docs[item.index].name,
            score: item.score,
            contentSnippet: docs[item.index].content.substring(0, 500) + '...'
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

        await docClient.send(command);
        console.log(`Successfully retrieved context for incident ${incidentId}`, { topDocs: retrievedContext.map(d => d.document) });
    } catch (err) {
        console.error('--- CRITICAL RETRIEVER ERROR ---', {
            error: err.message,
            stack: err.stack,
            incidentId: event.incidentId
        });
    }
};

