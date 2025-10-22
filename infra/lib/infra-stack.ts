import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs'; // OutputFormat is needed
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { SqsEventSource, DynamoEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import * as iam from 'aws-cdk-lib/aws-iam';

export class InfraStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        const sagemakerEndpointName = 'opsflow-anomaly-detector-v1';
        const bedrockModelArn = `arn:aws:bedrock:${this.region}::foundation-model/meta.llama3-70b-instruct-v1:0`;

        // S3 bucket
        const artifactBucket = new s3.Bucket(this, 'OpsFlowArtifactBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            versioned: true,
        });

        // DynamoDB table
        const incidentTable = new dynamodb.Table(this, 'OpsFlowIncidents', {
            tableName: 'OpsFlowIncidents',
            partitionKey: { name: 'incidentId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES, // Enable Stream
        });

        // SNS topic
        const alertTopic = new sns.Topic(this, 'OpsFlowAlertTopic', {
            topicName: 'opsflow-alerts',
            displayName: 'OpsFlow Alerts Topic',
        });

        // SQS queue
        const opsQueue = new sqs.Queue(this, 'OpsFlowQueue', {
            queueName: 'opsflow-queue',
            visibilityTimeout: cdk.Duration.seconds(300),
            retentionPeriod: cdk.Duration.days(4),
        });

        // alertNormalizerLambda
        const alertNormalizerLambda = new NodejsFunction(this, 'AlertNormalizerFunction', {
            functionName: 'opsflow-alert-normalizer',
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../lambdas/alert_normalizer/index.js'),
            projectRoot: path.join(__dirname, '../../'),
            depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
            environment: { QUEUE_URL: opsQueue.queueUrl },
            timeout: cdk.Duration.seconds(10),
        });

        opsQueue.grantSendMessages(alertNormalizerLambda);

        // API Gateway
        const api = new apigw.LambdaRestApi(this, 'OpsFlowAlertApi', {
            handler: alertNormalizerLambda,
            proxy: false,
            description: 'API endpoint for ingesting alerts'
        });

        const alerts = api.root.addResource('alerts');
        alerts.addMethod('POST');

        // detectionLambda
        const detectionLambda = new NodejsFunction(this, 'DetectionFunction', {
            functionName: 'opsflow-detection',
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../lambdas/detection/index.js'),
            projectRoot: path.join(__dirname, '../../'),
            depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
            environment: {
                TABLE_NAME: incidentTable.tableName,
                SAGEMAKER_ENDPOINT_NAME: sagemakerEndpointName,
            },
            timeout: cdk.Duration.seconds(30),
        });

        incidentTable.grantReadWriteData(detectionLambda);
        detectionLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['sagemaker:InvokeEndpoint'],
            resources: [`arn:aws:sagemaker:${this.region}:${this.account}:endpoint/${sagemakerEndpointName}`]
        }));

        // retrieverLambda
        const retrieverLambda = new NodejsFunction(this, 'RetrieverFunction', {
            functionName: 'opsflow-retriever',
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../lambdas/retriever/index.js'),
            projectRoot: path.join(__dirname, '../../'),
            depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
            bundling: {
                format: OutputFormat.ESM, // <-- This one was already ESM
                externalModules: ['@aws-sdk/*'],
                nodeModules: ['@xenova/transformers'],
                commandHooks: {
                    beforeBundling(inputDir: string, outputDir: string): string[] {
                        return [`cp -r ${inputDir}/data ${outputDir}/`];
                    },
                    afterBundling(): string[] { return []; },
                    beforeInstall() { return []; }
                },
            },
            environment: {
                TABLE_NAME: incidentTable.tableName,
                TRANSFORMERS_CACHE: '/tmp/cache'
            },
            timeout: cdk.Duration.seconds(90),
            memorySize: 1024,
        });

        incidentTable.grantReadWriteData(retrieverLambda);

        // ingestProcessorLambda
        const ingestProcessorLambda = new NodejsFunction(this, 'IngestProcessorFunction', {
            functionName: 'opsflow-ingest-processor',
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../lambdas/ingest_processor/index.js'),
            projectRoot: path.join(__dirname, '../../'),
            depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
            environment: {
                TABLE_NAME: incidentTable.tableName,
                DETECTION_LAMBDA_NAME: detectionLambda.functionName,
                RETRIEVER_LAMBDA_NAME: retrieverLambda.functionName,
            },
            timeout: cdk.Duration.seconds(30),
        });

        incidentTable.grantReadWriteData(ingestProcessorLambda);
        ingestProcessorLambda.addEventSource(new SqsEventSource(opsQueue));
        detectionLambda.grantInvoke(ingestProcessorLambda);
        retrieverLambda.grantInvoke(ingestProcessorLambda);

        // --- UPDATED: Planner "Brain" Lambda ---
        const plannerLambda = new NodejsFunction(this, 'PlannerFunction', {
            functionName: 'opsflow-planner',
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../planner/index.js'),
            projectRoot: path.join(__dirname, '../../'),
            depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
            bundling: {
                format: OutputFormat.ESM, // --- THIS IS THE FIX ---
                commandHooks: {
                    beforeBundling(inputDir: string, outputDir: string): string[] {
                        return [`cp ${inputDir}/planner/prompt_template.md ${outputDir}/`];
                    },
                    afterBundling(): string[] { return []; },
                    beforeInstall() { return []; }
                },
                nodeModules: [ // Dependencies are in root package.json
                    '@aws-sdk/client-bedrock-runtime',
                    '@aws-sdk/client-dynamodb',
                    '@aws-sdk/lib-dynamodb',
                ],
            },
            environment: {
                TABLE_NAME: incidentTable.tableName,
                MODEL_ID: 'meta.llama3-70b-instruct-v1:0', // Update here too
            },
            timeout: cdk.Duration.seconds(90),
            memorySize: 512,
        });

        incidentTable.grantReadWriteData(plannerLambda);
        plannerLambda.addToRolePolicy(new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel'],
            resources: [bedrockModelArn]
        }));

        // --- UPDATED: Planner Trigger Lambda ---
        const plannerTriggerLambda = new NodejsFunction(this, 'PlannerTriggerFunction', {
            functionName: 'opsflow-planner-trigger',
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../lambdas/planner_trigger/index.js'),
            projectRoot: path.join(__dirname, '../../'),
            depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
            bundling: {
                format: OutputFormat.ESM, // --- THIS IS THE FIX ---
                nodeModules: [ // Dependencies are in root package.json
                    '@aws-sdk/client-lambda',
                    '@aws-sdk/util-dynamodb'
                ],
            },
            environment: {
                TABLE_NAME: incidentTable.tableName,
                PLANNER_LAMBDA_NAME: plannerLambda.functionName,
            },
            timeout: cdk.Duration.seconds(30),
        });

        plannerLambda.grantInvoke(plannerTriggerLambda);
        plannerTriggerLambda.addEventSource(new DynamoEventSource(incidentTable, {
            startingPosition: lambda.StartingPosition.LATEST,
            batchSize: 5,
        }));


        // --- Outputs ---
        new cdk.CfnOutput(this, 'ApiGatewayUrl', {
            value: `${api.url}alerts`,
            description: 'The full URL for POSTing alerts to the API Gateway.'
        });
        new cdk.CfnOutput(this, 'DynamoTableName', { value: incidentTable.tableName });
        new cdk.CfnOutput(this, 'SqsQueueUrl', { value: opsQueue.queueUrl });
    }
}