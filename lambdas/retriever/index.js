import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { pipeline } from '@xenova/transformers';
import fs from 'fs';
import path from 'path';
// The incorrect 'import re from "re";' line has been removed.

const REGION = process.env.AWS_REGION;
const TABLE_NAME = process.env.TABLE_NAME;

const ddbClient = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(ddbClient);

// --- HELPER FUNCTIONS ---

function parseAndChunkMarkdown(doc) {
    const chunks = [];
    const lines = doc.content.split('\n');
    let currentSection = "Introduction";
    let currentChunkLines = [];

    for (const line of lines) {
        // This is the correct JavaScript way to use a regular expression
        const headerMatch = line.match(/^##\s+(.*)/);
        if (headerMatch) {
            if (currentChunkLines.length > 0) {
                chunks.push({
                    parentDoc: doc.name,
                    section: currentSection,
                    content: currentChunkLines.join('\n').trim()
                });
            }
            currentSection = headerMatch[1].replace(/^[^\w\s]+/, '').trim(); // Strip leading emojis/symbols
            currentChunkLines = [line]; // Start new chunk with its header
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
            const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { cache_dir: '/tmp/transformers_cache' });

            const docs = this.loadDocumentsFromDisk();
            const chunks = docs.flatMap(doc => doc.name.endsWith('.md') ? parseAndChunkMarkdown(doc) : chunkGenericText(doc));
            const embeddings = await this.embedChunks(extractor, chunks);

            this.instance = { extractor, chunks, embeddings };
            console.log(`COLD START: Complete. Loaded ${chunks.length} chunks from ${docs.length} documents.`);
        }
        return this.instance;
    }

    static loadDocumentsFromDisk() {
        const docPath = path.join(process.cwd(), 'data');
        const documents = [];
        for (const subdir of ['logs', 'runbooks']) {
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

    static async embedChunks(extractor, chunks) {
        // Add section context to the content before embedding for better results
        const contents = chunks.map(c => `Section: ${c.section}. Content: ${c.content}`);
        return (await extractor(contents, { pooling: 'mean', normalize: true })).tolist();
    }
}

// --- LAMBDA HANDLER ---

export const handler = async (event) => {
    console.log(`Received retriever event for incident: ${event.incidentId}`);
    const { incidentId, message, service } = event;

    if (!incidentId || !message || !service) {
        console.error("Fatal: Missing incidentId, message, or service from payload.", event);
        return;
    }

    try {
        const { extractor, chunks, embeddings } = await RetrieverSingleton.getInstance();

        const query = `Service: ${service}. Incident message: ${message}`;
        const queryEmbedding = await extractor(query, { pooling: 'mean', normalize: true });
        const queryVector = queryEmbedding.tolist()[0];

        const similarities = embeddings.map((docEmbedding, i) => ({
            index: i,
            score: cosineSimilarity(queryVector, docEmbedding)
        }));

        similarities.sort((a, b) => b.score - a.score);
        const topK = similarities.slice(0, 3);

        const retrievedContext = topK.map(item => ({
            document: chunks[item.index].parentDoc,
            section: chunks[item.index].section,
            score: item.score,
            contentSnippet: chunks[item.index].content
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
        console.log(`Successfully retrieved context for incident ${incidentId}`, { topDocs: retrievedContext.map(d => `${d.document} (${d.section})`) });

    } catch (err) {
        console.error('--- CRITICAL RETRIEVER ERROR ---', {
            error: err.message,
            stack: err.stack,
            incidentId: event.incidentId
        });
    }
};