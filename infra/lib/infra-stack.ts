import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';

export class InfraStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // S3 bucket for storing artifacts
        const artifactBucket = new s3.Bucket(this, 'OpsFlowArtifactBucket', {
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            versioned: true,
        });

        // DynamoDB table to store incident data
        const incidentTable = new dynamodb.Table(this, 'OpsFlowIncidents', {
            tableName: 'OpsFlowIncidents',
            partitionKey: { name: 'incidentId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        // SNS topic for sending alerts
        const alertTopic = new sns.Topic(this, 'OpsFlowAlertTopic', {
            topicName: 'opsflow-alerts',
            displayName: 'OpsFlow Alerts Topic',
        });

        // SQS queue to handle alert messages
        const opsQueue = new sqs.Queue(this, 'OpsFlowQueue', {
            queueName: 'opsflow-queue',
            visibilityTimeout: cdk.Duration.seconds(300),
            retentionPeriod: cdk.Duration.days(4),
        });

        // Lambda to normalize incoming alerts and push to SQS
        const alertNormalizerLambda = new NodejsFunction(this, 'AlertNormalizerFunction', {
            functionName: 'opsflow-alert-normalizer',
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../lambdas/alert_normalizer/index.js'),
            projectRoot: path.join(__dirname, '../../'),
            depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
            environment: { QUEUE_URL: opsQueue.queueUrl },
            timeout: cdk.Duration.seconds(10),
        });

        opsQueue.grantSendMessages(alertNormalizerLambda);

        // REST API endpoint to receive alerts (POST /alerts)
        const api = new apigw.LambdaRestApi(this, 'OpsFlowAlertApi', {
            handler: alertNormalizerLambda,
            proxy: false,
            description: 'API endpoint for ingesting alerts from synthetic generator'
        });

        const alerts = api.root.addResource('alerts');
        alerts.addMethod('POST');

        // Lambda to process messages from SQS and write to DynamoDB
        const ingestProcessorLambda = new NodejsFunction(this, 'IngestProcessorFunction', {
            functionName: 'opsflow-ingest-processor',
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            entry: path.join(__dirname, '../../lambdas/ingest_processor/index.js'),
            projectRoot: path.join(__dirname, '../../'),
            depsLockFilePath: path.join(__dirname, '../../package-lock.json'),
            environment: {
                TABLE_NAME: incidentTable.tableName,
            },
            timeout: cdk.Duration.seconds(30),
        });

        incidentTable.grantWriteData(ingestProcessorLambda);
        ingestProcessorLambda.addEventSource(new SqsEventSource(opsQueue));

        // Outputs for reference after deployment
        new cdk.CfnOutput(this, 'S3BucketName', { value: artifactBucket.bucketName });
        new cdk.CfnOutput(this, 'DynamoTableName', { value: incidentTable.tableName });
        new cdk.CfnOutput(this, 'SnsTopicArn', { value: alertTopic.topicArn });
        new cdk.CfnOutput(this, 'SqsQueueUrl', { value: opsQueue.queueUrl });
        new cdk.CfnOutput(this, 'AlertNormalizerLambda', { value: alertNormalizerLambda.functionName });
        new cdk.CfnOutput(this, 'IngestProcessorLambda', { value: ingestProcessorLambda.functionName });
        new cdk.CfnOutput(this, 'ApiGatewayUrl', {
            value: api.url,
            description: 'The base URL of the API Gateway. Use this URL + /alerts in your script.'
        });
    }
}
